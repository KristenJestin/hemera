/**
 * The ticket and Spec settings of the neutral Project "Acme", in the shapes the engine answers
 * them in (`tickets.changed`, `tickets.status`, `tickets.jiraTokenStatus`, `resources.list`,
 * `resources.changed`): the two proposals of this exploration draw the same data.
 */

/** What a provider can do now. */
export type ProviderState =
  | 'configured'
  | 'missing_cli'
  | 'not_authenticated'
  | 'unreachable'
  | 'ready'

export interface ProviderStatus {
  readonly state: ProviderState
  /** The sentence shown. */
  readonly sentence: string
  /** The command that fixes it, run by the user in their own terminal. */
  readonly fix: string | null
}

/** Where a Jira token stands; the token itself never comes back to the window. */
export type JiraTokenStatus = 'missing' | 'saved' | 'invalid' | 'storage-unavailable'

export type JiraDeployment = 'cloud' | 'datacenter'

export interface JiraConfig {
  readonly site: string
  readonly deployment: JiraDeployment
  readonly email: string | null
  readonly projectKeys: readonly string[]
}

export interface TicketProvider {
  readonly id: string
  readonly kind: 'github' | 'jira'
  readonly host: string
  /** `owner/repo` (GitHub). */
  readonly repositories: readonly string[]
  readonly jira: JiraConfig | null
  /** As the page says it: `since 08:12`. Null when the last check succeeded. */
  readonly unreachableSince: string | null
  readonly status: ProviderStatus
  /** Jira only. */
  readonly token?: JiraTokenStatus | undefined
  /** The live missions whose ticket it reads: a removal is refused while there is one. */
  readonly readsFor?: readonly string[] | undefined
}

export type SpecMode = 'local' | 'remote' | 'linked'

/** What each mode does, in the words of the ticket providers design note. */
export const SPEC_MODES: readonly { value: SpecMode; label: string; does: string }[] = [
  {
    value: 'local',
    label: 'Local',
    does: 'The Spec lives in Hemera. A ticket is read once, as the idea of the mission.',
  },
  {
    value: 'linked',
    label: 'Linked',
    does: 'The Spec lives in Hemera and follows its ticket: a change in the ticket is shown to you, never applied on its own.',
  },
  {
    value: 'remote',
    label: 'Remote',
    does: 'Hemera writes the Spec into the ticket, in its eight sections, and reads back what others change there.',
  },
]

export interface CatalogueCommand {
  readonly id: string
  readonly name: string
  readonly line: string
}

export interface ExclusiveResource {
  readonly id: string
  readonly name: string
  readonly description: string
  /** Catalogue commands that use it, by id. */
  readonly uses: readonly string[]
  /** The command that brings it back to what a mission expects; null for none. */
  readonly resetCommandId: string | null
  /** The mission that holds it now, and since when. */
  readonly holder: { readonly missionKey: string; readonly since: string } | null
  /** The missions waiting for it. */
  readonly queue: readonly string[]
}

export interface TicketSettingsData {
  readonly providers: readonly TicketProvider[]
  readonly specMode: SpecMode
  /** Minutes between two checks of the watched tickets. */
  readonly syncInterval: number
  /** As the page says it; null before the first. */
  readonly lastCheck: string | null
  readonly specLanguage: string
  readonly prefix: string
  /** Why the last prefix typed was refused, in words. */
  readonly prefixRefused?: string | undefined
  readonly resources: readonly ExclusiveResource[]
  readonly commands: readonly CatalogueCommand[]
}

export const SYNC_INTERVALS: readonly { value: string; label: string }[] = [
  { value: '15', label: 'Every 15 minutes' },
  { value: '30', label: 'Every 30 minutes' },
  { value: '60', label: 'Every hour' },
  { value: '240', label: 'Every 4 hours' },
  { value: '1440', label: 'Once a day' },
]

export const LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
]

const READY: ProviderStatus = { state: 'ready', sentence: 'Ready.', fix: null }

export const GITHUB: TicketProvider = {
  id: 'github',
  kind: 'github',
  host: 'github.com',
  repositories: ['acme/api', 'acme/web'],
  jira: null,
  unreachableSince: null,
  status: READY,
}

export const JIRA: TicketProvider = {
  id: 'jira',
  kind: 'jira',
  host: 'acme.atlassian.net',
  repositories: [],
  jira: {
    site: 'https://acme.atlassian.net',
    deployment: 'cloud',
    email: 'dev@acme.example',
    projectKeys: ['SHOP'],
  },
  unreachableSince: null,
  status: READY,
  token: 'saved',
}

export const COMMANDS: readonly CatalogueCommand[] = [
  { id: 'migrate', name: 'Migrate the database', line: 'pnpm --filter api db:migrate' },
  { id: 'seed', name: 'Seed the database', line: 'pnpm --filter api db:seed' },
  { id: 'reset', name: 'Reset the database', line: 'pnpm --filter api db:reset' },
  { id: 'e2e', name: 'End-to-end tests', line: 'pnpm --filter web e2e' },
  {
    id: 'stripe',
    name: 'Replay payment webhooks',
    line: 'stripe trigger payment_intent.succeeded',
  },
]

export const RESOURCES: readonly ExclusiveResource[] = [
  {
    id: 'db',
    name: 'Shared database',
    description: 'The Postgres of the staging machine, which api and web both use.',
    uses: ['migrate', 'seed', 'e2e'],
    resetCommandId: 'reset',
    holder: { missionKey: 'ACME-12', since: '09:41' },
    queue: ['ACME-14'],
  },
  {
    id: 'stripe',
    name: 'Payment sandbox',
    description: 'The test account of the payment provider.',
    uses: ['stripe'],
    resetCommandId: null,
    holder: null,
    queue: [],
  },
]

