/**
 * What can be done to a Session, and what is refused (design D4b-01 … D4b-06).
 *
 * Each suite is named after the scenario of the ticket's `Spec · sessions` it covers. Every one
 * of them runs on a data folder made for it under the temporary directory, migrated by the
 * migrations the application really ships, and each `opened()` call is one run of the process:
 * the layer is built again, on the same file, which is what a restart is to a database.
 *
 * Nothing here touches a folder of this machine. The thread is the user's alone — no provider,
 * no agent, no simulated answer — and that is not asserted: it is what the service is.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import {
  type AgentProvider,
  NEW_SESSION_TITLE,
  NoActiveProjectError,
  NoAgentError,
} from '@hemera/core'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { DatabaseError, SqliteClient, databaseLayer } from '#engine/storage/database.ts'
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

/**
 * A data folder opened and migrated, with both services standing on it.
 *
 * Called twice, it is a second run of the application: the layers are built again and the
 * database is opened again, which is the closest a test gets to a restart.
 */
function opened() {
  const services = Layer.mergeAll(projectsLayer, sessionsLayer).pipe(
    Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite'))),
  )
  return <A, E>(program: Effect.Effect<A, E, Projects | Sessions | SqliteClient>) =>
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

/** One Project, created the way the Dialog creates one. */
const atlas = Effect.gen(function* () {
  const projects = yield* Projects
  return yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: '/tmp/atlas' })
})

/** One Session in it, created the way the interface creates one: with the agent it will run. */
const sessionIn = (projectId: string, provider: AgentProvider = 'claude') =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.create(projectId, provider)
  })

/**
 * What these suites wrote to the journal about Sessions, oldest first.
 *
 * Of the Sessions: the line the profile writes when it is opened is written by the opening and
 * not by a use case, and is the subject of `migrate.test.ts`.
 */
const recorded = Effect.gen(function* () {
  const sql = yield* SqliteClient
  return yield* sql<{ type: string; entity_id: string; session_id: string }>`
    SELECT type, entity_id, session_id FROM domain_events
    WHERE entity_kind = 'session' ORDER BY sequence`
})

/** How many rows a table holds, for the claims that are about what was *not* written. */
const rowsIn = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    const rows = yield* sql.unsafe<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
    return rows[0]?.n ?? 0
  })

describe('Création dans un Projet', () => {
  test('a Session is created in the active Project and appears in the sidebar of that Project', async () => {
    const [project, session, listed] = await opened()(
      Effect.gen(function* () {
        const created = yield* atlas
        const one = yield* sessionIn(created.id)
        const sessions = yield* Sessions
        return [created, one, yield* sessions.list(created.id)] as const
      }),
    )

    expect(session.projectId).toBe(project.id)
    expect(session.title).toBe(NEW_SESSION_TITLE)
    expect(session.titleSource).toBe('derived')
    expect(session.archivedAt).toBeNull()
    expect(session.version).toBe(1)
    expect(listed.map((one) => one.id)).toEqual([session.id])
  })

  test('the Session belongs to a Project and to nothing else: no Spec, no Workspace', async () => {
    await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        yield* sessionIn(project.id)
      }),
    )

    // A Workspace is what a Project is born with, and creating a Session adds no second one.
    const spaces = await opened()(
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ name: string }>`SELECT name FROM workspaces`
      }),
    )
    expect(spaces.map((row) => row.name)).toEqual(['main'])
  })
})

describe('Aucun Projet actif', () => {
  test('creating a Session without a Project is refused, and no Project is created quietly', async () => {
    const refused = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        return yield* Effect.flip(sessions.create(null))
      }),
    )

    expect(refused).toBeInstanceOf(NoActiveProjectError)
    expect(refused.message).toContain('select one before creating a session')
    // The refusal is what the interface shows: a Project invented to have somewhere to put the
    // Session would be a Project the user never asked for.
    expect(await opened()(rowsIn('projects'))).toBe(0)
  })
})

