import type { ReactNode } from 'react'

/** The ticket providers a Project reads: GitHub or Jira. */
export type ProviderKind = 'github' | 'jira'

/** Where a provider stands: configured, or what is missing, or ready. */
export type ProviderState =
  | 'configured'
  | 'missing_cli'
  | 'not_authenticated'
  | 'unreachable'
  | 'ready'

/** Whether a Jira token is kept: never its value. */
export type JiraTokenView = 'missing' | 'saved' | 'invalid' | 'storage-unavailable'

/** A provider as its line and its dialog show it. */
export interface ProviderView {
  id: string
  kind: ProviderKind
  host: string
  /** What it covers: `acme/api, acme/web` or `SHOP, OPS`. */
  scope: string
  /** Null: being read. `sentence` is the trouble in words, `fix` the command that mends it. */
  status: { state: ProviderState; sentence: string; fix: string | null } | null
  /** `since 08:12`, or null. */
  unreachableSince: string | null
  token?: JiraTokenView | undefined
}

/** The props of the providers list. */
export interface TicketProvidersProps {
  /** Null: the list is on its way. */
  providers: readonly ProviderView[] | null
  error?: string | undefined
  onOpen: (id: string) => void
  onAdd: (kind: ProviderKind) => void
}

/** The providers section of "Tickets and Specs": a line per provider, and Add. */
export function TicketProviders(_props: TicketProvidersProps): ReactNode {
  return null
}

/** The brand mark of a provider. */
export function ProviderMark(_props: { kind: ProviderKind }): ReactNode {
  return null
}
