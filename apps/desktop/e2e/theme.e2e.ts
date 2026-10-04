/**
 * The theme chosen is worn without a flash: the window's own colour is repainted to the theme's
 * page colour, and a page that loads wears the theme from the head of the page, before its first
 * frame. What the next start opens on is the hint main keeps (`data.e2e.ts`), read before the
 * window exists.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { roleIn } from '@hemera/ui/tokens'
import { browser, expect } from '@wdio/globals'

import { markPage, waitForEngine, waitForNewPage } from './diagnostic.ts'

const theme = readFileSync(fileURLToPath(import.meta.resolve('@hemera/ui/theme.css')), 'utf8')

/** `#040406` as the page computes it, `rgb(4, 4, 6)`. */
const rgbOf = (hex: string): string =>
  `rgb(${[1, 3, 5].map((at) => String(Number.parseInt(hex.slice(at, at + 2), 16))).join(', ')})`

/** What the page wears, and what is under it until the shell draws. */
const worn = () =>
  browser.execute(() => ({
    dark: document.documentElement.classList.contains('dark'),
    body: getComputedStyle(document.body).backgroundColor,
  }))

const windowColor = () =>
  browser.electron.execute((electron) =>
    electron.BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase(),
  )

describe('The theme', () => {
  it('a theme chosen now is worn now, by the page and by the window under it', async () => {
    await waitForEngine()
    await browser.electron.execute(async () => await globalThis.hemeraProbe?.changeTheme('dark'))
    await browser.waitUntil(async () => (await worn()).dark, {
      timeout: 10_000,
      timeoutMsg: 'the page never wore the dark theme',
    })
    expect(await windowColor()).toBe(roleIn(theme, 'surface-page', 'dark'))
  })

  it('a page that loads wears it from its head, in the window’s own colour', async () => {
    await markPage()
    await browser.electron.execute((electron) => {
      electron.BrowserWindow.getAllWindows()[0]?.webContents.reload()
    })
    await waitForNewPage()
    expect(await worn()).toEqual({ dark: true, body: rgbOf(roleIn(theme, 'surface-page', 'dark')) })
  })

  it('a light theme chosen after it is worn the same way', async () => {
    await browser.electron.execute(async () => await globalThis.hemeraProbe?.changeTheme('light'))
    await browser.waitUntil(async () => !(await worn()).dark, {
      timeout: 10_000,
      timeoutMsg: 'the page never wore the light theme',
    })
    expect(await windowColor()).toBe(roleIn(theme, 'surface-page', 'light'))
  })
})
