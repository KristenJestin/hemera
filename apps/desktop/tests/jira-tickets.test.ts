/**
 * Jira as a ticket provider (#96), over its REST API: a Jira provider of a Project (its site, its
 * deployment, its account email on Cloud, its project keys, never a token); its token sealed by
 * main and stored as ciphertext only, checked against the site when it is saved and opened at call
 * time; Basic auth on Cloud and Bearer on Data Center; a redirect to another host refused; Jira's
 * errors as the port's typed errors, its messages masked; a ticket read with its ADF or wiki text
 * as Markdown and every comment; a JQL search; the grouped `changedSince`; and what happens when
 * two reads run at once, a search is interrupted, or Jira fails while GitHub answers.
 *
 * Jira is the local fake of `fake-jira.ts`; no test reaches a real Jira. The token is sealed by a
 * stand-in for main that reverses its base64, so a sealed token never holds the token's bytes.
 */

import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  ProviderLimited,
  ProviderNotAuthenticated,
  ProviderUnreachable,
  TicketForbidden,
  TicketNotFound,
  type TicketReference,
  adfFingerprintText,
  parseTicketReference,
} from '@hemera/core/domain'
import {
  InvalidMissionIdea,
  InvalidProviderConfig,
  type StartResult,
  TokenUnreadable,
} from '@hemera/ipc'
import { Effect, Exit, Fiber, Predicate, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { readEvents } from '../src/engine/journal.ts'
import { createProject } from '../src/engine/projects.ts'
import { Secrets, secretsRegistry } from '../src/engine/secrets.ts'
import { createStart, searchStart } from '../src/engine/start/field.ts'
import { Database } from '../src/engine/storage/database.ts'
import { jiraTokens } from '../src/engine/storage/schema.ts'
import { CHANGED_BATCH } from '../src/engine/tickets/jira.ts'
import type { JiraSettings } from '../src/engine/tickets/jira-link.ts'
import { jiraDeployment } from '../src/engine/tickets/jira-link.ts'
import {
  jiraTokenState,
  removeJiraToken,
  saveJiraToken,
} from '../src/engine/tickets/jira-tokens.ts'
import {
  checkAgain,
  missionTicket,
  providerStatus,
  readTicket,
} from '../src/engine/tickets/link.ts'
import { providerOf } from '../src/engine/tickets/search.ts'
import { addGithub, addJira, removeProvider } from '../src/engine/tickets/store.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { type FakeGh, fakeGh, included } from './fake-gh.ts'
import {
  type FakeIssue,
  type FakeJira,
  type FakeJiraOptions,
  type JiraRule,
  adf,
  fakeJira,
} from './fake-jira.ts'
import { repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
const servers: FakeJira[] = []
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('jira-tickets'))
  work = realpathSync.native(temporaryFolder('jira-tickets-work'))
})
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  removeFolders()
})

const TOKEN = 'jira-test-token-4471c0de'
const EMAIL = 'ada@acme.test'
const BASIC = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')

/** What main hands the engine to store: the token sealed, never its bytes. */
const seal = (token: string) =>
  `sealed:${[...Buffer.from(token).toString('base64')].toReversed().join('')}`
/** Main opening a sealed token at call time. */
const open = (ciphertext: string) =>
  ciphertext.startsWith('sealed:')
    ? Effect.succeed(
        Buffer.from(
          [...ciphertext.slice('sealed:'.length)].toReversed().join(''),
          'base64',
        ).toString(),
      )
    : Effect.fail(new TokenUnreadable({ reason: 'this ciphertext was sealed elsewhere' }))

const jira = async (options: Partial<FakeJiraOptions> = {}) => {
  const server = await fakeJira({ deployment: 'cloud', email: EMAIL, token: TOKEN, ...options })
  servers.push(server)
  return server
}

const engine = (settings: Partial<JiraSettings> = {}, gh?: FakeGh) =>
  commandsEngine(data, {
    jira: { open, ...settings },
    secrets: secretsRegistry(),
    gh: gh?.settings,
  })

const acmeProject = Effect.gen(function* () {
  const main = join(work, 'acme')
  mkdirSync(main, { recursive: true })
  repository(join(main, 'api'))
  return yield* createProject({ name: 'Acme', mainCheckout: main, repositories: ['api'] })
})

/** Acme with a Jira provider on the fake's site, its token saved. */
const acme = (server: FakeJira, deployment: 'cloud' | 'datacenter' = 'cloud', saved = true) =>
  Effect.gen(function* () {
    const project = yield* acmeProject
    const provider = yield* addJira(project.id, {
      site: server.site,
      deployment,
      email: deployment === 'cloud' ? EMAIL : null,
      projectKeys: ['shop', 'OPS'],
    })
    if (saved) expect(yield* saveJiraToken(provider.id, seal(TOKEN), TOKEN)).toBe('saved')
    return { project, provider }
  })

