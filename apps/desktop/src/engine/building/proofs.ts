/**
 * Red first, then green (#144): every automated scenario of the Spec becomes an acceptance test
 * that must fail first, for the reason the Spec gives; then its tasks build, and the same proof
 * must pass.
 *
 * - **The proofs written back (CT-37).** At the Building's start, before the Builder's first ready
 *   set, Hemera writes each automated scenario's test and support files into the Workspace from
 *   the Proof blocks: a new file whole, an addition merged three ways against the Freeze version,
 *   a command nothing. Each write is an action of Hemera's (so never a change outside Hemera),
 *   attributed to an attempt of scope `proof`. A conflict writes nothing of its scenario: the
 *   Builder is handed it, with the three versions, and integrates the test by hand.
 * - **The red phase.** Each scenario whose test is in place runs its proof (`ProofRunner`), which
 *   is classified (CT-35): a valid red that is what Planning saw is recorded; a valid red unlike it,
 *   or a proof that already passes, holds the tasks covering the scenario on a decision need; an
 *   environment that kept it from running on an environment need with Retry; any other red goes
 *   back to the Builder as an attempt on that proof. A task starts only once every automated
 *   scenario it covers has its red recorded (or is not reproducible).
 * - **The green runs.** Once every task covering a scenario is done (with none, every task of its
 *   requirement), its proof runs again: passed, the scenario is green on the trees of every
 *   repository its tasks wrote; anything else opens an attempt on its proof, open until it is
 *   green, and the proof runs again once the Builder's next write settles, at its next task's end,
 *   on `refresh` or `proof_run`. The end of the Building waits while an automated proof is not
 *   green. A requirement is proven once its automated scenarios are all green and up to date. A
 *   test whose sha256 changed between red and green is shown with both versions. A `proof_run`
 *   before the tasks are done is for information, and judges nothing.
 * - **Written before the red.** The Builder's writes out of the proofs' files while a scenario
 *   still waits for its red are kept for the reviewers.
 * - **Freshness (CT-38).** A green proof whose repository moved since is `to_rerun`
 *   (`proof-store.ts`); `refresh` runs every stale proof and the stale final checks again, on the
 *   current tree; `touched` names those a repository's change touched.
 * - **By hand (CT-36).** A scenario verified by hand is to verify until the user validates or
 *   refuses it, on the trees of the moment; a later change there makes it to verify again.
 * - **Restart.** A recorded red stands; the reds not recorded are run again at the next start, a
 *   conflict not handed over yet is handed over, and the greens due run (a green run recorded but
 *   not judged is judged on its trees).
 */

import {
  DecisionFields,
  EnvironmentFields,
  MissionOwner,
  type Proof,
  PROOF_CLASSES,
  type ProofClass,
  type ProofPhase,
  type ScenarioProofState,
  type ToolArguments,
  addedTestNames,
  addedTests,
  insertedFiles,
  validRed,
} from '@hemera/core/domain'
import { HemeraAuthor, ProofRefused } from '@hemera/ipc'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Effect, Option, Result, Semaphore } from 'effect'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Git } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { putEvidence } from '../memory/evidence.ts'
import { type NeedService, type NeedServices, createNeedIn, withdrawNeed } from '../needs.ts'
import type { DomainEvents } from '../domain-events.ts'
import type { ProfileHome } from '../profile-home.ts'
import { planRows, readProof } from '../planning/plan.ts'
import { missionRow } from '../planning/store.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  buildingAttempts,
  buildingDecisions,
  missions,
  scenarioProofs,
  specProofs,
  specScenarios,
  writesBeforeRed,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import type { WrittenFile } from '../tools/ports.ts'
import { actionDone, beginAction } from '../tools/actions.ts'
import { answered, refusal } from '../tools/files.ts'
import { fingerprintOf } from '../tools/read.ts'
import { mutate } from '../transaction.ts'
import { attributedIn } from './attempts.ts'
import { type Loop, lineageIn, runningOf, taskOfFile } from './loop.ts'
import { fileOf } from './place.ts'
import { type ProofRun, ProofRunner } from './proof-runner.ts'
import {
  currentTreesIn,
  proofsViewIn,
  finalChecksIn,
  modeOf,
  proofRunsIn,
  readTrees,
  requirementProvenIn,
  scenarioProofIn,
  scenarioProofsIn,
  scenarioViewIn,
  setProofIn,
  stateOf,
  upToDate,
  writeTrees,
} from './proof-store.ts'
import { Snapshots } from './snapshots.ts'
import {
  type BuildingBase,
  type BuildingRow,
  type TaskNow,
  activeBuildingIn,
  attemptsIn,
  bases,
  buildingEvent,
  decisionsIn,
  latestBuildingIn,
  now,
  settleIn,
  tasksIn,
} from './tasks.ts'

/** The options of a red unlike Planning's. */
export const ACCEPT_RED = 'Accept this red as the scenario’s red'
export const SEND_BACK = 'Send it back to the Builder'
/** The options of a scenario that already passes. */
export const MORE_INFORMATION = 'More information'
export const NOT_REPRODUCIBLE = 'Not reproducible'
export const CANCEL_MISSION = 'Cancel the mission'

/** The section of the Project's settings where a proof's time limit is set (#321). */
export const PROOF_LIMIT_SECTION = 'checks'

/** The options of the scenarios nothing moves any more, which the end would wait on forever. */
export const TRY_AGAIN = 'Try again'
export const END_WITHOUT = 'End without it'

/** The states of an automated proof the end does not wait on. */
const SETTLED: ReadonlyArray<ScenarioProofState> = [
  'green',
  'to_rerun',
  'not_reproducible',
  'not_proven',
]

/** The kinds of the decisions a proof asks: kept on the Building's decisions. */
export const PROOF_KINDS = [
  'red_mismatch',
  'already_passes',
  'proof_environment',
  'proofs_unproven',
] as const

/** The services the proofs' work runs on, which the Builder provides. */
export type ProofNeeds =
  | Database
  | DomainEvents
  | Secrets
  | Snapshots
  | Git
  | ProofRunner
  | ProfileHome
  | NeedServices
  | Effect.Services<
      Effect.Success<ReturnType<Loop['proofRed']>> extends void
        ? ReturnType<Loop['proofRed']>
        : never
    >

/** What the proofs stand on, from the Builder that holds them. */
export interface ProofParts {
  readonly needs: NeedService
  /** Where a suite holds the proofs (`BuilderHold`). */
  readonly hold: (at: 'greening' | 'handing' | 'greens-due') => Effect.Effect<void>
  /** After a scenario's proof moved: the end judged again, which may wait on it. */
  readonly moved: (building: BuildingRow) => Effect.Effect<void>
  readonly loop: Loop
  readonly said: (line: string) => Effect.Effect<void>
  readonly deliver: (
    building: BuildingRow,
    target: { readonly lineage: string } | { readonly role: string },
    kind: string,
    body: string,
  ) => Effect.Effect<void>
  /** Runs in the background of the Builder's layer: nothing waits for it. */
  readonly background: (effect: Effect.Effect<void, never, ProofNeeds>) => Effect.Effect<void>
}

const basesOf = (building: BuildingRow): ReadonlyArray<BuildingBase> =>
  Option.getOrElse(bases.read(building.bases), () => [])

/** What a classification says to the Builder when the red is not one. */
const notARed = (run: ProofRun): string => {
  const where = run.testPath ?? 'the proof'
  switch (run.classification) {
    case 'test_not_found':
      return `this red is not one: the test is not found (${where})`
    case 'error_before_test':
      return `this red is not one: ${where} did not run (compilation, import, missing dependency or setup)`
    case 'assertion_failed':
      return run.failingFile === null
        ? `this red is not one: no test of ${where} that the proof adds is named among the failures, and Planning's key line is not found`
        : `this red is not one: the assertion that failed is not in the scenario's own test of ${where} (${run.failingTest ?? run.failingFile})`
    case 'environment':
      return 'the environment kept it from running'
    case 'passed':
      return 'it passed'
  }
}

