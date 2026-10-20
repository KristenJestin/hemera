/**
 * Ship (R9): the user's stamp "this mission is good", asked by the window alone. The preview says
 * whether Ship may be confirmed now (`shipRefusals`, every reason at once) and what it will freeze:
 * each repository's files since its base, its branch, its pull request and that pull request's CI,
 * the proofs and final checks a change made since (outside Hemera or not) leaves to redo, the manual
 * proofs not validated, and the preparation as it changed since the mission copied it.
 *
 * A confirmation names the preview it was given on: anything changed since refuses it. It then
 * takes a checkpoint of the candidate trees, runs again every proof and final check whose recorded
 * tree is not the candidate's, and stops when one is red, or when a tree moved while they ran:
 * nothing frozen, the mission still in Review. All green, one transaction freezes the trees, copies
 * the waves and the End, and moves the mission to Shipping with `mission.shipped`; with the Local
 * preset everywhere, the mission is marked delivered at that time. One Ship at a time per mission.
 */

import { createHash } from 'node:crypto'

import {
  type NeedKind,
  type Proof,
  SHIP_CHANGED,
  approvalsRequired,
  shipMovedSaid,
  shipRefusals,
  validateCopies,
} from '@hemera/core/domain'
import {
  type Need,
  type PullRequestCi,
  type ShipManualProof,
  type ShipPreview,
  type ShipProgress,
  ShipRefused,
  type ShipRepository,
  type ShipRerun,
  type Shipped,
  type UnknownMission,
} from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  Context,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { writesIn } from '../building/attempts.ts'
import { Checkpoints } from '../building/checkpoints.ts'
import { TaskChecks, keepCheckResultIn } from '../building/checks.ts'
import { ProofRunner } from '../building/proof-runner.ts'
import {
  type Tree,
  finalChecksIn,
  readTrees,
  setProofIn,
  writeTrees,
} from '../building/proof-store.ts'
import { Snapshots } from '../building/snapshots.ts'
import {
  missionCopies,
  preparationChangedSinceCopy,
  sectionCopier,
  sectionNow,
} from '../delivery-rules.ts'
import { Pushes } from '../delivery/pushes.ts'
import { ForgePort } from '../forges/port.ts'
import { pullRequestStatus } from '../forges/pull-requests.ts'
import type { EventPayload, NewEvent } from '../journal.ts'
import { getMission, moveIn } from '../missions.ts'
import { pendingNeedsOf } from '../needs.ts'
import { readProof } from '../planning/plan.ts'
import { getProject } from '../projects.ts'
import { Secrets } from '../secrets.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import {
  buildingAttempts,
  buildingCheckResults,
  buildings,
  checkpointRepositories,
  missionShips,
  proofRuns,
  reviewFeedback,
  reviewRounds,
  roundScenarios,
  scenarioProofs,
  specProofs,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { Diffs } from './diffs.ts'

/** Where a suite holds a Ship: as the reruns begin, and before the freeze. */
export type ShipMoment = 'rerunning' | 'freezing'

export type ShipHold = (at: ShipMoment) => Effect.Effect<void>

export interface ShipSettings {
  readonly log: Log
  readonly hold?: ShipHold | undefined
}

export interface ShipService {
  readonly preview: (
    missionId: string,
  ) => Effect.Effect<ShipPreview, UnknownMission | DatabaseError>
  readonly confirm: (
    missionId: string,
    previewId: string,
  ) => Effect.Effect<Shipped, UnknownMission | ShipRefused | DatabaseError>
  readonly progress: (
    missionId: string,
  ) => Stream.Stream<ShipProgress, UnknownMission | DatabaseError>
}

export class Ship extends Context.Service<Ship, ShipService>()('Ship') {}

/** The mission moved (a Cancel) between the checks and the freeze. */
const MOVED_MEANWHILE = 'The mission moved meanwhile: nothing was frozen.'

const now = (): string => new Date().toISOString()

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** A final check as Ship names it: `name`, or `name · place` when it ran in a repository. */
const checkLabel = (check: { readonly name: string; readonly place: string }): string =>
  check.place === '' ? check.name : `${check.name} · ${check.place}`

/** A need as Ship's guard reads it: its kind, and what it is about. */
interface NeedSaid {
  readonly kind: NeedKind
  readonly said: string
}

