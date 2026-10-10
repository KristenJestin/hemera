/**
 * The launch (#139, section 4): by the user only, on the mission's latest check while it holds.
 *
 * 1. **Refusals.** Unless the mission is Ready, unless the check is done and still holds (each thing
 *    that moved since named, `building.check_expired`), while a dependency is not Done, without
 *    `launch_anyway` when something moved, and while another launch of the mission is under way:
 *    one row per launch under way, a unique index arbitrating two launches at once.
 * 2. **The Workspace.** Made through #6 on the mission's branch (`buildingBranchName`), one worktree
 *    per repository the Spec writes in or its Impact names, each from the commit the check read,
 *    never the dirty main checkout; then the Project's recipe runs, in the background. The
 *    validation settings are read at this moment, to be copied when the Workspace is ready.
 * 3. **Ready.** In one transaction: Ready → Building (actor `user`), the validation copy, the
 *    launch `launched`, `building.workspace_ready` and `building.launched`. Then `BuildingStart`,
 *    once per launch, and the reservations of the Project's exclusive resources (#88).
 * 4. **Failed.** A failed step is an environment need on the mission, saying the step, its words
 *    and what is left on disk, with Retry: Retry resumes the recipe where it stopped. The mission
 *    stays Ready, Now saying the preparation failed.
 *
 * A restart resumes the preparation (#6's start-up resume); what it ended while the engine was not
 * listening is read again at the start, so a launch never starts twice and never stays half done.
 */

import {
  CHECK_EXPIRED,
  EnvironmentFields,
  type LaunchChoice,
  LAUNCH_STATES,
  type LaunchState,
  MissionOwner,
  blockedBySaid,
  buildingBranchName,
  missionKey,
} from '@hemera/core/domain'
import {
  type BuildingChange,
  type BuildingPreparation,
  BuildingRefused,
  CheckChanged,
  NewBranch,
  type PreparationStep,
  PreparationChanged,
  type UpToDateBase,
  type Workspace,
} from '@hemera/ipc'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { Cause, Context, Effect, Layer, Match, Option, Result, Schema, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import type { DomainEvent } from '../journal.ts'
import { moveIn } from '../missions.ts'
import { type NeedHandler, createNeedIn, needService, withdrawNeed } from '../needs.ts'
import { hemeraNext, missionRow } from '../planning/store.ts'
import { beginPreparation } from '../preparation.ts'
import { listResources } from '../resources/declarations.ts'
import { ExclusiveResources } from '../resources/reservations.ts'
import { Secrets } from '../secrets.ts'
import { resolvedSetting } from '../sessions/cascade.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { buildingLaunches } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { type WorkspaceServices, createWorkspace, getWorkspace } from '../workspaces.ts'
import {
  BUILDER,
  checkOfMission,
  expiryOf,
  mechanicalCheck,
  preparedRepositories,
} from './check.ts'
import { checkEvent, launchEvent } from './events.ts'
import { latestCheckOf, latestCheckRowIn, readOf, resultsOf, viewOf } from './store.ts'
import { copyIn, sectionsNow, writeSections } from './validation.ts'

/**
 * Where the Building starts once its Workspace is ready: #141 fills it. Until then, nothing starts
 * and the mission waits in Building with no agent.
 */
export class BuildingStart extends Context.Service<
  BuildingStart,
  { readonly start: (missionId: string) => Effect.Effect<void> }
>()('BuildingStart') {}

/** The port as it stands until #141: it does nothing. */
export const buildingStartUnfilled = Layer.succeed(BuildingStart, { start: () => Effect.void })

/** The service a launch's environment needs belong to. */
export const BUILDING_NEEDS = needService('building')

type LaunchRow = typeof buildingLaunches.$inferSelect

const now = (): string => new Date().toISOString()

const refused = (...reasons: ReadonlyArray<string>) => new BuildingRefused({ reasons })

const stateOf = (row: LaunchRow): LaunchState =>
  LAUNCH_STATES.find((one) => one === row.state) ?? 'failed'

/** Now while the Workspace is prepared: the step it is at, of how many. */
const preparingSaid = (steps: ReadonlyArray<PreparationStep>): string => {
  const at = steps.find((step) => step.state !== 'done' && step.state !== 'skipped')
  return `Preparing the Workspace (step ${String(at?.position ?? steps.length)} of ${String(steps.length)})`
}

const failedStep = (steps: ReadonlyArray<PreparationStep>) =>
  steps.find((step) => step.state === 'failed') ?? null

/** Now once a step failed. */
const failedSaid = (steps: ReadonlyArray<PreparationStep>): string =>
  `Preparation failed: step ${String(failedStep(steps)?.position ?? 0)} of ${String(steps.length)}`

/** What a done step left on disk, in words. */
const leftSaid = (step: PreparationStep): string => {
  switch (step.kind) {
    case 'worktree':
      return `the worktree of ${step.base ?? 'the root'}`
    case 'copy':
      return `the copy of ${step.path ?? 'a file'}`
    case 'link':
      return `the link of ${step.path ?? 'a file'}`
    case 'run':
      return `what ${step.line ?? 'its command'} did`
  }
}

/** Now's words for a launch in each state. */
const NOW_SAID: Readonly<Record<LaunchState, (steps: ReadonlyArray<PreparationStep>) => string>> = {
  preparing: preparingSaid,
  failed: failedSaid,
  launched: () => 'The Workspace is ready: Building',
  cancelled: () => 'The launch was cancelled',
}

/** The launch row of a mission, the latest first. */
const launchesOf = (reader: EngineTransaction | Database['Service'], missionId: string) =>
  reader
    .select()
    .from(buildingLaunches)
    .where(eq(buildingLaunches.missionId, missionId))
    .orderBy(desc(buildingLaunches.createdAt))
    .pipe(Effect.mapError(refusedWhile('reading the launches')))

/** The launch whose Workspace this is, or null. */
const launchOfWorkspace = (workspaceId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(buildingLaunches)
      .where(eq(buildingLaunches.workspaceId, workspaceId))
      .pipe(Effect.mapError(refusedWhile('reading the launches')))
    return row ?? null
  })

const projectOfIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(missionRow(transaction, missionId), (row) => row.projectId)

/** A launch as the window reads it: its state, its Workspace's steps, and Now's words. */
const preparationView = (row: LaunchRow) =>
  Effect.gen(function* () {
    const workspace =
      row.workspaceId === null
        ? null
        : yield* getWorkspace(row.workspaceId).pipe(
            Effect.catchTag('UnknownWorkspace', () => Effect.succeed(null)),
          )
    const steps = workspace?.steps ?? []
    const state = stateOf(row)
    const view: BuildingPreparation = {
      missionId: row.missionId,
      launchId: row.id,
      state,
      workspaceId: row.workspaceId,
      branch: row.branch,
      steps,
      needId: row.needId,
      now: NOW_SAID[state](steps),
    }
    return view
  })

/** The mission's latest launch, as the window reads it; null before its first. */
export const preparationOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    yield* database.transaction((transaction) => missionRow(transaction, missionId))
    const [row] = yield* launchesOf(database, missionId)
    return row === undefined ? null : yield* preparationView(row)
  })

/**
 * The mission's latest check and launch now, then again at each change of the mission and of its
 * launch's Workspace (`building.changed`).
 */
export const buildingChanges = (missionId: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const changes = Effect.gen(function* () {
        const check = yield* latestCheckOf(missionId)
        const preparation = yield* preparationOf(missionId)
        const seen: ReadonlyArray<BuildingChange> = [
          ...(check === null ? [] : [CheckChanged.make({ check })]),
          ...(preparation === null ? [] : [PreparationChanged.make({ preparation })]),
        ]
        return seen
      })
      const ours = (event: DomainEvent) =>
        Match.value(event.entityKind).pipe(
          Match.when('mission', () => Effect.succeed(event.entityId === missionId)),
          Match.when('workspace', () =>
            Effect.map(launchOfWorkspace(event.entityId), (row) => row?.missionId === missionId),
          ),
          Match.orElse(() => Effect.succeed(false)),
        )
      return Stream.concat(
        Stream.fromEffect(changes),
        events.pipe(
          Stream.filterEffect(ours),
          Stream.mapEffect(() => changes),
        ),
      ).pipe(Stream.flatMap((seen) => Stream.fromIterable(seen)))
    }),
  )

