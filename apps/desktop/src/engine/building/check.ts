/**
 * The pre-launch check (#139, CT-25): a Ready mission read against the code of today before it is
 * launched, at the moment the user asks, never in the background.
 *
 * 1. **Dependencies.** Each accepted dependency and its stage; one not Done blocks the launch.
 * 2. **Base.** Each repository's base by the rule of the up-to-date base (one fetch each); offline,
 *    the last tracking ref, said "not fetched since", never blocking.
 * 3. **What moved.** Between the Freeze's commit and today's: the files a task targets and the
 *    tests a Proof block adds, the living requirements the deltas were written against, the
 *    requirements of dependencies relied on, the linked ticket, and the targeted files that were
 *    dirty at the Freeze. Each marks the mission outdated; none changes its stage.
 * 4. **What else changed.** Every other file changed on the base since the Freeze is handed, with
 *    its diff, to the agent of the check (`prelaunch-role.ts`), whose runs are `runs.ts`'s.
 * 5. **The model.** The Builder's setting as the cascade resolves it, beside the Planner's
 *    recommendation; an override is stored at the mission level.
 *
 * A check records what it read (`CheckRead`): a launch holds only while nothing of it moved
 * (`expiryOf`). When a dependency reaches Done, the mechanical part (1 to 3) runs at once, without
 * an agent, and only marks the mission.
 */

import { homedir } from 'node:os'

import {
  type ModelSettingValue,
  type OutdatedReason,
  blockedBySaid,
  dirtyAtFreezeSaid,
  handedKindOf,
  missionKey,
  sensitivePlace,
} from '@hemera/core/domain'
import {
  BuildingRefused,
  type BaseFreshness,
  type CheckModel,
  type CheckStep,
  type CheckedBase,
  type CheckedDependency,
  type HandedItem,
  type MovedItem,
  type Spec,
  UnknownCheck,
} from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Effect, Match, Result } from 'effect'

import { Git } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { dependenciesOf } from '../planning/dependencies.ts'
import { oneAtATime } from '../planning/discussions.ts'
import { returnToPlanning } from '../planning/freeze.ts'
import { freezesOf } from '../planning/freeze-store.ts'
import { markOutdatedIn } from '../planning/outdated.ts'
import { placeOf } from '../planning/plan.ts'
import { driftIn, missionRow, specIn } from '../planning/store.ts'
import { upToDateBase } from '../repositories.ts'
import { Secrets } from '../secrets.ts'
import { resolvedSetting, setRoleSetting } from '../sessions/cascade.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { prelaunchChecks, specRequirements } from '../storage/schema.ts'
import { missionTicket } from '../tickets/link.ts'
import { mutate } from '../transaction.ts'
import { checkEvent } from './events.ts'
import {
  type CheckRead,
  type CheckResults,
  HANDED_MOST,
  type HandedPatch,
  SENSITIVE_WITHHELD,
  type UnhandedFile,
  checkRowIn,
  checkView,
  latestCheckOf,
  latestCheckRowIn,
  resultsOf,
  viewOf,
  writeRead,
  writeResults,
} from './store.ts'
import { fingerprintOf, sectionsNow } from './validation.ts'

export { checkView, latestCheckOf }

/** The Builder's role, as the cascade of models names it. */
export const BUILDER = 'builder'

const now = (): string => new Date().toISOString()

const refused = (...reasons: ReadonlyArray<string>) => new BuildingRefused({ reasons })

/** A base's freshness, as the check's step says it. */
const freshnessSaid = Match.type<BaseFreshness>().pipe(
  Match.tagsExhaustive({
    FetchedNow: () => 'fetched now',
    NotFetchedSince: (freshness) =>
      freshness.since === null
        ? 'not fetched since it was added'
        : `not fetched since ${freshness.since}`,
    LocalBranch: () => 'its local branch',
  }),
)

const short = (commit: string | null): string => (commit === null ? 'none' : commit.slice(0, 12))

