/**
 * The application's preferences, read from the data folder and written back to it.
 *
 * One row per key, the value being the JSON of that key's `Schema`, decoded by the same schema
 * when it is read. A value this build cannot read (written by a version that knew more, or by
 * hand) is not an error: the default answers it. Refusing to start over a theme would be a window
 * held shut by a cosmetic.
 */

import {
  DEFAULT_PREFERENCES,
  Preferences as PreferencesSchema,
  type Preferences as PreferencesValue,
  type PreferencesChange,
} from '@hemera/ipc'
import { sql } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import { Database, type DatabaseError, refusedWhile } from './storage/database.ts'
import { appPreferences } from './storage/schema.ts'

/** How each key is kept: its schema, through JSON, as the text of its row. */
const stored = Schema.fromJsonString(Schema.toCodecJson(PreferencesSchema.fields.theme))
const readTheme = Schema.decodeUnknownOption(stored)
const writeTheme = Schema.encodeSync(stored)

export const THEME_KEY = 'theme'

/** The preferences, each key decoded or its default. */
export const readPreferences: Effect.Effect<PreferencesValue, DatabaseError, Database> = Effect.gen(
  function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(appPreferences)
      .pipe(Effect.mapError(refusedWhile('reading the preferences')))
    const kept = new Map(rows.map(({ key, value }) => [key, value]))
    return {
      theme: Option.getOrElse(readTheme(kept.get(THEME_KEY)), () => DEFAULT_PREFERENCES.theme),
    }
  },
)

/** Writes the keys a change names, and leaves the others as they are. */
export const writePreferences = (
  change: PreferencesChange,
): Effect.Effect<void, DatabaseError, Database> =>
  Effect.gen(function* () {
    const written: Array<{ key: string; value: string }> = []
    if (change.theme !== undefined)
      written.push({ key: THEME_KEY, value: writeTheme(change.theme) })
    if (written.length === 0) return
    const database = yield* Database
    yield* database
      .insert(appPreferences)
      .values(written)
      .onConflictDoUpdate({ target: appPreferences.key, set: { value: sql`excluded.value` } })
      .pipe(Effect.mapError(refusedWhile('writing the preferences')))
  })
