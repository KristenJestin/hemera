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

import type { Link } from './link.ts'

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

const reads = new WeakMap<object, Map<string, number>>()

/**
 * Starts a read under a key and answers whether it is still the latest one for that key: an answer
 * that comes back after a newer read began is stale and must not be written over it.
 */
export function latestRead(owner: object, key: string): () => boolean {
  const known = reads.get(owner) ?? new Map<string, number>()
  reads.set(owner, known)
  const mine = (known.get(key) ?? 0) + 1
  known.set(key, mine)
  return () => known.get(key) === mine
}

/** Reads what a provider can do now, and where its Jira token stands. */
export function readProvider(
  link: Pick<Link, 'providerStatus' | 'jiraTokenStatus'>,
  store: ProviderStore<ProvidersState>,
  provider: TicketProviderInfo,
): void {
  const keep = (status: ProviderStatus): void =>
    store.set({ statuses: new Map(store.get().statuses).set(provider.id, status) })
  const currentStatus = latestRead(store, `status:${provider.id}`)
  link.providerStatus(provider.id).then(
    (status) => {
      if (currentStatus()) keep(status)
    },
    (failure: Error) => {
      if (currentStatus()) {
        keep({
          state: 'configured',
          sentence: `The provider could not be checked: ${failure.message}`,
          fix: null,
        })
      }
    },
  )
  if (provider.kind !== 'jira') return
  const currentToken = latestRead(store, `token:${provider.id}`)
  link.jiraTokenStatus(provider.id).then(
    (status) => {
      if (currentToken())
        store.set({ tokens: new Map(store.get().tokens).set(provider.id, status) })
    },
    () => undefined,
  )
}

/** Asks the engine to check a provider again; its answer lands unless a newer read began. */
export function checkProvider(
  link: Pick<Link, 'checkProviderAgain'>,
  store: ProviderStore<ProvidersState>,
  id: string,
): Promise<void> {
  const current = latestRead(store, `status:${id}`)
  return link.checkProviderAgain(id).then((status) => {
    if (current()) store.set({ statuses: new Map(store.get().statuses).set(id, status) })
  })
}

type TokenCalls = Pick<
  Link,
  'saveJiraToken' | 'removeJiraToken' | 'providerStatus' | 'jiraTokenStatus'
>

/** Gives a provider its Jira token; where it stands is kept, then the provider is read again. */
export function giveToken(
  link: TokenCalls,
  store: ProviderStore<ProvidersState>,
  provider: TicketProviderInfo,
  token: string,
): Promise<JiraTokenStatus> {
  const current = latestRead(store, `token:${provider.id}`)
  return link.saveJiraToken(provider.id, token).then((status) => {
    if (current()) store.set({ tokens: new Map(store.get().tokens).set(provider.id, status) })
    readProvider(link, store, provider)
    return status
  })
}

/** Removes a provider's Jira token; where it stands is kept, then the provider is read again. */
export function dropToken(
  link: TokenCalls,
  store: ProviderStore<ProvidersState>,
  provider: TicketProviderInfo,
): Promise<void> {
  const current = latestRead(store, `token:${provider.id}`)
  return link.removeJiraToken(provider.id).then((status) => {
    if (current()) store.set({ tokens: new Map(store.get().tokens).set(provider.id, status) })
    readProvider(link, store, provider)
  })
}

/** What the dialog that adds a GitHub provider holds. */
export interface GithubAddDraft {
  readonly github: GithubDraft
  readonly proposed: ReadonlyArray<string>
  /** Whether the first proposal was ticked for the user. */
  readonly preselected: boolean
  /** Whether the user ticked or unticked a repository themselves. */
  readonly touched: boolean
  readonly saving: boolean
  readonly refused: string | undefined
}

/** The repositories proposed for the host arrived: ticked for the user only if they have not chosen. */
export function proposalsArrived(
  now: GithubAddDraft,
  proposed: ReadonlyArray<string>,
): Partial<GithubAddDraft> {
  const ticks = now.preselected || now.touched
  return {
    proposed,
    preselected: true,
    github: ticks ? now.github : { ...now.github, repositories: proposed },
  }
}

/** The form was edited: a change of the repositories is the user's own choice. */
export function githubEdited(now: GithubAddDraft, github: GithubDraft): Partial<GithubAddDraft> {
  return {
    github,
    touched:
      now.touched ||
      github.repositories.length !== now.github.repositories.length ||
      github.repositories.some((one, at) => one !== now.github.repositories[at]),
  }
}

/** What the dialog that adds a Jira provider holds. */
export interface JiraAddDraft {
  readonly jira: JiraDraft
  /** Whether the user chose the deployment themselves: the site's answer then leaves it alone. */
  readonly chosen: boolean
  /** The provider once the engine added it: a token retried goes to it, never to a second one. */
  readonly added: TicketProviderInfo | null
  /** Whether the token field holds something not given yet. */
  readonly filled: boolean
  readonly saving: boolean
  readonly tokenRefused: string | undefined
  readonly refused: string | undefined
}

/** Why a token was not kept, in words; undefined when it was. */
export function tokenRefusal(status: JiraTokenStatus): string | undefined {
  if (status === 'saved') return undefined
  if (status === 'storage-unavailable') return 'This system has no protected storage for a token.'
  return 'Jira refused this token.'
}

/**
 * The one way out of the Jira dialog: adds the provider (once) and, if a token is given, keeps it
 * for that provider. Answers whether the dialog is done. A token refused leaves the provider added,
 * so the next token goes to the same provider.
 */
export async function submitJira(
  link: Pick<Link, 'addJira'> & TokenCalls,
  store: ProviderStore<ProvidersState>,
  draft: ProviderStore<JiraAddDraft>,
  projectId: string,
  token: string | null,
): Promise<boolean> {
  const before = draft.get()
  if (before.added === null) {
    const refusal = jiraRefusal(before.jira)
    if (refusal !== undefined) {
      draft.set({ refused: refusal })
      return false
    }
  }
  draft.set({ saving: true, refused: undefined, tokenRefused: undefined })
  let added = before.added
  if (added === null) {
    try {
      added = await link.addJira(projectId, jiraConfigOf(before.jira))
    } catch (failure) {
      draft.set({ saving: false, refused: failure instanceof Error ? failure.message : 'Failed.' })
      return false
    }
    draft.set({ added })
  }
  if (token === null) return true
  try {
    const refusal = tokenRefusal(await giveToken(link, store, added, token))
    if (refusal === undefined) return true
    draft.set({ saving: false, tokenRefused: refusal })
  } catch (failure) {
    readProvider(link, store, added)
    draft.set({
      saving: false,
      tokenRefused: `The provider was added, but the token could not be saved: ${
        failure instanceof Error ? failure.message : 'Failed.'
      }`,
    })
  }
  return false
}