/** The files the frozen Spec writes, per repository: what its tasks target, what its proofs add. */
const writtenBy = (spec: Spec) => {
  const targets = new Set(
    spec.tasks.flatMap((task) => task.targets.map((one) => `${one.repository}/${one.path}`)),
  )
  const proofs = new Set(
    spec.requirements.flatMap((requirement) =>
      requirement.removed
        ? []
        : requirement.scenarios.flatMap((scenario) =>
            scenario.proof?.test === undefined || scenario.proof.test === null
              ? []
              : [`${scenario.proof.test.repository}/${scenario.proof.test.path}`],
          ),
    ),
  )
  return { targets, proofs }
}

/**
 * The repositories a launch prepares (open question 20): every one a frozen task targets or a
 * Proof block writes in, and every one the Impact section names as a word, in the Project's order;
 * every one when the Spec names none.
 */
export const preparedRepositories = (spec: Spec, paths: ReadonlyArray<string>) => {
  const { targets, proofs } = writtenBy(spec)
  const written = [...targets, ...proofs]
  const impact = spec.sections.find((one) => one.name === 'impact')?.body ?? ''
  const words = new Set(impact.split(/[^\w./-]+/).filter((word) => word !== ''))
  const chosen = paths.filter(
    (path) => written.some((one) => one.startsWith(`${path}/`)) || words.has(path),
  )
  // A Spec that names none of them: every repository, rather than a Workspace of none.
  return chosen.length === 0 ? paths : chosen
}

/** What the check read of the mission at the start: its row, its Spec, its Freeze, its Project. */
export const readMission = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const read = yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const mission = yield* missionRow(transaction, missionId)
        const spec = yield* specIn(transaction, missionId)
        const drift = yield* driftIn(transaction, mission.projectId, spec)
        return { mission, spec, drift }
      }),
    )
    const freeze = (yield* freezesOf([missionId])).get(missionId) ?? null
    return { ...read, freeze, key: missionKey(read.mission.keyPrefix, read.mission.keyNumber) }
  })

/** The accepted dependencies of a mission, with their stage now. */
const dependenciesNow = (missionId: string) =>
  Effect.map(dependenciesOf(missionId), (listed) =>
    listed.dependsOn
      .filter((one) => one.state === 'accepted')
      .map((one) => ({
        id: one.dependsOnId,
        key: one.dependsOnKey,
        stage: one.dependsOnStage,
      })),
  )

/** Each repository's base today, by the rule of the up-to-date base. */
const basesNow = (missionId: string, frozen: ReadonlyMap<string, string>) =>
  Effect.gen(function* () {
    const place = yield* placeOf(missionId)
    const repositories = [...place.repositories.values()].toSorted(
      (a, b) => a.position - b.position,
    )
    const bases: CheckedBase[] = []
    const problems: string[] = []
    for (const repository of repositories) {
      const base = yield* upToDateBase(repository.id).pipe(Effect.result)
      if (Result.isFailure(base)) {
        problems.push(`The base of ${repository.path} could not be read: ${base.failure.message}`)
        continue
      }
      bases.push({
        repositoryId: repository.id,
        repository: repository.path,
        frozen: frozen.get(repository.path) ?? null,
        commit: base.success.commit,
        ref: base.success.ref,
        freshness: base.success.freshness,
      })
    }
    return { main: place.main, bases, problems }
  })

/** A moved item, and the outdated mark it sets. */
interface Found {
  readonly item: MovedItem
  readonly reason: OutdatedReason
  readonly reference: string
}

const changeSaid = (added: number | null, removed: number | null): string =>
  added === null || removed === null ? 'binary' : `+${String(added)} −${String(removed)}`

