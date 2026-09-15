/**
 * The main process: it opens the window and nothing else yet.
 *
 * Anything that must exist before the window does is awaited at the top level of this file:
 * the module loads asynchronously, so a dynamic import would arrive after Electron is ready.
 * `ready` itself is not: Electron emits it once this module has finished evaluating, so a
 * top-level `await app.whenReady()` waits for an event its own waiting prevents.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow, app } from 'electron/main'

import { rendererSource } from './renderer-source.ts'

const main = dirname(fileURLToPath(import.meta.url))

async function openWindow(): Promise<void> {
  const window = new BrowserWindow({
    webPreferences: {
      preload: join(main, '..', 'preload', 'index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const source = rendererSource()
  await (source.kind === 'server'
    ? window.loadURL(source.location)
    : window.loadFile(source.location))
}

void app.whenReady().then(openWindow)

app.on('window-all-closed', () => {
  app.quit()
})