/** Acme as it is lived in: GitHub and Jira both ready, linked Specs, two resources. */
export const FILLED: TicketSettingsData = {
  providers: [GITHUB, JIRA],
  specMode: 'linked',
  syncInterval: 60,
  lastCheck: '09:00',
  specLanguage: 'en',
  prefix: 'ACME',
  resources: RESOURCES,
  commands: COMMANDS,
}

/** Nothing configured yet. */
export const NOTHING: TicketSettingsData = {
  ...FILLED,
  providers: [],
  specMode: 'local',
  lastCheck: null,
  resources: [],
}

function withGithub(more: Partial<TicketProvider>): TicketSettingsData {
  return { ...FILLED, providers: [{ ...GITHUB, ...more }] }
}

function withJira(more: Partial<TicketProvider>): TicketSettingsData {
  return { ...FILLED, providers: [{ ...JIRA, ...more }] }
}

export const GITHUB_ONLY = withGithub({})

export const GITHUB_MISSING_CLI = withGithub({
  status: {
    state: 'missing_cli',
    sentence: 'Hemera reads GitHub through the gh command, which is not installed on this machine.',
    fix: 'winget install --id GitHub.cli',
  },
})

export const GITHUB_LOGGED_OUT = withGithub({
  status: {
    state: 'not_authenticated',
    sentence: 'gh is installed but not signed in to github.com.',
    fix: 'gh auth login --hostname github.com',
  },
})

export const JIRA_ONLY = withJira({})

export const JIRA_TOKEN_MISSING = withJira({
  token: 'missing',
  status: { state: 'configured', sentence: 'No API token is saved for this site.', fix: null },
})

export const JIRA_TOKEN_REFUSED = withJira({
  token: 'invalid',
  status: {
    state: 'not_authenticated',
    sentence: 'Jira refused the saved token: it was revoked or has expired.',
    fix: null,
  },
})

export const JIRA_STORAGE_UNAVAILABLE = withJira({
  token: 'storage-unavailable',
  status: {
    state: 'configured',
    sentence:
      'This system offers no protected storage, so Hemera cannot keep a token. Unlock the system keyring and check again.',
    fix: null,
  },
})

export const JIRA_DATA_CENTER = withJira({
  host: 'jira.acme.example',
  jira: {
    site: 'https://jira.acme.example',
    deployment: 'datacenter',
    email: null,
    projectKeys: ['SHOP', 'OPS'],
  },
})

export const UNREACHABLE: TicketSettingsData = {
  ...FILLED,
  providers: [
    GITHUB,
    {
      ...JIRA,
      unreachableSince: 'since 08:12',
      status: {
        state: 'unreachable',
        sentence: 'acme.atlassian.net does not answer: the connection timed out after 30 seconds.',
        fix: null,
      },
    },
  ],
}

/** A provider a live mission reads its ticket from. */
export const IN_USE: TicketSettingsData = {
  ...FILLED,
  providers: [{ ...GITHUB, readsFor: ['ACME-12', 'ACME-14'] }, JIRA],
}

export const PREFIX_REFUSED: TicketSettingsData = {
  ...FILLED,
  prefix: 'SHOP',
  prefixRefused:
    'SHOP is still carried by the missions of the Project Shop (SHOP-3 to SHOP-41): two missions never share a key.',
}

const LONG_REPOS = [
  'acme/api',
  'acme/web',
  'acme/shared',
  'acme/ui-kit',
  'acme/billing',
  'acme/infrastructure-and-deployment-scripts-for-every-environment',
]

/** Long values in every field: many repositories, a long site, a long resource. */
export const DENSE: TicketSettingsData = {
  ...FILLED,
  providers: [
    { ...GITHUB, repositories: LONG_REPOS },
    {
      ...JIRA,
      host: 'acme-international-retail-operations.atlassian.net',
      jira: {
        site: 'https://acme-international-retail-operations.atlassian.net',
        deployment: 'cloud',
        email: 'continuous-integration-and-delivery@acme-international.example',
        projectKeys: ['SHOP', 'OPS', 'PAY', 'SEARCH', 'MOBILE', 'DATA'],
      },
    },
    {
      ...GITHUB,
      id: 'ghe',
      host: 'github.acme-enterprise.example',
      repositories: ['platform/api'],
    },
  ],
  resources: [
    ...RESOURCES,
    {
      id: 'long',
      name: 'The shared Elasticsearch cluster of the staging environment used by the search team',
      description:
        'Its indices are rebuilt by the search import; two imports at once leave the index half written.',
      uses: ['seed', 'e2e', 'migrate', 'stripe'],
      resetCommandId: 'reset',
      holder: null,
      queue: [],
    },
  ],
}

/** A provider's name as the settings say it. */
export function providerName(provider: TicketProvider): string {
  return provider.kind === 'github' ? `GitHub · ${provider.host}` : `Jira · ${provider.host}`
}

/** What a provider covers: its repositories, or its Jira project keys. */
export function scopeOf(provider: TicketProvider): string {
  return provider.kind === 'github'
    ? provider.repositories.join(', ')
    : (provider.jira?.projectKeys.join(', ') ?? '')
}

/** Whether something of a provider waits on the user. */
export function troubled(provider: TicketProvider): boolean {
  return (
    provider.status.state !== 'ready' ||
    (provider.token !== undefined && provider.token !== 'saved')
  )
}

/** What is wrong in the providers, in a few words, for the glyph in the list of sections. */
export function problemOf(providers: readonly TicketProvider[]): string | undefined {
  const one = providers.find(troubled)
  return one === undefined ? undefined : `${providerName(one)} needs you`
}

/** A command of the catalogue, by id. */
export function commandName(id: string): string {
  return COMMANDS.find((one) => one.id === id)?.name ?? id
}