/** What changed on the bases since the Freeze: what the Spec writes, and the rest, handed. */
const filesMoved = (
  spec: Spec,
  main: string,
  bases: ReadonlyArray<CheckedBase>,
  reason: OutdatedReason,
) =>
  Effect.gen(function* () {
    const git = yield* Git
    const secrets = yield* Secrets
    const { targets, proofs } = writtenBy(spec)
    // Only what the launch prepares is read by the agent: the rest is not built on.
    const prepared = new Set(
      preparedRepositories(
        spec,
        bases.map((base) => base.repository),
      ),
    )
    const found: Found[] = []
    const handed: HandedItem[] = []
    const patches: HandedPatch[] = []
    const unhanded: UnhandedFile[] = []
    for (const base of bases) {
      if (base.frozen === null || base.frozen === base.commit) continue
      const folder = `${main}/${base.repository}`
      const changes = yield* git.changesBetween(folder, base.frozen, base.commit)
      for (const change of changes) {
        const file = `${base.repository}/${change.path}`
        const kind = targets.has(file) ? 'target' : proofs.has(file) ? 'proof' : null
        if (kind !== null) {
          found.push({
            item: {
              kind,
              repository: base.repository,
              path: change.path,
              status: change.status,
              added: change.added,
              removed: change.removed,
              said: `${file} changed on the base since the Freeze (${changeSaid(change.added, change.removed)}): ${kind === 'target' ? 'a task targets it' : 'a Proof block adds it'}.`,
            },
            reason,
            reference: file,
          })
          continue
        }
        if (!prepared.has(base.repository)) continue
        if (handed.length >= HANDED_MOST) {
          unhanded.push({ repository: base.repository, path: change.path, status: change.status })
          continue
        }
        handed.push({
          repository: base.repository,
          path: change.path,
          kind: handedKindOf(change.path),
          status: change.status,
          answer: null,
        })
        // A sensitive place is handed by its name and status only: its diff is never read.
        const sensitive =
          sensitivePlace(
            change.path,
            { home: homedir(), platform: process.platform },
            { reading: true },
          ) !== null
        patches.push({
          repository: base.repository,
          path: change.path,
          patch: sensitive
            ? ''
            : secrets.mask(yield* git.diffBetween(folder, base.frozen, base.commit, change.path)),
          withheld: sensitive ? SENSITIVE_WITHHELD : null,
        })
      }
    }
    return { found, handed, patches, unhanded }
  })

/** The living requirements and the dependencies' requirements that moved since they were read. */
const requirementsMoved = (
  spec: Spec,
  drift: ReadonlyArray<{
    readonly requirement: string
    readonly livingRef: string
    readonly recorded: number
    readonly current: number | null
  }>,
  dependencies: ReadonlyArray<{ readonly id: string; readonly key: string }>,
) =>
  Effect.gen(function* () {
    const found: Found[] = drift.map((one) => ({
      item: {
        kind: 'requirement',
        repository: null,
        path: null,
        status: null,
        added: null,
        removed: null,
        said:
          one.current === null
            ? `${one.requirement} was written against ${one.livingRef} at version ${String(one.recorded)}: it is removed from the living spec since.`
            : `${one.requirement} was written against ${one.livingRef} at version ${String(one.recorded)}: it is at version ${String(one.current)} now.`,
      },
      reason: 'dependency-merged',
      reference: one.livingRef,
    }))
    const database = yield* Database
    for (const requirement of spec.requirements) {
      if (requirement.removed) continue
      for (const relied of requirement.reliesOn) {
        const dependency = dependencies.find((one) => one.key === relied.dependency)
        if (dependency === undefined) continue
        const [row] = yield* database
          .select({ version: specRequirements.version, removed: specRequirements.removed })
          .from(specRequirements)
          .where(
            and(
              eq(specRequirements.missionId, dependency.id),
              eq(specRequirements.id, relied.requirement),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('reading a dependency’s requirement')))
        const current = row === undefined || row.removed ? null : row.version
        if (current === relied.version) continue
        found.push({
          item: {
            kind: 'relied',
            repository: null,
            path: null,
            status: null,
            added: null,
            removed: null,
            said: `${requirement.id} relies on ${relied.dependency} ${relied.requirement} at version ${String(relied.version)}: ${current === null ? 'it is removed since' : `it is at version ${String(current)} now`}.`,
          },
          reason: 'dependency-merged',
          reference: `${relied.dependency}/${relied.requirement}`,
        })
      }
    }
    return found
  })

