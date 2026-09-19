/**
 * What the window wears, read from the data folder and written back to it (design D3-03).
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
  activeProjectSchema,
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

/** The keys these are filed under, which are the names the declaration uses. */
export const THEME_KEY = 'theme'
export const SIDEBAR_KEY = 'sidebar'
export const ACTIVE_PROJECT_KEY = 'activeProjectId'

function themeOf(value: string | undefined): ThemePreference | null {
  if (value === undefined) return null
  const read = themePreferenceSchema.safeParse(value)
  return read.success ? read.data : null
}

/**
 * Which Project was being looked at, or null when the row says something this version cannot
 * read — which answers the same way as never having chosen one.
 */
function activeProjectOf(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined
  try {
    const read = activeProjectSchema.safeParse(JSON.parse(value))
    return read.success ? read.data : undefined
  } catch {
    return undefined
  }
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
          activeProjectId:
            activeProjectOf(stored.get(ACTIVE_PROJECT_KEY)) ??
            DEFAULT_DISPLAY_PREFERENCES.activeProjectId,
        }
      }),

      write: (change: DisplayPreferencesChange) =>
        Effect.gen(function* () {
          const written: { key: string; value: string }[] = []
          if (change.theme !== undefined) written.push({ key: THEME_KEY, value: change.theme })
          if (change.sidebar !== undefined) {
            written.push({ key: SIDEBAR_KEY, value: JSON.stringify(change.sidebar) })
          }
          // `null` is a value here and not an absence: it is what the shell writes the moment
          // the Project that was active is archived, and `undefined` is what it writes when it
          // is not saying anything about a Project at all.
          if (change.activeProjectId !== undefined) {
            written.push({
              key: ACTIVE_PROJECT_KEY,
              value: JSON.stringify(change.activeProjectId),
            })
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