const reference = (text: string): TicketReference => {
  const parsed = parseTicketReference(text)
  if (parsed === null) throw new Error(`${text} is not a reference`)
  return parsed
}

const comment = (id: string, body: string, created = '2026-10-01T09:00:00.000+0200') => ({
  id,
  author: id === '3' ? null : 'Grace',
  body: adf(body),
  created,
  updated: id === '2' ? '2026-10-01T11:00:00.000+0200' : created,
})

const SHOP_7: FakeIssue = {
  key: 'SHOP-7',
  summary: 'Export notes as Markdown',
  description: adf('Reported by the support team.', '## Why', 'Exports are slow.'),
  status: { name: 'In review', category: 'indeterminate' },
  labels: ['export', 'notes'],
  reporter: 'Ada',
  updated: '2026-10-01T12:00:00.000+0200',
  comments: [
    comment('1', 'Keep the accents.'),
    comment('2', 'And the dates.'),
    comment('3', 'Done?'),
  ],
}

const SHOP_8: FakeIssue = {
  ...SHOP_7,
  key: 'SHOP-8',
  summary: 'Export fails on large notes',
  description: null,
  status: { name: 'Done', category: 'done' },
  updated: '2026-10-02T12:00:00.000+0200',
  comments: [],
}

/** Every byte the engine wrote in the data folder, as text. */
const writtenBytes = (folder: string): string =>
  readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .map((name) => join(folder, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => readFileSync(path).toString('latin1'))
    .join('\n')

describe('A Jira provider: its site, deployment, email and project keys, never a token', () => {
  test('addJira keeps the configuration, the keys in capitals, and no token anywhere', async () => {
    const server = await jira()
    const info = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acmeProject
          return yield* addJira(project.id, {
            site: `${server.site}/`,
            deployment: 'cloud',
            email: EMAIL,
            projectKeys: ['shop', ' OPS', 'shop'],
          })
        }),
      ),
    )
    expect(info.kind).toBe('jira')
    expect(info.host).toBe(server.host)
    expect(info.jira).toEqual({
      site: server.site,
      deployment: 'cloud',
      email: EMAIL,
      projectKeys: ['SHOP', 'OPS'],
    })
    expect(server.requests()).toEqual([])
  })

  test('a site over plain http that is not this machine, Cloud without an email, a bad key: refused', async () => {
    const refusals = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acmeProject
          const tries = [
            {
              site: 'http://jira.acme.test',
              deployment: 'datacenter' as const,
              email: null,
              projectKeys: [],
            },
            {
              site: 'https://acme.atlassian.net',
              deployment: 'cloud' as const,
              email: null,
              projectKeys: [],
            },
            {
              site: 'https://acme.atlassian.net',
              deployment: 'cloud' as const,
              email: EMAIL,
              projectKeys: ['shop-1'],
            },
            { site: 'not a url', deployment: 'cloud' as const, email: EMAIL, projectKeys: [] },
          ]
          return yield* Effect.forEach(tries, (config) => Effect.flip(addJira(project.id, config)))
        }),
      ),
    )
    expect(refusals.every((refusal) => refusal instanceof InvalidProviderConfig)).toBe(true)
  })

  test('a second Jira provider on the same site is refused', async () => {
    const server = await jira()
    const second = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(server, 'cloud', false)
          return yield* Effect.flip(
            addJira(project.id, {
              site: server.site,
              deployment: 'cloud',
              email: EMAIL,
              projectKeys: [],
            }),
          )
        }),
      ),
    )
    expect(second.message).toContain('already has a provider in this Project')
  })

  test('the deployment is read from the site’s server information, with no token sent', async () => {
    const cloud = await jira()
    const center = await jira({ deployment: 'datacenter' })
    const found = await engine()(({ profile }) =>
      profile.use(
        Effect.all([
          jiraDeployment(cloud.site),
          jiraDeployment(center.site),
          jiraDeployment('http://127.0.0.1:9/'),
        ]),
      ),
    )
    expect(found).toEqual(['cloud', 'datacenter', null])
    expect([...cloud.requests(), ...center.requests()].map((one) => one.authorization)).toEqual([
      null,
      null,
    ])
  })
})

describe('The deployment is asked only of a site addJira would keep', () => {
  test('plain http to another machine, another scheme, or credentials in the address: null, nothing sent', async () => {
    const asked: string[] = []
    const recording = (url: string) => {
      asked.push(url)
      return Promise.resolve(new Response('{"deploymentType":"Cloud"}', { status: 200 }))
    }
    const found = await engine({ fetch: recording })(({ profile }) =>
      profile.use(
        Effect.all([
          jiraDeployment('http://jira.acme.test'),
          jiraDeployment('ftp://jira.acme.test'),
          jiraDeployment('https://ada:secret@jira.acme.test'),
          jiraDeployment('https://jira.acme.test'),
        ]),
      ),
    )
    expect(found).toEqual([null, null, null, 'cloud'])
    expect(asked).toEqual(['https://jira.acme.test/rest/api/2/serverInfo'])
  })
})

