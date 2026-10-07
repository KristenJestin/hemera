/**
 * Starting a mission from a Project's field: what the field recognises in what the user typed (a
 * ticket reference, a mission key), the words it searches, and the title a new mission starts with.
 *
 * A ticket reference is recognised by its shape only; which provider answers for it is the
 * Project's to say. Its canonical form (`github:<host>/<owner>/<repo>#<n>`, `jira:<host?>/<KEY-n>`)
 * is what a mission stores of the ticket it came from, so that two spellings of one ticket compare
 * equal.
 */

import { Match, Schema } from 'effect'

/**
 * A GitHub issue, on github.com or on any other host (GitHub Enterprise). The short form
 * `owner/repo#n` names no host: the Project's GitHub providers that list the repository give it,
 * else it is github.com's.
 */
export const GithubIssue = Schema.TaggedStruct('GithubIssue', {
  host: Schema.NullOr(Schema.String),
  owner: Schema.String,
  repo: Schema.String,
  number: Schema.Number,
})

/** A Jira key, with the host of the browse URL it was read from, or none when typed bare. */
export const JiraKey = Schema.TaggedStruct('JiraKey', {
  host: Schema.NullOr(Schema.String),
  key: Schema.String,
})

export const TicketReference = Schema.Union([GithubIssue, JiraKey])
export type TicketReference = typeof TicketReference.Type

/** A ticket reference in its one canonical spelling. */
export const CanonicalTicket = Schema.String.check(
  Schema.isPattern(
    /^(github:[^/\s]+\/[^/\s]+\/[^/\s#]+#\d+|jira:[^/\s]*\/[A-Z][A-Z0-9]{1,9}-\d+)$/,
    {
      message: 'a canonical ticket is github:<host>/<owner>/<repo>#<n> or jira:<host?>/<KEY-n>',
    },
  ),
).pipe(Schema.brand('CanonicalTicket'))
export type CanonicalTicket = typeof CanonicalTicket.Type

/** The host of a short form no provider of the Project resolves. */
export const GITHUB_HOST = 'github.com'

/** What a paste brings around a reference: spaces, angle brackets. */
const unwrapped = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1).trim() : trimmed
}

/** A trailing slash, a query string or a fragment after a URL's path. */
const URL_TAIL = String.raw`\/?(?:[?#]\S*)?`
const GITHUB_URL = new RegExp(
  String.raw`^https?:\/\/([^/\s]+)\/([\w.-]+)\/([\w.-]+)\/issues\/(\d{1,9})${URL_TAIL}$`,
  'i',
)
const GITHUB_SHORT = /^([\w.-]+)\/([\w.-]+)#(\d{1,9})$/
const JIRA_KEY = String.raw`([A-Za-z][A-Za-z0-9]{1,9}-\d{1,9})`
const JIRA_URL = new RegExp(String.raw`^https?:\/\/([^/\s]+)\/browse\/${JIRA_KEY}${URL_TAIL}$`, 'i')
const JIRA_BARE = new RegExp(String.raw`^${JIRA_KEY}$`)

const github = (host: string | null, owner: string, repo: string, number: string) =>
  GithubIssue.make({
    host: host === null ? null : host.toLowerCase(),
    owner: owner.toLowerCase(),
    repo: repo.toLowerCase(),
    number: Number(number),
  })

/**
 * The ticket reference the whole text is, or null: a GitHub issue URL on any host or
 * `owner/repo#n`, a Jira browse URL or a bare key (2 to 10 letters or digits starting with a
 * letter, a dash, a number) in any case. Anything else is not a reference and is searched as words.
 */
export function parseTicketReference(text: string): TicketReference | null {
  const core = unwrapped(text)
  const url = GITHUB_URL.exec(core)
  if (url !== null) {
    const [, host = '', owner = '', repo = '', number = ''] = url
    return github(host, owner, repo, number)
  }
  const short = GITHUB_SHORT.exec(core)
  if (short !== null) {
    const [, owner = '', repo = '', number = ''] = short
    return github(null, owner, repo, number)
  }
  const browse = JIRA_URL.exec(core)
  if (browse !== null) {
    const [, host = '', key = ''] = browse
    return JiraKey.make({ host: host.toLowerCase(), key: jiraKeyOf(key) })
  }
  const bare = JIRA_BARE.exec(core)
  return bare === null ? null : JiraKey.make({ host: null, key: jiraKeyOf(bare[1] ?? '') })
}

