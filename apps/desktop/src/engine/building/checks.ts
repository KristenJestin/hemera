/**
 * Where a Building's attempts are judged (#142): the `TaskChecks` port, which #143 fills with the
 * checks themselves, and the verdict of a finished task on it. Until #143, no check answers: a
 * finished task is done, not verified.
 *
 * A check is asked about one attempt on a scope (a task, a requirement's checks, the end) with the
 * files attributed to it (CT-02), and answers one result per check and place. Its results are kept
 * on the attempt; any red makes the attempt red, else any green green, else not verified.
 */

import {
  ATTEMPT_RESULTS,
  type AttemptResult,
  type AttemptScope,
  type CheckVerdict,
  attemptResult,
} from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

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
}

export class TaskChecks extends Context.Service<
  TaskChecks,
  { readonly run: (asked: ChecksAsked) => Effect.Effect<ReadonlyArray<CheckResult>> }
>()('TaskChecks') {}

/** No check until #143. */
export const noTaskChecks = Layer.succeed(TaskChecks, { run: () => Effect.succeed([]) })

/** Asks the checks about an attempt and keeps what they said on it; answers the results. */
export const checkAttempt = (asked: Omit<ChecksAsked, 'files'>) =>
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
    const files = (yield* attributedIn(database, asked.attemptId)).map((one) => ({
      repository: one.repository,
      path: one.path,
    }))
    const results = yield* TaskChecks.use((checks) => checks.run({ ...asked, files }))
    const verdict = attemptResult(results.map((one) => one.verdict))
    const secrets = yield* Secrets
    const at = new Date().toISOString()
    yield* mutate('keeping the checks of an attempt', (transaction) =>
      Effect.gen(function* () {
        for (const result of results) {
          yield* transaction
            .insert(buildingCheckResults)
            .values({
              id: crypto.randomUUID(),
              attemptId: asked.attemptId,
              name: secrets.mask(result.name),
              place: result.place,
              verdict: result.verdict,
              detail: secrets.mask(result.detail),
              outputTail: secrets.mask(result.outputTail),
              runId: result.runId,
              at,
            })
            .pipe(Effect.mapError(refusedWhile('keeping a check')))
        }
        yield* transaction
          .update(buildingAttempts)
          .set({ verdict })
          .where(eq(buildingAttempts.id, asked.attemptId))
          .pipe(Effect.mapError(refusedWhile('keeping the verdict')))
        return { result: undefined, events: [] }
      }),
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