/** A launch claimed, or why not. */
interface Claimed {
  readonly row: LaunchRow | null
  readonly reason: string
}

/**
 * The launch claimed in one transaction, the mission Ready in it: of two launches at once, the
 * unique index lets one in, and the other is told the mission is already being launched.
 */
const claim = (
  missionId: string,
  checkId: string,
  choice: LaunchChoice,
  taken: { readonly setting: string; readonly sections: string },
) =>
  mutate('claiming the launch', (transaction) =>
    Effect.gen(function* () {
      const mission = yield* missionRow(transaction, missionId)
      const key = missionKey(mission.keyPrefix, mission.keyNumber)
      const no = (reason: string) => {
        const refusedClaim: Claimed = { row: null, reason }
        return { result: refusedClaim, events: [] }
      }
      if (mission.stage === 'building')
        return no(`${key} is already Building: one Building at a time.`)
      if (mission.stage !== 'ready')
        return no(`${key} is not Ready: only a Ready mission is launched.`)
      const [row] = yield* transaction
        .insert(buildingLaunches)
        .values({
          id: crypto.randomUUID(),
          missionId,
          checkId,
          choice,
          state: 'preparing',
          workspaceId: null,
          branch: null,
          setting: taken.setting,
          settings: taken.sections,
          needId: null,
          createdAt: now(),
          launchedAt: null,
          startedAt: null,
        })
        .onConflictDoNothing()
        .returning()
        .pipe(Effect.mapError(refusedWhile('claiming the launch')))
      if (row === undefined) return no(`${key} is already being launched.`)
      const claimed: Claimed = { row, reason: '' }
      return { result: claimed, events: [] }
    }),
  )

