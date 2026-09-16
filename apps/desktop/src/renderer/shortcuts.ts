import {
  type Hotkey,
  type UseHotkeyDefinition,
  formatForDisplay,
  useHotkeys,
} from '@tanstack/react-hotkeys'

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
  return shortcuts.map((shortcut) => ({
    hotkey: shortcut.combination,
    callback: () => run(shortcut.action),
    options: { ignoreInputs: !shortcut.inFields },
  }))
}

export function useShellShortcuts(run: (action: ShortcutAction) => void): void {
  const conflicts = conflictsIn(SHORTCUTS)
  if (conflicts.length > 0) {
    throw new Error(`two actions of the shell claim ${conflicts.join(', ')}`)
  }
  useHotkeys(registrationsOf(SHORTCUTS, run), { conflictBehavior: 'error' })
}
