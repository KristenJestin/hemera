/**
 * What the one theme control cycles through (design D3-08).
 *
 * Each suite is named after the scenario of `specs/display-preferences/spec.md` it covers.
 * Before the profile, a two-state toggle was harmless: the preference lived in memory and
 * `system` came back on its own at the next start. Now that it is remembered, two states would
 * be a door out of following the desktop that never opens again.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { ThemePreference } from '@hemera/ipc'

import { nextThemePreference } from '#renderer/theme.ts'

describe('Retour au système', () => {
  test('the control comes back round to following the desktop', () => {
    expect(nextThemePreference('system')).toBe('light')
    expect(nextThemePreference('light')).toBe('dark')
    expect(nextThemePreference('dark')).toBe('system')
  })

  test.each<ThemePreference>(['system', 'light', 'dark'])(
    'from %s, every preference is reachable and the cycle closes on itself',
    (start) => {
      const walked: ThemePreference[] = []
      let preference = start
      for (let step = 0; step < 3; step += 1) {
        preference = nextThemePreference(preference)
        walked.push(preference)
      }

      expect(walked.toSorted()).toEqual(['dark', 'light', 'system'])
      expect(preference).toBe(start)
    },
  )

  test('following the desktop is never more than two presses away', () => {
    expect(nextThemePreference(nextThemePreference('light'))).toBe('system')
    expect(nextThemePreference('dark')).toBe('system')
  })
})