/** Why the user's choice does not hold for this check, or null. */
const choiceRefusal = (missionId: string, checkId: string, choice: LaunchChoice) =>
  Effect.gen(function* () {
    const check = yield* checkOfMission(missionId, checkId)
    const database = yield* Database
    const mission = yield* database.transaction((transaction) => missionRow(transaction, missionId))
    const key = missionKey(mission.keyPrefix, mission.keyNumber)
    if (mission.stage === 'building') {
      return { check, reasons: [`${key} is already Building: one Building at a time.`] }
    }
    if (mission.stage !== 'ready') {
      return { check, reasons: [`${key} is not Ready: only a Ready mission is launched.`] }
    }
    const [under] = yield* database
      .select({ id: buildingLaunches.id })
      .from(buildingLaunches)
      .where(
        and(
          eq(buildingLaunches.missionId, missionId),
          inArray(buildingLaunches.state, ['preparing', 'failed']),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the launches')))
    if (under !== undefined) return { check, reasons: [`${key} is already being launched.`] }
    const latest = yield* latestCheckRowIn(database, missionId)
    if (latest?.id !== check.id || check.kind !== 'full') {
      return { check, reasons: [CHECK_EXPIRED, 'A newer check ran since this one.'] }
    }
    if (check.state === 'running') return { check, reasons: ['The check is still running.'] }
    if (check.state === 'failed') return { check, reasons: ['The check failed: check again.'] }
    const verdict = viewOf(check, key).verdict
    if (verdict.blockedBy.length > 0) {
      return {
        check,
        reasons: [
          `${key} is ${blockedBySaid(verdict.blockedBy)}: it is launched once they are Done.`,
        ],
      }
    }
    if (verdict.outdated && choice !== 'launch_anyway') {
      return {
        check,
        reasons: ['Something moved since the Freeze: Launch anyway, or go back to Planning.'],
      }
    }
    return { check, reasons: [] }
  })

const SettingJson = Schema.fromJsonString(
  Schema.Struct({
    agent: Schema.String,
    model: Schema.NullOr(Schema.String),
    effort: Schema.NullOr(Schema.String),
  }),
)
const writeSetting = Schema.encodeSync(SettingJson)
const readSetting = Schema.decodeUnknownOption(SettingJson)

/**
 * The user launches the mission on its latest check, with `launch`, or `launch_anyway` when
 * something moved. Answers the preparation as it starts; the stage moves once it is ready.
 */
export const launchMission = (missionId: string, checkId: string, choice: LaunchChoice) =>
  Effect.gen(function* () {
    const { check, reasons } = yield* choiceRefusal(missionId, checkId, choice)
    if (reasons.length > 0) return yield* refused(...reasons)
    const read = readOf(check)
    if (read === null) return yield* refused(CHECK_EXPIRED, 'This check cannot be read.')
    // Everything the check read, read again: one fetch per repository.
    const expiry = yield* expiryOf(missionId, read)
    if (expiry.reasons.length > 0) {
      const secrets = yield* Secrets
      yield* mutate('expiring the check', (transaction) =>
        Effect.gen(function* () {
          const projectId = yield* projectOfIn(transaction, missionId)
          return {
            result: undefined,
            events: [
              checkEvent('building.check_expired', check, projectId, {
                reasons: expiry.reasons.map((one) => secrets.mask(one)),
              }),
            ],
          }
        }),
      )
      return yield* refused(CHECK_EXPIRED, ...expiry.reasons)
    }
    const { spec } = expiry
    const setting = yield* resolvedSetting({ kind: 'mission', missionId }, BUILDER)
    const projectId = yield* projectIdOf(missionId)
    const sections = yield* sectionsNow({ projectId, spec })
    const claiming = yield* claim(missionId, checkId, choice, {
      setting: writeSetting({ agent: setting.agent, model: setting.model, effort: setting.effort }),
      sections: writeSections(sections),
    })
    if (claiming.row === null) return yield* refused(claiming.reason)
    const claimed = claiming.row
    // The Workspace, from the commits the check read.
    const checked = resultsOf(check).bases
    const paths = preparedRepositories(
      spec,
      checked.map((base) => base.repository),
    )
    const prepared = checked.filter((base) => paths.includes(base.repository))
    const bases = new Map<string, UpToDateBase>(
      prepared.map((base) => [
        base.repositoryId,
        { commit: base.commit, ref: base.ref, freshness: base.freshness },
      ]),
    )
    const made = yield* createWorkspace(
      {
        projectId,
        name: buildingBranchName(spec.key, spec.title),
        repositories: prepared.map((base) => base.repositoryId),
        mode: NewBranch.make({}),
      },
      bases,
    ).pipe(Effect.result)
    if (Result.isFailure(made)) {
      // Nothing was made on disk: the claim goes, and the mission can be launched again.
      yield* mutate('undoing the launch', (transaction) =>
        transaction
          .delete(buildingLaunches)
          .where(eq(buildingLaunches.id, claimed.id))
          .pipe(
            Effect.mapError(refusedWhile('undoing the launch')),
            Effect.as({ result: undefined, events: [] }),
          ),
      )
      return yield* refused(`The Workspace could not be made: ${made.failure.message}`)
    }
    const workspace = made.success
    yield* mutate('preparing the Workspace', (transaction) =>
      Effect.gen(function* () {
        yield* transaction
          .update(buildingLaunches)
          .set({ workspaceId: workspace.id, branch: workspace.branch })
          .where(eq(buildingLaunches.id, claimed.id))
          .pipe(Effect.mapError(refusedWhile('preparing the Workspace')))
        const next = yield* hemeraNext(transaction, missionId, preparingSaid(workspace.steps))
        return {
          result: undefined,
          events: [
            launchEvent('building.workspace_preparing', claimed, workspace.projectId, {
              workspaceId: workspace.id,
              branch: workspace.branch,
              steps: workspace.steps.length,
              choice,
            }),
            next,
          ],
        }
      }),
    )
    yield* beginPreparation(workspace.id, false).pipe(
      Effect.catchTag('PreparationRunning', () => Effect.void),
    )
    const [row] = yield* launchesOf(yield* Database, missionId)
    if (row === undefined) return yield* Effect.die(new Error('the launch was not kept'))
    return yield* preparationView(row)
  })

const projectIdOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) => projectOfIn(transaction, missionId))
  })

const LaunchSetting = Schema.decodeUnknownOption(Schema.String)

/** The settings a launch took, as its row keeps them. */
const takenOf = (row: LaunchRow) => ({
  setting: Option.getOrNull(readSetting(row.setting)),
  sections: Option.getOrElse(LaunchSetting(row.settings), () => '{}'),
})

