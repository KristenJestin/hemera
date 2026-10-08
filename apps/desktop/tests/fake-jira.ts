/**
 * A fake Jira for the ticket suites: a local HTTP server on 127.0.0.1, built from Atlassian's
 * public REST documentation, never a real Jira. It answers as Jira Cloud (REST v3, Basic auth with
 * the account email and an API token, ADF) or as Jira Data Center (REST v2, a personal access
 * token as Bearer, wiki markup), only on the endpoints Hemera uses:
 *
 * - `GET /rest/api/{2,3}/serverInfo` (anonymous), `GET …/myself`;
 * - `GET …/issue/{key}?fields=…` and `GET …/issue/{key}/comment?startAt=&maxResults=` (paged);
 * - Cloud `POST /rest/api/3/search/jql`, Data Center `POST /rest/api/2/search`, reading only the
 *   JQL Hemera writes: `project in (…)`, `text ~ "…"`, `key in (…)`.
 *
 * Every request is written down. A rule answers before the routes: a status, headers and a body,
 * or a hang (the connection held until the client closes it, counted in `closed`).
 */

import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Option, Predicate, Schema } from 'effect'

export type Deployment = 'cloud' | 'datacenter'

export interface FakeComment {
  readonly id: string
  readonly author: string | null
  /** ADF on Cloud, wiki markup on Data Center. */
  readonly body: Schema.Json
  readonly created: string
  readonly updated: string
}

export interface FakeIssue {
  readonly key: string
  readonly summary: string
  /** ADF on Cloud, wiki markup on Data Center; null for none. */
  readonly description: Schema.Json
  readonly status: { readonly name: string; readonly category: 'new' | 'indeterminate' | 'done' }
  readonly labels: ReadonlyArray<string>
  readonly reporter: string | null
  readonly updated: string
  readonly comments: ReadonlyArray<FakeComment>
}

export interface SeenRequest {
  readonly method: string
  readonly path: string
  readonly query: string
  readonly authorization: string | null
  readonly body: string
}

export interface JiraRule {
  readonly method?: string
  /** Matched against the path, without the query. */
  readonly path: RegExp
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
  /** The body, or what makes it from the request. */
  readonly body?: string | ((request: SeenRequest) => string)
  /** Never answers: held until the client closes the connection. */
  readonly hang?: boolean
  /** Holds every request it matches until this many are held, then answers them all. */
  readonly gather?: number
  /** Answers only this many requests, then lets the routes answer. */
  readonly times?: number
}

export interface FakeJiraOptions {
  readonly deployment: Deployment
  readonly email?: string
  /** The token it accepts. */
  readonly token: string
  readonly issues?: ReadonlyArray<FakeIssue>
  readonly rules?: ReadonlyArray<JiraRule>
  /** How many comments one page holds at most. */
  readonly commentPage?: number
}

export interface FakeJira {
  /** `http://127.0.0.1:<port>` */
  readonly site: string
  readonly host: string
  readonly requests: () => ReadonlyArray<SeenRequest>
  /** How many held connections the client closed. */
  readonly closed: () => number
  readonly close: () => Promise<void>
}

const NOT_FOUND = JSON.stringify({
  errorMessages: ['Issue does not exist or you do not have permission to see it.'],
  errors: {},
})
const UNAUTHENTICATED = JSON.stringify({
  errorMessages: ['Client must be authenticated to access this resource.'],
  errors: {},
})

const SearchBody = Schema.Struct({
  jql: Schema.String,
  maxResults: Schema.optionalKey(Schema.Number),
  fields: Schema.optionalKey(Schema.Array(Schema.String)),
})
const readSearch = Schema.decodeUnknownOption(Schema.fromJsonString(SearchBody))

/** Reads the JQL strings of a query, in order, as Jira unquotes them. */
const jqlStrings = (jql: string): ReadonlyArray<string> => {
  const found: string[] = []
  for (let index = 0; index < jql.length; index += 1) {
    if (jql[index] !== '"') continue
    let value = ''
    index += 1
    while (index < jql.length && jql[index] !== '"') {
      if (jql[index] === '\\') index += 1
      value += jql[index] ?? ''
      index += 1
    }
    found.push(value)
  }
  return found
}

