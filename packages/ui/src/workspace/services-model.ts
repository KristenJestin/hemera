/**
 * What the variables, the services and the runs of a Workspace are handed (D8-06, D8-08).
 *
 * The design system's own shapes, not the domain's: plain data the application maps the engine's
 * rows onto, and nothing here decides anything.
 */

import type { CommandScope } from '../activity/command-type.ts'

/**
 * One environment variable, as the Project or a Workspace sets it (D8-06).
 *
 * A Workspace shows its own lines and the Project's lines that still apply to it, because what a
 * run receives is both: the Project's values, overridden by the Workspace's.
 */
export interface VariableLine {
  readonly key: string
  readonly value: string
  /** On a Workspace: the Project's value this one overrides, when it does. */
  readonly overrides?: string | undefined
  /** On a Workspace: true for a Project variable shown here because it applies, not set on the Workspace. */
  readonly inherited?: boolean | undefined
}

/**
 * Where a published address stands (D8-09): `starting` until it answers, `ready` once it has
 * answered anything at all, and `unanswered` after a minute of silence — still starting, and
 * said so rather than given up on.
 */
export type Readiness = 'starting' | 'ready' | 'unanswered'

/** A port another running run of the Project already holds (D8-09). */
export interface PortConflict {
  readonly port: number
  /** The holder's command name. */
  readonly holderRun: string
  /** The Workspace the holder runs in. */
  readonly holderWorkspace: string
}

/**
 * A run that published a port this one already held: the holder's side of a conflict, which
 * names the run that came second (D8-09, Decided 12).
 */
export interface PortClaim {
  readonly port: number
  /** The command name of the run that published the port after this one. */
  readonly run: string
  /** The Workspace that run is in. */
  readonly workspace: string
}

/**
 * One `serve` run, as the services of a Workspace list it (D8-08, D8-09, D8-10).
 *
 * Whoever started it: a service the agent started is a process the reader can see and stop.
 */
export interface ServiceLine {
  /** The run's own id: what stops this instance and no other. */
  readonly id: string
  readonly name: string
  /** The Workspace the run is in. */
  readonly workspace: string
  /** The folder it runs in, as the system writes it. */
  readonly folder: string
  /** One instance per Workspace, or one for the whole Project, run in `main` (D8-07). */
  readonly scope: CommandScope
  readonly state: 'running' | 'stopped' | 'failed'
  /** The address its output published, once it published one. */
  readonly url?: string | undefined
  readonly readiness?: Readiness | undefined
  readonly portConflict?: PortConflict | undefined
  /** On the holder: the runs that published its port after it, each named (Decided 12). */
  readonly heldAgainst?: readonly PortClaim[] | undefined
  /** Whether the line runs through Portless, which names the address itself (D8-10). */
  readonly portless?: boolean | undefined
  /** What a failed run said, as it said it. */
  readonly message?: string | undefined
  readonly startedBy: 'agent' | 'user'
}
