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
import { Context, Data, Effect, Layer } from 'effect'

import { AgentNotices } from '../agents/notices.ts'
import { StderrSink } from '../agents/supervisor.ts'
import { Commands, type RunView, UnknownRunError } from '../commands/service.ts'
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
 * Where a copy or a link applies: once at the root, or in each worktree of the Workspace, at
 * the same relative place as in `main` (D8-05).
 */
function destinationsOf(place: Place, step: WorkspaceStep): Destination[] {
  if (step.scope !== 'repositories') {
    return [
      {
        label: labelOf(step.target),
        from: join(place.main, step.target),
        to: join(place.workspace.path, step.target),
      },
    ]
  }
  return place.worktrees.map((worktree) => ({
    label: labelOf(worktree.relativePath),
    from: join(place.main, worktree.relativePath, step.target),
    to: join(place.workspace.path, worktree.relativePath, step.target),
  }))
}

/** Whether something is at a path, a link that points nowhere included. */
function occupied(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined
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

export const preparationLayer = Layer.effect(
  Preparation,
  Effect.gen(function* () {
    const database = yield* Database
    const git = yield* Git
    const links = yield* Links
    const variables = yield* Variables
    const workspacesService = yield* Workspaces
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

    /** The Workspaces a preparation or a resume is running on, in this engine. */
    const running = new Set<string>()

    /**
     * One preparation of a Workspace at a time: a second `prepare` or `resume` while one runs is
     * refused by name. Taken before anything is read, and in memory, which is enough: one engine
     * holds a data folder. So a step a resume finds `running` is always one an engine that
     * stopped left behind, never one being run now — which is what lets `resumedSteps` start it
     * again (D8-05).
     */
    const taken = (id: string) =>
      Effect.suspend(() => {
        if (running.has(id)) return Effect.fail(new PreparationRunningError({ workspaceId: id }))
        running.add(id)
        return Effect.void
      })
    const released = (id: string) => Effect.sync(() => running.delete(id))
    const alone = <A, E>(id: string, effect: Effect.Effect<A, E>) =>
      taken(id).pipe(Effect.andThen(effect.pipe(Effect.ensuring(released(id)))))

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
     * this step already made: that registration is pruned and the branch checked out again,
     * rather than refused as a branch that already exists.
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

    /** A file of `main` copied at each destination, never over one that is there (D8-05). */
    const copy = (place: Place, step: WorkspaceStep): Outcome =>
      outcomeOf(
        destinationsOf(place, step).map((destination) => {
          if (!existsSync(destination.from)) return { label: destination.label, result: 'missing' }
          if (occupied(destination.to)) return { label: destination.label, result: 'kept' }
          try {
            mkdirSync(dirname(destination.to), { recursive: true })
            // Exclusive all the same: a file that appeared since is kept, never overwritten.
            copyFileSync(destination.from, destination.to, constants.COPYFILE_EXCL)
            return { label: destination.label, result: 'made' }
          } catch (cause) {
            return { label: destination.label, result: { refused: said(cause) } }
          }
        }),
      )

    /** A link to a file or a folder of `main` at each destination (D8-05, D8-17). */
    const link = (place: Place, step: WorkspaceStep) =>
      Effect.gen(function* () {
        const placed: { label: string; result: Placed }[] = []
        for (const destination of destinationsOf(place, step)) {
          if (!existsSync(destination.from)) {
            placed.push({ label: destination.label, result: 'missing' })
            continue
          }
          if (occupied(destination.to)) {
            placed.push({ label: destination.label, result: 'kept' })
            continue
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
          placed.push({ label: destination.label, result })
        }
        return outcomeOf(placed)
      })

    /**
     * A command of the catalogue, run in the Workspace until it ends (D8-05).
     *
     * A real run with no Session (Decided 11): the Commands service runs the machine's line of
     * the command in its folder under the Workspace, with the variables Hemera gives there
     * (D8-06, D8-07), and keeps its output and exit code on its row. The step writes the run's
     * identifier as soon as it has one, so the step running points at the run printing, then
     * waits for it however long it takes: a step waits for its command.
     */
    const run = (place: Place, step: WorkspaceStep) =>
      Effect.gen(function* () {
        const rows = yield* database
          .select()
          .from(projectCommands)
          .where(eq(projectCommands.id, step.commandId ?? ''))
          .pipe(Effect.mapError(failed('reading the commands')))
        const command = rows[0]
        if (command === undefined) {
          return {
            state: 'failed',
            message: `the command ${step.target} is no longer in the catalogue`,
          } satisfies Outcome
        }
        const { projectId, id: workspaceId } = place.workspace
        const started = yield* commands.run({
          sessionId: null,
          projectId,
          commandId: command.id,
          name: command.name,
          line: command.line,
          lineWindows: command.lineWindows,
          lineLinux: command.lineLinux,
          type: commandType(command.type),
          scope: commandScope(command.scope),
          portless: command.portless === 1,
          folder: command.folder === '' ? null : command.folder,
          cwd: join(place.workspace.path, command.folder),
          workspaceId,
          workspaceName: place.workspace.name,
          environment: yield* variables.givenFor(projectId, workspaceId),
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
      ).pipe(Effect.tap(() => told(place.workspace)))

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
        yield* told(place.workspace)
        return yield* workspacesService.one(id)
      })

    /** Whether what a `done` step made is still on the disk (D8-05). */
    const present = (place: Place, step: WorkspaceStep) => {
      switch (step.kind) {
        case 'worktree':
          return existsSync(join(place.workspace.path, step.target, '.git'))
        case 'copy':
        case 'link':
          return destinationsOf(place, step)
            .filter((destination) => existsSync(destination.from))
            .every((destination) => occupied(destination.to))
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

    return {
      prepare: (id) => alone(id, drive(id, new Set())),

      resume: (id) => alone(id, resuming(id)),

      begin: (id, resume) =>
        Effect.gen(function* () {
          const before = yield* steps(id)
          yield* taken(id)
          yield* Effect.forkIn(scope)(
            (resume ? resuming(id) : drive(id, new Set())).pipe(
              // Nobody is waiting on it: a failure of the storage goes to the diagnostic, and the
              // steps say how far it got.
              Effect.catch((refused) =>
                diagnostic.write(`preparing the Workspace ${id} failed: ${refused.message}`),
              ),
              Effect.ensuring(released(id)),
            ),
          )
          return before
        }),

      steps,
    } satisfies PreparationService
  }),
)
