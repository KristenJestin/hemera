/**
 * Jira as a ticket provider (#96), over its REST API: Cloud (REST v3, Basic auth with the account
 * email and an API token, descriptions in ADF) and Data Center (REST v2, a personal access token
 * as Bearer, descriptions in wiki markup), through one client.
 *
 * - The token is opened by main at call time, held for that call only, and registered as a known
 *   secret value the moment it arrives (with the Basic credential made from it); a token Jira
 *   refuses with 401 is marked refused until another one is saved.
 * - `status`: the current user (`…/myself`). `read`: the issue's summary, description, status,
 *   labels, reporter and update date, then every comment, paged until complete. `search`: JQL on
 *   the provider's project keys, the text in one escaped JQL string, by update date, 20 at most.
 *   `changedSince`: one JQL `key in (…)` request per 50 keys, asking only `updated`; Hemera
 *   compares the dates as instants itself, so the user's Jira time zone never matters. A key
 *   answered under another key (a moved issue) is read alone by the key asked.
 * - Descriptions and comments become Markdown (ADF or wiki markup) and go through `readSections`;
 *   the fingerprint is taken on Jira's own text.
 * - Jira's messages come as they are, masked.
 */

import {
  JiraKey,
  type KnownTicket,
  type ProviderHit,
  ProviderLimited,
  ProviderNotAuthenticated,
  type ProviderStatus,
  ProviderUnreachable,
  type TicketError,
  TicketForbidden,
  TicketNotFound,
  type TicketReference,
  TicketUnreadable,
  type TicketVersion,
  adfFingerprintText,
  adfToMarkdown,
  canonicalTicket,
  jiraInstant,
  jqlString,
  readSections,
  wikiToMarkdown,
} from '@hemera/core/domain'
import type { JiraProviderConfig, TicketProviderInfo } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Effect, Option, Predicate, Schema } from 'effect'

import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { jiraTokens } from '../storage/schema.ts'
import { type JiraAnswer, JiraLink, jiraLabel } from './jira-link.ts'
import {
  MissingTicket,
  MovedTicket,
  type TicketChange,
  type TicketProvider,
  commentFingerprint,
  ticketFingerprint,
} from './provider.ts'

/** How many hits a search answers. */
const SEARCH_LIMIT = 20
/** How many keys one grouped `changedSince` request asks about. */
export const CHANGED_BATCH = 50
/** How many comments one page asks for. */
const COMMENT_PAGE = 100
/** A rate limit whose reset Jira did not say is waited out this long. */
const UNSAID_RESET_MILLIS = 60_000

/** What fixes a missing or refused token. */
const SAVE_TOKEN = 'Save a Jira API token in the Project settings.'
const REFUSED = 'The Jira token was refused: replace it in the Project settings'

/** A Jira provider as the engine reads it: its id, its Project, its configuration. */
export interface JiraProviderInfo {
  readonly id: string
  readonly projectId: string
  readonly jira: JiraProviderConfig
}

/** The source a provider's token is registered under in the registry of secrets. */
export const tokenSource = (providerId: string): string => `jira-token:${providerId}`

/**
 * The source a token being checked is registered under: apart from the stored token's, so a token
 * Jira refuses never replaces the valid one in the registry.
 */
export const checkedSource = (providerId: string): string => `jira-token-check:${providerId}`

/** The sealed token of a provider, and when Jira refused it; null when none is saved. */
export const sealedToken = (providerId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(jiraTokens)
      .where(eq(jiraTokens.providerId, providerId))
      .pipe(Effect.mapError(refusedWhile('reading the Jira token')))
    return row ?? null
  })

/** Jira refused this token: said until another one is saved (a newer one is left alone). */
const refuse = (providerId: string, ciphertext: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    yield* database
      .update(jiraTokens)
      .set({ refusedAt: new Date().toISOString() })
      .where(and(eq(jiraTokens.providerId, providerId), eq(jiraTokens.ciphertext, ciphertext)))
      .pipe(Effect.mapError(refusedWhile('marking the Jira token refused')))
  })

const ErrorBody = Schema.Struct({
  errorMessages: Schema.optionalKey(Schema.Array(Schema.String)),
  errors: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  message: Schema.optionalKey(Schema.String),
})
const readError = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorBody))

const Named = Schema.NullOr(Schema.Struct({ displayName: Schema.optionalKey(Schema.String) }))
const Status = Schema.NullOr(
  Schema.Struct({
    name: Schema.String,
    statusCategory: Schema.optionalKey(Schema.Struct({ key: Schema.String })),
  }),
)

