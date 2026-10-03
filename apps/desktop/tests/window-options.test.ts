import { describe, expect, test } from 'vite-plus/test'

import {
  HEADLESS_VARIABLE,
  OFF_SCREEN,
  OPENING_COLORS,
  windowOptions,
} from '../src/main/window-options.ts'

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
      color: OPENING_COLORS.dark.background,
      symbolColor: OPENING_COLORS.dark.foreground,
    })
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
