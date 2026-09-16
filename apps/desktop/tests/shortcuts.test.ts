/**
 * What the keyboard of the shell claims about itself, read off the one table that declares it.
 *
 * Each suite is named after the scenario of `specs/window-shell/spec.md` it covers.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  SHORTCUTS,
  type Shortcut,
  conflictsIn,
  keysOf,
  registrationsOf,
  shownKeys,
} from '#renderer/shortcuts.ts'

describe('Raccourci hors saisie', () => {
  test('the sidebar and the Projects stay out of a field, the command and the settings do not', () => {
    const inFields = (combination: string): boolean =>
      SHORTCUTS.find((shortcut) => shortcut.combination === combination)!.inFields
    expect(inFields('Mod+B')).toBe(false)
    expect(inFields('Mod+1')).toBe(false)
    expect(inFields('Mod+K')).toBe(true)
    expect(inFields('Mod+,')).toBe(true)
  })

  test('the registration says it the way the manager reads it, which is the other way round', () => {
    const registrations = registrationsOf(SHORTCUTS, () => undefined)
    const ignoresInputs = (combination: string): boolean | undefined =>
      registrations.find((registration) => registration.hotkey === combination)?.options
        ?.ignoreInputs
    expect(ignoresInputs('Mod+B')).toBe(true)
    expect(ignoresInputs('Mod+K')).toBe(false)
  })

  test('every declared action is registered, and none is registered twice', () => {
    const registrations = registrationsOf(SHORTCUTS, () => undefined)
    expect(registrations).toHaveLength(SHORTCUTS.length)
    expect(new Set(registrations.map((registration) => registration.hotkey)).size).toBe(
      SHORTCUTS.length,
    )
  })

  test('a registration calls the action it was declared for', () => {
    const called: string[] = []
    const registrations = registrationsOf(SHORTCUTS, (action) => called.push(action.kind))
    // SAFETY: the callback reads neither the event nor the context, and a test on Node has no
    // browser to build either with; both stand in for what the manager passes.
    const nothing = undefined as never
    registrations[0]!.callback(nothing, nothing)
    expect(called).toEqual(['sidebar'])
  })
})

describe('Conflit refusé', () => {
  test('the table of this lot claims no combination twice', () => {
    expect(conflictsIn(SHORTCUTS)).toEqual([])
  })

  test('two actions on one combination are reported, naming the combination', () => {
    const doubled: Shortcut[] = [
      ...SHORTCUTS,
      {
        action: { kind: 'command' },
        combination: 'Mod+B',
        label: 'Something else',
        inFields: true,
      },
    ]
    expect(conflictsIn(doubled)).toEqual(['Mod+B'])
  })
})

describe('Raccourci affiché', () => {
  test('a keystroke is written for the platform, never as Mod', () => {
    expect(shownKeys('Mod+B')).not.toContain('Mod')
    expect(keysOf('command')).not.toContain('Mod')
    expect(keysOf('sidebar')).toMatch(/B$/)
  })

  test('the three actions the shell shows a keystroke for all have one', () => {
    for (const kind of ['sidebar', 'command', 'settings'] as const) {
      expect(keysOf(kind).length).toBeGreaterThan(0)
    }
  })
})
