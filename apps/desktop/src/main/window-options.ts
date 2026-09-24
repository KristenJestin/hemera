/**
 * What the window is opened with, kept apart from `window.ts` so it can be read without Electron.
 *
 * The end-to-end suite has one seam here and nowhere else: `HEMERA_E2E_HEADLESS=1` opens the
 * window where no display is, out of the taskbar and unable to take the focus, so a suite run on
 * a machine in use neither puts a window on its screen nor takes its keyboard. Without the
 * variable the options are exactly the ones the application always opens with.
 *
 * Off screen rather than hidden, which was tried first: on Windows a window opened with
 * `show: false` and `paintWhenInitiallyHidden` keeps a page that says it is visible, but its
 * compositor stops — two animation frames in a second — so nothing that moves ever finishes
 * moving, and a suite that folds the sidebar reads it still open. A window shown off every
 * display keeps the display's rate, and `focusable: false` is what keeps its showing from
 * activating it. It is still not throttled, so nothing depends on how Windows ranks it. Its state
 * is not persisted: a second start on the same data folder would otherwise be given back bounds
 * Electron moves onto a display, and the window would open on screen after all.
 */

import { join } from 'node:path'

import type { WindowColors } from '@hemera/ui/window'
import type { BrowserWindowConstructorOptions } from 'electron/main'

/**
 * The name the persisted state is filed under. State is only kept when a window has one,
 * and it is the same window across restarts that gets its size and position back.
 */
export const WINDOW_NAME = 'main'

/** The variable the end-to-end suite sets to run with no window on screen. */
export const HEADLESS_VARIABLE = 'HEMERA_E2E_HEADLESS'

/** Where the suite puts the window: left of and above any display a desktop arranges. */
export const OFF_SCREEN = -20_000

/** Whether this start runs under the end-to-end suite with no window on screen. */
export function headless(environment: NodeJS.ProcessEnv): boolean {
  return environment[HEADLESS_VARIABLE] === '1'
}

/** The options of the one window, in the colours it opens on, for the start it belongs to. */
export function windowOptions(
  main: string,
  opening: WindowColors,
  titleBarHeight: number,
  environment: NodeJS.ProcessEnv,
): BrowserWindowConstructorOptions {
  const options: BrowserWindowConstructorOptions = {
    show: true,
    backgroundColor: opening.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: opening.background,
      symbolColor: opening.foreground,
      height: titleBarHeight,
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
  }
  if (!headless(environment)) return options
  return {
    ...options,
    x: OFF_SCREEN,
    y: OFF_SCREEN,
    skipTaskbar: true,
    focusable: false,
    windowStatePersistence: false,
    webPreferences: { ...options.webPreferences, backgroundThrottling: false },
  }
}
