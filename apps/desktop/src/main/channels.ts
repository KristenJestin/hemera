/** Wires the declared channels to what the main process does when one is called. */

import type { BrowserWindow } from 'electron/main'

import { collectReport } from './environment.ts'
import { handle } from './handle.ts'
import { wearPreference } from './window.ts'

export function registerChannels(window: BrowserWindow): void {
  handle('env.report', () => collectReport())

  handle('window.command', ({ command }) => {
    if (command === 'minimize') return window.minimize()
    if (command === 'close') return window.close()
    return window.isMaximized() ? window.unmaximize() : window.maximize()
  })

  // The page asks; the platform decides, and everything follows from what it answers — the
  // frame, the system's window buttons, and `prefers-color-scheme` inside the page itself.
  handle('theme.set', ({ preference }) => {
    wearPreference(window, preference)
  })
}
