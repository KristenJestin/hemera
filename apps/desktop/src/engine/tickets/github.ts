/**
 * GitHub issues as a ticket provider (#95), through the user's `gh`.
 *
 * - `status`: `gh --version`, then `gh auth status --hostname <host>`, which exits 1 when the host
 *   is not logged in. Hemera never runs `gh auth token`.
 * - `read`: `gh api graphql` with explicit fields, the comments paged until complete. A number that
 *   is a pull request is refused in a sentence.
 * - `search`: `gh api search/issues` over the provider's repositories, issues only, 20 at most, by
 *   update date. The text is the value of the `q` field, so it is never read as a flag.
 * - `changedSince`: one GraphQL query per batch of 50 issues, one alias per issue, asking only its
 *   update date.
 * - `write` (#98): the issue read again, then its body replaced with `gh api --method PATCH`, the
 *   JSON body on the standard input (`--input -`), never in an argument; then read back. A refusal
 *   (the account may read the repository but not write to it) is `TicketForbidden`, masked; a body
 *   refused as sent (400, 422) is a Spec too long when GitHub says so, `TicketWriteRejected` else.
 *
 * Every API call asks for the response's headers too (`--include`): a rate limit's reset is in
 * `x-ratelimit-reset`. An answer with no HTTP status at all is a call that never reached GitHub.
 */

import {
  GithubIssue,
  type KnownTicket,
  type ProviderHit,
  ProviderLimited,
  ProviderNotAuthenticated,
  type ProviderStatus,
  ProviderUnreachable,
  REMOTE_SPEC_LIMITS,
  type TicketError,
  TicketForbidden,
  TicketNotFound,
  TicketTooLong,
  TicketWriteRejected,
  type TicketReference,
  TicketUnreadable,
  type TicketVersion,
  canonicalTicket,
  readSections,
  remoteSpecTooLong,
  ticketKeyOf,
} from '@hemera/core/domain'
import { Effect, Option, Predicate, Result, Schema } from 'effect'

import { GH_INSTALL, type GhAnswer, GhCli, githubLabel } from './gh.ts'
import {
  MissingTicket,
  MovedTicket,
  type TicketChange,
  type TicketProvider,
  commentFingerprint,
  ticketFingerprint,
  unmoved,
} from './provider.ts'

/** A GitHub provider's configuration: its host, and the repositories its search watches. */
export const GithubConfig = Schema.Struct({
  host: Schema.String,
  repositories: Schema.Array(Schema.String),
})
export type GithubConfig = typeof GithubConfig.Type

/** How many hits a search answers. */
export const SEARCH_LIMIT = 20
/** How many issues one grouped `changedSince` query asks about. */
export const CHANGED_BATCH = 50
/** A rate limit whose reset GitHub did not say is waited out this long. */
const UNSAID_RESET_MILLIS = 60_000

const NETWORK =
  /error connecting|dial tcp|no such host|timed? ?out|connection (refused|reset)|network is unreachable|tls|eof/i

const login = Schema.NullOr(Schema.Struct({ login: Schema.String }))

const CommentNode = Schema.Struct({
  id: Schema.String,
  author: login,
  body: Schema.String,
  createdAt: Schema.String,
  lastEditedAt: Schema.NullOr(Schema.String),
})

const IssueNode = Schema.Struct({
  __typename: Schema.Literal('Issue'),
  number: Schema.Number,
  title: Schema.String,
  body: Schema.String,
  state: Schema.Literals(['OPEN', 'CLOSED']),
  stateReason: Schema.NullOr(Schema.String),
  url: Schema.String,
  updatedAt: Schema.String,
  author: login,
  labels: Schema.NullOr(
    Schema.Struct({ nodes: Schema.Array(Schema.NullOr(Schema.Struct({ name: Schema.String }))) }),
  ),
  comments: Schema.Struct({
    pageInfo: Schema.Struct({
      hasNextPage: Schema.Boolean,
      endCursor: Schema.NullOr(Schema.String),
    }),
    nodes: Schema.Array(Schema.NullOr(CommentNode)),
  }),
})

const GraphqlError = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  message: Schema.String,
  path: Schema.optionalKey(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
})