/** The issues a JQL query of Hemera's selects, most recently updated first. */
const select = (issues: ReadonlyArray<FakeIssue>, jql: string): ReadonlyArray<FakeIssue> => {
  const keyIn = /key in \(([^)]*)\)/.exec(jql)
  if (keyIn !== null) {
    const keys = new Set(jqlStrings(keyIn[1] ?? ''))
    return issues.filter((issue) => keys.has(issue.key))
  }
  const projects = /project in \(([^)]*)\)/.exec(jql)
  const allowed = new Set(jqlStrings(projects?.[1] ?? ''))
  const textAt = jql.indexOf('text ~ ')
  const text = textAt < 0 ? '' : (jqlStrings(jql.slice(textAt))[0] ?? '')
  return issues
    .filter((issue) => allowed.has(issue.key.split('-')[0] ?? ''))
    .filter((issue) => issue.summary.toLowerCase().includes(text.toLowerCase()))
    .toSorted((one, other) => Date.parse(other.updated) - Date.parse(one.updated))
}

const fieldsOf = (issue: FakeIssue, wanted: ReadonlyArray<string>) => {
  const all = new Map<string, Schema.Json>([
    ['summary', issue.summary],
    ['description', issue.description],
    [
      'status',
      {
        name: issue.status.name,
        statusCategory: { key: issue.status.category, name: issue.status.category },
      },
    ],
    ['labels', [...issue.labels]],
    ['reporter', issue.reporter === null ? null : { displayName: issue.reporter }],
    ['updated', issue.updated],
  ])
  const fields: Record<string, Schema.Json> = {}
  for (const name of wanted) {
    const value = all.get(name)
    if (value !== undefined) fields[name] = value
  }
  return fields
}