describe('Session sans agent', () => {
  test('a Session cannot start without an agent, and nothing is written about one', async () => {
    const refused = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        return yield* Effect.flip(sessions.create(project.id))
      }),
    )

    expect(refused).toBeInstanceOf(NoAgentError)
    expect(refused.message).toContain('choose one before creating a session')
    // The refusal is what the interface shows, and the Session it refused does not exist: the
    // thread of an agentless Session is the user's words with nobody to answer them.
    expect(await opened()(rowsIn('sessions'))).toBe(0)
    expect(await opened()(rowsIn('session_entries'))).toBe(0)
  })
})

describe('Message enregistré', () => {
  test('a message is written into the thread and read back from it, and its event names it', async () => {
    const [written, page, events] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        const appended = yield* sessions.append(session.id, '  Fix the CSV export  ')
        return [appended, yield* sessions.read(session.id), yield* recorded] as const
      }),
    )

    expect(written.entry.seq).toBe(1)
    expect(written.entry.role).toBe('user')
    // What the user sent is what is read back, and what carries nothing on either side of it is
    // not part of what they sent.
    expect(written.entry.body).toBe('Fix the CSV export')
    expect(page.entries.map((entry) => entry.body)).toEqual(['Fix the CSV export'])
    expect(page.nextBefore).toBeNull()
    expect(events.map((event) => event.type)).toEqual([
      'session.created',
      'session.message_recorded',
    ])
    // Correlated to its Session, which is what "each correlated to its Session" asks for.
    expect(events.every((event) => event.session_id === written.entry.sessionId)).toBe(true)
  })

  test('the Session it was written into comes back with the date it was last written', async () => {
    const [before, after] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        const written = yield* sessions.append(session.id, 'The first thing I said')
        return [session, written.session] as const
      }),
    )

    expect(before.lastWrittenAt).toBeLessThanOrEqual(after.lastWrittenAt)
    // And it comes back at the version it was read at: no version is taken by a message, and
    // none is handed out by one — what the Session *is* has not changed (D4b-02).
    expect(after.version).toBe(before.version)
  })

  test('an empty message is refused and writes nothing', async () => {
    const [refused, page] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        const empty = yield* Effect.flip(sessions.append(session.id, '   \n  '))
        return [empty, yield* sessions.read(session.id)] as const
      }),
    )

    expect(refused).toBeInstanceOf(Error)
    expect(refused.message).toContain('an empty message is not recorded')
    expect(page.entries).toEqual([])
  })
})

describe('Ordre des messages', () => {
  test('messages written in a burst are read back in the order they were recorded', async () => {
    const bodies = ['one', 'two', 'three', 'four', 'five']
    const [seqs, page] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        const seen: number[] = []
        for (const body of bodies) {
          const written = yield* sessions.append(session.id, body)
          seen.push(written.entry.seq)
        }
        return [seen, yield* sessions.read(session.id)] as const
      }),
    )

    // Five writes in the same millisecond are five messages in a decided order: `seq` is what
    // orders a thread, and `created_at` is not.
    expect(seqs).toEqual([1, 2, 3, 4, 5])
    expect(page.entries.map((entry) => entry.body)).toEqual(bodies)
  })

  test('a thread longer than one page is read from its end, and walks back up by cursor', async () => {
    const bodies = Array.from({ length: 7 }, (_, index) => `line ${index + 1}`)
    const [last, earlier] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        for (const body of bodies) yield* sessions.append(session.id, body)
        const newest = yield* sessions.read(session.id, undefined, 3)
        return [
          newest,
          yield* sessions.read(session.id, newest.nextBefore ?? undefined, 3),
        ] as const
      }),
    )

    // The page opens on what was written last, oldest first inside itself.
    expect(last.entries.map((entry) => entry.body)).toEqual(['line 5', 'line 6', 'line 7'])
    expect(last.nextBefore).toBe(5)
    expect(earlier.entries.map((entry) => entry.body)).toEqual(['line 2', 'line 3', 'line 4'])
    expect(earlier.nextBefore).toBe(2)
  })
})

