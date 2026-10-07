/**
 * Starting a mission from the Project's field: the search that comes first (the Project's own
 * missions, the tickets already linked, the remote tickets) and never creates anything, then the
 * explicit creation, once per idempotency key, of a mission in Planning with no Workspace and no
 * branch, told to whoever follows `mission.started` once it has committed.
 *
 * Each test runs the engine as it starts, over a data folder of its own. The ticket providers are
 * a fake `TicketSearch` handed as a part of the Profile, never patched.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import {
  JiraKey,
  type TicketReference,
  canonicalTicket,
  parseTicketReference,
  searchTextOf,
  ticketKeyOf,
} from '@hemera/core/domain'
import {
  CreateChoice,
  InvalidMissionIdea,
  SearchNotice,
  type StartCreate,
  type StartResult,
  type TicketHit,
  TicketAlreadyLinked,
} from '@hemera/ipc'
import { Deferred, Effect, Fiber, Layer, Match, Option, Predicate, Result, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { DomainEvents } from '../src/engine/domain-events.ts'
import { readEvents } from '../src/engine/journal.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { createMission, getMission, listMissions, moveMission } from '../src/engine/missions.ts'
import { createProject } from '../src/engine/projects.ts'
import { createStart, searchStart } from '../src/engine/start/field.ts'
import { MissionStarts } from '../src/engine/start/started.ts'
import { TicketSearch, TicketSearchError } from '../src/engine/start/tickets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { missions } from '../src/engine/storage/schema.ts'
import { listWorkspaces } from '../src/engine/workspaces.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { git, repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('start'))
  work = realpathSync.native(temporaryFolder('start-work'))
})
afterEach(removeFolders)

const engine = (tickets?: Layer.Layer<TicketSearch>) =>
  commandsEngine(data, tickets === undefined ? {} : { tickets })

/** A Project whose main checkout holds one Git repository, `api`. */
const project = (name = 'Acme') =>
  Effect.gen(function* () {
    const main = join(work, name.toLowerCase())
    mkdirSync(main, { recursive: true })
    repository(join(main, 'api'))
    const made = yield* createProject({ name, mainCheckout: main, repositories: ['api'] })
    return { ...made, api: join(main, 'api') }
  })

let keys = 0
/** A create as the field sends it, under a key of its own unless one is given. */
const asked = (
  projectId: string,
  rest: Omit<StartCreate, 'projectId' | 'idempotencyKey'> & { idempotencyKey?: string },
): StartCreate => {
  keys += 1
  return { projectId, idempotencyKey: `key-${String(keys)}`, ...rest }
}

const reference = (text: string): TicketReference => {
  const parsed = parseTicketReference(text)
  if (parsed === null) throw new Error(`${text} is not a reference`)
  return parsed
}

const search = (projectId: string, text: string) =>
  Stream.runCollect(searchStart(projectId, text)).pipe(Effect.map((all) => [...all]))

const found = (results: ReadonlyArray<StartResult>) =>
  results.flatMap((result) => (Predicate.isTagged(result, 'MissionFound') ? [result] : []))

const keysOf = (results: ReadonlyArray<StartResult>) =>
  found(results).map((result) => result.mission.key)

const tagOf = Match.type<StartResult>().pipe(
  Match.tagsExhaustive({
    MissionFound: () => 'MissionFound',
    TicketFound: () => 'TicketFound',
    SearchNotice: () => 'SearchNotice',
    CreateChoice: () => 'CreateChoice',
  }),
)

const tagsOf = (results: ReadonlyArray<StartResult>) => results.map(tagOf)

const choiceOf = (results: ReadonlyArray<StartResult>) =>
  results.flatMap((result) => (Predicate.isTagged(result, 'CreateChoice') ? [result] : []))[0]

const sentence = (text: string) => ({ sentence: text, ticket: null })

/** A provider that answers these hits for any query. */
const providing = (
  answer: (query: {
    readonly text: string
    readonly reference: TicketReference | null
  }) => Stream.Stream<TicketHit, TicketSearchError>,
) =>
  Layer.succeed(TicketSearch, {
    providers: () => Effect.succeed(['github']),
    githubHosts: () => Effect.succeed([]),
    search: (_, query) => answer(query),
  })

