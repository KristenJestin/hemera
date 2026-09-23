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
 * A `run` step runs its catalogue command in the Workspace and waits for its end. A run of the
 * Commands service belongs to a Session, and a preparation has none (D8-05): so the step starts
 * the command itself, through the same supervisor, line and environment a run would have, and
 * keeps the exit code and the end of the output on the step instead of on a run.
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
  lineFor,
  nextPending,
  resumedSteps,
  workspaceStateOf,
} from '@hemera/core'
import { and, asc, eq } from 'drizzle-orm'
import { Context, Data, Effect, Layer } from 'effect'

import { ProcessSupervisor } from '../agents/supervisor.ts'
import { hostLookup, invocationOf } from '../commands/line.ts'
import { OUTPUT_KEPT_BYTES } from '../commands/service.ts'
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
import {
  UnknownWorkspaceError,
  type WorkspaceView,
  Workspaces,
  labelOf,
  stepOf,
  workspaceEvent,
  workspaceStateIn,
} from './workspaces.ts'

/** How long the pipes of a command that ended are still read: its last lines may lag its exit. */
const DRAIN_MS = 100

/** How long a command of a step is given to die quietly when the engine stops under it. */
const GRACE_MS = 5_000

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
  /** The steps of a Workspace, in their order. */
  readonly steps: (
    workspaceId: string,
  ) => Effect.Effect<WorkspaceStep[], DatabaseError | UnknownWorkspaceError>
}

export class Preparation extends Context.Service<Preparation, PreparationService>()(
  'Preparation',
) {}

/** How a step ended. */
interface Outcome {
  readonly state: 'done' | 'skipped' | 'failed'
  readonly message: string | null
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
    const supervisor = yield* ProcessSupervisor

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
    const alone = <A, E>(id: string, effect: Effect.Effect<A, E>) =>
      Effect.suspend((): Effect.Effect<A, E | PreparationRunningError> => {
        if (running.has(id)) return Effect.fail(new PreparationRunningError({ workspaceId: id }))
        running.add(id)
        return effect.pipe(Effect.ensuring(Effect.sync(() => running.delete(id))))
      })

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
     * Started as a run of the Commands service would be — its machine's line, split without a
     * shell, in its folder under the Workspace, with the Workspace's environment (D8-06, D8-07)
     * — through the same supervisor, so an engine that stops takes it down. What it printed is
     * kept bounded as a run's is, with its exit code, on the step.
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
        const cwd = join(place.workspace.path, command.folder)
        const invocation = invocationOf(
          lineFor(command, process.platform),
          process.platform,
          hostLookup(cwd),
        )
        if (invocation === null) {
          return {
            state: 'failed',
            message: `Hemera has nothing to run: the line of ${command.name} is empty`,
          } satisfies Outcome
        }
        const env = yield* variables.environmentFor(place.workspace.projectId, place.workspace.id)
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const child = yield* supervisor.start(invocation.command, invocation.args, {
              cwd,
              env,
              graceMilliseconds: GRACE_MS,
              verbatim: invocation.verbatim,
              // What it prints is its own output, kept on the step, never the engine's log.
              logsStderr: false,
            })
            let kept = ''
            const keep = (line: string) => {
              kept += `${line}\n`
              if (kept.length > OUTPUT_KEPT_BYTES)
                kept = kept.slice(kept.length - OUTPUT_KEPT_BYTES)
            }
            child.onStdout(keep)
            child.onStderr(keep)
            const ended = yield* child.exited
            yield* Effect.sleep(DRAIN_MS)
            return {
              state: ended.code === 0 ? 'done' : 'failed',
              message: `exit ${String(ended.code ?? ended.signal)}\n${kept}`.trimEnd(),
            } satisfies Outcome
          }),
        ).pipe(
          Effect.catchTag('AgentSpawnError', (refused) =>
            Effect.succeed<Outcome>({ state: 'failed', message: refused.message }),
          ),
        )
      })

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

    return {
      prepare: (id) => alone(id, drive(id, new Set())),

      resume: (id) =>
        alone(
          id,
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
          }),
        ),

      steps: (id) => workspaceRow(id).pipe(Effect.andThen(stepsOf(id))),
    } satisfies PreparationService
  }),
)
