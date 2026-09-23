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

/**
 * The migration lot 20 adds: the one a profile of lot 18 has never heard of — the Workspaces,
 * their steps and variables, and the commands typed by seven types (D8-01, D8-05, D8-06, D8-07).
 */
const WORKSPACES_MIGRATION = '20260923194453_workspaces'

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

    // Two migrations behind now — the agents' and this lot's — and the copy taken before them
    // is named after the first of the two, which is the one that was applied first.
    expect(standing.behind).toEqual([AGENTS_MIGRATION, TOOLS_MIGRATION, WORKSPACES_MIGRATION])
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

    // Behind by this lot's migration and the ones after it, and the copy taken before them is
    // named after the first.
    expect(standing.behind).toEqual([TOOLS_MIGRATION, WORKSPACES_MIGRATION])
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

describe('A profile of lot 18 is migrated to lot 20', () => {
  test('the commands and their runs take their type, main is ready, and nothing is lost', async () => {
    const dataFolder = join(workspace, 'from-lot-eighteen')
    await on(dataFolder, openProfile(dataFolder, shippedUpTo(TOOLS_MIGRATION), '0.3.0'))

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
        yield* sql`INSERT INTO project_commands (id, project_id, name, line, kind, created_at, updated_at)
          VALUES ('c-app', 'atlas', 'dev', 'pnpm dev', 'app', ${at}, ${at}),
                 ('c-check', 'atlas', 'check', 'pnpm check', 'check', ${at}, ${at}),
                 ('c-utility', 'atlas', 'seed', './seed.sh', 'utility', ${at}, ${at})`
        yield* sql`INSERT INTO sessions (id, project_id, title, title_source, created_at, last_written_at, version)
          VALUES ('session-1', 'atlas', 'Serve it', 'derived', ${at}, ${at}, 1)`
        yield* sql`INSERT INTO command_runs (id, session_id, command_id, name, line, kind, cwd, state, started_by, started_at)
          VALUES ('run-1', 'session-1', 'c-app', 'dev', 'pnpm dev', 'app', '/work/atlas', 'exited', 'user', ${at})`
      }),
    )

    const standing = await on(dataFolder, openProfile(dataFolder, SHIPPED, '0.4.0'))
    expect(standing.behind).toEqual([WORKSPACES_MIGRATION])
    expect(readdirSync(join(dataFolder, BACKUPS_FOLDER))).toEqual([
      `${WORKSPACES_MIGRATION}.sqlite`,
    ])

    const kept = await on(
      dataFolder,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        const commands = yield* sql<{ id: string; type: string; scope: string; portless: number }>`
          SELECT id, type, scope, portless FROM project_commands ORDER BY id`
        const runs = yield* sql<{ type: string; workspace_id: string | null; environment: string }>`
          SELECT type, workspace_id, environment FROM command_runs WHERE id = 'run-1'`
        const main = yield* sql<{ state: string; spec_id: string | null }>`
          SELECT state, spec_id FROM workspaces WHERE id = 'main-1'`
        const repositories = yield* sql<{ included_by_default: number }>`
          SELECT included_by_default FROM project_repositories WHERE id = 'repo-1'`
        const columns = yield* sql<{
          name: string
        }>`SELECT name FROM pragma_table_info('project_commands')`
        const events = yield* sql<{ type: string; payload: string }>`
          SELECT type, payload FROM domain_events ORDER BY sequence`
        return { commands, runs, main, repositories, columns, events }
      }),
    )

    // The three kinds of lot 18 are read as the types that replace them (D8-07).
    expect(kept.commands).toEqual([
      { id: 'c-app', type: 'serve', scope: 'workspace', portless: 0 },
      { id: 'c-check', type: 'test', scope: 'workspace', portless: 0 },
      { id: 'c-utility', type: 'script', scope: 'workspace', portless: 0 },
    ])
    // The run keeps what it was started as, in the new word, and belongs to no Workspace yet:
    // null is read as `main` (D8-08).
    expect(kept.runs).toEqual([{ type: 'serve', workspace_id: null, environment: '{}' }])
    // `main` is ready, as every Workspace written before this lot is (D8-01).
    expect(kept.main).toEqual([{ state: 'ready', spec_id: null }])
    expect(kept.repositories).toEqual([{ included_by_default: 1 }])
    expect(kept.columns.map((column) => column.name)).not.toContain('kind')

    const schema = (await on(dataFolder, schemaOf)).join('\n')
    for (const table of [
      'workspace_repositories',
      'workspace_steps',
      'project_preparation_steps',
      'environment_variables',
    ]) {
      expect(schema).toContain(table)
    }

    // And the Journal says what was done to the data: the first opening, then this one.
    expect(kept.events.map((event) => event.type)).toEqual([
      'profile.opened',
      'profile.migrated',
      'profile.opened',
      'profile.backed_up',
      'profile.migrated',
    ])
    expect(JSON.parse(kept.events.at(-1)!.payload)).toEqual({ migration: WORKSPACES_MIGRATION })
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
})