const hitOf = (text: string, title: string): TicketHit => {
  const ref = reference(text)
  return {
    provider: 'github',
    reference: ref,
    canonical: canonicalTicket(ref),
    key: ticketKeyOf(ref),
    title,
    url: `https://github.com/${ticketKeyOf(ref).replace('#', '/issues/')}`,
    updatedAt: '2026-10-01T10:00:00.000Z',
    linkedMission: null,
  }
}

describe('The field searches the missions of this Project first', () => {
  test('a mission key opens that mission in any case; a key of another Project does not', async () => {
    const [byKey, upper, elsewhere] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const other = yield* project('Hemera')
          yield* createMission({ projectId: acme.id, idea: sentence('Export notes as Markdown') })
          yield* createMission({ projectId: acme.id, idea: sentence('Fix the login form') })
          const theirs = yield* createMission({
            projectId: other.id,
            idea: sentence('Fix the login form'),
          })
          return [
            yield* search(acme.id, 'acme-2'),
            yield* search(acme.id, '  ACME-2 '),
            yield* search(acme.id, theirs.key.toLowerCase()),
          ] as const
        }),
      ),
    )
    for (const results of [byKey, upper]) {
      const [first] = found(results)
      expect(first?.mission.key).toBe('ACME-2')
      expect(first?.open).toBe(true)
    }
    expect(found(elsewhere).some((result) => result.open)).toBe(false)
    expect(keysOf(elsewhere)).toEqual([])
  })

  test('accent- and case-insensitive word search finds a mission by its title and by its idea', async () => {
    const [byTitle, byIdea, none] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          yield* createMission({
            projectId: acme.id,
            idea: sentence('Export notes as Markdown\n\nKeep the accents of the café menu'),
          })
          yield* createMission({ projectId: acme.id, idea: sentence('Fix the login form') })
          return [
            yield* search(acme.id, 'markdown EXPORT'),
            yield* search(acme.id, 'CAFE menu'),
            yield* search(acme.id, 'markdown login'),
          ] as const
        }),
      ),
    )
    expect(keysOf(byTitle)).toEqual(['ACME-1'])
    expect(keysOf(byIdea)).toEqual(['ACME-1'])
    expect(keysOf(none)).toEqual([])
    expect(found(byTitle)[0]?.open).toBe(false)
  })

  test('the exact key first, then the live missions by last update, then the ended ones', async () => {
    const [words, key] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const first = yield* createMission({ projectId: acme.id, idea: sentence('Export one') })
          yield* createMission({ projectId: acme.id, idea: sentence('Export two') })
          yield* createMission({ projectId: acme.id, idea: sentence('Export three') })
          // The first is cancelled after the others were created: ended, it still comes last.
          yield* moveMission(first.id, 'cancel', 'user')
          return [yield* search(acme.id, 'export'), yield* search(acme.id, 'acme-2')] as const
        }),
      ),
    )
    expect(keysOf(words)).toEqual(['ACME-3', 'ACME-2', 'ACME-1'])
    expect(found(words).at(-1)?.mission.stage).toBe('cancelled')
    expect(keysOf(key)[0]).toBe('ACME-2')
  })

  test('a long pasted text is searched by its distinct words, never refused', async () => {
    const [repeated, distinct] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          yield* createMission({ projectId: acme.id, idea: sentence('Export notes as Markdown') })
          return [
            yield* search(acme.id, 'Export notes as Markdown '.repeat(300)),
            yield* search(
              acme.id,
              Array.from({ length: 1200 }, (_, index) => `word${String(index)}`).join(' '),
            ),
          ] as const
        }),
      ),
    )
    expect(keysOf(repeated)).toEqual(['ACME-1'])
    expect(tagsOf(distinct)).toEqual(['CreateChoice'])
  })

  test('a mission found says its stage, its ball and the date and words of its last Journal line', async () => {
    const results = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          yield* createMission({ projectId: acme.id, idea: sentence('Export notes as Markdown') })
          return yield* until(search(acme.id, 'export'), (seen) =>
            found(seen).some((result) => result.last !== null),
          )
        }),
      ),
    )
    const [mission] = found(results)
    expect(mission?.mission).toMatchObject({ key: 'ACME-1', stage: 'planning' })
    expect(Predicate.isTagged(mission?.mission.ball, 'Idle')).toBe(true)
    expect(mission?.last?.text).toBe('Mission started: Export notes as Markdown')
    expect(mission?.last?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('search never creates a mission', async () => {
    const [listed, events] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          for (const text of ['', 'Export notes', 'acme/shop#41', 'SHOP-7', 'ACME-1']) {
            yield* search(acme.id, text)
          }
          const page = yield* readEvents({})
          return [yield* listMissions(acme.id), page.events.map((event) => event.type)] as const
        }),
      ),
    )
    expect(listed).toEqual([])
    expect(events.filter((type) => type.startsWith('mission.'))).toEqual([])
  })

  test('a Project with 1,000 missions answers its local part in under 50 ms (the median)', async () => {
    const millis = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const database = yield* Database
          const at = new Date().toISOString()
          const rows = Array.from({ length: 1000 }, (_, index) => {
            const number = index + 1
            const title = `Export report ${String(number)} as CSV`
            return {
              id: `mission-${String(number).padStart(4, '0')}`,
              projectId: acme.id,
              keyPrefix: 'ACME',
              keyNumber: number,
              title,
              ideaSentence: title,
              ideaTicket: null,
              type: 'feature',
              stage: number % 3 === 0 ? 'done' : 'planning',
              round: 0,
              searchText: searchTextOf([`ACME-${String(number)}`, title]),
              createdAt: at,
              updatedAt: at,
            }
          })
          yield* database.transaction((transaction) =>
            Effect.forEach(
              Array.from({ length: 10 }, (_, chunk) => rows.slice(chunk * 100, chunk * 100 + 100)),
              (chunk) => transaction.insert(missions).values(chunk),
              { discard: true },
            ),
          )
          // The engine is long-lived: the first query of a connection prepares its plan.
          yield* search(acme.id, 'warm')
          const times: number[] = []
          for (const text of ['export csv', 'ACME-500', 'report 99', 'nothing like it']) {
            const started = performance.now()
            yield* search(acme.id, text)
            times.push(performance.now() - started)
          }
          return times
        }),
      ),
    )
    // The median: one search slowed by the machine's load is not the search being slow.
    const sorted = [...millis].sort((left, right) => left - right)
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(50)
  })
})

