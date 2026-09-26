/**
 * What opening a data folder does to it, and what it refuses to do (design D3-05).
 *
 * Each suite is named after the scenario of `specs/profile-storage/spec.md` it covers. Every
 * one of them works in a folder made for it and removed after it: the migrations are read from
 * a folder the test wrote, and the database is a file under a temporary directory. No data folder
 * of this machine is opened, migrated or backed up — the last suite is there to say so.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Exit } from 'effect'

import { dataDirectory } from '#main/channel.ts'
import {
  BACKUPS_FOLDER,
  MigrationError,
  ProfileAheadError,
  carriedMigrations,
  openProfile,
  standingOf,
} from '#engine/migrate.ts'
import { type Database, SqliteClient, databaseLayer } from '#engine/storage/database.ts'

/** The migration this application really ships, which is what a real start would read. */
const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

/**
 * The one migration lot 3 shipped, which is what a profile of that version carries.
 *
 * It is the real folder, copied rather than rewritten: a fixture of the previous version that
 * was typed out by hand would be a fixture of what the previous version was believed to be.
 */
const LOT_THREE = '20260916123330_profile_and_preferences'

/**
 * The migration lot 4a shipped, which is what a profile of the version before this one carries.
 *
 * One lot behind, and not two: the fixture that matters for this lot is the one the users have,
 * which is the one the previous package wrote.
 */
const LOT_FOUR_A = '20260918102229_projects_and_journal'

/**
 * The migration lot 4b shipped, which is what a profile of the version before this one carries.
 *
 * One lot behind again, for the same reason: a profile of the users is the one the previous
 * package wrote, and this lot is the one that has to open it.
 */
const LOT_FOUR_B = '20260920001303_sessions_and_entries'

/** The migration lot 5 added: the one a profile of lot 4b has never heard of. */
const AGENTS_MIGRATION = '20260921133441_sessions_with_agents'

/**
 * The migration this lot adds: the one a profile of lot 5 has never heard of.
 *
 * It is named after what it brings rather than after a lot number, as the others are, because
 * what it brings is three tables and a wider set of entry kinds rather than a page.
 */
const TOOLS_MIGRATION = '20260922075631_tools_commands_and_context'
/** The migration lot 19 adds, the Specs (design D7-01): one a profile of lot 5 has never run. */
const SPECS_MIGRATION = '20260924122302_specs'

/**
 * The migration lot 20 adds, after the Specs: the one a profile of lot 19 has never heard of —
 * the Workspaces, their steps and variables, the commands typed by seven types (D8-01, D8-05,
 * D8-06, D8-07), and the launches with the revision a `build` Session was started on (D8-13).
 */
const WORKSPACES_MIGRATION = '20260924223401_workspaces'

/**
 * The migration lot 22 adds, after the Workspaces': the one a profile of lot 20 has never heard
 * of — the build's phase and approach note on its Session, its tasks, attempts, snapshots, changed
 * files, check results and blockers, the Project's checks, and the `task` lines of the Journal
 * (D10-01, D10-05, D10-06, D10-14).
 */
const BUILD_MIGRATION = '20260925073422_build'
/** Lot 5e (issue #117): the stamp a build waits under while the user reviews it. */
const REVIEW_MIGRATION = '20260926030019_review'

/** A folder carrying the shipped migrations up to one of them, as an older version did. */
function shippedUpTo(last: string): string {
  const folder = join(workspace, `shipped-${last}`)
  for (const migration of readdirSync(SHIPPED)) {
    cpSync(join(SHIPPED, migration), join(folder, migration), { recursive: true })
    if (migration === last) break
  }
  return folder
}

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'hemera-migrate-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

/** The file a data folder keeps its database in, under the folder this test was given. */
function databaseFile(dataFolder: string): string {
  mkdirSync(dataFolder, { recursive: true })
  return join(dataFolder, 'hemera.sqlite')
}

/** Runs a program against one database file, and closes it before answering. */
async function on<A, E>(
  dataFolder: string,
  program: Effect.Effect<A, E, Database | SqliteClient>,
): Promise<A> {
  return await Effect.runPromise(
    Effect.scoped(Effect.provide(program, databaseLayer(databaseFile(dataFolder)))),
  )
}

/** The same, for a program expected to fail: its refusal is the answer, typed as it was raised. */
async function refusalOn<A, E>(
  dataFolder: string,
  program: Effect.Effect<A, E, Database | SqliteClient>,
): Promise<E> {
  return await on(dataFolder, Effect.flip(program))
}

/**
 * The one table every data folder has from its first migration, whatever else a test adds.
 *
 * A folder of migrations that did not create it would be a data folder the application cannot
 * write down its own version in, which is not a case worth testing because it cannot ship.
 */
const PROFILE_TABLE = [
  'CREATE TABLE `profile` (',
  '\t`id` integer PRIMARY KEY,',
  '\t`written_by_version` text NOT NULL,',
  '\t`last_opened_at` text NOT NULL,',
  '\tCONSTRAINT "profile_is_one_row" CHECK("id" = 1)',
  ');',
].join('\n')

/** A folder of migrations written for one test, in the layout the migrator reads. */
function migrationsFolder(...migrations: string[]): string {
  const folder = join(workspace, `migrations-${migrations.length}-${folders.toString()}`)
  folders += 1
  migrations.forEach((sql, rank) => {
    const stamp = `2026091612000${rank}`
    const directory = join(folder, `${stamp}_migration_${rank}`)
    mkdirSync(directory, { recursive: true })
    const first = rank === 0 ? `${PROFILE_TABLE}\n--> statement-breakpoint\n` : ''
    writeFileSync(join(directory, 'migration.sql'), `${first}${sql}`)
  })
  return folder
}

/** Tells one folder of migrations from the next, so two of them never collide in a test. */
let folders = 0

/**
 * Everything the data folder's schema is made of, asked of the database itself.
 *
 * Tables and indexes both, because a lot that adds an index adds something a profile migrated
 * up to it must have too, and a comparison that only looked at tables would not notice.
 */
const schemaOf = Effect.gen(function* () {
  const sql = yield* SqliteClient
  const rows = yield* sql<{ name: string; sql: string | null }>`
    SELECT name, sql FROM sqlite_master
    WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
    ORDER BY name`
  return rows.map((row) => `${row.name}: ${row.sql ?? ''}`)
})

describe('Un profil neuf reçoit le schéma complet', () => {
  test('a data folder that has never been opened is created with every migration applied', async () => {
    const dataFolder = join(workspace, 'fresh')
    const standing = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.3.0'))

    expect(standing.ahead).toEqual([])
    expect(standing.behind).toEqual(carriedMigrations(SHIPPED).map((one) => one.name))

    const tables = await on(dataFolder, schemaOf)
    expect(tables.join('\n')).toContain('app_preferences')
    expect(tables.join('\n')).toContain('profile')
  })

  test('opening it again finds nothing left to do', async () => {
    const dataFolder = join(workspace, 'twice')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.3.0'))
    const again = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.3.0'))

    expect(again.behind).toEqual([])
    expect(again.ahead).toEqual([])
  })
})

describe('Neuf et migré donnent le même schéma', () => {
  test('a data folder created by this version and one migrated up to it are the same', async () => {
    const two = migrationsFolder(
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
      'CREATE TABLE `added` (`id` integer PRIMARY KEY);',
    )

    // One data folder walks both migrations from empty, as a new one does.
    const fresh = join(workspace, 'fresh')
    await on(fresh, openProfile(fresh, two, '0.3.0'))

    // The other is opened at the first migration, then brought up by the second.
    const one = migrationsFolder('CREATE TABLE `kept` (`id` integer PRIMARY KEY);')
    const migrated = join(workspace, 'migrated')
    await on(migrated, openProfile(migrated, one, '0.2.0'))
    await on(migrated, openProfile(migrated, two, '0.3.0'))

    expect(await on(migrated, schemaOf)).toEqual(await on(fresh, schemaOf))
  })

  test('the migrations this application ships agree the same way', async () => {
    // The same claim, on what really ships rather than on a folder written for the test: a
    // profile created today, and a profile of lot 3 brought up to today.
    const fresh = join(workspace, 'fresh-shipped')
    await on(fresh, openProfile(fresh, SHIPPED, '0.4.0'))

    const migrated = join(workspace, 'migrated-shipped')
    await on(migrated, openProfile(migrated, shippedUpTo(LOT_THREE), '0.3.0'))
    await on(migrated, openProfile(migrated, SHIPPED, '0.4.0'))

    expect(await on(migrated, schemaOf)).toEqual(await on(fresh, schemaOf))
  })
})

