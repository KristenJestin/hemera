/**
 * What the main process paints the window with, checked against the file it reads it from.
 *
 * Each suite is named after the scenario of `specs/design-system/spec.md` it covers.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { colorsIn, heightIn } from '../src/window.ts'

const theme = readFileSync(join(import.meta.dirname, '..', 'src', 'theme.css'), 'utf8')

/** The value a token is declared with in a theme block, read straight out of the file. */
function declared(selector: string, name: string): string {
  const block = new RegExp(String.raw`^${selector}\s*\{([\s\S]*?)^\}`, 'm').exec(theme)
  const found = new RegExp(String.raw`^\s*--${name}\s*:\s*([^;]+);`, 'm').exec(block![1]!)
  return found![1]!.trim()
}

describe('Fenêtre peinte avec la couleur du thème', () => {
  test.each([
    ['light', ':root'],
    ['dark', String.raw`\.dark`],
  ] as const)('the %s window is painted the value the theme declares', (mode, selector) => {
    expect(colorsIn(theme, mode)).toEqual({
      background: declared(selector, 'background'),
      foreground: declared(selector, 'foreground'),
    })
  })

  test('the two themes are not painted the same', () => {
    expect(colorsIn(theme, 'light').background).not.toBe(colorsIn(theme, 'dark').background)
  })

  test('the overlay is as tall as the theme says', () => {
    expect(heightIn(theme)).toBe(40)
  })
})
