/**
 * The command tools: `commands_list`, `commands_run`, `commands_output` and `commands_stop`.
 *
 * A run goes through the run service of the catalogue, which refuses shell syntax with its clear
 * error, asks before running a command marked so, and supervises the process tree. `commands_run`
 * writes the intent of the run before it starts and its outcome when it ends; it answers when the
 * command ends or at its timeout, with the end of its output, and a run that outlasts it keeps
 * going, read with `commands_output`. A session reads and stops only the runs of its own mission
 * (or, for a session of a Project, its own runs). From its launch to its end, a run is watched by
 * the guard on the engine's Git (#457).
 */

import {
  OUTPUT_TAIL_LINES,
  ROLE_PLACES,
  ROOT_REPOSITORY,
  RUN_WAIT_SECONDS,
  type ToolArguments,
} from '@hemera/core/domain'
import type { Command, Run } from '@hemera/ipc'
import { Duration, Effect, Exit, Option, Predicate, Result, type Scope } from 'effect'

import { listCommands } from '../catalogue.ts'
import type { DomainEvents } from '../domain-events.ts'
import { GitGuard, actionIn } from '../git-guard.ts'
import { type RunServices, awaitRun, getRun, runOutput, startRun, stopRun } from '../runs.ts'
import type { Database } from '../storage/database.ts'
import type { Grant } from './access.ts'
import { type ActionOwner, EffectfulActions } from './actions.ts'
import { type ToolAnswer, answered, failure, refusal } from './files.ts'
import { WriteAttribution } from './ports.ts'

/** Whether the Planner (or another read-only role) may run a command: a read-only check only. */
export const runnableReadOnly = (command: Command): boolean => command.check && command.readOnly

/** The commands of the catalogue a session may run. */
const runnableBy = (grant: Grant, commands: ReadonlyArray<Command>) =>
  ROLE_PLACES[grant.role].readOnly ? commands.filter(runnableReadOnly) : commands

export const commandsList = (grant: Grant) =>
  Effect.gen(function* () {
    const commands = runnableBy(grant, yield* listCommands(grant.projectId))
    if (commands.length === 0) return answered('the catalogue holds no command you may run')
    const lines = commands.map(
      (command) =>
        `${command.id}  ${command.name}  ${command.type}${command.folder === null ? '' : `  in ${command.folder}`}  ${command.line}`,
    )
    return answered(['id  name  type  line', ...lines].join('\n'))
  })

/** The last lines of a run's output. */
const tailOf = (output: string, lines: number): string => {
  const all = output.replace(/\n$/, '').split('\n')
  return all.slice(-lines).join('\n')
}

/** A run as the agent reads it: its id, state, exit, and the end of its output. */
const describeRun = (run: Run, output: string, lines: number): string =>
  [
    `run ${run.id}: ${run.name} is ${run.state}`,
    run.exitCode === null ? null : `exit code ${String(run.exitCode)}`,
    run.url === null ? null : `address: ${run.url}`,
    run.state === 'running' || run.state === 'ready' || run.state === 'starting'
      ? 'it keeps going: read it with commands_output, stop it with commands_stop'
      : null,
    output === '' ? 'nothing printed' : `output (last lines):\n${tailOf(output, lines)}`,
  ]
    .filter((line) => line !== null)
    .join('\n')

/** Whether a run is the session's to read or stop: its mission's, or its own for a Project's. */
const ownsRun = (grant: Grant, run: Run): boolean =>
  run.projectId === grant.projectId &&
  (grant.missionId === null ? run.sessionId === grant.sessionId : run.missionId === grant.missionId)

const ownRun = (grant: Grant, id: string) =>
  getRun(id).pipe(
    Effect.map((run) => (ownsRun(grant, run) ? Option.some(run) : Option.none())),
    Effect.catchTag('UnknownRun', () => Effect.succeed(Option.none<Run>())),
  )

const notOurs = (grant: Grant, id: string): ToolAnswer =>
  refusal(
    `refused: ${id} is not a run ${grant.missionId === null ? 'this session' : 'this mission'} started`,
  )

/** What `commands_run` is asked, once the gate has found its command. */
export interface RunCall {
  readonly grant: Grant
  readonly owner: ActionOwner
  readonly command: Command | null
  /** The engine's scope, which a run's outcome is watched in after the call has answered. */
  readonly scope: Scope.Scope
}

