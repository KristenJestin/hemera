/**
 * The one window of the application, as design D0-05 fixes it.
 *
 * It is frameless and keeps the system's own window buttons through the Window Controls
 * Overlay, so the same code gives Windows its buttons and a Wayland compositor its client
 * side decorations. It is shown right away on the application's background colour rather
 * than waiting for `ready-to-show`: waiting is what makes a white frame appear first.
 */

import { join } from 'node:path'

import { BrowserWindow } from 'electron/main'

import { TITLE_BAR_HEIGHT, WINDOW_BACKGROUND, WINDOW_FOREGROUND } from '../window-colors.ts'
import { rendererSource } from './renderer-source.ts'

/**
 * The name the persisted state is filed under. State is only kept when a window has one,
 * and it is the same window across restarts that gets its size and position back.
 */
export const WINDOW_NAME = 'main'

export async function openWindow(main: string): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: true,
    backgroundColor: WINDOW_BACKGROUND,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: WINDOW_BACKGROUND,
      symbolColor: WINDOW_FOREGROUND,
      height: TITLE_BAR_HEIGHT,
    },
    name: WINDOW_NAME,
    windowStatePersistence: true,
    webPreferences: {
      preload: join(main, '..', 'preload', 'index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
      spellcheck: false,
    },
  })

  const source = rendererSource()
  await (source.kind === 'server'
    ? window.loadURL(source.location)
    : window.loadFile(source.location))

  return window
}