/** Starts a fake Jira; `close()` stops it. */
export const fakeJira = async (options: FakeJiraOptions): Promise<FakeJira> => {
  const seen: SeenRequest[] = []
  const used = new Map<JiraRule, number>()
  const gathered = new Map<JiraRule, Array<() => void>>()
  let closed = 0
  const version = options.deployment === 'cloud' ? '3' : '2'
  const accepted =
    options.deployment === 'cloud'
      ? `Basic ${Buffer.from(`${options.email ?? ''}:${options.token}`).toString('base64')}`
      : `Bearer ${options.token}`
  const issues = options.issues ?? []
  const page = options.commentPage ?? 2

  const send = (
    response: ServerResponse,
    status: number,
    body: string,
    headers: Readonly<Record<string, string>> = {},
  ) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers })
    response.end(body)
  }

  const route = (request: SeenRequest, response: ServerResponse) => {
    const api = /^\/rest\/api\/(\d)\/(.*)$/.exec(request.path)
    if (api === null) return send(response, 404, '{}')
    const [, asked = '', rest = ''] = api
    if (rest === 'serverInfo') {
      return send(
        response,
        200,
        JSON.stringify({
          deploymentType: options.deployment === 'cloud' ? 'Cloud' : 'DataCenter',
          version: options.deployment === 'cloud' ? '1001.0.0' : '9.12.0',
        }),
      )
    }
    if (request.authorization !== accepted) return send(response, 401, UNAUTHENTICATED)
    if (asked !== version) return send(response, 404, '{}')
    const query = new URLSearchParams(request.query)
    if (rest === 'myself') {
      return send(response, 200, JSON.stringify({ accountId: 'account-ada', displayName: 'Ada' }))
    }
    const comments = /^issue\/([A-Z][A-Z0-9]*-\d+)\/comment$/.exec(rest)
    if (comments !== null) {
      const issue = issues.find((one) => one.key === comments[1])
      if (issue === undefined) return send(response, 404, NOT_FOUND)
      const startAt = Number(query.get('startAt') ?? '0')
      const max = Math.min(Number(query.get('maxResults') ?? '50'), page)
      return send(
        response,
        200,
        JSON.stringify({
          startAt,
          maxResults: max,
          total: issue.comments.length,
          comments: issue.comments.slice(startAt, startAt + max).map((comment) => ({
            id: comment.id,
            author: comment.author === null ? undefined : { displayName: comment.author },
            body: comment.body,
            created: comment.created,
            updated: comment.updated,
          })),
        }),
      )
    }
    const one = /^issue\/([A-Za-z][A-Za-z0-9]*-\d+)$/.exec(rest)
    if (one !== null) {
      const issue = issues.find((candidate) => candidate.key === one[1])
      if (issue === undefined) return send(response, 404, NOT_FOUND)
      const wanted = (query.get('fields') ?? '').split(',').filter((name) => name !== '')
      return send(
        response,
        200,
        JSON.stringify({ id: '10001', key: issue.key, fields: fieldsOf(issue, wanted) }),
      )
    }
    const searchPath = options.deployment === 'cloud' ? 'search/jql' : 'search'
    if (rest === searchPath && request.method === 'POST') {
      const body = readSearch(request.body)
      if (Option.isNone(body)) return send(response, 400, '{"errorMessages":["Bad request"]}')
      const max = body.value.maxResults ?? 50
      const found = select(issues, body.value.jql).slice(0, max)
      const answered = found.map((issue, index) => ({
        id: String(10_000 + index),
        key: issue.key,
        fields: fieldsOf(issue, body.value.fields ?? []),
      }))
      return send(
        response,
        200,
        JSON.stringify(
          options.deployment === 'cloud'
            ? { issues: answered, isLast: true }
            : { startAt: 0, maxResults: max, total: found.length, issues: answered },
        ),
      )
    }
    return send(response, 404, '{}')
  }

  const ruleFor = (request: SeenRequest) =>
    (options.rules ?? []).find(
      (rule) =>
        (rule.method === undefined || rule.method === request.method) &&
        rule.path.test(request.path) &&
        (rule.times === undefined || (used.get(rule) ?? 0) < rule.times),
    )

  const answer = (rule: JiraRule, request: SeenRequest, response: ServerResponse) => {
    const body =
      rule.body === undefined
        ? '{}'
        : Predicate.isString(rule.body)
          ? rule.body
          : rule.body(request)
    send(response, rule.status ?? 200, body, rule.headers)
  }

  const server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const url = new URL(incoming.url ?? '/', 'http://fake.invalid')
      const request: SeenRequest = {
        method: incoming.method ?? 'GET',
        path: url.pathname,
        query: url.search.slice(1),
        authorization: incoming.headers.authorization ?? null,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      seen.push(request)
      const rule = ruleFor(request)
      if (rule === undefined) return route(request, response)
      used.set(rule, (used.get(rule) ?? 0) + 1)
      if (rule.hang === true) {
        response.on('close', () => {
          closed += 1
        })
        return
      }
      if (rule.gather !== undefined) {
        const held = gathered.get(rule) ?? []
        held.push(() => answer(rule, request, response))
        gathered.set(rule, held)
        if (held.length >= rule.gather) {
          gathered.delete(rule)
          for (const release of held) release()
        }
        return
      }
      answer(rule, request, response)
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  // SAFETY: a server listening on a TCP port answers its address as an `AddressInfo`.
  const { port } = server.address() as AddressInfo
  const host = `127.0.0.1:${String(port)}`
  return {
    site: `http://${host}`,
    host,
    requests: () => [...seen],
    closed: () => closed,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  }
}

/** A Cloud document of paragraphs and headings: `## Why` lines become headings. */
export const adf = (...lines: ReadonlyArray<string>): Schema.Json => ({
  type: 'doc',
  version: 1,
  content: lines.map((line) => {
    const heading = /^(#{1,6}) (.*)$/.exec(line)
    return heading === null
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : {
          type: 'heading',
          attrs: { level: (heading[1] ?? '#').length },
          content: [{ type: 'text', text: heading[2] ?? '' }],
        }
  }),
})
