/**
 * What the window wears, read from the profile and written back to it (design D3-03).
 *
 * One row per preference rather than one column per preference: the shell gains controls lot
 * after lot, and a table that grew a column for each of them would be a migration for each of
 * them too. What a row holds is the shape the shared declaration describes, so the page reads
 * back exactly what it wrote, validated by the same schema on the way in and on the way out.
 *
 * A value this version cannot read is not an error: it is a preference set by a version that
 * knew more, and the answer to it is the default. Refusing to start over a sidebar width would
 * be a cockpit held shut by a cosmetic.
 */

import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences,
  type DisplayPreferencesChange,
  type SidebarPreference,
  type ThemePreference,
  sidebarPreferenceSchema,
  themePreferenceSchema,
} from '@hemera/ipc'
import { sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { Database, DatabaseError } from './storage/database.ts'
import { appPreferences } from './storage/schema.ts'

/** The keys the profile files these under, which are the names the declaration uses. */
export const THEME_KEY = 'theme'
export const SIDEBAR_KEY = 'sidebar'

function themeOf(value: string | undefined): ThemePreference | null {
  if (value === undefined) return null
  const read = themePreferenceSchema.safeParse(value)
  return read.success ? read.data : null
}

function sidebarOf(value: string | undefined): SidebarPreference | null {
  if (value === undefined) return null
  try {
    const read = sidebarPreferenceSchema.safeParse(JSON.parse(value))
    return read.success ? read.data : null
  } catch {
    // A row that is not JSON at all was not written by this application; the default answers it.
    return null
  }
}

export class Preferences extends Context.Service<
  Preferences,
  {
    readonly read: Effect.Effect<DisplayPreferences, DatabaseError>
    readonly write: (change: DisplayPreferencesChange) => Effect.Effect<void, DatabaseError>
  }
>()('Preferences') {}

export const preferencesLayer = Layer.effect(
  Preferences,
  Effect.gen(function* () {
    const database = yield* Database

    const rowsOf = (doing: string) =>
      database
        .select()
        .from(appPreferences)
        .pipe(Effect.mapError((cause) => new DatabaseError({ doing, cause })))

    return {
      read: Effect.gen(function* () {
        const rows = yield* rowsOf('reading the preferences')
        const stored = new Map(rows.map((row) => [row.key, row.value]))
        return {
          theme: themeOf(stored.get(THEME_KEY)) ?? DEFAULT_DISPLAY_PREFERENCES.theme,
          sidebar: sidebarOf(stored.get(SIDEBAR_KEY)) ?? DEFAULT_DISPLAY_PREFERENCES.sidebar,
        }
      }),

      write: (change: DisplayPreferencesChange) =>
        Effect.gen(function* () {
          const written: { key: string; value: string }[] = []
          if (change.theme !== undefined) written.push({ key: THEME_KEY, value: change.theme })
          if (change.sidebar !== undefined) {
            written.push({ key: SIDEBAR_KEY, value: JSON.stringify(change.sidebar) })
          }
          if (written.length === 0) return

          yield* database
            .insert(appPreferences)
            .values(written)
            .onConflictDoUpdate({
              target: appPreferences.key,
              set: { value: sql`excluded.value` },
            })
            .pipe(
              Effect.mapError(
                (cause) => new DatabaseError({ doing: 'writing the preferences', cause }),
              ),
            )
        }),
    }
  }),
)
