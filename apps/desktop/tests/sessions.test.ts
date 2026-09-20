/**
 * What a Session is, what is written in it, and what is refused (design D4b-01 … D4b-06).
 *
 * Each suite is named after the scenario of the ticket's « Spec · sessions » it covers — the
 * ones the engine can prove on its own; what belongs to the sidebar, to the palette or to the
 * keyboard is proved where those live. Every suite runs on a data folder made for it under the
 * temporary directory, migrated by the migrations the application really ships.
 *
 * A restart is a real one here: the scope closes, the database file is let go of, and the next
 * program opens the same path again. Nothing is carried over in memory between the two, which
 * is the only way "found again after a crash" means anything.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { openProfile } from '#engine/migrate.ts'
import { Projects, UnknownProjectError, projectsLayer } from '#engine/projects.ts'
import {
  NEW_SESSION_TITLE,
  Sessions,
  UnknownSessionError,
  sessionsLayer,
} from '#engine/sessions.ts'
import {
  type Database,
  DatabaseError,
  SqliteClient,
  databaseLayer,
} from '#engine/storage/database.ts'
import { StaleVersionError } from '#engine/transaction.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-sessions-'))
  mkdirSync(dataFolder, { recursive: true })
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

/** What a program of these suites may ask for. */
type Engine = Projects | Sessions | SqliteClient | Database

/**
 * The data folder opened and migrated, with the services standing on it.
 *
 * One call is one opening: the layer is built, the program runs, the scope closes and the file
 * is released. Calling it twice is therefore a restart, and that is how the suites that claim
 * something survives one are written.
 */
function opened() {
  const services = Layer.mergeAll(projectsLayer, sessionsLayer).pipe(
    Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite'))),
  )
  return <A, E>(program: Effect.Effect<A, E, Engine>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(dataFolder, SHIPPED, '0.4.0')
            return yield* program
          }),
          services,
        ),
      ),
    )
}

/** The same, for a program expected to fail: its refusal is the answer, as it was raised. */
function refusalOn<A, E>(program: Effect.Effect<A, E, Engine>) {
  return opened()(Effect.flip(program))
}

/** A Project to hang Sessions on, created the way the Dialog creates one. */
const project = Effect.gen(function* () {
  const projects = yield* Projects
  return yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: '/tmp/atlas' })
})

/** One Project and one Session in it, which is where most of these suites start. */
const started = Effect.gen(function* () {
  const one = yield* project
  const session = yield* (yield* Sessions).create({ projectId: one.id })
  return { projectId: one.id, session }
})

/** What these suites wrote to the journal about Sessions, oldest first. */
const journal = Effect.gen(function* () {
  const sql = yield* SqliteClient
  return yield* sql<{
    type: string
    entity_id: string
    session_id: string | null
    project_id: string | null
    payload: string
  }>`
    SELECT type, entity_id, session_id, project_id, payload FROM domain_events
    WHERE entity_kind = 'session' ORDER BY sequence`
})

/** The whole thread of a Session, read from the rows rather than from what a call answered. */
function threadOf(sessionId: string) {
  return Effect.gen(function* () {
    const sql = yield* SqliteClient
    return yield* sql<{ seq: number; body: string; role: string }>`
      SELECT seq, body, role FROM session_entries
      WHERE session_id = ${sessionId} ORDER BY seq`
  })
}

describe('Création dans un Projet', () => {
  test('the Session is created in the Project, with no Spec and no Workspace of its own', async () => {
    const [session, listed, entries] = await opened()(
      Effect.gen(function* () {
        const made = yield* started
        const current = yield* (yield* Sessions).list({ projectId: made.projectId })
        return [made.session, current, yield* journal] as const
      }),
    )

    expect(session.title).toBe(NEW_SESSION_TITLE)
    expect(session.titleSource).toBe('derived')
    expect(session.version).toBe(1)
    expect(session.archivedAt).toBeNull()
    expect(listed.map((one) => one.id)).toEqual([session.id])

    // One event, correlated to the Session and to the Project it belongs to.
    expect(entries).toHaveLength(1)
    expect(entries[0]?.type).toBe('session.created')
    expect(entries[0]?.entity_id).toBe(session.id)
    expect(entries[0]?.session_id).toBe(session.id)
    expect(entries[0]?.project_id).toBe(session.projectId)
  })

  test('a Session created with the text of the Home composer holds it as its first message', async () => {
    const [session, thread] = await opened()(
      Effect.gen(function* () {
        const one = yield* project
        const made = yield* (yield* Sessions).create({
          projectId: one.id,
          firstMessage: 'Start with the parser',
        })
        return [made, yield* threadOf(made.id)] as const
      }),
    )

    expect(thread.map((entry) => entry.body)).toEqual(['Start with the parser'])
    expect(session.title).toBe('Start with the parser')
  })
})

