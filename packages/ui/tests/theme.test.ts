/**
 * What the theme claims about itself, read straight out of the file the application loads.
 */

import { readFileSync, readdirSync } from 'node:fs'
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

/** The relative luminance of a colour written `#rrggbb`, as WCAG computes it. */
function luminanceOf(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** How two colours written `#rrggbb` stand apart, from 1 to 21. */
function contrastOf(one: string, other: string): number {
  const [light, dark] = [luminanceOf(one), luminanceOf(other)].toSorted((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}

/** Every component's own source, stories left out. */
const COMPONENTS = join(import.meta.dirname, '..', 'src', 'components')
const componentSources = readdirSync(COMPONENTS).flatMap((folder) =>
  readdirSync(join(COMPONENTS, folder))
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.stories.tsx'))
    .map((file) => ({ file, source: readFileSync(join(COMPONENTS, folder, file), 'utf8') })),
)

describe('The primary and the focus', () => {
  test('the focus ring is opaque, and stands out from every surface at 3:1 or more', () => {
    for (const side of ['light', 'dark'] as const) {
      const ring = roleIn(theme, 'ring', side)
      expect(ring).toMatch(/^#[\da-f]{6}$/)
      for (const surface of ['background', 'surface-content', 'card', 'muted']) {
        expect(contrastOf(ring, roleIn(theme, surface, side))).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test('the primary fills a surface with its gradient, which both themes declare', () => {
    for (const side of ['light', 'dark'] as const) {
      expect(rolesIn(theme, side)).toEqual(
        expect.arrayContaining(['primary-gradient', 'primary-raise']),
      )
    }
    expect(theme).toContain('@utility primary-fill {')
  })

  test('no component fills a surface with the flat primary', () => {
    const flat = componentSources
      .filter(({ source }) => /(?<![\w-])(?:[\w-]+:)*bg-primary(?![\w-])/.test(source))
      .map(({ file }) => file)
    expect(flat).toEqual([])
  })
})

describe('What answers the hand', () => {
  test('whatever changes colour under the hand or the keyboard does so on the hover kind', () => {
    const abrupt = componentSources
      .filter(({ source }) => /\b(?:hover|data-highlighted):/.test(source))
      .filter(({ source }) => !source.includes('hover-motion'))
      .map(({ file }) => file)
    expect(abrupt).toEqual([])
    expect(theme).toContain('@utility hover-motion {')
    const motion = readFileSync(join(import.meta.dirname, '..', 'src', 'motion.ts'), 'utf8')
    expect(motion).toMatch(/^export const hover\b/m)
  })

  test('what the hand rests on is tinted, faintly, never filled with a grey slab', () => {
    for (const side of ['light', 'dark'] as const) {
      const tint = roleIn(theme, 'hover', side)
      const alpha = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(tint)
      expect(alpha, `--hover in ${side} is a tint`).not.toBeNull()
      expect(Number(alpha![1])).toBeLessThanOrEqual(0.06)
    }
    const slabs = componentSources
      .filter(({ source }) => /(?:hover|data-highlighted):bg-(?:accent|muted)\b/.test(source))
      .map(({ file }) => file)
    expect(slabs).toEqual([])
  })
})

describe('The density of the interface', () => {
  test('the base is fourteen, and ordinary text is the base', () => {
    expect(tokenIn(theme, 'text-base')).toBe('0.875rem')
    expect(tokenIn(theme, 'text-sm')).toBe('0.8125rem')
    expect(theme).toContain('font-size: var(--text-base);')
  })

  test('a control is twenty-eight, thirty-two or thirty-six pixels tall, as shadcn draws them', () => {
    expect(tokenIn(theme, 'spacing-control-sm')).toBe('1.75rem')
    expect(tokenIn(theme, 'spacing-control-md')).toBe('2rem')
    expect(tokenIn(theme, 'spacing-control-lg')).toBe('2.25rem')
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
