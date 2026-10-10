/**
 * A Project's ticket providers and its Spec mode (#95), as the window reads and changes them. The
 * settings screens are #104's. GitHub goes through `gh`, which keeps its own credential. Jira's
 * API token (#96) crosses one link once, from the window to main, which seals it: the window never
 * receives it back, and the engine stores only its ciphertext.
 */

import {
  CanonicalTicket,
  ProviderKind,
  ProviderStatus,
  SpecMode,
  TicketEventKind,
  TicketEventMatters,
  TicketEventState,
  TicketVersion,
  TicketWriteState,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

/** Jira Cloud or Jira Data Center: REST v3 and Basic auth, or REST v2 and a Bearer token. */
export const JiraDeployment = Schema.Literals(['cloud', 'datacenter'])
export type JiraDeployment = typeof JiraDeployment.Type

/**
 * A Jira provider as the user sets it: its site (`https://acme.atlassian.net`, or a self-hosted
 * URL), its deployment, the account email (Cloud only), and the Jira project keys its search
 * covers. Never the token.
 */
export const JiraProviderConfig = Schema.Struct({
  site: Schema.String,
  deployment: JiraDeployment,
  email: Schema.NullOr(Schema.String),
  projectKeys: Schema.Array(Schema.String),
})
export type JiraProviderConfig = typeof JiraProviderConfig.Type

/** A provider of a Project, with the outage it is in, if any. */
export const TicketProviderInfo = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  kind: ProviderKind,
  /** GitHub: `github.com` or an Enterprise host `gh` knows; Jira: its site's host. */
  host: Schema.String,
  /** The `owner/repo` repositories its search watches (GitHub; none for Jira). */
  repositories: Schema.Array(Schema.String),
  /** A Jira provider's configuration; null for GitHub. */
  jira: Schema.NullOr(JiraProviderConfig),
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

/** The remote Spec mode was asked of a Project with no ticket provider to write into. */
export class NoProviderToWrite extends Schema.TaggedError<NoProviderToWrite>()(
  'NoProviderToWrite',
  { projectId: Schema.String },
) {
  override get message(): string {
    return 'Remote Specs are written into tickets: add a ticket provider to this Project first.'
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

/**
 * Where a Jira provider's token stands: none saved; saved; `invalid` (Jira refused it, or this
 * system cannot decrypt it); or the system offers no protected storage, so nothing is stored.
 */
export const JiraTokenStatus = Schema.Literals([
  'missing',
  'saved',
  'invalid',
  'storage-unavailable',
])
export type JiraTokenStatus = typeof JiraTokenStatus.Type

/** What the engine answers a token it was asked to keep: checked and stored, or refused by Jira. */
export const JiraTokenCheck = Schema.Literals(['saved', 'invalid'])
export type JiraTokenCheck = typeof JiraTokenCheck.Type

/** A Jira token as the engine keeps it, for main: its ciphertext, and whether Jira refused it. */
export const JiraTokenState = Schema.Struct({
  ciphertext: Schema.NullOr(Schema.String),
  refused: Schema.Boolean,
})
export type JiraTokenState = typeof JiraTokenState.Type

/** Main could not open a sealed token: no protected storage now, or sealed elsewhere. */
export class TokenUnreadable extends Schema.TaggedError<TokenUnreadable>()('TokenUnreadable', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `The saved Jira token cannot be read on this system: ${this.reason}.`
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

/** What a `ticket-event` session reported of an event (#97). */
export const TicketEventAnalysis = Schema.Struct({
  summary: Schema.String,
  matters: TicketEventMatters,
  why: Schema.String,
  at: Schema.String,
})
export type TicketEventAnalysis = typeof TicketEventAnalysis.Type

/** A change the sync found on a mission's ticket (#97), in detection order. */
export const TicketEventInfo = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  /** Its place in the mission's detection order, from 1. */
  sequence: Schema.Number,
  key: Schema.String,
  kind: TicketEventKind,
  /** The comment it is about; null for the description and the status. */
  commentId: Schema.NullOr(Schema.String),
  /** What moved, masked: lines removed `- `, added `+ `; `before → after` for a status. */
  difference: Schema.String,
  /** The stage the mission was in when it was found. */
  stage: Schema.String,
  detectedAt: Schema.String,
  state: TicketEventState,
  /** The Planning input it is (CT-26), while the Planner integrates it. */
  input: Schema.NullOr(Schema.String),
  /** The analysis of a `ticket-event` session, after the Freeze. */
  analysis: Schema.NullOr(TicketEventAnalysis),
  seenAt: Schema.NullOr(Schema.String),
})
export type TicketEventInfo = typeof TicketEventInfo.Type

/** An event's difference, with the versions before and after it. */
export const TicketEventDifference = Schema.Struct({
  event: Schema.String,
  kind: TicketEventKind,
  difference: Schema.String,
  before: Schema.NullOr(TicketVersion),
  after: Schema.NullOr(TicketVersion),
})
export type TicketEventDifference = typeof TicketEventDifference.Type

export class UnknownTicketEvent extends Schema.TaggedError<UnknownTicketEvent>()(
  'UnknownTicketEvent',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This ticket event no longer exists.'
  }
}

/** A gesture on a ticket event refused, with the reason. */
export class TicketEventRefused extends Schema.TaggedError<TicketEventRefused>()(
  'TicketEventRefused',
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

/** A sync interval refused: under five minutes, over a week, or not whole minutes. */
export class InvalidSyncInterval extends Schema.TaggedError<InvalidSyncInterval>()(
  'InvalidSyncInterval',
  { reason: Schema.String },
) {
  override get message(): string {
    return `This interval cannot be kept: ${this.reason}.`
  }
}

/**
 * A write of a remote Spec into its mission's ticket (#98), one per Freeze in remote mode: where it
 * stands, the masked sentence of a failure, and the decision a conflict asks (answered through the
 * needs) with its answer.
 */
export const TicketWriteInfo = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  key: Schema.String,
  /** The version of the frozen Spec it writes. */
  specVersion: Schema.Number,
  state: TicketWriteState,
  /** Why it failed, in a sentence; null otherwise. */
  error: Schema.NullOr(Schema.String),
  /** The decision a conflict asks; null without a conflict. */
  needId: Schema.NullOr(Schema.String),
  /** What the user answered a conflict: the ticket's change kept, or the Spec written over it. */
  resolution: Schema.NullOr(Schema.Literals(['kept', 'written_over'])),
  queuedAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  endedAt: Schema.NullOr(Schema.String),
})
export type TicketWriteInfo = typeof TicketWriteInfo.Type