describe('Ouverture tracée', () => {
  test('opening a profile writes the migration too, and nothing it did not do', async () => {
    const dataFolder = join(workspace, 'just-opened')
    // A first launch runs every migration there is, so it says so. What it does not do is back
    // anything up: there was nothing in the folder to take a copy of.
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.0'))
    // Opened again, with nothing to do: the second opening is one more line and no migration.
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.0'))

    const entries = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ type: string; payload: string }>`
          SELECT type, payload FROM domain_events ORDER BY sequence`
      }),
    )
    expect(entries.map((entry) => entry.type)).toEqual([
      'profile.opened',
      'profile.migrated',
      'profile.opened',
    ])
    // A profile that has never held anything is not backed up, so nothing says it was.
    expect(entries.some((entry) => entry.type === 'profile.backed_up')).toBe(false)
    expect(JSON.parse(entries[0]!.payload)).toEqual({ version: '0.4.0' })
  })
})

describe('Un profil du lot 3 est migré vers le lot 4', () => {
  test('a profile carrying only the lot 3 migration is backed up, migrated and kept whole', async () => {
    const dataFolder = join(workspace, 'from-lot-three')
    await on(dataFolder, openProfile(dataFolder, shippedUpTo(LOT_THREE), '0.3.0'))

    // Something the user had before the migration, so that what survives it can be named.
    await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO app_preferences (key, value) VALUES ('theme', '"dark"')`
      }),
    )

    const standing = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.0'))

    // Everything this version carries after the one the fixture was opened at, in the order it
    // runs them: the Projects, and the Sessions this lot adds.
    const carried = carriedMigrations(SHIPPED)
    const from = carried.findIndex((one) => one.name === LOT_THREE)
    expect(standing.behind).toEqual(carried.slice(from + 1).map((one) => one.name))
    // One copy, taken before the first of them: a profile is backed up once per opening and not
    // once per migration.
    expect(readdirSync(join(dataFolder, BACKUPS_FOLDER))).toEqual([`${standing.behind[0]!}.sqlite`])

    // The domain arrived...
    const schema = (await on(dataFolder, schemaOf)).join('\n')
    for (const table of ['projects', 'workspaces', 'project_repositories', 'domain_events']) {
      expect(schema).toContain(table)
    }

    // ...and nothing of lot 3 left with it.
    const kept = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ value: string }>`SELECT value FROM app_preferences WHERE key = 'theme'`
      }),
    )
    expect(kept[0]?.value).toBe('"dark"')

    // And the Journal says what was done to their data, in the order it was done.
    const entries = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ type: string; author: string }>`
          SELECT type, author FROM domain_events ORDER BY sequence`
      }),
    )
    expect(entries.map((entry) => entry.type)).toEqual([
      'profile.opened',
      'profile.backed_up',
      'profile.migrated',
    ])
    expect(entries.every((entry) => entry.author === 'hemera')).toBe(true)
  })
})

describe('Un profil du lot 4a est migré vers le lot 4b', () => {
  test('a profile carrying the Projects and the Journal gains the Sessions and keeps what it had', async () => {
    const dataFolder = join(workspace, 'from-lot-four-a')
    await on(dataFolder, openProfile(dataFolder, shippedUpTo(LOT_FOUR_A), '0.4.0'))

    // Something the user had before the migration, so that what survives it can be named.
    await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', '2026-09-18T10:00:00.000Z', '2026-09-18T10:00:00.000Z', 1)`
      }),
    )

    const standing = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.1'))

    // The migrations this version carries after the one the fixture was opened at: the copy is
    // named after the first of them, and both are on it.
    const carried = carriedMigrations(SHIPPED)
    const from = carried.findIndex((one) => one.name === LOT_FOUR_A)
    expect(standing.behind).toEqual(carried.slice(from + 1).map((one) => one.name))
    expect(readdirSync(join(dataFolder, BACKUPS_FOLDER))).toEqual([`${standing.behind[0]!}.sqlite`])

    // The Sessions arrived...
    const schema = (await on(dataFolder, schemaOf)).join('\n')
    for (const table of ['sessions', 'session_entries']) {
      expect(schema).toContain(table)
    }

    // ...and the Project the user had is still there, with an empty thread beside it.
    const kept = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const projects = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = 'atlas'`
        const sessions = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM sessions`
        return { name: projects[0]?.name, sessions: sessions[0]?.n }
      }),
    )
    expect(kept.name).toBe('Atlas')
    expect(kept.sessions).toBe(0)
  })
})

describe('Un profil du lot 4b est migré vers le lot 5', () => {
  test('the migration keeps existing Sessions', async () => {
    const dataFolder = join(workspace, 'from-lot-four-b')
    await on(dataFolder, openProfile(dataFolder, shippedUpTo(LOT_FOUR_B), '0.4.1'))

    // A Session the user had, with a message in it: neither may be lost by this lot.
    await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', '2026-09-20T10:00:00.000Z', '2026-09-20T10:00:00.000Z', 1)`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, created_at, last_written_at, version)
          VALUES ('session-1', 'atlas', 'Fix the parser', 'derived', '2026-09-20T10:00:00.000Z', '2026-09-20T10:01:00.000Z', 1)`
        yield* sql`INSERT INTO session_entries (id, session_id, seq, role, body, created_at)
          VALUES ('entry-1', 'session-1', 1, 'user', 'the parser drops the last line', '2026-09-20T10:01:00.000Z')`
      }),
    )

    const standing = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.5.0'))

    // Behind by this migration and those after it, and the copy is named after the first.
    const carried = carriedMigrations(SHIPPED)
    const from = carried.findIndex((one) => one.name === LOT_FOUR_B)
    expect(standing.behind).toEqual(carried.slice(from + 1).map((one) => one.name))
    expect(readdirSync(join(dataFolder, BACKUPS_FOLDER))).toEqual([`${AGENTS_MIGRATION}.sqlite`])

    // The agent columns arrived...
    const schema = (await on(dataFolder, schemaOf)).join('\n')
    for (const column of ['native_session_id', 'native_state', 'entry_kind_is_known']) {
      expect(schema).toContain(column)
    }

    // ...and the Session the user had is still there, its thread intact.
    const kept = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const sessions = yield* sql<{
          title: string
          provider: string | null
          native_state: string
          native_session_id: string | null
        }>`SELECT title, provider, native_state, native_session_id FROM sessions WHERE id = 'session-1'`
        const entries = yield* sql<{
          seq: number
          role: string
          kind: string
          body: string
          payload: string
        }>`SELECT seq, role, kind, body, payload FROM session_entries WHERE session_id = 'session-1'`
        return { session: sessions[0], entries }
      }),
    )
    expect(kept.session?.title).toBe('Fix the parser')
    // A Session nothing has talked to in does not acquire an agent by being migrated: the
    // column stays empty, because Hemera does not know what ran and will not guess.
    expect(kept.session?.provider).toBeNull()
    expect(kept.session?.native_session_id).toBeNull()
    expect(kept.session?.native_state).toBe('none')
    // The message it held is a message: the default names it, and it carries no payload.
    expect(kept.entries).toEqual([
      {
        seq: 1,
        role: 'user',
        kind: 'message',
        body: 'the parser drops the last line',
        payload: '{}',
      },
    ])
  })

  test('a Session naming an agent nobody can start, or a kind nobody draws, is refused', async () => {
    const dataFolder = join(workspace, 'checks')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.5.0'))

    // The checks this lot adds are the database's own, so they hold whatever writes: a Session
    // whose agent Hemera cannot start and an entry of a kind no reader knows are both refused
    // here rather than drawn as an empty block later.
    const refusals = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', '2026-09-21T10:00:00.000Z', '2026-09-21T10:00:00.000Z', 1)`
        const unknownProvider = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO sessions (id, project_id, title, title_source, provider, created_at, last_written_at, version)
              VALUES ('s1', 'atlas', 'T', 'derived', 'gemini', '2026-09-21T10:00:00.000Z', '2026-09-21T10:00:00.000Z', 1)`
          }),
        )
        const unknownState = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO sessions (id, project_id, title, title_source, native_state, created_at, last_written_at, version)
              VALUES ('s2', 'atlas', 'T', 'derived', 'somewhere', '2026-09-21T10:00:00.000Z', '2026-09-21T10:00:00.000Z', 1)`
          }),
        )
        const unknownKind = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO session_entries (id, session_id, seq, role, kind, body, created_at)
              VALUES ('e1', 's1', 1, 'agent', 'drawing', 'x', '2026-09-21T10:00:00.000Z')`
          }),
        )
        // And nothing of what was refused is in the database: the check is the reason the row
        // is not there, whatever the driver's own wording for it is.
        const written = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM sessions`
        return {
          refused: [unknownProvider, unknownState, unknownKind].map((exit) => Exit.isFailure(exit)),
          written: written[0]?.n,
        }
      }),
    )

    expect(refusals.refused).toEqual([true, true, true])
    expect(refusals.written).toBe(0)
  })
})

