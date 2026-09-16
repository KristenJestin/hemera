/**
 * What opening a profile does to it, and what it refuses to do (design D3-05).
 *
 * Each suite is named after the scenario of `specs/profile-storage/spec.md` it covers. Every
 * one of them works in a folder made for it and removed after it: the migrations are read from
 * a folder the test wrote, and the database is a file under a temporary directory. No profile
 * of this machine is opened, migrated or backed up — the last suite is there to say so.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'

import { profileDirectory } from '#main/channel.ts'
import {
  BACKUPS_FOLDER,
  MigrationError,
  ProfileAheadError,
  carriedMigrations,
  openProfile,
  standingOf,
} from '#profile/migrate.ts'
import { type Database, SqliteClient, databaseLayer } from '#profile/storage/database.ts'

/** The migration this application really ships, which is what a real start would read. */
const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'hemera-migrate-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

/** The file a profile keeps its database in, under the folder this test was given. */
function databaseFile(profile: string): string {
  mkdirSync(profile, { recursive: true })
  return join(profile, 'hemera.sqlite')
}

/** Runs a program against one database file, and closes it before answering. */
async function on<A, E>(
  profile: string,
  program: Effect.Effect<A, E, Database | SqliteClient>,
): Promise<A> {
  return await Effect.runPromise(
    Effect.scoped(Effect.provide(program, databaseLayer(databaseFile(profile)))),
  )
}

/** The same, for a program expected to fail: its refusal is the answer, typed as it was raised. */
async function refusalOn<A, E>(
  profile: string,
  program: Effect.Effect<A, E, Database | SqliteClient>,
): Promise<E> {
  return await on(profile, Effect.flip(program))
}

/**
 * The one table every profile has from its first migration, whatever else a test adds.
 *
 * A folder of migrations that did not create it would be a profile the application cannot
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

/** Every table the profile carries, asked of the database itself. */
const schemaOf = Effect.gen(function* () {
  const sql = yield* SqliteClient
  const rows = yield* sql<{ name: string; sql: string | null }>`
    SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name`
  return rows.map((row) => `${row.name}: ${row.sql ?? ''}`)
})

describe('Un profil neuf reçoit le schéma complet', () => {
  test('a profile that has never been opened is created with every migration applied', async () => {
    const profile = join(workspace, 'fresh')
    const standing = await on(profile, openProfile(profile, SHIPPED, '0.3.0'))

    expect(standing.ahead).toEqual([])
    expect(standing.behind).toEqual(carriedMigrations(SHIPPED).map((one) => one.name))

    const tables = await on(profile, schemaOf)
    expect(tables.join('\n')).toContain('app_preferences')
    expect(tables.join('\n')).toContain('profile')
  })

  test('opening it again finds nothing left to do', async () => {
    const profile = join(workspace, 'twice')
    await on(profile, openProfile(profile, SHIPPED, '0.3.0'))
    const again = await on(profile, openProfile(profile, SHIPPED, '0.3.0'))

    expect(again.behind).toEqual([])
    expect(again.ahead).toEqual([])
  })
})

describe('Neuf et migré donnent le même schéma', () => {
  test('a profile created by this version and one migrated up to it are the same', async () => {
    const two = migrationsFolder(
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
      'CREATE TABLE `added` (`id` integer PRIMARY KEY);',
    )

    // One profile walks both migrations from empty, as a new one does.
    const fresh = join(workspace, 'fresh')
    await on(fresh, openProfile(fresh, two, '0.3.0'))

    // The other is opened at the first migration, then brought up by the second.
    const one = migrationsFolder('CREATE TABLE `kept` (`id` integer PRIMARY KEY);')
    const migrated = join(workspace, 'migrated')
    await on(migrated, openProfile(migrated, one, '0.2.0'))
    await on(migrated, openProfile(migrated, two, '0.3.0'))

    expect(await on(migrated, schemaOf)).toEqual(await on(fresh, schemaOf))
  })
})

