/**
 * The command catalogue and its runs, as they cross the links.
 *
 * A catalogue command is declared once per Project and run by whoever needs it: the user from the
 * Project page, Hemera's own rules (the preparation recipe, the commands run at each opening), and
 * later the agents. A run is one process tree of a command, or of a free line, in a Workspace or
 * in the main checkout.
 */

import {
  COMMAND_SCOPES,
  COMMAND_TYPES,
  InvalidCommand,
  InvalidRepositoryPath,
  InvalidTemplate,
  RUN_STARTERS,
  RUN_STATES,
  ShellSyntax,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject, UnknownRepository } from './projects.ts'
import { UnknownWorkspace } from './workspaces.ts'

export { InvalidCommand, ShellSyntax }

export const CommandType = Schema.Literals(COMMAND_TYPES)
export const CommandScope = Schema.Literals(COMMAND_SCOPES)
export const RunState = Schema.Literals(RUN_STATES)
export const RunStarter = Schema.Literals(RUN_STARTERS)

/**
 * A command as the settings write it. A `serve` command is a service: a long-running process whose
 * address is read from its output. The other roles are flags, in any combination.
 */
export const CommandDraft = Schema.Struct({
  name: Schema.String,
  type: CommandType,
  /** The line every system runs, unless it has its own below. */
  line: Schema.String,
  lineWindows: Schema.NullOr(Schema.String),
  lineLinux: Schema.NullOr(Schema.String),
  /** The repository it runs under, or null for the root. */
  repositoryId: Schema.NullOr(Schema.String),
  /** The folder under that repository, or null for the repository itself. */
  folder: Schema.NullOr(Schema.String),
  /** For a `serve`: once per Workspace, or once for the Project in its main checkout. */
  scope: CommandScope,
  /** For a `serve`: whether its line runs through Portless, and the name it runs under. */
  portless: Schema.Boolean,
  portlessName: Schema.NullOr(Schema.String),
  /** May be used as a check. */
  check: Schema.Boolean,
  /** Run once per Project, in its main checkout, each time Hemera opens. */
  atOpen: Schema.Boolean,
  /** Never run, by anyone, without the user's permission. */
  askBeforeRunning: Schema.Boolean,
  /** Writes nothing in the repository. */
  readOnly: Schema.Boolean,
  /** The files it may write (while it runs, for a `serve`), relative to its folder. */
  writeGlobs: Schema.Array(Schema.String),
})
export type CommandDraft = typeof CommandDraft.Type

export const Command = Schema.Struct({
  ...CommandDraft.fields,
  id: Schema.String,
  projectId: Schema.String,
})
export type Command = typeof Command.Type

/** A command saved: a new one when `id` is null, the command `id` rewritten otherwise. */
export const CommandSave = Schema.Struct({
  projectId: Schema.String,
  id: Schema.NullOr(Schema.String),
  command: CommandDraft,
})
export type CommandSave = typeof CommandSave.Type

/** What is wrong with a line as it is typed, or nothing. */
export const LineCheck = Schema.Struct({ problem: Schema.NullOr(Schema.String) })
export type LineCheck = typeof LineCheck.Type

/** The run of the Project that holds the port another run published. */
export const PortConflict = Schema.Struct({
  port: Schema.Number,
  runId: Schema.String,
  name: Schema.String,
})
export type PortConflict = typeof PortConflict.Type

export const Run = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  /** The Workspace it runs in, or null for the main checkout. */
  workspaceId: Schema.NullOr(Schema.String),
  /** The catalogue command it runs, or null for a free line. */
  commandId: Schema.NullOr(Schema.String),
  name: Schema.String,
  type: CommandType,
  /** The line as it ran: this system's own, its template names filled. */
  line: Schema.String,
  /** The folder it runs in, absolute. */
  folder: Schema.String,
  startedBy: RunStarter,
  /** The agent's session that started it, when one did. */
  sessionId: Schema.NullOr(Schema.String),
  /** The mission it was started for, which a cancel of that mission stops. */
  missionId: Schema.NullOr(Schema.String),
  state: RunState,
  exitCode: Schema.NullOr(Schema.Number),
  /** The address a service published, or null while it has published none. */
  url: Schema.NullOr(Schema.String),
  portConflict: Schema.NullOr(PortConflict),
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
})
export type Run = typeof Run.Type