/** How a need is said after its kind's words. */
const needSaid = (need: Need) =>
  Match.value(need.fields).pipe(
    Match.tagsExhaustive({
      Decision: (fields): NeedSaid => ({ kind: 'Decision', said: fields.question }),
      Permission: (fields): NeedSaid => ({ kind: 'Permission', said: fields.asked ?? fields.call }),
      Error: (fields): NeedSaid => ({ kind: 'Error', said: fields.failed }),
      Environment: (fields): NeedSaid => ({ kind: 'Environment', said: fields.missing }),
    }),
  )

/** One check of GitHub's status check rollup: a check run, or a commit status. */
const RollupItem = Schema.Struct({
  status: Schema.optionalKey(Schema.NullOr(Schema.String)),
  conclusion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const readRollup = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ statusCheckRollup: Schema.NullOr(Schema.Array(RollupItem)) }),
  ),
)

const FAILED = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
])

/** A pull request's CI from its rollup: failing first, then pending, else passing; none empty. */
export const ciOf = (items: ReadonlyArray<typeof RollupItem.Type>): PullRequestCi => {
  if (items.length === 0) return 'none'
  const failed = (one: typeof RollupItem.Type) =>
    FAILED.has((one.conclusion ?? '').toUpperCase()) || FAILED.has((one.state ?? '').toUpperCase())
  if (items.some(failed)) return 'failing'
  const pending = (one: typeof RollupItem.Type) =>
    one.state !== undefined && one.state !== null
      ? ['PENDING', 'EXPECTED'].includes(one.state.toUpperCase())
      : (one.status ?? '').toUpperCase() !== 'COMPLETED'
  return items.some(pending) ? 'pending' : 'passing'
}

/** The CI of a pull request read on GitHub now; null on another forge, or when it did not read. */
const ciNow = (repositoryId: string, number: number) =>
  ForgePort.use((port) =>
    port.operate(repositoryId, (target, run) =>
      Effect.gen(function* () {
        if (target.cli !== 'gh') return null
        const answer = yield* run([
          'pr',
          'view',
          String(number),
          ...target.place,
          '--json',
          'statusCheckRollup',
        ])
        if (answer.code !== 0) return null
        return Option.match(readRollup(answer.stdout), {
          onNone: () => null,
          onSome: (read) => ciOf(read.statusCheckRollup ?? []),
        })
      }),
    ),
  ).pipe(Effect.orElseSucceed(() => null))

/** The Building rows of a mission, oldest first. */
const buildingsOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(buildings)
      .where(eq(buildings.missionId, missionId))
      .orderBy(asc(buildings.startedAt))
      .pipe(Effect.mapError(refusedWhile('reading the Buildings')))
  })

/** Each scenario's proof as its latest Building holds it, with the Building. */
const latestProofsOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* buildingsOf(missionId)
    const proofs = yield* database
      .select()
      .from(scenarioProofs)
      .where(
        inArray(
          scenarioProofs.buildingId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(scenarioProofs.rank))
      .pipe(Effect.mapError(refusedWhile('reading the proofs')))
    const latest = new Map<string, (typeof proofs)[number]>()
    for (const building of rows) {
      for (const one of proofs) if (one.buildingId === building.id) latest.set(one.scenario, one)
    }
    return [...latest.values()]
  })

/** A scenario's Proof block: the Spec's, or a round's. */
const proofOf = (missionId: string, scenario: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [spec] = yield* database
      .select({ block: specProofs.block })
      .from(specProofs)
      .where(and(eq(specProofs.missionId, missionId), eq(specProofs.scenarioId, scenario)))
      .pipe(Effect.mapError(refusedWhile('reading a proof')))
    const [round] =
      spec === undefined
        ? yield* database
            .select({ block: roundScenarios.block })
            .from(roundScenarios)
            .where(and(eq(roundScenarios.missionId, missionId), eq(roundScenarios.id, scenario)))
            .pipe(Effect.mapError(refusedWhile('reading a proof')))
        : [spec]
    const block = round?.block ?? null
    return block === null ? null : Option.getOrNull(readProof(block))
  })

/** A proof Ship runs again: its scenario, its Building, and the repositories it is fresh on. */
interface ProofToRedo {
  readonly scenario: string
  readonly buildingId: string
  readonly repositories: ReadonlyArray<string>
}

/** A final check Ship runs again, with the repositories whose tree it no longer matches. */
interface CheckToRedo {
  readonly name: string
  readonly place: string
  readonly repositories: ReadonlyArray<string>
}