/** The Workspace's preparation ended ready: the move to Building, once. */
const finalize = (row: LaunchRow, workspace: Workspace) =>
  mutate('moving the mission to Building', (transaction) =>
    Effect.gen(function* () {
      const [fresh] = yield* transaction
        .update(buildingLaunches)
        .set({ state: 'launched', launchedAt: now(), needId: null })
        .where(and(eq(buildingLaunches.id, row.id), eq(buildingLaunches.state, 'preparing')))
        .returning()
        .pipe(Effect.mapError(refusedWhile('launching the mission')))
      if (fresh === undefined) return { result: null, events: [] }
      const mission = yield* missionRow(transaction, row.missionId)
      if (mission.stage !== 'ready') {
        yield* transaction
          .update(buildingLaunches)
          .set({ state: 'cancelled' })
          .where(eq(buildingLaunches.id, row.id))
          .pipe(Effect.mapError(refusedWhile('cancelling the launch')))
        return { result: null, events: [] }
      }
      const moved = yield* moveIn(transaction, { ...mission, stage: 'ready' }, 'launch', 'user')
      const taken = takenOf(row)
      const version = yield* copyIn(transaction, row.missionId, taken.sections)
      const next = yield* hemeraNext(transaction, row.missionId, 'The Workspace is ready: Building')
      const branches = workspace.branch === null ? [] : [workspace.branch]
      return {
        result: fresh,
        events: [
          moved,
          launchEvent('building.workspace_ready', row, workspace.projectId, {
            workspaceId: workspace.id,
          }),
          launchEvent('building.launched', row, workspace.projectId, {
            agent: taken.setting?.agent ?? null,
            model: taken.setting?.model ?? null,
            effort: taken.setting?.effort ?? null,
            workspaceId: workspace.id,
            branches,
            bases: workspace.repositories.map((one) => `${one.path} ${one.base.commit ?? ''}`),
            validation: version,
          }),
          next,
        ],
      }
    }),
  )

/** The step that failed, as the environment need says it: its words, and what is left on disk. */
const needFields = (workspace: Workspace) => {
  const failed = failedStep(workspace.steps)
  const left = workspace.steps.filter((step) => step.state === 'done').map(leftSaid)
  return EnvironmentFields.make({
    missing: [
      `Step ${String(failed?.position ?? 0)} of ${String(workspace.steps.length)} failed: ${failed?.failure?.doing ?? 'it stopped'}.`,
      ...(failed?.failure?.output === undefined || failed.failure.output === ''
        ? []
        : [failed.failure.output]),
      left.length === 0
        ? 'Nothing was made on disk before it.'
        : `Left as made: ${left.join(', ')}.`,
    ].join('\n'),
    action: 'Fix what the step says, then Retry: the preparation resumes where it stopped.',
    settingsSection: null,
  })
}

/** The Workspace's preparation failed: an environment need, Now saying it, the mission Ready. */
const failLaunch = (row: LaunchRow, workspace: Workspace) =>
  Effect.gen(function* () {
    const write = yield* createNeedIn(
      BUILDING_NEEDS,
      MissionOwner.make({ projectId: workspace.projectId, missionId: row.missionId, taskId: null }),
      needFields(workspace),
    )
    const secrets = yield* Secrets
    return yield* mutate('saying the preparation failed', (transaction) =>
      Effect.gen(function* () {
        const [fresh] = yield* transaction
          .select()
          .from(buildingLaunches)
          .where(and(eq(buildingLaunches.id, row.id), eq(buildingLaunches.state, 'preparing')))
          .pipe(Effect.mapError(refusedWhile('reading the launch')))
        if (fresh === undefined) return { result: null, events: [] }
        const need = yield* write(transaction)
        yield* transaction
          .update(buildingLaunches)
          .set({ state: 'failed', needId: need.id })
          .where(eq(buildingLaunches.id, row.id))
          .pipe(Effect.mapError(refusedWhile('saying the preparation failed')))
        const next = yield* hemeraNext(transaction, row.missionId, failedSaid(workspace.steps))
        const failed = failedStep(workspace.steps)
        return {
          result: need.id,
          events: [
            launchEvent('building.workspace_failed', row, workspace.projectId, {
              workspaceId: workspace.id,
              step: failed?.position ?? 0,
              of: workspace.steps.length,
              doing: secrets.mask(failed?.failure?.doing ?? ''),
              output: secrets.mask(failed?.failure?.output ?? ''),
              needId: need.id,
            }),
            ...need.events,
            next,
          ],
        }
      }),
    )
  })