export class UnknownTicketWrite extends Schema.TaggedError<UnknownTicketWrite>()(
  'UnknownTicketWrite',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This write of the Spec no longer exists.'
  }
}

/** A Retry refused, with the reason. */
export class TicketWriteRefused extends Schema.TaggedError<TicketWriteRefused>()(
  'TicketWriteRefused',
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

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
  /** A Jira site and its project keys; the token is saved apart, through main. */
  Rpc.make('tickets.addJira', {
    payload: { projectId: Schema.String, config: JiraProviderConfig },
    success: TicketProviderInfo,
    error: failing(...always, UnknownProject, InvalidProviderConfig),
  }),
  /**
   * The deployment a Jira site says it is, from its server information, asked with no token: what
   * the settings preselect for the user to confirm; null when the site does not say.
   */
  Rpc.make('tickets.jiraDeployment', {
    payload: { site: Schema.String },
    success: Schema.NullOr(JiraDeployment),
    error: failing(...always),
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
    error: failing(...always, UnknownProject, NoProviderToWrite),
  }),
  /** The ticket a mission comes from, its base and last known versions; null for none. */
  Rpc.make('tickets.ticket', {
    payload: { missionId: Schema.String },
    success: Schema.NullOr(MissionTicket),
    error: failing(...always),
  }),
  /** How often the Project's watched tickets are checked, in minutes (#97). */
  Rpc.make('tickets.syncInterval', {
    payload: ofProject,
    success: Schema.Number,
    error: failing(...always, UnknownProject),
  }),
  /** Sets it: 5 minutes at least; the next check follows it. */
  Rpc.make('tickets.setSyncInterval', {
    payload: { projectId: Schema.String, minutes: Schema.Number },
    success: Schema.Number,
    error: failing(...always, UnknownProject, InvalidSyncInterval),
  }),
  /** When the last check of the Project's tickets succeeded with every provider; null before. */
  Rpc.make('tickets.lastCheck', {
    payload: ofProject,
    success: Schema.NullOr(Schema.String),
    error: failing(...always, UnknownProject),
  }),
  /** The changes found on a mission's ticket, in detection order. */
  Rpc.make('tickets.events', {
    payload: { missionId: Schema.String },
    success: Schema.Array(TicketEventInfo),
    error: failing(...always),
  }),
  /** What an event changed, with the versions before and after it. */
  Rpc.make('tickets.difference', {
    payload: { eventId: Schema.String },
    success: TicketEventDifference,
    error: failing(...always, UnknownTicketEvent),
  }),
  /** The user has seen an event: the mark lifts once no change waits; the base never moves. */
  Rpc.make('tickets.acknowledge', {
    payload: { eventId: Schema.String },
    success: TicketEventInfo,
    error: failing(...always, UnknownTicketEvent, TicketEventRefused),
  }),
  /** The writes of a mission's remote Spec into its ticket (#98), the first first. */
  Rpc.make('tickets.writes', {
    payload: { missionId: Schema.String },
    success: Schema.Array(TicketWriteInfo),
    error: failing(...always),
  }),
  /**
   * Retry: a failed write of the mission's latest Freeze is queued again, and runs the whole
   * procedure (read again, compare, write). A conflict is answered through its decision instead.
   */
  Rpc.make('tickets.retryWrite', {
    payload: { writeId: Schema.String },
    success: TicketWriteInfo,
    error: failing(...always, UnknownTicketWrite, TicketWriteRefused),
  }),
  /** The Project's ticket settings now, then again after each change. */
  Rpc.make('tickets.changed', {
    payload: ofProject,
    success: TicketsSettings,
    error: failing(...always, UnknownProject),
    stream: true,
  }),
)

