/**
 * The main process: it opens the window, wires the channels, and answers `--report`.
 *
 * Anything that must exist before the window does is awaited at the top level of this file:
 * the module loads asynchronously, so a dynamic import would arrive after Electron is ready.
 * `ready` itself is not: Electron emits it once this module has finished evaluating, so a
 * top-level `await app.whenReady()` waits for an event its own waiting prevents.
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { MotionMeasure } from '@hemera/ipc'
import { app } from 'electron/main'

import { registerChannels } from './channels.ts'
import { collectReport } from './environment.ts'
import { openWindow } from './window.ts'

const main = dirname(fileURLToPath(import.meta.url))

/** Asked for by `pnpm report`: start as usual, say what this machine is, and leave. */
const REPORT_FLAG = '--report'

void app.whenReady().then(async () => {
  const window = await openWindow(main)
  registerChannels(window)

  if (process.argv.includes(REPORT_FLAG)) {
    // The transition is played and counted in the page, because that is where frames are
    // rendered; the main process only asks for it and files what came back.
    //
    // It is played twice and the second one is filed. The first transition after a cold start
    // carries the page's first paint with it — a frame of about 110 ms on this machine — and
    // that frame says what starting costs, not what the transition costs. What the lot asks
    // of the transition is measured on a window that has already painted.
    const play = 'window.hemeraWitness.play()'
    await window.webContents.executeJavaScript(play)
    const motion = (await window.webContents.executeJavaScript(play)) as MotionMeasure
    // Read after the page has painted: what the GPU decided is only true once it drew.
    process.stdout.write(JSON.stringify({ ...(await collectReport()), motion }))
    app.quit()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})
