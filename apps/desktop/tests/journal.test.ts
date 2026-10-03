/**
 * What it takes for a change and its events to be one thing, and how the events are read and
 * told. The mutations write by hand: what is under test is the transaction and the journal, and
 * a service in the middle would make a failure ambiguous.
 */

import { tmpdir } from 'node:os'

import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Effect, Fiber, Schema, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { DomainEvents } from '../src/engine/domain-events.ts'
import { InvalidCursor, type NewEvent, readEvents } from '../src/engine/journal.ts'
import { openProfile } from '../src/engine/migrate.ts'
import { DatabaseError, SqliteClient } from '../src/engine/storage/database.ts'
import { appPreferences } from '../src/engine/storage/schema.ts'
import {
  SideEffectInTransaction,
  StaleVersion,
  atVersion,
  mutate,
  outsideTransaction,
} from '../src/engine/transaction.ts'
import { SHIPPED, on, refusalOn, removeFolders, temporaryFolder } from './storage.ts'

let data: string

beforeEach(async () => {
  data = temporaryFolder('journal')
  await on(data, openProfile(data, SHIPPED, '1.0.0'))
})
afterEach(removeFolders)

const noted = (key: string, entity = 'note'): NewEvent => ({
  type: `${entity}.written`,
  entityKind: entity,
  entityId: key,
  source: 'ui',
  author: 'human',
  payload: { key },
})

/** A preference written with its event: the smallest change the schema of 1.0 holds. */
const write = (key: string, value: string) =>
  mutate('writing a note', (transaction) =>
    Effect.gen(function* () {
      yield* transaction.insert(appPreferences).values({ key, value })
      return { result: key, events: [noted(key)] }
    }),
  )

const stored = Effect.gen(function* () {
  const client = yield* SqliteClient
  return yield* client<{ key: string }>`SELECT key FROM app_preferences ORDER BY key`
})

const notes = Effect.map(readEvents({}), (page) =>
  page.events.filter((event) => event.entityKind === 'note'),
)

class Refused extends Schema.TaggedError<Refused>()('Refused', {}) {}

describe('A mutation writes its state and its event together', () => {
  test('both are there once it has committed', async () => {
    await on(data, write('a', '1'))
    expect(await on(data, stored)).toEqual([{ key: 'a' }])
    const [event] = await on(data, notes)
    expect(event).toMatchObject({
      type: 'note.written',
      entityId: 'a',
      source: 'ui',
      author: 'human',
      payload: { key: 'a' },
    })
  })

  test('a body that fails halfway leaves neither', async () => {
    const refused = await refusalOn(
      data,
      mutate('a refused change', (transaction) =>
        Effect.gen(function* () {
          yield* transaction.insert(appPreferences).values({ key: 'a', value: '1' })
          return yield* new Refused()
        }),
      ),
    )
    expect(refused).toBeInstanceOf(Refused)
    expect(await on(data, stored)).toEqual([])
    expect(await on(data, notes)).toEqual([])
  })

  test('a write the database refuses takes the whole mutation down, as a DatabaseError', async () => {
    await on(data, write('a', '1'))
    const refused = await refusalOn(data, write('a', '2'))
    expect(refused).toBeInstanceOf(DatabaseError)
    expect(refused.message).toMatch(/^The data folder refused while writing a note: /)
    expect(await on(data, notes)).toHaveLength(1)
  })
})

describe('Nothing leaves the database inside a transaction', () => {
  test('a side effect inside mutate is refused, and nothing is written', async () => {
    let started = 0
    const startAgent = outsideTransaction(
      'start an agent',
      Effect.sync(() => {
        started += 1
      }),
    )
    const refused = await refusalOn(
      data,
      mutate('a change that starts an agent', (transaction) =>
        Effect.gen(function* () {
          yield* transaction.insert(appPreferences).values({ key: 'a', value: '1' })
          yield* startAgent
          return { result: null, events: [noted('a')] }
        }),
      ),
    )
    expect(refused).toBeInstanceOf(SideEffectInTransaction)
    expect(started).toBe(0)
    expect(await on(data, stored)).toEqual([])

    // The same call, outside a transaction, runs.
    await on(data, startAgent)
    expect(started).toBe(1)
  })
})