const IssueAnswer = Schema.Struct({
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    description: Schema.optionalKey(Schema.Json),
    status: Schema.optionalKey(Status),
    labels: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
    reporter: Schema.optionalKey(Named),
    updated: Schema.String,
  }),
})

const CommentsAnswer = Schema.Struct({
  total: Schema.Number,
  comments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      author: Schema.optionalKey(Named),
      body: Schema.Json,
      created: Schema.String,
      updated: Schema.optionalKey(Schema.String),
    }),
  ),
})

const SearchAnswer = Schema.Struct({
  issues: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      fields: Schema.Struct({
        summary: Schema.optionalKey(Schema.String),
        status: Schema.optionalKey(Status),
        updated: Schema.optionalKey(Schema.String),
      }),
    }),
  ),
})

const Myself = Schema.Struct({ displayName: Schema.optionalKey(Schema.String) })

const readIssue = Schema.decodeUnknownOption(Schema.fromJsonString(IssueAnswer))
const readComments = Schema.decodeUnknownOption(Schema.fromJsonString(CommentsAnswer))
const readSearch = Schema.decodeUnknownOption(Schema.fromJsonString(SearchAnswer))
const readMyself = Schema.decodeUnknownOption(Schema.fromJsonString(Myself))

/** A status as Hemera says it: closed in Jira's `done` category, open otherwise, in Jira's words. */
const statusOf = (status: typeof Status.Type | undefined) =>
  status === undefined || status === null
    ? { state: 'open' as const, wording: 'unknown' }
    : {
        state: status.statusCategory?.key === 'done' ? ('closed' as const) : ('open' as const),
        wording: status.name,
      }

/** When a rate limit resets: `Retry-After` in seconds or as a date, a minute otherwise. */
const resetOf = (headers: Headers): string => {
  const said = headers.get('retry-after') ?? ''
  const seconds = Number(said)
  const at =
    said !== '' && Number.isFinite(seconds) && seconds >= 0
      ? Date.now() + seconds * 1000
      : Number.isNaN(Date.parse(said))
        ? Date.now() + UNSAID_RESET_MILLIS
        : Date.parse(said)
  return new Date(at).toISOString()
}

/** A text of Jira's, Markdown for Hemera and as Jira wrote it for the fingerprint. */
const textOf = (config: JiraProviderConfig, value: Schema.Json | undefined) => {
  const given = value ?? null
  if (config.deployment === 'cloud') {
    return { markdown: adfToMarkdown(given), raw: adfFingerprintText(given) }
  }
  const wiki = Predicate.isString(given) ? given : ''
  return { markdown: wikiToMarkdown(wiki), raw: wiki }
}

/** The Basic credential of a Cloud account: its email and the token. */
const basicOf = (provider: JiraProviderInfo, token: string): string =>
  Buffer.from(`${provider.jira.email ?? ''}:${token}`, 'utf8').toString('base64')

/** What a token is masked as: itself, and on Cloud the Basic credential made from it. */
export const tokenValues = (provider: JiraProviderInfo, token: string): ReadonlyArray<string> =>
  provider.jira.deployment === 'cloud' ? [token, basicOf(provider, token)] : [token]

/** A JQL search as Hemera asks it, on Cloud and Data Center alike. */
interface SearchRequest {
  readonly jql: string
  readonly maxResults: number
  readonly fields: ReadonlyArray<string>
}

/** One call's requests, with the credential it was opened with. */
interface Session {
  readonly get: (path: string) => Effect.Effect<JiraAnswer, ProviderUnreachable>
  readonly post: (
    path: string,
    body: SearchRequest,
  ) => Effect.Effect<JiraAnswer, ProviderUnreachable>
}

/**
 * The requests of one call on a site with a token: Basic with the account email on Cloud, Bearer
 * on Data Center; the token, and the Basic credential made from it, registered as secrets first.
 */