describe('Aucune Spec créée implicitement', () => {
  test('creating a Session and writing in it creates no Workspace and no other row', async () => {
    const counted = await opened()(
      Effect.gen(function* () {
        const { session } = yield* started
        yield* (yield* Sessions).append(session.id, 'Nothing else, please')
        const sql = yield* SqliteClient
        return yield* sql<{ table_name: string; rows: number }>`
          SELECT 'workspaces' AS table_name, count(*) AS rows FROM workspaces
          UNION ALL SELECT 'project_repositories', count(*) FROM project_repositories
          UNION ALL SELECT 'sessions', count(*) FROM sessions`
      }),
    )

    // The one Workspace there is came with the Project and not with the Session; nothing else
    // was brought into being to make a thread possible.
    expect(counted).toEqual([
      { table_name: 'workspaces', rows: 1 },
      { table_name: 'project_repositories', rows: 0 },
      { table_name: 'sessions', rows: 1 },
    ])
  })
})

describe('Aucun Projet actif', () => {
  test('a Session asked for without a Project is refused by name, and nothing is written', async () => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        return yield* (yield* Sessions).create({ projectId: 'nobody' })
      }),
    )

    expect(raised).toBeInstanceOf(UnknownProjectError)

    // And no Project was created to make room for it.
    const [sessions, projects] = await opened()(
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const inSessions = yield* sql<{ rows: number }>`SELECT count(*) AS rows FROM sessions`
        const inProjects = yield* sql<{ rows: number }>`SELECT count(*) AS rows FROM projects`
        return [inSessions[0]?.rows, inProjects[0]?.rows] as const
      }),
    )
    expect(sessions).toBe(0)
    expect(projects).toBe(0)
  })

  test('a message aimed at a Session nothing answers to is refused too', async () => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        return yield* (yield* Sessions).append('nobody', 'into the void')
      }),
    )

    expect(raised).toBeInstanceOf(UnknownSessionError)
  })
})

describe('Message enregistré', () => {
  test('the message is written down with its event, and no answer is invented beside it', async () => {
    const [appended, thread, entries] = await opened()(
      Effect.gen(function* () {
        const { session } = yield* started
        const written = yield* (yield* Sessions).append(session.id, 'Check the migration')
        return [written, yield* threadOf(session.id), yield* journal] as const
      }),
    )

    expect(appended.entry.seq).toBe(1)
    expect(appended.entry.role).toBe('user')
    expect(thread).toEqual([{ seq: 1, body: 'Check the migration', role: 'user' }])
    // The user's own message and nothing else: no agent row, no placeholder waiting for one.
    expect(thread).toHaveLength(1)

    expect(entries.map((entry) => entry.type)).toEqual([
      'session.created',
      'session.message_recorded',
    ])
    // The Journal says a message was recorded and where, never what it said.
    expect(JSON.parse(entries[1]?.payload ?? '{}')).toEqual({ seq: 1 })
  })

  test('writing a message moves the Session to the top of what was written last', async () => {
    const order = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const one = yield* project
        const first = yield* sessions.create({ projectId: one.id })
        const second = yield* sessions.create({ projectId: one.id })
        yield* sessions.append(first.id, 'back to the first one')
        const listed = yield* sessions.list({ projectId: one.id })
        return [listed.map((each) => each.id), first.id, second.id] as const
      }),
    )

    const [listed, first, second] = order
    expect(listed).toEqual([first, second])
  })

  test('a rename counts as a write, so the Session it was done to comes back to the top', async () => {
    const listed = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const one = yield* project
        const first = yield* sessions.create({ projectId: one.id })
        const second = yield* sessions.create({ projectId: one.id })
        yield* sessions.rename(first.id, first.version, 'The parser')
        const current = yield* sessions.list({ projectId: one.id })
        return [current.map((each) => each.title), second.id] as const
      }),
    )

    expect(listed[0]).toEqual(['The parser', NEW_SESSION_TITLE])
  })
})

