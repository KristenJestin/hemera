/**
 * What a link in agent-authored Markdown may do, and what it may never do (security review
 * finding). The renderer draws `<a href>` for `http(s):` and `mailto:` links; without a guard,
 * pressing one replaces the whole window with whatever it points at, and `window.open` opens a
 * second Electron window the application never asked for.
 *
 * Kept apart from `window.ts`, which wires this to a real `BrowserWindow` and a real
 * `shell.openExternal`, so a test can drive it against a fake `webContents` without an Electron
 * runtime to import: `electron/main` and `electron/common` only resolve inside one.
 */

import { applicationOrigin, isOwnFrame } from './bridge.ts'
import type { RendererSource } from './renderer-source.ts'

/** The one property and the one method a navigation guard reads off a real `WebContents` event. */
export interface NavigationEvent {
  readonly url: string
  preventDefault(): void
}

/** The slice of `WebContents` a navigation guard needs, narrow enough for a test to fake. */
export interface NavigationGuardable {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(event: 'will-navigate', listener: (event: NavigationEvent) => void): void
}

/** Whether a URL is one `openExternal` may be handed: the user's own browser, not this window. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A `window.open()` is always denied. A navigation away from the renderer's own source — the
 * dev server's origin, or the built file, which `isOwnFrame` already knows how to tell apart
 * (design D0-04) — is prevented. Either way, an `http:`/`https:` destination still opens, just
 * not here: `openExternal` hands it to the platform's own browser. Anything else — `javascript:`,
 * another file on disk — goes nowhere.
 */
export function guardNavigation(
  webContents: NavigationGuardable,
  source: RendererSource,
  openExternal: (url: string) => Promise<void>,
): void {
  const origin = applicationOrigin(source)

  webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void openExternal(url)
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event) => {
    if (isOwnFrame({ url: event.url }, origin)) return
    event.preventDefault()
    if (isWebUrl(event.url)) void openExternal(event.url)
  })
}