describe('Tickets: the ones already linked open their mission, the remote ones follow', () => {
  test('a reference linked to a mission of this Project opens it; create with it is refused and creates nothing', async () => {
    const [results, refused, listed, elsewhere] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const other = yield* project('Hemera')
          const ticket = { reference: reference('acme/shop#41') }
          yield* createStart(asked(acme.id, { ticket }))
          const refusal = yield* Effect.flip(
            createStart(
              asked(acme.id, {
                text: 'Do it again',
                ticket: { reference: reference('https://GitHub.com/Acme/Shop/issues/41/') },
              }),
            ),
          )
          const theirs = yield* createStart(asked(other.id, { ticket }))
          return [
            yield* search(acme.id, '<https://github.com/acme/shop/issues/41>'),
            refusal,
            yield* listMissions(acme.id),
            theirs,
          ] as const
        }),
      ),
    )
    const [first] = found(results)
    expect(first?.mission.key).toBe('ACME-1')
    expect(first?.open).toBe(true)
    expect(tagsOf(results)).not.toContain('CreateChoice')
    expect(refused).toBeInstanceOf(TicketAlreadyLinked)
    expect(refused.message).toBe('acme/shop#41 is already ACME-1.')
    expect(listed.map((mission) => mission.key)).toEqual(['ACME-1'])
    // One ticket gives one mission per Project: another Project may start from it too.
    expect(elsewhere.key).toBe('HEME-1')
  })

  test('a bare Jira key finds the mission of that key read from a browse URL', async () => {
    const results = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          yield* createStart(
            asked(acme.id, {
              ticket: { reference: reference('https://jira.acme.test/browse/SHOP-7') },
            }),
          )
          return yield* search(acme.id, 'shop-7')
        }),
      ),
    )
    expect(found(results)[0]).toMatchObject({ open: true, mission: { key: 'ACME-1' } })
  })

  test('with no provider, a reference says so in words and creation from the text stays possible', async () => {
    const [byReference, byWords, created] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          return [
            yield* search(acme.id, 'SHOP-7'),
            yield* search(acme.id, 'Export notes'),
            // What the field sends for that choice: the text, and no ticket.
            yield* createStart(asked(acme.id, { text: 'SHOP-7' })),
          ] as const
        }),
      ),
    )
    expect(byReference).toContainEqual(
      SearchNotice.make({ sentence: 'No ticket provider is set for this Project.' }),
    )
    // No provider reads it: the choice creates from the text, and links no ticket.
    expect(choiceOf(byReference)).toEqual(CreateChoice.make({ title: 'SHOP-7', ticket: null }))
    expect(tagsOf(byWords)).toEqual(['CreateChoice'])
    expect(created).toMatchObject({
      key: 'ACME-1',
      title: 'SHOP-7',
      idea: { sentence: 'SHOP-7', ticket: null },
      ticketLink: null,
    })
  })

  test('a text shaped like a key is a ticket only for a provider that reads it, never with the Project’s prefix', async () => {
    const queries: Array<TicketReference | null> = []
    const tickets = Layer.succeed(TicketSearch, {
      providers: () => Effect.succeed(['jira']),
      githubHosts: () => Effect.succeed([]),
      search: (_, query) =>
        Stream.fromEffect(Effect.sync(() => queries.push(query.reference))).pipe(Stream.drain),
    })
    const [encoding, own, theirs, refused, listed] = await engine(tickets)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const other = yield* project('Hemera')
          yield* createMission({ projectId: other.id, idea: sentence('Theirs') })
          return [
            yield* search(acme.id, 'UTF-8'),
            yield* search(acme.id, 'acme-99'),
            yield* search(acme.id, 'HEME-1'),
            yield* Effect.flip(
              createStart(asked(acme.id, { ticket: { reference: reference('ACME-99') } })),
            ),
            yield* listMissions(acme.id),
          ] as const
        }),
      ),
    )
    // A Jira provider may read UTF-8 or another Project's key: they stay tickets for it.
    expect(choiceOf(encoding)?.ticket).toEqual(JiraKey.make({ host: null, key: 'UTF-8' }))
    expect(choiceOf(theirs)?.ticket).toEqual(JiraKey.make({ host: null, key: 'HEME-1' }))
    // A key with this Project's own prefix is one of its missions, even one that does not exist.
    expect(choiceOf(own)).toEqual(CreateChoice.make({ title: 'acme-99', ticket: null }))
    expect(queries).toEqual([
      JiraKey.make({ host: null, key: 'UTF-8' }),
      null,
      JiraKey.make({ host: null, key: 'HEME-1' }),
    ])
    expect(refused).toBeInstanceOf(InvalidMissionIdea)
    expect(refused.message).toBe(
      'This mission cannot start: ACME-99 is a mission key of this Project, not a ticket.',
    )
    expect(listed).toEqual([])
  })

  test('a provider of another kind does not make a reference a ticket', async () => {
    const results = await engine(providing(() => Stream.empty))(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          return yield* search(acme.id, 'UTF-8')
        }),
      ),
    )
    expect(choiceOf(results)).toEqual(CreateChoice.make({ title: 'UTF-8', ticket: null }))
  })

  test('remote tickets follow the local results, and one already linked names its mission', async () => {
    const tickets = providing(() =>
      Stream.make(hitOf('acme/shop#41', 'Export notes'), hitOf('acme/shop#42', 'Export notes too')),
    )
    const results = await engine(tickets)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          yield* createStart(
            asked(acme.id, {
              text: 'Export notes',
              ticket: { reference: reference('acme/shop#41') },
            }),
          )
          return yield* search(acme.id, 'export notes')
        }),
      ),
    )
    expect(tagsOf(results)).toEqual(['MissionFound', 'CreateChoice', 'TicketFound', 'TicketFound'])
    const hits = results.flatMap((result) =>
      Predicate.isTagged(result, 'TicketFound') ? [result.hit] : [],
    )
    expect(hits.map((hit) => [hit.key, hit.linkedMission])).toEqual([
      ['acme/shop#41', 'ACME-1'],
      ['acme/shop#42', null],
    ])
  })

  test('a short form is the GitHub Enterprise ticket of the provider that lists its repository', async () => {
    const tickets = Layer.succeed(TicketSearch, {
      providers: () => Effect.succeed(['github']),
      githubHosts: (_, owner, repo) =>
        Effect.succeed(owner === 'acme' && repo === 'shop' ? ['git.acme.test'] : []),
      search: () => Stream.empty,
    })
    const [enterprise, elsewhere, byShort, byUrl, refused] = await engine(tickets)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const made = yield* createStart(
            asked(acme.id, { ticket: { reference: reference('acme/shop#41') } }),
          )
          const other = yield* createStart(
            asked(acme.id, { ticket: { reference: reference('acme/docs#41') } }),
          )
          return [
            made,
            other,
            yield* search(acme.id, 'acme/shop#41'),
            yield* search(acme.id, 'https://git.acme.test/acme/shop/issues/41'),
            yield* Effect.flip(
              createStart(asked(acme.id, { ticket: { reference: reference('Acme/Shop#41') } })),
            ),
          ] as const
        }),
      ),
    )
    expect(enterprise.ticketLink).toMatchObject({
      reference: 'github:git.acme.test/acme/shop#41',
      key: 'acme/shop#41',
      url: 'https://git.acme.test/acme/shop/issues/41',
    })
    // A repository no provider lists is github.com's.
    expect(elsewhere.ticketLink?.reference).toBe('github:github.com/acme/docs#41')
    for (const results of [byShort, byUrl]) {
      expect(found(results)[0]).toMatchObject({ open: true, mission: { key: 'ACME-1' } })
    }
    expect(refused).toBeInstanceOf(TicketAlreadyLinked)
  })

  test('a ticket search that fails says so once and the local results stay', async () => {
    const tickets = providing(() =>
      Stream.concat(
        Stream.make(hitOf('acme/shop#42', 'Export notes too')),
        Stream.fail(new TicketSearchError({ provider: 'GitHub', reason: 'you are offline' })),
      ),
    )
    const results = await engine(tickets)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          yield* createMission({ projectId: acme.id, idea: sentence('Export notes') })
          return yield* search(acme.id, 'export')
        }),
      ),
    )
    expect(tagsOf(results)).toEqual(['MissionFound', 'CreateChoice', 'TicketFound', 'SearchNotice'])
    expect(results.at(-1)).toEqual(
      SearchNotice.make({ sentence: 'GitHub could not be searched: you are offline.' }),
    )
  })

  test('an interrupted search stops in the engine: the provider sees the interruption', async () => {
    const asking = Effect.runSync(Deferred.make<void>())
    const stopped = Effect.runSync(Deferred.make<void>())
    const tickets = providing(() =>
      Stream.fromEffect(
        Deferred.succeed(asking, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
        ),
      ),
    )
    const local = await engine(tickets)(({ profile }) =>
      Effect.gen(function* () {
        const acme = yield* profile.use(project())
        yield* profile.use(createMission({ projectId: acme.id, idea: sentence('Export notes') }))
        const results: StartResult[] = []
        const running = yield* profile.follow(searchStart(acme.id, 'export')).pipe(
          Stream.runForEach((result) => Effect.sync(() => results.push(result))),
          Effect.forkChild,
        )
        // The local results arrive while the remote search is still asking.
        yield* Deferred.await(asking)
        const seen = yield* until(
          Effect.sync(() => [...results]),
          (all) => all.length === 2,
        )
        yield* Fiber.interrupt(running)
        yield* Deferred.await(stopped)
        return seen
      }),
    )
    expect(tagsOf(local)).toEqual(['MissionFound', 'CreateChoice'])
    expect(Effect.runSync(Deferred.isDone(stopped))).toBe(true)
  })
})

