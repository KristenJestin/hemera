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

/** A provider's name as its dialog and the settings say it: `GitHub · github.com`. */
export function providerTitle(provider: ProviderView): string {
  return provider.kind === 'github' ? `GitHub · ${provider.host}` : `Jira · ${provider.host}`
}

/** What is wrong in the providers, in a few words, for the glyph in the list of sections. */
export function providerProblem(providers: readonly ProviderView[]): string | undefined {
  const one = providers.find(providerTroubled)
  return one === undefined ? undefined : `${providerTitle(one)} needs you`
}

/** Whether something of a provider waits on the user: its state is not ready, or its token is not saved. */
export function providerTroubled(provider: ProviderView): boolean {
  return (
    (provider.status !== null && provider.status.state !== 'ready') ||
    (provider.token !== undefined && provider.token !== 'saved')
  )
}
