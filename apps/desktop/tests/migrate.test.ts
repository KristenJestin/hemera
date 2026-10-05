/**
 * What opening a data folder does to it, and what it refuses to do. Every data folder here is a
 * temporary one; the migrations are the shipped ones, followed by later ones a test writes.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { Effect } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { readEvents } from '../src/engine/journal.ts'
import {
  BACKUPS_FOLDER,
  DATABASE_FILE,
  MigrationFailed,
  ProfileAhead,
  carriedMigrations,
  openProfile,
  standingOf,
} from '../src/engine/migrate.ts'
import { SqliteClient } from '../src/engine/storage/database.ts'
import {
  SHIPPED,
  migrationsWith,
  on,
  refusalOn,
  removeFolders,
  temporaryFolder,
} from './storage.ts'

afterEach(removeFolders)

const tablesOf = Effect.gen(function* () {
  const sql = yield* SqliteClient
  const rows = yield* sql<{ name: string; sql: string | null }>`
    SELECT name, sql FROM sqlite_master
    WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'
    ORDER BY name`
  return rows.map((row) => `${row.name}: ${row.sql ?? ''}`)
})

const typesOf = Effect.map(readEvents({}), (page) => page.events.map((event) => event.type))

/** Every file under a folder with the hash of its bytes. */
function fingerprint(folder: string): Map<string, string> {
  const hashes = new Map<string, string>()
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) walk(path)
      else
        hashes.set(
          relative(folder, path),
          createHash('sha256').update(readFileSync(path)).digest('hex'),
        )
    }
  }
  walk(folder)
  return hashes
}

describe('A fresh data folder gets the 1.0 schema', () => {
  test('in hemera-1.sqlite, with the tables of the schema and a profile.created event', async () => {
    const data = temporaryFolder('fresh')
    const opened = await on(data, openProfile(data, SHIPPED, '1.0.0'))

    expect(existsSync(join(data, DATABASE_FILE))).toBe(true)
    expect(opened.ahead).toEqual([])
    expect(opened.behind).toEqual(carriedMigrations(SHIPPED).map(({ name }) => name))
    expect(opened.backedUp).toBeNull()

    const tables = (await on(data, tablesOf)).map((line) => line.split(':')[0])
    expect(tables).toEqual([
      'agent_sessions',
      'app_preferences',
      'command_runs',
      'domain_events',
      'environment_variables',
      'event_by_entity',
      'key_prefix_once',
      'mission_marks',
      'mission_stops',
      'missions',
      'missions_by_project',
      'need_deliveries',
      'needs',
      'needs_by_mission',
      'needs_by_state',
      'profile',
      'project_commands',
      'project_preparation_steps',
      'project_repositories',
      'projects',
      'runs_by_place',
      'supervised_processes',
      'variables_by_scope',
      'workspace_repositories',
      'workspace_steps',
      'workspaces',
    ])
    expect(await on(data, typesOf)).toEqual([
      'profile.created',
      'profile.migrated',
      'profile.opened',
    ])
    // A database that never held anything has nothing to back up.
    expect(existsSync(join(data, BACKUPS_FOLDER))).toBe(false)
  })

  test('opened again, it finds nothing to do and only writes down the opening', async () => {
    const data = temporaryFolder('twice')
    await on(data, openProfile(data, SHIPPED, '1.0.0'))
    const again = await on(data, openProfile(data, SHIPPED, '1.0.1'))

    expect(again.behind).toEqual([])
    expect((await on(data, typesOf)).slice(3)).toEqual(['profile.opened'])
    const rows = await on(
      data,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{
          created_by_version: string
          last_opened_by_version: string
        }>`SELECT created_by_version, last_opened_by_version FROM profile`
      }),
    )
    expect(rows).toEqual([{ created_by_version: '1.0.0', last_opened_by_version: '1.0.1' }])
  })
})

