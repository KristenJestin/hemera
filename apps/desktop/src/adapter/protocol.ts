/**
 * What the three programs of a bundled adapter say to each other (D5-21).
 *
 * A bundled adapter is a Node script, and only the main process can start one: `utilityProcess`
 * is an Electron API, the engine is itself a utility process, and the `runAsNode` fuse is off, so
 * no other way of running a script on Node is left. The engine therefore asks, the main process
 * forks, and the two ends of the conversation — the engine and the process the adapter runs in —
 * are joined by a `MessagePort` the main process hands over and then has nothing more to do with:
 * nothing of ACP crosses the main process.
 *
 * What the main process may be asked for is one thing and one thing only: this application's own
 * adapter bootstrap, with a module path as its argument. It is not a way of running a script.
 */

/**
 * What the engine asks the main process for, on the port it was forked with.
 *
 * Mutable on purpose, the way the supervisor's own options are: the ask is built in statements,
 * adding only the properties a caller named, so that an environment or a directory that is not
 * there is not a property at all.
 */
export interface AdapterAsk {
  channel: 'adapter'
  /** This application's own number for the launch, which every answer about it carries back. */
  id: number
  /** The adapter's own entry module, which the bootstrap loads in a worker of its own. */
  script: string
  args: readonly string[]
  env?: Record<string, string>
  cwd?: string
}

/** What the main process answers about a launch it was asked for. */
export type AdapterTell =
  | {
      readonly channel: 'adapter'
      readonly id: number
      readonly tell: 'started'
      /** The process the adapter runs in, which is the root of the tree a stop takes down. */
      readonly pid: number | undefined
    }
  | {
      readonly channel: 'adapter'
      readonly id: number
      readonly tell: 'exited'
      readonly code: number | null
    }
  | {
      readonly channel: 'adapter'
      readonly id: number
      readonly tell: 'failed'
      readonly cause: string
    }

/** What the engine puts on the adapter's port: a line for it, or the end of its input. */
export type AdapterInput = { readonly input: string } | { readonly end: true }

/** What the adapter's process puts on it: a line the adapter wrote, on one pipe or the other. */
export type AdapterOutput = { readonly output: string } | { readonly diagnostic: string }
