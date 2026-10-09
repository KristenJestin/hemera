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
  TicketVersion,
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
