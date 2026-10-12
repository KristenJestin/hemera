/**
 * A scenario's proof run by Hemera (#144): the Proof block's command, through the run service, in
 * the mission's Workspace, Hemera its author and never an agent's session. It runs where its test
 * is (the test's repository), or at the Workspace root for a command with no test file; it takes
 * the write locks of those repositories and their trees right before it launches, as a check does
 * (#143). Once it ends it is classified (CT-35), compared with the key line Planning observed, and
 * recorded with its tree, the end of its output, and its whole output and test kept as evidence.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import {
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
import { Context, Effect, Layer, Option, Result } from 'effect'

import { getCommand } from '../catalogue.ts'
import { putEvidence } from '../memory/evidence.ts'
import { awaitRun, runOutput, startRun, stopRun } from '../runs.ts'
import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { buildings, missions, proofRuns } from '../storage/schema.ts'
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
}

/** The proof's command: what runs its test, or the command with no test file. */
export const proofCommand = (proof: Proof): string => proof.test?.command ?? proof.command ?? ''

const posixOf = (path: string): string => path.split(sep).join('/')

export class ProofRunner extends Context.Service<
  ProofRunner,
  { readonly run: (asked: ProofAsked) => Effect.Effect<ProofRun> }
>()('ProofRunner') {}

const runProof = (asked: ProofAsked) =>
  Effect.gen(function* () {
    const database = yield* Database
    const secrets = yield* Secrets
    const [building] = yield* database
      .select()
      .from(buildings)
      .where(eq(buildings.id, asked.buildingId))
      .pipe(Effect.mapError(refusedWhile('reading the Building')))
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, asked.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (building === undefined || mission === undefined) {
      return yield* Effect.die(new Error('a proof ran for a Building that is not there'))
    }
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
    const repositories = base === null ? bases.map((one) => one.repository) : [base.repository]
    const testFile = test === null || base === null ? null : join(base.folder, test.path)
    const testBytes = testFile !== null && existsSync(testFile) ? readFileSync(testFile) : null
    const watch = yield* BuildDesk.use((desk) =>
      desk.checkRun(asked.missionId, `proof ${asked.scenario}`, repositories),
    )
    let trees: ReadonlyArray<{ readonly repository: string; readonly tree: string }> = []
    const launched = yield* startRun({
      projectId: mission.projectId,
      workspaceId: building.workspaceId,
      commandId: catalogued,
      line: catalogued === null ? command : null,
      folder: catalogued === null && folder !== '' ? folder : null,
      startedBy: 'hemera',
      sessionId: null,
      missionId: asked.missionId,
      beforeLaunch:
        watch === null
          ? Effect.void
          : Effect.map(watch.launch, (taken) => {
              trees = taken
            }),
    }).pipe(Effect.result)
    let output = ''
    let exitCode: number | null = null
    let runId: string | null = null
    let line = command
    if (Result.isFailure(launched)) {
      if (watch !== null) yield* watch.finish(null)
      output = `It could not start: ${launched.failure.message}`
    } else {
      runId = launched.success.id
      const ended = yield* awaitRun(launched.success.id).pipe(
        // Started for this proof and judged by it: nobody else would stop it.
        Effect.onInterrupt(() => stopRun(launched.success.id).pipe(Effect.ignore)),
        Effect.ensuring(watch === null ? Effect.void : watch.finish(launched.success.id)),
      )
      output = (yield* runOutput(launched.success.id)).output
      exitCode = ended.exitCode
      line = ended.line
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

/** The proofs, run by Hemera (#144). */
export const proofRunnerLayer = Layer.effect(
  ProofRunner,
  Effect.gen(function* () {
    const context = yield* Effect.context<Effect.Services<ReturnType<typeof runProof>>>()
    return { run: (asked) => runProof(asked).pipe(Effect.provide(context), Effect.orDie) }
  }),
)