/** A run to start: a catalogue command, or a free line in a folder under the place. */
export const RunStart = Schema.Struct({
  projectId: Schema.String,
  /** The Workspace, or null for the main checkout. */
  workspaceId: Schema.NullOr(Schema.String),
  commandId: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.String),
  /** For a free line: the folder under the place, or null for its root. */
  folder: Schema.NullOr(Schema.String),
})
export type RunStart = typeof RunStart.Type

/** The last of what a run printed, and how many characters before it were dropped. */
export const RunOutput = Schema.Struct({ output: Schema.String, dropped: Schema.Number })
export type RunOutput = typeof RunOutput.Type

export class UnknownCommand extends Schema.TaggedError<UnknownCommand>()('UnknownCommand', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This command is no longer in the catalogue.'
  }
}

export class UnknownRun extends Schema.TaggedError<UnknownRun>()('UnknownRun', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This run is not known to Hemera.'
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

/** A Project's command catalogue: listed, saved, removed, and a line checked as it is typed. */
export const CatalogueRpcs = RpcGroup.make(
  Rpc.make('catalogue.list', {
    payload: { projectId: Schema.String },
    success: Schema.Array(Command),
    error: failing(...always, UnknownProject),
  }),
  Rpc.make('catalogue.save', {
    payload: CommandSave,
    success: Command,
    error: failing(
      ...always,
      UnknownProject,
      UnknownCommand,
      UnknownRepository,
      InvalidCommand,
      InvalidRepositoryPath,
      InvalidTemplate,
      ShellSyntax,
    ),
  }),
  Rpc.make('catalogue.remove', {
    payload: { projectId: Schema.String, id: Schema.String },
    success: Schema.Void,
    error: failing(...always, UnknownProject, UnknownCommand),
  }),
  /** What saving a line would refuse, for the field that is being typed. */
  Rpc.make('catalogue.checkLine', {
    payload: { line: Schema.String },
    success: LineCheck,
    error: failing(...always),
  }),
)

/**
 * The runs: listed per place, started, stopped (a grace, then the whole tree), restarted, and
 * read; `changes` is each run as it changes, for as long as the caller listens.
 */
export const RunsRpcs = RpcGroup.make(
  Rpc.make('runs.list', {
    payload: { projectId: Schema.String, workspaceId: Schema.NullOr(Schema.String) },
    success: Schema.Array(Run),
    error: failing(...always, UnknownProject, UnknownWorkspace),
  }),
  Rpc.make('runs.start', {
    payload: RunStart,
    success: Run,
    error: failing(
      ...always,
      UnknownProject,
      UnknownWorkspace,
      UnknownCommand,
      InvalidCommand,
      InvalidRepositoryPath,
      InvalidTemplate,
      ShellSyntax,
    ),
  }),
  Rpc.make('runs.stop', {
    payload: { id: Schema.String },
    success: Run,
    error: failing(...always, UnknownRun),
  }),
  Rpc.make('runs.restart', {
    payload: { id: Schema.String },
    success: Run,
    error: failing(
      ...always,
      UnknownRun,
      UnknownProject,
      UnknownWorkspace,
      UnknownCommand,
      InvalidCommand,
      InvalidRepositoryPath,
      InvalidTemplate,
      ShellSyntax,
    ),
  }),
  Rpc.make('runs.output', {
    payload: { id: Schema.String },
    success: RunOutput,
    error: failing(...always, UnknownRun),
  }),
  Rpc.make('runs.changes', { success: Run, error: failing(...always), stream: true }),
)
