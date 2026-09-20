/**
 * What the data folder keeps of the window, and what it answers about itself (design D3-03).
 *
 * These are the two services the process that holds the database exposes, exercised directly
 * on a database made for each test and removed after it. What the page eventually sees of them
 * is settled end to end in lot 3's own suite; what they store and answer is settled here.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferencesChange } from '@hemera/ipc'

import { carriedMigrations, openProfile } from '#engine/migrate.ts'
import { Preferences, SIDEBAR_KEY, THEME_KEY, preferencesLayer } from '#engine/preferences.ts'
import { EngineStatus, engineStatusLayer } from '#engine/status.ts'
import { SqliteClient, databaseLayer } from '#engine/storage/database.ts'

/** The migration this application really ships. */
const SHIPPED = join(import.meta.dirname, '..', 'drizzle')
/**
 * The last migration this application ships, which is where a freshly opened profile stands.
 *
 * Read from the folder rather than named, because the name changes with every lot that touches
 * the schema and what is under test is that the status reports it, not which one it is.
 */
const LAST_MIGRATION = carriedMigrations(SHIPPED).at(-1)?.name

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-preferences-'))
  mkdirSync(dataFolder, { recursive: true })
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

/** A data folder opened and migrated, with both services standing on it. */
function opened(version = '0.3.0') {
  const storage = databaseLayer(join(dataFolder, 'hemera.sqlite'))
  const services = Layer.mergeAll(
    preferencesLayer,
    engineStatusLayer({ directory: dataFolder, channel: 'dev', version }),
  ).pipe(Layer.provideMerge(storage))

  return <A, E>(program: Effect.Effect<A, E, Preferences | EngineStatus | SqliteClient>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(dataFolder, SHIPPED, version)
            return yield* program
          }),
          services,
        ),
      ),
    )
}

const readPreferences = Effect.gen(function* () {
  return yield* (yield* Preferences).read
})

function writePreferences(change: DisplayPreferencesChange) {
  return Effect.gen(function* () {
    yield* (yield* Preferences).write(change)
  })
}

describe('Le thème et la sidebar sont persistés dans le profil', () => {
  test('a data folder nobody has chosen anything in answers what the declaration calls default', async () => {
    expect(await opened()(readPreferences)).toEqual(DEFAULT_DISPLAY_PREFERENCES)
  })

  test('a theme that was written is the theme that is read back', async () => {
    const run = opened()
    await run(writePreferences({ theme: 'dark' }))
    expect((await run(readPreferences)).theme).toBe('dark')
  })

  test('a sidebar that was folded and widened is read back folded and widened', async () => {
    const run = opened()
    await run(writePreferences({ sidebar: { collapsed: true, width: 320 } }))
    expect((await run(readPreferences)).sidebar).toEqual({ collapsed: true, width: 320 })
  })

  test('writing one of them leaves the other exactly as it was', async () => {
    const run = opened()
    await run(writePreferences({ theme: 'dark', sidebar: { collapsed: true, width: 280 } }))
    await run(writePreferences({ theme: 'light' }))

    const read = await run(readPreferences)
    expect(read.theme).toBe('light')
    expect(read.sidebar).toEqual({ collapsed: true, width: 280 })
  })

  test('writing the same preference again replaces it rather than adding a row', async () => {
    const run = opened()
    await run(writePreferences({ theme: 'dark' }))
    await run(writePreferences({ theme: 'light' }))

    const rows = await run(
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ key: string }>`SELECT key FROM app_preferences`
      }),
    )
    expect(rows).toHaveLength(1)
  })

  test('a change that changes nothing writes nothing', async () => {
    const run = opened()
    await run(writePreferences({}))

    const rows = await run(
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        return yield* sql<{ key: string }>`SELECT key FROM app_preferences`
      }),
    )
    expect(rows).toEqual([])
  })
})

describe('Retour au système', () => {
  test('going back to the system theme is a preference like any other, and it persists', async () => {
    const run = opened()
    await run(writePreferences({ theme: 'dark' }))
    await run(writePreferences({ theme: 'system' }))
    expect((await run(readPreferences)).theme).toBe('system')
  })
})

describe('Une préférence illisible ne tient pas la fenêtre fermée', () => {
  test.each([
    ['a theme this version does not know', THEME_KEY, 'sepia'],
    ['a sidebar that is not what it should be', SIDEBAR_KEY, '{"collapsed":"yes"}'],
    ['a value that is not even JSON', SIDEBAR_KEY, 'not json at all'],
  ])('%s falls back to the default instead of failing', async (_case, key, value) => {
    const run = opened()
    await run(
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO app_preferences (key, value) VALUES (${key}, ${value})`
      }),
    )
    expect(await run(readPreferences)).toEqual(DEFAULT_DISPLAY_PREFERENCES)
  })
})

describe('Projet actif restauré', () => {
  test('the Project that was being looked at is there at the next start', async () => {
    const run = opened()
    await run(writePreferences({ activeProjectId: 'atlas' }))

    // A second opening of the same data folder, which is what the next start is.
    const read = await opened()(readPreferences)
    expect(read.activeProjectId).toBe('atlas')
  })

  test('null is a value and not an absence: it is what archiving the last one writes', async () => {
    const run = opened()
    await run(writePreferences({ activeProjectId: 'atlas' }))
    await run(writePreferences({ activeProjectId: null }))

    expect((await opened()(readPreferences)).activeProjectId).toBeNull()
  })

  test('a change that says nothing about the Project leaves it where it was', async () => {
    const run = opened()
    await run(writePreferences({ activeProjectId: 'atlas' }))
    await run(writePreferences({ theme: 'dark' }))

    expect((await opened()(readPreferences)).activeProjectId).toBe('atlas')
  })
})

describe('Session sélectionnée conservée', () => {
  test('the Session open in each Project is there at the next start', async () => {
    const run = opened()
    await run(writePreferences({ activeSessionIds: { atlas: 'first', orion: 'second' } }))

    // A second opening of the same data folder, which is what the next start is.
    const read = await opened()(readPreferences)
    expect(read.activeSessionIds).toEqual({ atlas: 'first', orion: 'second' })
  })

  test('a Project nobody has opened a Session in is not in the map at all', async () => {
    expect((await opened()(readPreferences)).activeSessionIds).toEqual({})
  })
})

describe('Le process dédié répond engine.status', () => {
  test('it answers the folder, the channel, the version, the migration and the writer', async () => {
    const status = await opened('0.3.0')(
      Effect.gen(function* () {
        return yield* (yield* EngineStatus).read
      }),
    )

    expect(status.directory).toBe(dataFolder)
    expect(status.channel).toBe('dev')
    expect(status.version).toBe('0.3.0')
    expect(status.lastMigration).toBe(LAST_MIGRATION)
    expect(status.writtenByVersion).toBe('0.3.0')
  })
})
