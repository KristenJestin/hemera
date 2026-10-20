/**
 * The forge of each repository, as it crosses the links (#253): which forge and host it reviews on,
 * forced or detected from its remote, the forge's CLI (`gh`, `bkt`) with its version and the state
 * of its own sign-in, the command that fixes that state, and every change of it.
 *
 * Hemera never reads or stores a forge token: the state is what the CLI's own status says.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject, UnknownRepository } from './projects.ts'

/** The forges Hemera speaks to, each through its CLI. */
export const FORGES = ['github', 'bitbucket-cloud', 'bitbucket-datacenter'] as const
export const Forge = Schema.Literals(FORGES)
export type Forge = typeof Forge.Type

/** What a repository may be forced to: a forge, or `none` (no forge: forge steps are refused). */
export const ForcedForge = Schema.Literals([...FORGES, 'none'])
export type ForcedForge = typeof ForcedForge.Type

/** The forge a repository uses: one of them, none forced, or a host no forge was detected on. */
export const ForgeName = Schema.Literals([...FORGES, 'none', 'unknown'])
export type ForgeName = typeof ForgeName.Type

/** The CLI a forge is reached through. */
export const ForgeCli = Schema.Literals(['gh', 'bkt'])
export type ForgeCli = typeof ForgeCli.Type

/**
 * The state of a repository's forge CLI: found and signed in for its host, not found, found with
 * no account for that host, the check itself failed (network, timeout), or no forge to reach.
 */
export const CLI_STATES = ['ready', 'missing', 'signed-out', 'unreachable', 'not-needed'] as const
export const CliState = Schema.Literals(CLI_STATES)
export type CliState = typeof CliState.Type

/** One repository's forge and the state of its CLI, as the delivery rules show it. */
export const ForgeRepositoryStatus = Schema.Struct({
  repositoryId: Schema.String,
  /** The repository's path in its Project, as the Project shows it. */
  path: Schema.String,
  forge: ForgeName,
  /** The forge's host, or null when the remote says none and nothing is forced. */
  host: Schema.NullOr(Schema.String),
  /** The owner (GitHub), workspace (Cloud) or project key (Data Center), when the remote says. */
  owner: Schema.NullOr(Schema.String),
  slug: Schema.NullOr(Schema.String),
  /** Whether the forge was forced on this repository, rather than detected. */
  forced: Schema.Boolean,
  cli: Schema.NullOr(ForgeCli),
  /** The CLI's version, as it says it, once found. */
  version: Schema.NullOr(Schema.String),
  state: CliState,
  /** The command that fixes the state, shown as is and copyable; null when nothing is to fix. */
  fix: Schema.NullOr(Schema.String),
  /** What the CLI said when the check failed, masked; null otherwise. */
  detail: Schema.NullOr(Schema.String),
})
export type ForgeRepositoryStatus = typeof ForgeRepositoryStatus.Type

/** What a repository's forge allows, for its host and its CLI's version. */
export const ForgeCapabilities = Schema.Struct({
  runWorkflow: Schema.Boolean,
  rerun: Schema.Boolean,
  approveManualStep: Schema.Boolean,
  attachImage: Schema.Boolean,
  readBuildStatuses: Schema.Boolean,
  cliVersion: Schema.NullOr(Schema.String),
})
export type ForgeCapabilities = typeof ForgeCapabilities.Type

/** A forge call that failed: the forge's message verbatim, masked, and its command, masked. */
export class ForgeError extends Schema.TaggedError<ForgeError>()('ForgeError', {
  forge: ForgeName,
  host: Schema.String,
  command: Schema.String,
  exitCode: Schema.Number,
  message: Schema.String,
}) {}

/** A forge call cut at its limit. */
export class ForgeTimeout extends Schema.TaggedError<ForgeTimeout>()('ForgeTimeout', {
  forge: ForgeName,
  host: Schema.String,
  command: Schema.String,
  seconds: Schema.Number,
}) {
  override get message(): string {
    return `${this.command} did not answer within ${String(this.seconds)} seconds.`
  }
}

/** A forge call whose process could not run or died without an answer. */
export class ForgeUnreachable extends Schema.TaggedError<ForgeUnreachable>()('ForgeUnreachable', {
  forge: ForgeName,
  host: Schema.String,
  command: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `${this.command} could not run: ${this.reason}`
  }
}

/** A forge change refused: a host missing or not a host, a forge Hemera cannot reach. */
export class ForgeRefused extends Schema.TaggedError<ForgeRefused>()('ForgeRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone, UnknownProject] as const

export const ForgeRpcs = RpcGroup.make(
  /** Each repository of the Project: its forge, forced or detected, and its CLI's state. */
  Rpc.make('forge.status', {
    payload: { projectId: Schema.String },
    success: Schema.Array(ForgeRepositoryStatus),
    error: failing(...always),
  }),
  /** Checks the CLIs again at once, of one repository or of all; answers the Project's states. */
  Rpc.make('forge.checkAgain', {
    payload: { projectId: Schema.String, repositoryId: Schema.NullOr(Schema.String) },
    success: Schema.Array(ForgeRepositoryStatus),
    error: failing(...always, UnknownRepository),
  }),
  /**
   * Forces a repository's forge, with its host where the forge has no fixed one; null goes back to
   * detection. Answers the Project's states.
   */
  Rpc.make('forge.setForced', {
    payload: {
      projectId: Schema.String,
      repositoryId: Schema.String,
      forge: Schema.NullOr(ForcedForge),
      host: Schema.NullOr(Schema.String),
    },
    success: Schema.Array(ForgeRepositoryStatus),
    error: failing(...always, UnknownRepository, ForgeRefused),
  }),
  /** The Project's states after each change, for as long as the caller listens. */
  Rpc.make('forge.changes', {
    payload: { projectId: Schema.String },
    success: Schema.Array(ForgeRepositoryStatus),
    error: failing(...always),
    stream: true,
  }),
)