const ReadAnswer = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({
            issueOrPullRequest: Schema.NullOr(
              Schema.Union([IssueNode, Schema.Struct({ __typename: Schema.String })]),
            ),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(GraphqlError)),
})

const ChangedAnswer = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Record(
        Schema.String,
        Schema.NullOr(
          Schema.Struct({
            issue: Schema.NullOr(Schema.Struct({ updatedAt: Schema.String })),
          }),
        ),
      ),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(GraphqlError)),
})

/** GraphQL's errors, or a REST answer's message (an edit refused, #98). */
const ErrorsOnly = Schema.Struct({
  errors: Schema.optionalKey(Schema.Array(GraphqlError)),
  message: Schema.optionalKey(Schema.String),
})

const SearchAnswer = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      number: Schema.Number,
      title: Schema.String,
      html_url: Schema.String,
      state: Schema.String,
      updated_at: Schema.String,
      repository_url: Schema.String,
    }),
  ),
})

const isIssue = Schema.is(IssueNode)
const isPullRequest = Schema.is(Schema.Struct({ __typename: Schema.Literal('PullRequest') }))
const readErrors = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorsOnly))
const readIssue = Schema.decodeUnknownOption(Schema.fromJsonString(ReadAnswer))
const readChanged = Schema.decodeUnknownOption(Schema.fromJsonString(ChangedAnswer))
const readHits = Schema.decodeUnknownOption(Schema.fromJsonString(SearchAnswer))

/** A `gh api --include` answer, split; null when it holds no HTTP status line. */
const responseOf = (stdout: string) => {
  const status = /^HTTP\/[\d.]+ (\d{3})/.exec(stdout)
  if (status === null) return null
  const blank = /\r?\n\r?\n/.exec(stdout)
  const head = blank === null ? stdout : stdout.slice(0, blank.index)
  const body = blank === null ? '' : stdout.slice(blank.index + blank[0].length)
  const headers = new Map<string, string>()
  for (const line of head.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0)
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  return { status: Number(status[1]), headers, body }
}

/** The status words: `open`, `closed · completed`, `closed · not planned`… */
const statusOf = (state: 'OPEN' | 'CLOSED', reason: string | null) => {
  if (state === 'OPEN') return { state: 'open' as const, wording: 'open' }
  const why = reason === null ? '' : reason.toLowerCase().replaceAll('_', ' ')
  return { state: 'closed' as const, wording: why === '' ? 'closed' : `closed · ${why}` }
}

