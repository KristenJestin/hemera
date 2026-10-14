/**
 * A scenario's proof run by Hemera (#144): the Proof block's command, through the run service, in
 * the mission's Workspace, Hemera its author and never an agent's session. It runs where its test
 * is (the test's repository), or at the Workspace root for a command with no test file; it takes
 * the write locks and the trees of the repositories it is asked to be fresh on (its test's and
 * every one its tasks wrote) right before it launches, as a check does (#143). Once it ends it is classified (CT-35), compared with the key line Planning observed, and
 * recorded with its tree, the end of its output, and its whole output and test kept as evidence.
 *
 * It is ended past the Project's time limit (#321), read at each run: a change in the settings
 * reaches the next run of a mission already launched.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import {
  DEFAULT_PROOF_MINUTES,
  type Masked,
  type Proof,
  type ProofPhase,
  type ProofRunClass,
  classifyProofRun,
  keyLineFound,
  outputTail,
} from '@hemera/core/domain'
import { HemeraAuthor } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Context, Deferred, Duration, Effect, Layer, Option, Result } from 'effect'

import { getCommand } from '../catalogue.ts'
import { putEvidence } from '../memory/evidence.ts'
import { awaitRun, runOutput, startRun, stopRun } from '../runs.ts'
import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { buildings, missions, projects, proofRuns } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { placeOf } from '../workspaces.ts'
import { BuildDesk } from './desk.ts'
import { writeTrees } from './proof-store.ts'
import { bases as basesCodec } from './tasks.ts'

/** What a proof run is asked: the scenario of a Building, its Proof block, and why it runs. */
export interface ProofAsked {
  readonly missionId: string
  readonly buildingId: string
  readonly scenario: string
  readonly phase: ProofPhase
  readonly proof: Proof
  /** The repositories whose trees the run is recorded on: a later change there makes it stale. */
  readonly repositories: ReadonlyArray<string>
}

/** A proof run as it was recorded. */
export interface ProofRun extends ProofRunClass {
  readonly id: string
  readonly scenario: string
  readonly phase: ProofPhase
  readonly line: Masked<string>
  readonly failingTest: Masked<string> | null
  readonly assertion: Masked<string> | null
  readonly testPath: string | null
  readonly testSha256: string | null
  readonly exitCode: number | null
  /** Whether Planning's key line was found again; null when the proof has none. */
  readonly keyLineMatched: boolean | null
  readonly outputTail: Masked<string>
  readonly evidenceId: string | null
  readonly testEvidenceId: string | null
  readonly runId: string | null
  readonly trees: ReadonlyArray<{ readonly repository: string; readonly tree: string }>
  readonly at: string
  /** The Project's limit it ran past, in minutes, when Hemera ended it there; null otherwise. */
  readonly timedOutAfter: number | null
  /**
   * Whether its command was launched: false when it could not start, or gave up waiting for a
   * resource held elsewhere (#306). Known as it runs, never recorded.
   */
  readonly started: boolean
  /**
   * Whether it was stopped before it ended, other than at its limit (the exit's stops, #309).
   * Known as it runs, never recorded.
   */
  readonly stopped: boolean
}

/** The proof's command: what runs its test, or the command with no test file. */
export const proofCommand = (proof: Proof): string => proof.test?.command ?? proof.command ?? ''

const posixOf = (path: string): string => path.split(sep).join('/')

export class ProofRunner extends Context.Service<
  ProofRunner,
  { readonly run: (asked: ProofAsked) => Effect.Effect<ProofRun> }
>()('ProofRunner') {}

/**
 * How long a proof may run before Hemera ends it (#290) while its Project sets no limit (#321): a
 * test that never ends (a watch mode, a wait on the network) would otherwise hold the end of the
 * Building for good. Ten minutes is far above a scenario's test.
 */
export const PROOF_LIMIT = Duration.minutes(DEFAULT_PROOF_MINUTES)

/** What a run's limit is made of: the default, and how long a minute of the Project's lasts. */
export interface ProofLimits {
  readonly limit: Duration.Duration
  readonly minute: Duration.Duration
}

