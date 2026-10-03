/**
 * The main process: one window, and nothing else yet.
 *
 * It takes the single-instance lock, opens the window on the opening colour of the system's
 * theme, keeps the page from navigating anywhere but to itself, and quits when the window closes.
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { shell } from 'electron/common'
import { BrowserWindow, Menu, app, nativeTheme } from 'electron/main'

import { rendererSource } from './renderer-source.ts'
import { OPENING_COLORS, headless, windowOptions } from './window-options.ts'

const main = dirname(fileURLToPath(import.meta.url))

/** Whether a URL is one the user's own browser may be handed, rather than this window. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

async function openWindow(): Promise<void> {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const window = new BrowserWindow(windowOptions(main, OPENING_COLORS[theme], process.env))
  const source = rendererSource()

  // A `window.open()` is always denied and a navigation away from the page is prevented; a web
  // address still opens, in the user's own browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
    if (isWebUrl(event.url)) void shell.openExternal(event.url)
  })

  await (source.kind === 'server'
    ? window.loadURL(source.location)
    : window.loadFile(source.location))
}

/**
 * No menu at all, which also takes its keystrokes with it: the default menu owns Ctrl+W, and a
 * frameless window with no menu bar would close itself on a keystroke nobody chose.
 */
Menu.setApplicationMenu(null)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [first] = BrowserWindow.getAllWindows()
    // Under the end-to-end suite with no window on screen, handing the window back would put it
    // on screen and take the focus of whoever is using the machine: it stays where it is.
    if (first === undefined || headless(process.env)) return
    if (first.isMinimized()) first.restore()
    first.focus()
  })

  void app.whenReady().then(openWindow)
}

app.on('window-all-closed', () => {
  app.quit()
})