describe('Échec d’enregistrement', () => {
  test('a message that could not be written is not kept, and nothing says it was', async () => {
    const [refused, page, events] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        const sql = yield* SqliteClient
        // A data folder that refuses to be written to: a read-only profile, a disk that went
        // away. The house is made read-only rather than the failure being simulated.
        yield* sql`PRAGMA query_only = 1`
        const attempt = yield* Effect.flip(sessions.append(session.id, 'this one will not land'))
        yield* sql`PRAGMA query_only = 0`
        return [attempt, yield* sessions.read(session.id), yield* recorded] as const
      }),
    )

    expect(refused).toBeInstanceOf(DatabaseError)
    // The write left nothing behind: no entry in the thread, and no event claiming one.
    expect(page.entries).toEqual([])
    expect(events.map((event) => event.type)).toEqual(['session.created'])
  })

  test('a write into a Session that does not exist is refused rather than written anywhere', async () => {
    const refused = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        return yield* Effect.flip(sessions.append('0193f0f0-0000-7000-8000-000000000000', 'hello'))
      }),
    )

    expect(refused.name).toBe('UnknownSessionError')
    expect(refused.message).toContain('no Session has the identifier')
  })
})

describe('Titre dérivé du premier message', () => {
  test('the first message names the Session, cut on a word at sixty characters', async () => {
    const [written, listed] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        const appended = yield* sessions.append(
          session.id,
          'The CSV export drops the invoice date on every second row and nothing says why',
        )
        return [appended, yield* sessions.list(project.id)] as const
      }),
    )

    expect(written.session.titleSource).toBe('derived')
    // Sixty characters cut on a word, and said to be cut: the message is longer than this.
    expect(written.session.title).toBe('The CSV export drops the invoice date on every second row…')
    expect(listed[0]?.title).toBe(written.session.title)
  })

  test('a title proposed once is not proposed again by the message after it', async () => {
    const [first, second] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        const firstWrite = yield* sessions.append(session.id, 'The first message')
        const secondWrite = yield* sessions.append(
          session.id,
          'A second thought about something else',
        )
        return [firstWrite, secondWrite] as const
      }),
    )

    expect(first.session.title).toBe('The first message')
    expect(second.session.title).toBe('The first message')
  })
})

describe('Renommage conservé', () => {
  test('a Session renamed by the user keeps its name when messages arrive after it', async () => {
    const [renamed, written, events] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        const named = yield* sessions.rename(session.id, session.version, 'Invoices')
        const appended = yield* sessions.append(session.id, 'A message that will not rename it')
        return [named, appended, yield* recorded] as const
      }),
    )

    expect(renamed.title).toBe('Invoices')
    expect(renamed.titleSource).toBe('user')
    expect(written.session.title).toBe('Invoices')
    // The Journal says what the name was and what it became, which is what a rename is worth
    // reading back for.
    const rename = events.find((event) => event.type === 'session.renamed')
    expect(rename?.session_id).toBe(renamed.id)
  })

  test('a title that carries nothing is refused, and the Session keeps the one it had', async () => {
    const [refused, held] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        const empty = yield* Effect.flip(sessions.rename(session.id, session.version, '   '))
        return [empty, yield* sessions.list(project.id)] as const
      }),
    )

    expect(refused.message).toContain('a session keeps a name')
    expect(held[0]?.title).toBe(NEW_SESSION_TITLE)
    expect(held[0]?.version).toBe(1)
  })

  test('a title written at the Session it was read at is refused once another write has moved it', async () => {
    const refused = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        // A rename is a change to what the Session is, and it is what moves the version on; a
        // message written into the thread is not one and moves nothing.
        yield* sessions.rename(session.id, session.version, 'One window')
        // The two windows case: the second one still believes it is at version 1.
        return yield* Effect.flip(sessions.rename(session.id, session.version, 'Two windows'))
      }),
    )

    expect(refused).toBeInstanceOf(StaleVersionError)
  })
})

describe('Session sans message', () => {
  test('a Session with nothing in it carries a title of its own and can still be renamed', async () => {
    const [created, renamed] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        return [session, yield* sessions.rename(session.id, session.version, 'Later')] as const
      }),
    )

    expect(created.title).toBe(NEW_SESSION_TITLE)
    expect(created.lastWrittenAt).toBe(created.createdAt)
    expect(renamed.title).toBe('Later')
  })
})

