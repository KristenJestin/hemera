/**
 * The step types this ticket runs (S1): Confirm, Command, Agent, and #464's commit, push and pull
 * request placed in the waves. The forge ones (Merge, CI, Version published, Bump, the action on
 * the remote) come with S2 to S4 and register here beside them.
 *
 * - **Confirm**: "I did it", always the user's click; done once clicked.
 * - **Command**: a command of the catalogue, run by Hemera through the runs (#7): its time limits,
 *   its supervisor, its "ask before running" (a permission need of the mission first; Deny fails
 *   the step with "denied") and its exclusive resources (#88). Done when it exits 0, failed with
 *   the end of its output otherwise. It has no post-condition: cut off midway, it is the user's.
 * - **Commit, push, pull request**: what Ship handed to #464 for the repository, read: done once
 *   its push has ended, with its commit or its pull request. A push again in the middle of the
 *   delivery (after a bump) is S3's.
 */

import { and, desc, eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'

import { NOT_ALLOWED, type RunServices, awaitRun, runOutput, startRun, stopRun } from '../runs.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { commandRuns } from '../storage/schema.ts'
import { agentStepType } from './agent-step.ts'
import { Pushes } from './pushes.ts'
import { DeliveryStepTypes, type StepType, done, failed, notDone, waiting } from './steps.ts'

/** How much of a command's output a failure keeps: its end, where the error is. */
export const OUTPUT_TAIL = 2_000

const tail = (output: string) =>
  output.length <= OUTPUT_TAIL ? output : `…${output.slice(output.length - OUTPUT_TAIL)}`

/** "I did it": always the user's click, done once clicked. */
export const confirmType: StepType = {
  postCondition: true,
  acts: false,
  forge: false,
  alwaysClick: true,
  click: (at) => ({
    question: at.step.kind === 'confirm' ? at.step.what : `Confirm in ${at.repository}`,
    go: 'Done',
  }),
  // Hemera cannot see it: only the click says it is done.
  check: () => Effect.succeed(notDone),
  run: () => Effect.succeed(done('confirmed')),
}

type Engaged = RunServices | Pushes

const typesOf = Effect.gen(function* () {
  const context = yield* Effect.context<Engaged>()

  /** The last run of the step's command in the mission: its output, for a step cut midway. */
  const lastRunOutput = (missionId: string, commandId: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      const [row] = yield* database
        .select({ output: commandRuns.output })
        .from(commandRuns)
        .where(and(eq(commandRuns.missionId, missionId), eq(commandRuns.commandId, commandId)))
        .orderBy(desc(commandRuns.startedAt))
        .limit(1)
        .pipe(Effect.mapError(refusedWhile('reading a delivery command’s output')))
      return row === undefined ? null : tail(row.output)
    })

  const commandType: StepType = {
    postCondition: false,
    acts: true,
    forge: false,
    check: () => Effect.succeed(notDone),
    run: (at) =>
      Effect.gen(function* () {
        if (at.step.kind !== 'command') return failed(`${at.step.kind} is not a command.`)
        const run = yield* startRun({
          projectId: at.projectId,
          workspaceId: at.workspaceId,
          commandId: at.step.commandId,
          line: null,
          folder: null,
          startedBy: 'hemera',
          sessionId: null,
          missionId: at.missionId,
        })
        // Started for this step and judged by it: a Stop delivery stops it.
        const ended = yield* awaitRun(run.id).pipe(
          Effect.onInterrupt(() => stopRun(run.id).pipe(Effect.ignore)),
        )
        const { output } = yield* runOutput(run.id)
        if (ended.exitCode === 0) return done('exit 0')
        if (output.includes(NOT_ALLOWED)) return failed('denied')
        const code = ended.exitCode === null ? ended.state : `exit ${String(ended.exitCode)}`
        return failed(output.trim() === '' ? code : `${code}\n${tail(output)}`)
      }).pipe(
        Effect.catch((failure) => Effect.succeed(failed(failure.message))),
        Effect.provide(context),
      ),
    lastOutput: (at) =>
      at.step.kind === 'command'
        ? lastRunOutput(at.missionId, at.step.commandId).pipe(
            Effect.orElseSucceed(() => null),
            Effect.provide(context),
          )
        : Effect.succeed(null),
  }

  /** What #464 did for the repository: done once its push ended, never pushed again here. */
  const pushedType: StepType = {
    postCondition: true,
    acts: false,
    forge: false,
    check: (at) =>
      Pushes.use((pushes) => pushes.pushes(at.missionId)).pipe(
        Effect.map((all) => {
          const push = all.repositories.find((one) => one.repositoryId === at.repositoryId)
          if (push === undefined) {
            return waiting(
              `${at.repository} had nothing to push at Ship: a push in the middle of the delivery comes with the bumps.`,
            )
          }
          switch (push.state) {
            case 'done':
              return at.step.kind === 'pull-request' && push.pullRequest !== null
                ? done(`#${String(push.pullRequest.number)}`)
                : done(push.commit === null ? 'pushed' : push.commit.slice(0, 7))
            case 'failed':
            case 'indeterminate':
              return waiting(`The push of ${at.repository} has not ended: its need waits for you.`)
            case 'declined':
              return waiting(`The push of ${at.repository} was declined.`)
            default:
              return waiting(`The push of ${at.repository} has not ended yet.`)
          }
        }),
        Effect.catch((failure) => Effect.succeed(waiting(failure.message))),
        Effect.provide(context),
      ),
    run: (at) => pushedType.check(at),
  }

  return new Map<string, StepType>([
    ['confirm', confirmType],
    ['command', commandType],
    ['agent', yield* agentStepType],
    ['commit-by-hemera', pushedType],
    ['push', pushedType],
    ['pull-request', pushedType],
  ])
})

/** The registry, with what a suite or a later ticket puts over it. */
export const stepTypesLive = (over: ReadonlyMap<string, StepType> = new Map()) =>
  Layer.effect(
    DeliveryStepTypes,
    Effect.map(typesOf, (types) => new Map<string, StepType>([...types, ...over])),
  )
