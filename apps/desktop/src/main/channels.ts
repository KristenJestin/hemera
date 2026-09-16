/** Wires the declared channels to what the main process does when one is called. */

import type { DisplayPreferences } from '@hemera/ipc'
import type { BrowserWindow } from 'electron/main'
import { Effect } from 'effect'

import type { ApplicationIdentity } from './channel.ts'
import { readSidecar, writeSidecar } from './display-sidecar.ts'
import { collectReport } from './environment.ts'
import { handle } from './handle.ts'
import type { ProfileConversation } from './profile-conversation.ts'
import { wearPreference } from './window.ts'

/** Whether the hint the window was painted from says what the profile turned out to say. */
function agrees(hint: DisplayPreferences | null, held: DisplayPreferences): boolean {
  return hint !== null && JSON.stringify(hint) === JSON.stringify(held)
}

export function registerChannels(
  window: BrowserWindow,
  identity: ApplicationIdentity,
  profile: ProfileConversation,
  directory: string,
): void {
  handle('env.report', () => Effect.promise(() => collectReport(identity)))

  handle('window.command', ({ command }) =>
    Effect.sync(() => {
      if (command === 'minimize') return window.minimize()
      if (command === 'close') return window.close()
      return window.isMaximized() ? window.unmaximize() : window.maximize()
    }),
  )

  /**
   * What the page wears, which the profile is the authority on (design D3-07).
   *
   * The window was already painted from the hint before any of this existed. What the profile
   * answers is what wins: the platform is put on it, and the hint is rewritten when the two had
   * drifted apart — so the next start is painted right even if this one was not.
   */
  handle('preferences.read', () =>
    profile.ask('preferences.read', {}).pipe(
      Effect.tap((held) =>
        Effect.sync(() => {
          wearPreference(window, held.theme)
          if (!agrees(readSidecar(directory), held)) writeSidecar(directory, held)
        }),
      ),
    ),
  )

  /**
   * A change the page made, handed to the profile and then to the platform.
   *
   * The profile is asked again rather than guessed at: a change carries only what changed, and
   * what the hint has to hold is the whole of what the window wears.
   */
  handle('preferences.write', (change) =>
    profile.ask('preferences.write', change).pipe(
      Effect.flatMap(() => profile.ask('preferences.read', {})),
      Effect.tap((held) =>
        Effect.sync(() => {
          if (change.theme !== undefined) wearPreference(window, held.theme)
          writeSidecar(directory, held)
        }),
      ),
      Effect.asVoid,
    ),
  )
}