/** The linked ticket, when a newer version of it was read since the Spec was built from it. */
const ticketMoved = (missionId: string) =>
  Effect.map(missionTicket(missionId), (ticket): ReadonlyArray<Found> => {
    if (ticket?.base == null || ticket.last === null) return []
    if (ticket.base.fingerprint === ticket.last.fingerprint) return []
    return [
      {
        item: {
          kind: 'ticket',
          repository: null,
          path: null,
          status: null,
          added: null,
          removed: null,
          said: `The ticket ${ticket.key} changed since the Spec was built from it.`,
        },
        reason: 'ticket-changed',
        reference: ticket.key,
      },
    ]
  })

/** The files the Spec writes that were dirty in the main checkout when it was frozen (CT-23). */
const dirtyAtFreeze = (
  spec: Spec,
  dirty: ReadonlyArray<{
    readonly repository: string
    readonly path: string
    readonly status: string
  }>,
): ReadonlyArray<Found> => {
  const { targets, proofs } = writtenBy(spec)
  return dirty
    .filter(
      (one) =>
        targets.has(`${one.repository}/${one.path}`) || proofs.has(`${one.repository}/${one.path}`),
    )
    .map((one) => ({
      item: {
        kind: 'dirty',
        repository: one.repository,
        path: one.path,
        status: one.status,
        added: null,
        removed: null,
        said: dirtyAtFreezeSaid(one.path),
      },
      reason: 'target-moved',
      reference: `dirty:${one.repository}/${one.path}`,
    }))
}

/** The Builder's model as the cascade resolves it now, beside the Planner's recommendation. */
export const builderModel = (missionId: string, spec: Spec) =>
  Effect.gen(function* () {
    const resolved = yield* resolvedSetting({ kind: 'mission', missionId }, BUILDER)
    const recommended = spec.recommendation
    const model: CheckModel = {
      setting: { agent: resolved.agent, model: resolved.model, effort: resolved.effort },
      level: resolved.level,
      recommendation:
        recommended === null
          ? null
          : {
              agent: recommended.agent,
              model: recommended.model,
              effort: recommended.effort,
              reason: recommended.reason,
            },
    }
    return model
  })

/** Everything the check reads, before anything is written. */
const readToday = (missionId: string, mechanical: boolean) =>
  Effect.gen(function* () {
    const { mission, spec, drift, freeze, key } = yield* readMission(missionId)
    if (mission.stage !== 'ready' || !spec.frozen || freeze === null) {
      return yield* refused(
        `${key} is not Ready: only a Ready mission is checked before its launch.`,
      )
    }
    const dependencies = yield* dependenciesNow(missionId)
    const frozen = new Map(freeze.bases.map((base) => [base.repository, base.commit]))
    const { main, bases, problems } = yield* basesNow(missionId, frozen)
    const reason: OutdatedReason = mechanical ? 'dependency-merged' : 'target-moved'
    const files =
      problems.length > 0
        ? { found: [], handed: [], patches: [], unhanded: [] }
        : yield* filesMoved(spec, main, bases, reason)
    const found = [
      ...files.found,
      ...(yield* requirementsMoved(spec, drift, dependencies)),
      ...(yield* ticketMoved(missionId)),
      ...dirtyAtFreeze(spec, freeze.dirtyFiles),
    ]
    const settings = fingerprintOf(yield* sectionsNow({ projectId: mission.projectId, spec }))
    const model = yield* builderModel(missionId, spec)
    const read: CheckRead = {
      specVersion: spec.version,
      bases: bases.map((base) => ({
        repositoryId: base.repositoryId,
        repository: base.repository,
        commit: base.commit,
      })),
      dependencies,
      settings,
    }
    return {
      mission,
      key,
      read,
      problems,
      dependencies,
      bases,
      found,
      handed: mechanical ? [] : files.handed,
      patches: mechanical ? [] : files.patches,
      unhanded: mechanical ? [] : files.unhanded,
      model,
    }
  })

