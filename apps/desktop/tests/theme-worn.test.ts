/** The window wears the theme main chose, from its first paint and whenever it changes. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import { DARK_QUERY, wearTheme } from '../src/renderer/theme.ts'

const page = readFileSync(join(import.meta.dirname, '..', 'src', 'renderer', 'index.html'), 'utf8')

/** A media query whose answer the test changes. */
function query(dark: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: dark,
    addEventListener: (_: 'change', listener: () => void) => listeners.add(listener),
    removeEventListener: (_: 'change', listener: () => void) => listeners.delete(listener),
  }
  return {
    media,
    turn: (next: boolean) => {
      media.matches = next
      for (const listener of listeners) listener()
    },
    listening: () => listeners.size,
  }
}

describe('The window wears the theme main chose', () => {
  test('the page sets it in its head, before any stylesheet or script is loaded', () => {
    const head = page.slice(page.indexOf('<head>'), page.indexOf('</head>'))
    const script = /<script>([\s\S]*?)<\/script>/.exec(head)
    expect(script).not.toBeNull()
    expect(script?.[1]).toContain(`matchMedia('${DARK_QUERY}')`)
    expect(script?.[1]?.replaceAll(/\s+/g, '')).toContain("classList.toggle('dark',")
    expect(head.indexOf('<script>')).toBeLessThan(head.search(/<link|<script type="module"/) >>> 0)
  })

  test('the page follows it when it changes, and stops when asked', () => {
    const worn: boolean[] = []
    const system = query(false)
    const stop = wearTheme((dark) => worn.push(dark), system.media)
    system.turn(true)
    system.turn(false)
    expect(worn).toEqual([false, true, false])
    stop()
    expect(system.listening()).toBe(0)
  })
})