/**
 * The automated proofs and final checks whose recorded tree is not the candidate's: a green proof
 * ran on another tree, or one stale with no green run; the latest Building's final checks likewise.
 */
const toRedoOn = (missionId: string, trees: ReadonlyMap<string, string>) =>
  Effect.gen(function* () {
    const database = yield* Database
    const moved = (recorded: ReadonlyArray<Tree>) =>
      recorded
        .filter((one) => trees.has(one.repository) && trees.get(one.repository) !== one.tree)
        .map((one) => one.repository)
    const proofs: ProofToRedo[] = []
    for (const row of yield* latestProofsOf(missionId)) {
      if (row.mode !== 'automated') continue
      if (row.state !== 'green' && row.state !== 'to_rerun') continue
      const [run] =
        row.greenRunId === null
          ? []
          : yield* database
              .select({ trees: proofRuns.trees })
              .from(proofRuns)
              .where(eq(proofRuns.id, row.greenRunId))
              .pipe(Effect.mapError(refusedWhile('reading a proof run')))
      const recorded = readTrees(run?.trees ?? null)
      const touched = moved(recorded)
      if (run !== undefined && touched.length === 0 && row.state === 'green') continue
      const proof = yield* proofOf(missionId, row.scenario)
      const fresh =
        recorded.length > 0
          ? recorded.map((one) => one.repository)
          : proof?.test === undefined || proof === null
            ? [...trees.keys()]
            : [proof.test.repository]
      proofs.push({
        scenario: row.scenario,
        buildingId: row.buildingId,
        repositories: fresh,
      })
    }
    const latest = (yield* buildingsOf(missionId)).at(-1)
    const checks: CheckToRedo[] = []
    if (latest !== undefined) {
      for (const check of yield* finalChecksIn(database, missionId, latest.id)) {
        const touched = moved(check.trees)
        if (touched.length > 0) {
          checks.push({ name: check.name, place: check.place, repositories: touched })
        }
      }
    }
    return { proofs, checks }
  })

/** What a preview read, its id aside: the rest of a confirmation compares it. */
interface Seen {
  readonly preview: ShipPreview
  readonly projectId: string
}

/** Whether every repository of the waves is delivered by the Local preset. */
const allLocal = (copy: { readonly section: string }) =>
  'repositories' in copy &&
  copy.section === 'waves' &&
  Array.isArray(copy.repositories) &&
  copy.repositories.length > 0 &&
  copy.repositories.every((one: { readonly preset: string }) => one.preset === 'local')

const previewOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const mission = yield* getMission(missionId)
    // A mission's Project is never removed while the mission lives.
    const project = yield* getProject(mission.projectId).pipe(
      Effect.catchTag('UnknownProject', Effect.die),
    )
    const idOf = (path: string) => project.repositories.find((one) => one.path === path)?.id ?? path
    const pathOf = (id: string) => project.repositories.find((one) => one.id === id)?.path ?? id
    const diff = yield* Diffs.use((diffs) => diffs.live(missionId))
    const trees = new Map<string, string>()
    for (const one of diff.repositories) if (one.tree !== null) trees.set(one.repository, one.tree)
    const redo = yield* toRedoOn(missionId, trees)
    const rounds = yield* database
      .select({ number: reviewRounds.number, state: reviewRounds.state })
      .from(reviewRounds)
      .where(eq(reviewRounds.missionId, missionId))
      .orderBy(asc(reviewRounds.number))
      .pipe(Effect.mapError(refusedWhile('reading the rounds')))
    const feedback = yield* database
      .select({ kind: reviewFeedback.kind, state: reviewFeedback.state })
      .from(reviewFeedback)
      .where(eq(reviewFeedback.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the feedback')))
    const latest = (yield* buildingsOf(missionId)).at(-1)
    const redChecks =
      latest === undefined
        ? []
        : (yield* finalChecksIn(database, missionId, latest.id)).filter(
            (one) => one.verdict === 'red' && one.upToDate,
          )
    const needs = (yield* pendingNeedsOf([missionId])).get(missionId) ?? []
    // The pushes and their pull requests, as R6 recorded them.
    const pushes = yield* Pushes.use((all) => all.pushes(missionId)).pipe(
      Effect.map((read) => read.repositories),
      Effect.orElseSucceed(() => []),
    )
    const ready = new Set(
      (yield* ForgePort.use((port) => port.status(project.id)).pipe(Effect.orElseSucceed(() => [])))
        .filter((one) => one.state === 'ready')
        .map((one) => one.repositoryId),
    )
    const copies = yield* missionCopies(missionId).pipe(Effect.orElseSucceed(() => []))
    const preparation = copies.find((one) => one.section === 'preparation')
    const approvals = []
    for (const repositoryId of preparation === undefined ? [] : approvalsRequired(preparation)) {
      const push = pushes.find((one) => one.repositoryId === repositoryId)
      const stored = push?.pullRequest ?? null
      const live =
        stored === null || !ready.has(repositoryId)
          ? stored
          : yield* pullRequestStatus(repositoryId, stored.number).pipe(
              Effect.orElseSucceed(() => stored),
            )
      approvals.push({
        repository: pathOf(repositoryId),
        pullRequest: live !== null,
        approved:
          live !== null && (live.approvals.length > 0 || live.reviewDecision === 'APPROVED'),
      })
    }
    const reasons = shipRefusals({
      stage: mission.stage,
      round: mission.round,
      rounds: rounds.flatMap((one) =>
        one.state === 'grilling' || one.state === 'building'
          ? [{ number: one.number, state: one.state }]
          : [],
      ),
      feedback: feedback.flatMap((one) =>
        one.state === 'waiting' && (one.kind === 'remark' || one.kind === 'code')
          ? [{ kind: one.kind, state: one.state }]
          : [],
      ),
      redChecks: redChecks.map((one) => ({ name: one.name, place: one.place })),
      needs: needs.map(needSaid),
      approvals,
    })
    const repositories: ShipRepository[] = []
    for (const one of diff.repositories) {
      const push = pushes.find((row) => row.repositoryId === idOf(one.repository))
      const pullRequest = push?.pullRequest ?? null
      repositories.push({
        repository: one.repository,
        branch: one.branch,
        files: one.files.map((file) => ({
          path: file.path,
          letter: file.letter,
          changedOutside: file.changedOutside !== null,
        })),
        toRedo: {
          proofs: redo.proofs
            .filter((proof) => proof.repositories.includes(one.repository))
            .map((proof) => proof.scenario),
          checks: redo.checks
            .filter((check) => check.repositories.includes(one.repository))
            .map(checkLabel),
        },
        pullRequest:
          pullRequest === null
            ? null
            : {
                number: pullRequest.number,
                url: pullRequest.url,
                ci: ready.has(idOf(one.repository))
                  ? yield* ciNow(idOf(one.repository), pullRequest.number)
                  : null,
              },
      })
    }
    const manualProofs: ShipManualProof[] = []
    for (const row of yield* latestProofsOf(missionId)) {
      if (row.mode !== 'by_hand') continue
      if (row.state === 'to_verify' || row.state === 'refused') {
        manualProofs.push({ scenario: row.scenario, state: row.state })
      }
    }
    const preparationChange = yield* preparationChangedSinceCopy(missionId).pipe(
      Effect.orElseSucceed(() => null),
    )
    const waves =
      copies.find((one) => one.section === 'waves') ??
      (yield* sectionNow(missionId, 'waves').pipe(Effect.orElseSucceed(() => null)))
    const local = waves !== null && allLocal(waves)
    const shown = {
      possible: reasons.length === 0,
      reasons,
      repositories,
      manualProofs,
      preparationChange,
    }
    const previewId = sha256(JSON.stringify({ ...shown, local }))
    const preview: ShipPreview = {
      missionId,
      previewId,
      ...shown,
      delivered: local ? { at: now() } : null,
    }
    return { preview, projectId: project.id } satisfies Seen
  })

const shipEvent = (type: string, missionId: string, payload: EventPayload): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: missionId,
  source: 'ui',
  author: 'human',
  payload,
})

/** Writes the events of a Ship that changes nothing else. */
const told = (events: ReadonlyArray<NewEvent>) =>
  mutate('telling a Ship', () => Effect.succeed({ result: undefined, events }))