describe('The token: sealed by main, stored as ciphertext only, checked when saved', () => {
  test('saving a token stores only its ciphertext: status saved, and its bytes nowhere on disk', async () => {
    const server = await jira()
    const state = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { provider } = yield* acme(server)
          return yield* jiraTokenState(provider.id)
        }),
      ),
    )
    expect(state).toEqual({ ciphertext: seal(TOKEN), refused: false })
    expect(server.requests().map((one) => [one.path, one.authorization])).toEqual([
      ['/rest/api/3/myself', `Basic ${BASIC}`],
    ])
    const written = writtenBytes(data)
    expect(written).not.toContain(TOKEN)
    expect(written).not.toContain(BASIC)
  })

  test('a token the site refuses, checked after a valid one, leaves both masked', async () => {
    const server = await jira()
    const wrong = 'a-wrong-token-90ab'
    const masked = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { provider } = yield* acme(server)
          expect(yield* saveJiraToken(provider.id, seal(wrong), wrong)).toBe('invalid')
          return yield* Secrets.use((secrets) =>
            Effect.succeed(secrets.mask(`${TOKEN} ${BASIC} ${wrong}`)),
          )
        }),
      ),
    )
    expect(masked).not.toContain(TOKEN)
    expect(masked).not.toContain(BASIC)
    expect(masked).not.toContain(wrong)
  })

  test('a token the site refuses is not stored, and the answer says so', async () => {
    const server = await jira()
    const { answer, state } = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { provider } = yield* acme(server, 'cloud', false)
          const saved = yield* saveJiraToken(provider.id, seal('a-wrong-token'), 'a-wrong-token')
          return { answer: saved, state: yield* jiraTokenState(provider.id) }
        }),
      ),
    )
    expect(answer).toBe('invalid')
    expect(state).toEqual({ ciphertext: null, refused: false })
  })

  test('removing the token, then the provider, leaves no ciphertext kept', async () => {
    const server = await jira()
    const states = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme(server)
          yield* removeJiraToken(provider.id)
          const removed = yield* jiraTokenState(provider.id)
          const again = yield* addJira(project.id, {
            site: `${server.site}/other`,
            deployment: 'cloud',
            email: EMAIL,
            projectKeys: [],
          }).pipe(Effect.flip)
          expect(again.message).toContain('already has a provider')
          yield* saveJiraToken(provider.id, seal(TOKEN), TOKEN)
          yield* removeProvider(provider.id)
          const database = yield* Database
          const kept = yield* database.select().from(jiraTokens)
          return { removed, kept }
        }),
      ),
    )
    expect(states.removed).toEqual({ ciphertext: null, refused: false })
    expect(states.kept).toEqual([])
  })

  test('a token main cannot open says how to fix it, and nothing is sent', async () => {
    const server = await jira()
    const status = await engine({
      open: () => Effect.fail(new TokenUnreadable({ reason: 'no protected storage now' })),
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { provider } = yield* acme(server)
          return yield* providerStatus(provider.id)
        }),
      ),
    )
    expect(status.state).toBe('not_authenticated')
    expect(status.sentence).toContain('cannot be read on this system')
    expect(server.requests()).toHaveLength(1)
  })
})

describe('Basic auth on Cloud, Bearer on Data Center, and only to the site', () => {
  test('Cloud: Basic with the account email and the token, on REST v3; ready', async () => {
    const server = await jira()
    const status = await engine()(({ profile }) =>
      profile.use(Effect.flatMap(acme(server), ({ provider }) => providerStatus(provider.id))),
    )
    expect(status).toEqual({
      state: 'ready',
      sentence: `Signed in to Jira at ${server.host} as Ada.`,
      fix: null,
    })
    expect(server.requests().map((one) => [one.path, one.authorization])).toEqual([
      ['/rest/api/3/myself', `Basic ${BASIC}`],
      ['/rest/api/3/myself', `Basic ${BASIC}`],
    ])
  })

  test('Data Center: the personal access token as Bearer, on REST v2', async () => {
    const server = await jira({ deployment: 'datacenter' })
    const status = await engine()(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(server, 'datacenter'), ({ provider }) => providerStatus(provider.id)),
      ),
    )
    expect(status.state).toBe('ready')
    expect(server.requests().map((one) => [one.path, one.authorization])).toEqual([
      ['/rest/api/2/myself', `Bearer ${TOKEN}`],
      ['/rest/api/2/myself', `Bearer ${TOKEN}`],
    ])
  })

  test('a redirect to another host is refused, and the token never reaches it', async () => {
    const elsewhere = await jira()
    const server = await jira({
      rules: [
        {
          path: /\/issue\/SHOP-7$/,
          status: 302,
          headers: { location: `${elsewhere.site}/rest/api/3/issue/SHOP-7` },
        },
      ],
      issues: [SHOP_7],
    })
    const failure = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(server)
          return yield* Effect.flip(readTicket(project.id, reference('SHOP-7')))
        }),
      ),
    )
    expect(failure).toBeInstanceOf(ProviderUnreachable)
    expect(failure.message).toContain(`redirected to ${elsewhere.host}`)
    expect(elsewhere.requests()).toEqual([])
  })

  test('a redirect on the same site is followed', async () => {
    const server = await jira({
      rules: [
        {
          path: /\/issue\/SHOP-70$/,
          status: 301,
          headers: {
            location:
              '/rest/api/3/issue/SHOP-7?fields=summary,description,status,labels,reporter,updated',
          },
        },
      ],
      issues: [SHOP_7],
    })
    const version = await engine()(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(server), ({ project }) => readTicket(project.id, reference('SHOP-70'))),
      ),
    )
    expect(version.key).toBe('SHOP-7')
  })
})