describe('Ordre des messages', () => {
  test('a burst of ten messages is read back from the database in the order it was written', async () => {
    const burst = Array.from({ length: 10 }, (_one, rank) => `message ${String(rank + 1)}`)

    const [thread, page] = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { session } = yield* started
        // One after another, as fast as the engine takes them — which is what a user typing
        // into the composer and pressing Enter ten times does.
        for (const body of burst) yield* sessions.append(session.id, body)
        return [yield* threadOf(session.id), yield* sessions.read({ sessionId: session.id })]
      }),
    )

    expect(thread.map((entry) => entry.body)).toEqual(burst)
    // Counted from one, with no gap and no place claimed twice.
    expect(thread.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(page.entries.map((entry) => entry.body)).toEqual(burst)
    expect(page.nextAfter).toBeNull()
  })

  test('a thread read page by page walks it from a place and never from an offset', async () => {
    const [first, second, last] = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { session } = yield* started
        for (const rank of [1, 2, 3, 4, 5]) yield* sessions.append(session.id, `m${String(rank)}`)
        const opening = yield* sessions.read({ sessionId: session.id, limit: 2 })
        const next = yield* sessions.read({
          sessionId: session.id,
          after: opening.nextAfter ?? 0,
          limit: 2,
        })
        const end = yield* sessions.read({
          sessionId: session.id,
          after: next.nextAfter ?? 0,
          limit: 2,
        })
        return [opening, next, end] as const
      }),
    )

    expect(first.entries.map((entry) => entry.body)).toEqual(['m1', 'm2'])
    expect(first.nextAfter).toBe(2)
    expect(second.entries.map((entry) => entry.body)).toEqual(['m3', 'm4'])
    expect(second.nextAfter).toBe(4)
    expect(last.entries.map((entry) => entry.body)).toEqual(['m5'])
    expect(last.nextAfter).toBeNull()
  })
})

describe('Échec d’enregistrement', () => {
  test('a database that refuses to be written leaves no entry, no event and no new date', async () => {
    const [raised, thread, entries, session] = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqliteClient
        const made = yield* started

        // A data folder that cannot be written to, which is what a read-only profile is from
        // in here: the connection refuses every write until it is told otherwise.
        yield* sql`PRAGMA query_only = ON`
        const refused = yield* Effect.flip(
          sessions.append(made.session.id, 'this must not survive'),
        )
        yield* sql`PRAGMA query_only = OFF`

        return [refused, yield* threadOf(made.session.id), yield* journal, made.session] as const
      }),
    )

    // The failure is the answer — named as what it is, so the page can say it — and nothing
    // of the message was kept.
    expect(raised).toBeInstanceOf(DatabaseError)
    expect(thread).toEqual([])
    expect(entries.map((entry) => entry.type)).toEqual(['session.created'])

    // Not even the date the sidebar sorts on moved: the three were one transaction.
    const after = await opened()(
      Effect.gen(function* () {
        const listed = yield* (yield* Sessions).list({ projectId: session.projectId })
        return listed[0]
      }),
    )
    expect(after?.lastWrittenAt).toBe(session.lastWrittenAt)
    expect(after?.version).toBe(session.version)
  })
})

describe('Titre dérivé du premier message', () => {
  test('the first message names the Session: its first line, cut on a space, with an ellipsis', async () => {
    const titles = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const one = yield* project
        const named = (body: string) =>
          Effect.gen(function* () {
            const session = yield* sessions.create({ projectId: one.id })
            return (yield* sessions.append(session.id, body)).session.title
          })
        return {
          short: yield* named('Fix the parser'),
          lines: yield* named('Fix the parser\nand then the printer'),
          long: yield* named(
            'Fix the parser of the migration files before anyone opens the profile again',
          ),
        }
      }),
    )

    expect(titles.short).toBe('Fix the parser')
    // The first line and not the paragraph: a sidebar entry is one line wide.
    expect(titles.lines).toBe('Fix the parser')
    // Sixty characters at most, cut on a space rather than mid-word, and said to be cut.
    expect(titles.long).toBe('Fix the parser of the migration files before anyone opens…')
    expect(titles.long.length).toBeLessThanOrEqual(61)
  })

  test('a second message changes nothing about the title the first one proposed', async () => {
    const title = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { session } = yield* started
        yield* sessions.append(session.id, 'The parser')
        return (yield* sessions.append(session.id, 'and the printer')).session.title
      }),
    )

    expect(title).toBe('The parser')
  })
})

