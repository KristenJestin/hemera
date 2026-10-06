/**
 * A Project's command catalogue: how to serve its web app, run its tests, lint, type-check, build,
 * run its e2e. Everything that runs a command in Hemera reads it here.
 *
 * Saving checks the whole command first and refuses, with a sentence naming what is wrong, an
 * empty name or line, a name another command has, a repository the Project does not declare, a
 * folder that leaves its repository, a template name Hemera does not fill, shell syntax in any of
 * its lines, a Portless name of more than one word, and a write glob that cannot be one.
 */

import {
  COMMAND_SCOPES,
  COMMAND_TYPES,
  type CommandScope,
  type CommandType,
  InvalidCommand,
  ROOT_REPOSITORY,
  checkedLine,
  checkedTemplate,
  portlessName,
  repositoryPath,
  writeGlob,
} from '@hemera/core/domain'
import {
  type Command,
  type CommandDraft,
  type CommandSave,
  type LineCheck,
  type Project,
  UnknownCommand,
} from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Option, Result, Schema } from 'effect'

import type { EventPayload } from './journal.ts'
import { getProject } from './projects.ts'
import { Database, refusedWhile } from './storage/database.ts'
import { projectCommands } from './storage/schema.ts'
import { mutate } from './transaction.ts'

type CommandRow = typeof projectCommands.$inferSelect

const readGlobs = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
const commandType = (type: string): CommandType =>
  COMMAND_TYPES.find((one) => one === type) ?? 'script'
const commandScope = (scope: string): CommandScope =>
  COMMAND_SCOPES.find((one) => one === scope) ?? 'workspace'

const commandOf = (row: CommandRow): Command => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  type: commandType(row.type),
  line: row.line,
  lineWindows: row.lineWindows,
  lineLinux: row.lineLinux,
  repositoryId: row.repositoryId,
  folder: row.folder,
  scope: commandScope(row.scope),
  portless: row.portless,
  portlessName: row.portlessName,
  check: row.check,
  atOpen: row.atOpen,
  askBeforeRunning: row.askBeforeRunning,
  readOnly: row.readOnly,
  writeGlobs: Option.getOrElse(readGlobs(row.writeGlobs), () => []),
})

const rowsOf = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(projectCommands)
      .where(eq(projectCommands.projectId, projectId))
      .orderBy(asc(projectCommands.createdAt), asc(projectCommands.name))
      .pipe(Effect.mapError(refusedWhile('reading the commands')))
  })

/** A Project's catalogue, in the order its commands were added. */
export const listCommands = (projectId: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    return (yield* rowsOf(projectId)).map(commandOf)
  })

/** Every Project's commands marked to run at each opening. */
export const atOpenCommands = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database
    .select()
    .from(projectCommands)
    .where(eq(projectCommands.atOpen, true))
    .orderBy(asc(projectCommands.createdAt), asc(projectCommands.name))
    .pipe(Effect.mapError(refusedWhile('reading the commands')))
  return rows.map(commandOf)
})

/** One command of a Project's catalogue. */
export const getCommand = (projectId: string, id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(projectCommands)
      .where(and(eq(projectCommands.projectId, projectId), eq(projectCommands.id, id)))
      .pipe(Effect.mapError(refusedWhile('reading the commands')))
    if (row === undefined) return yield* new UnknownCommand({ id })
    return commandOf(row)
  })

const refused = (reason: string) => Effect.fail(new InvalidCommand({ reason }))

const blank = (text: string | null): boolean => text === null || text.trim() === ''

/** A line Hemera can run: without shell syntax, naming only template names it fills. */
const runnableLine = (line: string) =>
  Effect.gen(function* () {
    yield* Effect.fromResult(checkedLine(line))
    return yield* Effect.fromResult(checkedTemplate(line))
  })

