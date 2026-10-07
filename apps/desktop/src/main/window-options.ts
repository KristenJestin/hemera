/**
 * What the window is opened with, kept apart from `index.ts` so it can be read without Electron.
 *
 * The end-to-end suite has its one seam here: `HEMERA_E2E_HEADLESS=1` opens the window where no
 * display is, out of the taskbar and unable to take the focus, so a suite run on a machine in use
 * neither puts a window on its screen nor takes its keyboard. Without the variable the options
 * are exactly the ones the application always opens with.
 *
 * Off screen rather than hidden: on Windows a window opened with `show: false` keeps a page that
 * says it is visible, but its compositor stops, so nothing that moves ever finishes moving. A
 * window shown off every display keeps the display's rate, and `focusable: false` is what keeps
 * its showing from activating it. On Linux the headless run also starts a compositor of its own
 * (`e2e/compositor.ts`), because a Wayland compositor places windows itself.
 */

import { join } from 'node:path'

import type { BrowserWindowConstructorOptions } from 'electron/main'

/** The variable the end-to-end suite sets to run with no window on screen. */
export const HEADLESS_VARIABLE = 'HEMERA_E2E_HEADLESS'

/** Where the suite puts the window: left of and above any display a desktop arranges. */
export const OFF_SCREEN = -20_000

/** The height of the title bar the system draws its window buttons in, in pixels. */
export const TITLE_BAR_HEIGHT = 36

/** The colours the window is painted with before the page has drawn anything. */
export interface WindowColors {
  /** Under the whole window: the page's own colour, the sidebar's. */
  background: string
  /** Under the system's buttons, which stand at the end of the sheet's header. */
  sheet: string
  /** The buttons' glyphs. */
  foreground: string
}

/** Whether this start runs under the end-to-end suite with no window on screen. */
export function headless(environment: NodeJS.ProcessEnv): boolean {
  return environment[HEADLESS_VARIABLE] === '1'
}

/**
 * Whether this start runs under the end-to-end suite, with its probe and its fake agent: the
 * variable, in an application that is not packaged. An installed Hemera started with the variable
 * is an ordinary Hemera.
 */
export function suiteRuns(environment: NodeJS.ProcessEnv, packaged: boolean): boolean {
  return headless(environment) && !packaged
}

/**
 * The options of the one window: frameless with the system's own buttons drawn over the page
 * (Window Controls Overlay), shown at once on the opening colour, sandboxed and isolated.
 */
export function windowOptions(
  main: string,
  opening: WindowColors,
  environment: NodeJS.ProcessEnv,
): BrowserWindowConstructorOptions {
  const options: BrowserWindowConstructorOptions = {
    show: true,
    title: 'Hemera',
    backgroundColor: opening.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: opening.sheet,
      symbolColor: opening.foreground,
      height: TITLE_BAR_HEIGHT,
    },
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
    webPreferences: { ...options.webPreferences, backgroundThrottling: false },
  }
}