describe('Renommage conservé', () => {
  test('a title the user chose is never replaced by a proposal, whatever is written after it', async () => {
    const [renamed, after, entries] = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { session } = yield* started
        const named = yield* sessions.rename(session.id, session.version, 'Migrations')
        const written = yield* sessions.append(named.id, 'Start with the parser')
        return [named, written.session, yield* journal] as const
      }),
    )

    expect(renamed.title).toBe('Migrations')
    expect(renamed.titleSource).toBe('user')
    // The first message of a Session the user has named proposes nothing.
    expect(after.title).toBe('Migrations')
    expect(after.titleSource).toBe('user')
    expect(entries.map((entry) => entry.type)).toEqual([
      'session.created',
      'session.renamed',
      'session.message_recorded',
    ])
  })

  test('a rename made against a version that is no longer current is refused', async () => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { session } = yield* started
        yield* sessions.rename(session.id, session.version, 'Migrations')
        // Someone else got there first: the Session is at the next version by now.
        return yield* sessions.rename(session.id, session.version, 'Something else')
      }),
    )

    expect(raised).toBeInstanceOf(StaleVersionError)
  })
})

describe('Session sans message', () => {
  test('a Session nothing was written in carries the default title and is renamed like any other', async () => {
    const [before, after] = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { session } = yield* started
        const renamed = yield* sessions.rename(session.id, session.version, 'Later')
        return [session, renamed] as const
      }),
    )

    // Stored, not left to whoever draws the sidebar: one title, written once, in English.
    expect(before.title).toBe(NEW_SESSION_TITLE)
    expect(after.title).toBe('Later')
  })
})

describe('Session archivée puis restaurée', () => {
  test('it leaves the list, stays readable as archived, and comes back with its whole thread', async () => {
    const [current, archived, restored, thread, entries] = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { projectId, session } = yield* started
        yield* sessions.append(session.id, 'one')
        const written = yield* sessions.append(session.id, 'two')
        const put = yield* sessions.archive(session.id, written.session.version)
        const left = yield* sessions.list({ projectId })
        const kept = yield* sessions.list({ projectId, archived: true })
        const back = yield* sessions.restore(put.id, put.version)
        return [left, kept, back, yield* threadOf(session.id), yield* journal] as const
      }),
    )

    expect(current).toEqual([])
    expect(archived).toHaveLength(1)
    expect(archived[0]?.archivedAt).not.toBeNull()
    expect(restored.archivedAt).toBeNull()
    // Nothing was taken away by either: the thread is exactly what was written in it.
    expect(thread.map((entry) => entry.body)).toEqual(['one', 'two'])
    expect(entries.map((entry) => entry.type)).toEqual([
      'session.created',
      'session.message_recorded',
      'session.message_recorded',
      'session.archived',
      'session.restored',
    ])
  })

  test('the service offers these use cases and no other', async () => {
    // Listed in full rather than checked for the absence of one word: a use case added
    // tomorrow has to be added here too, which is where anyone adding a way to delete a
    // Session would have to argue for it.
    const offered = await opened()(
      Effect.gen(function* () {
        return Object.keys(yield* Sessions).toSorted()
      }),
    )

    expect(offered).toEqual(['append', 'archive', 'create', 'list', 'read', 'rename', 'restore'])
  })
})

