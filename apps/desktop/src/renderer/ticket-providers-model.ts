/**
 * What the ticket providers show of the engine's records, and what their forms write back: plain
 * values and no React. The Jira token is never among them: only where it stands.
 */

import type { ProviderStatus } from '@hemera/core/domain'
import {
  type GithubProviderConfig,
  type JiraProviderConfig,
  type JiraTokenStatus,
  ProviderInUse,
  type TicketProviderInfo,
} from '@hemera/ipc'
import type { GithubDraft, JiraDraft, ProviderView } from '@hemera/ui'

/** What the section has read of a Project's providers so far. */
export interface ProvidersState {
  /** Null: not read yet. */
  readonly infos: ReadonlyArray<TicketProviderInfo> | null
  /** What each provider can do now; absent while it is being read. */
  readonly statuses: ReadonlyMap<string, ProviderStatus>
  /** Where each Jira provider's token stands. */
  readonly tokens: ReadonlyMap<string, JiraTokenStatus>
}

/** What a provider covers, in words: its repositories, or its Jira project keys. */
export function scopeOf(provider: TicketProviderInfo): string {
  if (provider.kind === 'github') {
    return provider.repositories.length === 0
      ? 'No repository chosen'
      : provider.repositories.join(', ')
  }
  const keys = provider.jira?.projectKeys ?? []
  return keys.length === 0 ? 'No project key' : keys.join(', ')
}

const dayIn = (date: Date, zone?: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(date)

/**
 * Since when a provider is unreachable, as its line says it: `since 08:12` today, `since 7 Oct,
 * 08:12` another day; null when the date cannot be read.
 */
export function sinceWords(iso: string, now: Date, zone?: string): string | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  }).format(at)
  if (dayIn(at, zone) === dayIn(now, zone)) return `since ${time}`
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  }).format(at)
  return `since ${day}, ${time}`
}

/** The providers as their lines and dialogs show them; null while the list is not read. */
export function providerViewsOf(
  state: ProvidersState,
  now: Date,
  zone?: string,
): ReadonlyArray<ProviderView> | null {
  if (state.infos === null) return null
  return state.infos.map((info) => {
    const status = state.statuses.get(info.id)
    return {
      id: info.id,
      kind: info.kind,
      host: info.host,
      scope: scopeOf(info),
      status:
        status === undefined
          ? null
          : { state: status.state, sentence: status.sentence, fix: status.fix },
      unreachableSince:
        info.unreachableSince === null ? null : sinceWords(info.unreachableSince, now, zone),
      token: info.kind === 'jira' ? state.tokens.get(info.id) : undefined,
    }
  })
}

/** Why a provider could not be removed, in words: the missions named, or the engine's own. */
export function removalWords(failure: Error): string {
  return failure instanceof ProviderInUse
    ? failure.message
    : `The provider could not be removed: ${failure.message}`
}

/** The GitHub form's draft, as the engine takes it: the host in lower case, trimmed. */
export function githubConfigOf(draft: GithubDraft): GithubProviderConfig {
  return { host: draft.host.trim().toLowerCase(), repositories: draft.repositories }
}

/** What is missing of a GitHub form, in words; undefined when it can be saved. */
export function githubRefusal(draft: GithubDraft): string | undefined {
  if (draft.host.trim() === '') return 'Write the host.'
  if (draft.repositories.length === 0) return 'Choose at least one repository.'
  return undefined
}

/** The project keys typed, split on commas and spaces, in capitals, each once. */
export function projectKeysOf(text: string): string[] {
  const keys = text
    .split(/[\s,]+/)
    .filter((one) => one !== '')
    .map((one) => one.toUpperCase())
  return keys.filter((one, at) => keys.indexOf(one) === at)
}

/** The Jira form's draft, as the engine takes it: Data Center has no account email. */
export function jiraConfigOf(draft: JiraDraft): JiraProviderConfig {
  return {
    site: draft.site.trim(),
    deployment: draft.deployment,
    email: draft.deployment === 'cloud' ? draft.email.trim() : null,
    projectKeys: projectKeysOf(draft.projectKeys),
  }
}

/** What is missing of a Jira form, in words; undefined when it can be added. */
export function jiraRefusal(draft: JiraDraft): string | undefined {
  if (draft.site.trim() === '') return 'Write the address of the Jira site.'
  if (draft.deployment === 'cloud' && draft.email.trim() === '') {
    return 'Write the email of the Jira account.'
  }
  if (projectKeysOf(draft.projectKeys).length === 0) return 'Write at least one project key.'
  return undefined
}

/**
 * A state held outside React's, so a dialog's body and its foot read it in the same render as the
 * change: a draft handed to the page's dialog through an effect lags one render behind.
 */
export interface ProviderStore<T> {
  readonly get: () => T
  readonly set: (change: Partial<T>) => void
  readonly subscribe: (listener: () => void) => () => void
}

export function providerStore<T extends object>(initial: T): ProviderStore<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (change) => {
      state = { ...state, ...change }
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
