/**
 * The main process: it opens the window and nothing else yet.
 *
 * Anything that must exist before the window does is awaited at the top level of this file:
 * the module loads asynchronously, so a dynamic import would arrive after Electron is ready.
 * `ready` itself is not: Electron emits it once this module has finished evaluating, so a
 * top-level `await app.whenReady()` waits for an event its own waiting prevents.
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { app } from 'electron/main'

import { registerChannels } from './channels.ts'
import { openWindow } from './window.ts'

const main = dirname(fileURLToPath(import.meta.url))

void app.whenReady().then(async () => {
  const window = await openWindow(main)
  registerChannels(window)
})

app.on('window-all-closed', () => {
  app.quit()
})
