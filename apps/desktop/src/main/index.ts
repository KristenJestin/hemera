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
import { Menu, app } from 'electron/main'

import { registerChannels } from './channels.ts'
import { collectReport } from './environment.ts'
import { createWindow, loadWindow } from './window.ts'

const main = dirname(fileURLToPath(import.meta.url))

/** Asked for by `pnpm report`: start as usual, say what this machine is, and leave. */
const REPORT_FLAG = '--report'

/**
 * No menu at all, which also takes its keystrokes with it.
 *
 * Electron gives a window a default menu, and the default menu owns Ctrl+W — so a frameless
 * application with no menu bar anywhere on screen still closes itself on a keystroke nobody
 * chose, from a menu nobody can see. The shortcuts of the application are declared in the
 * renderer, in one table, and that is the whole list.
 */
Menu.setApplicationMenu(null)

void app.whenReady().then(async () => {
  // Wired before the page loads: the first thing it does is say which theme it wants, and a
  // channel with nobody on it would answer that with an error in the application's own console.
  const window = createWindow(main)
  registerChannels(window)
  await loadWindow(window)

  if (process.argv.includes(REPORT_FLAG)) {
    // The transition is played and counted in the page, because that is where frames are
    // rendered; the main process only asks for it and files what came back.
    //
    // It is played three times and the last one is filed. The first folds after a cold start
    // carry the page's first paints and the compositor layer the panel is given — eighteen
    // milliseconds on this machine, three periods of a 165 Hz display — and those frames say
    // what starting costs, not what the fold costs. What the lot asks of the fold is measured
    // on a window that has already drawn it.
    const play = 'window.hemeraWitness.play()'
    await window.webContents.executeJavaScript(play)
    await window.webContents.executeJavaScript(play)
    // SAFETY: `play` is the renderer's `window.hemeraWitness.play`, declared in `bridge.d.ts`
    // to resolve a `MotionMeasure`; `executeJavaScript` returns it untyped.
    const motion = (await window.webContents.executeJavaScript(play)) as MotionMeasure
    // Read after the page has painted: what the GPU decided is only true once it drew.
    process.stdout.write(JSON.stringify({ ...(await collectReport()), motion }))
    app.quit()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})
