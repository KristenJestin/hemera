import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { roleIn } from '@hemera/ui/tokens'
import { describe, expect, test } from 'vite-plus/test'

import { OPENING_COLORS } from '../src/main/opening-colors.ts'
import { HEADLESS_VARIABLE, OFF_SCREEN, windowOptions } from '../src/main/window-options.ts'

const theme = readFileSync(fileURLToPath(import.meta.resolve('@hemera/ui/theme.css')), 'utf8')

const main = '/application/dist/main'

describe('The window opens sandboxed, on the opening colour of the theme', () => {
  test('the page is sandboxed and isolated, with no Node, and its preload is the built one', () => {
    const options = windowOptions(main, OPENING_COLORS.dark, {})
    expect(options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    })
    expect(options.webPreferences?.preload?.replaceAll('\\', '/')).toBe(
      '/application/dist/preload/index.cjs',
    )
  })

  test('the frame is drawn by the page, on the colour it opens on, with the system buttons', () => {
    const options = windowOptions(main, OPENING_COLORS.dark, {})
    expect(options.show).toBe(true)
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.backgroundColor).toBe(OPENING_COLORS.dark.background)
    expect(options.titleBarOverlay).toMatchObject({
      color: OPENING_COLORS.dark.sheet,
      symbolColor: OPENING_COLORS.dark.foreground,
    })
  })

  test('the colours it opens on are the theme’s: the chrome under the page, the sheet under the buttons', () => {
    for (const name of ['light', 'dark'] as const) {
      expect(OPENING_COLORS[name]).toEqual({
        background: roleIn(theme, 'surface-page', name),
        sheet: roleIn(theme, 'surface-content', name),
        foreground: roleIn(theme, 'foreground', name),
      })
    }
  })

  test('under the headless suite the window opens off screen, out of the taskbar and the focus', () => {
    const options = windowOptions(main, OPENING_COLORS.light, { [HEADLESS_VARIABLE]: '1' })
    expect(options).toMatchObject({
      x: OFF_SCREEN,
      y: OFF_SCREEN,
      skipTaskbar: true,
      focusable: false,
    })
  })

  test('without the variable the window opens where the system puts it', () => {
    const options = windowOptions(main, OPENING_COLORS.light, {})
    expect(options.x).toBeUndefined()
    expect(options.focusable).toBeUndefined()
  })
})
