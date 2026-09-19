import {
  type Hotkey,
  type UseHotkeyDefinition,
  detectPlatform,
  formatForDisplay,
  useHotkeys,
} from '@tanstack/react-hotkeys'
import { useEffect, useRef } from 'react'

/**
 * The keyboard of the shell, declared once (design D2-06).
 *
 * One table, and everything else reads it: what is registered, what is shown beside an action,
 * and what a test checks for conflicts. `Mod` is the platform's own modifier and TanStack
 * resolves it, so nothing here says Ctrl or Command and nothing here asks what the machine is.
 *
 * A shortcut is refused while a field has the focus unless it still means something there:
 * Ctrl+B in a text field is a bold, or it is nothing, but it is certainly not a sidebar; the
 * command and the settings are the two that a field never wanted.
 */

/** The Projects the keyboard can reach by rank, which is as many as there are digits. */
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export type ShortcutAction =
  | { kind: 'sidebar' }
  | { kind: 'command' }
  | { kind: 'settings' }
  | { kind: 'project'; rank: number }

export interface Shortcut {
  /** What pressing it does. */
  action: ShortcutAction
  /** The combination, `Mod` standing for whichever modifier the platform uses. */
  combination: Hotkey
  /** What the action is called where the keystroke is shown beside it. */
  label: string
  /** Whether it still means something while a field has the focus. */
  inFields: boolean
}

export const SHORTCUTS: Shortcut[] = [
  {
    action: { kind: 'sidebar' },
    combination: 'Mod+B',
    label: 'Toggle the sidebar',
    inFields: false,
  },
  { action: { kind: 'command' }, combination: 'Mod+K', label: 'Open the command', inFields: true },
  {
    action: { kind: 'settings' },
    combination: 'Mod+,',
    label: 'Open the settings',
    inFields: true,
  },
  ...RANKS.map((digit, index) => ({
    action: { kind: 'project' as const, rank: index + 1 },
    combination: `Mod+${digit}` as const,
    label: `Go to Project ${digit}`,
    inFields: false,
  })),
]

/** Combinations more than one action claims. A table with one of these is a bug, not a choice. */
export function conflictsIn(shortcuts: Shortcut[]): string[] {
  const claimed = new Set<Hotkey>()
  const conflicts: string[] = []
  for (const shortcut of shortcuts) {
    if (claimed.has(shortcut.combination)) conflicts.push(shortcut.combination)
    claimed.add(shortcut.combination)
  }
  return conflicts
}

/** A combination as the platform writes it, which is what the keys on screen say. */
export function shownKeys(combination: Hotkey): string {
  return formatForDisplay(combination)
}

/** The keystroke of one of the three named actions, ready to be drawn as keys. */
export function keysOf(kind: 'sidebar' | 'command' | 'settings'): string {
  const found = SHORTCUTS.find((shortcut) => shortcut.action.kind === kind)
  if (found === undefined) throw new Error(`no shortcut is declared for ${kind}`)
  return shownKeys(found.combination)
}

/**
 * The keystroke that reaches the Project of a rank, and nothing past the last one declared.
 *
 * Read off the same table as the rest rather than written out where it is shown: a palette
 * spelling `Ctrl+3` itself is a palette saying Ctrl on a Mac, and one counting the entries it
 * happens to be drawing is a palette promising a keystroke that goes somewhere else.
 */
export function keysOfRank(rank: number): string | undefined {
  const found = SHORTCUTS.find(
    (shortcut) => shortcut.action.kind === 'project' && shortcut.action.rank === rank,
  )
  return found === undefined ? undefined : shownKeys(found.combination)
}

/**
 * Registers the whole table, and refuses it if two actions claim the same keystroke.
 *
 * The refusal is here rather than in a comment because a conflict is silent otherwise: two
 * registrations on one combination and whichever ran last wins, which is a bug that shows up
 * as "the shortcut stopped working" weeks later.
 */
/**
 * The table as the manager wants it: one registration per row, and the field exclusion turned
 * the right way round. `ignoreInputs` is TanStack's name for "not while a field has the focus",
 * so it is the opposite of what the table says, and getting it backwards is silent — which is
 * why it is a function with a test rather than a line inside a hook.
 */
export function registrationsOf(
  shortcuts: Shortcut[],
  run: (action: ShortcutAction) => void,
): UseHotkeyDefinition[] {
  return shortcuts
    .filter((shortcut) => shortcut.action.kind !== 'project')
    .map((shortcut) => ({
      hotkey: shortcut.combination,
      callback: () => run(shortcut.action),
      options: { ignoreInputs: !shortcut.inFields },
    }))
}

/**
 * Which Project a keystroke asks for, by the key that was pressed and not by the character.
 *
 * `Mod+1` is a *place* on the keyboard — the first key of the digit row — and on plenty of
 * layouts that key does not produce a `1` on its own. On this one it takes Shift to, so what
 * arrives is `Ctrl+Shift+Digit1`, and a table matching the character `1` with no Shift never
 * fires: the rank is unreachable on the keyboard the user has.
 *
 * So the rank is read off `event.code`, which is the physical key whatever the layout puts on
 * it, and Shift is not looked at at all — there is nothing else those nine keystrokes could
 * mean. Every other shortcut stays a character, because a `B` is a `B` wherever it sits and a
 * user who remapped their keyboard meant to move it.
 */
export function rankOf(event: KeyboardEvent, platform: 'mac' | 'other'): number | null {
  const held = platform === 'mac' ? event.metaKey : event.ctrlKey
  if (!held || event.altKey) return null
  const digit = /^Digit([1-9])$/.exec(event.code)
  return digit === null ? null : Number(digit[1])
}

export function useShellShortcuts(run: (action: ShortcutAction) => void): void {
  const conflicts = conflictsIn(SHORTCUTS)
  if (conflicts.length > 0) {
    throw new Error(`two actions of the shell claim ${conflicts.join(', ')}`)
  }
  useHotkeys(registrationsOf(SHORTCUTS, run), { conflictBehavior: 'error' })

  const asked = useRef(run)
  asked.current = run
  useEffect(() => {
    const platform = detectPlatform() === 'mac' ? ('mac' as const) : ('other' as const)
    const listen = (event: KeyboardEvent) => {
      if (inField(event.target)) return
      const rank = rankOf(event, platform)
      if (rank === null) return
      event.preventDefault()
      asked.current({ kind: 'project', rank })
    }
    document.addEventListener('keydown', listen)
    return () => document.removeEventListener('keydown', listen)
  }, [])
}

/** Whether the keystroke belongs to something being typed into, where a rank means nothing. */
function inField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
