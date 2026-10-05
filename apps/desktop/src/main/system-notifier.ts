/**
 * The notifier's ports on this machine: Electron's `Notification` in main, the window's focus, Do
 * Not Disturb as the desktop says it, and the system's own sound player, which previews too.
 *
 * Under the headless end-to-end suite nothing reaches the desktop of whoever runs it: no system
 * notification, no sound, no window brought forward. What would have been is written to the
 * diagnostic log instead.
 */

import type { NotificationSettings, Sound, SoundStyle, WindowNotice } from '@hemera/ipc'
import { Effect } from 'effect'
import { BrowserWindow, Notification } from 'electron/main'

import type { Log } from './diagnostic.ts'
import { readDoNotDisturb, systemAsker } from './do-not-disturb.ts'
import type { DoNotDisturb } from './notifications.ts'
import type { NotifierPorts } from './notifier.ts'
import { playStyle, systemPlayer } from './sounds.ts'

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

export interface SystemSoundsOptions {
  readonly soundsFolder: string
  /** Under the headless suite: nothing reaches the desktop. */
  readonly quiet: boolean
  readonly log: Log
}

/** Do Not Disturb and the sound player of this machine, shared by notifications and previews. */
export interface SystemSounds {
  readonly doNotDisturb: Effect.Effect<DoNotDisturb>
  /** Plays a sound in a style: whether a player did. */
  readonly play: (style: SoundStyle, sound: Sound) => Effect.Effect<boolean>
}

export function systemSounds(options: SystemSoundsOptions): SystemSounds {
  const { soundsFolder, quiet, log } = options
  const playing = playStyle(process.platform, soundsFolder, systemPlayer)
  return {
    doNotDisturb: quiet
      ? Effect.succeed('off')
      : Effect.promise(() => readDoNotDisturb(process.platform, process.env, systemAsker)),
    play: (style, sound) =>
      Effect.promise(async () => {
        if (quiet) {
          log(`a sound was not played: ${style}/${sound}`)
          return false
        }
        const played = await playing(style, sound)
        if (!played) log(`no player could play the sound ${style}/${sound}`)
        return played
      }),
  }
}

export interface SystemNotifierOptions {
  readonly settings: Effect.Effect<NotificationSettings, Error>
  readonly tell: (notice: WindowNotice) => void
  readonly sounds: SystemSounds
  /** Under the headless suite: nothing reaches the desktop. */
  readonly quiet: boolean
  readonly log: Log
}

export function systemNotifierPorts(options: SystemNotifierOptions): NotifierPorts {
  const { settings, tell, sounds, quiet, log } = options
  return {
    focused: hasFocus,
    settings,
    doNotDisturb: sounds.doNotDisturb,
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
    play: (sound, style) => {
      Effect.runFork(sounds.play(style, sound))
    },
    bringForward: () => {
      if (!quiet) bringForward()
    },
    tell,
    log,
  }
}