describe('Session archivée puis restaurée', () => {
  test('archiving hides it from the current list, the archive view holds it, restoring brings it back whole', async () => {
    const [archived, current, kept, restored, page] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        yield* sessions.append(session.id, 'A message that must survive the archive')
        const put = yield* sessions.archive(session.id, session.version)
        return [
          put,
          yield* sessions.list(project.id),
          yield* sessions.list(project.id, true),
          yield* sessions.restore(session.id, put.version),
          yield* sessions.read(session.id),
        ] as const
      }),
    )

    expect(archived.archivedAt).not.toBeNull()
    expect(current).toEqual([])
    expect(kept.map((one) => one.id)).toEqual([archived.id])
    expect(restored.archivedAt).toBeNull()
    // Whole: the thread is where it was, in its order.
    expect(page.entries.map((entry) => entry.body)).toEqual([
      'A message that must survive the archive',
    ])
  })

  test('an archived Session is still archived after a restart, and its thread is intact', async () => {
    const id = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        yield* sessions.append(session.id, 'Written before the archive')
        yield* sessions.archive(session.id, session.version)
        return session.id
      }),
    )

    // A second run of the application, on the same data folder.
    const [current, kept, page] = await opened()(
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const project = yield* sql<{ project_id: string }>`
          SELECT project_id FROM sessions WHERE id = ${id}`
        const sessions = yield* Sessions
        const projectId = project[0]?.project_id ?? ''
        return [
          yield* sessions.list(projectId),
          yield* sessions.list(projectId, true),
          yield* sessions.read(id),
        ] as const
      }),
    )

    expect(current).toEqual([])
    expect(kept.map((one) => one.id)).toEqual([id])
    expect(kept[0]?.archivedAt).not.toBeNull()
    expect(page.entries.map((entry) => entry.body)).toEqual(['Written before the archive'])
  })
})

/**
 * What a window holds of a Session after the thread was written into (design D4b-02, D4b-06).
 *
 * The version is what a change to the Session itself is refused against, and a window writes
 * against the one it was handed: a message that moved it would make the archive, the rename and
 * the choice of an agent refuse every Session that has been used — which is every Session there
 * is once somebody has said something.
 */
describe('Une Session utilisée reste archivable', () => {
  test('A Session can be archived after a message was written', async () => {
    const [created, archived] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        yield* sessions.append(session.id, 'Have a look at the reader')
        // The window still holds the Session it created, at the version it was created with.
        return [session, yield* sessions.archive(session.id, session.version)] as const
      }),
    )

    expect(created.version).toBe(1)
    expect(archived.archivedAt).not.toBeNull()
    expect(archived.version).toBe(2)
  })

  test('two messages leave the version where the Session was read at', async () => {
    const [before, after] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        yield* sessions.append(session.id, 'One')
        yield* sessions.append(session.id, 'Two')
        const held = yield* sessions.list(project.id)
        return [session, held[0]] as const
      }),
    )

    expect(after?.version).toBe(before.version)
  })
})

describe('Aucune suppression proposée', () => {
  test('the service offers nothing that removes a Session, and nothing that removes a message', async () => {
    const offered = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        return Object.keys(sessions)
      }),
    )

    // Archiving is the only end a Session has, and the guarantee is that no use case could be
    // made to do the other thing: what is not offered cannot be asked for.
    expect(offered.toSorted()).toEqual([
      'append',
      'archive',
      'chooseAgent',
      'create',
      'list',
      'one',
      'read',
      'recordNative',
      'rename',
      'restore',
      'write',
    ])
  })
})