/** A Jira key in capitals, its number without leading zeros. */
const jiraKeyOf = (key: string): string => {
  const [letters = '', number = ''] = key.toUpperCase().split('-')
  return `${letters}-${String(Number(number))}`
}

/**
 * The one spelling of a reference every mission stores. A short form whose host was not resolved
 * is spelled as github.com's.
 */
export const canonicalTicket = Match.type<TicketReference>().pipe(
  Match.tagsExhaustive({
    GithubIssue: (issue) =>
      CanonicalTicket.make(
        `github:${issue.host ?? GITHUB_HOST}/${issue.owner}/${issue.repo}#${String(issue.number)}`,
      ),
    JiraKey: (jira) => CanonicalTicket.make(`jira:${jira.host ?? ''}/${jira.key}`),
  }),
)

/** The ticket's own key, as its provider shows it: `acme/shop#41`, `SHOP-7`. */
export const ticketKeyOf = Match.type<TicketReference>().pipe(
  Match.tagsExhaustive({
    GithubIssue: (issue) => `${issue.owner}/${issue.repo}#${String(issue.number)}`,
    JiraKey: (jira) => jira.key,
  }),
)

/** The provider the shape of a reference names. */
export const ticketProviderOf = Match.type<TicketReference>().pipe(
  Match.tagsExhaustive({ GithubIssue: () => 'github', JiraKey: () => 'jira' }),
)

/** The ticket's page, or null for a bare key, whose host only a provider knows. */
export const ticketUrlOf = Match.type<TicketReference>().pipe(
  Match.tagsExhaustive({
    GithubIssue: (issue): string | null =>
      `https://${issue.host ?? GITHUB_HOST}/${issue.owner}/${issue.repo}/issues/${String(issue.number)}`,
    JiraKey: (jira) => (jira.host === null ? null : `https://${jira.host}/browse/${jira.key}`),
  }),
)

const MISSION_KEY = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,9})$/

/** The mission key the whole text is, in any case, or null. */
export function parseMissionKey(text: string): { prefix: string; number: number } | null {
  const match = MISSION_KEY.exec(text.trim())
  if (match === null) return null
  const [, prefix = '', number = ''] = match
  return { prefix: prefix.toUpperCase(), number: Number(number) }
}

/** Text as the search compares it: lower case, accents removed, spaces collapsed. */
const normalised = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** The search column of a mission: its key, title and idea, normalised, written with it. */
export const searchTextOf = (parts: ReadonlyArray<string | null>): string =>
  normalised(parts.filter((part) => part !== null).join(' '))

/** How many words a search matches: a long paste is searched by its first distinct ones. */
export const SEARCH_WORDS = 16

/**
 * The words a search matches, each of which the search column must contain: the distinct words of
 * the text, the first `SEARCH_WORDS` of them, so that a long paste stays one bounded query.
 */
export const searchWordsOf = (text: string): ReadonlyArray<string> => {
  const words = normalised(text)
  return words === '' ? [] : [...new Set(words.split(' '))].slice(0, SEARCH_WORDS)
}

/** How long a provisional title may be, cut on a word. */
const PROVISIONAL_CHARACTERS = 80

/** The title of a mission whose text says nothing. */
export const UNTITLED_MISSION = 'New mission'

/**
 * The title a mission starts with until the Planner sets its own: the first non-empty line of
 * the text, spaces collapsed, cut at 80 characters on a word with an ellipsis.
 */
export function provisionalTitleOf(text: string): string {
  const line = text
    .split('\n')
    .map((one) => one.replace(/\s+/g, ' ').trim())
    .find((one) => one.length > 0)
  const title = line ?? UNTITLED_MISSION
  if (title.length <= PROVISIONAL_CHARACTERS) return title
  const cut = title.slice(0, PROVISIONAL_CHARACTERS)
  const space = cut.lastIndexOf(' ')
  return `${space > 0 ? cut.slice(0, space) : cut}…`
}