type Today = Effect.Success<ReturnType<typeof readToday>>

/** The steps of a check, each in words; the agent's is said from its state (`store.ts`). */
const stepsOf = (today: Today, mechanical: boolean): ReadonlyArray<CheckStep> => {
  const blocked = today.dependencies.filter(
    (one) => one.stage !== 'done' && one.stage !== 'cancelled',
  )
  const moved = today.found.length
  return [
    {
      step: 'dependencies',
      state: 'done',
      said:
        today.dependencies.length === 0
          ? 'No dependency.'
          : blocked.length > 0
            ? `${today.key} is ${blockedBySaid(blocked.map((one) => one.key))}.`
            : 'Every dependency is Done.',
    },
    {
      step: 'base',
      state: today.problems.length > 0 ? 'failed' : 'done',
      said:
        today.problems.length > 0
          ? today.problems.join('\n')
          : today.bases
              .map(
                (base) =>
                  `${base.repository}: ${short(base.commit)} (${freshnessSaid(base.freshness)})${base.frozen === base.commit ? ', as at the Freeze' : base.frozen === null ? ', new since the Freeze' : `, frozen at ${short(base.frozen)}`}`,
              )
              .join('\n'),
    },
    {
      step: 'moved',
      state: 'done',
      said:
        moved === 0
          ? 'Nothing the Spec relies on moved since the Freeze.'
          : `${String(moved)} thing${moved === 1 ? '' : 's'} the Spec relies on moved since the Freeze.`,
    },
    ...(mechanical
      ? []
      : [
          {
            step: 'handed' as const,
            state: today.handed.length === 0 ? ('skipped' as const) : ('done' as const),
            said:
              today.handed.length === 0
                ? 'Nothing else changed in the targeted repositories.'
                : `${String(today.handed.length)} other file(s) changed: handed to the agent of the check.`,
          },
          {
            step: 'model' as const,
            state: 'done' as const,
            said: `The Builder runs on ${today.model.setting.agent}${today.model.setting.model === null ? '' : ` ${today.model.setting.model}`} (${today.model.level} setting).`,
          },
        ]),
  ]
}

/** The checks of a mission still running, ended because a newer one replaces them. */
const replacedIn = (transaction: EngineTransaction, missionId: string, projectId: string) =>
  Effect.gen(function* () {
    const ended = yield* transaction
      .update(prelaunchChecks)
      .set({ state: 'failed', agentState: 'failed', endedAt: now() })
      .where(and(eq(prelaunchChecks.missionId, missionId), eq(prelaunchChecks.state, 'running')))
      .returning()
      .pipe(Effect.mapError(refusedWhile('replacing a check')))
    return ended.map((row) =>
      checkEvent('building.check_ended', row, projectId, {
        lineage: row.lineage,
        reason: 'a newer check replaces it',
      }),
    )
  })

