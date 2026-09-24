/**
 * The window the application opens, and the one the end-to-end suite opens with no window on
 * screen (issue #67).
 *
 * The switch is a seam for the suite and nothing else: without the variable the options are the
 * ones the application has always opened with, and with it they differ only in what keeps the
 * window off the screen, out of the taskbar and away from the focus.
 */

import { join } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import {
  HEADLESS_VARIABLE,
  OFF_SCREEN,
  WINDOW_NAME,
  headless,
  windowOptions,
} from '#main/window-options.ts'

const MAIN = join('application', 'dist', 'main')
const COLORS = { background: '#101010', foreground: '#f0f0f0' }
const HEIGHT = 40

describe('Suite de bout en bout sans fenêtre à l’écran', () => {
  test('without the variable the window opens shown, as it always has', () => {
    expect(windowOptions(MAIN, COLORS, HEIGHT, {})).toEqual({
      show: true,
      backgroundColor: '#101010',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#101010', symbolColor: '#f0f0f0', height: 40 },
      name: WINDOW_NAME,
      windowStatePersistence: true,
      webPreferences: {
        preload: join('application', 'dist', 'preload', 'index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: true,
        spellcheck: false,
      },
    })
    expect(headless({})).toBe(false)
  })

  test('a value other than 1 is not the switch', () => {
    expect(windowOptions(MAIN, COLORS, HEIGHT, { [HEADLESS_VARIABLE]: 'true' })).toEqual(
      windowOptions(MAIN, COLORS, HEIGHT, {}),
    )
  })

  test('with the variable the window opens off screen, unfocusable, unthrottled and unpersisted', () => {
    const shown = windowOptions(MAIN, COLORS, HEIGHT, {})

    expect(windowOptions(MAIN, COLORS, HEIGHT, { [HEADLESS_VARIABLE]: '1' })).toEqual({
      ...shown,
      x: OFF_SCREEN,
      y: OFF_SCREEN,
      skipTaskbar: true,
      focusable: false,
      windowStatePersistence: false,
      webPreferences: { ...shown.webPreferences, backgroundThrottling: false },
    })
    expect(headless({ [HEADLESS_VARIABLE]: '1' })).toBe(true)
  })
})