/** A classification in words, for a green run that is not one. */
const CLASS_SAID: Readonly<Record<ProofClass, string>> = {
  assertion_failed: 'an assertion failed',
  test_not_found: 'the test is not found',
  error_before_test: 'the test did not run (compilation, import or setup)',
  environment: 'the environment kept it from running',
  passed: 'it passed',
}

const fenced = (text: string): string => ['```', text, '```'].join('\n')

/** The tasks covering a scenario that a need may hold: those not over. */
const coveringOf = (
  tasks: ReadonlyArray<{
    readonly id: string
    readonly scenarios: ReadonlyArray<string>
    readonly state: string
    readonly replacedBy: ReadonlyArray<string>
  }>,
  scenario: string,
) => tasks.filter((task) => task.scenarios.includes(scenario) && task.replacedBy.length === 0)

/** The repositories a refresh reads now: a snapshot of each, which marks what went stale. */
const snapshotNow = (building: BuildingRow, why: string) =>
  Effect.forEach(
    basesOf(building),
    (base) =>
      Snapshots.use((snapshots) =>
        snapshots.take(
          { name: base.repository, folder: base.folder },
          {
            kind: 'run',
            missionId: building.missionId,
            runId: `${why}-${crypto.randomUUID()}`,
            side: 'before',
          },
        ),
      ).pipe(Effect.map((tree) => ({ repository: base.repository, tree }))),
    { discard: false },
  )

/**
 * The user's verdict on a scenario verified by hand (CT-36): who, when, the note, and the trees
 * of the repositories the tasks covering it changed (every repository when none did).
 */
export const judgeManual = (
  missionId: string,
  scenario: string,
  verdict: 'validated' | 'refused',
  note: string | null,
) =>
  Effect.gen(function* () {
    const database = yield* Database
    const building = yield* latestBuildingIn(database, missionId)
    if (building === null)
      return yield* new ProofRefused({ reason: 'This mission has no Building yet.' })
    const row = yield* scenarioProofIn(database, building.id, scenario)
    if (row === null)
      return yield* new ProofRefused({ reason: `${scenario} has no proof in this Building.` })
    if (modeOf(row) !== 'by_hand') {
      return yield* new ProofRefused({ reason: `${scenario} is proven by its test, not by hand.` })
    }
    const tasks = coveringOf(yield* tasksIn(database, building.id), scenario)
    const changed = new Set<string>()
    for (const attempt of yield* attemptsIn(database, building.id)) {
      if (!tasks.some((task) => task.id === attempt.taskId)) continue
      for (const file of yield* attributedIn(database, attempt.id)) changed.add(file.repository)
    }
    const all = yield* snapshotNow(building, 'manual').pipe(
      Effect.mapError(
        (failure) =>
          new ProofRefused({ reason: `The Workspace could not be read: ${failure.message}` }),
      ),
    )
    const trees = changed.size === 0 ? all : all.filter((one) => changed.has(one.repository))
    const secrets = yield* Secrets
    yield* mutate('keeping a verdict by hand', (transaction) =>
      Effect.gen(function* () {
        yield* setProofIn(transaction, building.id, scenario, {
          state: verdict,
          judgedBy: 'user',
          judgedAt: now(),
          note: note === null ? null : secrets.mask(note),
          trees: writeTrees(trees),
        })
        return {
          result: undefined,
          events: [
            {
              type: verdict === 'validated' ? 'proof.manual_validated' : 'proof.manual_refused',
              entityKind: 'mission',
              entityId: missionId,
              source: 'ui',
              author: 'human',
              payload: { scenario, note: note === null ? null : secrets.mask(note) },
            } satisfies NewEvent,
          ],
        }
      }),
    )
    const after = yield* scenarioProofIn(database, building.id, scenario)
    return yield* scenarioViewIn(database, missionId, after ?? row)
  })

/** The mission's proofs, red then green, as its latest Building has them (R10); null before one. */
export const proofsRead = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        yield* missionRow(transaction, missionId)
        const building = yield* latestBuildingIn(transaction, missionId)
        return building === null ? null : yield* proofsViewIn(transaction, missionId, building.id)
      }),
    )
  })

