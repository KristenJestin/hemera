/**
 * The commands as the window asks for them: the Project settings and the Commands panel (D6-12).
 *
 * The agent reaches the same catalogue and the same runs through its tools; the window reaches
 * them through these, and the two differ in one thing only — who is asking. A command the user
 * runs from the panel is the user's own act: nothing is asked of anyone, and the run is written
 * in the Journal under the user. A folder is one of two things, the Workspace root or one of the
 * Project's repositories as the Project declares it, and anything else is refused here rather
 * than stored and found wrong the day it runs.
 */

import { join } from 'node:path'

import {
  type CommandKind,
  EmptyCommandLineError,
  EmptyCommandNameError,
  commandLine,
  commandName,
  repositoryPath,
} from '@hemera/core'
import { Effect } from 'effect'

import { Projects, UnknownProjectError } from '../projects.ts'
import { Sessions } from '../sessions.ts'
import { Commands, UnknownCommandError } from './service.ts'

/** A folder that is neither the Workspace root nor one of the Project's repositories. */
export class UnknownCommandFolderError extends Error {
  constructor(readonly folder: string) {
    super(
      `a command runs in the Workspace root or in one of the Project's repositories, and ${folder} is neither`,
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
  readonly kind: CommandKind
  readonly folder: string | null
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
    try: () => ({ name: commandName(draft.name), line: commandLine(draft.line) }),
    catch: (refused) =>
      refused instanceof EmptyCommandLineError ? refused : new EmptyCommandNameError(),
  })

/**
 * The folder of a draft: the root, or a repository the Project declares — nothing else.
 *
 * Read as the Project reads a repository, so `sources/api` and `./sources/api/` are the one
 * location it declared, stored the way it declared it.
 */
const folderOf = (draft: CommandDraft) =>
  Effect.gen(function* () {
    const said = draft.folder === null ? '' : draft.folder.trim()
    if (said === '' || said === '.' || said === './') return null
    const folder = yield* Effect.try({
      try: () => repositoryPath(said),
      catch: () => new UnknownCommandFolderError(said),
    })
    const project = yield* projectOf(draft.projectId)
    if (!project.repositories.includes(folder)) {
      return yield* Effect.fail(new UnknownCommandFolderError(said))
    }
    return folder
  })

/** Adds a command to the catalogue; a name it already holds is refused, not replaced. */
export const createCommand = (draft: CommandDraft) =>
  Effect.gen(function* () {
    const { name, line } = yield* read(draft)
    const folder = yield* folderOf(draft)
    const commands = yield* Commands
    return yield* commands.save({ ...draft, name, line, folder }, false)
  })

/** Rewrites a command the catalogue holds, by its name; one it does not hold is refused. */
export const updateCommand = (draft: CommandDraft) =>
  Effect.gen(function* () {
    const { name, line } = yield* read(draft)
    const folder = yield* folderOf(draft)
    const commands = yield* Commands
    const held = yield* commands.list(draft.projectId)
    if (!held.some((one) => one.name === name)) {
      return yield* Effect.fail(new UnknownCommandError(name))
    }
    return yield* commands.save({ ...draft, name, line, folder }, true)
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
 * and the run is the same one the agent would have started — an app already running is handed
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
    const name = named?.trim() ?? ''
    const line = written?.trim() ?? ''
    if (name !== '') {
      const catalogue = yield* commands.list(project.id)
      const entry = catalogue.find((one) => one.name === name)
      if (entry === undefined) return yield* Effect.fail(new UnknownCommandError(name))
      return yield* commands.run({
        sessionId,
        projectId: project.id,
        commandId: entry.id,
        name: entry.name,
        line: entry.line,
        kind: entry.kind,
        cwd: entry.folder === null ? project.mainPath : join(project.mainPath, entry.folder),
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
      kind: 'utility',
      cwd: project.mainPath,
      startedBy: 'user',
    })
  })
