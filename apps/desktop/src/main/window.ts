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

import { type Theme, titleBarHeight, windowColors } from '@hemera/ui/window'
import { BrowserWindow, nativeTheme } from 'electron/main'

import { rendererSource } from './renderer-source.ts'

/**
 * The name the persisted state is filed under. State is only kept when a window has one,
 * and it is the same window across restarts that gets its size and position back.
 */
export const WINDOW_NAME = 'main'

/** What the system is asking for right now. */
export function systemTheme(): Theme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/**
 * The windows whose page has already said what it wears. The page is the authority: it follows
 * the system itself while nobody has chosen otherwise, and says so again on every change, so a
 * frame that went on following the system would undo a theme picked against it.
 */
const answered = new WeakSet<BrowserWindow>()

/** What the page says it wears, which is what the frame wears from then on. */
export function wearTheme(window: BrowserWindow, theme: Theme): void {
  answered.add(window)
  paintWindow(window, theme)
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

export async function openWindow(main: string): Promise<BrowserWindow> {
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

  // The system can change its mind before the page is up to say anything, and until it does
  // the frame has nobody to tell it but this. Once the page has spoken it is what the frame
  // follows: it answers the system itself, and it can be wearing a theme against it.
  nativeTheme.on('updated', () => {
    if (!answered.has(window) && !window.isDestroyed()) paintWindow(window, systemTheme())
  })

  const source = rendererSource()
  await (source.kind === 'server'
    ? window.loadURL(source.location)
    : window.loadFile(source.location))

  return window
}
