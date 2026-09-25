/**
 * The Project's checks, and how a build runs them (design D10-06, D10-07).
 *
 * A check is a catalogue command or a line of the user's, run where and when the Project says,
 * judged by its exit code or by a number read in its output. Hemera runs it through the Commands
 * service in the build's Workspace — its output kept like any run's, shown in the Session's
 * activity — and never through the agent; its verdict is Hemera's.
 */

import {
  CHECK_WHEN,
  CHECK_WHERE,
  type ChangedFile,
  type CheckDraft,
  type CheckVerdict,
  type CheckWhen,
  type CheckWhere,
  type ProjectCheck,
  checkPlaces,
  checkProblem,
  evaluateExpect,
  expandFiles,
  lineFor,
  proposeChecks,
  rankBetween,
} from '@hemera/core'
import { and, asc, eq } from 'drizzle-orm'
import { Context, Data, Effect, Layer, Result } from 'effect'
import { join } from 'node:path'

import {
  Commands,
  Platform,
  type RunView,
  UnknownRunError,
  commandCwd,
} from '../commands/service.ts'
import type { NewEvent } from '../journal.ts'
import {
  Database,
  DatabaseError,
  type EngineDatabase,
  type EngineTransaction,
} from '../storage/database.ts'
import { buildCheckResults, projectChecks, projectCommands, sessions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { describedWorkspace } from '../workspaces/described.ts'
import { Variables } from '../workspaces/variables.ts'

/** What one run of the checks is asked for: an attempt, the moment, and what the work changed. */
export interface CheckRunRequest {
  /** The build Session: its runs show in its activity. */
  readonly sessionId: string
  readonly projectId: string
  /** The Workspace the build works in; null for `main`. */
  readonly workspaceId: string | null
  /** Which of the Project's checks run: after a task, after a story, or at the end. */
  readonly when: CheckWhen
  /** The attempt the results are written under. */
  readonly attemptId: string
  /**
   * What the work changed, per repository: its path relative to the Workspace root (`''` for a
   * repository at the root) and the files changed in it, relative to that repository, each with
   * Git's status letter — a deleted file is never handed to a line. What a `changed` check runs
   * in, and what `{files}` is expanded from.
   */
  readonly changes: readonly {
    readonly repository: string
    readonly files: readonly Pick<ChangedFile, 'path' | 'status'>[]
  }[]
}

/** One check as it ran, and what Hemera made of it. */
export interface CheckOutcome {
  readonly id: string
  /** The check it ran; null once the check was removed from the Project. */
  readonly checkId: string | null
  readonly name: string
  /** Where it ran: `''` for the Workspace root, or the repository's path. */
  readonly place: string
  /** The line as it ran, `{files}` expanded. */
  readonly line: string
  readonly verdict: CheckVerdict
  readonly exitCode: number | null
  readonly value: number | null
  /** Why it is red or skipped, in plain words (`64.2 < 70`); null when green. */
  readonly detail: string | null
  /** The last lines of its output. */
  readonly outputTail: string
  /** The run of the Commands service; null for a check that was skipped without running. */
  readonly runId: string | null
  readonly ranAt: string
}

/** How the build runs the Project's checks. */
export interface BuildChecksService {
  /**
   * Runs the Project's checks of `when` for one attempt, writes each result under it with its
   * Journal line, and answers them in the Project's order: empty when none is configured — a task
   * done, not verified.
   */
  readonly run: (request: CheckRunRequest) => Effect.Effect<readonly CheckOutcome[], DatabaseError>
}

export class BuildChecks extends Context.Service<BuildChecks, BuildChecksService>()(
  'BuildChecks',
) {}

/** A check was asked for by an identifier none of the Project's checks answers to. */
export class UnknownCheckError extends Data.TaggedError('UnknownCheckError')<{
  readonly id: string
}> {
  override get message(): string {
    return `no check of this Project has the identifier "${this.id}"`
  }
}

/** A check the dialog cannot save, refused with the sentence the dialog shows (D10-06). */
export class CheckRefusedError extends Data.TaggedError('CheckRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/**
 * The Project's checks as its settings keep them (D10-06): the Build section lists them, the check
 * dialog saves and removes one, and a Project that has none is proposed defaults from its
 * catalogue — proposed only, since nothing is saved until the user accepts them.
 */
export interface ProjectChecksService {
  /** The Project's checks, in their order. */
  readonly list: (projectId: string) => Effect.Effect<ProjectCheck[], DatabaseError>
  /**
   * The checks proposed from the catalogue's types while the Project has none, and nothing once
   * it has one. Never saved by being proposed.
   */
  readonly proposed: (projectId: string) => Effect.Effect<CheckDraft[], DatabaseError>
  /** Writes a check: a new one, ranked last, when `id` is null; the one `id` names otherwise. */
  readonly save: (
    projectId: string,
    draft: CheckDraft,
    id: string | null,
  ) => Effect.Effect<ProjectCheck, DatabaseError | CheckRefusedError | UnknownCheckError>
  /** Takes one check out. The results it left in builds stay, named as they ran. */
  readonly remove: (id: string) => Effect.Effect<void, DatabaseError | UnknownCheckError>
  /**
   * Saves the proposed checks the user accepted, edited or not, in their order and all at once:
   * one refused is every one refused.
   */
  readonly acceptProposed: (
    projectId: string,
    drafts: readonly CheckDraft[],
  ) => Effect.Effect<ProjectCheck[], DatabaseError | CheckRefusedError>
}

export class ProjectChecks extends Context.Service<ProjectChecks, ProjectChecksService>()(
  'ProjectChecks',
) {}

const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

/** The `where` of a row, which the table's check constraint already closed. */
function whereOf(value: string): CheckWhere {
  return CHECK_WHERE.find((one) => one === value) ?? 'root'
}

/** The `when` of a row, closed the same way. */
function whenOf(value: string): CheckWhen {
  return CHECK_WHEN.find((one) => one === value) ?? 'end'
}

function checkOf(row: typeof projectChecks.$inferSelect): ProjectCheck {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    commandId: row.commandId,
    line: row.line,
    where: whereOf(row.where),
    repository: row.repository,
    when: whenOf(row.when),
    // Both or neither, which the table holds.
    expect:
      row.expectPattern === null || row.expectMinimum === null
        ? null
        : { pattern: row.expectPattern, minimum: row.expectMinimum },
    files: row.files,
    rank: row.rank,
  }
}

/**
 * The columns a draft is written as: its name and line trimmed as `checkProblem` read them, and
 * no line at all beside a command, which the table requires.
 */
function columnsOf(draft: CheckDraft) {
  return {
    name: draft.name.trim(),
    commandId: draft.commandId,
    line: draft.commandId === null ? (draft.line?.trim() ?? '') : null,
    where: draft.where,
    repository: draft.repository,
    when: draft.when,
    expectPattern: draft.expect?.pattern ?? null,
    expectMinimum: draft.expect?.minimum ?? null,
    files: draft.files,
  }
}

/** The Journal line of a change of the Project's checks, as the catalogue's changes have theirs. */
function checkEvent(type: string, projectId: string, name: string, when: CheckWhen): NewEvent {
  return {
    type,
    entityKind: 'project',
    entityId: projectId,
    source: 'ui',
    author: 'human',
    projectId,
    payload: { name, when },
  }
}

export const projectChecksLayer = Layer.effect(
  ProjectChecks,
  Effect.gen(function* () {
    const database = yield* Database
    const commands = yield* Commands

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    const rowsOf = (reader: EngineDatabase | EngineTransaction, projectId: string) =>
      reader
        .select()
        .from(projectChecks)
        .where(eq(projectChecks.projectId, projectId))
        .orderBy(asc(projectChecks.rank))
        .pipe(Effect.mapError(failed('reading the checks')))

    /**
     * Why a draft cannot be written beside the Project's other checks, or nothing: the sentence
     * of `checkProblem`, and a command that is not in this Project's catalogue.
     */
    const refusal = (
      transaction: EngineTransaction,
      projectId: string,
      draft: CheckDraft,
      taken: readonly string[],
    ) =>
      Effect.gen(function* () {
        const problem = checkProblem(draft, taken)
        if (problem !== null) return yield* Effect.fail(new CheckRefusedError({ reason: problem }))
        if (draft.commandId === null) return
        const found = yield* transaction
          .select({ id: projectCommands.id })
          .from(projectCommands)
          .where(
            and(eq(projectCommands.id, draft.commandId), eq(projectCommands.projectId, projectId)),
          )
          .pipe(Effect.mapError(failed('reading the commands')))
        if (found.length === 0) {
          return yield* Effect.fail(
            new CheckRefusedError({ reason: 'The command chosen is no longer in the catalogue.' }),
          )
        }
      })

    /** A new check written last after `after`, the rank of the one it follows. */
    const inserted = (
      transaction: EngineTransaction,
      projectId: string,
      draft: CheckDraft,
      after: string | null,
    ) =>
      Effect.gen(function* () {
        const at = new Date().toISOString()
        const row = {
          id: crypto.randomUUID(),
          projectId,
          ...columnsOf(draft),
          rank: rankBetween(after, null),
          createdAt: at,
          updatedAt: at,
        }
        yield* transaction
          .insert(projectChecks)
          .values(row)
          .pipe(Effect.mapError(failed('writing the checks')))
        return checkOf(row)
      })

    const service: ProjectChecksService = {
      list: (projectId) =>
        rowsOf(database, projectId).pipe(Effect.map((rows) => rows.map(checkOf))),

      proposed: (projectId) =>
        Effect.gen(function* () {
          const kept = yield* database
            .select({ id: projectChecks.id })
            .from(projectChecks)
            .where(eq(projectChecks.projectId, projectId))
            .limit(1)
            .pipe(Effect.mapError(failed('reading the checks')))
          if (kept.length > 0) return []
          return proposeChecks(yield* commands.list(projectId))
        }),

      save: (projectId, draft, id) =>
        withDatabase(
          mutate('saving a check', (transaction) =>
            Effect.gen(function* () {
              const rows = yield* rowsOf(transaction, projectId)
              const existing = id === null ? undefined : rows.find((row) => row.id === id)
              if (id !== null && existing === undefined) {
                return yield* Effect.fail(new UnknownCheckError({ id }))
              }
              const others = rows.filter((row) => row.id !== id).map((row) => row.name)
              yield* refusal(transaction, projectId, draft, others)
              if (existing === undefined) {
                const check = yield* inserted(
                  transaction,
                  projectId,
                  draft,
                  rows.at(-1)?.rank ?? null,
                )
                return {
                  result: check,
                  events: [checkEvent('check.created', projectId, check.name, check.when)],
                }
              }
              const columns = { ...columnsOf(draft), updatedAt: new Date().toISOString() }
              yield* transaction
                .update(projectChecks)
                .set(columns)
                .where(eq(projectChecks.id, existing.id))
                .pipe(Effect.mapError(failed('writing the checks')))
              const check = checkOf({ ...existing, ...columns })
              return {
                result: check,
                events: [checkEvent('check.updated', projectId, check.name, check.when)],
              }
            }),
          ),
        ),

      remove: (id) =>
        withDatabase(
          mutate('removing a check', (transaction) =>
            Effect.gen(function* () {
              const removed = yield* transaction
                .delete(projectChecks)
                .where(eq(projectChecks.id, id))
                .returning()
                .pipe(Effect.mapError(failed('writing the checks')))
              const row = removed[0]
              if (row === undefined) return yield* Effect.fail(new UnknownCheckError({ id }))
              return {
                result: undefined,
                events: [checkEvent('check.removed', row.projectId, row.name, whenOf(row.when))],
              }
            }),
          ),
        ),

      acceptProposed: (projectId, drafts) =>
        withDatabase(
          mutate('accepting the proposed checks', (transaction) =>
            Effect.gen(function* () {
              const rows = yield* rowsOf(transaction, projectId)
              const taken = rows.map((row) => row.name)
              let after = rows.at(-1)?.rank ?? null
              const saved: ProjectCheck[] = []
              for (const draft of drafts) {
                yield* refusal(transaction, projectId, draft, taken)
                const check = yield* inserted(transaction, projectId, draft, after)
                taken.push(check.name)
                after = check.rank
                saved.push(check)
              }
              return {
                result: saved,
                events: saved.map((check) =>
                  checkEvent('check.created', projectId, check.name, check.when),
                ),
              }
            }),
          ),
        ),
    }
    return service
  }),
)

/**
 * How long one wait on a check's run lasts before it is asked again. Not a limit: a check is
 * waited for until it ends, however long a test suite takes; the wait is only cut in pieces.
 */
const WAIT_MS = 60_000

/** How many of the last lines of a check's output its result keeps: what the agent is shown. */
const TAIL_LINES = 60

/** And at most this many characters of them, a line being as long as a program cares to print. */
const TAIL_CHARACTERS = 8 * 1024

/** The last lines of an output, bounded; its whole stays on the run (L12). */
function tailOf(output: string): string {
  const lines = output.replace(/\n$/, '').split('\n').slice(-TAIL_LINES).join('\n')
  return lines.length > TAIL_CHARACTERS ? lines.slice(-TAIL_CHARACTERS) : lines
}

/**
 * A repository's path as a place: `''` for the Workspace root, and no leading `./`, so the
 * Project's `./sources/api` and a change's `sources/api` are one place.
 */
function placeOf(path: string): string {
  const bare = path.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
  return bare === '.' ? '' : bare
}

/**
 * The files the work changed, relative to the folder a line runs in (D10-06): what `{files}` is
 * expanded with and what the filter matches. A file outside that folder is not one of its own.
 */
function filesUnder(folder: string, changes: CheckRunRequest['changes']) {
  return changes.flatMap((change) => {
    const repository = placeOf(change.repository)
    return change.files.flatMap((file) => {
      const path = repository === '' ? file.path : `${repository}/${file.path}`
      if (folder === '') return [{ path, status: file.status }]
      return path.startsWith(`${folder}/`)
        ? [{ path: path.slice(folder.length + 1), status: file.status }]
        : []
    })
  })
}

/**
 * Why a run that has no exit code is red, in the words of what happened: stopped before it
 * ended, or the first line of what the run says of itself — it could not be started.
 */
function unfinished(run: RunView): string {
  if (run.state === 'stopped') return 'stopped before it ended'
  return run.output.split('\n')[0] || run.state
}

/** One check's result before it is written: everything but its identifier and its time. */
type Judged = Omit<CheckOutcome, 'id' | 'ranAt'>

/** The result of a check that did not run: skipped, or refused before it started. */
function unrun(
  check: ProjectCheck,
  place: string,
  line: string,
  verdict: 'red' | 'skipped',
  detail: string,
): Judged {
  return {
    checkId: check.id,
    name: check.name,
    place,
    line,
    verdict,
    exitCode: null,
    value: null,
    detail,
    outputTail: '',
    runId: null,
  }
}

/**
 * The Project's checks run for a build (D10-06, D10-07).
 *
 * The checks of the moment asked, in the Project's order, each in every place it runs in:
 * the Workspace root, its one repository, or each repository the work changed. A catalogue
 * command at the root runs where the catalogue puts it — its own base and folder under the
 * Workspace — and anything else runs in its place under the Workspace (L5). Each is a run of the
 * Commands service started by the user for the build Session (L12), so it shows in the Session's
 * activity like any run and keeps its whole output there; it is waited for until it ends, judged
 * by its exit code and the number its expected result reads (L4), and its result is written under
 * the attempt with its `check.ran` Journal line, one transaction per result. The runs themselves
 * are never inside a transaction.
 */
export const buildChecksLayer = Layer.effect(
  BuildChecks,
  Effect.gen(function* () {
    const database = yield* Database
    const commands = yield* Commands
    const variables = yield* Variables
    const checks = yield* ProjectChecks
    const platform = yield* Platform

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** A run of the Commands service, waited for until it ends, and stopped if the wait is cut. */
    const ended = (sessionId: string, started: RunView) =>
      Effect.gen(function* () {
        let run = started
        while (run.state === 'running') {
          run = yield* commands.awaited(sessionId, started.id, WAIT_MS)
        }
        return run
      }).pipe(
        // Started for this check and waited for by it: a build that stops waiting leaves nobody
        // to judge it, and it is stopped rather than left behind.
        Effect.onInterrupt(() => commands.stop(sessionId, started.id).pipe(Effect.ignore)),
      )

    const service: BuildChecksService = {
      run: (request) =>
        Effect.gen(function* () {
          const due = (yield* checks.list(request.projectId)).filter(
            (check) => check.when === request.when,
          )
          if (due.length === 0) return []
          const workspace = yield* describedWorkspace(
            database,
            request.projectId,
            request.workspaceId,
          )
          const environment = yield* variables.givenFor(request.projectId, workspace.id)
          const catalogue = yield* commands.list(request.projectId)
          const [build] = yield* database
            .select({ specId: sessions.specId, revisionId: sessions.revisionId })
            .from(sessions)
            .where(eq(sessions.id, request.sessionId))
            .pipe(Effect.mapError(failed('reading the build Session')))
          const changed = request.changes
            .filter((change) => change.files.length > 0)
            .map((change) => placeOf(change.repository))

          /** Writes one result and its Journal line, in one transaction (D10-14). */
          const recorded = (judged: Judged) =>
            withDatabase(
              mutate('recording a check', (transaction) =>
                Effect.gen(function* () {
                  const outcome: CheckOutcome = {
                    id: crypto.randomUUID(),
                    ...judged,
                    ranAt: new Date().toISOString(),
                  }
                  yield* transaction
                    .insert(buildCheckResults)
                    .values({ ...outcome, attemptId: request.attemptId })
                    .pipe(Effect.mapError(failed('writing a check result')))
                  return {
                    result: outcome,
                    events: [
                      {
                        type: 'check.ran',
                        entityKind: 'session' as const,
                        entityId: request.sessionId,
                        source: 'system' as const,
                        author: 'hemera' as const,
                        projectId: request.projectId,
                        sessionId: request.sessionId,
                        specId: build?.specId ?? null,
                        revisionId: build?.revisionId ?? null,
                        payload: {
                          checkId: outcome.checkId,
                          name: outcome.name,
                          place: outcome.place,
                          verdict: outcome.verdict,
                          detail: outcome.detail,
                        },
                      },
                    ],
                  }
                }),
              ),
            )

          /** One check in one place: skipped, refused its folder, or run and judged. */
          const judged = (check: ProjectCheck, place: string) =>
            Effect.gen(function* () {
              const command =
                check.commandId === null
                  ? null
                  : (catalogue.find((one) => one.id === check.commandId) ?? null)
              // Where it runs (L5): a catalogue command at the root in its own folder, anything
              // else in its place, under the Workspace.
              const where =
                command !== null && check.where === 'root'
                  ? yield* commandCwd(workspace.path, command).pipe(Effect.result)
                  : Result.succeed({
                      folder: place === '' ? null : `./${place}`,
                      cwd: join(workspace.path, place),
                    })
              const line = command === null ? (check.line ?? '') : lineFor(command, platform)
              if (Result.isFailure(where)) {
                return unrun(check, place, line, 'red', where.failure.message)
              }
              const { folder, cwd } = where.success
              const expanded = expandFiles(
                line,
                filesUnder(placeOf(folder ?? ''), request.changes),
                check.files,
              )
              if (expanded === null) {
                const detail =
                  check.files === null
                    ? 'no file changed here'
                    : `no changed file matched ${check.files}`
                return unrun(check, place, line, 'skipped', detail)
              }
              const started = yield* commands.run({
                sessionId: request.sessionId,
                projectId: request.projectId,
                commandId: command?.id ?? null,
                name: check.name,
                line: expanded,
                lineWindows: null,
                lineLinux: null,
                type: command?.type ?? 'test',
                scope: 'workspace',
                portless: false,
                portlessName: null,
                folder,
                cwd,
                workspaceId: workspace.id,
                workspaceName: workspace.name,
                environment,
                // Hemera runs it, on the user's behalf, never through the agent (L12).
                startedBy: 'user',
              })
              const run = yield* ended(request.sessionId, started)
              const judgement = evaluateExpect(run.output, run.exitCode, check.expect)
              return {
                checkId: check.id,
                name: check.name,
                place,
                line: run.line,
                verdict: judgement.verdict,
                exitCode: run.exitCode,
                value: judgement.value,
                detail: run.exitCode === null ? unfinished(run) : judgement.detail,
                outputTail: tailOf(run.output),
                runId: run.id,
              } satisfies Judged
            }).pipe(
              // The run it started is gone from memory and from its row: said as what happened.
              Effect.catchIf(
                (lost): lost is UnknownRunError => lost instanceof UnknownRunError,
                (lost) =>
                  Effect.succeed(unrun(check, place, check.line ?? '', 'red', lost.message)),
              ),
            )

          const outcomes: CheckOutcome[] = []
          for (const check of due) {
            const places = checkPlaces(
              {
                where: check.where,
                repository: check.repository === null ? null : placeOf(check.repository),
              },
              changed,
            )
            for (const place of places) {
              outcomes.push(yield* recorded(yield* judged(check, place)))
            }
          }
          return outcomes
        }),
    }
    return service
  }),
)
