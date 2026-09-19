/**
 * How the Journal is read back, and what the bell shows (design D4-05).
 *
 * Each suite is named after the scenario of `specs/domain-journal/spec.md` it covers. The
 * entries are written straight through `mutate` rather than through the Projects service: what
 * is under test is the reading, and a page of fifteen events is easier to reason about than
 * fifteen Projects.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { InvalidCursorError, Journal, journalLayer } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { type Database, SqliteClient, databaseLayer } from '#engine/storage/database.ts'
import { mutate } from '#engine/transaction.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

const ATLAS = 'atlas'
const ORION = 'orion'

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-journal-read-'))
  mkdirSync(dataFolder, { recursive: true })
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

/** A data folder opened and migrated, with the Journal standing on it. */
function opened() {
  const services = journalLayer.pipe(
    Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite'))),
  )
  // `Database` too: the events are written straight through `mutate`, which asks for it.
  return <A, E>(program: Effect.Effect<A, E, Journal | SqliteClient | Database>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(dataFolder, SHIPPED, '0.4.0')
            // Opening the profile writes its own entry, which is what it is supposed to do and
            // not what these suites are counting. They start from an empty Journal instead.
            const sql = yield* SqliteClient
            yield* sql`DELETE FROM domain_events`
            return yield* program
          }),
          services,
        ),
      ),
    )
}

/** Writes one event, the way a use case writes one. */
function write(
  type: string,
  projectId: string | null,
  author: 'human' | 'hemera' = 'human',
  entityKind: 'project' | 'profile' = 'project',
) {
  return mutate('writing a test event', () =>
    Effect.succeed({
      result: null,
      events: [
        {
          type,
          entityKind,
          entityId: projectId ?? 'profile',
          source: author === 'human' ? ('ui' as const) : ('system' as const),
          author,
          projectId,
        },
      ],
    } as const),
  )
}

/** Six entries of Atlas, two of Orion, and one of the profile, oldest first. */
const aPage = Effect.gen(function* () {
  for (let index = 0; index < 6; index += 1) yield* write(`project.step_${String(index)}`, ATLAS)
  yield* write('profile.opened', null, 'hemera', 'profile')
  yield* write('project.created', ORION)
  yield* write('project.archived', ORION)
})

describe('Pages successives', () => {
  test('the next page holds what is strictly older, with nothing repeated', async () => {
    const [first, second] = await opened()(
      Effect.gen(function* () {
        yield* aPage
        const journal = yield* Journal
        const one = yield* journal.read({ projectId: ATLAS, limit: 3 })
        const two = yield* journal.read({
          projectId: ATLAS,
          limit: 3,
          before: one.nextBefore ?? undefined,
        })
        return [one, two] as const
      }),
    )

    expect(first.entries.map((entry) => entry.type)).toEqual([
      'profile.opened',
      'project.step_5',
      'project.step_4',
    ])
    expect(first.nextBefore).not.toBeNull()
    expect(second.entries.map((entry) => entry.type)).toEqual([
      'project.step_3',
      'project.step_2',
      'project.step_1',
    ])
    // Nothing is in both pages.
    const seen = new Set(first.entries.map((entry) => entry.sequence))
    expect(second.entries.some((entry) => seen.has(entry.sequence))).toBe(false)
  })

  test('the last page says there is nothing older', async () => {
    const page = await opened()(
      Effect.gen(function* () {
        yield* write('project.created', ATLAS)
        return yield* (yield* Journal).read({ projectId: ATLAS })
      }),
    )

    expect(page.entries).toHaveLength(1)
    expect(page.nextBefore).toBeNull()
  })
})

describe('Écriture pendant la lecture', () => {
  test('an entry written between two pages is in neither, and none is skipped', async () => {
    const [first, second] = await opened()(
      Effect.gen(function* () {
        yield* aPage
        const journal = yield* Journal
        const one = yield* journal.read({ projectId: ATLAS, limit: 3 })
        // Somebody works while the page is being read.
        yield* write('project.renamed', ATLAS)
        const two = yield* journal.read({
          projectId: ATLAS,
          limit: 3,
          before: one.nextBefore ?? undefined,
        })
        return [one, two] as const
      }),
    )

    const shown = [...first.entries, ...second.entries].map((entry) => entry.type)
    // The newcomer is newer than the cursor, so the walk down the Journal never sees it — and
    // nothing older than the cursor was pushed off the end by it either.
    expect(shown).not.toContain('project.renamed')
    expect(shown).toEqual([
      'profile.opened',
      'project.step_5',
      'project.step_4',
      'project.step_3',
      'project.step_2',
      'project.step_1',
    ])
  })
})

