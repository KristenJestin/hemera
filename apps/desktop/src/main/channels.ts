/** Wires the declared channels to what the main process does when one is called. */

import type { BrowserWindow } from 'electron/main'

import { handle } from './handle.ts'

export function registerChannels(window: BrowserWindow): void {
  handle('window.command', ({ command }) => {
    if (command === 'minimize') return window.minimize()
    if (command === 'close') return window.close()
    return window.isMaximized() ? window.unmaximize() : window.maximize()
  })
}
