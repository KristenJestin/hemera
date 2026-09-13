/**
 * Keyboard contract of the design system.
 *
 * The renderer does not bind `Tab`: the application owns the key and walks focus itself.
 * Every shortcut the interface answers to is declared here, once, so two of them cannot
 * collide unnoticed.
 */

import type { EventPayload } from '@gpuix/react'

/** Keys that activate a pressable element. */
export const ACTIVATION_KEYS = ['enter', 'space'] as const

/** Key that closes the topmost overlay. */
export const DISMISS_KEY = 'escape'

/** Key the application turns into a focus move. */
export const TRAVERSAL_KEY = 'tab'

export function isActivationKey(event: EventPayload): boolean {
  return event.key !== undefined && (ACTIVATION_KEYS as readonly string[]).includes(event.key)
}

export function isDismissKey(event: EventPayload): boolean {
  return event.key === DISMISS_KEY
}

export interface TraversalIntent {
  direction: 'next' | 'previous'
}

/** The focus move a key event asks for, or null when it asks for none. */
export function traversalIntentOf(event: EventPayload): TraversalIntent | null {
  if (event.key !== TRAVERSAL_KEY) return null
  return { direction: event.modifiers?.shift === true ? 'previous' : 'next' }
}

export interface Shortcut {
  /** Key as the renderer reports it. */
  key: string
  /** Modifiers that must be held. */
  modifiers?: { shift?: boolean; control?: boolean; alt?: boolean }
  /** What the shortcut does, for the one place shortcuts are documented. */
  action: string
}

/** Every shortcut the interface answers to, declared once. */
export const SHORTCUTS: readonly Shortcut[] = [
  { key: TRAVERSAL_KEY, action: 'move focus to the next control' },
  { key: TRAVERSAL_KEY, modifiers: { shift: true }, action: 'move focus to the previous control' },
  { key: DISMISS_KEY, action: 'close the topmost overlay' },
  { key: 'enter', action: 'activate the focused control' },
  { key: 'space', action: 'activate the focused control' },
]

function signatureOf(shortcut: Shortcut): string {
  const held = (['shift', 'control', 'alt'] as const)
    .filter((modifier) => shortcut.modifiers?.[modifier] === true)
    .join('+')
  return held.length === 0 ? shortcut.key : `${held}+${shortcut.key}`
}

/** Shortcuts declared twice for different actions. */
export function conflictingShortcuts(shortcuts: readonly Shortcut[] = SHORTCUTS): string[] {
  const actionsBySignature = new Map<string, Set<string>>()
  for (const shortcut of shortcuts) {
    const signature = signatureOf(shortcut)
    const actions = actionsBySignature.get(signature) ?? new Set<string>()
    actions.add(shortcut.action)
    actionsBySignature.set(signature, actions)
  }
  return [...actionsBySignature.entries()]
    .filter(([, actions]) => actions.size > 1)
    .map(([signature]) => signature)
}
