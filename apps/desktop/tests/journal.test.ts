/**
 * What it takes for a change and its provenance to be one thing (design D4-04).
 *
 * Each suite is named after the scenario of `specs/domain-journal/spec.md` it covers. The
 * mutations here are written by hand rather than through the Projects service: what is under
 * test is the transaction and the journal, and a service in the middle would make a failure
 * ambiguous. Every suite works on a data folder made for it under the temporary directory,
 * migrated by the migrations the application really ships.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Data, Effect } from 'effect'

import { openProfile } from '#engine/migrate.ts'
import { type Database, SqliteClient, databaseLayer } from '#engine/storage/database.ts'
import { projects } from '#engine/storage/schema.ts'
import { mutate } from '#engine/transaction.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

let workspace: string
let dataFolder: string

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'hemera-journal-'))
  dataFolder = join(workspace, 'data')
  mkdirSync(dataFolder, { recursive: true })
  await on(openProfile(dataFolder, SHIPPED, '0.4.0'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

/**
 * Runs a program against the data folder, and closes it before answering.
 *
 * One call is one opening of the database, which is what lets a test say "and then the
 * application was restarted" by calling it twice.
 */
async function on<A, E>(program: Effect.Effect<A, E, Database | SqliteClient>): Promise<A> {
  return await Effect.runPromise(
    Effect.scoped(Effect.provide(program, databaseLayer(join(dataFolder, 'hemera.sqlite')))),
  )
}

/** The same, for a program expected to fail: its refusal is the answer. */
async function refusal<A, E>(program: Effect.Effect<A, E, Database | SqliteClient>): Promise<E> {
  return await on(Effect.flip(program))
}

/** A project, as a mutation writes one: the state, and the event that says it was written. */
function createProject(id: string, name: string) {
  const written = new Date().toISOString()
  return mutate('creating a project', (transaction) =>
    Effect.gen(function* () {
      yield* transaction
        .insert(projects)
        .values({ id, name, tone: 'primary', createdAt: written, updatedAt: written })
      return {
        result: id,
        events: [
          {
            type: 'project.created',
            entityKind: 'project',
            entityId: id,
            source: 'ui',
            author: 'human',
            projectId: id,
            payload: { name },
          },
        ],
      } as const
    }),
  )
}

/**
 * Everything the journal holds of what these suites did, oldest first.
 *
 * The line the profile writes when it is opened is left out by name, and only that one: it is
 * written by the opening and not by a mutation, while an event of the profile written by a test
 * is exactly what one of these suites is about.
 */
const journal = Effect.gen(function* () {
  const sql = yield* SqliteClient
  return yield* sql<{
    sequence: number
    type: string
    entity_kind: string
    entity_id: string
    source: string
    author: string
    occurred_at: string
    project_id: string | null
    session_id: string | null
    spec_id: string | null
    revision_id: string | null
    phase_id: string | null
    payload: string
    seen_at: string | null
    // Of the Projects. What opening the data folder did — it was opened, it was migrated — is
    // written down too, and is the subject of `migrate.test.ts` rather than of this file.
  }>`SELECT * FROM domain_events WHERE entity_kind = 'project' ORDER BY sequence`
})

/** The last two entries whatever they belong to, oldest of the two first. */
const lastTwo = Effect.gen(function* () {
  const sql = yield* SqliteClient
  const rows = yield* sql<{ source: string; author: string; project_id: string | null }>`
    SELECT source, author, project_id FROM domain_events ORDER BY sequence DESC LIMIT 2`
  return rows.toReversed()
})

/** Every project the data folder holds. */
const stored = Effect.gen(function* () {
  const sql = yield* SqliteClient
  return yield* sql<{ id: string; name: string }>`SELECT id, name FROM projects ORDER BY id`
})

describe('Mutation réussie', () => {
  test('the state and the event are there together once the transaction has committed', async () => {
    await on(createProject('p1', 'Atlas'))

    expect(await on(stored)).toEqual([{ id: 'p1', name: 'Atlas' }])

    const events = await on(journal)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('project.created')
    expect(events[0]?.entity_kind).toBe('project')
    expect(events[0]?.entity_id).toBe('p1')
    expect(events[0]?.author).toBe('human')
    expect(JSON.parse(events[0]!.payload)).toEqual({ name: 'Atlas' })
  })

  test('the event is correlated to its project, which is how the journal finds it', async () => {
    await on(createProject('p1', 'Atlas'))
    expect((await on(journal))[0]?.project_id).toBe('p1')
  })
})

