/**
 * A Project's ticket providers and its Spec mode (#95), as the window reads and changes them. The
 * settings screens are #104's. No credential crosses this link: GitHub goes through `gh`, which
 * keeps its own.
 */

import {
  CanonicalTicket,
  ProviderKind,
  ProviderStatus,
  SpecMode,
  TicketVersion,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

/** A provider of a Project, with the outage it is in, if any. */
export const TicketProviderInfo = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  kind: ProviderKind,
  /** GitHub: `github.com` or an Enterprise host `gh` knows. */
  host: Schema.String,
  /** The `owner/repo` repositories its search watches. */
  repositories: Schema.Array(Schema.String),
  /** Since when it has been unreachable; null when the last read or check succeeded. */
  unreachableSince: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
})
export type TicketProviderInfo = typeof TicketProviderInfo.Type

/** A GitHub provider as the user sets it: its host and the repositories its search watches. */
export const GithubProviderConfig = Schema.Struct({
  host: Schema.String,
  repositories: Schema.Array(Schema.String),
})
export type GithubProviderConfig = typeof GithubProviderConfig.Type

export class UnknownTicketProvider extends Schema.TaggedError<UnknownTicketProvider>()(
  'UnknownTicketProvider',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This ticket provider no longer exists.'
  }
}

export class InvalidProviderConfig extends Schema.TaggedError<InvalidProviderConfig>()(
  'InvalidProviderConfig',
  { reason: Schema.String },
) {
  override get message(): string {
    return `This provider cannot be saved: ${this.reason}.`
  }
}

/** A provider a live mission's ticket comes from: removing it is refused, the missions named. */
export class ProviderInUse extends Schema.TaggedError<ProviderInUse>()('ProviderInUse', {
  missionKeys: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `This provider reads the ticket of ${this.missionKeys.join(', ')}: it cannot be removed while ${this.missionKeys.length === 1 ? 'that mission is' : 'those missions are'} live.`
  }
}

/** The ticket a mission comes from: its link, the version its Spec is built from, the last read. */
export const MissionTicket = Schema.Struct({
  missionId: Schema.String,
  /** The provider that reads it; null once that provider was removed. */
  providerId: Schema.NullOr(Schema.String),
  reference: CanonicalTicket,
  key: Schema.String,
  url: Schema.NullOr(Schema.String),
  /** The Project's Spec mode when the mission was linked. */
  mode: SpecMode,
  /** Null while the ticket could not be read yet. */
  base: Schema.NullOr(TicketVersion),
  last: Schema.NullOr(TicketVersion),
})
export type MissionTicket = typeof MissionTicket.Type

/** A reference no provider of the Project reads. */
export class NoProviderReads extends Schema.TaggedError<NoProviderReads>()('NoProviderReads', {
  key: Schema.String,
}) {
  override get message(): string {
    return `No ticket provider of this Project reads ${this.key}.`
  }
}

/** A Project's ticket settings: its Spec mode and its providers, in the order they were added. */
export const TicketsSettings = Schema.Struct({
  projectId: Schema.String,
  specMode: SpecMode,
  providers: Schema.Array(TicketProviderInfo),
})
export type TicketsSettings = typeof TicketsSettings.Type

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const ofProject = { projectId: Schema.String }
const ofProvider = { providerId: Schema.String }

export const TicketsRpcs = RpcGroup.make(
  Rpc.make('tickets.providers', {
    payload: ofProject,
    success: Schema.Array(TicketProviderInfo),
    error: failing(...always),
  }),
  /** The repositories of the Project whose remote points to the host: proposed, never recorded. */
  Rpc.make('tickets.proposeGithub', {
    payload: { projectId: Schema.String, host: Schema.String },
    success: Schema.Array(Schema.String),
    error: failing(...always, UnknownProject),
  }),
  Rpc.make('tickets.addGithub', {
    payload: { projectId: Schema.String, config: GithubProviderConfig },
    success: TicketProviderInfo,
    error: failing(...always, UnknownProject, InvalidProviderConfig),
  }),
  Rpc.make('tickets.updateProvider', {
    payload: { providerId: Schema.String, config: GithubProviderConfig },
    success: TicketProviderInfo,
    error: failing(...always, UnknownTicketProvider, InvalidProviderConfig),
  }),
  /** Refused while a live mission's ticket comes from it, the missions named. */
  Rpc.make('tickets.removeProvider', {
    payload: ofProvider,
    success: Schema.Void,
    error: failing(...always, UnknownTicketProvider, ProviderInUse),
  }),
  /** What the provider can do now, its sentence and the command that fixes it. */
  Rpc.make('tickets.status', {
    payload: ofProvider,
    success: ProviderStatus,
    error: failing(...always, UnknownTicketProvider),
  }),
  /** "Check again": the status now, the outage cleared or said, the unread tickets read. */
  Rpc.make('tickets.checkAgain', {
    payload: ofProvider,
    success: ProviderStatus,
    error: failing(...always, UnknownTicketProvider),
  }),
  Rpc.make('tickets.specMode', {
    payload: ofProject,
    success: SpecMode,
    error: failing(...always, UnknownProject),
  }),
  Rpc.make('tickets.setSpecMode', {
    payload: { projectId: Schema.String, mode: SpecMode },
    success: SpecMode,
    error: failing(...always, UnknownProject),
  }),
  /** The ticket a mission comes from, its base and last known versions; null for none. */
  Rpc.make('tickets.ticket', {
    payload: { missionId: Schema.String },
    success: Schema.NullOr(MissionTicket),
    error: failing(...always),
  }),
  /** The Project's ticket settings now, then again after each change. */
  Rpc.make('tickets.changed', {
    payload: ofProject,
    success: TicketsSettings,
    error: failing(...always, UnknownProject),
    stream: true,
  }),
)
