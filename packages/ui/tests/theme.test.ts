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