describe('Deux Sessions retrouvées', () => {
  test('two Sessions with their own messages are both found after a restart, each in its order', async () => {
    const ids = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const first = yield* sessionIn(project.id)
        const second = yield* sessionIn(project.id)
        for (const body of ['first one', 'first two']) yield* sessions.append(first.id, body)
        for (const body of ['second one', 'second two', 'second three']) {
          yield* sessions.append(second.id, body)
        }
        return [first.id, second.id] as const
      }),
    )

    const [listed, first, second] = await opened()(
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const held = yield* sql<{ project_id: string }>`SELECT project_id FROM sessions LIMIT 1`
        const sessions = yield* Sessions
        const projectId = held[0]?.project_id ?? ''
        return [
          yield* sessions.list(projectId),
          yield* sessions.read(ids[0]),
          yield* sessions.read(ids[1]),
        ] as const
      }),
    )

    expect(listed.map((one) => one.id).toSorted()).toEqual([...ids].toSorted())
    // Written last is listed first, which is the order of the sidebar (design D4b-04).
    expect(listed.map((one) => one.id)).toEqual([ids[1], ids[0]])
    expect(first.entries.map((entry) => entry.body)).toEqual(['first one', 'first two'])
    expect(second.entries.map((entry) => entry.body)).toEqual([
      'second one',
      'second two',
      'second three',
    ])
  })
})

describe('Travaux parallèles', () => {
  test('two Sessions of the same Project keep their own threads and their own names', async () => {
    const [one, two] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const firstOne = yield* sessionIn(project.id)
        const secondOne = yield* sessionIn(project.id)
        yield* sessions.append(firstOne.id, 'The invoice export')
        yield* sessions.append(secondOne.id, 'The bank statement import')
        yield* sessions.append(firstOne.id, 'And its totals')
        return [yield* sessions.read(firstOne.id), yield* sessions.read(secondOne.id)] as const
      }),
    )

    expect(one.entries.map((entry) => entry.body)).toEqual(['The invoice export', 'And its totals'])
    expect(two.entries.map((entry) => entry.body)).toEqual(['The bank statement import'])
  })

  test('a rename counts as a write: the renamed Session comes back to the top of the list', async () => {
    const [ids, before, after] = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const first = yield* sessionIn(project.id)
        const second = yield* sessionIn(project.id)
        yield* sessions.append(second.id, 'Written last')
        const earlier = yield* sessions.list(project.id)
        yield* sessions.rename(first.id, 1, 'Back to the top')
        return [[first.id, second.id], earlier, yield* sessions.list(project.id)] as const
      }),
    )

    // Written last is listed first, and a rename is a write: the one just named is on top.
    expect(before.map((one) => one.id)).toEqual([ids[1], ids[0]])
    expect(after.map((one) => one.id)).toEqual([ids[0], ids[1]])
    expect(after[0]?.title).toBe('Back to the top')
  })
})

describe('Arrêt brutal', () => {
  test('a message that was recorded is found again by the next launch', async () => {
    const id = await opened()(
      Effect.gen(function* () {
        const project = yield* atlas
        const sessions = yield* Sessions
        const session = yield* sessionIn(project.id)
        yield* sessions.append(session.id, 'Written, and then the window went away')
        return session.id
      }),
    )

    // Nothing closed the data folder politely: the second run opens the same file and finds it.
    const page = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        return yield* sessions.read(id)
      }),
    )

    expect(page.entries.map((entry) => entry.body)).toEqual([
      'Written, and then the window went away',
    ])
  })
})