describe('Create, explicitly: one mission per choice, in Planning, nothing on disk', () => {
  test('two calls with the same idempotency key, even at once, create one mission', async () => {
    const [both, again, listed, created] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const once = asked(acme.id, { text: 'Export notes as Markdown' })
          const twice = yield* Effect.all([createStart(once), createStart(once)], {
            concurrency: 'unbounded',
          })
          const page = yield* readEvents({})
          return [
            twice,
            yield* createStart(once),
            yield* listMissions(acme.id),
            page.events.filter((event) => event.type === 'mission.created'),
          ] as const
        }),
      ),
    )
    expect(both[0].id).toBe(both[1].id)
    expect(again.id).toBe(both[0].id)
    expect(listed.map((mission) => mission.key)).toEqual(['ACME-1'])
    expect(created).toHaveLength(1)
  })

  test('two creates of one ticket at once give one mission and one refusal', async () => {
    const outcomes = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const ticket = { reference: reference('acme/shop#41') }
          return yield* Effect.all(
            [
              Effect.result(createStart(asked(acme.id, { ticket }))),
              Effect.result(createStart(asked(acme.id, { ticket }))),
            ],
            { concurrency: 'unbounded' },
          )
        }),
      ),
    )
    const refusals = outcomes.flatMap((outcome) =>
      Result.isFailure(outcome) ? [outcome.failure] : [],
    )
    expect(outcomes.filter(Result.isSuccess)).toHaveLength(1)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toBeInstanceOf(TicketAlreadyLinked)
  })

  test('a mission is created with the next key, in Planning, with no Workspace and no branch', async () => {
    const [mission, workspaces, branchesBefore, branchesAfter, now, events] = await engine()(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const acme = yield* project()
            yield* createMission({ projectId: acme.id, idea: sentence('An older one') })
            const branches = git(acme.api, 'for-each-ref', '--format=%(refname)', 'refs/heads')
            const origin = yield* createMission({ projectId: acme.id, idea: sentence('Origin') })
            const made = yield* createStart(
              asked(acme.id, {
                text: 'Export notes as Markdown\nwith the images',
                ticket: { reference: reference('acme/shop#41'), title: 'Export the notes' },
                origin: origin.id,
              }),
            )
            const page = yield* readEvents({ entity: { kind: 'mission', id: made.id } })
            return [
              made,
              yield* listWorkspaces(acme.id),
              branches,
              git(acme.api, 'for-each-ref', '--format=%(refname)', 'refs/heads'),
              yield* Memory.use((memory) => memory.now(made.id)),
              page.events,
            ] as const
          }),
        ),
    )
    expect(mission).toMatchObject({
      key: 'ACME-3',
      stage: 'planning',
      type: 'feature',
      title: 'Export notes as Markdown',
      idea: { sentence: 'Export notes as Markdown\nwith the images', ticket: 'acme/shop#41' },
      ticketLink: {
        provider: 'github',
        reference: 'github:github.com/acme/shop#41',
        key: 'acme/shop#41',
        url: 'https://github.com/acme/shop/issues/41',
      },
    })
    expect(mission.origin).not.toBeNull()
    expect(workspaces).toEqual([])
    expect(branchesAfter).toBe(branchesBefore)
    expect(now.next?.text).toBe('Planning starts')
    expect(events.map((event) => event.type)).toEqual(['mission.created', 'memory.now_set'])
    expect(events[0]).toMatchObject({
      author: 'human',
      payload: {
        key: 'ACME-3',
        sentence: 'Export notes as Markdown\nwith the images',
        ticket: 'github:github.com/acme/shop#41',
        origin: mission.origin,
      },
    })
  })

  test('the provisional title: the first line of the text, else the ticket’s title, else its key', async () => {
    const titles = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const long = `${'word '.repeat(30)}end`
          const made = [
            yield* createStart(asked(acme.id, { text: `\n  Export   notes \nmore` })),
            yield* createStart(asked(acme.id, { text: long })),
            yield* createStart(
              asked(acme.id, {
                ticket: { reference: reference('acme/shop#41'), title: 'Export the notes' },
              }),
            ),
            yield* createStart(
              asked(acme.id, { ticket: { reference: reference('acme/shop#42') } }),
            ),
          ]
          return made.map((mission) => mission.title)
        }),
      ),
    )
    expect(titles[0]).toBe('Export notes')
    expect(titles[1]?.endsWith('word…')).toBe(true)
    expect(titles[1]?.length).toBeLessThanOrEqual(81)
    expect(titles.slice(2)).toEqual(['Export the notes', 'acme/shop#42'])
  })

  test('refused in words: nothing to start from, an origin of another Project', async () => {
    const [empty, foreign, listed] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acme = yield* project()
          const other = yield* project('Hemera')
          const theirs = yield* createMission({ projectId: other.id, idea: sentence('Theirs') })
          return [
            yield* Effect.flip(createStart(asked(acme.id, { text: '   ' }))),
            yield* Effect.flip(createStart(asked(acme.id, { text: 'Mine', origin: theirs.id }))),
            yield* listMissions(acme.id),
          ] as const
        }),
      ),
    )
    expect(empty).toBeInstanceOf(InvalidMissionIdea)
    expect(empty.message).toBe('This mission cannot start: give it a sentence or a ticket.')
    expect(foreign).toBeInstanceOf(InvalidMissionIdea)
    expect(foreign.message).toBe(
      'This mission cannot start: it can start only from a mission of this Project.',
    )
    expect(listed).toEqual([])
  })

  test('mission.started is told after the commit, and not when the transaction fails', async () => {
    const [told, created, committed] = await engine()(({ profile }) =>
      profile.use(
        Effect.scoped(
          Effect.gen(function* () {
            const acme = yield* project()
            const starts = yield* MissionStarts.use((started) => started.subscribe)
            const listening = yield* starts.pipe(
              Stream.take(2),
              // At the moment it is told, the mission and its event are in the data folder.
              Stream.mapEffect((started) =>
                Effect.map(
                  Effect.all([getMission(started.missionId), readEvents({})]),
                  ([mission, page]) => ({
                    missionId: started.missionId,
                    committed: page.events.some(
                      (event) => event.type === 'mission.created' && event.entityId === mission.id,
                    ),
                  }),
                ),
              ),
              Stream.runCollect,
              Effect.forkChild,
            )
            const ticket = { reference: reference('acme/shop#41') }
            const first = yield* createStart(asked(acme.id, { ticket }))
            // Refused inside its transaction: rolled back, and told to nobody.
            yield* Effect.flip(createStart(asked(acme.id, { ticket })))
            const second = yield* createStart(asked(acme.id, { text: 'Export notes' }))
            const all = [...(yield* Fiber.join(listening))]
            return [
              all.map((one) => one.missionId),
              [first.id, second.id],
              all.every((one) => one.committed),
            ] as const
          }),
        ),
      ),
    )
    expect(told).toEqual(created)
    expect(committed).toBe(true)
  })

  test('a create interrupted once its transaction has committed still tells mission.started', async () => {
    const END = 'end-of-the-test'
    const [told, made, again] = await engine()(({ profile }) =>
      profile.use(
        Effect.scoped(
          Effect.gen(function* () {
            const acme = yield* project()
            const starts = yield* MissionStarts.use((started) => started.subscribe)
            const listening = yield* starts.pipe(
              Stream.takeUntil((one) => one.missionId === END),
              Stream.runCollect,
              Effect.forkChild,
            )
            // The domain events are told right after the commit: the create is held there, its
            // mission written, while the window interrupts it.
            const events = yield* DomainEvents
            const committed = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const holding = DomainEvents.of({
              ...events,
              committed: (written) =>
                events
                  .committed(written)
                  .pipe(
                    Effect.andThen(Deferred.succeed(committed, undefined)),
                    Effect.andThen(Deferred.await(release)),
                  ),
            })
            const once = asked(acme.id, { text: 'Export notes as Markdown' })
            const creating = yield* createStart(once).pipe(
              Effect.provideService(DomainEvents, holding),
              Effect.forkChild,
            )
            yield* Deferred.await(committed)
            // The interruption reaches the create before it is released.
            yield* Effect.sync(() => {
              creating.interruptUnsafe()
            })
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.await(creating)
            // The retry of the same choice finds the mission made, and makes no other.
            const retried = yield* createStart(once)
            // Told last, so that the listener has heard everything told before it.
            yield* MissionStarts.use((started) => started.started({ missionId: END }))
            const all = [...(yield* Fiber.join(listening))]
            return [
              all.map((one) => one.missionId).filter((id) => id !== END),
              yield* listMissions(acme.id),
              retried,
            ] as const
          }),
        ),
      ),
    )
    expect(made.map((mission) => mission.id)).toEqual([again.id])
    expect(told).toEqual([again.id])
  })

  test('a mission created by the Chat is started too, and the origin is read back', async () => {
    const [told, origin] = await engine()(({ profile }) =>
      profile.use(
        Effect.scoped(
          Effect.gen(function* () {
            const acme = yield* project()
            const starts = yield* MissionStarts.use((started) => started.subscribe)
            const listening = yield* starts.pipe(
              Stream.take(2),
              Stream.runCollect,
              Effect.forkChild,
            )
            const first = yield* createMission(
              { projectId: acme.id, idea: sentence('From the Chat') },
              { fromChat: 'Ideas' },
            )
            const second = yield* createStart(
              asked(acme.id, { text: 'Started from it', origin: first.id }),
            )
            const all = [...(yield* Fiber.join(listening))]
            return [
              all.map((one) => one.missionId),
              Option.some((yield* getMission(second.id)).origin),
            ] as const
          }),
        ),
      ),
    )
    expect(told).toHaveLength(2)
    expect(origin).toEqual(Option.some(told[0]))
  })
})
