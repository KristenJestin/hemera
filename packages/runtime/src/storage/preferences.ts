/**
 * Display preferences of the profile.
 *
 * They live in the profile database, beside the business state, so they share its backup and
 * its transaction — never in a temporary directory, never in a path proper to one system.
 * They are presentation only: nothing here is a second source of business truth.
 *
 * A stored value that is absent, unreadable or out of bounds falls back to the default and is
 * rewritten, rather than failing the start.
 */

import type { Database } from 'bun:sqlite'

/** Keys the profile stores, one per preference. */
export const PREFERENCE_KEYS = {
  theme: 'display.theme',
  sidebarWidth: 'display.sidebar.width',
  sidebarCollapsed: 'display.sidebar.collapsed',
  activeProject: 'navigation.activeProject',
} as const

export type PreferenceKey = (typeof PREFERENCE_KEYS)[keyof typeof PREFERENCE_KEYS]

export interface DisplayPreferences {
  theme: 'light' | 'dark'
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** Project selected when the window was last closed. */
  activeProject: string | null
}

export interface PreferenceBounds {
  sidebarWidth: { min: number; max: number }
}

/** What the window opens on when the profile says nothing. */
export const DEFAULT_PREFERENCES: DisplayPreferences = {
  theme: 'dark',
  sidebarWidth: 248,
  sidebarCollapsed: false,
  activeProject: null,
}

export const DEFAULT_BOUNDS: PreferenceBounds = {
  sidebarWidth: { min: 180, max: 420 },
}

function readRaw(database: Database): Map<string, string> {
  const rows = database.query('SELECT key, value FROM app_preferences').all() as {
    key: string
    value: string
  }[]
  return new Map(rows.map((row) => [row.key, row.value]))
}

function writeRaw(database: Database, key: string, value: string, now: number): void {
  database.run(
    `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now],
  )
}

function themeOrDefault(stored: string | undefined): DisplayPreferences['theme'] {
  return stored === 'light' || stored === 'dark' ? stored : DEFAULT_PREFERENCES.theme
}

function widthOrDefault(stored: string | undefined, bounds: PreferenceBounds): number {
  const width = Number(stored)
  if (!Number.isFinite(width)) return DEFAULT_PREFERENCES.sidebarWidth
  if (width < bounds.sidebarWidth.min || width > bounds.sidebarWidth.max) {
    return DEFAULT_PREFERENCES.sidebarWidth
  }
  return width
}

export interface LoadedPreferences {
  preferences: DisplayPreferences
  /** Keys whose stored value was absent or unusable and was rewritten. */
  repaired: PreferenceKey[]
}

/** Reads the preferences, repairing anything unusable instead of failing. */
export function loadPreferences(
  database: Database,
  now: number,
  bounds: PreferenceBounds = DEFAULT_BOUNDS,
): LoadedPreferences {
  const raw = readRaw(database)
  const repaired: PreferenceKey[] = []

  const theme = themeOrDefault(raw.get(PREFERENCE_KEYS.theme))
  if (raw.get(PREFERENCE_KEYS.theme) !== theme) repaired.push(PREFERENCE_KEYS.theme)

  const sidebarWidth = widthOrDefault(raw.get(PREFERENCE_KEYS.sidebarWidth), bounds)
  if (raw.get(PREFERENCE_KEYS.sidebarWidth) !== String(sidebarWidth)) {
    repaired.push(PREFERENCE_KEYS.sidebarWidth)
  }

  const storedCollapsed = raw.get(PREFERENCE_KEYS.sidebarCollapsed)
  const sidebarCollapsed = storedCollapsed === 'true'
  if (storedCollapsed !== String(sidebarCollapsed)) repaired.push(PREFERENCE_KEYS.sidebarCollapsed)

  const activeProject = raw.get(PREFERENCE_KEYS.activeProject) ?? null

  const preferences: DisplayPreferences = { theme, sidebarWidth, sidebarCollapsed, activeProject }
  if (repaired.length > 0) savePreferences(database, preferences, now)
  return { preferences, repaired }
}

/** Writes the preferences, in one transaction. */
export function savePreferences(
  database: Database,
  preferences: DisplayPreferences,
  now: number,
): void {
  const write = database.transaction(() => {
    writeRaw(database, PREFERENCE_KEYS.theme, preferences.theme, now)
    writeRaw(database, PREFERENCE_KEYS.sidebarWidth, String(preferences.sidebarWidth), now)
    writeRaw(database, PREFERENCE_KEYS.sidebarCollapsed, String(preferences.sidebarCollapsed), now)
    if (preferences.activeProject === null) {
      database.run('DELETE FROM app_preferences WHERE key = ?', [PREFERENCE_KEYS.activeProject])
    } else {
      writeRaw(database, PREFERENCE_KEYS.activeProject, preferences.activeProject, now)
    }
  })
  write()
}