const tokenErrors = failing(...always, UnknownTicketProvider, InvalidProviderConfig)

/**
 * A Jira provider's token as the window handles it: through main only, which seals it with the
 * system's protected storage before anything is stored. `saveJiraToken` is the one call that
 * carries the token; nothing answers it back.
 */
export const JiraTokenRpcs = RpcGroup.make(
  /** Seals, checks against the site and stores; a token Jira refuses is not stored. */
  Rpc.make('tickets.saveJiraToken', {
    payload: { providerId: Schema.String, token: Schema.String },
    success: JiraTokenStatus,
    error: tokenErrors,
  }),
  Rpc.make('tickets.removeJiraToken', {
    payload: ofProvider,
    success: JiraTokenStatus,
    error: tokenErrors,
  }),
  Rpc.make('tickets.jiraTokenStatus', {
    payload: ofProvider,
    success: JiraTokenStatus,
    error: tokenErrors,
  }),
)

/**
 * A Jira token between main and the engine, never offered to the window: the ciphertext main
 * sealed, stored with the token to check it against the site once; where it stands; its removal.
 */
export const JiraTokenEngineRpcs = RpcGroup.make(
  Rpc.make('jiraToken.save', {
    payload: { providerId: Schema.String, ciphertext: Schema.String, token: Schema.String },
    success: JiraTokenCheck,
    error: tokenErrors,
  }),
  Rpc.make('jiraToken.state', {
    payload: ofProvider,
    success: JiraTokenState,
    error: tokenErrors,
  }),
  Rpc.make('jiraToken.remove', {
    payload: ofProvider,
    success: Schema.Void,
    error: tokenErrors,
  }),
)
