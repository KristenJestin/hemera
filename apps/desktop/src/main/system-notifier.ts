/**
 * The notifier's ports on this machine: Electron's `Notification` in main, the window's focus, Do
 * Not Disturb as the desktop says it, and the system's own sound player.
 *
 * Under the headless end-to-end suite nothing reaches the desktop of whoever runs it: no system
 * notification, no sound, no window brought forward. What would have been is written to the
 * diagnostic log instead.
 */

import type { NotificationSettings, WindowNotice } from '@hemera/ipc'
import { Effect } from 'effect'
import { BrowserWindow, Notification } from 'electron/main'

import type { Log } from './diagnostic.ts'
import { readDoNotDisturb, systemAsker } from './do-not-disturb.ts'
import type { NotifierPorts } from './notifier.ts'
import { playSound, soundFile, systemPlayer } from './sounds.ts'

/** The window, when there is one: the application has one. */
const theWindow = (): BrowserWindow | undefined => BrowserWindow.getAllWindows()[0]

/** Shown, not minimised, and focused. */
function hasFocus(): boolean {
  const window = theWindow()
  return window !== undefined && window.isVisible() && !window.isMinimized() && window.isFocused()
}

function bringForward(): void {
  const window = theWindow()
  if (window === undefined) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export interface SystemNotifierOptions {
  readonly settings: Effect.Effect<NotificationSettings, Error>
  readonly tell: (notice: WindowNotice) => void
  readonly soundsFolder: string
  /** Under the headless suite: nothing reaches the desktop. */
  readonly quiet: boolean
  readonly log: Log
}

export function systemNotifierPorts(options: SystemNotifierOptions): NotifierPorts {
  const { settings, tell, soundsFolder, quiet, log } = options
  return {
    focused: hasFocus,
    settings,
    doNotDisturb: quiet
      ? Effect.succeed('off')
      : Effect.promise(() => readDoNotDisturb(process.platform, process.env, systemAsker)),
    show: (delivery, onClick) => {
      if (quiet || !Notification.isSupported()) {
        log(`a system notification was not shown: ${delivery.body}`)
        return { close: () => undefined }
      }
      // Silent: the sound is Hemera's own, played once for the group, or none at all.
      const notification = new Notification({
        title: delivery.title,
        body: delivery.body,
        silent: true,
      })
      notification.on('click', onClick)
      notification.on('failed', (_, error) => log(`a system notification failed: ${error}`))
      notification.show()
      return { close: () => notification.close() }
    },
    play: (sound) => {
      if (quiet) return log(`a sound was not played: ${sound}`)
      void playSound(process.platform, soundFile(soundsFolder, sound), systemPlayer).then(
        (played) => {
          if (!played) log(`no player could play the sound ${sound}`)
        },
      )
    },
    bringForward: () => {
      if (!quiet) bringForward()
    },
    tell,
    log,
  }
}
