/**
 * The preparation of a Workspace: a durable list of steps, run one after the other, resumed
 * after a re-check (design D8-05, D8-16, D8-17).
 *
 * The steps were written when the Workspace was created — its worktrees in the repositories'
 * order, then the Project's recipe in its order — and each one's state is written as it changes,
 * outside any transaction that would hold Git, the disk or a process. The first failure stops the
 * list and keeps everything done before it: the Workspace is `failed`, the step says why in the
 * words of whatever refused it, and the steps after it wait. Nothing creates a Session.
 *
 * A resume re-checks every `done` step against the disk — a worktree with its `.git`, a copied
 * file, a link — turns a missing one back to `pending`, retries the failed one and carries on. A
 * `run` that is done is not run again: what a command did is not something the disk can be
 * asked about.
 *
 * A copy or a link is one file or folder under its base — a repository, or the Workspace root
 * (D8-05 as amended by recette 1). A folder is copied whole and never over what is there: a file
 * already in the Workspace is kept, the others are copied. A folder is linked as a junction on
 * Windows and a symbolic link elsewhere; a file is a symbolic link.
 *
 * A `run` step starts its catalogue command as a real run of the Commands service, with no
 * Session (Decided 11), in the Workspace, and waits for its end: its line, its folder, its
 * variables, its output and its exit code are the run's row, and the step keeps the run's
 * identifier and how it ended (D8-05, D8-06).
 */

import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import {
  MAIN_WORKSPACE,
  type WorkspaceState,
  type WorkspaceStep,
  commandScope,
  commandType,
  nextPending,
  resumedSteps,
  workspaceStateOf,
} from '@hemera/core'
import { and, asc, eq } from 'drizzle-orm'
import { Context, Data, Effect, Layer, Result } from 'effect'