const sessionWith = (provider: JiraProviderInfo, token: string, source: string) =>
  Effect.gen(function* () {
    const link = yield* JiraLink
    const secrets = yield* Secrets
    const { site, deployment } = provider.jira
    const basic = basicOf(provider, token)
    const authorization = deployment === 'cloud' ? `Basic ${basic}` : `Bearer ${token}`
    secrets.register(source, tokenValues(provider, token))
    const api = deployment === 'cloud' ? '/rest/api/3' : '/rest/api/2'
    const headers = { accept: 'application/json', authorization }
    return {
      get: (path) => link.request(site, `${api}${path}`, { method: 'GET', headers }),
      post: (path, body) =>
        link.request(site, `${api}${path}`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
    } satisfies Session
  })

/** What a failed answer is, as an error of the port, Jira's message as is and masked. */
const failureOf = (
  label: string,
  key: string,
  answer: JiraAnswer,
  mask: (text: string) => string,
): TicketError => {
  const decoded = Option.getOrNull(readError(answer.body))
  const said = [
    ...(decoded?.errorMessages ?? []),
    ...Object.values(decoded?.errors ?? {}),
    ...(decoded?.message === undefined ? [] : [decoded.message]),
  ].join(' ')
  // The whole body is masked before it is cut: a cut first could leave part of a secret unknown to
  // the mask.
  const words =
    mask(said) || mask(answer.body.trim()).slice(0, 300) || `HTTP ${String(answer.status)}`
  switch (answer.status) {
    case 401:
      return new ProviderNotAuthenticated({
        provider: label,
        detail: `${REFUSED} (${words})`,
        fix: SAVE_TOKEN,
      })
    case 403:
      return new TicketForbidden({ key, detail: words })
    case 404:
      return new TicketNotFound({ key, detail: words })
    case 429:
      return new ProviderLimited({
        provider: label,
        detail: words,
        resetAt: resetOf(answer.headers),
      })
    default:
      return answer.status >= 500
        ? new ProviderUnreachable({ provider: label, detail: words })
        : new TicketUnreadable({ key, detail: `${key} could not be read: ${words}` })
  }
}

/** Checks a token against the site, before it is stored: the name Jira knows its owner by. */
export const checkToken = (provider: JiraProviderInfo, token: string) =>
  Effect.gen(function* () {
    const session = yield* sessionWith(provider, token, checkedSource(provider.id))
    const answer = yield* session.get('/myself')
    if (answer.status !== 200) {
      const secrets = yield* Secrets
      return yield* failureOf(
        jiraLabel(provider.jira.site),
        'the current user',
        answer,
        secrets.mask,
      )
    }
    return Option.match(readMyself(answer.body), {
      onNone: () => 'an account',
      onSome: (myself) => myself.displayName ?? 'an account',
    })
  })

/** A Jira provider of a Project, for its site and project keys. */
export const jiraProvider = (info: TicketProviderInfo, jira: JiraProviderConfig) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<JiraLink | Database | Secrets>()
    const secrets = yield* Secrets
    const provider: JiraProviderInfo = { id: info.id, projectId: info.projectId, jira }
    const site = jira.site
    const host = new URL(site).host
    const label = jiraLabel(site)
    const mask = (text: string) => secrets.mask(text)
    const inContext = <A, E>(effect: Effect.Effect<A, E, JiraLink | Database | Secrets>) =>
      Effect.provideContext(effect, context)

    /** The stored token, opened by main for this call, and the call's session. */
    const opened = Effect.gen(function* () {
      const row = yield* sealedToken(provider.id).pipe(
        Effect.mapError(
          (failed) =>
            new ProviderNotAuthenticated({
              provider: label,
              detail: failed.message,
              fix: SAVE_TOKEN,
            }),
        ),
      )
      if (row === null) {
        return yield* new ProviderNotAuthenticated({
          provider: label,
          detail: `no Jira token is saved for ${host}`,
          fix: SAVE_TOKEN,
        })
      }
      const link = yield* JiraLink
      const token = yield* link.open(row.ciphertext).pipe(
        Effect.mapError(
          (failed) =>
            new ProviderNotAuthenticated({
              provider: label,
              detail: failed.message,
              fix: SAVE_TOKEN,
            }),
        ),
      )
      const session = yield* sessionWith(provider, token, tokenSource(provider.id))
      /** A 401 marks this token refused, whatever the call. */
      const watched = (asked: Effect.Effect<JiraAnswer, ProviderUnreachable>) =>
        Effect.tap(asked, (answer) =>
          answer.status === 401
            ? Effect.ignore(inContext(refuse(provider.id, row.ciphertext)))
            : Effect.void,
        )
      return {
        get: (path) => watched(session.get(path)),
        post: (path, body) => watched(session.post(path, body)),
      } satisfies Session
    })

    const status: Effect.Effect<ProviderStatus> = inContext(
      Effect.gen(function* () {
        const session = yield* opened
        const answer = yield* session.get('/myself')
        if (answer.status === 200) {
          const name = Option.match(readMyself(answer.body), {
            onNone: () => 'an account',
            onSome: (myself) => myself.displayName ?? 'an account',
          })
          return {
            state: 'ready',
            sentence: `Signed in to Jira at ${host} as ${name}.`,
            fix: null,
          } satisfies ProviderStatus
        }
        return yield* failureOf(label, 'the current user', answer, mask)
      }).pipe(
        Effect.catch((failed): Effect.Effect<ProviderStatus> =>
          Effect.succeed(
            Predicate.isTagged(failed, 'ProviderNotAuthenticated')
              ? {
                  state: 'not_authenticated',
                  sentence: failed.detail.startsWith(REFUSED)
                    ? `${REFUSED}.`
                    : `${failed.detail.replace(/\.$/, '')}: save it again in the Project settings.`,
                  fix: null,
                }
              : Predicate.isTagged(failed, 'TicketForbidden')
                ? {
                    state: 'not_authenticated',
                    sentence: `Jira refused access with this token: ${failed.detail}`,
                    fix: null,
                  }
                : Predicate.isTagged(failed, 'ProviderLimited')
                  ? {
                      state: 'unreachable',
                      sentence: failed.message,
                      fix: null,
                      limitedUntil: failed.resetAt,
                    }
                  : { state: 'unreachable', sentence: failed.message, fix: null },
          ),
        ),
      ),
    )

    const reads = (reference: TicketReference) =>
      Predicate.isTagged(reference, 'JiraKey') &&
      (reference.host === null
        ? jira.projectKeys.includes(reference.key.split('-')[0] ?? '')
        : reference.host === host)

    const referenceOf = (key: string) => JiraKey.make({ host, key })

    const read = (reference: TicketReference) =>
      inContext(
        Effect.gen(function* () {
          if (!Predicate.isTagged(reference, 'JiraKey')) {
            return yield* new TicketUnreadable({
              key: label,
              detail: 'This reference is not a Jira key.',
            })
          }
          const key = reference.key
          const session = yield* opened
          const answer = yield* session.get(
            `/issue/${encodeURIComponent(key)}?fields=summary,description,status,labels,reporter,updated`,
          )
          if (answer.status !== 200) return yield* failureOf(label, key, answer, mask)
          const issue = readIssue(answer.body)
          if (Option.isNone(issue)) {
            return yield* new TicketUnreadable({
              key,
              detail: `${key} could not be read: Jira's answer was not the one asked for.`,
            })
          }
          const { fields } = issue.value
          const found = issue.value.key
          const comments: Array<(typeof CommentsAnswer.Type.comments)[number]> = []
          for (;;) {
            const page = yield* session.get(
              `/issue/${encodeURIComponent(found)}/comment?startAt=${String(comments.length)}&maxResults=${String(COMMENT_PAGE)}&orderBy=created`,
            )
            if (page.status !== 200) return yield* failureOf(label, found, page, mask)
            const decoded = readComments(page.body)
            if (Option.isNone(decoded)) {
              return yield* new TicketUnreadable({
                key: found,
                detail: `${found} could not be read: Jira's comments were not the ones asked for.`,
              })
            }
            comments.push(...decoded.value.comments)
            if (decoded.value.comments.length === 0 || comments.length >= decoded.value.total) break
          }
          const description = textOf(jira, fields.description)
          const sections = readSections(description.markdown)
          return {
            provider: 'jira',
            reference: canonicalTicket(referenceOf(found)),
            key: found,
            url: `${site}/browse/${found}`,
            title: fields.summary,
            description: description.markdown,
            sections: sections.sections,
            unrecognised: sections.unrecognised,
            status: statusOf(fields.status),
            author: fields.reporter?.displayName ?? null,
            labels: fields.labels ?? [],
            comments: comments.map((comment) => {
              const body = textOf(jira, comment.body)
              const created = jiraInstant(comment.created)
              const updated = comment.updated === undefined ? created : jiraInstant(comment.updated)
              return {
                id: comment.id,
                author: comment.author?.displayName ?? null,
                body: body.markdown,
                createdAt: created,
                editedAt: updated === created ? null : updated,
                fingerprint: commentFingerprint(body.raw),
              }
            }),
            updatedAt: jiraInstant(fields.updated),
            readAt: new Date().toISOString(),
            fingerprint: ticketFingerprint(fields.summary, description.raw),
          } satisfies TicketVersion
        }),
      )

    const searchPath = jira.deployment === 'cloud' ? '/search/jql' : '/search'

    const search = (text: string) =>
      inContext(
        Effect.gen(function* () {
          if (jira.projectKeys.length === 0 || text.trim() === '') return []
          const session = yield* opened
          const jql = `project in (${jira.projectKeys.map(jqlString).join(', ')}) AND text ~ ${jqlString(text)} ORDER BY updated DESC`
          const answer = yield* session.post(searchPath, {
            jql,
            maxResults: SEARCH_LIMIT,
            fields: ['summary', 'status', 'updated'],
          })
          if (answer.status !== 200) return yield* failureOf(label, label, answer, mask)
          const decoded = readSearch(answer.body)
          if (Option.isNone(decoded)) {
            return yield* new TicketUnreadable({
              key: label,
              detail: `${label} could not be searched: its answer was not the one asked for.`,
            })
          }
          return decoded.value.issues.map((issue): ProviderHit => {
            const reference = referenceOf(issue.key)
            return {
              provider: 'jira',
              reference,
              canonical: canonicalTicket(reference),
              key: issue.key,
              title: issue.fields.summary ?? issue.key,
              url: `${site}/browse/${issue.key}`,
              status: statusOf(issue.fields.status),
              updatedAt: jiraInstant(issue.fields.updated ?? ''),
            }
          })
        }),
      )

    /** One key's update date read alone: what a batch Jira refused falls back to. */
    const updatedAlone = (session: Session, key: string) =>
      Effect.gen(function* () {
        const answer = yield* session.get(`/issue/${encodeURIComponent(key)}?fields=updated`)
        if (answer.status === 404 || answer.status === 403) {
          return { key, failure: failureOf(label, key, answer, mask) }
        }
        if (answer.status !== 200) return yield* failureOf(label, key, answer, mask)
        const issue = readSearch(`{"issues":[${answer.body}]}`)
        const updated = Option.isSome(issue) ? issue.value.issues[0]?.fields.updated : undefined
        return { key, updated }
      })

    const changedSince = (known: ReadonlyArray<KnownTicket>) =>
      inContext(
        Effect.gen(function* () {
          const mine = known.flatMap((one) =>
            Predicate.isTagged(one.reference, 'JiraKey') && reads(one.reference)
              ? [{ key: one.reference.key, updatedAt: one.updatedAt }]
              : [],
          )
          if (mine.length === 0) return []
          const session = yield* opened
          const changes: TicketChange[] = []
          for (let start = 0; start < mine.length; start += CHANGED_BATCH) {
            const batch = mine.slice(start, start + CHANGED_BATCH)
            const answer = yield* session.post(searchPath, {
              jql: `key in (${batch.map((one) => jqlString(one.key)).join(', ')})`,
              maxResults: CHANGED_BATCH,
              fields: ['updated'],
            })
            const now = new Map<string, string | undefined>()
            const failures = new Map<string, TicketError>()
            if (answer.status === 400) {
              // A key Jira no longer knows can make it refuse the whole query: each is asked alone.
              for (const one of batch) {
                const alone = yield* updatedAlone(session, one.key)
                if ('failure' in alone) failures.set(one.key, alone.failure)
                else now.set(one.key, alone.updated)
              }
            } else {
              if (answer.status !== 200) return yield* failureOf(label, label, answer, mask)
              const decoded = readSearch(answer.body)
              if (Option.isNone(decoded)) {
                return yield* new TicketUnreadable({
                  key: label,
                  detail: `${label} could not be checked: its answer was not the one asked for.`,
                })
              }
              for (const issue of decoded.value.issues) now.set(issue.key, issue.fields.updated)
              // An issue moved to another project comes back under its new key: when the answer
              // holds a key not asked, each key asked and not answered is read alone, by the key
              // asked, which Jira still answers for a moved issue.
              const asked = new Set(batch.map((one) => one.key))
              if (decoded.value.issues.some((issue) => !asked.has(issue.key))) {
                for (const one of batch) {
                  if (now.has(one.key)) continue
                  const alone = yield* updatedAlone(session, one.key)
                  if ('failure' in alone) failures.set(one.key, alone.failure)
                  else now.set(one.key, alone.updated)
                }
              }
            }
            for (const one of batch) {
              const reference = canonicalTicket(referenceOf(one.key))
              const updated = now.get(one.key)
              if (updated === undefined) {
                const failure = failures.get(one.key)
                changes.push(
                  MissingTicket.make({
                    reference,
                    error:
                      failure !== undefined && Predicate.isTagged(failure, 'TicketForbidden')
                        ? failure
                        : new TicketNotFound({
                            key: one.key,
                            detail: `${one.key} was not found on ${host}`,
                          }),
                  }),
                )
              } else if (jiraInstant(updated) !== jiraInstant(one.updatedAt)) {
                changes.push(MovedTicket.make({ reference, updatedAt: jiraInstant(updated) }))
              }
            }
          }
          return changes
        }),
      )

    return {
      kind: 'jira',
      label,
      status,
      reads,
      read,
      search,
      changedSince,
    } satisfies TicketProvider
  })
