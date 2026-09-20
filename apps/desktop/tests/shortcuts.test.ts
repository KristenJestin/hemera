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
  rankOf,
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
    // A Session is started from wherever the hand is, the composer of the Home included.
    expect(inFields('Mod+N')).toBe(true)
  })

  test('a new Session has a keystroke of its own, and it is registered', () => {
    const declared = SHORTCUTS.find((shortcut) => shortcut.action.kind === 'new-session')
    expect(declared?.combination).toBe('Mod+N')
    expect(keysOf('new-session')).not.toContain('Mod')
    expect(
      registrationsOf(SHORTCUTS, () => undefined).some(
        (registration) => registration.hotkey === 'Mod+N',
      ),
    ).toBe(true)
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
    // Every one but the nine ranks, which are read off the physical key instead: `Mod+1` is a
    // place on the keyboard, and on a layout whose digit row is shifted no character matcher
    // ever sees it.
    const characters = SHORTCUTS.filter((shortcut) => shortcut.action.kind !== 'project')
    const registrations = registrationsOf(SHORTCUTS, () => undefined)
    expect(registrations).toHaveLength(characters.length)
    expect(new Set(registrations.map((registration) => registration.hotkey)).size).toBe(
      characters.length,
    )
  })

  test('a rank is the key of the digit row, whatever that key writes', () => {
    const pressed = (code: string, ctrlKey: boolean, shiftKey = false): KeyboardEvent =>
      // SAFETY: `rankOf` reads `code`, `ctrlKey`, `metaKey` and `altKey`, and nothing else; a
      // test on Node has no `KeyboardEvent` to build, and this stands in for one.
      ({ code, ctrlKey, shiftKey, metaKey: false, altKey: false }) as KeyboardEvent

    expect(rankOf(pressed('Digit2', true), 'other')).toBe(2)
    // Shifted, which is what `Ctrl+2` *is* on a layout whose digit row needs Shift.
    expect(rankOf(pressed('Digit2', true, true), 'other')).toBe(2)
    // And nothing without the platform's modifier, or past the nine there are.
    expect(rankOf(pressed('Digit2', false), 'other')).toBeNull()
    expect(rankOf(pressed('Digit0', true), 'other')).toBeNull()
    expect(rankOf(pressed('KeyB', true), 'other')).toBeNull()
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