const REAL: ProofLimits = { limit: PROOF_LIMIT, minute: Duration.minutes(1) }

/** How long a proof may run: the Project's minutes, or the default while it sets none. */
export const proofLimitFor = (minutes: number | null, limits: ProofLimits = REAL) =>
  minutes === null ? limits.limit : Duration.times(limits.minute, minutes)

const runProof = (asked: ProofAsked, limits: ProofLimits) =>
  Effect.gen(function* () {
    const database = yield* Database
    const secrets = yield* Secrets
    const [building] = yield* database
      .select()
      .from(buildings)
      .where(eq(buildings.id, asked.buildingId))
      .pipe(Effect.mapError(refusedWhile('reading the Building')))
    const [mission] = yield* database
      .select({ projectId: missions.projectId, minutes: projects.proofLimitMinutes })
      .from(missions)
      .innerJoin(projects, eq(projects.id, missions.projectId))
      .where(eq(missions.id, asked.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (building === undefined || mission === undefined) {
      return yield* Effect.die(new Error('a proof ran for a Building that is not there'))
    }
    const limit = proofLimitFor(mission.minutes, limits)
    const bases = Option.getOrElse(basesCodec.read(building.bases), () => [])
    const workspace = yield* placeOf(mission.projectId, building.workspaceId)
    const test = asked.proof.test ?? null
    const base =
      test === null ? null : (bases.find((one) => one.repository === test.repository) ?? null)
    const command = proofCommand(asked.proof)
    // A catalogue command runs where the catalogue puts it; a line where its test is.
    const catalogued = yield* getCommand(mission.projectId, command).pipe(
      Effect.map((found) => found.id),
      Effect.orElseSucceed(() => null),
    )
    const folder = base === null ? '' : posixOf(relative(workspace.folder, base.folder))
    const repositories = bases
      .map((one) => one.repository)
      .filter((one) => asked.repositories.includes(one))
    const testFile = test === null || base === null ? null : join(base.folder, test.path)
    const testBytes = testFile !== null && existsSync(testFile) ? readFileSync(testFile) : null
    const watch = yield* BuildDesk.use((desk) =>
      desk.checkRun(asked.missionId, `proof ${asked.scenario}`, repositories),
    )
    let trees: ReadonlyArray<{ readonly repository: string; readonly tree: string }> = []
    // Its limit counts from its launch, never while it waits for a permission; a reservation held
    // elsewhere is waited for that long at most, then the run fails unstarted (#306).
    const started = Deferred.makeUnsafe<void>()
    const launched = yield* startRun({
      projectId: mission.projectId,
      workspaceId: building.workspaceId,
      commandId: catalogued,
      line: catalogued === null ? command : null,
      folder: catalogued === null && folder !== '' ? folder : null,
      startedBy: 'hemera',
      sessionId: null,
      missionId: asked.missionId,
      waitLimit: limit,
      beforeLaunch: Effect.andThen(
        watch === null
          ? Effect.void
          : Effect.map(watch.launch, (taken) => {
              trees = taken
            }),
        Deferred.succeed(started, undefined),
      ),
    }).pipe(Effect.result)
    let output = ''
    let exitCode: number | null = null
    let runId: string | null = null
    let line = command
    let timedOut = false
    let stopped = false
    if (Result.isFailure(launched)) {
      if (watch !== null) yield* watch.finish(null)
      output = `It could not start: ${launched.failure.message}`
    } else {
      runId = launched.success.id
      const id = launched.success.id
      const ended = yield* Effect.gen(function* () {
        const waited = yield* Effect.raceFirst(
          Effect.asSome(awaitRun(id)),
          Effect.as(Effect.andThen(Deferred.await(started), Effect.sleep(limit)), Option.none()),
        )
        // Past its limit it is ended, its process tree with it: a red that timed out (#290).
        if (Option.isSome(waited)) return { run: waited.value, timedOut: false }
        return { run: yield* stopRun(id), timedOut: true }
      }).pipe(
        // Started for this proof and judged by it: nobody else would stop it.
        Effect.onInterrupt(() => stopRun(id).pipe(Effect.ignore)),
        Effect.ensuring(watch === null ? Effect.void : watch.finish(id)),
      )
      output = (yield* runOutput(id)).output
      timedOut = ended.timedOut
      stopped = !ended.timedOut && ended.run.state === 'stopped'
      if (ended.timedOut) {
        output = `${output}\nIt timed out after ${Duration.format(limit)}: Hemera ended it.`
      }
      // Ended by Hemera, it never exited on its own, whatever its runner said as it stopped.
      exitCode = ended.timedOut ? null : ended.run.exitCode
      line = ended.run.line
    }
    const classified = classifyProofRun({ output, exitCode, testPath: test?.path ?? null })
    const key = asked.proof.key_line
    const evidence = (name: string, text: string) =>
      putEvidence({
        missionId: asked.missionId,
        content: { text },
        name,
        about: `proof ${asked.scenario}`,
        author: HemeraAuthor.make({}),
      }).pipe(
        Effect.map((item) => item.id),
        Effect.orElseSucceed(() => null),
      )
    const run: ProofRun = {
      id: crypto.randomUUID(),
      scenario: asked.scenario,
      phase: asked.phase,
      line: secrets.mask(line),
      testPath: test === null ? null : `${test.repository}/${test.path}`,
      testSha256: testBytes === null ? null : createHash('sha256').update(testBytes).digest('hex'),
      exitCode,
      ...classified,
      failingTest: classified.failingTest === null ? null : secrets.mask(classified.failingTest),
      assertion: classified.assertion === null ? null : secrets.mask(classified.assertion),
      keyLineMatched: key === undefined ? null : keyLineFound(output, key),
      outputTail: secrets.mask(outputTail(output).tail),
      evidenceId: yield* evidence(
        `${asked.scenario} · ${asked.phase} run`,
        output === '' ? '(no output)' : output,
      ),
      testEvidenceId:
        testBytes === null || test === null
          ? null
          : yield* evidence(`${asked.scenario} · ${test.path}`, testBytes.toString('utf8')),
      runId,
      trees,
      at: new Date().toISOString(),
      timedOutAfter: timedOut ? (mission.minutes ?? DEFAULT_PROOF_MINUTES) : null,
      started: yield* Deferred.isDone(started),
      stopped,
    }
    yield* mutate('recording a proof run', (transaction) =>
      transaction
        .insert(proofRuns)
        .values({
          id: run.id,
          missionId: asked.missionId,
          buildingId: asked.buildingId,
          scenario: run.scenario,
          phase: run.phase,
          line: run.line,
          testPath: run.testPath,
          testSha256: run.testSha256,
          exitCode: run.exitCode,
          classification: run.classification,
          failingTest: run.failingTest,
          assertion: run.assertion,
          keyLineMatched: run.keyLineMatched,
          outputTail: run.outputTail,
          evidenceId: run.evidenceId,
          testEvidenceId: run.testEvidenceId,
          runId: run.runId,
          trees: writeTrees(run.trees),
          at: run.at,
        })
        .pipe(
          Effect.mapError(refusedWhile('recording a proof run')),
          Effect.as({ result: undefined, events: [] }),
        ),
    )
    return run
  })

/**
 * The proofs, run by Hemera (#144), each ended at its Project's limit (#321), or at `limit` while
 * the Project sets none (#290); `minute` is how long one minute of the Project's limit lasts.
 */
export const proofRunnerLayer = (
  limit: Duration.Duration = PROOF_LIMIT,
  minute: Duration.Duration = REAL.minute,
) =>
  Layer.effect(
    ProofRunner,
    Effect.gen(function* () {
      const context = yield* Effect.context<Effect.Services<ReturnType<typeof runProof>>>()
      return {
        run: (asked) =>
          runProof(asked, { limit, minute }).pipe(Effect.provide(context), Effect.orDie),
      }
    }),
  )
