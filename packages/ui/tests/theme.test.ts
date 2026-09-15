/**
 * What the theme claims about itself, read straight out of the file the application loads.
 *
 * Each suite is named after the scenario of `specs/design-system/spec.md` it covers.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

const theme = readFileSync(join(import.meta.dirname, '..', 'src', 'theme.css'), 'utf8')

/** The custom properties a theme block declares, in the order it declares them. */
function tokensOf(source: string, selector: string): string[] {
  const block = new RegExp(`^${selector}\\s*\\{([\\s\\S]*?)^\\}`, 'm').exec(source)
  if (block === null) throw new Error(`the theme declares no ${selector} block`)
  return [...block[1]!.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]!)
}

/** Token names one theme declares and the other does not, each said once and with its side. */
function asymmetriesOf(source: string): string[] {
  const light = new Set(tokensOf(source, ':root'))
  const dark = new Set(tokensOf(source, '\\.dark'))
  return [
    ...[...light]
      .filter((token) => !dark.has(token))
      .map((token) => `${token} is missing from .dark`),
    ...[...dark]
      .filter((token) => !light.has(token))
      .map((token) => `${token} is missing from :root`),
  ]
}

describe('Thèmes symétriques', () => {
  test('the two themes declare the same set of token names', () => {
    expect(asymmetriesOf(theme)).toEqual([])
  })

  test('a token added to one theme alone is reported by name', () => {
    const lopsided = theme.replace(
      '  --background: #ededf0;',
      '  --background: #ededf0;\n  --scrim: #ffffff;',
    )
    expect(asymmetriesOf(lopsided)).toEqual(['--scrim is missing from .dark'])
  })

  test('both themes declare the roles the components are built out of', () => {
    for (const selector of [':root', '\\.dark']) {
      const tokens = tokensOf(theme, selector)
      for (const role of ['--background', '--foreground', '--primary', '--border', '--ring']) {
        expect(tokens).toContain(role)
      }
    }
  })
})

describe('Le thème est la seule source visuelle', () => {
  test('no colour of Tailwind own palette can be generated from the theme', () => {
    expect(theme).toContain('--color-*: initial')
  })
})

describe('Densité relevée', () => {
  test('the base text is sixteen pixels, and every step of the scale follows it', () => {
    expect(theme).toContain('--text-base: 1rem;')
    expect(theme).toContain('--text-sm: 0.875rem;')
    expect(theme).toContain('--text-lg: 1.125rem;')
    // The page itself is read at the base size, which is what "the density" means.
    expect(theme).toContain('font-size: var(--text-base);')
  })

  test('a control is thirty-two, thirty-six or forty-four pixels tall', () => {
    for (const [step, size] of [
      ['sm', '2rem'],
      ['md', '2.25rem'],
      ['lg', '2.75rem'],
    ]) {
      expect(theme).toContain(`--spacing-control-${step}: ${size};`)
    }
  })

  test('a component asks for a named step and never for a number', () => {
    const button = readFileSync(
      join(import.meta.dirname, '..', 'src', 'components', 'button', 'button.tsx'),
      'utf8',
    )
    for (const step of ['h-control-sm', 'h-control-md', 'h-control-lg']) {
      expect(button, `the button does not ask for ${step}`).toContain(step)
    }
    // A height written as a step of Tailwind's own multiplication is a height that stops
    // following the theme the day the density changes again.
    expect(button).not.toMatch(/\bh-\d/)
  })

  test('the shell takes the window, and not a share of whatever holds it', () => {
    // A percentage is a share of a parent, and a parent nobody gave a height is nothing at all:
    // the stories hid this for a whole lot, because their decorator handed the shell a screen.
    const root = /@utility shell-root \{([\s\S]*?)^\}/m.exec(theme)![1]!
    expect(root).toContain('100dvh')
    expect(root).not.toContain('100%')
  })

  test('the shell is drawn at the theme size, with nothing of the scale written in it', () => {
    const shell = ['shell.tsx', 'chrome-bar.tsx', 'sidebar.tsx', 'gutter.tsx'].map((file) =>
      readFileSync(join(import.meta.dirname, '..', 'src', 'shell', file), 'utf8'),
    )
    for (const source of shell) {
      expect(source).not.toMatch(/\bh-\d/)
      expect(source).not.toMatch(/\btext-\[/)
    }
  })
})
