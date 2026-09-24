/**
 * The commands as the window asks for them: the Project settings and the Commands panel (D6-12).
 *
 * The agent reaches the same catalogue and the same runs through its tools; the window reaches
 * them through these, and the two differ in one thing only — who is asking. A command the user
 * runs from the panel is the user's own act: nothing is asked of anyone, and the run is written
 * in the Journal under the user. Where a command runs is a base — the Workspace root, or one of
 * the Project's repositories as the Project declares it — and a folder under that base (D8-07 as
 * amended by recette 1); a base the Project does not declare, and a folder that leaves its base,
 * are refused here rather than stored and found wrong the day it runs.
 */

import {
  type CommandScope,
  type CommandType,
  EmptyCommandLineError,
  EmptyCommandNameError,
  InvalidCommandFolderError,
  InvalidPortlessNameError,
  commandFolder,
  commandLine,
  commandName,
  portlessName,
  repositoryPath,
  runsInMain,
} from '@hemera/core'
import { Effect } from 'effect'

import { Projects, UnknownProjectError } from '../projects.ts'
import { Sessions } from '../sessions.ts'
import { Variables } from '../workspaces/variables.ts'
import { Commands, UnknownCommandError, commandCwd } from './service.ts'

/** A base that is neither the Workspace root nor one of the Project's repositories. */
export class UnknownCommandFolderError extends Error {
  constructor(readonly folder: string) {
    super(
      `a command runs under the Workspace root or under one of the Project's repositories, and ${folder} is neither`,
    )
    this.name = 'UnknownCommandFolderError'
  }
}

/** A run from the panel that names neither a command of the catalogue nor a line. */
export class NothingToRunError extends Error {
  constructor() {
    super('nothing to run: name a command of the catalogue, or write a line')
    this.name = 'NothingToRunError'
  }
}

/** What a catalogue entry is written from, as the settings send it. */
export interface CommandDraft {
  readonly projectId: string
  readonly name: string
  readonly line: string
  readonly lineWindows: string | null
  readonly lineLinux: string | null
  readonly type: CommandType
  /** A repository the Project declares, and null for the Workspace root. */
  readonly folderBase: string | null
  /** A folder under that base, relative to it, and null for the base itself. */
  readonly folder: string | null
  readonly scope: CommandScope
  readonly portless: boolean
  /** The name Portless serves it under, and null for the Project's name as a slug (D8-10). */
  readonly portlessName: string | null
}

/** The Project a command or a Session belongs to, read among every Project. */
const projectOf = (projectId: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const all = yield* projects.list(true)
    const project = all.find((one) => one.id === projectId)
    if (project === undefined) return yield* Effect.fail(new UnknownProjectError(projectId))
    return project
  })

/** The Session a run is asked for from. */
const sessionOf = (sessionId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const { session } = yield* sessions.one(sessionId)
    return session
  })

/**
 * The name and the line of a draft, read by the rules of the domain.
 *
 * Read here rather than left to the service, which reads them inside its transaction: a rule the
 * domain throws for is a refusal the window shows under the field, not a defect of the engine.
 */
const read = (draft: CommandDraft) =>
  Effect.try({
    try: () => ({
      name: commandName(draft.name),
      line: commandLine(draft.line),
      portlessName: portlessName(draft.portlessName),
    }),
    catch: (refused) =>
      refused instanceof EmptyCommandLineError || refused instanceof InvalidPortlessNameError
        ? refused
        : new EmptyCommandNameError(),
  })

/**
 * Where a draft runs: its base — the root, or a repository the Project declares, nothing else —
 * and its folder under that base, which never leaves it (D8-07 as amended by recette 1).
 *
 * The base is read as the Project reads a repository, so `sources/api` and `./sources/api/` are
 * the one location it declared, stored the way it declared it; the folder is kept as `./<path>`,
 * and null when it is the base itself.
 */
const placeOf = (draft: CommandDraft) =>
  Effect.gen(function* () {
    const said = draft.folderBase === null ? '' : draft.folderBase.trim()
    const folder = yield* Effect.try({
      try: () => commandFolder(draft.folder),
      catch: (refused) =>
        refused instanceof InvalidCommandFolderError
          ? refused
          : new InvalidCommandFolderError(draft.folder ?? '', String(refused)),
    })
    if (said === '' || said === '.' || said === './') return { folderBase: null, folder }
    const folderBase = yield* Effect.try({
      try: () => repositoryPath(said),
      catch: () => new UnknownCommandFolderError(said),
    })
    const project = yield* projectOf(draft.projectId)
    if (!project.repositories.includes(folderBase)) {
      return yield* Effect.fail(new UnknownCommandFolderError(said))
    }
    return { folderBase, folder }
  })