const READ_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        number title body state stateReason url updatedAt
        author { login }
        labels(first: 100) { nodes { name } }
        comments(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id author { login } body createdAt lastEditedAt }
        }
      }
    }
  }
}`

/** One grouped query: an alias per issue, each asking its update date only. */
const changedQuery = (count: number): string => {
  const indexes = Array.from({ length: count }, (_, index) => index)
  const variables = indexes
    .map(
      (index) =>
        `$o${String(index)}: String!, $r${String(index)}: String!, $n${String(index)}: Int!`,
    )
    .join(', ')
  const aliases = indexes
    .map(
      (index) =>
        `  i${String(index)}: repository(owner: $o${String(index)}, name: $r${String(index)}) { issue(number: $n${String(index)}) { updatedAt } }`,
    )
    .join('\n')
  return `query(${variables}) {\n${aliases}\n}`
}

/** A GitHub provider over `gh`, for one host and its repositories. */
export const githubProvider = (config: GithubConfig) =>
  GhCli.useSync((gh): TicketProvider => {
    const host = config.host
    const label = githubLabel(host)
    const fix = `gh auth login --hostname ${host}`
    const said = (answer: GhAnswer, fallback: string) =>
      answer.stderr.trim().split('\n')[0] || fallback

    /** GitHub's message in an answer, masked. */
    const wordsOf = (
      answer: GhAnswer,
      response: { readonly status: number; readonly body: string },
    ) => {
      const decoded = Option.getOrNull(readErrors(response.body))
      return gh.mask(
        (decoded?.errors ?? []).map((error) => error.message).join(' ') ||
          (decoded?.message ?? '') ||
          said(answer, `HTTP ${String(response.status)}`),
      )
    }

    /** What a failed answer is, as an error of the port. */
    const failureOf = (key: string, answer: GhAnswer): TicketError => {
      if (answer.code === 4) {
        return new ProviderNotAuthenticated({
          provider: label,
          detail: said(answer, 'gh is not logged in'),
          fix,
        })
      }
      const response = responseOf(answer.stdout)
      if (response === null) {
        return answer.code === 0
          ? new TicketUnreadable({ key, detail: `${key} could not be read: gh answered nothing.` })
          : new ProviderUnreachable({
              provider: label,
              detail: said(answer, `gh ended with ${String(answer.code)}`),
            })
      }
      const errors = Option.getOrNull(readErrors(response.body))?.errors ?? []
      const words = wordsOf(answer, response)
      const remaining = response.headers.get('x-ratelimit-remaining')
      if (
        errors.some((error) => error.type === 'RATE_LIMITED') ||
        ((response.status === 403 || response.status === 429) &&
          (remaining === '0' || response.headers.has('retry-after')))
      ) {
        const reset = Number(response.headers.get('x-ratelimit-reset'))
        const after = Number(response.headers.get('retry-after'))
        const at =
          Number.isFinite(reset) && reset > 0
            ? reset * 1000
            : Date.now() +
              (Number.isFinite(after) && after > 0 ? after * 1000 : UNSAID_RESET_MILLIS)
        return new ProviderLimited({
          provider: label,
          detail: words,
          resetAt: new Date(at).toISOString(),
        })
      }
      if (response.status === 401)
        return new ProviderNotAuthenticated({ provider: label, detail: words, fix })
      if (response.status === 404 || errors.some((error) => error.type === 'NOT_FOUND')) {
        return new TicketNotFound({ key, detail: words })
      }
      if (response.status === 403 || errors.some((error) => error.type === 'FORBIDDEN')) {
        return new TicketForbidden({ key, detail: words })
      }
      if (response.status >= 500) return new ProviderUnreachable({ provider: label, detail: words })
      return new TicketUnreadable({ key, detail: `${key} could not be read: ${words}` })
    }

    const graphql = (query: string, fields: ReadonlyArray<string>) =>
      Effect.map(
        gh.run(host, [
          'api',
          'graphql',
          '--hostname',
          host,
          '--include',
          '-f',
          `query=${query}`,
          ...fields,
        ]),
        (answer) => ({ answer, response: responseOf(answer.stdout) }),
      )

    const status: Effect.Effect<ProviderStatus> = Effect.gen(function* () {
      const missing: ProviderStatus = {
        state: 'missing_cli',
        sentence: `GitHub CLI (gh) was not found on the PATH. ${GH_INSTALL}`,
        fix: null,
      }
      if (Option.isNone(yield* gh.program)) return missing
      const checked = yield* Effect.result(
        Effect.gen(function* () {
          const version = yield* gh.run(host, ['--version'])
          const auth = yield* gh.run(host, ['auth', 'status', '--hostname', host])
          return { version, auth }
        }),
      )
      if (Result.isFailure(checked)) {
        return Predicate.isTagged(checked.failure, 'ProviderCliMissing')
          ? missing
          : { state: 'unreachable', sentence: checked.failure.message, fix: null }
      }
      const { version, auth } = checked.success
      if (auth.code === 0) {
        const number = /gh version (\S+)/.exec(version.stdout)?.[1] ?? 'unknown'
        return {
          state: 'ready',
          sentence: `GitHub CLI ${number} is logged in to ${host}.`,
          fix: null,
        }
      }
      if (NETWORK.test(auth.stderr)) {
        return {
          state: 'unreachable',
          sentence: `${label} is unreachable: ${said(auth, 'gh could not reach it')}`,
          fix: null,
        }
      }
      return {
        state: 'not_authenticated',
        sentence: `GitHub CLI is not logged in to ${host}.`,
        fix,
      }
    })

    const reads = (reference: TicketReference) =>
      Predicate.isTagged(reference, 'GithubIssue') && (reference.host ?? host) === host

    const read = (reference: TicketReference) =>
      Effect.gen(function* () {
        const key = ticketKeyOf(reference)
        if (!Predicate.isTagged(reference, 'GithubIssue')) {
          return yield* new TicketUnreadable({ key, detail: `${key} is not a GitHub issue.` })
        }
        const issue = GithubIssue.make({ ...reference, host })
        const base = [
          '-f',
          `owner=${issue.owner}`,
          '-f',
          `name=${issue.repo}`,
          '-F',
          `number=${String(issue.number)}`,
        ]
        const comments: Array<typeof CommentNode.Type> = []
        let first: typeof IssueNode.Type | null = null
        let after: string | null = null
        do {
          const { answer, response } = yield* graphql(
            READ_QUERY,
            after === null ? base : [...base, '-f', `after=${after}`],
          )
          if (response === null || answer.code !== 0) return yield* failureOf(key, answer)
          const decoded = readIssue(response.body)
          if (Option.isNone(decoded)) {
            return yield* new TicketUnreadable({
              key,
              detail: `${key} could not be read: GitHub's answer was not the one asked for.`,
            })
          }
          if ((decoded.value.errors ?? []).length > 0) return yield* failureOf(key, answer)
          const found = decoded.value.data?.repository?.issueOrPullRequest ?? null
          if (found === null) {
            return yield* new TicketNotFound({ key, detail: `${key} does not exist on ${host}.` })
          }
          if (!isIssue(found)) {
            return yield* new TicketUnreadable({
              key,
              detail: isPullRequest(found)
                ? `${key} is a pull request, not an issue.`
                : `${key} is not an issue.`,
            })
          }
          first ??= found
          comments.push(...found.comments.nodes.filter((node) => node !== null))
          after = found.comments.pageInfo.hasNextPage ? found.comments.pageInfo.endCursor : null
        } while (after !== null)
        if (first === null) {
          return yield* new TicketUnreadable({ key, detail: `${key} could not be read.` })
        }
        const sections = readSections(first.body)
        return {
          provider: 'github',
          reference: canonicalTicket(issue),
          key,
          url: first.url,
          title: first.title,
          description: first.body,
          sections: sections.sections,
          unrecognised: sections.unrecognised,
          status: statusOf(first.state, first.stateReason),
          author: first.author?.login ?? null,
          labels: (first.labels?.nodes ?? []).flatMap((node) => (node === null ? [] : [node.name])),
          comments: comments.map((node) => ({
            id: node.id,
            author: node.author?.login ?? null,
            body: node.body,
            createdAt: node.createdAt,
            editedAt: node.lastEditedAt,
            fingerprint: commentFingerprint(node.body),
          })),
          updatedAt: first.updatedAt,
          readAt: new Date().toISOString(),
          fingerprint: ticketFingerprint(first.title, first.body),
        } satisfies TicketVersion
      })

    const search = (text: string) =>
      Effect.gen(function* () {
        if (config.repositories.length === 0 || text.trim() === '') return []
        const query = [
          text,
          'is:issue',
          ...config.repositories.map((repository) => `repo:${repository}`),
        ].join(' ')
        const answer = yield* gh.run(host, [
          'api',
          '--method',
          'GET',
          'search/issues',
          '--hostname',
          host,
          '--include',
          '-f',
          `q=${query}`,
          '-f',
          'sort=updated',
          '-f',
          'order=desc',
          '-F',
          `per_page=${String(SEARCH_LIMIT)}`,
        ])
        const response = responseOf(answer.stdout)
        if (response === null || answer.code !== 0) return yield* failureOf(label, answer)
        const decoded = readHits(response.body)
        if (Option.isNone(decoded)) {
          return yield* new TicketUnreadable({
            key: label,
            detail: `${label} could not be searched: its answer was not the one asked for.`,
          })
        }
        return decoded.value.items.flatMap((hit): ReadonlyArray<ProviderHit> => {
          const repository = /\/repos\/([^/]+)\/([^/]+)$/.exec(hit.repository_url)
          if (repository === null) return []
          const issue = GithubIssue.make({
            host,
            owner: (repository[1] ?? '').toLowerCase(),
            repo: (repository[2] ?? '').toLowerCase(),
            number: hit.number,
          })
          const closed = hit.state.toLowerCase() === 'closed'
          return [
            {
              provider: 'github',
              reference: issue,
              canonical: canonicalTicket(issue),
              key: ticketKeyOf(issue),
              title: hit.title,
              url: hit.html_url,
              status: { state: closed ? 'closed' : 'open', wording: closed ? 'closed' : 'open' },
              updatedAt: hit.updated_at,
            },
          ]
        })
      })

    const changedSince = (known: ReadonlyArray<KnownTicket>) =>
      Effect.gen(function* () {
        const mine = known.flatMap((one) =>
          Predicate.isTagged(one.reference, 'GithubIssue') && reads(one.reference)
            ? [{ issue: GithubIssue.make({ ...one.reference, host }), updatedAt: one.updatedAt }]
            : [],
        )
        const changes: TicketChange[] = []
        for (let start = 0; start < mine.length; start += CHANGED_BATCH) {
          const batch = mine.slice(start, start + CHANGED_BATCH)
          const fields = batch.flatMap(({ issue }, index) => [
            '-f',
            `o${String(index)}=${issue.owner}`,
            '-f',
            `r${String(index)}=${issue.repo}`,
            '-F',
            `n${String(index)}=${String(issue.number)}`,
          ])
          const { answer, response } = yield* graphql(changedQuery(batch.length), fields)
          const decoded = response === null ? Option.none() : readChanged(response.body)
          const data = Option.isSome(decoded) ? decoded.value.data : undefined
          if (Option.isNone(decoded) || data === undefined || data === null) {
            return yield* failureOf(label, answer)
          }
          const errors = decoded.value.errors ?? []
          for (const [index, { issue, updatedAt }] of batch.entries()) {
            const alias = `i${String(index)}`
            const reference = canonicalTicket(issue)
            const key = ticketKeyOf(issue)
            const failed = errors.find((error) => error.path?.[0] === alias)
            const now = data[alias]?.issue?.updatedAt
            if (now === undefined) {
              const detail = gh.mask(failed?.message ?? `${key} was not found`)
              changes.push(
                MissingTicket.make({
                  reference,
                  error:
                    failed?.type === 'FORBIDDEN'
                      ? new TicketForbidden({ key, detail })
                      : new TicketNotFound({ key, detail }),
                }),
              )
            } else if (now !== updatedAt) {
              changes.push(MovedTicket.make({ reference, updatedAt: now }))
            }
          }
        }
        return changes
      })

    const write = (reference: TicketReference, text: string, expected: { fingerprint: string }) =>
      Effect.gen(function* () {
        const key = ticketKeyOf(reference)
        if (!Predicate.isTagged(reference, 'GithubIssue')) {
          return yield* new TicketUnreadable({ key, detail: `${key} is not a GitHub issue.` })
        }
        if (remoteSpecTooLong(text, REMOTE_SPEC_LIMITS.github)) {
          return yield* new TicketTooLong({ key, limit: REMOTE_SPEC_LIMITS.github })
        }
        yield* unmoved(yield* read(reference), expected)
        const issue = GithubIssue.make({ ...reference, host })
        const answer = yield* gh.run(
          host,
          [
            'api',
            '--method',
            'PATCH',
            `repos/${issue.owner}/${issue.repo}/issues/${String(issue.number)}`,
            '--hostname',
            host,
            '--include',
            '--input',
            '-',
          ],
          JSON.stringify({ body: text }),
        )
        const response = responseOf(answer.stdout)
        // The body refused as it was sent (400, 422): too long when GitHub says so, a refusal in
        // its words otherwise; never a read's failure.
        if (response !== null && (response.status === 400 || response.status === 422)) {
          const words = wordsOf(answer, response)
          return yield* /too long|maximum/i.test(words)
            ? new TicketTooLong({ key, limit: REMOTE_SPEC_LIMITS.github })
            : new TicketWriteRejected({ key, detail: words })
        }
        if (response === null || answer.code !== 0 || response.status >= 300) {
          return yield* failureOf(key, answer)
        }
        return yield* read(reference)
      })

    return { kind: 'github', label, status, reads, read, search, changedSince, write }
  })
