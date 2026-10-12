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
 * - **The green runs.** Once every task covering a scenario is done, its proof runs again: passed,
 *   the scenario is green on that tree; anything else is an attempt on its proof for the Builder.
 *   A requirement is proven once its automated scenarios are all green and up to date. A test whose
 *   sha256 changed between red and green is shown with both versions.
 * - **Freshness (CT-38).** A green proof whose repository moved since is `to_rerun`
 *   (`proof-store.ts`); `refresh` runs every stale proof and the stale final checks again, on the
 *   current tree; `touched` names those a repository's change touched.
 * - **By hand (CT-36).** A scenario verified by hand is to verify until the user validates or
 *   refuses it, on the trees of the moment; a later change there makes it to verify again.
 * - **Restart.** A recorded red stands; the reds not recorded are run again at the next start, and
 *   the greens of scenarios whose tasks were all done.
 */

import {
  DecisionFields,
  EnvironmentFields,
  MissionOwner,
  type Proof,
  type ProofClass,
  type ProofPhase,
  type ToolArguments,
  insertedFiles,
  validRed,
} from '@hemera/core/domain'
import { HemeraAuthor, ProofRefused } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Option, Result, Semaphore } from 'effect'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Git } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { putEvidence } from '../memory/evidence.ts'
import { type NeedService, type NeedServices, createNeedIn } from '../needs.ts'
import type { DomainEvents } from '../domain-events.ts'
import type { ProfileHome } from '../profile-home.ts'
import { planRows, readProof } from '../planning/plan.ts'
import { missionRow } from '../planning/store.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  buildingAttempts,
  missions,
  scenarioProofs,
  specProofs,
  specScenarios,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { actionDone, beginAction } from '../tools/actions.ts'
import { answered, refusal } from '../tools/files.ts'
import { fingerprintOf } from '../tools/read.ts'
import { mutate } from '../transaction.ts'
import { attributedIn } from './attempts.ts'
import type { Loop } from './loop.ts'
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
  activeBuildingIn,
  attemptsIn,
  bases,
  buildingEvent,
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