export const shipLayer = (settings: ShipSettings) =>
  Layer.effect(
    Ship,
    Effect.gen(function* () {
      const hold = settings.hold ?? (() => Effect.void)
      const turns = new Map<string, Semaphore.Semaphore>()
      const progresses = new Map<string, SubscriptionRef.SubscriptionRef<ShipProgress>>()
      const idle = (missionId: string): ShipProgress => ({
        missionId,
        step: 'idle',
        reruns: [],
        message: null,
      })
      const progressOf = (missionId: string) =>
        Effect.gen(function* () {
          const kept = progresses.get(missionId)
          if (kept !== undefined) return kept
          const made = yield* SubscriptionRef.make(idle(missionId))
          progresses.set(missionId, made)
          return made
        })
      const say = (missionId: string, change: Partial<Omit<ShipProgress, 'missionId'>>) =>
        Effect.flatMap(progressOf(missionId), (ref) =>
          SubscriptionRef.update(ref, (was) => ({ ...was, ...change })),
        )
      const turnOf = (missionId: string) => {
        const kept = turns.get(missionId)
        if (kept !== undefined) return kept
        const made = Semaphore.makeUnsafe(1)
        turns.set(missionId, made)
        return made
      }

      /** Refused or stopped: said, told to the Journal, and nothing else written. */
      const refuse = (missionId: string, reasons: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          yield* say(missionId, { step: 'stopped', message: reasons.join(' ') })
          yield* told([shipEvent('mission.ship_refused', missionId, { reasons: [...reasons] })])
          settings.log(`ship: ${missionId} refused: ${reasons.join(' ')}`)
          return yield* new ShipRefused({ reasons })
        })

      /** Runs a proof again on the candidate trees; whether it is green. */
      const rerunProof = (missionId: string, redo: ProofToRedo, trees: ReadonlyArray<Tree>) =>
        Effect.gen(function* () {
          const proof: Proof | null = yield* proofOf(missionId, redo.scenario)
          if (proof === null) return false
          const run = yield* ProofRunner.use((runner) =>
            runner.run({
              missionId,
              buildingId: redo.buildingId,
              scenario: redo.scenario,
              phase: 'rerun',
              proof,
              repositories: redo.repositories,
              testFile: null,
            }),
          )
          const green = run.classification === 'passed'
          const ranOn = trees.filter((one) => redo.repositories.includes(one.repository))
          yield* mutate('keeping a proof Ship ran again', (transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .update(proofRuns)
                .set({ trees: writeTrees(ranOn) })
                .where(eq(proofRuns.id, run.id))
                .pipe(Effect.mapError(refusedWhile('keeping a proof run')))
              if (green) {
                yield* setProofIn(transaction, redo.buildingId, redo.scenario, {
                  state: 'green',
                  greenRunId: run.id,
                })
              }
              return { result: undefined, events: [] }
            }),
          )
          return green
        })

      /** Runs the final checks again on an attempt of the latest Building; their red ones. */
      const rerunChecks = (missionId: string, trees: ReadonlyArray<Tree>) =>
        Effect.gen(function* () {
          const database = yield* Database
          const latest = (yield* buildingsOf(missionId)).at(-1)
          if (latest === undefined) return []
          const attempts = yield* database
            .select({ id: buildingAttempts.id })
            .from(buildingAttempts)
            .where(
              and(eq(buildingAttempts.buildingId, latest.id), eq(buildingAttempts.scope, 'end')),
            )
            .pipe(Effect.mapError(refusedWhile('reading the attempts')))
          const attemptId = crypto.randomUUID()
          yield* mutate('opening the attempt of Ship', (transaction) =>
            transaction
              .insert(buildingAttempts)
              .values({
                id: attemptId,
                buildingId: latest.id,
                taskId: null,
                scope: 'end',
                subject: null,
                number: attempts.length + 1,
                runner: 'hemera',
                epoch: 0,
                starts: '[]',
                startedAt: now(),
                outside: '[]',
                // Ship's checks never count among the Builder's red attempts.
                counted: false,
              })
              .pipe(
                Effect.mapError(refusedWhile('opening the attempt')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
          const files = new Map<string, { repository: string; path: string }>()
          for (const write of yield* writesIn(database, latest.id)) {
            files.set(`${write.repository}/${write.path}`, {
              repository: write.repository,
              path: write.path,
            })
          }
          const answered = yield* TaskChecks.use((checks) =>
            checks.run({
              missionId,
              buildingId: latest.id,
              scope: 'end',
              subject: null,
              attemptId,
              files: [...files.values()],
            }),
          )
          return yield* mutate('keeping the checks Ship ran again', (transaction) =>
            Effect.gen(function* () {
              // A port that keeps its results as they come (#143) has kept them already.
              const kept = yield* transaction
                .select({ name: buildingCheckResults.name, place: buildingCheckResults.place })
                .from(buildingCheckResults)
                .where(eq(buildingCheckResults.attemptId, attemptId))
                .pipe(Effect.mapError(refusedWhile('reading the checks')))
              for (const result of answered) {
                if (kept.some((one) => one.name === result.name && one.place === result.place)) {
                  continue
                }
                yield* keepCheckResultIn(transaction, attemptId, { ...result, trees })
              }
              const red = answered.filter((one) => one.verdict === 'red')
              yield* transaction
                .update(buildingAttempts)
                .set({
                  endedAt: now(),
                  outcome: red.length > 0 ? 'red' : 'green',
                  verdict: red.length > 0 ? 'red' : 'green',
                })
                .where(eq(buildingAttempts.id, attemptId))
                .pipe(Effect.mapError(refusedWhile('ending the attempt')))
              return { result: red, events: [] }
            }),
          )
        })

      const confirmOf = (missionId: string, previewId: string) =>
        Effect.gen(function* () {
          yield* say(missionId, { step: 'checking', reruns: [], message: null })
          const seen = yield* previewOf(missionId)
          if (seen.preview.reasons.length > 0) {
            return yield* refuse(missionId, seen.preview.reasons)
          }
          if (seen.preview.previewId !== previewId) return yield* refuse(missionId, [SHIP_CHANGED])
          yield* say(missionId, { step: 'checkpoint' })
          const places = yield* Diffs.use((diffs) => diffs.places(missionId))
          if (places === null) {
            return yield* refuse(missionId, ['The Workspace of the mission is not on the disk.'])
          }
          const checkpointId = yield* Checkpoints.use((checkpoints) =>
            checkpoints.take(missionId, 'ship', places),
          ).pipe(
            Effect.catchTag('SnapshotFailed', (failure) =>
              refuse(missionId, [`Ship could not read the Workspace: ${failure.message}`]),
            ),
          )
          const database = yield* Database
          const candidate: ReadonlyArray<Tree> = yield* database
            .select({
              repository: checkpointRepositories.repository,
              tree: checkpointRepositories.tree,
            })
            .from(checkpointRepositories)
            .where(eq(checkpointRepositories.checkpointId, checkpointId))
            .orderBy(asc(checkpointRepositories.position))
            .pipe(Effect.mapError(refusedWhile('reading the checkpoint')))
          const redo = yield* toRedoOn(
            missionId,
            new Map(candidate.map((one) => [one.repository, one.tree])),
          )
          let reruns: ShipRerun[] = [
            ...redo.proofs.map((one) => ({
              kind: 'proof' as const,
              name: one.scenario,
              state: 'waiting' as const,
            })),
            ...(redo.checks.length === 0
              ? []
              : redo.checks.map((one) => ({
                  kind: 'check' as const,
                  name: checkLabel(one),
                  state: 'waiting' as const,
                }))),
          ]
          const moved = (kind: ShipRerun['kind'], name: string, state: ShipRerun['state']) =>
            Effect.suspend(() => {
              reruns = reruns.map((one) =>
                one.kind === kind && one.name === name ? { ...one, state } : one,
              )
              return say(missionId, { reruns })
            })
          yield* say(missionId, { step: 'rerunning', reruns })
          yield* hold('rerunning')
          const reds: string[] = []
          for (const one of redo.proofs) {
            yield* moved('proof', one.scenario, 'running')
            const green = yield* rerunProof(missionId, one, candidate)
            yield* moved('proof', one.scenario, green ? 'green' : 'red')
            if (!green) reds.push(`The proof ${one.scenario} is red.`)
          }
          if (redo.checks.length > 0) {
            for (const one of redo.checks) yield* moved('check', checkLabel(one), 'running')
            const red = yield* rerunChecks(missionId, candidate)
            for (const one of redo.checks) {
              const itsRed = red.some(
                (check) => check.name === one.name && check.place === one.place,
              )
              yield* moved('check', checkLabel(one), itsRed ? 'red' : 'green')
            }
            for (const check of red) {
              reds.push(
                `The final check \`${check.name}\` is red${check.place === '' ? '' : ` in ${check.place}`}.`,
              )
            }
          }
          if (reruns.length > 0) {
            yield* told([
              shipEvent('mission.ship_rerun', missionId, {
                proofs: reruns.filter((one) => one.kind === 'proof').map((one) => one.name),
                checks: reruns.filter((one) => one.kind === 'check').map((one) => one.name),
                red: reruns.filter((one) => one.state === 'red').map((one) => one.name),
              }),
            ])
          }
          // What the reruns ran on must still be what is frozen.
          const changed: string[] = []
          for (const place of places) {
            const tree = yield* Snapshots.use((snapshots) =>
              snapshots.take(
                { name: place.name, folder: place.folder },
                { kind: 'run', missionId, runId: crypto.randomUUID(), side: 'after' },
              ),
            ).pipe(Effect.orElseSucceed(() => null))
            const was = candidate.find((one) => one.repository === place.name)?.tree
            if (tree !== was) changed.push(place.name)
          }
          if (changed.length > 0) return yield* refuse(missionId, changed.map(shipMovedSaid))
          if (reds.length > 0) return yield* refuse(missionId, reds)
          yield* say(missionId, { step: 'freezing' })
          yield* hold('freezing')
          const copyIn = yield* sectionCopier(missionId).pipe(
            Effect.catchTag('UnknownProject', Effect.die),
          )
          const copies = yield* missionCopies(missionId).pipe(Effect.orElseSucceed(() => []))
          const secrets = yield* Secrets
          const mission = yield* getMission(missionId)
          const shippedAt = now()
          // A refusal fails the transaction: the copies it wrote go with it.
          const shipped = yield* mutate('freezing a mission at Ship', (transaction) =>
            Effect.gen(function* () {
              const waves = yield* copyIn(transaction, 'waves')
              const end = yield* copyIn(transaction, 'end')
              const preparation = copies.find((one) => one.section === 'preparation')
              const tasks = copies.find((one) => one.section === 'tasks')
              if (preparation?.section === 'preparation' && waves.copy.section === 'waves') {
                const problems = validateCopies({
                  tasks: tasks?.section === 'tasks' ? tasks : null,
                  preparation,
                  waves: waves.copy,
                })
                if (problems.length > 0) {
                  return yield* new ShipRefused({
                    reasons: problems.map((problem) => problem.sentence),
                  })
                }
              }
              const deliveredAt = allLocal(waves.copy) ? shippedAt : null
              yield* transaction
                .insert(missionShips)
                .values({
                  missionId,
                  checkpointId,
                  trees: writeTrees(candidate),
                  versions: JSON.stringify({ waves: waves.copy.version, end: end.copy.version }),
                  confirmation: secrets.mask(JSON.stringify(seen.preview)),
                  shippedAt,
                  deliveredAt,
                })
                .pipe(Effect.mapError(refusedWhile('freezing the mission')))
              // Written only while the mission is still in Review: a Cancel since refuses it.
              const movedTo = yield* moveIn(
                transaction,
                { id: missionId, stage: 'review', round: mission.round },
                'ship',
                'user',
              )
              const result: Shipped = { missionId, shippedAt, trees: candidate, deliveredAt }
              return {
                result,
                events: [
                  ...waves.events,
                  ...end.events,
                  movedTo,
                  shipEvent('mission.shipped', missionId, {
                    repositories: candidate.map((one) => one.repository),
                    trees: candidate.map((one) => one.tree),
                    deliveredAt,
                  }),
                ],
              }
            }),
          ).pipe(
            Effect.catchTag('MoveRefused', () => refuse(missionId, [MOVED_MEANWHILE])),
            Effect.catchTag('DeliveryRulesUnreadable', (failure) =>
              refuse(missionId, [failure.message]),
            ),
            Effect.catchTag('ShipRefused', (failure) => refuse(missionId, failure.reasons)),
          )
          yield* say(missionId, { step: 'shipped', message: null })
          return shipped
        })

      type Needs =
        | Effect.Services<ReturnType<typeof previewOf>>
        | Effect.Services<ReturnType<typeof confirmOf>>
      const context = yield* Effect.context<Needs>()

      return {
        preview: (missionId) =>
          previewOf(missionId).pipe(
            Effect.map((seen) => seen.preview),
            Effect.provide(context),
          ),
        confirm: (missionId, previewId) =>
          turnOf(missionId)
            .withPermits(1)(confirmOf(missionId, previewId))
            .pipe(Effect.provide(context)),
        progress: (missionId) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* getMission(missionId)
              return SubscriptionRef.changes(yield* progressOf(missionId))
            }).pipe(Effect.provide(context)),
          ),
      } satisfies ShipService
    }),
  )
