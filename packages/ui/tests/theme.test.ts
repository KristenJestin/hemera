/**
 * What the theme claims about itself, read straight out of the file the application loads.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { roleIn, rolesIn, tokenIn } from '../src/tokens.ts'

const theme = readFileSync(join(import.meta.dirname, '..', 'src', 'theme.css'), 'utf8')

/** Role names one theme declares and the other does not, each said once and with its side. */
function asymmetriesOf(source: string): string[] {
  const light = new Set(rolesIn(source, 'light'))
  const dark = new Set(rolesIn(source, 'dark'))
  return [
    ...[...light]
      .filter((role) => !dark.has(role))
      .map((role) => `--${role} is missing from .dark`),
    ...[...dark]
      .filter((role) => !light.has(role))
      .map((role) => `--${role} is missing from :root`),
  ]
}

describe('The two themes are symmetric', () => {
  test('the two themes declare the same set of roles', () => {
    expect(asymmetriesOf(theme)).toEqual([])
  })

  test('a role added to one theme alone is reported by name', () => {
    const lopsided = theme.replace(
      '  --background: #ededf0;',
      '  --background: #ededf0;\n  --scrim: #ffffff;',
    )
    expect(asymmetriesOf(lopsided)).toEqual(['--scrim is missing from .dark'])
  })

  test('both themes declare the roles the components are built out of', () => {
    for (const side of ['light', 'dark'] as const) {
      const roles = rolesIn(theme, side)
      for (const role of ['background', 'foreground', 'primary', 'border', 'ring', 'overlay']) {
        expect(roles).toContain(role)
      }
    }
  })

  test('a role is read from the block of the theme asked for', () => {
    expect(roleIn(theme, 'background', 'light')).toBe('#ededf0')
    expect(roleIn(theme, 'background', 'dark')).toBe('#040406')
    expect(() => roleIn(theme, 'nothing', 'dark')).toThrow('the dark theme declares no --nothing')
  })
})

describe('The theme is the only visual source', () => {
  test('no colour of Tailwind own palette can be generated from the theme', () => {
    expect(theme).toContain('--color-*: initial')
  })

  test('every tone a letter avatar wears is a tinted pair of the theme', () => {
    for (const tone of ['primary', 'info', 'success', 'warning', 'build']) {
      expect(rolesIn(theme, 'light')).toContain(`${tone}-muted`)
      expect(rolesIn(theme, 'light')).toContain(`${tone}-muted-foreground`)
    }
  })
})

describe('The density of the interface', () => {
  test('the base is fourteen, and ordinary text is the base', () => {
    expect(tokenIn(theme, 'text-base')).toBe('0.875rem')
    expect(tokenIn(theme, 'text-sm')).toBe('0.8125rem')
    expect(theme).toContain('font-size: var(--text-base);')
  })

  test('a control is thirty-two, thirty-six or forty-four pixels tall', () => {
    expect(tokenIn(theme, 'spacing-control-sm')).toBe('2rem')
    expect(tokenIn(theme, 'spacing-control-md')).toBe('2.25rem')
    expect(tokenIn(theme, 'spacing-control-lg')).toBe('2.75rem')
  })

  test('a link is one line of the base size tall', () => {
    expect(tokenIn(theme, 'spacing-control-text')).toBe(tokenIn(theme, 'text-base--line-height'))
  })

  test('a component asks for a named step and never for a number', () => {
    const button = readFileSync(
      join(import.meta.dirname, '..', 'src', 'components', 'button', 'button.tsx'),
      'utf8',
    )
    for (const step of ['h-control-sm', 'h-control-md', 'h-control-lg']) {
      expect(button, `the button does not ask for ${step}`).toContain(step)
    }
    expect(button).not.toMatch(/\bh-\d/)
  })
})
