/**
 * The one window of the application, as design D0-05 fixes it, painted from the theme (D1-02).
 *
 * It is frameless and keeps the system's own window buttons through the Window Controls
 * Overlay, so the same code gives Windows its buttons and a Wayland compositor its client
 * side decorations. It is shown right away on the application's background colour rather
 * than waiting for `ready-to-show`: waiting is what makes a white frame appear first.
 *
 * The colour it is shown on is the theme's, for the theme the system asks for at that moment,
 * so there is no pale frame around a dark page while the renderer catches up.
 */

import { join } from 'node:path'

import type { ThemePreference } from '@hemera/ipc'
import { type Theme, titleBarHeight, windowColors } from '@hemera/ui/window'
import { shell } from 'electron/common'
import { BrowserWindow, nativeTheme } from 'electron/main'

import { guardNavigation } from './navigation-guard.ts'
import { rendererSource } from './renderer-source.ts'

/**
 * The name the persisted state is filed under. State is only kept when a window has one,
 * and it is the same window across restarts that gets its size and position back.
 */
export const WINDOW_NAME = 'main'

/**
 * What the platform says the application is wearing right now (design D1-03).
 *
 * The main process is the authority, not the page: `nativeTheme.themeSource` is the one place
 * an override can be set *and lifted*, and it is what Chromium hands the renderer as
 * `prefers-color-scheme`. So the page reads the same answer everything else does — a native
 * `<select>`, a scrollbar, a form control — instead of a class that only reaches what the
 * design system draws.
 */
export function systemTheme(): Theme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/** What the user asked for, handed to the platform, and painted from what it answers. */
export function wearPreference(window: BrowserWindow, preference: ThemePreference): void {
  nativeTheme.themeSource = preference
  paintWindow(window, systemTheme())
}

/** Paints the frame and the system's window buttons in a theme's own colours. */
export function paintWindow(window: BrowserWindow, theme: Theme): void {
  const colors = windowColors(theme)
  window.setBackgroundColor(colors.background)
  window.setTitleBarOverlay({
    color: colors.background,
    symbolColor: colors.foreground,
    height: titleBarHeight(),
  })
}

/**
 * The window itself, before anything is loaded into it.
 *
 * Creating and loading are two steps because the channels have to be wired between them: a
 * page that loads first says what it wears before there is a handler to hear it, and the
 * first thing the application would do is throw in its own console.
 */
export function createWindow(main: string): BrowserWindow {
  const opening = windowColors(systemTheme())
  const window = new BrowserWindow({
    show: true,
    backgroundColor: opening.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: opening.background,
      symbolColor: opening.foreground,
      height: titleBarHeight(),
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

  // One listener answers both reasons the theme can change: the desktop changed its mind while
  // the preference is `system`, and the preference itself changed. `shouldUseDarkColors` is the
  // platform's own answer in either case, so there is nothing here to keep in step.
  nativeTheme.on('updated', () => {
    if (!window.isDestroyed()) paintWindow(window, systemTheme())
  })

  guardNavigation(window.webContents, rendererSource(), shell.openExternal)

  return window
}

/** Loads the page, once there is something to answer what it asks. */
export async function loadWindow(window: BrowserWindow): Promise<void> {
  const source = rendererSource()
  await (source.kind === 'server'
    ? window.loadURL(source.location)
    : window.loadFile(source.location))
}
