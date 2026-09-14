import { describe, expect, test } from 'bun:test'
import type { EventPayload } from '@gpuix/react'

// The leaf modules, not the barrel: the barrel re-exports the components, which load the
// renderer and its native addon on a machine that may have none.
import {
  conflictingShortcuts,
  isActivationKey,
  isDismissKey,
  traversalIntentOf,
} from '../src/lib/keyboard.ts'
import { canAnimate, transition } from '../src/lib/motion.ts'
import { focusRing, freezeStyle, mergeStyle, variants, withoutUndefined } from '../src/lib/style.ts'
import { dark } from '../src/theme/dark.ts'
import { light } from '../src/theme/light.ts'
import { DEFAULT_THEME, themeOf } from '../src/theme/provider.tsx'

function keyEvent(key: string, modifiers?: { shift?: boolean }): EventPayload {
  return { key, modifiers } as EventPayload
}

describe('Fusion de styles', () => {
  test('a later layer wins key by key', () => {
    expect(mergeStyle({ padding: 8, color: 'a' }, { color: 'b' })).toEqual({
      padding: 8,
      color: 'b',
    })
  })

  test('absent layers are skipped', () => {
    expect(mergeStyle({ padding: 8 }, undefined, false, null, { gap: 4 })).toEqual({
      padding: 8,
      gap: 4,
    })
  })

  test('a prop the caller did not pass is omitted rather than sent as undefined', () => {
    expect(withoutUndefined({ style: { gap: 4 }, testId: undefined })).toEqual({
      style: { gap: 4 },
    })
    expect(Object.keys(withoutUndefined({ testId: undefined }))).toEqual([])
  })
})

describe('État désactivé figé', () => {
  test('the natively painted hover and active layers are dropped', () => {
    const frozen = freezeStyle({
      backgroundColor: 'a',
      hover: { backgroundColor: 'b' },
      active: { backgroundColor: 'c' },
    })
    expect(frozen).toEqual({ backgroundColor: 'a' })
    expect('hover' in frozen).toBe(false)
    expect('active' in frozen).toBe(false)
  })
})

describe('Anneau de focus', () => {
  test('the ring is the primary ring token of the theme in force', () => {
    expect(focusRing(dark).borderColor).toBe(dark.colors.primaryRing)
    expect(focusRing(light).borderColor).toBe(light.colors.primaryRing)
  })
})

describe('Recettes de variantes', () => {
  const recipe = variants({
    base: { display: 'flex' },
    variants: {
      tone: { primary: { color: 'p' }, ghost: { color: 'g' } },
      size: { sm: { padding: 4 }, md: { padding: 8 } },
    },
    defaults: { tone: 'ghost', size: 'md' },
  })

  test('a group the caller does not name falls back to its default', () => {
    expect(recipe()).toEqual({ display: 'flex', color: 'g', padding: 8 })
  })

  test('a named variant replaces the default', () => {
    expect(recipe({ tone: 'primary', size: 'sm' })).toEqual({
      display: 'flex',
      color: 'p',
      padding: 4,
    })
  })
})

describe('Activation au clavier', () => {
  test('enter and space activate, other keys do not', () => {
    expect(isActivationKey(keyEvent('enter'))).toBe(true)
    expect(isActivationKey(keyEvent('space'))).toBe(true)
    expect(isActivationKey(keyEvent('a'))).toBe(false)
    expect(isActivationKey(keyEvent('escape'))).toBe(false)
  })

  test('escape is the dismiss key', () => {
    expect(isDismissKey(keyEvent('escape'))).toBe(true)
    expect(isDismissKey(keyEvent('enter'))).toBe(false)
  })
})

describe('Traversée manuelle du clavier', () => {
  test('tab asks for the next control and shift+tab for the previous one', () => {
    expect(traversalIntentOf(keyEvent('tab'))).toEqual({ direction: 'next' })
    expect(traversalIntentOf(keyEvent('tab', { shift: true }))).toEqual({ direction: 'previous' })
    expect(traversalIntentOf(keyEvent('enter'))).toBeNull()
  })

  test('no two shortcuts claim the same combination for different actions', () => {
    expect(conflictingShortcuts()).toEqual([])
    expect(
      conflictingShortcuts([
        { key: 'escape', action: 'close the overlay' },
        { key: 'escape', action: 'clear the draft' },
      ]),
    ).toEqual(['escape'])
  })
})

describe('Animation interdite sur un élément dans le flux', () => {
  test('opacity, radius and painted transforms animate anywhere', () => {
    for (const target of ['opacity', 'borderRadius', 'scale', 'x', 'y'] as const) {
      expect(canAnimate(target, { outOfFlow: false })).toBe(true)
    }
  })

  test('a dimension or an offset animates only out of the flow', () => {
    for (const target of ['width', 'height', 'top', 'left'] as const) {
      expect(canAnimate(target, { outOfFlow: false })).toBe(false)
      expect(canAnimate(target, { outOfFlow: true })).toBe(true)
    }
  })

  test('durations come from the closed scale', () => {
    expect(transition('fast').duration).toBe(0.12)
    expect(transition('base').duration).toBe(0.18)
    expect(transition('slow').duration).toBe(0.28)
  })
})

describe('Préférence de thème absente ou invalide', () => {
  test('an unknown or absent preference falls back to the default theme', () => {
    expect(themeOf('light').name).toBe('light')
    expect(themeOf('dark').name).toBe('dark')
    expect(themeOf(null).name).toBe(DEFAULT_THEME)
    expect(themeOf(undefined).name).toBe(DEFAULT_THEME)
    expect(themeOf('solarized').name).toBe(DEFAULT_THEME)
  })
})