describe('Après migration, le profil dit qui l’a écrite', () => {
  test('the profile reports the migration it stands at and the version that wrote it', async () => {
    const profile = join(workspace, 'written')
    await on(profile, openProfile(profile, SHIPPED, '0.3.0'))

    const written = await on(
      profile,
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
    const profile = join(workspace, 'rewritten')
    await on(profile, openProfile(profile, SHIPPED, '0.3.0'))
    await on(profile, openProfile(profile, SHIPPED, '0.3.1'))

    const rows = await on(
      profile,
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
  test('a profile one migration behind is copied, under the name of what is about to run', async () => {
    const one = migrationsFolder('CREATE TABLE `kept` (`id` integer PRIMARY KEY);')
    const two = migrationsFolder(
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
      'CREATE TABLE `added` (`id` integer PRIMARY KEY);',
    )
    const profile = join(workspace, 'backed-up')
    await on(profile, openProfile(profile, one, '0.2.0'))

    const backups = join(profile, BACKUPS_FOLDER)
    expect(existsSync(backups)).toBe(false)

    const standing = await on(profile, openProfile(profile, two, '0.3.0'))
    expect(standing.behind).toHaveLength(1)
    expect(readdirSync(backups)).toEqual([`${standing.behind[0]!}.sqlite`])

    // And the migration did run: the copy is of before, the database is of after.
    expect((await on(profile, schemaOf)).join('\n')).toContain('added')
  })

  test('a profile that never held anything is not copied before its first migration', async () => {
    const profile = join(workspace, 'first-start')
    await on(profile, openProfile(profile, SHIPPED, '0.3.0'))
    expect(existsSync(join(profile, BACKUPS_FOLDER))).toBe(false)
  })
})

describe('Une migration qui échoue ne laisse rien à moitié', () => {
  test('a refused migration leaves the schema as it was, and the backup where it is', async () => {
    const one = migrationsFolder('CREATE TABLE `kept` (`id` integer PRIMARY KEY);')
    const broken = migrationsFolder(
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
    )
    const profile = join(workspace, 'broken')
    await on(profile, openProfile(profile, one, '0.2.0'))
    const before = await on(profile, schemaOf)

    const refused = await refusalOn(profile, openProfile(profile, broken, '0.3.0'))
    expect(refused).toBeInstanceOf(MigrationError)
    if (refused instanceof MigrationError) expect(refused.migrations).toHaveLength(1)

    expect(await on(profile, schemaOf)).toEqual(before)
    expect(readdirSync(join(profile, BACKUPS_FOLDER))).toHaveLength(1)
  })
})

describe('Une version ancienne trouve un profil migré par une plus récente', () => {
  test('a profile carrying a migration this version never heard of is refused, untouched', async () => {
    const one = migrationsFolder('CREATE TABLE `kept` (`id` integer PRIMARY KEY);')
    const two = migrationsFolder(
      'CREATE TABLE `kept` (`id` integer PRIMARY KEY);',
      'CREATE TABLE `added` (`id` integer PRIMARY KEY);',
    )
    const profile = join(workspace, 'ahead')
    await on(profile, openProfile(profile, two, '0.4.0-7-g1234'))
    const before = await on(profile, schemaOf)

    const refused = await refusalOn(profile, openProfile(profile, one, '0.3.0'))
    expect(refused).toBeInstanceOf(ProfileAheadError)
    if (refused instanceof ProfileAheadError) {
      expect(refused.writtenByVersion).toBe('0.4.0-7-g1234')
      expect(refused.migrations).toHaveLength(1)
    }

    // Nothing was written: not the schema, and not the version that wrote it.
    expect(await on(profile, schemaOf)).toEqual(before)
    const rows = await on(
      profile,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ written_by_version: string }>`SELECT written_by_version FROM profile`
      }),
    )
    expect(rows[0]?.written_by_version).toBe('0.4.0-7-g1234')
    expect(existsSync(join(profile, BACKUPS_FOLDER))).toBe(false)
  })

  test('being ahead is decided on what was applied, not on what it was called', () => {
    const carried = [{ name: 'one', hash: 'a' }]
    const applied = [
      { name: 'one', hash: 'a' },
      { name: 'two', hash: 'b' },
    ]
    expect(standingOf(carried, applied)).toEqual({ ahead: ['two'], behind: [] })
    expect(standingOf(applied, carried)).toEqual({ ahead: [], behind: ['two'] })
    expect(standingOf(carried, carried)).toEqual({ ahead: [], behind: [] })
  })
})

describe('Les tests de migration tournent sur un dossier temporaire', () => {
  test('every profile this suite opened is under the temporary directory it made', () => {
    expect(workspace.startsWith(tmpdir())).toBe(true)
  })

  test.each(['prod', 'dev'] as const)(
    'the %s profile of this machine is never where a test writes',
    (engraved) => {
      const real = profileDirectory(engraved, process.platform, process.env)
      expect(workspace.startsWith(real)).toBe(false)
      expect(real.startsWith(workspace)).toBe(false)
    },
  )
})