describe('Filtres', () => {
  test('by entity, and by author, in the same order as without them', async () => {
    const [byKind, byAuthor] = await opened()(
      Effect.gen(function* () {
        yield* aPage
        const journal = yield* Journal
        return [
          yield* journal.read({ projectId: ATLAS, kinds: ['profile'] }),
          yield* journal.read({ projectId: ATLAS, authors: ['human'] }),
        ] as const
      }),
    )

    expect(byKind.entries.map((entry) => entry.type)).toEqual(['profile.opened'])
    expect(byAuthor.entries.every((entry) => entry.author === 'human')).toBe(true)
    expect(byAuthor.entries).toHaveLength(6)
  })

  test("the profile's own entries are shown in every Project's Journal", async () => {
    const [atlas, orion] = await opened()(
      Effect.gen(function* () {
        yield* aPage
        const journal = yield* Journal
        return [
          yield* journal.read({ projectId: ATLAS }),
          yield* journal.read({ projectId: ORION }),
        ] as const
      }),
    )

    // They belong to no Project, so they are in none — which is why they are in all of them.
    expect(atlas.entries.some((entry) => entry.type === 'profile.opened')).toBe(true)
    expect(orion.entries.some((entry) => entry.type === 'profile.opened')).toBe(true)
    expect(orion.entries.some((entry) => entry.type === 'project.step_1')).toBe(false)
  })
})

describe('Curseur invalide', () => {
  test.each([-1, 1.5, Number.NaN])('%s is refused before the database is asked', async (cursor) => {
    const raised = await opened()(
      Effect.flip(
        Effect.gen(function* () {
          return yield* (yield* Journal).read({ projectId: ATLAS, before: cursor })
        }),
      ),
    )

    expect(raised).toBeInstanceOf(InvalidCursorError)
  })
})

describe('La cloche liste tous les Projets', () => {
  test('every unseen entry, whichever Project it belongs to, and a count per Project', async () => {
    const unseen = await opened()(
      Effect.gen(function* () {
        yield* write('project.repository_added', ATLAS, 'hemera')
        yield* write('project.archived', ORION, 'hemera')
        yield* write('profile.opened', null, 'hemera', 'profile')
        return yield* (yield* Journal).unseen
      }),
    )

    // The two of the Projects. What the profile does is written down and read in the Journal,
    // and is not news: a bell ringing at every start to say the database opened is a bell that
    // gets ignored, and then misses the one thing it was for.
    expect(unseen.entries).toHaveLength(2)
    expect(unseen.byProject.get(ATLAS)).toBe(1)
    expect(unseen.byProject.get(ORION)).toBe(1)
    // The profile belongs to no Project, so it counts against none of them.
    expect([...unseen.byProject.keys()].toSorted()).toEqual([ATLAS, ORION])
  })

  test('and nothing the user did themselves, which they watched happen', async () => {
    const unseen = await opened()(
      Effect.gen(function* () {
        yield* write('project.created', ATLAS)
        yield* write('project.repository_added', ATLAS)
        return yield* (yield* Journal).unseen
      }),
    )

    // A bell counting the Project you have just created among the things you have not seen is
    // a bell nobody believes. The Journal still lists all three; this is what is *unseen*.
    expect(unseen.entries).toHaveLength(0)
    expect(unseen.byProject.size).toBe(0)
  })
})

describe('Marquer tout lu', () => {
  test('the bell empties, and the Journal keeps every entry', async () => {
    const [after, page] = await opened()(
      Effect.gen(function* () {
        yield* aPage
        const journal = yield* Journal
        const before = yield* journal.unseen
        yield* journal.markSeen(before.entries[0]?.sequence ?? 0)
        return [yield* journal.unseen, yield* journal.read({ projectId: ATLAS })] as const
      }),
    )

    expect(after.entries).toEqual([])
    expect(after.byProject.size).toBe(0)
    expect(page.entries).toHaveLength(7)
  })

  test('an entry already seen keeps the date it was seen on', async () => {
    const [firstSeen, stillSeen] = await opened()(
      Effect.gen(function* () {
        yield* write('project.created', ATLAS)
        const journal = yield* Journal
        const one = yield* journal.unseen
        const sequence = one.entries[0]?.sequence ?? 0
        yield* journal.markSeen(sequence)
        const seenAt = (yield* journal.read({ projectId: ATLAS })).entries[0]?.seenAt
        yield* journal.markSeen(sequence)
        const again = (yield* journal.read({ projectId: ATLAS })).entries[0]?.seenAt
        return [seenAt, again] as const
      }),
    )

    expect(firstSeen).not.toBeNull()
    expect(stillSeen).toBe(firstSeen)
  })
})

describe('Les lectures du Journal tournent sur un dossier temporaire', () => {
  test('the data folder this suite wrote to is under the temporary directory it made', () => {
    expect(dataFolder.startsWith(tmpdir())).toBe(true)
  })
})