import { AgentNotices } from '../agents/notices.ts'
import { StderrSink } from '../agents/supervisor.ts'
import { Commands, type RunView, UnknownRunError, commandCwd } from '../commands/service.ts'
import { Git } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { Database, DatabaseError } from '../storage/database.ts'
import {
  projectCommands,
  workspaceRepositories,
  workspaceSteps,
  workspaces,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { Launches } from './launches.ts'
import { Variables } from './variables.ts'
import { UnknownWorkspaceError } from './described.ts'
import {
  type WorkspaceView,
  Workspaces,
  labelOf,
  stepOf,
  workspaceEvent,
  workspaceStateIn,
} from './workspaces.ts'

/** The system refused a link, in its own words (D8-05). */
export class LinkRefusedError extends Data.TaggedError('LinkRefusedError')<{
  readonly message: string
}> {}

export interface LinksService {
  /** Makes `path` a link to `target`: a folder, or a file. */
  readonly link: (
    target: string,
    path: string,
    kind: 'file' | 'directory',
  ) => Effect.Effect<void, LinkRefusedError>
}

/** The port a link is made through, and through which a suite has the system refuse one. */
export class Links extends Context.Service<Links, LinksService>()('Links') {}

/**
 * The machine's links: a symbolic link, and a junction for a folder on Windows, which needs no
 * privilege where a symbolic link does (D8-17).
 */
export const hostLinks = Layer.succeed(Links, {
  link: (target, path, kind) =>
    Effect.try({
      try: () =>
        symlinkSync(
          target,
          path,
          kind === 'file' ? 'file' : process.platform === 'win32' ? 'junction' : 'dir',
        ),
      catch: (cause) =>
        new LinkRefusedError({ message: cause instanceof Error ? cause.message : String(cause) }),
    }),
})

/** A preparation of this Workspace is already running: a second one is refused, not interleaved. */
export class PreparationRunningError extends Data.TaggedError('PreparationRunningError')<{
  readonly workspaceId: string
}> {
  override get message(): string {
    return 'this Workspace is already being prepared'
  }
}

export interface PreparationService {
  /** Runs the pending steps in order, and stops at the first failure. */
  readonly prepare: (
    workspaceId: string,
  ) => Effect.Effect<WorkspaceView, DatabaseError | UnknownWorkspaceError | PreparationRunningError>
  /** Re-checks what was done against the disk, retries what failed, and carries on (D8-05). */
  readonly resume: (
    workspaceId: string,
  ) => Effect.Effect<WorkspaceView, DatabaseError | UnknownWorkspaceError | PreparationRunningError>
  /**
   * Starts `prepare`, or `resume` when `resume` is true, in the engine's scope and answers at
   * once with the steps as they stand: a preparation can take minutes, and the window follows it
   * through the `workspace` event rather than waiting on a request. One already running is still
   * refused, here, by name.
   */
  readonly begin: (
    workspaceId: string,
    resume: boolean,
  ) => Effect.Effect<
    WorkspaceStep[],
    DatabaseError | UnknownWorkspaceError | PreparationRunningError
  >
  /**
   * Turns every step an engine that stopped left `running` back to `pending` (D8-05): called
   * once at the start of the engine, before anything is prepared, so none of them is this
   * engine's. A resume runs them again.
   */
  readonly recover: () => Effect.Effect<void, DatabaseError>
  /** The steps of a Workspace, in their order. */
  readonly steps: (
    workspaceId: string,
  ) => Effect.Effect<WorkspaceStep[], DatabaseError | UnknownWorkspaceError>
}

export class Preparation extends Context.Service<Preparation, PreparationService>()(
  'Preparation',
) {}

/** How a step ended, and the run a `run` step started (Decided 11). */
interface Outcome {
  readonly state: 'done' | 'skipped' | 'failed'
  readonly message: string | null
  readonly runId?: string
}

/**
 * How a step's run ended, in the words its step keeps: `exit <code>`, or for a run that has no
 * code — it could not start, or was stopped — the first line of what the run says of itself.
 * What it printed stays on the run (Decided 11).
 */
function endOf(run: RunView): string {
  if (run.exitCode !== null) return `exit ${String(run.exitCode)}`
  return run.output.split('\n')[0] || run.state
}

/** Where a step of a Workspace reads from and writes to. */
interface Place {
  readonly workspace: typeof workspaces.$inferSelect
  /** The folder of `main`, which every copy, link and worktree is made from. */
  readonly main: string
  readonly worktrees: readonly (typeof workspaceRepositories.$inferSelect)[]
}

/** One file a copy or a link is about: where it is read in `main`, where it goes. */
interface Destination {
  readonly label: string
  readonly from: string
  readonly to: string
}

/**
 * Where a copy or a link applies: its path under its base, a repository or the Workspace root, at
 * the same relative place as in `main` (D8-05 as amended by recette 1).
 */
function destinationOf(place: Place, step: WorkspaceStep): Destination {
  const base = step.base ?? ''
  return {
    label:
      step.base === null ? labelOf(step.target) : `${labelOf(step.base)}/${labelOf(step.target)}`,
    from: join(place.main, base, step.target),
    to: join(place.workspace.path, base, step.target),
  }
}

/** Whether something is at a path, a link that points nowhere included. */
function occupied(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined
}

/**
 * Copies a file or a whole folder, never over anything already there (D8-05 as amended by
 * recette 1): a file present at the destination is kept as it is, and what is missing is copied.
 * Answers how many files it copied; a refusal of the system is thrown as the system said it.
 */
function copiedInto(from: string, to: string): number {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true })
    let copied = 0
    for (const name of readdirSync(from)) copied += copiedInto(join(from, name), join(to, name))
    return copied
  }
  if (occupied(to)) return 0
  mkdirSync(dirname(to), { recursive: true })
  // Exclusive all the same: a file that appeared since is kept, never overwritten.
  copyFileSync(from, to, constants.COPYFILE_EXCL)
  return 1
}

