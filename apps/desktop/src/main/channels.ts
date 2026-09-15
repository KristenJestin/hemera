/** Wires the declared channels to what the main process does when one is called. */

import type { BrowserWindow } from 'electron/main'

import { collectReport } from './environment.ts'
import { handle } from './handle.ts'

export function registerChannels(window: BrowserWindow): void {
  handle('env.report', () => collectReport())

  handle('window.command', ({ command }) => {
    if (command === 'minimize') return window.minimize()
    if (command === 'close') return window.close()
    return window.isMaximized() ? window.unmaximize() : window.maximize()
  })
}