/** A failed launch preparing again: Retry resumes the recipe where it stopped. */
const resumeLaunch = (needId: string) =>
  Effect.gen(function* () {
    const resumed = yield* mutate('resuming the preparation', (transaction) =>
      Effect.gen(function* () {
        const [row] = yield* transaction
          .update(buildingLaunches)
          .set({ state: 'preparing', needId: null })
          .where(and(eq(buildingLaunches.needId, needId), eq(buildingLaunches.state, 'failed')))
          .returning()
          .pipe(Effect.mapError(refusedWhile('resuming the preparation')))
        if (row === undefined) return { result: null, events: [] }
        const projectId = yield* projectOfIn(transaction, row.missionId)
        const next = yield* hemeraNext(transaction, row.missionId, 'Preparing the Workspace again')
        return {
          result: row,
          events: [
            launchEvent('building.workspace_preparing', row, projectId, {
              workspaceId: row.workspaceId,
              resumed: true,
            }),
            next,
          ],
        }
      }),
    )
    if (resumed?.workspaceId == null) return false
    yield* beginPreparation(resumed.workspaceId, true).pipe(
      Effect.catchTag('PreparationRunning', () => Effect.void),
    )
    return true
  })

type Needs =
  | WorkspaceServices
  | DomainEvents
  | Secrets
  | AutomationGate
  | BuildingStart
  | ExclusiveResources

/**
 * The launches followed: each preparation's end, each step for Now, a mission cancelled, Retry,
 * and at the start what a stop left. Answers the layer and the handler of the launch's needs.
 */