export const commandsRun = (call: RunCall, args: ToolArguments<'commands_run'>) =>
  Effect.gen(function* () {
    const { grant, command } = call
    if (grant.workspaceId === null && !grant.mainCheckout) {
      return refusal('refused: commands run only in a Workspace or in the main checkout')
    }
    const actions = yield* EffectfulActions
    const line = command === null ? (args.line ?? '') : command.line
    const folder =
      command === null && args.repository !== undefined && args.repository !== ROOT_REPOSITORY
        ? args.repository
        : null
    // A writing command of a mission is watched: right before it launches it takes its
    // repository's write lock (waiting for another task's) and the snapshot before it; what it
    // changes is its task's (#142, CT-02).
    const watch =
      grant.missionId === null
        ? null
        : yield* WriteAttribution.use((attribution) =>
            attribution.command({
              sessionId: grant.sessionId,
              missionId: grant.missionId ?? '',
              command,
              line,
              folder,
            }),
          )
    const owner: ActionOwner =
      watch?.taskId != null && call.owner.kind === 'mission'
        ? { ...call.owner, taskId: watch.taskId }
        : call.owner
    const noted = (answer: ToolAnswer): ToolAnswer => {
      const note = watch?.note() ?? null
      return note === null ? answer : { ...answer, text: `${answer.text}\n\n${note}` }
    }
    // What shapes the engine's Git in the place is compared from the launch to the end (#457).
    const guard = yield* GitGuard
    const action = yield* actionIn(
      { projectId: grant.projectId, root: grant.place.root },
      command === null ? `ran ${line}` : `ran ${command.name}: ${line}`,
    )
    const stores = yield* Effect.context<Database | DomainEvents>()
    let closeGuard: Effect.Effect<void> = Effect.void
    const openGuard = Effect.flatMap(Effect.provide(guard.open(action), stores), (close) =>
      Effect.sync(() => {
        closeGuard = close
      }),
    )
    const guardClosed = Effect.suspend(() => {
      const close = closeGuard
      closeGuard = Effect.void
      return close
    })
    const details = { command: command?.id ?? null, line, folder, sessionId: grant.sessionId }
    // Written as the process launches: a run that waits for a reservation and is stopped first
    // never ran, and leaves no intent to be "maybe done" at a restart, only its record. It keeps
    // what a restart needs to attribute the run.
    let intent: string | null = null
    const begin = Effect.suspend(() =>
      Effect.map(
        actions.begin('command.run', owner, { ...details, ...(watch?.recorded() ?? {}) }),
        (id) => {
          intent = id
        },
      ),
    )
    const neverLaunched = (reason: string) =>
      Effect.flatMap(actions.begin('command.run', owner, details), (id) =>
        actions.failed(id, reason),
      )
    // From the start to the fork that watches the run's end, whatever ends this call (an
    // interrupt, a defect) lets the lock go: nothing else would.
    const started = yield* Effect.gen(function* () {
      const launched = yield* startRun({
        projectId: grant.projectId,
        workspaceId: grant.workspaceId,
        commandId: command?.id ?? null,
        line: command === null ? line : null,
        folder,
        startedBy: 'agent',
        sessionId: grant.sessionId,
        missionId: grant.missionId,
        intent: begin,
        beforeLaunch: watch === null ? openGuard : Effect.andThen(watch.launch, openGuard),
      }).pipe(Effect.result)
      if (Result.isFailure(launched)) return launched
      const run = launched.success
      // The outcome is written when the run ends, whenever that is: the call may answer before.
      // Its changes are attributed and its lock released first, so an outcome written says its
      // changes are already its task's.
      yield* awaitRun(run.id).pipe(
        Effect.tap(() => guardClosed),
        Effect.tap(() => (watch === null ? Effect.void : watch.finish(run.id))),
        Effect.flatMap((ended) =>
          intent === null
            ? neverLaunched(`it never launched: ${ended.state}`)
            : ended.exitCode === null && ended.state === 'failed'
              ? actions.failed(intent, 'it did not run')
              : actions.done(
                  intent,
                  ended.exitCode === null
                    ? ended.state
                    : `${ended.state}, exit code ${String(ended.exitCode)}`,
                ),
        ),
        Effect.ignore,
        Effect.andThen(watch === null ? Effect.void : watch.ended),
        Effect.ensuring(watch === null ? Effect.void : watch.finish(run.id)),
        Effect.ensuring(guardClosed),
        Effect.forkIn(call.scope),
      )
      return launched
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : Effect.andThen(guardClosed, watch === null ? Effect.void : watch.finish(null)),
      ),
    )
    if (Result.isFailure(started)) {
      yield* guardClosed
      const reason = started.failure.message
      yield* intent === null ? neverLaunched(reason) : actions.failed(intent, reason)
      if (watch !== null) yield* watch.finish(null)
      return noted(
        Predicate.isTagged(started.failure, 'ShellSyntax') ||
          Predicate.isTagged(started.failure, 'InvalidCommand')
          ? refusal(`refused: ${reason}`)
          : failure(`the command did not start: ${reason}`),
      )
    }
    const run = started.success
    const seconds = args.timeout ?? RUN_WAIT_SECONDS
    // Its changes are attributed once it ends: the call that waits for it answers after that. A
    // call that stops waiting first leaves it its lock: it is released, and what the run changed
    // attributed, when the run really ends (#142).
    const settled = (done: Run) =>
      watch === null ? Effect.succeed(done) : Effect.as(watch.settled, done)
    const ended =
      run.type === 'serve'
        ? run
        : yield* awaitRun(run.id).pipe(
            Effect.timeoutOption(Duration.seconds(seconds)),
            // Started for this call and waited for by it: an agent that stops waiting leaves
            // nobody to read it, and it is stopped rather than left behind.
            Effect.onInterrupt(() => stopRun(run.id).pipe(Effect.ignore)),
            Effect.flatMap((done) => (Option.isSome(done) ? settled(done.value) : getRun(run.id))),
          )
    const { output } = yield* runOutput(run.id)
    const text = describeRun(ended, output, OUTPUT_TAIL_LINES)
    return noted(
      ended.state === 'failed' && ended.exitCode === null ? failure(text) : answered(text),
    )
  })

export const commandsOutput = (grant: Grant, args: ToolArguments<'commands_output'>) =>
  Effect.gen(function* () {
    const run = yield* ownRun(grant, args.run)
    if (Option.isNone(run)) return notOurs(grant, args.run)
    const { output } = yield* runOutput(run.value.id)
    return answered(describeRun(run.value, output, args.tail ?? OUTPUT_TAIL_LINES))
  })

export const commandsStop = (grant: Grant, args: ToolArguments<'commands_stop'>) =>
  Effect.gen(function* () {
    const run = yield* ownRun(grant, args.run)
    if (Option.isNone(run)) return notOurs(grant, args.run)
    const stopped = yield* stopRun(run.value.id)
    return answered(`run ${stopped.id}: ${stopped.name} is ${stopped.state}`)
  })

export type CommandServices = RunServices | EffectfulActions | WriteAttribution | GitGuard