/** Adds a command to the catalogue; a name it already holds is refused, not replaced. */
export const createCommand = (draft: CommandDraft) =>
  Effect.gen(function* () {
    const { name, line, portlessName: named } = yield* read(draft)
    const place = yield* placeOf(draft)
    const commands = yield* Commands
    return yield* commands.save({ ...draft, name, line, portlessName: named, ...place }, false)
  })

/** Rewrites a command the catalogue holds, by its name; one it does not hold is refused. */
export const updateCommand = (draft: CommandDraft) =>
  Effect.gen(function* () {
    const { name, line, portlessName: named } = yield* read(draft)
    const place = yield* placeOf(draft)
    const commands = yield* Commands
    const held = yield* commands.list(draft.projectId)
    if (!held.some((one) => one.name === name)) {
      return yield* Effect.fail(new UnknownCommandError(name))
    }
    return yield* commands.save({ ...draft, name, line, portlessName: named, ...place }, true)
  })

/**
 * The runs of a Session, oldest first: the ones going as they stand, and the ones that ended.
 *
 * What is running is read from memory, where its output is up to the last line; what ended is
 * read from its row, which is what is left of it.
 */
export const runsOf = (sessionId: string) =>
  Effect.gen(function* () {
    const commands = yield* Commands
    const running = yield* commands.running(sessionId)
    const recent = yield* commands.recent(sessionId)
    const live = new Map(running.map((run) => [run.id, run]))
    const ended = recent.filter((run) => !live.has(run.id))
    return [...ended, ...running].sort((left, right) =>
      left.startedAt < right.startedAt ? -1 : left.startedAt > right.startedAt ? 1 : 0,
    )
  })

/**
 * Runs a command of the catalogue by name, or a one-off line, from the panel (D6-12).
 *
 * The user's act: a catalogue command runs in its folder, a one-off line in the Workspace root,
 * and the run is the same one the agent would have started — a server already running is handed
 * back rather than started twice. A one-off is not added to the catalogue.
 */
export const runFromPanel = (
  sessionId: string,
  named: string | undefined,
  written: string | undefined,
) =>
  Effect.gen(function* () {
    const session = yield* sessionOf(sessionId)
    const project = yield* projectOf(session.projectId)
    const commands = yield* Commands
    const sessions = yield* Sessions
    const variables = yield* Variables
    // The run belongs to the Session's Workspace (D8-08), with the variables Hemera gives it:
    // the Project's, overridden by the Workspace's (D8-06).
    const workspace = yield* sessions.workspace(sessionId)
    const name = named?.trim() ?? ''
    const line = written?.trim() ?? ''
    if (name !== '') {
      const catalogue = yield* commands.list(project.id)
      const entry = catalogue.find((one) => one.name === name)
      if (entry === undefined) return yield* Effect.fail(new UnknownCommandError(name))
      // A Project-scoped service is one instance for all, in `main`, whichever Workspace this
      // Session works in (D8-07), with `main`'s variables.
      const home = runsInMain(entry) ? yield* sessions.mainOf(project.id) : workspace
      // Its folder under its base, resolved under the Workspace the run is in (D8-07 as amended).
      const { folder, cwd } = yield* commandCwd(home.path, entry)
      return yield* commands.run({
        sessionId,
        projectId: project.id,
        commandId: entry.id,
        name: entry.name,
        line: entry.line,
        lineWindows: entry.lineWindows,
        lineLinux: entry.lineLinux,
        type: entry.type,
        scope: entry.scope,
        portless: entry.portless,
        portlessName: entry.portlessName,
        folder,
        cwd,
        workspaceId: home.id,
        workspaceName: home.name,
        environment: yield* variables.givenFor(project.id, home.id),
        startedBy: 'user',
      })
    }
    if (line === '') return yield* Effect.fail(new NothingToRunError())
    return yield* commands.run({
      sessionId,
      projectId: project.id,
      commandId: null,
      // What a one-off is called on screen: the program it runs, which is its first word.
      name: line.split(/\s+/)[0] ?? line,
      line,
      lineWindows: null,
      lineLinux: null,
      type: 'script',
      scope: 'workspace',
      portless: false,
      portlessName: null,
      folder: null,
      cwd: workspace.path,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      environment: yield* variables.givenFor(project.id, workspace.id),
      startedBy: 'user',
    })
  })