describe('Jira’s answers as the port’s typed errors', () => {
  /** The default call limit; a hang test alone gives a short one. */
  const failing = async (rule: ReadonlyArray<JiraRule>, limitMillis?: number) => {
    const server = await jira({ rules: rule, issues: [SHOP_7] })
    const outcome = await engine({ limitMillis })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme(server)
          const failure = yield* Effect.flip(readTicket(project.id, reference('SHOP-7')))
          return { failure, state: yield* jiraTokenState(provider.id) }
        }),
      ),
    )
    return { ...outcome, server }
  }

  test('401: not logged in, the token marked refused, the sentence says to replace it', async () => {
    const { failure, state } = await failing([
      { path: /\/issue\//, status: 401, body: '{"errorMessages":["Unauthorized"]}' },
    ])
    expect(failure).toBeInstanceOf(ProviderNotAuthenticated)
    expect(failure.message).toContain(
      'The Jira token was refused: replace it in the Project settings',
    )
    expect(state.refused).toBe(true)
  })

  test('403: forbidden, with Jira’s message as is', async () => {
    const { failure } = await failing([
      {
        path: /\/issue\//,
        status: 403,
        body: '{"errorMessages":["You do not have the permission to see the specified issue."],"errors":{}}',
      },
    ])
    expect(failure).toBeInstanceOf(TicketForbidden)
    expect(failure.message).toContain('You do not have the permission to see the specified issue.')
  })

  test('404: not found, with Jira’s message as is', async () => {
    const server = await jira()
    const failure = await engine()(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(server), ({ project }) =>
          Effect.flip(readTicket(project.id, reference('SHOP-404'))),
        ),
      ),
    )
    expect(failure).toBeInstanceOf(TicketNotFound)
    expect(failure.message).toContain(
      'Issue does not exist or you do not have permission to see it.',
    )
  })

  test('429 with Retry-After: rate limited until then', async () => {
    const before = Date.now()
    const { failure } = await failing([
      { path: /\/issue\//, status: 429, headers: { 'retry-after': '120' } },
    ])
    expect(failure).toBeInstanceOf(ProviderLimited)
    const resetAt = Predicate.isTagged(failure, 'ProviderLimited') ? Date.parse(failure.resetAt) : 0
    expect(resetAt).toBeGreaterThanOrEqual(before + 120_000)
    expect(resetAt).toBeLessThanOrEqual(Date.now() + 120_000)
  })

  test('429 on the status: rate limited until Retry-After, recorded, and no read is sent before it', async () => {
    const before = Date.now()
    const server = await jira({
      issues: [SHOP_7],
      rules: [{ path: /\/myself$/, status: 429, headers: { 'retry-after': '120' } }],
    })
    const [status, read] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme(server)
          const checked = yield* checkAgain(provider.id)
          return [checked, yield* Effect.flip(readTicket(project.id, reference('SHOP-7')))] as const
        }),
      ),
    )
    expect(status.state).toBe('unreachable')
    expect(status.sentence).toContain('rate limited until')
    expect(Date.parse(status.limitedUntil ?? '')).toBeGreaterThanOrEqual(before + 120_000)
    expect(read).toBeInstanceOf(ProviderLimited)
    expect(server.requests().filter((one) => one.path.includes('/issue/'))).toEqual([])
  })

  test('a hung server: unreachable at the limit, and the request is closed', async () => {
    const { failure, server } = await failing([{ path: /\/issue\//, hang: true }], 300)
    expect(failure).toBeInstanceOf(ProviderUnreachable)
    expect(failure.message).toContain('did not answer within 0.3 seconds')
    await Effect.runPromise(
      until(
        Effect.sync(() => server.closed()),
        (closed) => closed === 1,
      ),
    )
    expect(server.closed()).toBe(1)
  })

  test('an error body that echoes the token shows •••, and the token is never written anywhere', async () => {
    const echo = (request: { readonly authorization: string | null }) => {
      const header = request.authorization ?? ''
      // The header as is, then its credential alone, as a careless proxy might quote it.
      return JSON.stringify({
        errorMessages: [
          `Bad credentials ${TOKEN} sent as ${header} (${header.split(' ')[1] ?? ''})`,
        ],
      })
    }
    const server = await jira({
      rules: [
        { path: /\/issue\/SHOP-7$/, status: 500, body: echo },
        { path: /\/issue\/SHOP-8$/, status: 403, body: echo },
      ],
    })
    const { messages, lines } = await engine()(({ profile, lines: logged }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme(server)
          const unreachable = yield* Effect.flip(readTicket(project.id, reference('SHOP-7')))
          const forbidden = yield* Effect.flip(readTicket(project.id, reference('SHOP-8')))
          const status = yield* checkAgain(provider.id)
          const events = yield* readEvents({})
          return {
            messages: [
              unreachable.message,
              forbidden.message,
              status.sentence,
              JSON.stringify(events),
            ],
            lines: logged,
          }
        }),
      ),
    )
    expect(messages[0]).toContain('Bad credentials ••• sent as Basic ••• (•••)')
    expect(messages[1]).toContain('Bad credentials ••• sent as Basic ••• (•••)')
    for (const said of [...messages, ...lines]) {
      expect(said).not.toContain(TOKEN)
      expect(said).not.toContain(BASIC)
    }
    const written = writtenBytes(data)
    expect(written).not.toContain(TOKEN)
    expect(written).not.toContain(BASIC)
  })
})

