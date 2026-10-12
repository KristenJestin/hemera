/**
 * Where a Building's attempts are judged (#142): the `TaskChecks` port, which #143 fills with the
 * Project's checks (`run-checks.ts`), and the verdict of a finished task on it. A finished task
 * with no check is done, not verified.
 *
 * A check is asked about one attempt on a scope (a task, a requirement's checks, the end) with the
 * files attributed to it (CT-02), and answers one result per check and place. Its results are kept
 * on the attempt, each as soon as it is known; any red makes the attempt red, else any green
 * green, else not verified.
 */

import {
  ATTEMPT_RESULTS,
  type AttemptResult,
  type AttemptScope,
  type CheckVerdict,
  attemptResult,
} from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'

import type { DomainEvents } from '../domain-events.ts'
import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { buildingAttempts, buildingCheckResults } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { attributedIn, checkResultsIn } from './attempts.ts'

/** What a verdict is asked about: one finished attempt of a task. */
export interface VerdictAsked {
  readonly missionId: string
  readonly buildingId: string
  readonly taskId: string
  readonly attemptId: string
}

/** What the verdict says: verified, done without a check, red, or still being judged. */
export type TaskJudgement = 'verified' | 'not-verified' | 'red' | 'pending'

/** What an attempt's result makes of its task. */
const JUDGED = {
  red: 'red',
  green: 'verified',
  not_verified: 'not-verified',
} satisfies Record<AttemptResult, TaskJudgement>

/** Where a finished task is judged (#141's port): on `TaskChecks` here. */
export class TaskVerdict extends Context.Service<
  TaskVerdict,
  { readonly judge: (asked: VerdictAsked) => Effect.Effect<TaskJudgement> }
>()('TaskVerdict') {}

/** Done, not verified: no check, whatever `TaskChecks` would say. */
export const noCheckVerdict = Layer.succeed(TaskVerdict, {
  judge: () => Effect.succeed('not-verified' as const),
})

/** What the checks are asked about: one attempt on a scope, and the files attributed to it. */
export interface ChecksAsked {
  readonly missionId: string
  readonly buildingId: string
  readonly scope: AttemptScope
  /** The task, or the requirement; null for the end. */
  readonly subject: string | null
  readonly attemptId: string
  readonly files: ReadonlyArray<{ readonly repository: string; readonly path: string }>
}

/** One check's result in one place. */
export interface CheckResult {
  readonly name: string
  /** The repository it ran in; '' for the Workspace root. */
  readonly place: string
  readonly verdict: CheckVerdict
  readonly detail: string
  /** The end of what it printed. */
  readonly outputTail: string
  /** Its run, for the full output. */
  readonly runId: string | null
  /** The line as it ran, `{files}` filled (#143). */
  readonly line?: string | null
  readonly exitCode?: number | null
  /** The number its `expect` read. */
  readonly value?: number | null
  /** The trees it ran on (#140). */
  readonly trees?: ReadonlyArray<{ readonly repository: string; readonly tree: string }>
  /** The whole output kept as the mission's evidence, for a final check. */
  readonly evidenceId?: string | null
}

const encodeTrees = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ repository: Schema.String, tree: Schema.String })),
  ),
)

/** Keeps one check's result on its attempt, masked, as soon as it is known. */
export const keepCheckResult = (attemptId: string, result: CheckResult) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    yield* mutate('keeping a check', (transaction) =>
      transaction
        .insert(buildingCheckResults)
        .values({
          id: crypto.randomUUID(),
          attemptId,
          name: secrets.mask(result.name),
          place: result.place,
          verdict: result.verdict,
          detail: secrets.mask(result.detail),
          outputTail: secrets.mask(result.outputTail),
          runId: result.runId,
          at: new Date().toISOString(),
          line: result.line == null ? null : secrets.mask(result.line),
          exitCode: result.exitCode ?? null,
          value: result.value ?? null,
          trees: result.trees === undefined ? null : encodeTrees(result.trees),
          evidenceId: result.evidenceId ?? null,
        })
        .pipe(
          Effect.mapError(refusedWhile('keeping a check')),
          Effect.as({ result: undefined, events: [] }),
        ),
    )
  })

export class TaskChecks extends Context.Service<
  TaskChecks,
  { readonly run: (asked: ChecksAsked) => Effect.Effect<ReadonlyArray<CheckResult>> }
>()('TaskChecks') {}

/** No check until #143. */
export const noTaskChecks = Layer.succeed(TaskChecks, { run: () => Effect.succeed([]) })

/** Asks the checks about an attempt and keeps what they said on it; answers the results. */
export const checkAttempt = (
  asked: Omit<ChecksAsked, 'files'>,
  /** The files to judge when they are not the attempt's own: a scope's, its tasks'. */
  given?: ChecksAsked['files'],
) =>
  Effect.gen(function* () {
    const database = yield* Database
    // An attempt judged before a restart is not judged twice: its verdict and results stand.
    const [judged] = yield* database
      .select({ verdict: buildingAttempts.verdict })
      .from(buildingAttempts)
      .where(eq(buildingAttempts.id, asked.attemptId))
      .pipe(Effect.mapError(refusedWhile('reading the attempt')))
    const known = ATTEMPT_RESULTS.find((one) => one === judged?.verdict)
    if (known !== undefined) {
      return { verdict: known, results: yield* checkResultsIn(database, asked.attemptId) }
    }
    const files =
      given ??
      (yield* attributedIn(database, asked.attemptId)).map((one) => ({
        repository: one.repository,
        path: one.path,
      }))
    yield* TaskChecks.use((checks) => checks.run({ ...asked, files })).pipe(
      Effect.flatMap((answered) =>
        Effect.gen(function* () {
          // A port that keeps its results as they come (#143) has kept them already.
          const kept = yield* checkResultsIn(database, asked.attemptId)
          for (const result of answered) {
            if (kept.some((one) => one.name === result.name && one.place === result.place)) continue
            yield* keepCheckResult(asked.attemptId, result)
          }
        }),
      ),
    )
    const results = yield* checkResultsIn(database, asked.attemptId)
    const verdict = attemptResult(results.map((one) => one.verdict))
    yield* mutate('keeping the verdict of an attempt', (transaction) =>
      transaction
        .update(buildingAttempts)
        .set({ verdict })
        .where(eq(buildingAttempts.id, asked.attemptId))
        .pipe(
          Effect.mapError(refusedWhile('keeping the verdict')),
          Effect.as({ result: undefined, events: [] }),
        ),
    )
    return { verdict, results }
  })

/** The verdict of a finished task on `TaskChecks`: red, verified, or done without a check. */
export const checksVerdict = Layer.effect(
  TaskVerdict,
  Effect.gen(function* () {
    const context = yield* Effect.context<Database | DomainEvents | Secrets | TaskChecks>()
    return {
      judge: (asked) =>
        checkAttempt({
          missionId: asked.missionId,
          buildingId: asked.buildingId,
          scope: 'task',
          subject: asked.taskId,
          attemptId: asked.attemptId,
        }).pipe(
          Effect.map(({ verdict }) => JUDGED[verdict]),
          Effect.provide(context),
          Effect.orDie,
        ),
    }
  }),
)
