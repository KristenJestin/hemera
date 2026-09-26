/** Wires the declared channels to what the main process does when one is called. */

import type { DisplayPreferences, EngineEvent } from '@hemera/ipc'
import { ENGINE_EVENT_CHANNEL } from '@hemera/ipc'
import { type BrowserWindow, dialog } from 'electron/main'
import type { OpenDialogOptions } from 'electron'
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
  // What the engine pushes while a Session is worked on goes straight to the page, on the one
  // channel the preload listens on: nothing in the main process reads it, and a turn that is
  // happening is drawn from what arrives rather than from asking again (D5-12).
  engine.hear((event: EngineEvent) => {
    if (window.isDestroyed()) return
    window.webContents.send(ENGINE_EVENT_CHANNEL, event)
  })

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
   *
   * It opens on the folder the page says the user is working in, when it says one: a command's
   * picker starts where that command runs from. A page that says nothing gets the system's own
   * last place, which is where a picker left to itself opens.
   */
  handle('dialog.pickFolder', ({ start }) =>
    Effect.promise(async () => {
      const options: OpenDialogOptions = {
        title: 'Choose a folder',
        buttonLabel: 'Choose',
        properties: ['openDirectory', 'createDirectory'],
      }
      if (start !== undefined) options.defaultPath = start
      const chosen = await dialog.showOpenDialog(window, options)
      return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
    }),
  )

  /**
   * Files the user chose, each named the way it can be named.
   *
   * The clip is for any file on the machine, not for the Workspace's own: what is chosen inside
   * the root is answered relative to it, since that is the name the Project itself uses, and
   * what is chosen anywhere else is answered by the absolute path it has — which is the only
   * name it has. Dropping the second kind here is what made the clip look broken: a file picked
   * from the wrong folder attaches nothing at all, and nothing says why.
   */
  handle('dialog.pickFiles', ({ root }) =>
    Effect.promise(async () => {
      const chosen = await dialog.showOpenDialog(window, {
        title: 'Attach files',
        buttonLabel: 'Attach',
        defaultPath: root,
        properties: ['openFile', 'multiSelections'],
      })
      if (chosen.canceled) return []
      return chosen.filePaths.map((path) => within(root, path) ?? path)
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
  'repositories.update',
  'projects.setWorkspacesRoot',
  'projects.setBranchPrefix',
  'projects.setRepositoryIncluded',
  'journal.read',
  'journal.unseen',
  'journal.markSeen',
  'sessions.list',
  'sessions.create',
  'sessions.rename',
  'sessions.chooseWorkspace',
  'sessions.archive',
  'sessions.restore',
  'sessions.append',
  'sessions.read',
  // The agents, relayed like the rest: what a Session is, what it was asked, and whether the
  // command of an agent is on this machine are all the engine's to answer (design D5-13, D5-18).
  'agents.list',
  'agents.options',
  'agents.offer',
  'agents.offerSet',
  'agents.setOption',
  'agents.prompt',
  'agents.stop',
  'agents.decide',
  'agents.resume',
  'agents.check',
  'agents.update',
  // What Hemera lends the agent: the commands of a Project and the runs they became, and what a
  // Session was provided. A process and a file are the engine's, like the rest (D6-10, D6-12).
  'commands.list',
  'commands.portless',
  'commands.create',
  'commands.update',
  'commands.remove',
  'commands.runs',
  'commands.run',
  'commands.stop',
  'commands.output',
  'commands.runOf',
  'commands.services',
  'commands.stopService',
  'commands.proposeAccept',
  'commands.proposeDecline',
  'context.read',
  // The Workspaces of a Project, their preparation, the recipe and the variables: rows, worktrees
  // and steps the engine holds and runs (D8-01 to D8-06).
  'workspaces.list',
  'workspaces.plan',
  'workspaces.planRepository',
  'workspaces.create',
  'workspaces.createOnFolder',
  'workspaces.status',
  'workspaces.cleanup',
  'preparation.steps',
  'preparation.prepare',
  'preparation.resume',
  'recipe.list',
  'recipe.add',
  'recipe.update',
  'recipe.remove',
  'recipe.move',
  'variables.list',
  'variables.set',
  'variables.remove',
  // A build asked for on a ready Spec (D8-13).
  'launches.request',
  // The Specs, all of them the engine's to answer (D7-01).
  'specs.list',
  'specs.read',
  'specs.revisions',
  'specs.create',
  'specs.declineProposal',
  'specs.openSession',
  'specs.writeSection',
  'specs.writeStories',
  'specs.writeTasks',
  'specs.raiseQuestion',
  'specs.answerQuestion',
  'specs.markReady',
  'specs.reopen',
  'specs.transferWrite',
  'specs.buffers.read',
  'specs.buffers.save',
  'specs.buffers.discard',
  // The Workspace a Spec is set on, and the launch of its build (D8-12, D8-13).
  'specs.useWorkspace',
  'launches.forSpec',
  'launches.request',
  'launches.start',
  'launches.retry',
  // The build of a `build` Session and the checks it is judged by, the engine's like the rest
  // (D10-04, D10-06).
  'build.read',
  'build.pause',
  'build.resume',
  'build.accept',
  'build.stop',
  'build.taskDone',
  'build.taskSkip',
  'build.dismissBlocker',
  'checks.list',
  'checks.save',
  'checks.remove',
  'checks.acceptProposed',
] as const

type Relayed = (typeof RELAYED)[number]

/** One channel, answered by asking the engine the use case of the same name. */
function relay(name: Relayed, engine: EngineConversation): void {
  handle(name, (argument) => engine.ask(name, argument))
}