describe('A bare key no provider claims is read by each Jira provider in turn', () => {
  test('the first provider does not know it, the second answers: the mission links the second', async () => {
    const first = await jira()
    const second = await jira({ issues: [{ ...SHOP_7, key: 'DATA-3' }] })
    const [linked, read, secondId] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(first)
          const other = yield* addJira(project.id, {
            site: second.site,
            deployment: 'cloud',
            email: EMAIL,
            projectKeys: ['OTHER'],
          })
          expect(yield* saveJiraToken(other.id, seal(TOKEN), TOKEN)).toBe('saved')
          const made = yield* createStart({
            projectId: project.id,
            ticket: { reference: reference('DATA-3') },
            idempotencyKey: 'one',
          })
          const chat = yield* readTicket(project.id, reference('DATA-3'))
          return [yield* missionTicket(made.id), chat, other.id] as const
        }),
      ),
    )
    expect(linked?.providerId).toBe(secondId)
    expect(linked?.base?.title).toBe('Export notes as Markdown')
    expect(read.key).toBe('DATA-3')
  })
})

describe('A network error is masked', () => {
  test('a failure that quotes the request’s credential says ••• instead', async () => {
    const server = await jira({ issues: [SHOP_7] })
    const failing = (_url: string, init: RequestInit) =>
      Promise.reject(
        new Error(`socket hang up with ${new Headers(init.headers).get('authorization') ?? ''}`),
      )
    const failure = await engine({ fetch: failing })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(server)
          return yield* Effect.flip(readTicket(project.id, reference('SHOP-7')))
        }),
      ),
    )
    expect(failure).toBeInstanceOf(ProviderUnreachable)
    expect(failure.message).toContain('socket hang up')
    expect(failure.message).not.toContain(BASIC)
    expect(failure.message).not.toContain(TOKEN)
  })
})

describe('A long error body is masked whole before it is cut', () => {
  test('a 500 body of 280 characters then the token leaks no part of it, nor of the Basic credential', async () => {
    const server = await jira({
      rules: [
        { path: /\/issue\/SHOP-7$/, status: 500, body: `${'x'.repeat(280)}${TOKEN}` },
        { path: /\/issue\/SHOP-8$/, status: 500, body: `${'x'.repeat(280)}${BASIC}` },
      ],
    })
    const { messages, written } = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(server)
          const token = yield* Effect.flip(readTicket(project.id, reference('SHOP-7')))
          const basic = yield* Effect.flip(readTicket(project.id, reference('SHOP-8')))
          const events = yield* readEvents({})
          return {
            messages: [token.message, basic.message, JSON.stringify(events)],
            written: writtenBytes(data),
          }
        }),
      ),
    )
    expect(messages[0]).toContain('xxxx')
    for (const said of [...messages, written]) {
      expect(said).not.toContain(TOKEN.slice(0, 8))
      expect(said).not.toContain(BASIC.slice(0, 8))
    }
  })
})