export const buildingLaunchesLayer = (log: Log) => {
  let resume: ((needId: string) => Effect.Effect<boolean>) | null = null
  const handler: NeedHandler = {
    deliver: () => Effect.succeed([]),
    // Still missing until the user's Retry: Hemera never resumes a failed preparation by itself.
    recheck: (need, retried) =>
      !retried || resume === null ? Effect.succeed(true) : Effect.map(resume(need.id), (ok) => !ok),
  }
  const layer = Layer.effectDiscard(
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const said = (line: string) => Effect.sync(() => log(`building: ${line}`))
      const provided = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)

      /** BuildingStart once per launch, then the reservations for the whole Building. */
      const startOnce = (row: LaunchRow) =>
        Effect.gen(function* () {
          const taken = yield* mutate('starting the Building', (transaction) =>
            Effect.map(
              transaction
                .update(buildingLaunches)
                .set({ startedAt: now() })
                .where(and(eq(buildingLaunches.id, row.id), isNull(buildingLaunches.startedAt)))
                .returning({ id: buildingLaunches.id })
                .pipe(Effect.mapError(refusedWhile('starting the Building'))),
              (rows) => ({ result: rows.length > 0, events: [] }),
            ),
          )
          if (!taken) return
          yield* BuildingStart.use((port) => port.start(row.missionId))
          const projectId = yield* projectIdOf(row.missionId)
          const resources = yield* listResources(projectId)
          const reservations = yield* ExclusiveResources
          for (const resource of resources) {
            yield* reservations.acquire(resource.name, row.missionId).pipe(
              Effect.catchCause((cause) =>
                said(`${resource.name} was not reserved for ${row.missionId}: ${String(cause)}`),
              ),
              Effect.forkDetach,
            )
          }
        })

      /** A preparation that ended, followed through for its launch. */
      const ended = (workspaceId: string) =>
        Effect.gen(function* () {
          const row = yield* launchOfWorkspace(workspaceId)
          if (row?.state !== 'preparing') {
            if (row?.state === 'launched' && row.startedAt === null) yield* startOnce(row)
            return
          }
          const workspace = yield* getWorkspace(workspaceId)
          if (workspace.preparing) return
          if (workspace.preparation === 'ready') {
            const launched = yield* finalize(row, workspace)
            if (launched !== null) yield* startOnce(launched)
          } else if (workspace.preparation === 'failed') {
            yield* failLaunch(row, workspace)
          }
        })

      /** A step moved: Now says where the preparation is. */
      const stepped = (workspaceId: string) =>
        Effect.gen(function* () {
          const row = yield* launchOfWorkspace(workspaceId)
          if (row?.state !== 'preparing') return
          const workspace = yield* getWorkspace(workspaceId)
          yield* mutate('saying where the preparation is', (transaction) =>
            Effect.map(
              hemeraNext(transaction, row.missionId, preparingSaid(workspace.steps)),
              (event) => ({ result: undefined, events: [event] }),
            ),
          )
        })

      /** A mission cancelled: its launch under way is cancelled, its need withdrawn. */
      const cancelled = (missionId: string) =>
        Effect.gen(function* () {
          const rows = yield* mutate('cancelling the launch', (transaction) =>
            Effect.map(
              transaction
                .update(buildingLaunches)
                .set({ state: 'cancelled' })
                .where(
                  and(
                    eq(buildingLaunches.missionId, missionId),
                    inArray(buildingLaunches.state, ['preparing', 'failed']),
                  ),
                )
                .returning()
                .pipe(Effect.mapError(refusedWhile('cancelling the launch'))),
              (result) => ({ result, events: [] }),
            ),
          )
          for (const row of rows) {
            if (row.needId !== null) yield* withdrawNeed(row.needId, 'the mission was cancelled')
          }
        })

      resume = (needId) =>
        provided(resumeLaunch(needId)).pipe(
          Effect.catchCause((cause) =>
            Effect.as(said(`the preparation was not resumed: ${String(cause)}`), false),
          ),
        )

      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const follow = events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === 'workspace.preparation_ended') yield* ended(event.entityId)
            if (event.type.startsWith('workspace.step_')) yield* stepped(event.entityId)
            if (event.type === 'mission.cancelled') yield* cancelled(event.entityId)
            // A dependency reached Done: the mechanical part of the check runs at once.
            if (event.type === 'dependency.done') yield* mechanicalCheck(event.entityId)
          }).pipe(
            provided,
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : said(`an event was not followed: ${String(cause)}`),
            ),
          ),
        ),
      )

      // At every start: a launch a stop left is carried on, never started twice.
      const reconcile = Effect.gen(function* () {
        const database = yield* Database
        const rows = yield* database
          .select()
          .from(buildingLaunches)
          .where(inArray(buildingLaunches.state, ['preparing', 'launched']))
          .pipe(Effect.mapError(refusedWhile('reading the launches')))
        for (const row of rows) {
          if (row.state === 'launched') {
            if (row.startedAt === null) yield* startOnce(row)
            continue
          }
          if (row.workspaceId === null) {
            // Claimed, nothing made: the launch goes, and the mission can be launched again.
            yield* mutate('undoing a launch a stop left', (transaction) =>
              transaction
                .delete(buildingLaunches)
                .where(and(eq(buildingLaunches.id, row.id), isNull(buildingLaunches.workspaceId)))
                .pipe(
                  Effect.mapError(refusedWhile('undoing a launch')),
                  Effect.as({ result: undefined, events: [] }),
                ),
            )
            continue
          }
          const workspace = yield* getWorkspace(row.workspaceId)
          if (workspace.preparation === 'pending') {
            yield* beginPreparation(workspace.id, false).pipe(
              Effect.catchTag('PreparationRunning', () => Effect.void),
            )
          } else {
            yield* ended(workspace.id)
          }
        }
      })

      yield* AutomationGate.use((gate) => gate.pass).pipe(
        Effect.andThen(
          Effect.all(
            [
              follow,
              reconcile.pipe(
                Effect.catchCause((cause) =>
                  said(`the launches were not reconciled: ${String(cause)}`),
                ),
              ),
            ],
            { concurrency: 'unbounded', discard: true },
          ),
        ),
        Effect.provide(context),
        Effect.catchCause((cause) => said(`the launches stopped: ${String(cause)}`)),
        Effect.forkScoped,
      )
    }),
  )
  return { layer, handler }
}