/** A message of the system, as it said it. */
function said(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** What happened at one destination: made, kept as it was, no source, or refused. */
type Placed = 'made' | 'kept' | 'missing' | { readonly refused: string }

/** What a destination says in the step's message, and nothing when it was simply made. */
function wordsOf(label: string, result: Placed): string | null {
  if (result === 'made') return null
  if (result === 'kept') return `${label}: kept as it was`
  if (result === 'missing') return `${label}: no source`
  return `${label}: ${result.refused}`
}

/**
 * A copy or a link, over all its destinations: `failed` when one was refused, `done` when at
 * least one was made or already there, `skipped` when no source was; the message lists every
 * destination that was not simply made (D8-05).
 */
function outcomeOf(placed: readonly { label: string; result: Placed }[]): Outcome {
  const words = placed.flatMap((one) => wordsOf(one.label, one.result) ?? [])
  const message = words.length === 0 ? null : words.join('; ')
  const results = placed.map((one) => one.result)
  if (results.some((result) => result !== 'made' && result !== 'kept' && result !== 'missing')) {
    return { state: 'failed', message }
  }
  if (results.some((result) => result === 'made' || result === 'kept')) {
    return { state: 'done', message }
  }
  return { state: 'skipped', message }
}

/** How much of a failure's first line a Journal line keeps. */
const HEADLINE_CHARACTERS = 200

/**
 * What the Journal says of a failed step: the first line of its message, bounded (D8-16). The
 * whole message — a command's output, which may hold anything it printed, a secret included —
 * stays on the step, where it is read.
 */
function headline(message: string | null): string | null {
  if (message === null) return null
  return (message.split('\n')[0] ?? '').slice(0, HEADLINE_CHARACTERS)
}

/** The steps with one of them replaced, every other kept as the very same object. */
function replaced(steps: readonly WorkspaceStep[], changed: WorkspaceStep): WorkspaceStep[] {
  return steps.map((step) => (step.id === changed.id ? changed : step))
}

/**
 * What the engine does once at its start, the database open and nothing yet running: the runs an
 * engine that stopped left `running` are ended, then its steps left `running` wait for a resume
 * (D8-05, D6-12), and the launches it left part-way are ended or started (D8-13).
 */
export const recovered = Effect.gen(function* () {
  yield* (yield* Commands).recover()
  yield* (yield* Preparation).recover()
  yield* (yield* Launches).recover()
})

export const preparationLayer = Layer.effect(
  Preparation,
  Effect.gen(function* () {
    const database = yield* Database
    const git = yield* Git
    const links = yield* Links
    const variables = yield* Variables
    const workspacesService = yield* Workspaces
    const launches = yield* Launches
    const commands = yield* Commands
    /** The engine's diagnostic log: where a preparation begun in the background says it failed. */
    const diagnostic = yield* StderrSink
    /** The engine's own scope: a preparation begun in the background ends when the engine does. */
    const scope = yield* Effect.scope
    /** The window, told of every step written and of the end of a preparation (D8-05). */
    const notices = yield* AgentNotices
    const told = (workspace: typeof workspaces.$inferSelect) =>
      Effect.sync(() => notices.workspace(workspace.projectId, workspace.id))

    const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

    /**
     * One preparation of a Workspace at a time: a second `prepare` or `resume` while one runs is
     * refused by name. Held by the Workspaces, before anything is read and in memory, which is
     * enough: one engine holds a data folder. So a step a resume finds `running` is always one an
     * engine that stopped left behind, never one being run now — which is what lets
     * `resumedSteps` start it again (D8-05) — and a Workspace held is what its view calls `live`.
     */
    const taken = (id: string) =>
      workspacesService
        .hold(id)
        .pipe(
          Effect.flatMap((free) =>
            free ? Effect.void : Effect.fail(new PreparationRunningError({ workspaceId: id })),
          ),
        )
    /**
     * Lets go of a Workspace, and tells the window once it is no longer live: however the
     * preparation ended — done, failed, interrupted — the page reads a Workspace it can resume
     * (D8-05).
     */
    const released = (row: typeof workspaces.$inferSelect) =>
      workspacesService.release(row.id).pipe(Effect.andThen(told(row)))

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    const workspaceRow = (id: string) =>
      database
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, id))
        .pipe(
          Effect.mapError(failed('reading the Workspace')),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.fail(new UnknownWorkspaceError(id))
              : Effect.succeed(rows[0]),
          ),
        )

    const stepsOf = (id: string) =>
      database
        .select()
        .from(workspaceSteps)
        .where(eq(workspaceSteps.workspaceId, id))
        .orderBy(asc(workspaceSteps.position))
        .pipe(
          Effect.mapError(failed('reading the steps')),
          Effect.map((rows) => rows.map(stepOf)),
        )

    const placeOf = (workspace: typeof workspaces.$inferSelect) =>
      Effect.gen(function* () {
        const mains = yield* database
          .select({ path: workspaces.path })
          .from(workspaces)
          .where(
            and(eq(workspaces.projectId, workspace.projectId), eq(workspaces.name, MAIN_WORKSPACE)),
          )
          .pipe(Effect.mapError(failed('reading the Workspaces')))
        const worktrees = yield* database
          .select()
          .from(workspaceRepositories)
          .where(eq(workspaceRepositories.workspaceId, workspace.id))
          .pipe(Effect.mapError(failed('reading the worktrees')))
        return { workspace, main: mains[0]?.path ?? '', worktrees } satisfies Place
      })

    /**
     * A worktree of `main`'s repository at the same relative place in the Workspace (D8-04).
     *
     * Git makes the folder itself; its parents are made first. A worktree a resume makes again
     * after its folder was removed by hand is one Git still holds as registered, on a branch
     * this step already made: that registration is pruned (D8-03 as amended by Decided 15) and
     * the branch checked out again, rather than refused as a branch that already exists (D8-04
     * and D8-05 as amended by Decided 14).
     */
    const worktree = (place: Place, step: WorkspaceStep, again: boolean) =>
      Effect.gen(function* () {
        const record = place.worktrees.find((one) => one.relativePath === step.target)
        if (record === undefined) {
          return { state: 'failed', message: `${step.target} has no worktree to make` } as const
        }
        const repository = join(place.main, record.relativePath)
        const path = join(place.workspace.path, record.relativePath)
        const parents = yield* Effect.try({
          try: () => mkdirSync(dirname(path), { recursive: true }),
          catch: said,
        }).pipe(
          Effect.as(null),
          Effect.catch((refused) => Effect.succeed(refused)),
        )
        if (parents !== null) return { state: 'failed', message: parents } as const
        const attach =
          again &&
          (yield* git
            .branchExists(repository, record.branch)
            .pipe(Effect.orElseSucceed(() => false)))
        const made = attach
          ? git
              .worktreePrune(repository)
              .pipe(Effect.andThen(git.worktreeAttach(repository, record.branch, path)))
          : git.worktreeAdd(repository, record.branch, path, record.base)
        return yield* made.pipe(
          Effect.as<Outcome>({ state: 'done', message: null }),
          // Git's own words: a branch that exists, a folder in the way (D8-05).
          Effect.catch((refused) =>
            Effect.succeed<Outcome>({ state: 'failed', message: refused.message }),
          ),
        )
      })

    /**
     * A file or a folder of `main` copied under its base, never over what is there (D8-05 as
     * amended by recette 1): `made` when anything was copied, `kept` when all of it was there.
     */
    const copy = (place: Place, step: WorkspaceStep): Outcome => {
      const destination = destinationOf(place, step)
      const result = ((): Placed => {
        if (!existsSync(destination.from)) return 'missing'
        try {
          return copiedInto(destination.from, destination.to) > 0 ? 'made' : 'kept'
        } catch (cause) {
          return { refused: said(cause) }
        }
      })()
      return outcomeOf([{ label: destination.label, result }])
    }

    /** A link to a file or a folder of `main` under its base (D8-05, D8-17). */
    const link = (place: Place, step: WorkspaceStep) =>
      Effect.gen(function* () {
        const destination = destinationOf(place, step)
        if (!existsSync(destination.from)) {
          return outcomeOf([{ label: destination.label, result: 'missing' }])
        }
        if (occupied(destination.to)) {
          return outcomeOf([{ label: destination.label, result: 'kept' }])
        }
        const kind = statSync(destination.from).isDirectory() ? 'directory' : 'file'
        const result = yield* Effect.try({
          try: () => mkdirSync(dirname(destination.to), { recursive: true }),
          catch: (cause) => new LinkRefusedError({ message: said(cause) }),
        }).pipe(
          Effect.andThen(links.link(destination.from, destination.to, kind)),
          Effect.as<Placed>('made'),
          Effect.catch((refused) => Effect.succeed<Placed>({ refused: refused.message })),
        )
        return outcomeOf([{ label: destination.label, result }])
      })

    /**
     * A command of the catalogue, or the line the step carries itself (recette 2), run in the
     * Workspace until it ends (D8-05).
     *
     * A real run with no Session (Decided 11): the Commands service runs the machine's line of
     * the command — or the step's own line, on the machine it was prepared for — in its folder
     * under the Workspace, with the variables Hemera gives there
     * (D8-06, D8-07), and keeps its output and exit code on its row. The step writes the run's
     * identifier as soon as it has one, so the step running points at the run printing, then
     * waits for it however long it takes: a step waits for its command.
     */
    const run = (place: Place, step: WorkspaceStep) =>
      Effect.gen(function* () {
        const rows =
          step.commandId === null
            ? []
            : yield* database
                .select()
                .from(projectCommands)
                .where(eq(projectCommands.id, step.commandId))
                .pipe(Effect.mapError(failed('reading the commands')))
        const command = rows[0]
        if (step.commandId !== null && command === undefined) {
          return {
            state: 'failed',
            message: `the command ${step.target} is no longer in the catalogue`,
          } satisfies Outcome
        }
        // What it runs: a command of the catalogue, or the line the step carries itself (recette 2)
        // — which is not in the catalogue and that no agent reads. A line of its own is named after
        // its first word, as an ad-hoc line run by an agent is, and is a script.
        const runs =
          command === undefined
            ? {
                commandId: null,
                name: step.target.split(/\s+/)[0] ?? 'command',
                line: step.target,
                lineWindows: null,
                lineLinux: null,
                type: 'script' as const,
                scope: 'workspace' as const,
                portless: false,
                portlessName: null,
                folderBase: step.base,
                folder: step.path,
              }
            : {
                commandId: command.id,
                name: command.name,
                line: command.line,
                lineWindows: command.lineWindows,
                lineLinux: command.lineLinux,
                type: commandType(command.type),
                scope: commandScope(command.scope),
                portless: command.portless === 1,
                portlessName: command.portlessName,
                folderBase: command.folderBase,
                folder: command.folder,
              }
        const { projectId, id: workspaceId } = place.workspace
        // Its folder under its base, under this Workspace (D8-07 as amended by recette 1); one
        // that climbs out fails the step, naming it, and nothing runs.
        const where = yield* commandCwd(place.workspace.path, runs).pipe(Effect.result)
        if (Result.isFailure(where)) {
          return { state: 'failed', message: where.failure.message } satisfies Outcome
        }
        const { folder, cwd } = where.success
        const started = yield* commands.run({
          sessionId: null,
          projectId,
          commandId: runs.commandId,
          name: runs.name,
          line: runs.line,
          lineWindows: runs.lineWindows,
          lineLinux: runs.lineLinux,
          type: runs.type,
          scope: runs.scope,
          portless: runs.portless,
          portlessName: runs.portlessName,
          folder,
          cwd,
          workspaceId,
          workspaceName: place.workspace.name,
          environment: yield* variables.givenFor(projectId, workspaceId),
          // The row's word, which knows only the agent and the user; a run with no Session is
          // journalled as Hemera's own, as the step itself is (D8-16).
          startedBy: 'user',
        })
        yield* withDatabase(
          mutate('writing a step', (transaction) =>
            transaction
              .update(workspaceSteps)
              .set({ runId: started.id })
              .where(eq(workspaceSteps.id, step.id))
              .pipe(
                Effect.mapError(failed('writing a step')),
                Effect.as({ result: undefined, events: [] }),
              ),
          ),
        )
        const ended = yield* commands.awaited(null, started.id, Number.POSITIVE_INFINITY)
        return {
          state: ended.state === 'exited' ? 'done' : 'failed',
          message: endOf(ended),
          runId: started.id,
        } satisfies Outcome
      }).pipe(
        // The run it started is gone from memory and from its row: nothing the step can say.
        Effect.catchIf(
          (refused): refused is UnknownRunError => refused instanceof UnknownRunError,
          (lost) => Effect.succeed<Outcome>({ state: 'failed', message: lost.message }),
        ),
      )

    const outcome = (place: Place, step: WorkspaceStep, again: boolean) => {
      switch (step.kind) {
        case 'worktree':
          return worktree(place, step, again)
        case 'copy':
          return Effect.sync(() => copy(place, step))
        case 'link':
          return link(place, step)
        case 'run':
          return run(place, step)
      }
    }

    /**
     * Writes the steps that changed and the state of the Workspace they make, with their events,
     * in one transaction; and `workspace.ready` the moment it becomes ready (D8-16).
     *
     * The state is read again inside the transaction: a Workspace cleaned up meanwhile stays
     * `cleaned`, nothing of the preparation is written over it, and the preparation stops.
     */
    const persist = (
      place: Place,
      stored: WorkspaceState,
      before: readonly WorkspaceStep[],
      after: readonly WorkspaceStep[],
      events: readonly NewEvent[],
    ) =>
      withDatabase(
        mutate('writing the preparation', (transaction) =>
          Effect.gen(function* () {
            const current = yield* transaction
              .select({ state: workspaces.state })
              .from(workspaces)
              .where(eq(workspaces.id, place.workspace.id))
              .pipe(Effect.mapError(failed('reading the Workspace')))
            if (current[0]?.state === 'cleaned') {
              const cleaned: WorkspaceState = 'cleaned'
              return { result: cleaned, events: [] }
            }
            for (const [index, step] of after.entries()) {
              if (step === before[index]) continue
              yield* transaction
                .update(workspaceSteps)
                .set({ state: step.state, message: step.message, runId: step.runId })
                .where(eq(workspaceSteps.id, step.id))
                .pipe(Effect.mapError(failed('writing a step')))
            }
            const state = workspaceStateOf(after)
            if (state !== stored) {
              yield* transaction
                .update(workspaces)
                .set({ state })
                .where(eq(workspaces.id, place.workspace.id))
                .pipe(Effect.mapError(failed('writing the Workspace')))
            }
            const ready =
              state === 'ready' && stored !== 'ready'
                ? [workspaceEvent(place.workspace, 'workspace.ready', {}, 'hemera')]
                : []
            return { result: state, events: [...events, ...ready] }
          }),
        ),
      ).pipe(
        Effect.tap(() => told(place.workspace)),
        // A Workspace that has just become ready is what a launch was waiting for: the build
        // starts from there (D8-13 of #20). Nobody waits on it — the launch says on itself what
        // refused it — so it is forked, and this one failure goes to the diagnostic.
        Effect.tap((state) =>
          state === 'ready' && stored !== 'ready'
            ? Effect.forkIn(scope)(
                launches
                  .workspaceReady(place.workspace.id)
                  .pipe(
                    Effect.catch((refused) =>
                      diagnostic.write(
                        `starting what waited on the Workspace ${place.workspace.id} failed: ${refused.message}`,
                      ),
                    ),
                  ),
              )
            : Effect.void,
        ),
      )

    /**
     * Runs the pending steps in order until none is left or one fails. `again` names the steps
     * a resume turned back from `done`, whose result was gone from the disk.
     *
     * A step that failed, or one still `running` — an engine that stopped in the middle of it —
     * is a preparation that only a resume carries on: nothing after it runs before then.
     */
    const drive = (id: string, again: ReadonlySet<string>) =>
      Effect.gen(function* () {
        const place = yield* placeOf(yield* workspaceRow(id))
        let steps = yield* stepsOf(id)
        let stored = workspaceStateIn(place.workspace.state)
        const advance = (after: WorkspaceStep[], events: readonly NewEvent[]) =>
          persist(place, stored, steps, after, events).pipe(
            Effect.tap((state) =>
              Effect.sync(() => {
                steps = after
                stored = state
              }),
            ),
          )
        for (;;) {
          if (stored === 'cleaned') break
          if (steps.some((step) => step.state === 'failed' || step.state === 'running')) break
          const next = nextPending(steps)
          if (next === null) break
          yield* advance(replaced(steps, { ...next, state: 'running' }), [])
          const ended = yield* outcome(place, next, again.has(next.id))
          yield* advance(replaced(steps, { ...next, ...ended }), [
            workspaceEvent(
              place.workspace,
              `workspace.step_${ended.state}`,
              {
                kind: next.kind,
                target: next.target,
                state: ended.state,
                message: ended.state === 'failed' ? headline(ended.message) : null,
              },
              'hemera',
            ),
          ])
        }
        // A Workspace whose steps were all skipped from its creation is ready without running
        // any: its state is what its steps say.
        if (stored !== 'cleaned' && workspaceStateOf(steps) !== stored) yield* advance(steps, [])
      })

    /** Whether what a `done` step made is still on the disk (D8-05). */
    const present = (place: Place, step: WorkspaceStep) => {
      switch (step.kind) {
        case 'worktree':
          return existsSync(join(place.workspace.path, step.target, '.git'))
        case 'copy':
        case 'link': {
          const destination = destinationOf(place, step)
          return !existsSync(destination.from) || occupied(destination.to)
        }
        case 'run':
          return true
      }
    }

    /** Re-checks what was done against the disk, then carries on (D8-05). */
    const resuming = (id: string) =>
      Effect.gen(function* () {
        const place = yield* placeOf(yield* workspaceRow(id))
        const steps = yield* stepsOf(id)
        const resumed = resumedSteps(steps, (step) => present(place, step))
        const again = new Set(
          resumed
            .filter((step, index) => step.state === 'pending' && steps[index]?.state === 'done')
            .map((step) => step.id),
        )
        const retried = resumed.filter(
          (step, index) => step.state === 'pending' && steps[index]?.state !== step.state,
        ).length
        yield* persist(place, workspaceStateIn(place.workspace.state), steps, resumed, [
          workspaceEvent(
            place.workspace,
            'workspace.resumed',
            { redone: again.size, retried: retried - again.size },
            'human',
          ),
        ])
        return yield* drive(id, again)
      })

    const steps = (id: string) => workspaceRow(id).pipe(Effect.andThen(stepsOf(id)))

    /** A preparation of a Workspace run here, alone, and the Workspace let go of once it ends. */
    const alone = <A, E>(id: string, effect: Effect.Effect<A, E>) =>
      workspaceRow(id).pipe(
        Effect.flatMap((row) =>
          taken(id).pipe(Effect.andThen(effect.pipe(Effect.ensuring(released(row))))),
        ),
      )

    return {
      // The Workspace is read once let go of, so what answers says it is no longer live.
      prepare: (id) =>
        alone(id, drive(id, new Set())).pipe(Effect.andThen(workspacesService.one(id))),

      resume: (id) => alone(id, resuming(id)).pipe(Effect.andThen(workspacesService.one(id))),

      begin: (id, resume) =>
        Effect.gen(function* () {
          const row = yield* workspaceRow(id)
          const before = yield* stepsOf(id)
          yield* taken(id)
          yield* Effect.forkIn(scope)(
            (resume ? resuming(id) : drive(id, new Set())).pipe(
              // Nobody is waiting on it: a failure of the storage goes to the diagnostic, and the
              // steps say how far it got.
              Effect.catch((refused) =>
                diagnostic.write(`preparing the Workspace ${id} failed: ${refused.message}`),
              ),
              Effect.ensuring(released(row)),
            ),
          )
          return before
        }),

      recover: () =>
        withDatabase(
          mutate('recovering the preparations', (transaction) =>
            transaction
              .update(workspaceSteps)
              .set({ state: 'pending' })
              .where(eq(workspaceSteps.state, 'running'))
              .pipe(
                Effect.mapError(failed('writing the steps')),
                Effect.as({ result: undefined, events: [] }),
              ),
          ),
        ),

      steps,
    } satisfies PreparationService
  }),
)