/** A refusal raised by the body of a mutation, after it has already written something. */
class Refused extends Data.TaggedError('Refused')<{ readonly why: string }> {}

describe('Échec de persistance', () => {
  test('a mutation that fails halfway leaves neither the state nor the event behind', async () => {
    const written = new Date().toISOString()
    const raised = await refusal(
      mutate('a change that is refused', (transaction) =>
        Effect.gen(function* () {
          yield* transaction.insert(projects).values({
            id: 'p1',
            name: 'Atlas',
            tone: 'primary',
            createdAt: written,
            updatedAt: written,
          })
          return yield* Effect.fail(new Refused({ why: 'the body said so' }))
        }),
      ),
    )

    expect(raised).toBeInstanceOf(Refused)
    expect(await on(stored)).toEqual([])
    expect(await on(journal)).toEqual([])
  })

  test('a write the database itself refuses takes the whole mutation down with it', async () => {
    await on(createProject('p1', 'Atlas'))

    // The same identifier twice: the primary key refuses the second one.
    await refusal(createProject('p1', 'Atlas again'))

    expect(await on(stored)).toEqual([{ id: 'p1', name: 'Atlas' }])
    expect(await on(journal)).toHaveLength(1)
  })
})

describe('Ordre total', () => {
  test('events written in the same millisecond still come out in the order they were written', async () => {
    // One transaction, so one date: what tells them apart cannot be the clock.
    await on(
      mutate('two changes at once', () =>
        Effect.succeed({
          result: null,
          events: [
            {
              type: 'project.renamed',
              entityKind: 'project',
              entityId: 'p1',
              source: 'ui',
              author: 'human',
              projectId: 'p1',
            },
            {
              type: 'project.archived',
              entityKind: 'project',
              entityId: 'p1',
              source: 'ui',
              author: 'human',
              projectId: 'p1',
            },
          ],
        } as const),
      ),
    )

    const events = await on(journal)
    expect(events.map((event) => event.occurred_at)).toEqual([
      events[0]?.occurred_at,
      events[0]?.occurred_at,
    ])
    expect(events[1]!.sequence).toBeGreaterThan(events[0]!.sequence)
  })
})

describe('Continuité après redémarrage', () => {
  test('an event written after a restart takes a sequence above every one already given out', async () => {
    await on(createProject('p1', 'Atlas'))
    const before = (await on(journal)).at(-1)!.sequence

    // A second opening of the same file, which is what a restart is.
    await on(createProject('p2', 'Orion'))

    const after = (await on(journal)).at(-1)!.sequence
    expect(after).toBeGreaterThan(before)
  })
})

describe('Auteur humain distingué', () => {
  test('what the user did and what Hemera did are told apart on the event itself', async () => {
    await on(createProject('p1', 'Atlas'))
    await on(
      mutate('writing down a migration', () =>
        Effect.succeed({
          result: null,
          events: [
            {
              type: 'profile.migrated',
              entityKind: 'profile',
              entityId: 'profile',
              source: 'system',
              author: 'hemera',
              payload: { migration: '20260918_projects_and_journal' },
            },
          ],
        } as const),
      ),
    )

    // The last two, since this is the one test of the file that wants an entry of the profile
    // beside one of a Project, and opening the data folder wrote two of its own before either.
    const events = await on(lastTwo)
    expect(events.map((event) => [event.source, event.author])).toEqual([
      ['ui', 'human'],
      ['system', 'hemera'],
    ])
    // What belongs to the profile belongs to no project, and says so.
    expect(events[1]?.project_id).toBeNull()
  })
})

describe('Corrélations réservées vides', () => {
  test('the correlations of the Session, the Spec, the revision and the phase exist and are empty', async () => {
    await on(createProject('p1', 'Atlas'))

    const event = (await on(journal))[0]!
    expect(event.session_id).toBeNull()
    expect(event.spec_id).toBeNull()
    expect(event.revision_id).toBeNull()
    expect(event.phase_id).toBeNull()
    // And it is seen, because the hand that made it watched it happen: `seen_at` is what the
    // bell reads, and what the user did themselves is never news to them.
    expect(event.seen_at).toBe(event.occurred_at)
  })
})

describe('Le journal tourne sur un dossier temporaire', () => {
  test('every data folder this suite wrote to is under the temporary directory it made', () => {
    expect(workspace.startsWith(tmpdir())).toBe(true)
  })
})
