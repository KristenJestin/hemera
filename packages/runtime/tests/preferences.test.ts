import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_BOUNDS,
  DEFAULT_PREFERENCES,
  PREFERENCE_KEYS,
  loadPreferences,
  openProfile,
  savePreferences,
} from '#index.ts'
import type { DisplayPreferences, OpenProfile } from '#index.ts'

const NOW = 1_789_000_000_000

function withProfile(body: (profile: OpenProfile, directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-preferences-'))
  const profile = openProfile({ directory, now: NOW })
  try {
    body(profile, directory)
  } finally {
    profile.database.close(true)
    rmSync(directory, { recursive: true, force: true })
  }
}

const CHOSEN: DisplayPreferences = {
  theme: 'light',
  sidebarWidth: 320,
  sidebarCollapsed: true,
  activeProject: 'p1',
}

describe('Réouverture après redémarrage', () => {
  test('the layout chosen is restored from the profile', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-preferences-'))
    try {
      const first = openProfile({ directory, now: NOW })
      savePreferences(first.database, CHOSEN, NOW)
      first.database.close(true)

      const second = openProfile({ directory, now: NOW + 1 })
      try {
        const loaded = loadPreferences(second.database, NOW + 1)
        expect(loaded.preferences).toEqual(CHOSEN)
        expect(loaded.repaired).toEqual([])
      } finally {
        second.database.close(true)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('a stored layout does not shrink at each launch', () => {
    withProfile((profile) => {
      savePreferences(profile.database, CHOSEN, NOW)
      let width = CHOSEN.sidebarWidth
      for (let launch = 0; launch < 5; launch += 1) {
        width = loadPreferences(profile.database, NOW + launch).preferences.sidebarWidth
        expect(width).toBe(CHOSEN.sidebarWidth)
      }
    })
  })
})

describe('Préférence absente ou invalide', () => {
  test('an empty profile opens on the defaults without failing', () => {
    withProfile((profile) => {
      const loaded = loadPreferences(profile.database, NOW)
      expect(loaded.preferences).toEqual(DEFAULT_PREFERENCES)
      expect(loaded.repaired).toContain(PREFERENCE_KEYS.theme)
    })
  })

  test('a width out of bounds falls back to the default and is rewritten', () => {
    withProfile((profile) => {
      for (const stored of [String(DEFAULT_BOUNDS.sidebarWidth.min - 1), '9000', 'wide']) {
        profile.database.run(
          `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [PREFERENCE_KEYS.sidebarWidth, stored, NOW],
        )
        const loaded = loadPreferences(profile.database, NOW)
        expect(loaded.preferences.sidebarWidth).toBe(DEFAULT_PREFERENCES.sidebarWidth)
        expect(loaded.repaired).toContain(PREFERENCE_KEYS.sidebarWidth)

        // The repaired value is what the next launch reads.
        expect(loadPreferences(profile.database, NOW).preferences.sidebarWidth).toBe(
          DEFAULT_PREFERENCES.sidebarWidth,
        )
      }
    })
  })

  test('an unknown theme falls back to the default', () => {
    withProfile((profile) => {
      profile.database.run(
        'INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)',
        [PREFERENCE_KEYS.theme, 'solarized', NOW],
      )
      const loaded = loadPreferences(profile.database, NOW)
      expect(loaded.preferences.theme).toBe(DEFAULT_PREFERENCES.theme)
      expect(loaded.repaired).toContain(PREFERENCE_KEYS.theme)
    })
  })

  test('a width within the bounds is kept as it is', () => {
    withProfile((profile) => {
      savePreferences(profile.database, { ...DEFAULT_PREFERENCES, sidebarWidth: 300 }, NOW)
      const loaded = loadPreferences(profile.database, NOW)
      expect(loaded.preferences.sidebarWidth).toBe(300)
      expect(loaded.repaired).toEqual([])
    })
  })
})

describe('Emplacement des préférences', () => {
  test('the preferences sit in the profile database, not in a temporary file', () => {
    withProfile((profile, directory) => {
      savePreferences(profile.database, CHOSEN, NOW)
      const rows = profile.database.query('SELECT key FROM app_preferences ORDER BY key').all() as {
        key: string
      }[]
      expect(rows.map((row) => row.key)).toContain(PREFERENCE_KEYS.sidebarWidth)
      // The profile directory is the one the caller named, never the system temporary root.
      expect(profile.path.startsWith(directory)).toBe(true)
    })
  })

  test('preferences are presentation only and hold no business state', () => {
    withProfile((profile) => {
      savePreferences(profile.database, CHOSEN, NOW)
      const keys = (
        profile.database.query('SELECT key FROM app_preferences').all() as { key: string }[]
      ).map((row) => row.key)
      for (const key of keys) {
        expect(key.startsWith('display.') || key.startsWith('navigation.')).toBe(true)
      }
      // Nothing of the journal or of the business tables lives here.
      expect(keys.some((key) => key.includes('session') || key.includes('event'))).toBe(false)
    })
  })

  test('clearing the active project removes its row rather than storing an empty one', () => {
    withProfile((profile) => {
      savePreferences(profile.database, CHOSEN, NOW)
      savePreferences(profile.database, { ...CHOSEN, activeProject: null }, NOW + 1)
      expect(loadPreferences(profile.database, NOW + 1).preferences.activeProject).toBeNull()
      expect(
        profile.database
          .query('SELECT COUNT(*) AS n FROM app_preferences WHERE key = ?')
          .get(PREFERENCE_KEYS.activeProject),
      ).toEqual({ n: 0 })
    })
  })
})
