/**
 * What the data folder keeps of the application's preferences, on a database made for each test.
 */

import { DEFAULT_PREFERENCES } from '@hemera/ipc'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { openProfile } from '../src/engine/migrate.ts'
import {
  THEME_KEY,
  USER_LANGUAGE_KEY,
  systemLanguage,
  readPreferences,
  writePreferences,
} from '../src/engine/preferences.ts'
import { SqliteClient } from '../src/engine/storage/database.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

let data: string

beforeEach(async () => {
  data = temporaryFolder('preferences')
  await on(data, openProfile(data, SHIPPED, '1.0.0'))
})
afterEach(removeFolders)

const keys = Effect.gen(function* () {
  const client = yield* SqliteClient
  return yield* client<{ key: string; value: string }>`SELECT key, value FROM app_preferences`
})

describe('The tester mode is a preference, off by default (#45)', () => {
  test('turned on, it is read back on; turned off, off', async () => {
    expect((await on(data, readPreferences)).testerMode).toBe(false)
    await on(data, writePreferences({ testerMode: true }))
    expect((await on(data, readPreferences)).testerMode).toBe(true)
    await on(data, writePreferences({ testerMode: false }))
    expect((await on(data, readPreferences)).testerMode).toBe(false)
  })
})

describe('The theme is kept in the Profile', () => {
  test('a Profile where nothing was chosen answers the defaults', async () => {
    expect(await on(data, readPreferences)).toEqual({
      theme: DEFAULT_PREFERENCES.theme,
      userLanguage: systemLanguage(),
      testerMode: false,
    })
    expect(DEFAULT_PREFERENCES.theme).toBe('system')
  })

  test.each(['light', 'dark', 'system'] as const)(
    'a theme written as %s is read back as such at the next start',
    async (theme) => {
      await on(data, writePreferences({ theme: theme === 'system' ? 'dark' : 'light' }))
      await on(data, writePreferences({ theme }))
      expect((await on(data, readPreferences)).theme).toBe(theme)
    },
  )

  test('writing it again replaces the row, as the JSON of its schema', async () => {
    await on(data, writePreferences({ theme: 'dark' }))
    await on(data, writePreferences({ theme: 'light' }))
    expect(await on(data, keys)).toEqual([{ key: THEME_KEY, value: '"light"' }])
  })

  test('a change that names no key writes nothing', async () => {
    await on(data, writePreferences({}))
    expect(await on(data, keys)).toEqual([])
  })
})

describe('The language the agents speak to the user', () => {
  test('is the system’s until one is chosen, then the one chosen', async () => {
    expect((await on(data, readPreferences)).userLanguage).toBe(systemLanguage())
    await on(data, writePreferences({ userLanguage: 'fr' }))
    expect((await on(data, readPreferences)).userLanguage).toBe('fr')
    expect(await on(data, keys)).toEqual([{ key: USER_LANGUAGE_KEY, value: '"fr"' }])
  })
})

describe('An unreadable preference never holds the window shut', () => {
  test.each([
    ['a theme this version does not know', '"sepia"'],
    ['a value that is not even JSON', 'dark'],
    ['a value of another shape', '{"theme":"dark"}'],
  ])('%s is ignored and the default applies', async (_, value) => {
    await on(
      data,
      Effect.gen(function* () {
        const client = yield* SqliteClient
        yield* client`INSERT INTO app_preferences (key, value) VALUES (${THEME_KEY}, ${value})`
      }),
    )
    expect((await on(data, readPreferences)).theme).toBe(DEFAULT_PREFERENCES.theme)
  })
})