describe('A ticket read: its text as Markdown, its status, labels, reporter and every comment', () => {
  test('Cloud: ADF as Markdown, sections read, comments paged until complete, dates as instants', async () => {
    const server = await jira({ issues: [SHOP_7] })
    const version = await engine()(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(server), ({ project }) => readTicket(project.id, reference('shop-7'))),
      ),
    )
    expect(version).toMatchObject({
      provider: 'jira',
      reference: `jira:${server.host}/SHOP-7`,
      key: 'SHOP-7',
      url: `${server.site}/browse/SHOP-7`,
      title: 'Export notes as Markdown',
      description: 'Reported by the support team.\n\n## Why\n\nExports are slow.',
      status: { state: 'open', wording: 'In review' },
      author: 'Ada',
      labels: ['export', 'notes'],
      updatedAt: '2026-10-01T10:00:00.000Z',
    })
    expect(version.sections.map((section) => section.section)).toEqual(['why'])
    expect(version.comments.map((one) => [one.id, one.author, one.body, one.editedAt])).toEqual([
      ['1', 'Grace', 'Keep the accents.', null],
      ['2', 'Grace', 'And the dates.', '2026-10-01T09:00:00.000Z'],
      ['3', null, 'Done?', null],
    ])
    const comments = server.requests().filter((one) => one.path.endsWith('/comment'))
    expect(comments.map((one) => new URLSearchParams(one.query).get('startAt'))).toEqual(['0', '2'])
  })

  test('Cloud: the fingerprint is taken on the document, its keys sorted and localId left out', async () => {
    const server = await jira({ issues: [SHOP_7] })
    const version = await engine()(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(server), ({ project }) => readTicket(project.id, reference('SHOP-7'))),
      ),
    )
    const { createHash } = await import('node:crypto')
    const { fingerprintInput } = await import('@hemera/core/domain')
    expect(version.fingerprint).toBe(
      createHash('sha256')
        .update(fingerprintInput(SHOP_7.summary, adfFingerprintText(SHOP_7.description)))
        .digest('hex'),
    )
  })

  test('an empty description is empty text, and a done status is closed', async () => {
    const server = await jira({ issues: [SHOP_8] })
    const version = await engine()(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(server), ({ project }) => readTicket(project.id, reference('SHOP-8'))),
      ),
    )
    expect(version.description).toBe('')
    expect(version.status).toEqual({ state: 'closed', wording: 'Done' })
    expect(version.comments).toEqual([])
  })

  test('Data Center: wiki markup as Markdown, on REST v2', async () => {
    const wiki: FakeIssue = {
      ...SHOP_7,
      description: 'h2. Why\nExports are slow.\n* in Markdown\n* in HTML',
      comments: [
        {
          id: '1',
          author: 'Grace',
          body: 'See [the notes|https://acme.test/notes].',
          created: SHOP_7.updated,
          updated: SHOP_7.updated,
        },
      ],
    }
    const server = await jira({ deployment: 'datacenter', issues: [wiki] })
    const version = await engine()(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(server, 'datacenter'), ({ project }) =>
          readTicket(project.id, reference('SHOP-7')),
        ),
      ),
    )
    expect(version.description).toBe('## Why\nExports are slow.\n- in Markdown\n- in HTML')
    expect(version.sections.map((section) => section.section)).toEqual(['why'])
    expect(version.comments[0]?.body).toBe('See [the notes](https://acme.test/notes).')
    expect(server.requests().some((one) => one.path === '/rest/api/2/issue/SHOP-7')).toBe(true)
  })
})

const searchOf = (projectId: string, text: string) =>
  Stream.runCollect(searchStart(projectId, text)).pipe(Effect.map((all) => [...all]))

const titlesOf = (results: ReadonlyArray<StartResult>) =>
  results.flatMap((result) => (Predicate.isTagged(result, 'TicketFound') ? [result.hit.title] : []))

const noticesOf = (results: ReadonlyArray<StartResult>) =>
  results.flatMap((result) => (Predicate.isTagged(result, 'SearchNotice') ? [result.sentence] : []))