describe("L'agent d'une Session", () => {
  test('the agent and the model are shown, and the next start reads them from the Session', async () => {
    const found = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const project = yield* atlas
        const created = yield* sessions.create(project.id, 'codex')
        const chosen = yield* sessions.chooseAgent(created.id, created.version, {
          provider: 'claude',
          model: 'claude-sonnet-4-5',
        })
        return { created, chosen }
      }),
    )

    // A Session is made with the agent it runs and holds it from the row (design D5-06); the
    // model is nobody's yet, and says so by holding nothing rather than by naming one the agent
    // was never asked for.
    expect(found.created.provider).toBe('codex')
    expect(found.created.model).toBeNull()
    expect(found.chosen.provider).toBe('claude')
    expect(found.chosen.model).toBe('claude-sonnet-4-5')
    expect(found.chosen.version).toBe(found.created.version + 1)

    // Which agent a Session talks to is what the engine reads when it starts one, so it has to
    // outlive the window that chose it: read again, on a second run of the process.
    const again = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const seen = yield* sessions.list(found.chosen.projectId)
        return seen[0]
      }),
    )
    expect(again?.provider).toBe('claude')
    expect(again?.model).toBe('claude-sonnet-4-5')
  })

  test('a write against a version that has moved on is refused', async () => {
    const refused = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const project = yield* atlas
        const created = yield* sessions.create(project.id, 'claude')
        // Two windows, both holding the same Session: the second one chooses the agent, and
        // the first one's choice was written against a Session that no longer is that one.
        yield* sessions.chooseAgent(created.id, created.version, {
          provider: 'claude',
          model: null,
        })
        return {
          projectId: project.id,
          // The two windows case, said the way the other refusals are.
          written: yield* Effect.flip(
            sessions.chooseAgent(created.id, created.version, { provider: 'codex', model: null }),
          ),
        }
      }),
    )

    expect(refused.written).toBeInstanceOf(StaleVersionError)
    const kept = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const seen = yield* sessions.list(refused.projectId)
        return seen.map((session) => session.provider)
      }),
    )
    expect(kept).toEqual(['claude'])
  })
})

describe('Le fil que l’agent écrit', () => {
  test('a tool call is one entry in a later state, not a second entry beside it', async () => {
    const thread = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const project = yield* atlas
        const created = yield* sessions.create(project.id, 'claude')
        yield* sessions.write(created.id, {
          role: 'agent',
          kind: 'tool_call',
          body: 'Read parser.ts',
          payload: '{"tool":"read","status":"in_progress"}',
          correlationId: 'call-1',
          turnId: 'turn-1',
          state: 'in_progress',
        })
        yield* sessions.write(created.id, {
          role: 'agent',
          kind: 'tool_call',
          body: 'Read parser.ts',
          payload: '{"tool":"read","status":"completed"}',
          correlationId: 'call-1',
          turnId: 'turn-1',
          state: 'completed',
        })
        yield* sessions.write(created.id, {
          role: 'agent',
          kind: 'message',
          body: 'The parser drops the last line.',
          turnId: 'turn-1',
        })
        return yield* sessions.read(created.id)
      }),
    )

    // Two writes, one entry: the second found it by what it was about.
    expect(thread.entries).toHaveLength(2)
    expect(thread.entries[0]?.kind).toBe('tool_call')
    expect(thread.entries[0]?.seq).toBe(1)
    expect(thread.entries[0]?.state).toBe('completed')
    expect(thread.entries[0]?.payload).toBe('{"tool":"read","status":"completed"}')
    expect(thread.entries[0]?.role).toBe('agent')
    // And the message that followed it is the next one in the same thread.
    expect(thread.entries[1]?.kind).toBe('message')
    expect(thread.entries[1]?.seq).toBe(2)
    expect(thread.entries[1]?.payload).toBe('{}')
    expect(thread.entries[1]?.turnId).toBe('turn-1')
  })

  test('what the agent handed back is kept with the Session, and Hemera is who wrote it', async () => {
    const keptNative = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const project = yield* atlas
        const created = yield* sessions.create(project.id, 'claude')
        yield* sessions.chooseAgent(created.id, created.version, {
          provider: 'codex',
          model: null,
        })
        const attached = yield* sessions.recordNative(created.id, {
          nativeSessionId: 'native-9',
          nativeState: 'attached',
          cwd: '/tmp/atlas',
        })
        const lost = yield* sessions.recordNative(created.id, {
          nativeSessionId: 'native-9',
          nativeState: 'lost',
          cwd: '/tmp/atlas',
        })
        return { attached, lost }
      }),
    )

    // The version is not touched by what the engine writes: a running agent must not be able
    // to refuse a rename the user is making at the same time.
    expect(keptNative.attached.version).toBe(keptNative.lost.version)
    const readBack = await opened()(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const seen = yield* sessions.list(keptNative.lost.projectId)
        return seen[0]
      }),
    )
    expect(readBack?.nativeState).toBe('lost')
  })
})
