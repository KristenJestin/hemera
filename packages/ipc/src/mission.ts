/**
 * What a mission's Workspace holds beside the agents' work (#148): the changes made outside Hemera,
 * per repository, with the contents of each side, and the mission's services, started, stopped,
 * restarted and dismissed by the user. `focused` is the window regaining the focus, which compares
 * the Workspaces and reads the bases again; `changed` names each mission whose changes outside
 * Hemera or services changed, for as long as the caller listens.
 */

import {
  InvalidCommand,
  InvalidRepositoryPath,
  InvalidTemplate,
  RUN_STARTERS,
  ShellSyntax,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { UnknownCommand, UnknownRun } from './commands.ts'
import { EngineGone } from './gone.ts'
import { UnknownMission } from './missions.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'
import { UnknownWorkspace } from './workspaces.ts'

/** One side of a file changed outside Hemera: its fingerprint and size, or why it was withheld. */
export const OutsideSide = Schema.Struct({
  sha256: Schema.String,
  size: Schema.Number,
  withheld: Schema.NullOr(Schema.String),
})
export type OutsideSide = typeof OutsideSide.Type

/** The command that overwrote a change made outside Hemera, with its run and its task. */
export const OverwrittenBy = Schema.Struct({
  command: Schema.String,
  runId: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  task: Schema.NullOr(Schema.String),
  at: Schema.String,
})
export type OverwrittenBy = typeof OverwrittenBy.Type

/** A file changed outside Hemera: its path, Git's letter, when it was found, and its sides. */
export const OutsideChange = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  oldPath: Schema.NullOr(Schema.String),
  status: Schema.String,
  detectedAt: Schema.String,
  before: Schema.NullOr(OutsideSide),
  after: Schema.NullOr(OutsideSide),
  overwrittenBy: Schema.NullOr(OverwrittenBy),
})
export type OutsideChange = typeof OutsideChange.Type

/** The changes outside Hemera of one repository of the Workspace, oldest first. */
export const OutsideRepository = Schema.Struct({
  repository: Schema.String,
  /** The Project's repository, which the mark names; null for one the Project no longer has. */
  repositoryId: Schema.NullOr(Schema.String),
  changes: Schema.Array(OutsideChange),
})
export type OutsideRepository = typeof OutsideRepository.Type

/** One side's content as Hemera kept it: the text (masked), or why it was withheld. */
export const OutsideContent = Schema.Struct({
  content: Schema.NullOr(Schema.String),
  withheld: Schema.NullOr(Schema.String),
})

/** Both sides of a change made outside Hemera, readable after the Workspace is gone. */
export const OutsideContents = Schema.Struct({
  path: Schema.String,
  before: Schema.NullOr(OutsideContent),
  after: Schema.NullOr(OutsideContent),
})
export type OutsideContents = typeof OutsideContents.Type

/** Where a service stands, as the mission shows it. */
export const SERVICE_STATES = ['starting', 'ready', 'not answering', 'stopped', 'failed'] as const
export const ServiceState = Schema.Literals(SERVICE_STATES)
export type ServiceState = typeof ServiceState.Type

/** A service of the mission's Workspace: the last run of a `serve` command of the catalogue. */
export const MissionService = Schema.Struct({
  runId: Schema.String,
  commandId: Schema.NullOr(Schema.String),
  name: Schema.String,
  state: ServiceState,
  url: Schema.NullOr(Schema.String),
  startedBy: Schema.Literals(RUN_STARTERS),
  sessionId: Schema.NullOr(Schema.String),
  since: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  /** The end of its output, masked; the whole run is read with `runs.output`. */
  outputTail: Schema.String,
  /** A stopped one may be dismissed from the list; a running one is stopped by its ×. */
  dismissable: Schema.Boolean,
})
export type MissionService = typeof MissionService.Type

/** A service act the mission refuses, in words: dismissing a running one, a run of elsewhere. */
export class ServiceRefused extends Schema.TaggedError<ServiceRefused>()('ServiceRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `Refused: ${this.reason}.`
  }
}

/** An outside change the mission does not have. */
export class UnknownOutsideChange extends Schema.TaggedError<UnknownOutsideChange>()(
  'UnknownOutsideChange',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This change is not known to Hemera.'
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const startErrors = [
  ...always,
  UnknownMission,
  UnknownProject,
  UnknownWorkspace,
  UnknownCommand,
  InvalidCommand,
  InvalidRepositoryPath,
  InvalidTemplate,
  ShellSyntax,
  ServiceRefused,
] as const

export const MissionRpcs = RpcGroup.make(
  Rpc.make('mission.outsideChanges', {
    payload: { missionId: Schema.String },
    success: Schema.Array(OutsideRepository),
    error: failing(...always, UnknownMission),
  }),
  Rpc.make('mission.outsideContents', {
    payload: { missionId: Schema.String, changeId: Schema.String },
    success: OutsideContents,
    error: failing(...always, UnknownOutsideChange),
  }),
  Rpc.make('mission.services', {
    payload: { missionId: Schema.String },
    success: Schema.Array(MissionService),
    error: failing(...always, UnknownMission),
  }),
  Rpc.make('mission.serviceStart', {
    payload: { missionId: Schema.String, commandId: Schema.String },
    success: MissionService,
    error: failing(...startErrors),
  }),
  Rpc.make('mission.serviceStop', {
    payload: { missionId: Schema.String, runId: Schema.String },
    success: MissionService,
    error: failing(...always, UnknownMission, UnknownRun, ServiceRefused),
  }),
  Rpc.make('mission.serviceRestart', {
    payload: { missionId: Schema.String, runId: Schema.String },
    success: MissionService,
    error: failing(...startErrors, UnknownRun),
  }),
  Rpc.make('mission.serviceDismiss', {
    payload: { missionId: Schema.String, runId: Schema.String },
    success: Schema.Void,
    error: failing(...always, UnknownMission, UnknownRun, ServiceRefused),
  }),
  /** The window regained the focus: the Workspaces are compared and the bases read again. */
  Rpc.make('mission.focused', { success: Schema.Void, error: failing(...always) }),
  Rpc.make('mission.changed', {
    success: Schema.String,
    error: failing(...always),
    stream: true,
  }),
)