describe('A search: JQL on the project keys, the text escaped, by update date, 20 at most', () => {
  test('Cloud searches /rest/api/3/search/jql', async () => {
    const server = await jira({ issues: [SHOP_7, SHOP_8] })
    const results = await engine()(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(server), ({ project }) => searchOf(project.id, 'export "notes')),
      ),
    )
    const asked = server.requests().find((one) => one.path === '/rest/api/3/search/jql')
    expect(asked?.method).toBe('POST')
    expect(JSON.parse(asked?.body ?? '{}')).toEqual({
      jql: 'project in ("SHOP", "OPS") AND text ~ "export \\"notes" ORDER BY updated DESC',
      maxResults: 20,
      fields: ['summary', 'status', 'updated'],
    })
    expect(titlesOf(results)).toEqual([])
  })

  test('hits come with their key, link and status', async () => {
    const server = await jira({ issues: [SHOP_7, SHOP_8] })
    const results = await engine()(({ profile }) =>
      profile.use(Effect.flatMap(acme(server), ({ project }) => searchOf(project.id, 'export'))),
    )
    expect(titlesOf(results)).toEqual(['Export fails on large notes', 'Export notes as Markdown'])
    const first = results.find((result) => Predicate.isTagged(result, 'TicketFound'))
    expect(Predicate.isTagged(first, 'TicketFound') ? first.hit : null).toMatchObject({
      key: 'SHOP-8',
      url: `${server.site}/browse/SHOP-8`,
      status: { state: 'closed', wording: 'Done' },
      updatedAt: '2026-10-02T10:00:00.000Z',
    })
  })

  test('Data Center searches /rest/api/2/search', async () => {
    const server = await jira({ deployment: 'datacenter', issues: [SHOP_7] })
    const results = await engine()(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(server, 'datacenter'), ({ project }) => searchOf(project.id, 'export')),
      ),
    )
    expect(titlesOf(results)).toEqual(['Export notes as Markdown'])
    expect(server.requests().some((one) => one.path === '/rest/api/2/search')).toBe(true)
  })
})

describe('changedSince: one JQL request per 50 keys, asking only the update date', () => {
  test('moved, missing and unchanged, whatever zone Jira writes the date in', async () => {
    const server = await jira({ issues: [SHOP_7, SHOP_8] })
    const known = [
      // The same instant as SHOP-7's update date, written in another zone: unchanged.
      { reference: reference('SHOP-7'), updatedAt: '2026-10-01T05:00:00.000-0500' },
      { reference: reference('SHOP-8'), updatedAt: '2026-10-01T00:00:00.000Z' },
      ...Array.from({ length: 118 }, (_, index) => ({
        reference: reference(`SHOP-${String(100 + index)}`),
        updatedAt: '2026-10-01T00:00:00.000Z',
      })),
    ]
    const changes = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { provider } = yield* acme(server)
          const live = yield* providerOf(provider)
          return yield* live.changedSince(known)
        }),
      ),
    )
    const searches = server.requests().filter((one) => one.path === '/rest/api/3/search/jql')
    const bodies = searches.map((one) => JSON.parse(one.body))
    expect(bodies.map((body) => (body.jql.match(/"SHOP-\d+"/g) ?? []).length)).toEqual([
      CHANGED_BATCH,
      CHANGED_BATCH,
      20,
    ])
    expect(bodies.every((body) => JSON.stringify(body.fields) === '["updated"]')).toBe(true)
    expect(bodies[0].jql).toMatch(/^key in \("SHOP-7", "SHOP-8", "SHOP-100"/)
    const moved = changes.filter((change) => Predicate.isTagged(change, 'Moved'))
    const missing = changes.filter((change) => Predicate.isTagged(change, 'Missing'))
    expect(moved.map((change) => [change.reference, change.updatedAt])).toEqual([
      [`jira:${server.host}/SHOP-8`, '2026-10-02T10:00:00.000Z'],
    ])
    expect(missing).toHaveLength(118)
  })
})

describe('A moved Jira issue is moved, not missing', () => {
  test('an issue Jira answers under its new key reads Moved under the key asked', async () => {
    const server = await jira({
      issues: [SHOP_8],
      rules: [
        {
          path: /\/search\/jql$/,
          body: JSON.stringify({
            issues: [
              { key: 'OPS-70', fields: { updated: '2026-10-03T12:00:00.000+0200' } },
              { key: 'SHOP-8', fields: { updated: '2026-10-02T12:00:00.000+0200' } },
            ],
          }),
        },
        {
          path: /\/issue\/SHOP-7$/,
          body: JSON.stringify({
            key: 'OPS-70',
            fields: { updated: '2026-10-03T12:00:00.000+0200' },
          }),
        },
      ],
    })
    const changes = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { provider } = yield* acme(server)
          const live = yield* providerOf(provider)
          return yield* live.changedSince([
            { reference: reference('SHOP-7'), updatedAt: '2026-10-01T10:00:00.000Z' },
            { reference: reference('SHOP-8'), updatedAt: '2026-10-02T10:00:00.000Z' },
          ])
        }),
      ),
    )
    expect(changes).toHaveLength(1)
    expect(Predicate.isTagged(changes[0], 'Moved')).toBe(true)
    expect(changes[0]).toMatchObject({
      reference: `jira:${server.host}/SHOP-7`,
      updatedAt: '2026-10-03T10:00:00.000Z',
    })
  })
})

