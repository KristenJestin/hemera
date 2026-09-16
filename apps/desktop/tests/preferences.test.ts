/**
 * What the profile keeps of the window, and what it answers about itself (design D3-03).
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

import { openProfile } from '#profile/migrate.ts'
import { Preferences, SIDEBAR_KEY, THEME_KEY, preferencesLayer } from '#profile/preferences.ts'
import { ProfileStatus, profileStatusLayer } from '#profile/status.ts'
import { SqliteClient, databaseLayer } from '#profile/storage/database.ts'

/** The migration this application really ships. */
const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

let profile: string

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'hemera-preferences-'))
  mkdirSync(profile, { recursive: true })
})

afterEach(() => {
  rmSync(profile, { recursive: true, force: true })
})

/** A profile opened and migrated, with both services standing on it. */
function opened(version = '0.3.0') {
  const storage = databaseLayer(join(profile, 'hemera.sqlite'))
  const services = Layer.mergeAll(
    preferencesLayer,
    profileStatusLayer({ directory: profile, channel: 'dev', version }),
  ).pipe(Layer.provideMerge(storage))

  return <A, E>(program: Effect.Effect<A, E, Preferences | ProfileStatus | SqliteClient>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(profile, SHIPPED, version)
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
  test('a profile nobody has chosen anything in answers what the declaration calls default', async () => {
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

describe('Le process dédié répond profile.status', () => {
  test('it answers the folder, the channel, the version, the migration and the writer', async () => {
    const status = await opened('0.3.0')(
      Effect.gen(function* () {
        return yield* (yield* ProfileStatus).read
      }),
    )

    expect(status.directory).toBe(profile)
    expect(status.channel).toBe('dev')
    expect(status.version).toBe('0.3.0')
    expect(status.lastMigration).toMatch(/profile_and_preferences$/)
    expect(status.writtenByVersion).toBe('0.3.0')
  })
})