describe('A profile of lot 6 is migrated to lot 19 (specs)', () => {
  test('the migration keeps Sessions, their threads and the Journal, with the new defaults', async () => {
    const dataFolder = join(workspace, 'from-lot-six')
    await on(dataFolder, openProfile(dataFolder, shippedUpTo(TOOLS_MIGRATION), '0.5.0'))

    // A Project, a Session with an agent and two entries, and a line of the Journal: the three
    // tables this migration rebuilds, and the one it only widens.
    await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', '2026-09-22T10:00:00.000Z', '2026-09-22T10:00:00.000Z', 1)`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, provider, model, native_session_id, native_state, cwd, created_at, last_written_at, version)
          VALUES ('session-1', 'atlas', 'Fix the parser', 'derived', 'claude', 'opus', 'native-1', 'attached', '/work/atlas', '2026-09-22T10:00:00.000Z', '2026-09-22T10:02:00.000Z', 2)`
        yield* sql`INSERT INTO session_entries (id, session_id, seq, role, kind, body, payload, created_at)
          VALUES ('entry-1', 'session-1', 1, 'user', 'message', 'the parser drops the last line', '{}', '2026-09-22T10:01:00.000Z')`
        yield* sql`INSERT INTO session_entries (id, session_id, seq, role, kind, body, payload, correlation_id, created_at)
          VALUES ('entry-2', 'session-1', 2, 'agent', 'tool_call', 'Read parser.ts', '{"tool":"read"}', 'call-1', '2026-09-22T10:02:00.000Z')`
        yield* sql`INSERT INTO domain_events (type, entity_kind, entity_id, source, author, occurred_at, project_id, session_id, payload)
          VALUES ('session.created', 'session', 'session-1', 'ui', 'human', '2026-09-22T10:00:00.000Z', 'atlas', 'session-1', '{}')`
      }),
    )

    const standing = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.6.0'))

    // Behind by this migration and the two after it, the Workspaces' and the build's, and the copy
    // is named after the first.
    expect(standing.behind).toEqual([
      SPECS_MIGRATION,
      WORKSPACES_MIGRATION,
      BUILD_MIGRATION,
      REVIEW_MIGRATION,
    ])
    expect(readdirSync(join(dataFolder, BACKUPS_FOLDER))).toEqual([`${SPECS_MIGRATION}.sqlite`])

    // The Specs arrived, and the columns that tie a Project and a Session to them...
    const schema = (await on(dataFolder, schemaOf)).join('\n')
    for (const table of [
      'specs',
      'spec_revisions',
      'spec_sections',
      'user_stories',
      'acceptance_criteria',
      'task_sets',
      'spec_tasks',
      'task_dependencies',
      'task_stories',
      'spec_questions',
      'spec_phases',
      'spec_edit_buffers',
    ]) {
      expect(schema).toContain(`${table}: CREATE TABLE`)
    }
    for (const column of [
      'spec_prefix',
      'next_spec_number',
      'mission',
      'briefed_at',
      'spec_key_in_project',
      "'mission_brief'",
      "'spec_question'",
      "'spec_answer'",
      "'spec_proposal'",
      'answer_option_id',
      'answer_text',
      "`options` text DEFAULT '[]' NOT NULL",
      "'spec'",
    ]) {
      expect(schema).toContain(column)
    }

    // ...and what the user had is still there, with the defaults a profile of lot 5 is given.
    const kept = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const projects = yield* sql<{
          name: string
          spec_prefix: string
          next_spec_number: number
        }>`SELECT name, spec_prefix, next_spec_number FROM projects WHERE id = 'atlas'`
        const sessions = yield* sql<{
          title: string
          provider: string | null
          native_session_id: string | null
          native_state: string
          version: number
          mission: string
          spec_id: string | null
          briefed_at: string | null
        }>`SELECT title, provider, native_session_id, native_state, version, mission, spec_id, briefed_at
          FROM sessions WHERE id = 'session-1'`
        const entries = yield* sql<{
          seq: number
          kind: string
          payload: string
          correlation_id: string | null
        }>`SELECT seq, kind, payload, correlation_id FROM session_entries
          WHERE session_id = 'session-1' ORDER BY seq`
        const events = yield* sql<{ type: string; entity_id: string }>`
          SELECT type, entity_id FROM domain_events WHERE entity_kind = 'session'`
        return { project: projects[0], session: sessions[0], entries, events }
      }),
    )
    expect(kept.project).toEqual({ name: 'Atlas', spec_prefix: 'SPEC', next_spec_number: 1 })
    expect(kept.session).toEqual({
      title: 'Fix the parser',
      provider: 'claude',
      native_session_id: 'native-1',
      native_state: 'attached',
      version: 2,
      mission: 'free',
      spec_id: null,
      briefed_at: null,
    })
    expect(kept.entries).toEqual([
      { seq: 1, kind: 'message', payload: '{}', correlation_id: null },
      { seq: 2, kind: 'tool_call', payload: '{"tool":"read"}', correlation_id: 'call-1' },
    ])
    expect(kept.events).toEqual([{ type: 'session.created', entity_id: 'session-1' }])
  })

  test('a Spec event is accepted, an unknown status, mission or entity kind still refused', async () => {
    const dataFolder = join(workspace, 'spec-checks')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.6.0'))

    const outcomes = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', '2026-09-23T10:00:00.000Z', '2026-09-23T10:00:00.000Z', 1)`
        const tried = (insert: Effect.Effect<unknown, unknown>) =>
          Effect.map(Effect.exit(insert), (exit) => Exit.isSuccess(exit))
        return {
          draft:
            yield* tried(sql`INSERT INTO specs (id, project_id, key, slug, status, current_revision_id, created_at, updated_at)
            VALUES ('spec-1', 'atlas', 'SPEC-1', 'csv-export', 'draft', 'revision-1', '2026-09-23T10:00:00.000Z', '2026-09-23T10:00:00.000Z')`),
          unknownStatus:
            yield* tried(sql`INSERT INTO specs (id, project_id, key, slug, status, current_revision_id, created_at, updated_at)
            VALUES ('spec-2', 'atlas', 'SPEC-2', 'other', 'shipped', 'revision-2', '2026-09-23T10:00:00.000Z', '2026-09-23T10:00:00.000Z')`),
          unknownMission:
            yield* tried(sql`INSERT INTO sessions (id, project_id, title, title_source, mission, created_at, last_written_at, version)
            VALUES ('s1', 'atlas', 'T', 'derived', 'explore', '2026-09-23T10:00:00.000Z', '2026-09-23T10:00:00.000Z', 1)`),
          specEvent:
            yield* tried(sql`INSERT INTO domain_events (type, entity_kind, entity_id, source, author, occurred_at, project_id, spec_id, payload)
            VALUES ('spec.spec_created', 'spec', 'spec-1', 'ui', 'human', '2026-09-23T10:00:00.000Z', 'atlas', 'spec-1', '{}')`),
          unknownKind:
            yield* tried(sql`INSERT INTO domain_events (type, entity_kind, entity_id, source, author, occurred_at, payload)
            VALUES ('story.written', 'story', 'story-1', 'ui', 'human', '2026-09-23T10:00:00.000Z', '{}')`),
        }
      }),
    )

    expect(outcomes).toEqual({
      draft: true,
      unknownStatus: false,
      unknownMission: false,
      specEvent: true,
      unknownKind: false,
    })
  })

  test('a brief, an answer, an edit and an internal result are deliveries, each written again', async () => {
    const dataFolder = join(workspace, 'spec-deliveries')
    await on(dataFolder, openProfile(dataFolder, shippedUpTo(TOOLS_MIGRATION), '0.5.0'))
    // A delivery a profile of lot 6 made: the table is rebuilt for its wider check, and keeps it.
    await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', '2026-09-24T10:00:00.000Z', '2026-09-24T10:00:00.000Z', 1)`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, created_at, last_written_at, version)
          VALUES ('session-1', 'atlas', 'T', 'derived', '2026-09-24T10:00:00.000Z', '2026-09-24T10:00:00.000Z', 1)`
        yield* sql`INSERT INTO context_deliveries (id, session_id, kind, path, fingerprint, delivered_at)
          VALUES ('d0', 'session-1', 'instructions', 'AGENTS.md', 'abc', '2026-09-24T10:00:00.000Z')`
      }),
    )
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.6.0'))

    const seen = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const tried = (id: string, kind: string, path: string) =>
          Effect.map(
            Effect.exit(sql`INSERT INTO context_deliveries (id, session_id, kind, path, fingerprint, delivered_at)
              VALUES (${id}, 'session-1', ${kind}, ${path}, 'same', '2026-09-24T10:01:00.000Z')`),
            (exit) => Exit.isSuccess(exit),
          )
        // The same text handed over twice is two deliveries, of each of the four kinds (D7-09).
        const accepted: boolean[] = []
        for (const kind of ['brief', 'answer', 'edit', 'internal']) {
          const path = kind === 'brief' ? 'shape' : ''
          accepted.push(
            yield* tried(`${kind}-1`, kind, path),
            yield* tried(`${kind}-2`, kind, path),
          )
        }
        const unknown = yield* tried('rumour-1', 'rumour', '')
        const kept = yield* sql<{
          kind: string
        }>`SELECT kind FROM context_deliveries WHERE id = 'd0'`
        return { accepted, unknown, kept }
      }),
    )

    expect(seen.accepted).toEqual(Array.from({ length: 8 }, () => true))
    expect(seen.unknown).toBe(false)
    expect(seen.kept).toEqual([{ kind: 'instructions' }])
  })

  test('a Spec’s Journal lines are read through an index on spec_id', async () => {
    const dataFolder = join(workspace, 'spec-index')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.6.0'))

    const plan = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ detail: string }>`EXPLAIN QUERY PLAN
          SELECT sequence FROM domain_events WHERE spec_id = 'spec-1' ORDER BY sequence DESC`
      }),
    )

    expect(plan.map((row) => row.detail).join('\n')).toContain('INDEX event_by_spec (spec_id=?)')
  })
})

describe('Après migration, le profil dit qui l’a écrite', () => {
  test('the data folder reports the migration it stands at and the version that wrote it', async () => {
    const dataFolder = join(workspace, 'written')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.3.0'))

    const written = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{
          written_by_version: string
          last_opened_at: string
        }>`SELECT written_by_version, last_opened_at FROM profile WHERE id = 1`
      }),
    )
    expect(written[0]?.written_by_version).toBe('0.3.0')
    expect(written[0]?.last_opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('a later version opening it again takes over the line rather than adding one', async () => {
    const dataFolder = join(workspace, 'rewritten')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.3.0'))
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.3.1'))

    const rows = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ written_by_version: string }>`SELECT written_by_version FROM profile`
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.written_by_version).toBe('0.3.1')
  })
})

describe('Sauvegarde avant migration', () => {
  test('a data folder one migration behind is copied, under the name of what is about to run', async () => {
    const one = migrationsFolder('CREATE TABLE `kept` (`id` integer PRIMARY KEY);')
    const two = migrationsFolder(
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
      'CREATE TABLE `added` (`id` integer PRIMARY KEY);',
    )
    const dataFolder = join(workspace, 'backed-up')
    await on(dataFolder, openProfile(dataFolder, one, '0.2.0'))

    const backups = join(dataFolder, BACKUPS_FOLDER)
    expect(existsSync(backups)).toBe(false)

    const standing = await on(dataFolder, openProfile(dataFolder, two, '0.3.0'))
    expect(standing.behind).toHaveLength(1)
    expect(readdirSync(backups)).toEqual([`${standing.behind[0]!}.sqlite`])

    // And the migration did run: the copy is of before, the database is of after.
    expect((await on(dataFolder, schemaOf)).join('\n')).toContain('added')
  })

  test('a data folder that never held anything is not copied before its first migration', async () => {
    const dataFolder = join(workspace, 'first-start')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.3.0'))
    expect(existsSync(join(dataFolder, BACKUPS_FOLDER))).toBe(false)
  })
})

describe('Une migration qui échoue ne laisse rien à moitié', () => {
  test('a refused migration leaves the schema as it was, and the backup where it is', async () => {
    const one = migrationsFolder('CREATE TABLE `kept` (`id` integer PRIMARY KEY);')
    const broken = migrationsFolder(
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
    )
    const dataFolder = join(workspace, 'broken')
    await on(dataFolder, openProfile(dataFolder, one, '0.2.0'))
    const before = await on(dataFolder, schemaOf)

    const refused = await refusalOn(dataFolder, openProfile(dataFolder, broken, '0.3.0'))
    expect(refused).toBeInstanceOf(MigrationError)
    if (refused instanceof MigrationError) expect(refused.migrations).toHaveLength(1)

    expect(await on(dataFolder, schemaOf)).toEqual(before)
    expect(readdirSync(join(dataFolder, BACKUPS_FOLDER))).toHaveLength(1)
  })
})

describe('Une version ancienne trouve un profil migré par une plus récente', () => {
  test('a data folder carrying a migration this version never heard of is refused, untouched', async () => {
    const one = migrationsFolder('CREATE TABLE `kept` (`id` integer PRIMARY KEY);')
    const two = migrationsFolder(
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
      'CREATE TABLE `added` (`id` integer PRIMARY KEY);',
    )
    const dataFolder = join(workspace, 'ahead')
    await on(dataFolder, openProfile(dataFolder, two, '0.4.0-7-g1234'))
    const before = await on(dataFolder, schemaOf)

    const refused = await refusalOn(dataFolder, openProfile(dataFolder, one, '0.3.0'))
    expect(refused).toBeInstanceOf(ProfileAheadError)
    if (refused instanceof ProfileAheadError) {
      expect(refused.writtenByVersion).toBe('0.4.0-7-g1234')
      expect(refused.migrations).toHaveLength(1)
    }

    // Nothing was written: not the schema, and not the version that wrote it.
    expect(await on(dataFolder, schemaOf)).toEqual(before)
    const rows = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ written_by_version: string }>`SELECT written_by_version FROM profile`
      }),
    )
    expect(rows[0]?.written_by_version).toBe('0.4.0-7-g1234')
    expect(existsSync(join(dataFolder, BACKUPS_FOLDER))).toBe(false)
  })

  test('being ahead is decided on what was applied, not on what it was called', () => {
    const carried = [{ name: 'one', hash: 'a' }]
    const applied = [
      { name: 'one', hash: 'a' },
      { name: 'two', hash: 'b' },
    ]
    // `backedUp` is not decided by comparing two lists: it is filled in by the opening, which
    // is the only thing that knows whether a copy was worth taking.
    expect(standingOf(carried, applied)).toEqual({ ahead: ['two'], behind: [], backedUp: null })
    expect(standingOf(applied, carried)).toEqual({ ahead: [], behind: ['two'], backedUp: null })
    expect(standingOf(carried, carried)).toEqual({ ahead: [], behind: [], backedUp: null })
  })
})

describe('Les tests de migration tournent sur un dossier temporaire', () => {
  test('every data folder this suite opened is under the temporary directory it made', () => {
    expect(workspace.startsWith(tmpdir())).toBe(true)
  })

  test.each(['prod', 'dev'] as const)(
    'the %s data folder of this machine is never where a test writes',
    (engraved) => {
      const real = dataDirectory(engraved, process.platform, process.env)
      expect(workspace.startsWith(real)).toBe(false)
      expect(real.startsWith(workspace)).toBe(false)
    },
  )
})

describe('Un profil du lot 5 est migré vers le lot 6', () => {
  test('the migration keeps the Sessions and adds the catalogue, the runs and the deliveries', async () => {
    const dataFolder = join(workspace, 'from-lot-five')
    await on(dataFolder, openProfile(dataFolder, shippedUpTo(AGENTS_MIGRATION), '0.5.0'))

    // A Session of the user's, with a message in it, and an agent it is attached to: none of it
    // may be lost by a migration that widens the kinds an entry may have.
    await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', '2026-09-21T10:00:00.000Z', '2026-09-21T10:00:00.000Z', 1)`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, provider, native_session_id, native_state, cwd, created_at, last_written_at, version)
          VALUES ('session-1', 'atlas', 'Fix the parser', 'derived', 'claude', 'native-9', 'attached', '/work/atlas', '2026-09-21T10:00:00.000Z', '2026-09-21T10:01:00.000Z', 1)`
        yield* sql`INSERT INTO session_entries (id, session_id, seq, role, kind, body, payload, created_at)
          VALUES ('entry-1', 'session-1', 1, 'agent', 'tool_call', 'Read the parser', '{"toolCallId":"call-1"}', '2026-09-21T10:01:00.000Z')`
      }),
    )

    const standing = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.6.0'))

    // Behind by this lot's migration and the ones after it — the Specs', the Workspaces', the
    // build's, the review's — and the copy taken before them is named after the first.
    expect(standing.behind).toEqual([
      TOOLS_MIGRATION,
      SPECS_MIGRATION,
      WORKSPACES_MIGRATION,
      BUILD_MIGRATION,
      REVIEW_MIGRATION,
    ])
    expect(readdirSync(join(dataFolder, BACKUPS_FOLDER))).toEqual([`${TOOLS_MIGRATION}.sqlite`])

    // The three tables of this lot arrived...
    const schema = (await on(dataFolder, schemaOf)).join('\n')
    for (const table of ['project_commands', 'command_runs', 'context_deliveries']) {
      expect(schema).toContain(table)
    }
    // ...the kinds a thread may hold were widened...
    for (const kind of ['hemera_tool_call', 'command_run', 'context_delivery']) {
      expect(schema).toContain(kind)
    }

    // ...and the Session the user had is untouched, handle and all.
    const kept = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const sessions = yield* sql<{
          title: string
          provider: string | null
          native_session_id: string | null
          native_state: string
        }>`SELECT title, provider, native_session_id, native_state FROM sessions WHERE id = 'session-1'`
        const entries = yield* sql<{
          seq: number
          kind: string
          body: string
          payload: string
          origin: string
        }>`SELECT seq, kind, body, payload, origin FROM session_entries WHERE session_id = 'session-1'`
        return { session: sessions[0], entries }
      }),
    )
    expect(kept.session?.native_session_id).toBe('native-9')
    expect(kept.session?.native_state).toBe('attached')
    expect(kept.entries).toEqual([
      {
        seq: 1,
        kind: 'tool_call',
        body: 'Read the parser',
        payload: '{"toolCallId":"call-1"}',
        origin: 'live',
      },
    ])
  })

  test('a run of an unknown state, or a command of an unknown type, is refused by the database', async () => {
    const dataFolder = join(workspace, 'checks-six')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.6.0'))

    // The closed sets of this lot are the database's own: a state nothing reads and a kind
    // nobody draws are refused where they are written rather than shown as an empty block.
    const refusals = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', '2026-09-22T10:00:00.000Z', '2026-09-22T10:00:00.000Z', 1)`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, created_at, last_written_at, version)
          VALUES ('session-1', 'atlas', 'T', 'derived', '2026-09-22T10:00:00.000Z', '2026-09-22T10:00:00.000Z', 1)`
        const unknownKind = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO project_commands (id, project_id, name, line, type, created_at, updated_at)
              VALUES ('c1', 'atlas', 'dev', 'pnpm dev', 'daemon', '2026-09-22T10:00:00.000Z', '2026-09-22T10:00:00.000Z')`
          }),
        )
        const unknownState = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO command_runs (id, session_id, name, line, type, cwd, state, started_by, started_at)
              VALUES ('r1', 'session-1', 'dev', 'pnpm dev', 'serve', '/work/atlas', 'wandering', 'agent', '2026-09-22T10:00:00.000Z')`
          }),
        )
        const unknownDelivery = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO context_deliveries (id, session_id, kind, path, fingerprint, delivered_at)
              VALUES ('d1', 'session-1', 'rumour', '', 'abc', '2026-09-22T10:00:00.000Z')`
          }),
        )
        // The same file read natively twice is one row: what the fingerprint is for. A delivery
        // is not held to it — a file put back as it was is delivered again (D6-08).
        yield* sql`INSERT INTO context_deliveries (id, session_id, kind, path, fingerprint, delivered_at)
          VALUES ('d2', 'session-1', 'native', 'AGENTS.md', 'abc', '2026-09-22T10:00:00.000Z')`
        const twice = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO context_deliveries (id, session_id, kind, path, fingerprint, delivered_at)
              VALUES ('d3', 'session-1', 'native', 'AGENTS.md', 'abc', '2026-09-22T10:01:00.000Z')`
          }),
        )
        return {
          refused: [unknownKind, unknownState, unknownDelivery, twice].map((exit) =>
            Exit.isFailure(exit),
          ),
        }
      }),
    )

    expect(refusals.refused).toEqual([true, true, true, true])
  })
})

describe('A profile of lot 19 is migrated to lot 20', () => {
  test('the commands and their runs take their type, main is ready, and nothing is lost', async () => {
    const dataFolder = join(workspace, 'from-lot-nineteen')
    await on(dataFolder, openProfile(dataFolder, shippedUpTo(SPECS_MIGRATION), '0.3.0'))

    // A Project with its `main`, a repository, a command of each of lot 18's kinds and a run of
    // the app: what this lot renames, types and gives a Workspace must all be there after it.
    await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const at = '2026-09-22T10:00:00.000Z'
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', ${at}, ${at}, 1)`
        yield* sql`INSERT INTO workspaces (id, project_id, name, path, created_at)
          VALUES ('main-1', 'atlas', 'main', '/work/atlas', ${at})`
        yield* sql`INSERT INTO project_repositories (id, project_id, relative_path, rank)
          VALUES ('repo-1', 'atlas', './sources/api', 'a')`
        // Lot 18's folder: a repository of the Project, empty for the root, or — never written
        // by lot 18's settings, but a row may hold it — a path of the root that is not one.
        yield* sql`INSERT INTO project_commands (id, project_id, name, line, kind, folder, created_at, updated_at)
          VALUES ('c-app', 'atlas', 'dev', 'pnpm dev', 'app', './sources/api', ${at}, ${at}),
                 ('c-check', 'atlas', 'check', 'pnpm check', 'check', '', ${at}, ${at}),
                 ('c-utility', 'atlas', 'seed', './seed.sh', 'utility', './tools', ${at}, ${at})`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, created_at, last_written_at, version)
          VALUES ('session-1', 'atlas', 'Serve it', 'derived', ${at}, ${at}, 1)`
        yield* sql`INSERT INTO command_runs (id, session_id, command_id, name, line, kind, cwd, state, started_by, started_at)
          VALUES ('run-1', 'session-1', 'c-app', 'dev', 'pnpm dev', 'app', '/work/atlas', 'exited', 'user', ${at})`
        // The thread's block of that run, as lot 18 wrote it: its payload names the kind.
        yield* sql`INSERT INTO session_entries (id, session_id, seq, role, kind, body, payload, correlation_id, state, created_at)
          VALUES ('entry-1', 'session-1', 1, 'hemera', 'command_run', 'dev',
            '{"runId":"run-1","name":"dev","line":"pnpm dev","kind":"app","state":"exited","cwd":"/work/atlas","url":null,"exitCode":0,"oneOff":false}',
            'run:run-1', 'exited', ${at})`
      }),
    )

    const standing = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.0'))
    expect(standing.behind).toEqual([WORKSPACES_MIGRATION, BUILD_MIGRATION, REVIEW_MIGRATION])
    expect(readdirSync(join(dataFolder, BACKUPS_FOLDER))).toEqual([
      `${WORKSPACES_MIGRATION}.sqlite`,
    ])

    const kept = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const commands = yield* sql<{
          id: string
          type: string
          scope: string
          portless: number
          folder_base: string | null
          folder: string | null
        }>`SELECT id, type, scope, portless, folder_base, folder FROM project_commands ORDER BY id`
        const runs = yield* sql<{
          type: string
          workspace_id: string | null
          environment: string
          folder: string | null
          scope: string
        }>`SELECT type, workspace_id, environment, folder, scope FROM command_runs WHERE id = 'run-1'`
        const entries = yield* sql<{ payload: string }>`
          SELECT payload FROM session_entries WHERE id = 'entry-1'`
        const main = yield* sql<{ state: string; spec_id: string | null }>`
          SELECT state, spec_id FROM workspaces WHERE id = 'main-1'`
        const repositories = yield* sql<{ included_by_default: number; icon: string | null }>`
          SELECT included_by_default, icon FROM project_repositories WHERE id = 'repo-1'`
        const columns = yield* sql<{
          name: string
        }>`SELECT name FROM pragma_table_info('project_commands')`
        const events = yield* sql<{ type: string; payload: string }>`
          SELECT type, payload FROM domain_events ORDER BY sequence`
        // A run no Session asked for — a preparation's `run` step — is written with none
        // (Decided 11).
        yield* sql`INSERT INTO command_runs (id, session_id, name, line, type, cwd, state, started_by, started_at, workspace_id)
          VALUES ('run-2', NULL, 'install', 'pnpm install', 'script', '/work/atlas', 'exited', 'user', '2026-09-24T10:00:00.000Z', 'main-1')`
        const unowned = yield* sql<{ session_id: string | null; workspace_id: string | null }>`
          SELECT session_id, workspace_id FROM command_runs WHERE id = 'run-2'`
        return { commands, runs, entries, main, repositories, columns, events, unowned }
      }),
    )

    // The three kinds of lot 18 are read as the types that replace them (D8-07). A folder that is
    // one of the Project's repositories becomes the command's base, the folder being the base
    // itself; the root stays the root; any other folder stays relative to the root (D8-07 as
    // amended by recette 1).
    expect(kept.commands).toEqual([
      {
        id: 'c-app',
        type: 'serve',
        scope: 'workspace',
        portless: 0,
        folder_base: './sources/api',
        folder: null,
      },
      {
        id: 'c-check',
        type: 'test',
        scope: 'workspace',
        portless: 0,
        folder_base: null,
        folder: null,
      },
      {
        id: 'c-utility',
        type: 'script',
        scope: 'workspace',
        portless: 0,
        folder_base: null,
        folder: './tools',
      },
    ])
    // The run keeps what it was started as, in the new word, and belongs to no Workspace yet:
    // null is read as `main` (D8-08).
    // It ran at the root, once per Workspace: what every run before this lot did (D8-07).
    expect(kept.runs).toEqual([
      { type: 'serve', workspace_id: null, environment: '{}', folder: null, scope: 'workspace' },
    ])
    expect(kept.unowned).toEqual([{ session_id: null, workspace_id: 'main-1' }])
    // Its block in the thread names the type in place of the kind, so the thread still draws it.
    const payload: unknown = JSON.parse(kept.entries[0]!.payload)
    expect(payload).toMatchObject({ runId: 'run-1', type: 'serve', state: 'exited', exitCode: 0 })
    expect(payload).not.toHaveProperty('kind')
    // `main` is ready, as every Workspace written before this lot is (D8-01).
    expect(kept.main).toEqual([{ state: 'ready', spec_id: null }])
    // Included by default, and wearing no icon until one is chosen (recette 1, item 11).
    expect(kept.repositories).toEqual([{ included_by_default: 1, icon: null }])
    expect(kept.columns.map((column) => column.name)).not.toContain('kind')
    // A Portless command runs under the Project's name until one of its own is given (D8-10 as
    // amended by recette 1).
    expect(kept.columns.map((column) => column.name)).toContain('portless_name')

    const schema = (await on(dataFolder, schemaOf)).join('\n')
    for (const table of [
      'workspace_repositories',
      'workspace_steps',
      'project_preparation_steps',
      'environment_variables',
    ]) {
      expect(schema).toContain(table)
    }
    // A recipe step and a Workspace's step apply under a base, a repository or the root: the
    // `scope` of each repository is gone (D8-05 as amended by recette 1).
    const tables = await on(dataFolder, schemaOf)
    for (const table of ['project_preparation_steps', 'workspace_steps']) {
      const created = tables.find((row) => row.startsWith(`${table}:`))
      expect(created).toContain('`base` text')
      expect(created).not.toContain('scope')
    }

    // And the Journal says what was done to the data: the first opening, then this one.
    expect(kept.events.map((event) => event.type)).toEqual([
      'profile.opened',
      'profile.migrated',
      'profile.opened',
      'profile.backed_up',
      'profile.migrated',
    ])
    expect(JSON.parse(kept.events.at(-1)!.payload)).toEqual({ migration: REVIEW_MIGRATION })
  })

  test('a command of a word of lot 18, or a step of an unknown state, is refused', async () => {
    const dataFolder = join(workspace, 'checks-twenty')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.0'))

    const refusals = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const at = '2026-09-23T10:00:00.000Z'
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', ${at}, ${at}, 1)`
        yield* sql`INSERT INTO workspaces (id, project_id, name, path, created_at)
          VALUES ('main-1', 'atlas', 'main', '/work/atlas', ${at})`
        const oldWord = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO project_commands (id, project_id, name, line, type, created_at, updated_at)
              VALUES ('c1', 'atlas', 'dev', 'pnpm dev', 'app', ${at}, ${at})`
          }),
        )
        const unknownStep = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO workspace_steps (id, workspace_id, position, kind, target, state)
              VALUES ('s1', 'main-1', 1, 'worktree', './sources/api', 'wandering')`
          }),
        )
        // A key set twice in the Project is refused; the same key in a Workspace is an override.
        yield* sql`INSERT INTO environment_variables (id, project_id, workspace_id, key, value)
          VALUES ('v1', 'atlas', NULL, 'PORT', '3000'), ('v2', 'atlas', 'main-1', 'PORT', '3001')`
        const twice = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO environment_variables (id, project_id, workspace_id, key, value)
              VALUES ('v3', 'atlas', NULL, 'PORT', '4000')`
          }),
        )
        return [oldWord, unknownStep, twice].map((exit) => Exit.isFailure(exit))
      }),
    )

    expect(refusals).toEqual([true, true, true])
  })

  test('a cleaned Workspace frees its name and its Spec, and two live ones may not share them', async () => {
    const dataFolder = join(workspace, 'cleaned-twenty')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.0'))

    const written = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const at = '2026-09-23T10:00:00.000Z'
        const insert = (id: string, state: string) =>
          Effect.exit(
            Effect.gen(function* () {
              yield* sql`INSERT INTO workspaces (id, project_id, name, path, created_at, spec_id, state)
                VALUES (${id}, 'atlas', 'login-form', ${`/work/${id}`}, ${at}, 'HEM-7', ${state})`
            }),
          )
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', ${at}, ${at}, 1)`
        // The Spec these Workspaces are made for exists: the foreign key says so (D8-12).
        yield* sql`INSERT INTO specs (id, project_id, key, slug, status, current_revision_id, created_at, updated_at)
          VALUES ('HEM-7', 'atlas', 'HEM-7', 'the-login-form', 'draft', 'revision-1', ${at}, ${at})`
        // Two live Workspaces of the same name and the same Spec: the second is refused.
        const first = yield* insert('w1', 'ready')
        const second = yield* insert('w2', 'preparing')
        // Once the first is cleaned, its name and its Spec are free (D8-02, D8-14).
        yield* sql`UPDATE workspaces SET state = 'cleaned', cleaned_at = ${at} WHERE id = 'w1'`
        const after = yield* insert('w3', 'preparing')
        const rows = yield* sql<{ id: string; state: string }>`
          SELECT id, state FROM workspaces ORDER BY id`
        return { exits: [first, second, after].map((exit) => Exit.isSuccess(exit)), rows }
      }),
    )

    expect(written.exits).toEqual([true, false, true])
    expect(written.rows).toEqual([
      { id: 'w1', state: 'cleaned' },
      { id: 'w3', state: 'preparing' },
    ])
  })

  test('two live Workspaces of different names may not share a Spec', async () => {
    const dataFolder = join(workspace, 'spec-twenty')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.0'))

    const exits = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const at = '2026-09-23T10:00:00.000Z'
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', ${at}, ${at}, 1)`
        // The Spec these Workspaces are made for exists: the foreign key says so (D8-12).
        yield* sql`INSERT INTO specs (id, project_id, key, slug, status, current_revision_id, created_at, updated_at)
          VALUES ('HEM-7', 'atlas', 'HEM-7', 'the-login-form', 'draft', 'revision-1', ${at}, ${at})`
        const insert = (id: string, name: string) =>
          Effect.exit(
            Effect.gen(function* () {
              yield* sql`INSERT INTO workspaces (id, project_id, name, path, created_at, spec_id, state)
                VALUES (${id}, 'atlas', ${name}, ${`/work/${id}`}, ${at}, 'HEM-7', 'ready')`
            }),
          )
        return [yield* insert('w1', 'login-form'), yield* insert('w2', 'login-form-2')].map(
          (exit) => Exit.isSuccess(exit),
        )
      }),
    )

    expect(exits).toEqual([true, false])
  })

  test('A launch is written and read back with its Spec, revision and Workspace', async () => {
    const dataFolder = join(workspace, 'launch-twenty')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.0'))

    const written = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const at = '2026-09-24T22:00:00.000Z'
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', ${at}, ${at}, 1)`
        yield* sql`INSERT INTO workspaces (id, project_id, name, path, created_at, state)
          VALUES ('main-1', 'atlas', 'main', '/work/atlas', ${at}, 'ready')`
        // The Spec exists before the Workspace made for it, and is given it after (D8-12):
        // each names the other, so one of the two writes comes second.
        yield* sql`INSERT INTO specs (id, project_id, key, slug, status, current_revision_id, created_at, updated_at)
          VALUES ('spec-1', 'atlas', 'HEM-7', 'the-login-form', 'ready', 'revision-2', ${at}, ${at})`
        yield* sql`INSERT INTO spec_revisions (id, spec_id, number, title, type, created_by, created_at)
          VALUES ('revision-2', 'spec-1', 2, 'The login form', 'feature', 'human', ${at})`
        yield* sql`INSERT INTO workspaces (id, project_id, name, path, created_at, spec_id, state)
          VALUES ('ws-1', 'atlas', 'login-form', '/work/atlas-login-form', ${at}, 'spec-1', 'ready')`
        yield* sql`UPDATE specs SET workspace_id = 'ws-1' WHERE id = 'spec-1'`
        // The request, then the Session it starts: the two are read back together (D8-13).
        yield* sql`INSERT INTO build_launches (id, spec_id, revision_id, workspace_id, state, created_at, updated_at)
          VALUES ('launch-1', 'spec-1', 'revision-2', 'ws-1', 'waiting', ${at}, ${at})`
        const waiting = yield* sql<{ state: string; session_id: string | null }>`
          SELECT state, session_id FROM build_launches WHERE id = 'launch-1'`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, mission, spec_id, revision_id, workspace_id, created_at, last_written_at, version)
          VALUES ('session-build', 'atlas', 'Build HEM-7', 'derived', 'build', 'spec-1', 'revision-2', 'ws-1', ${at}, ${at}, 1)`
        yield* sql`UPDATE build_launches SET state = 'started', session_id = 'session-build' WHERE id = 'launch-1'`
        const started = yield* sql<{
          state: string
          key: string
          revision: number
          workspace: string
          mission: string
          session_revision: string | null
        }>`SELECT launch.state, specs.key, revisions.number AS revision, workspaces.name AS workspace,
              sessions.mission, sessions.revision_id AS session_revision
            FROM build_launches AS launch
            JOIN specs ON specs.id = launch.spec_id
            JOIN spec_revisions AS revisions ON revisions.id = launch.revision_id
            JOIN workspaces ON workspaces.id = launch.workspace_id
            JOIN sessions ON sessions.id = launch.session_id`
        // A state nobody wrote is refused, the way a type or a step state is (D8-13).
        const unknown = yield* Effect.exit(
          Effect.gen(function* () {
            yield* sql`INSERT INTO build_launches (id, spec_id, revision_id, state, created_at, updated_at)
              VALUES ('launch-2', 'spec-1', 'revision-2', 'launched', ${at}, ${at})`
          }),
        )
        return { waiting, started, refused: Exit.isFailure(unknown) }
      }),
    )

    expect(written.waiting).toEqual([{ state: 'waiting', session_id: null }])
    expect(written.started).toEqual([
      {
        state: 'started',
        key: 'HEM-7',
        revision: 2,
        workspace: 'login-form',
        mission: 'build',
        session_revision: 'revision-2',
      },
    ])
    expect(written.refused).toBe(true)
  })
})

describe('A profile of lot 20 is migrated to lot 22', () => {
  test('the build migration keeps the Sessions, their threads, runs and Journal', async () => {
    const dataFolder = join(workspace, 'from-lot-twenty')
    await on(dataFolder, openProfile(dataFolder, shippedUpTo(WORKSPACES_MIGRATION), '0.4.0'))

    // A build Session launched on a Spec, with a message, a run and the launch that started it,
    // and two Journal lines: the two tables this migration rebuilds and every row pointing at them.
    await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const at = '2026-09-24T22:00:00.000Z'
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', ${at}, ${at}, 1)`
        yield* sql`INSERT INTO workspaces (id, project_id, name, path, created_at, state)
          VALUES ('main-1', 'atlas', 'main', '/work/atlas', ${at}, 'ready')`
        yield* sql`INSERT INTO specs (id, project_id, key, slug, status, current_revision_id, created_at, updated_at)
          VALUES ('spec-1', 'atlas', 'HEM-7', 'the-login-form', 'ready', 'revision-1', ${at}, ${at})`
        yield* sql`INSERT INTO spec_revisions (id, spec_id, number, title, type, created_by, created_at)
          VALUES ('revision-1', 'spec-1', 1, 'The login form', 'feature', 'human', ${at})`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, provider, native_session_id, native_state, mission, spec_id, revision_id, workspace_id, created_at, last_written_at, version)
          VALUES ('session-build', 'atlas', 'Build HEM-7', 'derived', 'claude', 'native-7', 'attached', 'build', 'spec-1', 'revision-1', 'main-1', ${at}, ${at}, 3)`
        yield* sql`UPDATE specs SET writer_session_id = 'session-build' WHERE id = 'spec-1'`
        yield* sql`INSERT INTO session_entries (id, session_id, seq, role, kind, body, payload, created_at)
          VALUES ('entry-1', 'session-build', 1, 'hemera', 'mission_brief', 'Build HEM-7', '{}', ${at})`
        yield* sql`INSERT INTO command_runs (id, session_id, name, line, type, cwd, state, started_by, started_at, workspace_id)
          VALUES ('run-1', 'session-build', 'test', 'pnpm test', 'test', '/work/atlas', 'exited', 'agent', ${at}, 'main-1')`
        yield* sql`INSERT INTO build_launches (id, spec_id, revision_id, workspace_id, state, session_id, created_at, updated_at)
          VALUES ('launch-1', 'spec-1', 'revision-1', 'main-1', 'started', 'session-build', ${at}, ${at})`
        yield* sql`INSERT INTO domain_events (type, entity_kind, entity_id, source, author, occurred_at, project_id, session_id, spec_id, payload)
          VALUES ('launch.started', 'launch', 'launch-1', 'ui', 'human', ${at}, 'atlas', 'session-build', 'spec-1', '{}')`
      }),
    )

    const standing = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.5.0'))
    expect(standing.behind).toEqual([BUILD_MIGRATION, REVIEW_MIGRATION])
    expect(readdirSync(join(dataFolder, BACKUPS_FOLDER))).toEqual([`${BUILD_MIGRATION}.sqlite`])

    const schema = (await on(dataFolder, schemaOf)).join('\n')
    for (const table of [
      'build_tasks',
      'build_attempts',
      'build_attempt_trees',
      'build_attempt_files',
      'build_check_results',
      'build_blockers',
      'project_checks',
    ]) {
      expect(schema).toContain(`${table}: CREATE TABLE`)
    }

    const kept = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const sessions = yield* sql<{
          title: string
          native_session_id: string | null
          mission: string
          revision_id: string | null
          workspace_id: string | null
          version: number
          build_phase: string | null
          build_paused_at: string | null
          build_detail: string | null
          approach_note: string | null
        }>`SELECT title, native_session_id, mission, revision_id, workspace_id, version,
              build_phase, build_paused_at, build_detail, approach_note
            FROM sessions WHERE id = 'session-build'`
        const entries = yield* sql<{ id: string }>`
          SELECT id FROM session_entries WHERE session_id = 'session-build'`
        const runs = yield* sql<{ id: string }>`
          SELECT id FROM command_runs WHERE session_id = 'session-build'`
        const launches = yield* sql<{ session_id: string | null }>`
          SELECT session_id FROM build_launches WHERE id = 'launch-1'`
        const writers = yield* sql<{ writer_session_id: string | null }>`
          SELECT writer_session_id FROM specs WHERE id = 'spec-1'`
        const events = yield* sql<{ sequence: number; type: string }>`
          SELECT sequence, type FROM domain_events ORDER BY sequence`
        // The Journal keeps counting after the lines it had: its key is still `AUTOINCREMENT`.
        yield* sql`INSERT INTO domain_events (type, entity_kind, entity_id, source, author, occurred_at, session_id, payload)
          VALUES ('task.ready', 'task', 'task-1', 'system', 'hemera', '2026-09-25T08:00:00.000Z', 'session-build', '{}')`
        const next = yield* sql<{ sequence: number }>`
          SELECT sequence FROM domain_events WHERE type = 'task.ready'`
        // A Session's thread still goes with it: the rebuilt `sessions` is the parent it was.
        const parents = yield* sql<{ table: string }>`
          SELECT "table" FROM pragma_foreign_key_list('session_entries')`
        return { session: sessions[0], entries, runs, launches, writers, events, next, parents }
      }),
    )

    expect(kept.session).toEqual({
      title: 'Build HEM-7',
      native_session_id: 'native-7',
      mission: 'build',
      revision_id: 'revision-1',
      workspace_id: 'main-1',
      version: 3,
      build_phase: null,
      build_paused_at: null,
      build_detail: null,
      approach_note: null,
    })
    expect(kept.entries).toEqual([{ id: 'entry-1' }])
    expect(kept.runs).toEqual([{ id: 'run-1' }])
    expect(kept.launches).toEqual([{ session_id: 'session-build' }])
    expect(kept.writers).toEqual([{ writer_session_id: 'session-build' }])
    expect(kept.events.map((event) => event.type)).toEqual([
      'profile.opened',
      'profile.migrated',
      'launch.started',
      'profile.opened',
      'profile.backed_up',
      'profile.migrated',
    ])
    expect(kept.next[0]!.sequence).toBeGreaterThan(kept.events.at(-1)!.sequence)
    expect(kept.parents).toEqual([{ table: 'sessions' }])
  })

  test('a build’s rows are written, and what no build writes is refused', async () => {
    const dataFolder = join(workspace, 'build-checks')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.5.0'))

    const seen = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const at = '2026-09-25T08:00:00.000Z'
        yield* sql`INSERT INTO projects (id, name, tone, created_at, updated_at, version)
          VALUES ('atlas', 'Atlas', 'primary', ${at}, ${at}, 1)`
        yield* sql`INSERT INTO project_commands (id, project_id, name, line, type, created_at, updated_at)
          VALUES ('c-test', 'atlas', 'test', 'pnpm test', 'test', ${at}, ${at})`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, mission, created_at, last_written_at, version, build_phase)
          VALUES ('session-build', 'atlas', 'Build HEM-7', 'derived', 'build', ${at}, ${at}, 1, 'prepare')`
        const tried = (insert: Effect.Effect<unknown, unknown>) =>
          Effect.map(Effect.exit(insert), (exit) => Exit.isSuccess(exit))
        const check = (
          id: string,
          command: string | null,
          line: string | null,
          where: string,
          repository: string | null,
          when: string,
          pattern: string | null,
          minimum: number | null,
        ) =>
          tried(sql`INSERT INTO project_checks (id, project_id, name, command_id, line, "where", repository, "when", expect_pattern, expect_minimum, rank, created_at, updated_at)
            VALUES (${id}, 'atlas', ${id}, ${command}, ${line}, ${where}, ${repository}, ${when}, ${pattern}, ${minimum}, 'a', ${at}, ${at})`)
        const task = (id: string, taskId: string, label: string, state: string) =>
          tried(sql`INSERT INTO build_tasks (id, session_id, task_id, label, rank, state, updated_at)
            VALUES (${id}, 'session-build', ${taskId}, ${label}, 'a', ${state}, ${at})`)
        const attempt = (
          id: string,
          scope: string,
          buildTask: string | null,
          story: string | null,
          number: number,
        ) =>
          tried(sql`INSERT INTO build_attempts (id, session_id, scope, build_task_id, story_id, number, started_at)
            VALUES (${id}, 'session-build', ${scope}, ${buildTask}, ${story}, ${number}, ${at})`)

        const checks = {
          command: yield* check('unit', 'c-test', null, 'changed', null, 'task', null, null),
          line: yield* check(
            'cover',
            null,
            'pnpm cover',
            'repository',
            'api',
            'end',
            'All (\\d+)%',
            70,
          ),
          both: yield* check('both', 'c-test', 'pnpm test', 'root', null, 'task', null, null),
          neither: yield* check('neither', null, null, 'root', null, 'task', null, null),
          repositoryMissing: yield* check('r1', null, 'x', 'repository', null, 'task', null, null),
          repositoryAtRoot: yield* check('r2', null, 'x', 'root', 'api', 'task', null, null),
          halfExpect: yield* check('e1', null, 'x', 'root', null, 'task', 'All (\\d+)%', null),
          unknownWhere: yield* check('w1', null, 'x', 'anywhere', null, 'task', null, null),
          unknownWhen: yield* check('w2', null, 'x', 'root', null, 'nightly', null, null),
          sameName: yield* check('unit', null, 'x', 'root', null, 'task', null, null),
        }
        const tasks = {
          ready: yield* task('bt-1', 'task-1', 'T1', 'ready'),
          waiting: yield* task('bt-2', 'task-2', 'T2', 'waiting'),
          unknownState: yield* task('bt-3', 'task-3', 'T3', 'started'),
          sameTask: yield* task('bt-4', 'task-1', 'T4', 'ready'),
          sameLabel: yield* task('bt-5', 'task-5', 'T1', 'ready'),
        }
        const attempts = {
          onTask: yield* attempt('a-1', 'task', 'bt-1', null, 1),
          onStory: yield* attempt('a-2', 'story', null, 'story-1', 1),
          onBuild: yield* attempt('a-3', 'build', null, null, 1),
          taskWithoutTask: yield* attempt('a-4', 'task', null, null, 2),
          storyWithTask: yield* attempt('a-5', 'story', 'bt-1', 'story-1', 2),
          buildWithStory: yield* attempt('a-6', 'build', null, 'story-1', 2),
          unknownScope: yield* attempt('a-7', 'phase', null, null, 2),
          sameTaskNumber: yield* attempt('a-8', 'task', 'bt-1', null, 1),
          sameStoryNumber: yield* attempt('a-9', 'story', null, 'story-1', 1),
          sameBuildNumber: yield* attempt('a-10', 'build', null, null, 1),
          unknownResult:
            yield* tried(sql`INSERT INTO build_attempts (id, session_id, scope, build_task_id, number, started_at, result)
            VALUES ('a-11', 'session-build', 'task', 'bt-1', 2, ${at}, 'amber')`),
        }
        // The evidence of the first attempt: its snapshots, a text and a binary file, a check.
        yield* sql`INSERT INTO build_attempt_trees (attempt_id, repository, start_tree, end_tree)
          VALUES ('a-1', '', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', NULL)`
        yield* sql`INSERT INTO build_attempt_files (attempt_id, repository, path, status, added, removed)
          VALUES ('a-1', '', 'src/login.ts', 'M', 12, 3), ('a-1', '', 'logo.png', 'A', NULL, NULL)`
        const verdicts = {
          green:
            yield* tried(sql`INSERT INTO build_check_results (id, attempt_id, check_id, name, place, line, verdict, exit_code, ran_at)
            VALUES ('r-1', 'a-1', 'unit', 'unit', '', 'pnpm test', 'green', 0, ${at})`),
          unknown:
            yield* tried(sql`INSERT INTO build_check_results (id, attempt_id, name, place, line, verdict, ran_at)
            VALUES ('r-2', 'a-1', 'unit', '', 'pnpm test', 'amber', ${at})`),
        }
        const blocker =
          yield* tried(sql`INSERT INTO build_blockers (id, session_id, build_task_id, reason, raised_at)
          VALUES ('b-1', 'session-build', 'bt-1', 'The Spec asks for two forms', ${at})`)
        const phases = {
          unknown: yield* tried(
            sql`UPDATE sessions SET build_phase = 'deliver' WHERE id = 'session-build'`,
          ),
          execute: yield* tried(
            sql`UPDATE sessions SET build_phase = 'execute' WHERE id = 'session-build'`,
          ),
        }
        const taskEvent =
          yield* tried(sql`INSERT INTO domain_events (type, entity_kind, entity_id, source, author, occurred_at, session_id, payload)
          VALUES ('task.ready', 'task', 'bt-1', 'system', 'hemera', ${at}, 'session-build', '{}')`)
        // A check removed leaves its result where it was, no longer pointing at it.
        yield* sql`DELETE FROM project_checks WHERE id = 'unit'`
        const results = yield* sql<{ check_id: string | null; name: string; output_tail: string }>`
          SELECT check_id, name, output_tail FROM build_check_results`
        const files = yield* sql<{ path: string; added: number | null }>`
          SELECT path, added FROM build_attempt_files ORDER BY path`
        const skip = yield* sql<{ skip_unblocks: number }>`
          SELECT skip_unblocks FROM build_tasks WHERE id = 'bt-1'`
        return {
          checks,
          tasks,
          attempts,
          verdicts,
          blocker,
          phases,
          taskEvent,
          results,
          files,
          skip,
        }
      }),
    )

    expect(seen.checks).toEqual({
      command: true,
      line: true,
      both: false,
      neither: false,
      repositoryMissing: false,
      repositoryAtRoot: false,
      halfExpect: false,
      unknownWhere: false,
      unknownWhen: false,
      sameName: false,
    })
    expect(seen.tasks).toEqual({
      ready: true,
      waiting: true,
      unknownState: false,
      sameTask: false,
      sameLabel: false,
    })
    expect(seen.attempts).toEqual({
      onTask: true,
      onStory: true,
      onBuild: true,
      taskWithoutTask: false,
      storyWithTask: false,
      buildWithStory: false,
      unknownScope: false,
      sameTaskNumber: false,
      sameStoryNumber: false,
      sameBuildNumber: false,
      unknownResult: false,
    })
    expect(seen.verdicts).toEqual({ green: true, unknown: false })
    expect(seen.blocker).toBe(true)
    expect(seen.phases).toEqual({ unknown: false, execute: true })
    expect(seen.taskEvent).toBe(true)
    expect(seen.results).toEqual([{ check_id: null, name: 'unit', output_tail: '' }])
    expect(seen.files).toEqual([
      { path: 'logo.png', added: null },
      { path: 'src/login.ts', added: 12 },
    ])
    expect(seen.skip).toEqual([{ skip_unblocks: 0 }])
  })

  test('a build view is read through its indexes', async () => {
    const dataFolder = join(workspace, 'build-index')
    await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.5.0'))

    const plans = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const detail = (rows: readonly { detail: string }[]) =>
          rows.map((row) => row.detail).join('\n')
        return {
          tasks: detail(
            yield* sql<{ detail: string }>`EXPLAIN QUERY PLAN
              SELECT id FROM build_tasks WHERE session_id = 's' AND state = 'ready'`,
          ),
          attempts: detail(
            yield* sql<{ detail: string }>`EXPLAIN QUERY PLAN
              SELECT id FROM build_attempts WHERE session_id = 's'`,
          ),
          results: detail(
            yield* sql<{ detail: string }>`EXPLAIN QUERY PLAN
              SELECT id FROM build_check_results WHERE attempt_id = 'a' ORDER BY ran_at`,
          ),
          blockers: detail(
            yield* sql<{ detail: string }>`EXPLAIN QUERY PLAN
              SELECT id FROM build_blockers WHERE session_id = 's'`,
          ),
        }
      }),
    )

    expect(plans.tasks).toContain('INDEX build_task_by_state (session_id=? AND state=?)')
    expect(plans.attempts).toContain('INDEX attempt_by_session (session_id=?)')
    expect(plans.results).toContain('INDEX check_result_by_attempt (attempt_id=?)')
    expect(plans.blockers).toContain('INDEX blocker_by_session (session_id=?)')
  })
})