/** The command as it will be written, or the first thing wrong with it. */
export const checkedCommand = (project: Project, draft: CommandDraft) =>
  Effect.gen(function* () {
    const name = draft.name.trim()
    if (name === '') return yield* refused('its name is empty')
    const line = draft.line.trim()
    if (line === '') return yield* refused('its line is empty')
    yield* runnableLine(line)
    const lineWindows = blank(draft.lineWindows) ? null : (draft.lineWindows ?? '').trim()
    const lineLinux = blank(draft.lineLinux) ? null : (draft.lineLinux ?? '').trim()
    if (lineWindows !== null) yield* runnableLine(lineWindows)
    if (lineLinux !== null) yield* runnableLine(lineLinux)

    if (
      draft.repositoryId !== null &&
      !project.repositories.some((one) => one.id === draft.repositoryId)
    ) {
      return yield* refused('its repository is not one of this Project')
    }
    const folder = blank(draft.folder)
      ? ROOT_REPOSITORY
      : yield* Effect.fromResult(repositoryPath(draft.folder ?? '')).pipe(
          Effect.mapError(
            (failure) =>
              new InvalidCommand({
                reason: `its folder “${failure.path}”: ${failure.reason.replace('the main checkout', 'its place')}`,
              }),
          ),
        )
    yield* Effect.fromResult(checkedTemplate(folder))

    const named = yield* Effect.fromResult(portlessName(draft.portlessName))
    const globs: string[] = []
    for (const glob of draft.writeGlobs) {
      const kept = writeGlob(glob)
      if (Result.isFailure(kept)) return yield* kept.failure
      if (!globs.includes(kept.success)) globs.push(kept.success)
    }
    return {
      ...draft,
      name,
      line,
      lineWindows,
      lineLinux,
      folder: folder === ROOT_REPOSITORY ? null : folder,
      portlessName: named,
      writeGlobs: globs,
    } satisfies CommandDraft
  })

const commandEvent = (type: string, projectId: string, payload: EventPayload) => ({
  type,
  entityKind: 'project',
  entityId: projectId,
  source: 'ui' as const,
  author: 'human' as const,
  payload,
})

/** Adds a command (`id` null) or rewrites one, every field checked first. */
export const saveCommand = (save: CommandSave) =>
  Effect.gen(function* () {
    const project = yield* getProject(save.projectId)
    const command = yield* checkedCommand(project, save.command)
    const others = (yield* rowsOf(project.id)).filter((row) => row.id !== save.id)
    if (others.some((row) => row.name === command.name)) {
      return yield* refused(`a command named ${command.name} is already in this Project`)
    }
    const id = save.id ?? crypto.randomUUID()
    const columns = {
      ...command,
      writeGlobs: JSON.stringify(command.writeGlobs),
    }
    yield* mutate('saving a command', (transaction) =>
      Effect.gen(function* () {
        if (save.id === null) {
          yield* transaction
            .insert(projectCommands)
            .values({ id, projectId: project.id, ...columns, createdAt: new Date().toISOString() })
            .pipe(Effect.mapError(refusedWhile('writing the command')))
        } else {
          const written = yield* transaction
            .update(projectCommands)
            .set(columns)
            .where(and(eq(projectCommands.id, id), eq(projectCommands.projectId, project.id)))
            .returning({ id: projectCommands.id })
            .pipe(Effect.mapError(refusedWhile('writing the command')))
          if (written.length === 0) return yield* new UnknownCommand({ id })
        }
        return {
          result: undefined,
          events: [
            commandEvent(save.id === null ? 'command.created' : 'command.updated', project.id, {
              commandId: id,
              name: command.name,
              type: command.type,
            }),
          ],
        }
      }),
    )
    return yield* getCommand(project.id, id)
  })

/** Takes a command out of the catalogue. What it already ran is kept. */
export const removeCommand = (projectId: string, id: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const command = yield* getCommand(projectId, id)
    yield* mutate('removing a command', (transaction) =>
      transaction
        .delete(projectCommands)
        .where(eq(projectCommands.id, id))
        .pipe(
          Effect.mapError(refusedWhile('removing the command')),
          Effect.as({
            result: undefined,
            events: [
              commandEvent('command.removed', projectId, { commandId: id, name: command.name }),
            ],
          }),
        ),
    )
  })

/** What saving a line would refuse, as it is typed. */
export const checkLine = (line: string): Effect.Effect<LineCheck> =>
  runnableLine(line.trim()).pipe(
    Effect.match({
      onFailure: (refusal): LineCheck => ({ problem: refusal.message }),
      onSuccess: (): LineCheck => ({ problem: null }),
    }),
  )