describe('The sequence', () => {
  test('events of the same transaction come out in the order they were written', async () => {
    await on(
      data,
      mutate('two at once', () =>
        Effect.succeed({ result: null, events: [noted('first'), noted('second')] }),
      ),
    )
    const events = await on(data, notes)
    expect(events.map((event) => event.entityId)).toEqual(['first', 'second'])
    expect(events[0]?.occurredAt).toBe(events[1]?.occurredAt)
    expect(events[1]!.sequence).toBeGreaterThan(events[0]!.sequence)
  })

  test('an event written after a restart takes a sequence above every one given out', async () => {
    await on(data, write('a', '1'))
    const before = (await on(data, notes)).at(-1)!.sequence
    await on(data, write('b', '1'))
    expect((await on(data, notes)).at(-1)!.sequence).toBeGreaterThan(before)
  })

  test('a sequence is never reused, even once the last event is gone', async () => {
    await on(data, write('a', '1'))
    const last = (await on(data, notes)).at(-1)!.sequence
    await on(
      data,
      Effect.gen(function* () {
        const client = yield* SqliteClient
        yield* client`DELETE FROM domain_events WHERE sequence = ${last}`
      }),
    )
    await on(data, write('b', '1'))
    expect((await on(data, notes)).at(-1)!.sequence).toBeGreaterThan(last)
  })
})

describe('Committed events are told after the commit, in sequence order', () => {
  test('a follower hears every committed event once, and none of a rolled-back one', async () => {
    const heard = await on(
      data,
      Effect.gen(function* () {
        const changes = yield* (yield* DomainEvents).subscribe
        const following = yield* Effect.forkChild(Stream.runCollect(Stream.take(changes, 3)))
        yield* write('a', '1')
        yield* Effect.flip(mutate('refused', () => Effect.fail(new Refused())).pipe(Effect.asVoid))
        yield* mutate('two', () =>
          Effect.succeed({ result: null, events: [noted('b'), noted('c')] }),
        )
        return yield* Fiber.join(following)
      }),
    )
    expect(heard.map((event) => event.entityId)).toEqual(['a', 'b', 'c'])
    const sequences = heard.map((event) => event.sequence)
    expect(sequences).toEqual(sequences.toSorted((left, right) => left - right))
  })
})

describe('Reading the events', () => {
  beforeEach(async () => {
    await on(
      data,
      mutate('a few', () =>
        Effect.succeed({
          result: null,
          events: ['a', 'b', 'a', 'c', 'a'].map((key) => noted(key)),
        }),
      ),
    )
  })

  test('by entity, in sequence order', async () => {
    const page = await on(data, readEvents({ entity: { kind: 'note', id: 'a' } }))
    expect(page.events.map((event) => event.entityId)).toEqual(['a', 'a', 'a'])
    expect(page.next).toBeNull()
  })

  test('paged by sequence, with nothing repeated or skipped', async () => {
    const first = await on(data, readEvents({ limit: 3 }))
    expect(first.next).toBe(first.events.at(-1)?.sequence)
    const second = await on(data, readEvents({ after: first.next ?? 0, limit: 3 }))
    const all = await on(data, readEvents({}))
    expect([...first.events, ...second.events]).toEqual(all.events.slice(0, 6))
  })

  test('a cursor that is not a sequence is refused', async () => {
    expect(await refusalOn(data, readEvents({ after: -1 }))).toBeInstanceOf(InvalidCursor)
    expect(await refusalOn(data, readEvents({ after: 1.5 }))).toBeInstanceOf(InvalidCursor)
  })
})

/** A record a screen edits, which carries its version: a table of a later ticket, here. */
const notesTable = sqliteTable('notes', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  version: integer('version').notNull(),
})

describe('Optimistic writes', () => {
  test('writing over a stale version is a typed refusal, never a silent overwrite', async () => {
    const edit = (words: string, expected: number) =>
      mutate('editing a note', (transaction) =>
        Effect.gen(function* () {
          const changed = yield* transaction
            .update(notesTable)
            .set({ text: words, version: sql`${notesTable.version} + 1` })
            .where(sql`${notesTable.id} = 'n1' AND ${notesTable.version} = ${expected}`)
            .returning({ version: notesTable.version })
            .pipe(atVersion('note', 'n1', expected))
          return { result: changed.version, events: [noted('n1')] }
        }),
      )
    await on(
      data,
      Effect.gen(function* () {
        const client = yield* SqliteClient
        yield* client`CREATE TABLE notes (id text PRIMARY KEY, text text NOT NULL, version integer NOT NULL)`
        yield* client`INSERT INTO notes VALUES ('n1', 'first', 1)`
      }),
    )

    expect(await on(data, edit('second', 1))).toBe(2)
    const refused = await refusalOn(data, edit('from a stale screen', 1))
    expect(refused).toBeInstanceOf(StaleVersion)
    expect(refused.message).toBe('This note changed elsewhere; reopen it and try again.')

    const [row] = await on(
      data,
      Effect.gen(function* () {
        const client = yield* SqliteClient
        return yield* client<{ text: string }>`SELECT text FROM notes WHERE id = 'n1'`
      }),
    )
    expect(row?.text).toBe('second')
  })
})

describe('The journal tests run on temporary folders', () => {
  test('the data folder is under the temporary directory', () => {
    expect(data.startsWith(tmpdir())).toBe(true)
  })
})
