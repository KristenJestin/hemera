/**
 * The agents' processes: how the engine has main start one, and how it speaks to it afterwards.
 *
 * Only main can start a Node program in a packaged Hemera (`utilityProcess` is a main-process
 * API), so the engine asks main over its own link, main forks this application's agents'
 * process for the program named, hands one end of a fresh port to it and the other to the
 * engine, and steps out. What the program says never crosses main.
 *
 * The lines between the engine and the program are RPC streams on that port, in both
 * directions: the agents' process cuts its program's output into whole lines once, and the
 * acknowledgement of each stream item holds back a program that writes faster than the engine
 * reads, the same backpressure every other link has.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

/** Main could not start the agents' process at all. */
export class LaunchFailed extends Schema.TaggedError<LaunchFailed>()('LaunchFailed', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `An agent’s process could not be started: ${this.reason}`
  }
}

/** The agents' process is no longer there: its streams end with this. */
export class AgentsProcessGone extends Schema.TaggedError<AgentsProcessGone>()(
  'AgentsProcessGone',
  {},
) {
  override get message(): string {
    return 'An agent’s process stopped.'
  }
}

export const Started = Schema.TaggedStruct('Started', { pid: Schema.Number })
/** The code is the one `waitpid` or `GetExitCodeProcess` gave Electron; it reports no signal. */
export const Exited = Schema.TaggedStruct('Exited', { code: Schema.Number })
export const LaunchEvent = Schema.Union([Started, Exited])
export type LaunchEvent = typeof LaunchEvent.Type

/** What the engine asks main to start: a program, run inside the agents' process. */
export const AgentsLaunch = Schema.Struct({
  /** The engine's own number for this launch; the port main hands over carries it back. */
  launch: Schema.Number,
  program: Schema.String,
  args: Schema.Array(Schema.String),
  /**
   * What the program's environment holds over the agents' process's own: an agent's bare mode is
   * set through it (its own executable, its configuration, its timeouts).
   */
  environment: Schema.Record(Schema.String, Schema.String),
})
export type AgentsLaunch = typeof AgentsLaunch.Type

/** Served by main to the engine. The stream ends with the process. */
export const HostRpcs = RpcGroup.make(
  Rpc.make('agents.launch', {
    payload: AgentsLaunch,
    success: LaunchEvent,
    error: LaunchFailed,
    stream: true,
  }),
)

/**
 * Posted by main on the engine's process port with the port of one launch, once that launch has
 * started. A port cannot travel inside an RPC message, so it travels beside it.
 */
export const AgentsPortHandover = Schema.TaggedStruct('AgentsPort', { launch: Schema.Number })

export const Output = Schema.TaggedStruct('Output', { line: Schema.String })
export const Diagnostic = Schema.TaggedStruct('Diagnostic', { line: Schema.String })
/** A whole line the program wrote: on its output, or on its error output. */
export const AgentLine = Schema.Union([Output, Diagnostic])
export type AgentLine = typeof AgentLine.Type

/** Served by the agents' process to the engine. */
export const AgentsRpcs = RpcGroup.make(
  Rpc.make('agent.output', { success: AgentLine, error: AgentsProcessGone, stream: true }),
  Rpc.make('agent.write', {
    payload: { line: Schema.String },
    success: Schema.Void,
    error: AgentsProcessGone,
  }),
  Rpc.make('agent.end', { success: Schema.Void, error: AgentsProcessGone }),
)