/** The check, written: its row, the marks of what moved, and its events. */
const writeCheck = (missionId: string, today: Today, mechanical: boolean) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const asksAgent = !mechanical && today.handed.length > 0 && today.problems.length === 0
    const results: CheckResults = {
      steps: stepsOf(today, mechanical),
      dependencies: today.dependencies.map((one): CheckedDependency => ({
        key: one.key,
        stage: one.stage,
        done: one.stage === 'done',
      })),
      bases: today.bases,
      moved: today.found.map((one) => one.item),
      handed: today.handed,
      model: today.model,
      patches: today.patches,
      unhanded: today.unhanded,
      failure: today.problems.length > 0 ? today.problems.join('\n') : null,
    }
    return yield* mutate('keeping the pre-launch check', (transaction) =>
      Effect.gen(function* () {
        const projectId = today.mission.projectId
        const replaced = yield* replacedIn(transaction, missionId, projectId)
        const id = crypto.randomUUID()
        const at = now()
        const ended = !asksAgent
        const [row] = yield* transaction
          .insert(prelaunchChecks)
          .values({
            id,
            missionId,
            kind: mechanical ? 'mechanical' : 'full',
            state: today.problems.length > 0 ? 'failed' : ended ? 'done' : 'running',
            read: writeRead(today.read),
            results: writeResults(results),
            agentState: asksAgent ? 'waiting_for_slot' : 'skipped',
            lineage: asksAgent ? crypto.randomUUID() : null,
            reminded: false,
            summary: null,
            startedAt: at,
            endedAt: ended ? at : null,
          })
          .returning()
          .pipe(Effect.mapError(refusedWhile('keeping the pre-launch check')))
        if (row === undefined) return yield* Effect.die(new Error('the check was not kept'))
        const marked: NewEvent[] = []
        for (const one of today.found) {
          marked.push(
            ...(yield* markOutdatedIn(
              transaction,
              missionId,
              {
                reason: one.reason,
                reference: one.reference,
                difference: one.item.said,
                expiring: [],
              },
              secrets.mask,
            )),
          )
        }
        const payload = {
          kind: row.kind,
          moved: today.found.length,
          handed: today.handed.length,
          blockedBy: results.dependencies
            .filter((one) => !one.done && one.stage !== 'cancelled')
            .map((one) => one.key),
        }
        const events = [
          ...replaced,
          checkEvent('building.check_started', row, projectId, {
            ...payload,
            agent: asksAgent,
            lineage: row.lineage,
          }),
          ...marked,
          ...(ended
            ? [
                checkEvent('building.check_ended', row, projectId, {
                  state: row.state,
                  lineage: null,
                }),
              ]
            : []),
        ]
        return { result: viewOf(row, today.key), events }
      }),
    )
  })

/**
 * The user asks for the check of a Ready mission: everything is read against today, then kept;
 * the agent of the check, when it has files to read, starts after (`runs.ts`). Answers the check
 * as it stands once kept.
 */
export const checkMission = (missionId: string) =>
  oneAtATime(missionId)(
    Effect.gen(function* () {
      const today = yield* readToday(missionId, false)
      return yield* writeCheck(missionId, today, false)
    }),
  )

/**
 * A dependency of a Ready mission reached Done: the mechanical part of the check runs at once,
 * without an agent; what its merge moved marks the mission. Nothing for a mission not Ready.
 */
export const mechanicalCheck = (missionId: string) =>
  oneAtATime(missionId)(
    Effect.gen(function* () {
      const today = yield* readToday(missionId, true).pipe(
        Effect.catchTag('BuildingRefused', () => Effect.succeed(null)),
      )
      if (today === null) return null
      return yield* writeCheck(missionId, today, true)
    }),
  )

/**
 * Why a check no longer holds (CT-25, fourth bullet): a base moved, the Spec's version changed, a
 * dependency's stage changed, or the validation settings changed. Empty while it holds; otherwise
 * `CHECK_EXPIRED`'s details, each named.
 */