export const buildingProofs = (parts: ProofParts) => {
  const { loop, said, deliver } = parts
  // One proof of a mission judged at a time: a state is read and moved without another run of
  // the same mission in between.
  const turns = new Map<string, Semaphore.Semaphore>()
  /** Each mission's proofs running or waiting for their turn: none is stuck meanwhile (#258). */
  const proving = new Map<string, number>()
  /** The Buildings whose stuck scenarios were not judged while a proof ran: judged once it ends. */
  const unjudged = new Map<string, BuildingRow>()
  const begin = (missionId: string) =>
    Effect.sync(() => {
      proving.set(missionId, (proving.get(missionId) ?? 0) + 1)
    })
  const done = (missionId: string) =>
    Effect.suspend(() => {
      const left = (proving.get(missionId) ?? 1) - 1
      if (left > 0) {
        proving.set(missionId, left)
        return Effect.void
      }
      proving.delete(missionId)
      const building = unjudged.get(missionId)
      if (building === undefined) return Effect.void
      unjudged.delete(missionId)
      return parts.background(parts.moved(building))
    })
  const inTurn = <A, E, R>(missionId: string, effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      begin(missionId),
      () =>
        Effect.suspend(() => {
          const turn = turns.get(missionId) ?? Semaphore.makeUnsafe(1)
          turns.set(missionId, turn)
          return Semaphore.withPermits(turn, 1)(effect)
        }),
      () => done(missionId),
    )

  /** The Proof block of a scenario, as the Spec keeps it, or null. */
  const proofOf = (missionId: string, scenario: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      const [row] = yield* database
        .select({ block: specProofs.block })
        .from(specProofs)
        .where(and(eq(specProofs.missionId, missionId), eq(specProofs.scenarioId, scenario)))
        .pipe(Effect.mapError(refusedWhile('reading a proof')))
      return row === undefined ? null : Option.getOrNull(readProof(row.block))
    })

  /** The repository and path of every file the mission's proofs insert. */
  const proofFilesIn = (transaction: EngineTransaction, missionId: string) =>
    Effect.map(
      transaction
        .select({ block: specProofs.block })
        .from(specProofs)
        .where(eq(specProofs.missionId, missionId))
        .pipe(Effect.mapError(refusedWhile('reading the proofs'))),
      (rows) =>
        new Set(
          rows.flatMap((row) =>
            Option.match(readProof(row.block), {
              onNone: () => [],
              onSome: (proof) =>
                insertedFiles(proof).map((file) => `${file.repository}\u0000${file.path}`),
            }),
          ),
        ),
    )

  /** The folder of a repository of the Workspace, or null. */
  const folderOf = (building: BuildingRow, repository: string) =>
    basesOf(building).find((one) => one.repository === repository)?.folder ?? null

  /**
   * Whether a proof's test is in the Workspace: always for a command with no test file; for an
   * addition, once the tests it adds are found in the file (a conflict integrated by hand).
   */
  const inPlace = (building: BuildingRow, proof: Proof) => {
    const test = proof.test
    if (test === undefined) return true
    const folder = folderOf(building, test.repository)
    const path = folder === null ? null : join(folder, test.path)
    if (path === null || !existsSync(path)) return false
    if (test.insertion !== 'addition') return true
    const text = readFileSync(path, 'utf8')
    const names = addedTestNames({
      insertion: test.insertion,
      code: test.code,
      patch: test.patch ?? null,
    })
    const added =
      names.length > 0
        ? names
        : (test.patch ?? '')
            .split('\n')
            .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
            .map((line) => line.slice(1).trim())
            .filter((line) => line !== '')
    return added.every((one) => text.includes(one))
  }

  /**
   * The repositories a scenario's proof is fresh on: its test's (every one for a command with no
   * test file), and every repository the tasks covering it wrote.
   */
  const repositoriesOf = (building: BuildingRow, scenario: string, proof: Proof) =>
    Effect.gen(function* () {
      if (proof.test === undefined) return basesOf(building).map((one) => one.repository)
      const database = yield* Database
      const tasks = coveringOf(yield* tasksIn(database, building.id), scenario)
      const found = new Set([proof.test.repository])
      for (const attempt of yield* attemptsIn(database, building.id)) {
        if (!tasks.some((task) => task.id === attempt.taskId)) continue
        for (const file of yield* attributedIn(database, attempt.id)) found.add(file.repository)
      }
      return [...found]
    })

  /** A scenario's proof run, on the repositories it is fresh on. */
  const runOf = (building: BuildingRow, scenario: string, phase: ProofPhase, proof: Proof) =>
    Effect.gen(function* () {
      const repositories = yield* repositoriesOf(building, scenario, proof)
      return yield* ProofRunner.use((runner) =>
        runner.run({
          missionId: building.missionId,
          buildingId: building.id,
          scenario,
          phase,
          proof,
          repositories,
        }),
      )
    })

  // ---- The start.

  /** Each scenario of the frozen Spec with its Proof block, in the Building's first transaction. */
  const setUpIn = (transaction: EngineTransaction, building: BuildingRow) =>
    Effect.gen(function* () {
      const { proofs } = yield* planRows(transaction, building.missionId)
      const scenarios = yield* transaction
        .select({ id: specScenarios.id, requirement: specScenarios.requirementId })
        .from(specScenarios)
        .where(
          and(eq(specScenarios.missionId, building.missionId), eq(specScenarios.removed, false)),
        )
        .orderBy(asc(specScenarios.rank))
        .pipe(Effect.mapError(refusedWhile('reading the scenarios')))
      for (const [rank, scenario] of scenarios.entries()) {
        const kept = proofs.get(scenario.id)
        if (kept === undefined) continue
        const automated = kept.proof.mode === 'automated'
        yield* transaction
          .insert(scenarioProofs)
          .values({
            buildingId: building.id,
            scenario: scenario.id,
            requirement: scenario.requirement,
            rank,
            mode: kept.proof.mode,
            state: automated ? 'waiting_red' : 'to_verify',
            updatedAt: now(),
          })
          .onConflictDoNothing()
          .pipe(Effect.mapError(refusedWhile('setting up the proofs')))
      }
    })

  /** One file a proof inserts, as it goes into the Workspace: written, already there, or a conflict. */
  type Placed =
    | {
        readonly kind: 'write'
        readonly path: string
        readonly content: string
        readonly status: 'A' | 'M'
      }
    | { readonly kind: 'there' }
    | { readonly kind: 'conflict'; readonly said: string; readonly versions: string }

  const placeFile = (
    building: BuildingRow,
    file: {
      readonly repository: string
      readonly path: string
      readonly insertion: 'new_file' | 'addition'
      readonly content: string | null
      readonly patch: string | null
      readonly against: string | null
    },
  ) =>
    Effect.gen(function* () {
      const base = basesOf(building).find((one) => one.repository === file.repository)
      const named = `${file.repository}/${file.path}`
      if (base === undefined) {
        return {
          kind: 'conflict',
          said: `${named}: the Workspace has no repository ${file.repository}`,
          versions: '',
        } satisfies Placed
      }
      const path = join(base.folder, file.path)
      const ours = existsSync(path) ? readFileSync(path, 'utf8') : null
      if (file.insertion === 'new_file') {
        const content = file.content ?? ''
        if (ours === null) return { kind: 'write', path, content, status: 'A' } satisfies Placed
        if (ours === content) return { kind: 'there' } satisfies Placed
        return {
          kind: 'conflict',
          said: `${named} already exists in the Workspace (the base moved since the Freeze): the new file was not written over it`,
          versions: [
            `## The Workspace's ${named}`,
            fenced(ours),
            `## The proof's ${named}`,
            fenced(content),
          ].join('\n\n'),
        } satisfies Placed
      }
      if (ours === null) {
        return {
          kind: 'conflict',
          said: `${named} is not in the Workspace: the addition has nothing to go into`,
          versions: '',
        } satisfies Placed
      }
      const merged = yield* Git.use((git) =>
        git.mergeAddition(
          base.folder,
          file.against ?? base.commit,
          file.path,
          file.patch ?? '',
          ours,
        ),
      ).pipe(Effect.result)
      if (Result.isFailure(merged)) {
        return {
          kind: 'conflict',
          said: `${named}: the addition could not be merged: ${merged.failure.message}`,
          versions: '',
        } satisfies Placed
      }
      const { base: freeze, theirs, merged: text, clean } = merged.success
      if (!clean) {
        return {
          kind: 'conflict',
          said: `${named} changed since the Freeze and the test's addition does not merge into it`,
          versions: [
            `## ${named} at the Freeze`,
            fenced(freeze),
            `## ${named} in the Workspace`,
            fenced(ours),
            `## ${named} with the proof's addition`,
            fenced(theirs),
            '## The merge',
            fenced(text),
          ].join('\n\n'),
        } satisfies Placed
      }
      return text === ours
        ? ({ kind: 'there' } satisfies Placed)
        : ({ kind: 'write', path, content: text, status: 'M' } satisfies Placed)
    })

  /** The files a proof inserts, each with what goes into it. */
  const filesOf = (proof: Proof) =>
    insertedFiles(proof).map((file, at) => {
      const support =
        file.field === 'test'
          ? null
          : (proof.support_files ?? [])[at - (proof.test === undefined ? 0 : 1)]
      return {
        repository: file.repository,
        path: file.path,
        insertion: file.insertion,
        content: file.field === 'test' ? (proof.test?.code ?? null) : (support?.content ?? null),
        patch: file.patch,
        against: file.field === 'test' ? (proof.test?.against ?? null) : (support?.against ?? null),
      }
    })

  /** A file written by Hemera: its intent, the write, its outcome, so it is never the user's. */
  const writeFile = (building: BuildingRow, path: string, content: string) =>
    Effect.gen(function* () {
      const before = existsSync(path) ? fingerprintOf(readFileSync(path)) : null
      const bytes = Buffer.from(content, 'utf8')
      const id = yield* beginAction(
        'file.write',
        { kind: 'mission', missionId: building.missionId, taskId: null },
        { path, before, after: fingerprintOf(bytes) },
      )
      yield* Effect.sync(() => {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, bytes)
      })
      yield* actionDone(id, 'written by Hemera: a proof')
    })

  /**
   * Writes every automated scenario's test and support files into the Workspace (CT-37), once: a
   * Building whose proofs were written writes nothing again. Each conflict is handed to the Builder.
   */
  const writeProofs = (building: BuildingRow) =>
    Effect.gen(function* () {
      const database = yield* Database
      const attempts = yield* attemptsIn(database, building.id)
      if (attempts.some((one) => one.scope === 'proof' && one.subject === null)) return
      const rows = (yield* scenarioProofsIn(database, building.id)).filter(
        (row) => modeOf(row) === 'automated',
      )
      const written: Array<{ repository: string; path: string; status: 'A' | 'M' }> = []
      const conflicts: Array<{ scenario: string; said: string; versions: string }> = []
      const scenarios: string[] = []
      for (const row of rows) {
        const proof = yield* proofOf(building.missionId, row.scenario)
        if (proof === null) continue
        const files = filesOf(proof)
        const placed: Array<{ file: (typeof files)[number]; placed: Placed }> = []
        for (const file of files) placed.push({ file, placed: yield* placeFile(building, file) })
        const conflict = placed.find((one) => one.placed.kind === 'conflict')
        if (conflict !== undefined && conflict.placed.kind === 'conflict') {
          conflicts.push({
            scenario: row.scenario,
            said: conflict.placed.said,
            versions: conflict.placed.versions,
          })
          continue
        }
        for (const { file, placed: one } of placed) {
          if (one.kind !== 'write') continue
          yield* writeFile(building, one.path, one.content)
          written.push({ repository: file.repository, path: file.path, status: one.status })
        }
        if (files.length > 0) scenarios.push(row.scenario)
      }
      // Nothing to write: no record of it either, and nothing to write at the next start.
      if (rows.length === 0) return
      const at = now()
      yield* mutate('keeping the proofs written', (transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .insert(buildingAttempts)
            .values({
              id: crypto.randomUUID(),
              buildingId: building.id,
              taskId: null,
              scope: 'proof',
              subject: null,
              number: 1,
              runner: 'hemera',
              epoch: 0,
              starts: '[]',
              startedAt: at,
              endedAt: at,
              outcome: 'written',
              outside: '[]',
              files: JSON.stringify(
                written.map((one) => ({
                  repository: one.repository,
                  path: one.path,
                  status: one.status,
                  added: null,
                  removed: null,
                  outside: false,
                })),
              ),
            })
            .pipe(Effect.mapError(refusedWhile('keeping the proofs written')))
          return {
            result: undefined,
            events: [
              buildingEvent(building.missionId, 'building.proofs_written', {
                scenarios,
                conflicts: conflicts.map((one) => one.scenario),
              }),
            ],
          }
        }),
      )
      if (conflicts.length > 0) yield* parts.hold('handing')
      for (const conflict of conflicts) yield* handOver(building, conflict)
    })

  /** A proof that did not merge, handed to the Builder with its versions kept as evidence. */
  const handOver = (
    building: BuildingRow,
    conflict: { readonly scenario: string; readonly said: string; readonly versions: string },
  ) =>
    Effect.gen(function* () {
      const evidence = yield* putEvidence({
        missionId: building.missionId,
        content: { text: conflict.versions === '' ? conflict.said : conflict.versions },
        name: `${conflict.scenario} · the test that did not merge`,
        about: `proof ${conflict.scenario}`,
        author: HemeraAuthor.make({}),
      }).pipe(
        Effect.map((item) => item.id),
        Effect.orElseSucceed(() => null),
      )
      yield* loop.proofRed(
        building,
        conflict.scenario,
        {
          name: 'proof',
          detail: `the test could not be written: ${conflict.said}${evidence === null ? '' : ` (evidence ${evidence})`}`,
          outputTail: conflict.versions,
          runId: null,
        },
        `Integrate the test by hand, exactly as the Spec gives it, then call proof_run(${conflict.scenario}).`,
      )
    })

  /**
   * At a start: each conflict the proofs' write found and a stop kept from being handed over (no
   * attempt on its proof, its test still not in place) is handed to the Builder now.
   */
  const handOverLeft = (building: BuildingRow) =>
    Effect.gen(function* () {
      const database = yield* Database
      const attempts = yield* attemptsIn(database, building.id)
      if (!attempts.some((one) => one.scope === 'proof' && one.subject === null)) return
      for (const row of yield* scenarioProofsIn(database, building.id)) {
        if (modeOf(row) !== 'automated' || stateOf(row) !== 'waiting_red') continue
        if (attempts.some((one) => one.scope === 'proof' && one.subject === row.scenario)) continue
        const proof = yield* proofOf(building.missionId, row.scenario)
        if (proof === null || inPlace(building, proof)) continue
        for (const file of filesOf(proof)) {
          const placed = yield* placeFile(building, file)
          if (placed.kind !== 'conflict') continue
          yield* handOver(building, {
            scenario: row.scenario,
            said: placed.said,
            versions: placed.versions,
          })
          break
        }
      }
    })

  // ---- The red phase.

  /** The mission's owner of a need, its Project named. */
  const ownerOf = (building: BuildingRow) =>
    Effect.gen(function* () {
      const database = yield* Database
      const [mission] = yield* database
        .select({ projectId: missions.projectId })
        .from(missions)
        .where(eq(missions.id, building.missionId))
        .pipe(Effect.mapError(refusedWhile('reading the mission')))
      return MissionOwner.make({
        projectId: mission?.projectId ?? '',
        missionId: building.missionId,
        taskId: null,
      })
    })

  /** A red recorded on a scenario: its tasks may start. */
  const recordedIn = (
    transaction: EngineTransaction,
    building: BuildingRow,
    scenario: string,
    runId: string,
  ) =>
    Effect.gen(function* () {
      yield* setProofIn(transaction, building.id, scenario, {
        state: 'red_recorded',
        redRunId: runId,
        heldRunId: null,
        needId: null,
      })
      return [buildingEvent(building.missionId, 'building.red_recorded', { scenario })]
    })

  /** A need on a scenario's red: the tasks covering it held until the user answers. */
  const held = (
    building: BuildingRow,
    scenario: string,
    run: ProofRun,
    asked: {
      readonly kind: (typeof PROOF_KINDS)[number]
      readonly fields: typeof DecisionFields.Type | typeof EnvironmentFields.Type
      readonly question: string
      readonly options: ReadonlyArray<string>
      readonly event: NewEvent | null
    },
  ) =>
    Effect.gen(function* () {
      const write = yield* createNeedIn(parts.needs, yield* ownerOf(building), asked.fields)
      yield* mutate('holding a scenario on a need', (transaction) =>
        Effect.gen(function* () {
          const current = yield* scenarioProofIn(transaction, building.id, scenario)
          if (current === null || stateOf(current) !== 'waiting_red')
            return { result: undefined, events: [] }
          if ((yield* activeBuildingIn(transaction, building.missionId))?.id !== building.id) {
            return { result: undefined, events: [] }
          }
          const tasks = coveringOf(yield* tasksIn(transaction, building.id), scenario)
            .filter(
              (task) =>
                task.state !== 'done' && task.state !== 'skipped' && task.state !== 'blocked',
            )
            .map((task) => task.id)
          const made = yield* loop.hemeraNeedIn(transaction, building, write, {
            kind: asked.kind,
            tasks,
            question: asked.question,
            options: asked.options,
            proposer: null,
            scope: { scope: 'proof', subject: scenario },
          })
          yield* setProofIn(transaction, building.id, scenario, {
            state: 'held',
            heldRunId: run.id,
            needId: made.needId,
          })
          return {
            result: undefined,
            events: [...(asked.event === null ? [] : [asked.event]), ...made.events],
          }
        }),
      )
    })

  /** A red phase's run judged (CT-35): recorded, held on a need, or handed back to the Builder. */
  const judgeRed = (building: BuildingRow, scenario: string, proof: Proof, run: ProofRun) =>
    Effect.gen(function* () {
      const secrets = yield* Secrets
      if (run.classification === 'passed') {
        const question = `${scenario} already passes before any fix: its proof should fail first.\n\nThe run:\n${fenced(run.outputTail)}\n\nWrite more information for the Builder, set the scenario aside as not reproducible, or cancel the mission.`
        return yield* held(building, scenario, run, {
          kind: 'already_passes',
          question,
          options: [MORE_INFORMATION, NOT_REPRODUCIBLE, CANCEL_MISSION],
          fields: DecisionFields.make({
            question,
            options: [MORE_INFORMATION, NOT_REPRODUCIBLE, CANCEL_MISSION],
            recommended: null,
          }),
          event: buildingEvent(building.missionId, 'building.already_passes', { scenario }),
        })
      }
      if (run.classification === 'environment' && run.timedOutAfter !== null) {
        // Ended at the Project's limit (#321): either it never ends by design, or it needs longer.
        const minutes = `${String(run.timedOutAfter)} minute${run.timedOutAfter === 1 ? '' : 's'}`
        const missing = `${scenario}'s proof ran past the Project's limit of ${minutes}: Hemera ended it.\n${fenced(run.outputTail)}`
        return yield* held(building, scenario, run, {
          kind: 'proof_environment',
          question: missing,
          options: [],
          fields: EnvironmentFields.make({
            missing,
            action: [
              'If its command never ends on its own (a watch mode, such as vitest without run), the command must change; it is written in the frozen Spec, which a launched mission cannot change.',
              'Otherwise raise the limit in the Checks settings of the Project, then Retry: Hemera runs the proof again.',
            ].join(' '),
            settingsSection: PROOF_LIMIT_SECTION,
          }),
          event: null,
        })
      }
      if (run.classification === 'environment') {
        const missing = `${scenario}'s proof could not run: the environment kept it from running.\n${fenced(run.outputTail)}`
        return yield* held(building, scenario, run, {
          kind: 'proof_environment',
          question: missing,
          options: [],
          fields: EnvironmentFields.make({
            missing,
            action:
              'Fix what it says (a service, a port), then Retry: Hemera runs the proof again.',
            settingsSection: null,
          }),
          event: null,
        })
      }
      const test = proof.test
      const names =
        test === undefined
          ? []
          : addedTests({
              insertion: test.insertion,
              code: test.code,
              patch: test.patch ?? null,
            })
      if (validRed(run, test?.path ?? null, names, run.keyLineMatched)) {
        if (run.keyLineMatched === false) {
          const question = [
            `${scenario}'s red is not the one Planning saw.`,
            `Planning observed (key line: ${secrets.mask(proof.key_line ?? '')}):`,
            fenced(secrets.mask(proof.observed ?? '')),
            'Now:',
            fenced(run.outputTail),
          ].join('\n\n')
          return yield* held(building, scenario, run, {
            kind: 'red_mismatch',
            question,
            options: [ACCEPT_RED, SEND_BACK],
            fields: DecisionFields.make({
              question,
              options: [ACCEPT_RED, SEND_BACK],
              recommended: null,
            }),
            event: buildingEvent(building.missionId, 'building.red_mismatch', { scenario }),
          })
        }
        yield* mutate('recording a red', (transaction) =>
          Effect.gen(function* () {
            const current = yield* scenarioProofIn(transaction, building.id, scenario)
            if (current === null || stateOf(current) !== 'waiting_red')
              return { result: undefined, events: [] }
            const events = yield* recordedIn(transaction, building, scenario, run.id)
            const settled = yield* settleIn(transaction, building)
            return { result: undefined, events: [...events, ...settled.events] }
          }),
        )
        return
      }
      yield* mutate('saying a red is not one', () =>
        Effect.succeed({
          result: undefined,
          events: [
            buildingEvent(building.missionId, 'building.red_invalid', {
              scenario,
              classification: run.classification,
            }),
          ],
        }),
      )
      yield* loop.proofRed(
        building,
        scenario,
        { name: 'proof', detail: notARed(run), outputTail: run.outputTail, runId: run.runId },
        `Fix the setup, never the expected result, then call proof_run(${scenario}).`,
      )
    })

  /** One scenario's red run and judged, if its proof is in place and it still waits for it. */
  const redOf = (building: BuildingRow, scenario: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      const row = yield* scenarioProofIn(database, building.id, scenario)
      if (row === null || stateOf(row) !== 'waiting_red') return null
      const proof = yield* proofOf(building.missionId, scenario)
      if (proof === null || !inPlace(building, proof)) return null
      const run = yield* runOf(building, scenario, 'red', proof)
      if ((yield* activeBuildingIn(database, building.missionId))?.id !== building.id) return run
      yield* judgeRed(building, scenario, proof, run)
      // A red recorded once its tasks are done (a proof the Builder fixed late) runs its green.
      const after = yield* scenarioProofIn(database, building.id, scenario)
      if (
        after !== null &&
        stateOf(after) === 'red_recorded' &&
        greenDue(yield* tasksIn(database, building.id), scenario, after.requirement)
      ) {
        yield* greenOf(building, scenario, 'green')
      }
      yield* parts.background(parts.moved(building))
      return run
    })

  /**
   * The red phase: each scenario waiting for its red, its proof in place and not handed to the
   * Builder, run in the Spec's order. One handed to the Builder (a conflict, a red that was not
   * one) runs again only when the Builder calls `proof_run`.
   */
  const redPhase = (building: BuildingRow) =>
    inTurn(
      building.missionId,
      Effect.gen(function* () {
        const database = yield* Database
        const attempts = yield* attemptsIn(database, building.id)
        for (const row of yield* scenarioProofsIn(database, building.id)) {
          if (modeOf(row) !== 'automated' || stateOf(row) !== 'waiting_red') continue
          if (attempts.some((one) => one.scope === 'proof' && one.subject === row.scenario))
            continue
          if ((yield* activeBuildingIn(database, building.missionId))?.id !== building.id) return
          yield* redOf(building, row.scenario)
        }
      }),
    )

  /** At the start of a Building: its proofs written, then its red phase in the background. */
  const started = (building: BuildingRow) =>
    Effect.gen(function* () {
      yield* writeProofs(building).pipe(
        Effect.catchCause((cause) => said(`the proofs were not written: ${String(cause)}`)),
      )
      yield* parts.background(
        redPhase(building).pipe(
          Effect.catchCause((cause) => said(`the red phase stopped: ${String(cause)}`)),
        ),
      )
    })

  // ---- The green runs.

  /**
   * Whether a scenario's green is due: every task covering it done; with none, every task of its
   * requirement; with none either, every task of the plan.
   */
  const greenDue = (tasks: ReadonlyArray<TaskNow>, scenario: string, requirement: string) => {
    const live = tasks.filter((task) => task.replacedBy.length === 0 && task.state !== 'skipped')
    const covering = live.filter((task) => task.scenarios.includes(scenario))
    const ofRequirement = live.filter((task) => task.requirements.includes(requirement))
    const due = covering.length > 0 ? covering : ofRequirement.length > 0 ? ofRequirement : live
    return due.every((task) => task.state === 'done')
  }

  /**
   * A green recorded from a run that passed, in one transaction: the scenario green on that run's
   * trees, its open attempt closed green. When a repository moved since the run, it is `to_rerun`
   * instead: a green is never recorded on a tree that is no longer the current one.
   */
  const recordGreen = (
    building: BuildingRow,
    scenario: string,
    run: {
      readonly id: string
      readonly testPath: string | null
      readonly testSha256: string | null
      readonly testEvidenceId: string | null
      readonly trees: ReadonlyArray<{ readonly repository: string; readonly tree: string }>
    },
  ) =>
    Effect.gen(function* () {
      const green = yield* mutate('recording a green', (transaction) =>
        Effect.gen(function* () {
          const row = yield* scenarioProofIn(transaction, building.id, scenario)
          if (row === null) return { result: false, events: [] }
          if (stateOf(row) !== 'red_recorded' && stateOf(row) !== 'to_rerun') {
            return { result: false, events: [] }
          }
          if (!upToDate(run.trees, yield* currentTreesIn(transaction, building.missionId))) {
            yield* setProofIn(transaction, building.id, scenario, { state: 'to_rerun' })
            return { result: false, events: [] }
          }
          yield* setProofIn(transaction, building.id, scenario, {
            state: 'green',
            greenRunId: run.id,
          })
          yield* transaction
            .update(buildingAttempts)
            .set({ endedAt: now(), outcome: 'green', verdict: 'green' })
            .where(
              and(
                eq(buildingAttempts.buildingId, building.id),
                isNull(buildingAttempts.taskId),
                eq(buildingAttempts.scope, 'proof'),
                eq(buildingAttempts.subject, scenario),
                isNull(buildingAttempts.endedAt),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('closing the attempt')))
          const red = (yield* proofRunsIn(transaction, building.id)).find(
            (one) => one.id === row.redRunId,
          )
          const events: NewEvent[] = [
            buildingEvent(building.missionId, 'building.scenario_green', { scenario }),
          ]
          if (red !== undefined && red.testSha256 !== run.testSha256) {
            events.push(
              buildingEvent(building.missionId, 'building.proof_test_changed', {
                scenario,
                path: run.testPath,
                before: red.testEvidenceId,
                after: run.testEvidenceId,
              }),
            )
          }
          if (
            yield* requirementProvenIn(
              transaction,
              building.missionId,
              building.id,
              row.requirement,
            )
          ) {
            events.push(
              buildingEvent(building.missionId, 'building.requirement_proven', {
                requirement: row.requirement,
              }),
            )
          }
          return { result: true, events }
        }),
      )
      // In the background: the end it may call takes the mission's turn on the proofs again
      // (#147 refreshes them), which this green may still hold.
      if (green) yield* parts.background(parts.moved(building))
    })

  /**
   * A green that failed: an attempt on its proof, open until it is green, on the trees of every
   * repository now, so that a fix anywhere runs it again.
   */
  const failedGreen = (
    building: BuildingRow,
    scenario: string,
    run: {
      readonly classification: ProofClass
      readonly outputTail: string
      readonly runId: string | null
    },
  ) =>
    Effect.gen(function* () {
      const current = yield* currentTreesIn(yield* Database, building.missionId)
      yield* loop.proofRed(
        building,
        scenario,
        {
          name: 'proof',
          detail: `${scenario}'s proof is not green: ${CLASS_SAID[run.classification]}`,
          outputTail: run.outputTail,
          runId: run.runId,
        },
        `Fix it in the tasks covering ${scenario}, never in its test: Hemera runs it again once your next write settles, at your next task_finished, or when you call proof_run(${scenario}).`,
        writeTrees([...current].map(([repository, tree]) => ({ repository, tree }))),
      )
    })

  /**
   * A scenario's proof run once its tasks are done: green on its tree when it passes; otherwise an
   * attempt on its proof, open until it is green, for the Builder. A scenario set aside as not
   * reproducible is run for information only.
   */
  const greenOf = (building: BuildingRow, scenario: string, phase: ProofPhase) =>
    Effect.gen(function* () {
      const database = yield* Database
      const proof = yield* proofOf(building.missionId, scenario)
      if (proof === null) return null
      const run = yield* runOf(building, scenario, phase, proof)
      yield* parts.hold('greening')
      const row = yield* scenarioProofIn(database, building.id, scenario)
      if (row === null || stateOf(row) === 'not_reproducible') return run
      if ((yield* activeBuildingIn(database, building.missionId))?.id !== building.id) return run
      if (run.classification !== 'passed') {
        yield* failedGreen(building, scenario, run)
        yield* parts.background(parts.moved(building))
        return run
      }
      yield* recordGreen(building, scenario, run)
      return run
    })

  /**
   * The greens due, keyed on each scenario's state and its last green run, never on whether one
   * ran: an automated scenario whose red is recorded (or which is not reproducible, run for
   * information) and whose tasks are done runs, unless its last green run was on the current
   * trees. That run, passed, makes it green: a stop between a green run and its record.
   */
  const greensDue = (building: BuildingRow) =>
    inTurn(
      building.missionId,
      Effect.gen(function* () {
        const database = yield* Database
        const tasks = yield* tasksIn(database, building.id)
        const runs = yield* proofRunsIn(database, building.id)
        const current = yield* currentTreesIn(database, building.missionId)
        // The open attempt of each failed green, with the trees of every repository at its failure.
        const failed = new Map(
          (yield* attemptsIn(database, building.id))
            .filter((one) => one.scope === 'proof' && one.subject !== null && one.endedAt === null)
            .map((one) => [one.subject ?? '', readTrees(one.starts)]),
        )
        for (const row of yield* scenarioProofsIn(database, building.id)) {
          const state = stateOf(row)
          if (modeOf(row) !== 'automated') continue
          const open = failed.get(row.scenario)
          if (state !== 'red_recorded' && state !== 'not_reproducible') {
            // A stale proof whose rerun failed waits for its fix like a failed green.
            if (state !== 'to_rerun' || open === undefined) continue
          }
          if (!greenDue(tasks, row.scenario, row.requirement)) continue
          if (open !== undefined) {
            // Nothing moved anywhere since it failed: the fix is not there yet.
            if (open.length > 0 && upToDate(open, current) && open.length >= current.size) continue
            yield* greenOf(building, row.scenario, state === 'to_rerun' ? 'rerun' : 'green')
            continue
          }
          const last = runs.findLast(
            (one) =>
              one.scenario === row.scenario && (one.phase === 'green' || one.phase === 'rerun'),
          )
          const trees = readTrees(last?.trees ?? null)
          if (last !== undefined && trees.length > 0 && upToDate(trees, current)) {
            if (state !== 'red_recorded') continue
            if (last.classification === 'passed') {
              yield* recordGreen(building, row.scenario, Object.assign({}, last, { trees }))
            } else {
              // A stop between a failed green run and its attempt: the attempt is opened now.
              const classification =
                PROOF_CLASSES.find((one) => one === last.classification) ?? 'error_before_test'
              yield* failedGreen(building, row.scenario, {
                classification,
                outputTail: last.outputTail,
                runId: last.runId,
              })
            }
            continue
          }
          yield* greenOf(building, row.scenario, 'green')
        }
      }),
    )

  /**
   * The automated scenarios that keep the end waiting: any not green (nor stale, which the end
   * runs again, nor set aside as not reproducible) once every task is done.
   */
  const unproven = (building: BuildingRow) =>
    Effect.gen(function* () {
      const database = yield* Database
      return (yield* scenarioProofsIn(database, building.id))
        .filter((row) => modeOf(row) === 'automated' && !SETTLED.includes(stateOf(row)))
        .map((row) => row.scenario)
    })

  /** The scenarios the user ended the Building without. */
  const notProven = (building: BuildingRow) =>
    Effect.gen(function* () {
      return (yield* scenarioProofsIn(yield* Database, building.id))
        .filter((row) => stateOf(row) === 'not_proven')
        .map((row) => row.scenario)
    })

  /**
   * Among the scenarios the end waits on, those nothing moves any more: no need of the user's
   * holds them, and either every task covering them was skipped, or the attempt open on them (a
   * failed green, which a write runs again) is one the Builder no longer acts on: `quiet`, it ended
   * its turn while the end waited, writing nothing since. Null while one of the mission's proofs
   * runs, which may move them: they are judged once it ends (#258).
   */
  const stuckOf = (building: BuildingRow, scenarios: ReadonlyArray<string>, quiet: boolean) =>
    Effect.gen(function* () {
      if (proving.has(building.missionId)) {
        unjudged.set(building.missionId, building)
        return null
      }
      const database = yield* Database
      const tasks = yield* tasksIn(database, building.id)
      const decisions = yield* decisionsIn(database, building.id)
      const attempts = yield* attemptsIn(database, building.id)
      const rows = yield* scenarioProofsIn(database, building.id)
      return scenarios.filter((scenario) => {
        const row = rows.find((one) => one.scenario === scenario)
        if (row === undefined || stateOf(row) === 'held') return false
        const own = decisions.filter((one) => one.scope === 'proof' && one.subject === scenario)
        if (own.some((one) => one.state === 'pending')) return false
        const proof = attempts.filter((one) => one.scope === 'proof' && one.subject === scenario)
        if (proof.some((one) => one.endedAt === null)) return quiet
        const covering = coveringOf(tasks, scenario)
        return covering.length > 0 && covering.every((task) => task.state === 'skipped')
      })
    })

  /** The pending question about the scenarios the end waits on, and the scenarios it names. */
  const unprovenPending = (building: BuildingRow) =>
    Effect.gen(function* () {
      const found = (yield* decisionsIn(yield* Database, building.id)).find(
        (one) => one.kind === 'proofs_unproven' && one.state === 'pending',
      )
      return found === undefined
        ? null
        : {
            id: found.id,
            needId: found.needId,
            scenarios: (found.subject ?? '').split(',').filter((one) => one !== ''),
          }
    })

  /** That question withdrawn: what it named moved, and the end is judged again. */
  const withdrawUnproven = (asked: { readonly id: string; readonly needId: string }) =>
    Effect.gen(function* () {
      yield* mutate('withdrawing a question about the proofs', (transaction) =>
        transaction
          .update(buildingDecisions)
          .set({ state: 'withdrawn', answeredAt: now() })
          .where(and(eq(buildingDecisions.id, asked.id), eq(buildingDecisions.state, 'pending')))
          .pipe(
            Effect.mapError(refusedWhile('withdrawing the decision')),
            Effect.as({ result: undefined, events: [] }),
          ),
      )
      yield* withdrawNeed(asked.needId, 'What the end waited on moved since it was asked.')
    })

  /** One need to the user naming the scenarios nothing moves: try again, or end without them. */
  const askUnproven = (building: BuildingRow, scenarios: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const named = scenarios.join(', ')
      const one = scenarios.length === 1
      const question = `${named} ${one ? 'is' : 'are'} not proven, and nothing in the plan moves ${one ? 'it' : 'them'} any more: every task covering ${one ? 'it' : 'them'} was skipped, or ${one ? 'its' : 'their'} proof failed again after your answer. "${TRY_AGAIN}" runs ${one ? 'its proof' : 'their proofs'} again; "${END_WITHOUT}" ends the Building with ${named} recorded as not proven.`
      const options = [TRY_AGAIN, END_WITHOUT]
      const write = yield* createNeedIn(
        parts.needs,
        yield* ownerOf(building),
        DecisionFields.make({ question, options, recommended: null }),
      )
      yield* mutate('asking about the proofs the end waits on', (transaction) =>
        Effect.gen(function* () {
          const made = yield* loop.hemeraNeedIn(transaction, building, write, {
            kind: 'proofs_unproven',
            tasks: [],
            question,
            options,
            proposer: null,
            scope: { scope: 'proof', subject: scenarios.join(',') },
          })
          return {
            result: undefined,
            events: [
              buildingEvent(building.missionId, 'building.proofs_unproven', { scenarios }),
              ...made.events,
            ],
          }
        }),
      )
    })

  /** Whether a scenario has the open attempt of a failed green. */
  const failedGreens = (building: BuildingRow) =>
    Effect.gen(function* () {
      const database = yield* Database
      return (yield* attemptsIn(database, building.id))
        .filter((one) => one.scope === 'proof' && one.subject !== null && one.endedAt === null)
        .map((one) => one.subject ?? '')
    })

  /** The missions whose Builder wrote and whose failed greens wait for that write to settle. */
  const settling = new Set<string>()

  /**
   * A file tool write of the Builder settled: a failed green runs again on the trees it left. The
   * writes of a moment are taken together, and nothing waits for it.
   */
  const afterWrite = (missionId: string) =>
    Effect.suspend(() => {
      if (settling.has(missionId)) return Effect.void
      settling.add(missionId)
      return parts.background(
        Effect.gen(function* () {
          yield* Effect.sleep('300 millis')
          settling.delete(missionId)
          const database = yield* Database
          const building = yield* activeBuildingIn(database, missionId)
          if (building === null || (yield* failedGreens(building)).length === 0) return
          yield* snapshotNow(building, 'write')
          yield* greensDue(building)
        }).pipe(
          Effect.ensuring(Effect.sync(() => settling.delete(missionId))),
          Effect.catchCause((cause) => said(`a failed green did not run again: ${String(cause)}`)),
        ),
      )
    })

  /**
   * The Builder's write outside the proof files while some scenario still waits for its red, kept
   * for the reviewers (in the transaction of its outcome).
   */
  const writtenIn = (transaction: EngineTransaction, file: WrittenFile) =>
    Effect.gen(function* () {
      const building = yield* activeBuildingIn(transaction, file.missionId)
      if (building === null) return
      const waiting = (yield* scenarioProofsIn(transaction, building.id))
        .filter(
          (row) =>
            modeOf(row) === 'automated' &&
            (stateOf(row) === 'waiting_red' || stateOf(row) === 'held'),
        )
        .map((row) => row.scenario)
      if (waiting.length === 0) return
      const located = fileOf(building, file.path)
      if (located === null) return
      if (
        (yield* proofFilesIn(transaction, building.missionId)).has(
          `${located.repository}\u0000${located.path}`,
        )
      )
        return
      const lineage = yield* lineageIn(transaction, file.sessionId)
      const task =
        lineage === null
          ? null
          : taskOfFile(runningOf(yield* tasksIn(transaction, building.id), lineage), located)
      yield* transaction
        .insert(writesBeforeRed)
        .values({
          id: crypto.randomUUID(),
          buildingId: building.id,
          repository: located.repository,
          path: located.path,
          taskId: task?.id ?? null,
          sessionId: file.sessionId,
          scenarios: JSON.stringify(waiting),
          at: now(),
        })
        .pipe(Effect.mapError(refusedWhile('keeping a write before the red')))
    })

  // ---- What the user answered.

  /**
   * A decision of a proof answered, in its transaction: a red accepted is recorded; set aside, the
   * scenario is not reproducible; sent back or with more information, it waits for its red again.
   */
  const answeredIn = (
    transaction: EngineTransaction,
    building: BuildingRow,
    decision: { readonly kind: string; readonly subject: string | null },
    answer: string | null,
  ) =>
    Effect.gen(function* () {
      const scenario = decision.subject
      if (scenario === null) return []
      if (decision.kind === 'proofs_unproven') {
        if (answer !== END_WITHOUT) return []
        // Only those still unproven: one that went green since stays green.
        const rows = yield* scenarioProofsIn(transaction, building.id)
        const scenarios = scenario.split(',').filter((one) => {
          const row = rows.find((proof) => proof.scenario === one)
          return row !== undefined && !SETTLED.includes(stateOf(row))
        })
        for (const one of scenarios) {
          yield* setProofIn(transaction, building.id, one, { state: 'not_proven' })
          // Its attempt left open ends with it: nothing runs it any more.
          yield* transaction
            .update(buildingAttempts)
            .set({ endedAt: now(), outcome: 'not_proven', verdict: 'red' })
            .where(
              and(
                eq(buildingAttempts.buildingId, building.id),
                isNull(buildingAttempts.taskId),
                eq(buildingAttempts.scope, 'proof'),
                eq(buildingAttempts.subject, one),
                isNull(buildingAttempts.endedAt),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('closing the attempt')))
        }
        return [buildingEvent(building.missionId, 'building.not_proven', { scenarios })]
      }
      const row = yield* scenarioProofIn(transaction, building.id, scenario)
      if (row === null || stateOf(row) !== 'held') return []
      if (decision.kind === 'red_mismatch' && answer === ACCEPT_RED && row.heldRunId !== null) {
        return yield* recordedIn(transaction, building, scenario, row.heldRunId)
      }
      if (decision.kind === 'already_passes' && answer === NOT_REPRODUCIBLE) {
        yield* setProofIn(transaction, building.id, scenario, {
          state: 'not_reproducible',
          needId: null,
        })
        return [buildingEvent(building.missionId, 'building.not_reproducible', { scenario })]
      }
      if (decision.kind === 'already_passes' && answer === CANCEL_MISSION) return []
      yield* setProofIn(transaction, building.id, scenario, { state: 'waiting_red', needId: null })
      return []
    })

  /**
   * What follows an answer, once it is kept: a red sent back is an attempt on the proof for the
   * Builder, with both outputs; more information is delivered to the Builder. Answers whether the
   * user chose to cancel the mission.
   */
  const afterAnswer = (missionId: string, kind: string, scenario: string, answer: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      const building = yield* activeBuildingIn(database, missionId)
      if (building === null) return false
      if (kind === 'already_passes' && answer === CANCEL_MISSION) return true
      if (kind === 'proofs_unproven') {
        // Each proof run again, then the end judged again, out of the turn the end may take. Counted
        // as running from now: the Builder's turn on the answer judges nothing before it ends.
        if (answer === TRY_AGAIN) yield* begin(missionId)
        const again =
          answer !== TRY_AGAIN
            ? Effect.void
            : Effect.ensuring(
                inTurn(
                  missionId,
                  Effect.forEach(
                    scenario.split(',').filter((one) => one !== ''),
                    (one) =>
                      Effect.gen(function* () {
                        const row = yield* scenarioProofIn(database, building.id, one)
                        if (row === null) return
                        const state = stateOf(row)
                        if (state === 'waiting_red') yield* redOf(building, one)
                        else if (state === 'red_recorded') yield* greenOf(building, one, 'green')
                        else if (state === 'to_rerun') yield* greenOf(building, one, 'rerun')
                      }),
                    { discard: true },
                  ),
                ),
                done(missionId),
              )
        yield* parts.background(
          Effect.andThen(again, parts.moved(building)).pipe(
            Effect.catchCause((cause) => said(`the proofs were not run again: ${String(cause)}`)),
          ),
        )
        return false
      }
      const row = yield* scenarioProofIn(database, building.id, scenario)
      if (row === null || stateOf(row) !== 'waiting_red') return false
      const run = (yield* proofRunsIn(database, building.id)).find(
        (one) => one.id === row.heldRunId,
      )
      if (kind === 'red_mismatch') {
        const proof = yield* proofOf(missionId, scenario)
        yield* loop.proofRed(
          building,
          scenario,
          {
            name: 'proof',
            detail: 'the user sent this red back: it is not the one Planning saw',
            outputTail: [
              'Planning observed:',
              proof?.observed ?? '',
              '',
              'This red:',
              run?.outputTail ?? '',
            ].join('\n'),
            runId: run?.runId ?? null,
          },
          `Make the test fail as Planning saw it, within the Proof block and never by changing its expected result, then call proof_run(${scenario}).`,
        )
      } else if (kind === 'already_passes') {
        yield* deliver(
          building,
          { role: 'builder' },
          'answer',
          `${scenario} already passes, and the user says more: ${answer}\nAdjust the starting data or the actions within the Proof block, never its expected result, then call proof_run(${scenario}).`,
        )
      }
      return false
    })

  /** An environment need's Retry: the scenario waits for its red again, and runs it now. */
  const retried = (building: BuildingRow, scenario: string) =>
    Effect.gen(function* () {
      yield* mutate('running a red again', (transaction) =>
        Effect.gen(function* () {
          const row = yield* scenarioProofIn(transaction, building.id, scenario)
          if (row !== null && stateOf(row) === 'held') {
            yield* setProofIn(transaction, building.id, scenario, {
              state: 'waiting_red',
              needId: null,
            })
          }
          return { result: undefined, events: [] }
        }),
      )
      yield* parts.background(
        inTurn(building.missionId, redOf(building, scenario)).pipe(
          Effect.asVoid,
          Effect.catchCause((cause) => said(`a red was not run again: ${String(cause)}`)),
        ),
      )
    })

  // ---- proof_run.

  /** The Builder, or a helper tied to a task covering the scenario, runs a proof itself. */
  const proofRun = (grant: Grant, args: ToolArguments<'proof_run'>) =>
    Effect.gen(function* () {
      if (grant.missionId === null) return refusal('refused: this session works for no mission')
      const database = yield* Database
      const building = yield* activeBuildingIn(database, grant.missionId)
      if (building === null) return refusal('refused: the mission has no Building under way')
      const row = yield* scenarioProofIn(database, building.id, args.scenario)
      if (row === null)
        return refusal(`refused: ${args.scenario} is no scenario of the Spec with a proof.`)
      if (modeOf(row) === 'by_hand') {
        return refusal(
          `refused: ${args.scenario} is verified by hand: it has no red, and the user validates it in Review.`,
        )
      }
      const tasks = yield* tasksIn(database, building.id)
      if (grant.helper !== undefined) {
        const covers = tasks.some(
          (task) => task.id === grant.helper?.taskId && task.scenarios.includes(args.scenario),
        )
        if (!covers)
          return refusal(`refused: ${grant.helper.label} runs only the proofs of its own task.`)
      }
      const proof = yield* proofOf(building.missionId, args.scenario)
      if (proof === null || !inPlace(building, proof)) {
        return refusal(
          `refused: ${args.scenario}'s test is not in place yet${proof?.test === undefined ? '.' : `: ${proof.test.repository}/${proof.test.path} is missing, or does not hold the test yet.`}`,
        )
      }
      const state = stateOf(row)
      if (state === 'held') return refusal(`refused: ${args.scenario} waits for the user's answer.`)
      // Before its tasks are done, a run is for information: it judges nothing.
      const run = yield* inTurn(
        building.missionId,
        state === 'waiting_red'
          ? redOf(building, args.scenario)
          : greenDue(tasks, args.scenario, row.requirement)
            ? greenOf(building, args.scenario, 'green')
            : runOf(building, args.scenario, 'info', proof),
      )
      if (run === null) return refusal(`refused: ${args.scenario} no longer waits for its red.`)
      const after = yield* scenarioProofIn(database, building.id, args.scenario)
      return answered(
        [
          `${args.scenario}: ${run.classification.replace('_', ' ')}${run.exitCode === null ? '' : ` (exit ${String(run.exitCode)})`}. Its proof is ${(after === null ? state : stateOf(after)).replace('_', ' ')}.`,
          fenced(run.outputTail),
        ].join('\n'),
      )
    })

  // ---- Freshness.

  /**
   * Runs again every stale automated proof and every stale final check on the current tree (#147
   * calls it before the mission leaves Building, R2 at the end of each round). A red there is an
   * attempt on its proof, or on the end for a check.
   */
  const refresh = (missionId: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      const building = yield* activeBuildingIn(database, missionId)
      if (building === null) return { proofs: [], checks: [] }
      yield* snapshotNow(building, 'refresh')
      const rerun: string[] = []
      const failed = yield* failedGreens(building)
      yield* inTurn(
        missionId,
        Effect.gen(function* () {
          for (const row of yield* scenarioProofsIn(database, building.id)) {
            if (modeOf(row) !== 'automated') continue
            // A stale green, and a failed green whose attempt is still open.
            const state = stateOf(row)
            if (state === 'to_rerun') yield* greenOf(building, row.scenario, 'rerun')
            else if (state === 'red_recorded' && failed.includes(row.scenario))
              yield* greenOf(building, row.scenario, 'green')
            else continue
            rerun.push(row.scenario)
          }
        }),
      )
      const stale = (yield* finalChecksIn(database, missionId, building.id)).filter(
        (one) => !one.upToDate,
      )
      if (stale.length > 0) yield* loop.judgeScope(missionId, 'end', null)
      const checks = stale.map((one) =>
        one.place === '' ? one.name : `${one.name} · ${one.place}`,
      )
      yield* mutate('saying the proofs were refreshed', () =>
        Effect.succeed({
          result: undefined,
          events: [
            buildingEvent(missionId, 'building.proofs_refreshed', { proofs: rerun, checks }),
          ],
        }),
      )
      return { proofs: rerun, checks }
    })

  /**
   * The proofs and the final checks whose repository's tree is no longer the one they tested,
   * among these repositories (R9 reads it at Ship).
   */
  const touched = (missionId: string, repositories: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const database = yield* Database
      const building = yield* latestBuildingIn(database, missionId)
      if (building === null) return { proofs: [], checks: [] }
      const current = yield* currentTreesIn(database, missionId)
      const runs = yield* proofRunsIn(database, building.id)
      const proofs: string[] = []
      for (const row of yield* scenarioProofsIn(database, building.id)) {
        const state = stateOf(row)
        if (state !== 'green' && state !== 'to_rerun') continue
        const run = runs.find((one) => one.id === row.greenRunId)
        // A stale proof with no green run left to compare is touched wherever it is asked.
        if (run === undefined) {
          if (state === 'to_rerun') proofs.push(row.scenario)
          continue
        }
        if (!upToDate(readTrees(run.trees), current, repositories)) proofs.push(row.scenario)
      }
      const checks = (yield* finalChecksIn(database, missionId, building.id))
        .filter((one) => !upToDate(one.trees, current, repositories))
        .map((one) => (one.place === '' ? one.name : `${one.name} · ${one.place}`))
      return { proofs, checks }
    })

  // ---- The resume.

  /** At a start: the proofs not written yet written, the reds left run, the greens due run. */
  const resumed = (building: BuildingRow) =>
    Effect.gen(function* () {
      yield* writeProofs(building).pipe(
        Effect.andThen(handOverLeft(building)),
        Effect.catchCause((cause) => said(`the proofs were not written: ${String(cause)}`)),
      )
      // Counted once from here to the end of the greens: between the reds and the greens, which
      // run again on trees that may have moved during the stop, nothing is stuck (#290).
      yield* begin(building.missionId)
      yield* parts.background(
        redPhase(building).pipe(
          Effect.andThen(parts.hold('greens-due')),
          Effect.andThen(greensDue(building)),
          Effect.catchCause((cause) => said(`the proofs did not resume: ${String(cause)}`)),
          Effect.ensuring(done(building.missionId)),
        ),
      )
    })

  return {
    setUpIn,
    started,
    resumed,
    greensDue,
    unproven,
    notProven,
    stuckOf,
    unprovenPending,
    withdrawUnproven,
    askUnproven,
    writtenIn,
    afterWrite,
    answeredIn,
    afterAnswer,
    retried,
    proofRun,
    refresh,
    touched,
  }
}

export type BuildingProofs = ReturnType<typeof buildingProofs>
