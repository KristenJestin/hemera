/** Wires the declared channels to what the main process does when one is called. */

import type { DisplayPreferences } from '@hemera/ipc'
import { type BrowserWindow, dialog } from 'electron/main'
import { shell } from 'electron/common'
import { join } from 'node:path'

import { Effect } from 'effect'

import type { ApplicationIdentity } from './channel.ts'
import { readSidecar, writeSidecar } from './display-sidecar.ts'
import { DIAGNOSTIC_FILE } from './diagnostic.ts'
import { collectReport } from './environment.ts'
import { handle } from './handle.ts'
import type { EngineConversation } from './engine-conversation.ts'
import { wearPreference } from './window.ts'
import {
  checkFolder,
  repositoryStatus,
  within,
  workspaceFiles,
  workspaceFolders,
} from './workspace.ts'

/** Whether the hint the window was painted from says what the engine turned out to say. */
function agrees(hint: DisplayPreferences | null, held: DisplayPreferences): boolean {
  return hint !== null && JSON.stringify(hint) === JSON.stringify(held)
}

export function registerChannels(
  window: BrowserWindow,
  identity: ApplicationIdentity,
  engine: EngineConversation,
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
   * What the page wears, which the engine is the authority on (design D3-07).
   *
   * The window was already painted from the hint before any of this existed. What the engine
   * answers is what wins: the platform is put on it, and the hint is rewritten when the two had
   * drifted apart — so the next start is painted right even if this one was not.
   */
  handle('preferences.read', () =>
    engine.ask('preferences.read', {}).pipe(
      Effect.tap((held) =>
        Effect.sync(() => {
          wearPreference(window, held.theme)
          if (!agrees(readSidecar(directory), held)) writeSidecar(directory, held)
        }),
      ),
    ),
  )

  /**
   * A change the page made, handed to the engine and then to the platform.
   *
   * The engine is asked again rather than guessed at: a change carries only what changed, and
   * what the hint has to hold is the whole of what the window wears.
   */
  handle('preferences.write', (change) =>
    engine.ask('preferences.write', change).pipe(
      Effect.flatMap(() => engine.ask('preferences.read', {})),
      Effect.tap((held) =>
        Effect.sync(() => {
          if (change.theme !== undefined) wearPreference(window, held.theme)
          writeSidecar(directory, held)
        }),
      ),
      Effect.asVoid,
    ),
  )

  /**
   * The Projects and their Journal, handed straight to the process that holds the database.
   *
   * One line each, because that is all a relay is: the origin was checked before this function
   * was reached, the schema was checked there too, and the engine checks it again on the way
   * in. A relay that did anything else would be a second place where a use case lives.
   */
  for (const name of RELAYED) relay(name, engine)

  /**
   * A folder the user chose, never a path the page asked for.
   *
   * Named and labelled, because a picker left to its defaults is titled "Open File" whatever it
   * is picking, and a window that says File while greying out every file is a window the user
   * reads twice. `createDirectory` because the folder of a Workspace is often one that does not
   * exist yet — which is the whole reason the field accepts a path nothing is at.
   */
  handle('dialog.pickFolder', () =>
    Effect.promise(async () => {
      const chosen = await dialog.showOpenDialog(window, {
        title: 'Choose a folder',
        buttonLabel: 'Choose',
        properties: ['openDirectory', 'createDirectory'],
      })
      return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
    }),
  )

  /**
   * Files the user chose, answered relative to the root they were chosen under.
   *
   * What is outside that root is dropped here rather than shown and refused later: the page
   * attaches what it is handed, and the one place that can tell a path inside a Workspace from
   * a path outside it is the process that has a disk.
   */
  handle('dialog.pickFiles', ({ root }) =>
    Effect.promise(async () => {
      const chosen = await dialog.showOpenDialog(window, {
        title: 'Attach files of the Project',
        buttonLabel: 'Attach',
        defaultPath: root,
        properties: ['openFile', 'multiSelections'],
      })
      if (chosen.canceled) return []
      const under: string[] = []
      for (const path of chosen.filePaths) {
        const inside = within(root, path)
        if (inside !== null) under.push(inside)
      }
      return under
    }),
  )

  /**
   * Opens one of the two things the settings offer, with the desktop.
   *
   * The page asks for the folder or for the diagnostic and never for a path: a channel that
   * opened whatever it was handed would be a channel a page could be talked into opening
   * anything with, and a page building the path itself would be a page that has to know how
   * this system spells one — which is how `…/diagnostic.log` came to be a file Windows never
   * found. Both are resolved here, from the data folder this process was started on.
   */
  handle('shell.open', ({ what }) =>
    Effect.promise(async () => {
      await shell.openPath(what === 'folder' ? directory : join(directory, DIAGNOSTIC_FILE))
    }),
  )

  handle('repositories.status', ({ root, paths }) =>
    Effect.promise(() => repositoryStatus(root, paths)),
  )

  handle('workspace.files', ({ root, query, limit }) =>
    Effect.promise(() => workspaceFiles(root, query, limit)),
  )

  handle('workspace.folders', ({ root }) => Effect.promise(() => workspaceFolders(root)))

  handle('workspace.check', ({ path }) => Effect.promise(() => checkFolder(path)))
}

/** Every channel that is nothing but a message on its way to the engine and back. */
const RELAYED = [
  'engine.status',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.moveMain',
  'projects.archive',
  'projects.restore',
  'repositories.add',
  'repositories.remove',
  'journal.read',
  'journal.unseen',
  'journal.markSeen',
] as const

type Relayed = (typeof RELAYED)[number]

/** One channel, answered by asking the engine the use case of the same name. */
function relay(name: Relayed, engine: EngineConversation): void {
  handle(name, (argument) => engine.ask(name, argument))
}
