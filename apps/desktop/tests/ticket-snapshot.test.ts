/**
 * The snapshot of a ticket a mission comes from (#95), and "offline, signalled once": creating a
 * mission from a reference reads the ticket and stores its version as both the base and the last
 * known one; a ticket unreadable at creation gives a mission with its reference and no version,
 * read later by "Check again"; the first failure after a success writes one
 * `tickets.provider_unreachable`, later ones nothing, and the next success one
 * `tickets.provider_back`; a rate limit is an outage until its reset; the last known version stays
 * readable throughout; and a provider a live mission's ticket comes from cannot be removed.
 *
 * `gh` is the fake of `fake-gh.ts`; no test reaches GitHub.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { ProviderLimited, ProviderUnreachable, parseTicketReference } from '@hemera/core/domain'
import {
  InvalidMissionIdea,
  ProviderInUse,
  type StartResult,
  TicketAlreadyLinked,
} from '@hemera/ipc'
import { Effect, Exit, Predicate, Stream } from 'effect'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { readEvents } from '../src/engine/journal.ts'
import { createProject } from '../src/engine/projects.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import { createStart, searchStart } from '../src/engine/start/field.ts'
import { Database } from '../src/engine/storage/database.ts'
import { missions, ticketVersions } from '../src/engine/storage/schema.ts'
import { checkAgain, missionTicket, readTicket } from '../src/engine/tickets/link.ts'
import { addGithub, removeProvider, setSpecMode } from '../src/engine/tickets/store.ts'
import { commandsEngine } from './commands-engine.ts'
import { type FakeGh, type GhRule, fakeGh, included } from './fake-gh.ts'
import { repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('ticket-snapshot'))
  work = realpathSync.native(temporaryFolder('ticket-snapshot-work'))
})
afterEach(removeFolders)

const SECRET = 'acme-deploy-value-7731'

const acme = Effect.gen(function* () {
  const main = join(work, 'acme')
  mkdirSync(main, { recursive: true })
  repository(join(main, 'api'))
  const project = yield* createProject({ name: 'Acme', mainCheckout: main, repositories: ['api'] })
  const provider = yield* addGithub(project.id, { host: 'github.com', repositories: ['acme/shop'] })
  return { project, provider }
})

const ISSUE = included(
  JSON.stringify({
    data: {
      repository: {
        issueOrPullRequest: {
          __typename: 'Issue',
          number: 41,
          title: 'Export notes as Markdown',
          body: `## Why\nExports are slow.\n\nThe staging key is ${SECRET}.\n`,
          state: 'OPEN',
          stateReason: null,
          url: 'https://github.com/acme/shop/issues/41',
          updatedAt: '2026-10-01T10:00:00Z',
          author: { login: 'ada' },
          labels: { nodes: [{ name: 'export' }] },
          comments: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'IC_1',
                author: { login: 'grace' },
                body: 'Keep the accents.',
                createdAt: '2026-10-01T09:00:00Z',
                lastEditedAt: null,
              },
            ],
          },
        },
      },
    },
  }),
)

const READS: GhRule = { when: ['graphql'], stdout: ISSUE }
const OFFLINE: GhRule = {
  when: ['graphql'],
  stderr: 'error connecting to api.github.com\n',
  code: 1,
}

const reference = (text: string) => {
  const parsed = parseTicketReference(text)
  if (parsed === null) throw new Error(`${text} is not a reference`)
  return parsed
}

const fromTicket = (projectId: string, text: string, key: string) =>
  createStart({ projectId, ticket: { reference: reference(text) }, idempotencyKey: key })

const ticketEvents = Effect.map(readEvents({}), (page) =>
  page.events.flatMap((event) =>
    event.type.startsWith('tickets.provider_') && event.type !== 'tickets.provider_added'
      ? [event.type]
      : [],
  ),
)

const engine = (gh: FakeGh) => {
  const secrets = secretsRegistry()
  secrets.register('project-variables:acme', [SECRET])
  return commandsEngine(data, { gh: gh.settings, secrets })
}

describe('A mission created from a ticket keeps its snapshot', () => {
  test('the version read is stored as both the base and the last known version, masked', async () => {
    const gh = fakeGh([READS])
    const [mission, linked] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme
          const made = yield* fromTicket(project.id, 'acme/shop#41', 'one')
          return [made, yield* missionTicket(made.id)] as const
        }),
      ),
    )
    expect(mission.title).toBe('Export notes as Markdown')
    expect(mission.ticketLink?.reference).toBe('github:github.com/acme/shop#41')
    expect(linked?.mode).toBe('local')
    expect(linked?.base).not.toBeNull()
    expect(linked?.base).toEqual(linked?.last)
    expect(linked?.base).toMatchObject({
      key: 'acme/shop#41',
      title: 'Export notes as Markdown',
      status: { state: 'open', wording: 'open' },
      labels: ['export'],
      updatedAt: '2026-10-01T10:00:00Z',
    })
    expect(linked?.base?.description).not.toContain(SECRET)
    expect(linked?.base?.description).toContain('•••')
    expect(linked?.base?.sections.map((one) => one.section)).toEqual(['why'])
    expect(linked?.base?.comments.map((one) => [one.id, one.body])).toEqual([
      ['IC_1', 'Keep the accents.'],
    ])
    expect(linked?.base?.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  test('the Spec mode at link time is kept: linked when the Project is linked', async () => {
    const gh = fakeGh([READS])
    const linked = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setSpecMode(project.id, 'linked')
          const made = yield* fromTicket(project.id, 'acme/shop#41', 'one')
          return yield* missionTicket(made.id)
        }),
      ),
    )
    expect(linked?.mode).toBe('linked')
  })

  test('a second mission on the same ticket is refused while the first is live', async () => {
    const gh = fakeGh([READS])
    const refused = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* fromTicket(project.id, 'acme/shop#41', 'one')
          return yield* Effect.flip(
            fromTicket(project.id, 'https://github.com/acme/shop/issues/41', 'two'),
          )
        }),
      ),
    )
    expect(refused).toBeInstanceOf(TicketAlreadyLinked)
  })
})

describe('Offline, an unreadable remote is signalled once, and nothing is lost', () => {
  test('a ticket unreadable at creation gives a mission with no version; Check again reads it', async () => {
    const gh = fakeGh([OFFLINE])
    const [before, events, after, eventsAfter, unreachable] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme
          const made = yield* fromTicket(project.id, 'acme/shop#41', 'one')
          const first = yield* missionTicket(made.id)
          const said = yield* ticketEvents
          gh.answer([
            { when: ['--version'], stdout: 'gh version 2.81.0 (2026-09-30)\n' },
            { when: ['auth', 'status'], stdout: '✓ Logged in\n' },
            READS,
          ])
          yield* checkAgain(provider.id)
          return [first, said, yield* missionTicket(made.id), yield* ticketEvents, made] as const
        }),
      ),
    )
    expect(unreachable.ticketLink?.key).toBe('acme/shop#41')
    expect(unreachable.title).toBe('acme/shop#41')
    expect(before?.base).toBeNull()
    expect(before?.last).toBeNull()
    expect(events).toEqual(['tickets.provider_unreachable'])
    expect(after?.base?.title).toBe('Export notes as Markdown')
    expect(after?.base).toEqual(after?.last)
    expect(eventsAfter).toEqual(['tickets.provider_unreachable', 'tickets.provider_back'])
  })

  test('three failed reads in a row write one event; a success writes provider_back; the last known version stays', async () => {
    const gh = fakeGh([READS])
    const [failures, events, kept] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme
          const made = yield* fromTicket(project.id, 'acme/shop#41', 'one')
          gh.answer([OFFLINE])
          const failed = []
          for (let attempt = 0; attempt < 3; attempt += 1) {
            failed.push(yield* Effect.flip(readTicket(project.id, reference('acme/shop#41'))))
          }
          const offline = yield* missionTicket(made.id)
          gh.answer([READS])
          yield* readTicket(project.id, reference('acme/shop#41'))
          return [failed, yield* ticketEvents, offline] as const
        }),
      ),
    )
    for (const failure of failures) expect(failure).toBeInstanceOf(ProviderUnreachable)
    expect(events).toEqual(['tickets.provider_unreachable', 'tickets.provider_back'])
    expect(kept?.last?.title).toBe('Export notes as Markdown')
    expect(kept?.last?.readAt).toEqual(expect.any(String))
  })

  test('two reads failing at once write one event', async () => {
    const gh = fakeGh([OFFLINE])
    const events = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* Effect.all(
            [
              Effect.flip(readTicket(project.id, reference('acme/shop#41'))),
              Effect.flip(readTicket(project.id, reference('acme/shop#42'))),
            ],
            { concurrency: 2 },
          )
          return yield* ticketEvents
        }),
      ),
    )
    expect(events).toEqual(['tickets.provider_unreachable'])
  })

  test('a rate limit is an outage until its reset: no call is made before it, nothing new is said', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600
    const gh = fakeGh([
      {
        when: ['graphql'],
        stdout: included(
          JSON.stringify({
            errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded.' }],
          }),
          'HTTP/2.0 200 OK',
          { 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': String(reset) },
        ),
        code: 1,
      },
    ])
    const [first, second, events] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme
          const one = yield* Effect.flip(readTicket(project.id, reference('acme/shop#41')))
          const two = yield* Effect.flip(readTicket(project.id, reference('acme/shop#41')))
          return [one, two, yield* ticketEvents] as const
        }),
      ),
    )
    expect(first).toBeInstanceOf(ProviderLimited)
    expect(second).toBeInstanceOf(ProviderLimited)
    expect(gh.calls()).toHaveLength(1)
    expect(events).toEqual(['tickets.provider_unreachable'])
  })
})

const PULL_REQUEST: GhRule = {
  when: ['graphql'],
  stdout: included(
    JSON.stringify({
      data: { repository: { issueOrPullRequest: { __typename: 'PullRequest' } } },
    }),
  ),
}
const MISSING: GhRule = {
  when: ['graphql'],
  stdout: included(JSON.stringify({ data: { repository: { issueOrPullRequest: null } } })),
}
const FORBIDDEN: GhRule = {
  when: ['graphql'],
  stdout: included(
    JSON.stringify({
      data: { repository: null },
      errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }],
    }),
  ),
}

const missionCount = Effect.flatMap(Database, (database) =>
  Effect.map(database.select({ id: missions.id }).from(missions), (rows) => rows.length),
)

const choicesOf = (results: ReadonlyArray<StartResult>) =>
  results.flatMap((result) =>
    Predicate.isTagged(result, 'CreateChoice') ? [result.ticket === null ? null : 'ticket'] : [],
  )

describe('A ticket that is not one, or cannot be read, is never linked', () => {
  const refusedFor = async (rule: GhRule) => {
    const gh = fakeGh([rule])
    return engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme
          const refused = yield* Effect.flip(fromTicket(project.id, 'acme/shop#41', 'one'))
          const results = yield* Stream.runCollect(searchStart(project.id, 'acme/shop#41'))
          return [refused, yield* missionCount, [...results]] as const
        }),
      ),
    )
  }

  test('a pull request number refuses the creation in its sentence; the field stops offering it', async () => {
    const [refused, count, results] = await refusedFor(PULL_REQUEST)
    expect(refused).toBeInstanceOf(InvalidMissionIdea)
    expect(refused.message).toBe(
      'This mission cannot start: acme/shop#41 is a pull request, not an issue.',
    )
    expect(count).toBe(0)
    expect(choicesOf(results)).toEqual(['ticket', null])
  })

  test('a missing issue refuses the creation; the field stops offering it', async () => {
    const [refused, count, results] = await refusedFor(MISSING)
    expect(refused).toBeInstanceOf(InvalidMissionIdea)
    expect(refused.message).toBe(
      'This mission cannot start: acme/shop#41 was not found: acme/shop#41 does not exist on github.com.',
    )
    expect(count).toBe(0)
    expect(choicesOf(results)).toEqual(['ticket', null])
  })

  test('a forbidden issue refuses the creation; the field stops offering it', async () => {
    const [refused, count, results] = await refusedFor(FORBIDDEN)
    expect(refused).toBeInstanceOf(InvalidMissionIdea)
    expect(refused.message).toBe(
      'This mission cannot start: acme/shop#41 cannot be read: Resource not accessible by integration.',
    )
    expect(count).toBe(0)
    expect(choicesOf(results)).toEqual(['ticket', null])
  })

  test('an outage still creates the mission with its reference; the field keeps offering it', async () => {
    const gh = fakeGh([OFFLINE])
    const [made, results] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme
          const found = yield* Stream.runCollect(searchStart(project.id, 'acme/shop#41'))
          return [yield* fromTicket(project.id, 'acme/shop#41', 'one'), [...found]] as const
        }),
      ),
    )
    expect(made.ticketLink?.key).toBe('acme/shop#41')
    expect(choicesOf(results)).toEqual(['ticket'])
  })
})

describe('A mission’s ticket versions go with it', () => {
  test('removing a mission removes the versions read for it', async () => {
    const gh = fakeGh([READS])
    const [before, after] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme
          const made = yield* fromTicket(project.id, 'acme/shop#41', 'one')
          yield* readTicket(project.id, reference('acme/shop#41'))
          const database = yield* Database
          const versions = database.select({ id: ticketVersions.id }).from(ticketVersions)
          const counted = (yield* versions).length
          yield* database.delete(missions).where(eq(missions.id, made.id))
          return [counted, (yield* versions).length] as const
        }),
      ),
    )
    expect(before).toBe(1)
    expect(after).toBe(0)
  })
})

describe('Check again keeps a rate limit until its reset', () => {
  test('gh logged in during a rate limit: the marker stays, no call is made, nothing is said back', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600
    const gh = fakeGh([
      {
        when: ['graphql'],
        stdout: included(
          JSON.stringify({
            errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded.' }],
          }),
          'HTTP/2.0 200 OK',
          { 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': String(reset) },
        ),
        code: 1,
      },
    ])
    const [status, after, events, graphqlCalls] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme
          yield* Effect.flip(readTicket(project.id, reference('acme/shop#41')))
          gh.answer([
            { when: ['--version'], stdout: 'gh version 2.81.0 (2026-09-30)\n' },
            { when: ['auth', 'status'], stdout: '✓ Logged in\n' },
            READS,
          ])
          const checked = yield* checkAgain(provider.id)
          const refused = yield* Effect.flip(readTicket(project.id, reference('acme/shop#41')))
          return [
            checked,
            refused,
            yield* ticketEvents,
            gh.calls().filter((call) => call.args.includes('graphql')).length,
          ] as const
        }),
      ),
    )
    expect(status.state).toBe('unreachable')
    expect(status.sentence).toContain(`rate limited until ${new Date(reset * 1000).toISOString()}`)
    expect(after).toBeInstanceOf(ProviderLimited)
    expect(events).toEqual(['tickets.provider_unreachable'])
    expect(graphqlCalls).toBe(1)
  })
})

describe('A provider a live mission comes from stays', () => {
  test('removing it is refused, the missions named; one no mission uses is removed', async () => {
    const gh = fakeGh([READS])
    const [refused, removed] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme
          const spare = yield* addGithub(project.id, { host: 'git.acme.test', repositories: [] })
          yield* fromTicket(project.id, 'acme/shop#41', 'one')
          return [
            yield* Effect.flip(removeProvider(provider.id)),
            yield* Effect.exit(removeProvider(spare.id)),
          ] as const
        }),
      ),
    )
    expect(refused).toBeInstanceOf(ProviderInUse)
    expect(refused.message).toBe(
      'This provider reads the ticket of ACME-1: it cannot be removed while that mission is live.',
    )
    expect(Exit.isSuccess(removed)).toBe(true)
  })
})