describe('Archivage durable', () => {
  test('a Session archived before a restart is still archived after it, with its data intact', async () => {
    const session = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const made = yield* started
        const written = yield* sessions.append(made.session.id, 'put away with this in it')
        return yield* sessions.archive(made.session.id, written.session.version)
      }),
    )

    // The file is closed and opened again: what follows is read from the disk, not from a
    // service that was still holding it.
    const [current, archived, thread] = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        return [
          yield* sessions.list({ projectId: session.projectId }),
          yield* sessions.list({ projectId: session.projectId, archived: true }),
          yield* threadOf(session.id),
        ] as const
      }),
    )

    expect(current).toEqual([])
    expect(archived.map((one) => one.id)).toEqual([session.id])
    expect(thread.map((entry) => entry.body)).toEqual(['put away with this in it'])
  })
})

describe('Arrêt brutal', () => {
  test('a message is on the disk by the time the call comes back, with nothing closing the file', async () => {
    const session = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const made = yield* started
        yield* sessions.append(made.session.id, 'written just before the lights went out')
        return made.session
      }),
    )

    // Nothing was flushed, saved or closed on the way out of that program beyond the commit
    // itself. Opening the file again is what a next launch does after a crash.
    const thread = await opened()(threadOf(session.id))
    expect(thread.map((entry) => entry.body)).toEqual(['written just before the lights went out'])
  })
})

describe('Deux Sessions retrouvées', () => {
  test('two Sessions with their own messages are both found again, each in its own order', async () => {
    const made = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const one = yield* project
        const parser = yield* sessions.create({ projectId: one.id })
        const printer = yield* sessions.create({ projectId: one.id })
        for (const body of ['parser one', 'parser two']) yield* sessions.append(parser.id, body)
        for (const body of ['printer one', 'printer two']) yield* sessions.append(printer.id, body)
        return { projectId: one.id, parser: parser.id, printer: printer.id }
      }),
    )

    const [listed, parser, printer] = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        return [
          yield* sessions.list({ projectId: made.projectId }),
          yield* sessions.read({ sessionId: made.parser }),
          yield* sessions.read({ sessionId: made.printer }),
        ] as const
      }),
    )

    expect(listed).toHaveLength(2)
    expect(parser.entries.map((entry) => entry.body)).toEqual(['parser one', 'parser two'])
    expect(printer.entries.map((entry) => entry.body)).toEqual(['printer one', 'printer two'])
    // The most recently written first, which is the order the sidebar shows them in.
    expect(listed.map((one) => one.id)).toEqual([made.printer, made.parser])
  })
})

describe('Contenu conservé indépendamment', () => {
  test('a thread is read back from Hemera’s own storage, with nothing outside it involved', async () => {
    const session = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const made = yield* started
        yield* sessions.append(made.session.id, 'nobody else is holding this')
        return made.session
      }),
    )

    // No provider, no process, no agent: the same file, opened again by services that were
    // built from nothing but a path.
    const page = await opened()(
      Effect.gen(function* () {
        return yield* (yield* Sessions).read({ sessionId: session.id })
      }),
    )

    expect(page.entries.map((entry) => entry.body)).toEqual(['nobody else is holding this'])
    expect(page.entries[0]?.role).toBe('user')
  })
})

describe('Travaux parallèles', () => {
  test('two Sessions written in turn keep their own history, whichever was last', async () => {
    const [parser, printer] = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const one = yield* project
        const first = yield* sessions.create({ projectId: one.id })
        const second = yield* sessions.create({ projectId: one.id })
        // Back and forth, which is what moving between two entries of the sidebar does.
        yield* sessions.append(first.id, 'parser one')
        yield* sessions.append(second.id, 'printer one')
        yield* sessions.append(first.id, 'parser two')
        return [yield* threadOf(first.id), yield* threadOf(second.id)] as const
      }),
    )

    expect(parser.map((entry) => entry.body)).toEqual(['parser one', 'parser two'])
    expect(printer.map((entry) => entry.body)).toEqual(['printer one'])
    // Each Session numbers its own thread, so both start at one.
    expect(parser.map((entry) => entry.seq)).toEqual([1, 2])
    expect(printer.map((entry) => entry.seq)).toEqual([1])
  })
})

describe('Les tests des Sessions tournent sur un dossier temporaire', () => {
  test('the data folder this suite wrote to is under the temporary directory it made', () => {
    expect(dataFolder.startsWith(tmpdir())).toBe(true)
  })
})