export const expiryOf = (missionId: string, read: CheckRead) =>
  Effect.gen(function* () {
    const reasons: string[] = []
    const { mission, spec } = yield* readMission(missionId)
    if (spec.version !== read.specVersion) {
      reasons.push(
        `The Spec changed since the check: version ${String(read.specVersion)}, now ${String(spec.version)}.`,
      )
    }
    const dependencies = yield* dependenciesNow(missionId)
    for (const before of read.dependencies) {
      const after = dependencies.find((one) => one.id === before.id)
      if (after?.stage !== before.stage) {
        reasons.push(
          `${before.key} was ${before.stage} at the check; it is ${after?.stage ?? 'gone'} now.`,
        )
      }
    }
    for (const added of dependencies.filter(
      (one) => !read.dependencies.some((two) => two.id === one.id),
    )) {
      reasons.push(`${added.key} is a new dependency since the check.`)
    }
    const fresh = new Map(read.bases.map((base) => [base.repository, base.commit]))
    const { bases, problems } = yield* basesNow(missionId, fresh)
    reasons.push(...problems)
    for (const base of bases) {
      if (base.frozen === null) {
        reasons.push(`${base.repository} is a new repository since the check.`)
      } else if (base.frozen !== base.commit) {
        reasons.push(
          `The base of ${base.repository} moved: ${short(base.frozen)} at the check, ${short(base.commit)} now.`,
        )
      }
    }
    const settings = fingerprintOf(yield* sectionsNow({ projectId: mission.projectId, spec }))
    if (settings !== read.settings) {
      reasons.push('The validation settings changed since the check.')
    }
    return { reasons, spec, bases }
  })

/** A check of the mission, or `UnknownCheck`. */
export const checkOfMission = (missionId: string, checkId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const row = yield* checkRowIn(database, checkId)
    if (row?.missionId !== missionId) return yield* new UnknownCheck({ id: checkId })
    return row
  })

/** What a check found, said as the Planner reads it on its return to Planning. */
const reportSaid = (row: Parameters<typeof resultsOf>[0]): string => {
  const results = resultsOf(row)
  const answered = results.handed.filter((one) => one.answer !== null)
  return [
    'The pre-launch check found:',
    ...(results.moved.length === 0
      ? ['- nothing moved since the Freeze']
      : results.moved.map((one) => `- ${one.said}`)),
    ...answered.map(
      (one) =>
        `- ${one.repository}/${one.path}: ${one.answer?.matters === true ? 'matters' : 'does not matter'} (${one.answer?.why ?? ''})`,
    ),
    ...(row.summary === null ? [] : [`The agent of the check: ${row.summary}`]),
  ].join('\n')
}

/**
 * Back to Planning from a check: the mission returns to Planning (#92) with the check's report as
 * the reason, handed to the Planner in `[hemera:update]`. Without a check, with no reason.
 */
export const backToPlanningFromCheck = (missionId: string, checkId: string | null) =>
  Effect.gen(function* () {
    const row = checkId === null ? null : yield* checkOfMission(missionId, checkId)
    return yield* returnToPlanning(missionId, row === null ? null : reportSaid(row))
  })

/**
 * The user chooses the Builder's model before the launch: stored at the mission level (null
 * unsets it), the mission's latest check showing it, with `building.model_chosen`.
 */
export const chooseBuilderModel = (missionId: string, setting: ModelSettingValue | null) =>
  Effect.gen(function* () {
    const { mission, spec, key } = yield* readMission(missionId)
    if (mission.stage !== 'ready') {
      return yield* refused(`${key} is not Ready: the Builder’s model is chosen before the launch.`)
    }
    yield* setRoleSetting('mission', missionId, BUILDER, setting)
    const model = yield* builderModel(missionId, spec)
    yield* mutate('choosing the Builder’s model', (transaction) =>
      Effect.gen(function* () {
        const latest = yield* latestCheckRowIn(transaction, missionId)
        if (latest !== null && latest.kind === 'full') {
          yield* transaction
            .update(prelaunchChecks)
            .set({ results: writeResults({ ...resultsOf(latest), model }) })
            .where(eq(prelaunchChecks.id, latest.id))
            .pipe(Effect.mapError(refusedWhile('keeping the model')))
        }
        const event: NewEvent = {
          type: 'building.model_chosen',
          entityKind: 'mission',
          entityId: missionId,
          source: 'ui',
          author: 'human',
          payload: {
            projectId: mission.projectId,
            agent: model.setting.agent,
            model: model.setting.model,
            effort: model.setting.effort,
            level: model.level,
          },
        }
        return { result: undefined, events: [event] }
      }),
    )
    return model
  })