describe('A data folder of 0.x is left alone', () => {
  test('its hemera.sqlite, backups/ and traces/ are byte-for-byte unchanged', async () => {
    const data = temporaryFolder('legacy')
    const legacy = new DatabaseSync(join(data, 'hemera.sqlite'))
    legacy.exec('CREATE TABLE projects (id text PRIMARY KEY, name text)')
    legacy.exec("INSERT INTO projects VALUES ('p1', 'Atlas')")
    legacy.close()
    mkdirSync(join(data, 'backups'))
    writeFileSync(join(data, 'backups', '20260916123330_profile_and_preferences.sqlite'), 'copy')
    mkdirSync(join(data, 'traces'))
    writeFileSync(join(data, 'traces', 'session.jsonl'), '{"line":1}\n')
    const before = fingerprint(data)

    await on(data, openProfile(data, SHIPPED, '1.0.0'))
    await on(data, openProfile(data, SHIPPED, '1.0.0'))

    const after = fingerprint(data)
    for (const [file, hash] of before) expect(after.get(file)).toBe(hash)
    const added = [...after.keys()].filter((file) => !before.has(file))
    expect(added).toContain(DATABASE_FILE)
    expect(added.every((file) => file.startsWith('hemera-1.sqlite'))).toBe(true)
  })
})

describe('A data folder one migration behind', () => {
  test('is backed up into backups-1 under the migration about to run, then migrated', async () => {
    const data = temporaryFolder('behind')
    await on(data, openProfile(data, SHIPPED, '1.0.0'))

    const later = migrationsWith('CREATE TABLE `added` (`id` integer PRIMARY KEY);')
    const opened = await on(data, openProfile(data, later, '1.1.0'))

    expect(opened.behind).toEqual(['20990101000000_later_0'])
    expect(readdirSync(join(data, BACKUPS_FOLDER))).toEqual(['20990101000000_later_0.sqlite'])
    expect((await on(data, tablesOf)).join('\n')).toContain('added')
    // The backup is of before: the table the migration added is not in it.
    const backup = new DatabaseSync(join(data, BACKUPS_FOLDER, '20990101000000_later_0.sqlite'))
    const tables = backup.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    backup.close()
    expect(tables.map((row) => row.name)).not.toContain('added')
    expect(tables.map((row) => row.name)).toContain('profile')
  })
})

describe('A data folder written by a newer Hemera', () => {
  test('is refused with the sentence, and left untouched', async () => {
    const data = temporaryFolder('ahead')
    const later = migrationsWith('CREATE TABLE `added` (`id` integer PRIMARY KEY);')
    await on(data, openProfile(data, later, '1.1.0'))
    const before = await on(data, tablesOf)
    const events = await on(data, typesOf)

    const refused = await refusalOn(data, openProfile(data, SHIPPED, '1.0.0'))
    expect(refused).toBeInstanceOf(ProfileAhead)
    expect(refused.message).toBe(
      'This data folder was written by a newer version of Hemera and cannot be opened by this one.',
    )
    if (refused instanceof ProfileAhead) expect(refused.writtenByVersion).toBe('1.1.0')

    expect(await on(data, tablesOf)).toEqual(before)
    expect(await on(data, typesOf)).toEqual(events)
    expect(existsSync(join(data, BACKUPS_FOLDER))).toBe(false)
  })

  test('being ahead is decided on what was applied, not on what it was called', () => {
    const carried = [{ name: 'one', hash: 'a' }]
    const applied = [...carried, { name: 'two', hash: 'b' }]
    expect(standingOf(carried, applied)).toEqual({ ahead: ['two'], behind: [] })
    expect(standingOf(applied, carried)).toEqual({ ahead: [], behind: ['two'] })
    expect(standingOf([{ name: 'renamed', hash: 'a' }], carried)).toEqual({ ahead: [], behind: [] })
  })
})

describe('A migration that fails', () => {
  test('reports a typed error, leaves the schema as it was, and keeps its backup', async () => {
    const data = temporaryFolder('broken')
    await on(data, openProfile(data, SHIPPED, '1.0.0'))
    const before = await on(data, tablesOf)

    const broken = migrationsWith(
      'CREATE TABLE `added` (`id` integer PRIMARY KEY);\n--> statement-breakpoint\nCREATE TABLE `profile` (`id` integer);',
    )
    const refused = await refusalOn(data, openProfile(data, broken, '1.1.0'))

    expect(refused).toBeInstanceOf(MigrationFailed)
    if (refused instanceof MigrationFailed) {
      expect(refused.migrations).toEqual(['20990101000000_later_0'])
      expect(refused.backup).toBe(join(data, BACKUPS_FOLDER, '20990101000000_later_0.sqlite'))
      expect(existsSync(refused.backup ?? '')).toBe(true)
    }
    expect(await on(data, tablesOf)).toEqual(before)
  })
})

describe('The migration tests run on temporary folders', () => {
  test('every data folder this suite opens is under the temporary directory', () => {
    expect(temporaryFolder('where').startsWith(tmpdir())).toBe(true)
  })
})
