/**
 * How an agent's process is started for real: a bundled adapter (a Node script of Hemera's) is
 * forked by main as an agents' process and handed to #7's supervisor, which registers it and
 * stops its tree by pid; an agent that speaks ACP itself (`opencode acp`) is started by the
 * supervisor directly. Either way the runtime is handed the same lines in and out.
 */

import { AgentsProcessGone, Diagnostic, LaunchFailed, Output, type AgentLine } from '@hemera/ipc'
import { Effect, Layer, Queue, Stream } from 'effect'
import type { Scope } from 'effect'

import type { AgentsProcess } from '../agents.ts'
import { ProcessSupervisor } from '../supervisor.ts'
import type { ResolvedAgent } from './discovery.ts'
import { AgentStarter } from './runtime.ts'

/** Main's launch of an agents' process, as the engine holds it. */
export type Launch = (
  program: string,
  args: ReadonlyArray<string>,
  environment: Readonly<Record<string, string>>,
) => Effect.Effect<AgentsProcess, LaunchFailed, Scope.Scope>

const owner = (sessionId: string) => ({ kind: 'session' as const, id: sessionId })

/** A bundled adapter: forked by main, then registered with the supervisor like any child. */
const forked = (
  launch: Launch,
  resolved: ResolvedAgent,
  environment: Readonly<Record<string, string>>,
  sessionId: string,
) =>
  Effect.gen(function* () {
    const supervisor = yield* ProcessSupervisor
    const agents = yield* launch(resolved.program, resolved.args, environment)
    yield* supervisor.adopt(
      {
        pid: agents.pid,
        program: resolved.program,
        args: resolved.args,
        closeInput: Effect.ignore(agents.end),
        exited: Effect.map(agents.exited, (code) => ({
          code,
          signal: null,
          when: new Date().toISOString(),
        })),
      },
      { owner: owner(sessionId) },
    )
    return agents
  })

/** The agent's own command: started by the supervisor, its output cut into lines. */
const spawned = (
  resolved: ResolvedAgent,
  environment: Readonly<Record<string, string>>,
  sessionId: string,
) =>
  Effect.gen(function* () {
    const supervisor = yield* ProcessSupervisor
    const child = yield* supervisor
      .start(resolved.program, resolved.args, { env: environment, owner: owner(sessionId) })
      .pipe(Effect.mapError((failed) => new LaunchFailed({ reason: failed.reason })))
    const lines = yield* Queue.unbounded<AgentLine, AgentsProcessGone>()
    child.onStdout((line) => Queue.offerUnsafe(lines, Output.make({ line })))
    child.onStderr((line) => Queue.offerUnsafe(lines, Diagnostic.make({ line })))
    yield* child.exited.pipe(
      Effect.andThen(Queue.fail(lines, new AgentsProcessGone())),
      Effect.forkScoped,
    )
    return {
      pid: child.pid,
      output: Stream.fromQueue(lines),
      write: child.write,
      end: child.closeInput,
      exited: Effect.map(child.exited, (ended) => ended.code ?? -1),
    } satisfies AgentsProcess
  })

/** The starter of the engine, on main's launch and the supervisor. */
export const agentStarterLayer = (launch: Launch) =>
  Layer.effect(
    AgentStarter,
    Effect.map(Effect.context<ProcessSupervisor>(), (context) => ({
      start: (resolved, environment, sessionId) =>
        (resolved.from === 'bundled'
          ? forked(launch, resolved, environment, sessionId)
          : spawned(resolved, environment, sessionId)
        ).pipe(Effect.provide(context)),
    })),
  )