/** The kinds of the decisions a proof's red asks: kept on the Building's decisions. */
export const PROOF_KINDS = ['red_mismatch', 'already_passes', 'proof_environment'] as const

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
      return `this red is not one: the assertion that failed is in ${run.failingFile ?? 'another file'}, not in ${where}`
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
  // One proof judged at a time: a state is read and moved without another run in between.
  const turn = Semaphore.makeUnsafe(1)
  const inTurn = <A, E, R>(effect: Effect.Effect<A, E, R>) => Semaphore.withPermits(turn, 1)(effect)

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

  /** The folder of a repository of the Workspace, or null. */
  const folderOf = (building: BuildingRow, repository: string) =>
    basesOf(building).find((one) => one.repository === repository)?.folder ?? null

  /** Whether a proof's test is in the Workspace: always for a command with no test file. */
  const inPlace = (building: BuildingRow, proof: Proof) => {
    if (proof.test === undefined) return true
    const folder = folderOf(building, proof.test.repository)
    return folder !== null && existsSync(join(folder, proof.test.path))
  }

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
        const files = insertedFiles(proof).map((file, at) => {
          const support =
            file.field === 'test'
              ? null
              : (proof.support_files ?? [])[at - (proof.test === undefined ? 0 : 1)]
          return {
            repository: file.repository,
            path: file.path,
            insertion: file.insertion,
            content:
              file.field === 'test' ? (proof.test?.code ?? null) : (support?.content ?? null),
            patch: file.patch,
            against:
              file.field === 'test' ? (proof.test?.against ?? null) : (support?.against ?? null),
          }
        })
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
      for (const conflict of conflicts) {
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
      if (validRed(run, proof.test?.path ?? null)) {
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
      const run = yield* ProofRunner.use((runner) =>
        runner.run({
          missionId: building.missionId,
          buildingId: building.id,
          scenario,
          phase: 'red',
          proof,
        }),
      )
      if ((yield* activeBuildingIn(database, building.missionId))?.id !== building.id) return run
      yield* judgeRed(building, scenario, proof, run)
      return run
    })

  /**
   * The red phase: each scenario waiting for its red, its proof in place and not handed to the
   * Builder, run in the Spec's order. One handed to the Builder (a conflict, a red that was not
   * one) runs again only when the Builder calls `proof_run`.
   */
  const redPhase = (building: BuildingRow) =>
    inTurn(
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

  /** Whether every task covering a scenario is done. */
  const tasksDoneFor = (tasks: Effect.Success<ReturnType<typeof tasksIn>>, scenario: string) => {
    const covering = coveringOf(tasks, scenario).filter((task) => task.state !== 'skipped')
    return covering.length > 0 && covering.every((task) => task.state === 'done')
  }

  /**
   * A scenario's proof run once its tasks are done: green on its tree when it passes, an attempt
   * on its proof for the Builder otherwise. A scenario set aside as not reproducible is run for
   * information only.
   */
  const greenOf = (building: BuildingRow, scenario: string, phase: ProofPhase) =>
    Effect.gen(function* () {
      const database = yield* Database
      const proof = yield* proofOf(building.missionId, scenario)
      if (proof === null) return null
      const run = yield* ProofRunner.use((runner) =>
        runner.run({
          missionId: building.missionId,
          buildingId: building.id,
          scenario,
          phase,
          proof,
        }),
      )
      const row = yield* scenarioProofIn(database, building.id, scenario)
      if (row === null || stateOf(row) === 'not_reproducible') return run
      if ((yield* activeBuildingIn(database, building.missionId))?.id !== building.id) return run
      if (run.classification !== 'passed') {
        yield* loop.proofRed(
          building,
          scenario,
          {
            name: 'proof',
            detail: `${scenario}'s proof is not green: ${CLASS_SAID[run.classification]}`,
            outputTail: run.outputTail,
            runId: run.runId,
          },
          `Fix it in the tasks covering ${scenario}, never in its test, then call proof_run(${scenario}).`,
        )
        return run
      }
      const red = (yield* proofRunsIn(database, building.id)).find((one) => one.id === row.redRunId)
      yield* mutate('recording a green', (transaction) =>
        Effect.gen(function* () {
          yield* setProofIn(transaction, building.id, scenario, {
            state: 'green',
            greenRunId: run.id,
          })
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
          return { result: undefined, events }
        }),
      )
      return run
    })

  /**
   * The greens due: each automated scenario whose tasks are all done and whose red is recorded (or
   * which is not reproducible, run for information), never run green since. `named` narrows them to
   * a task's scenarios.
   */
  const greensDue = (building: BuildingRow, named: ReadonlyArray<string> | null) =>
    inTurn(
      Effect.gen(function* () {
        const database = yield* Database
        const tasks = yield* tasksIn(database, building.id)
        const runs = yield* proofRunsIn(database, building.id)
        for (const row of yield* scenarioProofsIn(database, building.id)) {
          if (named !== null && !named.includes(row.scenario)) continue
          const state = stateOf(row)
          if (modeOf(row) !== 'automated') continue
          if (state !== 'red_recorded' && state !== 'not_reproducible') continue
          if (!tasksDoneFor(tasks, row.scenario)) continue
          // Run once for these tasks: a red since goes through the Builder's proof_run.
          if (runs.some((one) => one.scenario === row.scenario && one.phase === 'green')) continue
          yield* greenOf(building, row.scenario, 'green')
        }
      }),
    )

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
        inTurn(redOf(building, scenario)).pipe(
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
          `refused: ${args.scenario}'s test is not in place yet: ${proof?.test === undefined ? '' : `${proof.test.repository}/${proof.test.path} is missing.`}`,
        )
      }
      const state = stateOf(row)
      if (state === 'held') return refusal(`refused: ${args.scenario} waits for the user's answer.`)
      const run = yield* inTurn(
        state === 'waiting_red'
          ? redOf(building, args.scenario)
          : tasksDoneFor(tasks, args.scenario)
            ? greenOf(building, args.scenario, 'green')
            : ProofRunner.use((runner) =>
                runner.run({
                  missionId: building.missionId,
                  buildingId: building.id,
                  scenario: args.scenario,
                  phase: 'green',
                  proof,
                }),
              ),
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
      yield* inTurn(
        Effect.gen(function* () {
          for (const row of yield* scenarioProofsIn(database, building.id)) {
            if (modeOf(row) !== 'automated' || stateOf(row) !== 'to_rerun') continue
            yield* greenOf(building, row.scenario, 'rerun')
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
        if (state === 'to_rerun') {
          proofs.push(row.scenario)
          continue
        }
        if (state !== 'green') continue
        const run = runs.find((one) => one.id === row.greenRunId)
        if (run !== undefined && !upToDate(readTrees(run.trees), current, repositories))
          proofs.push(row.scenario)
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
        Effect.catchCause((cause) => said(`the proofs were not written: ${String(cause)}`)),
      )
      yield* parts.background(
        Effect.andThen(redPhase(building), greensDue(building, null)).pipe(
          Effect.catchCause((cause) => said(`the proofs did not resume: ${String(cause)}`)),
        ),
      )
    })

  return {
    setUpIn,
    started,
    resumed,
    greensDue,
    answeredIn,
    afterAnswer,
    retried,
    proofRun,
    refresh,
    touched,
  }
}

export type BuildingProofs = ReturnType<typeof buildingProofs>