describe('At the same time', () => {
  test('two reads at once: both answer, each with the token opened for its own call', async () => {
    const server = await jira({
      issues: [SHOP_7],
      // Both issue requests are held until the second arrives: the reads truly run at once.
      rules: [
        {
          path: /\/issue\/SHOP-7$/,
          gather: 2,
          times: 2,
          body: () =>
            JSON.stringify({
              key: 'SHOP-7',
              fields: {
                summary: SHOP_7.summary,
                description: SHOP_7.description,
                status: { name: 'In review', statusCategory: { key: 'indeterminate' } },
                labels: [],
                reporter: null,
                updated: SHOP_7.updated,
              },
            }),
        },
      ],
    })
    let opened = 0
    const versions = await engine({
      open: (ciphertext) => Effect.tap(open(ciphertext), () => Effect.sync(() => (opened += 1))),
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(server)
          const before = opened
          const both = yield* Effect.all(
            [
              readTicket(project.id, reference('SHOP-7')),
              readTicket(project.id, reference('SHOP-7')),
            ],
            { concurrency: 'unbounded' },
          )
          return { both, opened: opened - before }
        }),
      ),
    )
    expect(versions.both[0].fingerprint).toBe(versions.both[1].fingerprint)
    expect(versions.opened).toBe(2)
  })

  test('two reads failing at once write one provider_unreachable', async () => {
    const server = await jira({ rules: [{ path: /\/issue\//, status: 503, gather: 2, times: 2 }] })
    const unreachable = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(server)
          yield* Effect.all(
            [
              Effect.exit(readTicket(project.id, reference('SHOP-7'))),
              Effect.exit(readTicket(project.id, reference('SHOP-8'))),
            ],
            { concurrency: 'unbounded' },
          )
          const page = yield* readEvents({})
          return page.events.filter((event) => event.type === 'tickets.provider_unreachable')
        }),
      ),
    )
    expect(unreachable).toHaveLength(1)
  })

  test('a search interrupted ends Jira’s request', async () => {
    const server = await jira({ rules: [{ path: /\/search\/jql$/, hang: true }] })
    const closed = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(server)
          const fiber = yield* Effect.forkChild(searchOf(project.id, 'export'))
          yield* until(
            Effect.sync(() => server.requests()),
            (seen) => seen.some((one) => one.path === '/rest/api/3/search/jql'),
          )
          yield* Fiber.interrupt(fiber)
          const exit = yield* Fiber.await(fiber)
          expect(Exit.hasInterrupts(exit)).toBe(true)
          return yield* until(
            Effect.sync(() => server.closed()),
            (count) => count === 1,
          )
        }),
      ),
    )
    expect(closed).toBe(1)
  })

  test('Jira dying while GitHub answers: GitHub’s hits stay, Jira is one notice, and a creation from its key is refused, not dead', async () => {
    const server = await jira({ issues: [SHOP_7] })
    const gh = fakeGh([
      {
        when: ['search', 'issues', 'acme/shop'],
        stdout: included(
          JSON.stringify({
            items: [
              {
                number: 41,
                title: 'Export notes',
                html_url: 'https://github.com/acme/shop/issues/41',
                state: 'open',
                updated_at: '2026-10-01T10:00:00Z',
                repository_url: 'https://api.github.com/repos/acme/shop',
              },
            ],
          }),
        ),
      },
    ])
    const [results, refused] = await engine(
      { open: () => Effect.die(new Error('the opener broke')) },
      gh,
    )(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(server)
          yield* addGithub(project.id, { host: 'github.com', repositories: ['acme/shop'] })
          const found = yield* searchOf(project.id, 'export')
          const creation = yield* Effect.flip(
            createStart({
              projectId: project.id,
              ticket: { reference: reference('SHOP-7') },
              idempotencyKey: 'one',
            }),
          )
          return [found, creation] as const
        }),
      ),
    )
    expect(titlesOf(results)).toEqual(['Export notes'])
    expect(noticesOf(results)).toHaveLength(1)
    expect(refused).toBeInstanceOf(InvalidMissionIdea)
  })

  test('Jira failing while GitHub answers: GitHub’s hits stay, Jira’s failure is one notice', async () => {
    const server = await jira({
      rules: [
        { path: /\/search\/jql$/, status: 503, body: '{"errorMessages":["Service unavailable"]}' },
      ],
    })
    const gh = fakeGh([
      {
        when: ['search', 'issues', 'acme/shop'],
        stdout: included(
          JSON.stringify({
            items: [
              {
                number: 41,
                title: 'Export notes',
                html_url: 'https://github.com/acme/shop/issues/41',
                state: 'open',
                updated_at: '2026-10-01T10:00:00Z',
                repository_url: 'https://api.github.com/repos/acme/shop',
              },
            ],
          }),
        ),
      },
    ])
    const results = await engine(
      {},
      gh,
    )(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme(server)
          yield* addGithub(project.id, { host: 'github.com', repositories: ['acme/shop'] })
          return yield* searchOf(project.id, 'export')
        }),
      ),
    )
    expect(titlesOf(results)).toEqual(['Export notes'])
    expect(noticesOf(results)).toHaveLength(1)
    expect(noticesOf(results)[0]).toContain('Service unavailable')
  })
})
