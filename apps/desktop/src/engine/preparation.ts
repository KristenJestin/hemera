/**
 * The preparation of a Workspace: its steps, run one after the other, and resumed after a
 * re-check of the disk.
 *
 * The steps were written when the Workspace was made: its worktrees, then the Project's recipe as
 * it was then, so a recipe edited afterwards does not change a preparation already under way.
 * Each step's state is written as it changes, in a transaction of its own and never around the
 * step: Git, the disk and a command run outside any transaction. The first failure stops the list
 * and keeps everything done before it; the failed step keeps what it did and the end of what it
 * printed.
 *
 * A resume re-checks every `done` step against the disk (a worktree has its `.git`, a copied file
 * or a link is there), turns a missing one back to `pending`, retries the failed one and carries
 * on; a `run` that is done is never run again. At the engine's start, a preparation a stopped
 * engine interrupted is resumed the same way.
 *
 * Copies and links are Hemera's own action, decided by a rule the user recorded (the recipe):
 * they never go through the agents' permission gate and never ask. A `run` step goes through the
 * `RecipeRunner` port, which asks only for a command marked "ask before running".
 */

import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import {
  type StepState,
  fillTemplate,
  nextPending,
  preparationStateOf,
  resumedSteps,
} from '@hemera/core/domain'
import { PreparationRunning, type PreparationStep, type Workspace } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect, Option, Result } from 'effect'

import { Git } from './git.ts'
import type { NewEvent } from './journal.ts'
import { RecipeRunner } from './recipe-runner.ts'
import { refusedWhile } from './storage/database.ts'
import { workspaceSteps } from './storage/schema.ts'
import { Secrets } from './secrets.ts'
import { mutate } from './transaction.ts'
import { givenVariables } from './variables.ts'
import {
  type Place,
  Preparations,
  getWorkspace,
  occupied,
  placeOf,
  readAllWorkspaces,
  templateValuesOf,
  workspaceEvent,
} from './workspaces.ts'

/** How much of the end of what a step printed its failure keeps. */
export const OUTPUT_TAIL_LINES = 40
export const OUTPUT_TAIL_CHARACTERS = 8_000

/** The end of what a step printed, as its failure keeps it. */
export function tailOf(output: string): string {
  const lines = output.trimEnd().split('\n').slice(-OUTPUT_TAIL_LINES).join('\n')
  return lines.slice(-OUTPUT_TAIL_CHARACTERS)
}

/** How a link is made: a junction for a folder on Windows, a symbolic link otherwise. */
export function linkType(platform: NodeJS.Platform, folder: boolean): 'junction' | 'dir' | 'file' {
  if (!folder) return 'file'
  return platform === 'win32' ? 'junction' : 'dir'
}

/** How a step ended. */
interface Outcome {
  readonly state: Extract<StepState, 'done' | 'failed' | 'skipped'>
  readonly failure: Failure | null
}

/** How a step failed, before its output is masked: `writeSteps` masks it as it writes it. */
interface Failure {
  readonly doing: string
  readonly output: string
}

const done: Outcome = { state: 'done', failure: null }
const skipped: Outcome = { state: 'skipped', failure: null }
const failed = (doing: string, output: string): Outcome => ({
  state: 'failed',
  failure: { doing, output: tailOf(output) },
})

const said = <E>(cause: E): string =>
  cause instanceof Error && cause.message !== '' ? cause.message : String(cause)

/**
 * Copies a file or a whole folder, never over anything already there: a file present at the
 * destination is kept as it is, and what is missing is copied. A refusal of the system is thrown
 * as the system said it.
 */
function copiedInto(from: string, to: string): void {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from)) copiedInto(join(from, name), join(to, name))
    return
  }
  if (occupied(to)) return
  mkdirSync(dirname(to), { recursive: true })
  // Exclusive all the same: a file that appeared since is kept, never overwritten.
  copyFileSync(from, to, constants.COPYFILE_EXCL)
}

/** Where a copy or a link reads in the main checkout and writes in the Workspace. */
const endsOf = (place: Place, workspace: Workspace, step: PreparationStep) => {
  const path = fillTemplate(step.path ?? '', templateValuesOf(place))
  return {
    from: join(place.project.mainCheckout, step.base ?? '', path),
    to: join(workspace.folder, step.base ?? '', path),
  }
}

/** Whether the repository a step applies under has a worktree in this Workspace. */
const inWorkspace = (workspace: Workspace, step: PreparationStep) =>
  step.base === null || workspace.repositories.some((one) => one.path === step.base)

/**
 * A repository's worktree, on the Workspace's branch from the base recorded for it, or on a
 * detached HEAD at it. A registration left by a folder removed by hand is pruned first, and a
 * branch an earlier attempt made is checked out again rather than refused as one that exists.
 */
const worktreeStep = (place: Place, workspace: Workspace, step: PreparationStep) =>
  Effect.gen(function* () {
    const repository = workspace.repositories.find((one) => one.path === step.base)
    if (repository === undefined) return skipped
    const git = yield* Git
    const source = join(place.project.mainCheckout, repository.path)
    const { worktree } = repository
    const commit = repository.base.commit
    const branch = workspace.branch
    const doing =
      branch === null
        ? `git worktree add --detach ${worktree} ${commit}`
        : `git worktree add -b ${branch} ${worktree} ${commit}`
    const parents = (() => {
      try {
        mkdirSync(dirname(worktree), { recursive: true })
        return null
      } catch (cause) {
        return said(cause)
      }
    })()
    if (parents !== null) return failed(doing, parents)
    // Made already: a stopped engine ran `git worktree add` without writing that it had.
    if (existsSync(join(worktree, '.git'))) return done
    return yield* git.worktreePrune(source).pipe(
      Effect.andThen(
        branch === null
          ? git.worktreeDetach(source, worktree, commit)
          : Effect.flatMap(git.commitOf(source, `refs/heads/${branch}`), (made) =>
              Option.isSome(made)
                ? git.worktreeAttach(source, branch, worktree)
                : git.worktreeAdd(source, branch, worktree, commit),
            ),
      ),
      Effect.as(done),
      Effect.catchTags({
        GitFailed: (refusal) => Effect.succeed(failed(doing, refusal.message)),
        GitCut: (cut) => Effect.succeed(failed(doing, cut.message)),
        GitMissing: (missing) => Effect.succeed(failed(doing, missing.message)),
      }),
    )
  })

/**
 * A file or a folder of the main checkout copied into the Workspace, never over what is there.
 * Hemera's own action (CT-18): it never goes through the permission gate and never asks.
 */
const copyStep = (place: Place, workspace: Workspace, step: PreparationStep): Outcome => {
  if (!inWorkspace(workspace, step)) return skipped
  const { from, to } = endsOf(place, workspace, step)
  const doing = `copy ${from} to ${to}`
  if (!existsSync(from)) return failed(doing, 'it is not in the main checkout')
  try {
    copiedInto(from, to)
    return done
  } catch (cause) {
    return failed(doing, said(cause))
  }
}

/**
 * A file or a folder of the main checkout linked into the Workspace: a junction for a folder on
 * Windows, which needs no privilege, a symbolic link otherwise. What is already there is kept.
 * Hemera's own action (CT-18): it never goes through the permission gate and never asks.
 */
const linkStep = (place: Place, workspace: Workspace, step: PreparationStep): Outcome => {
  if (!inWorkspace(workspace, step)) return skipped
  const { from, to } = endsOf(place, workspace, step)
  const doing = `link ${to} to ${from}`
  if (!existsSync(from)) return failed(doing, 'it is not in the main checkout')
  if (occupied(to)) return done
  try {
    mkdirSync(dirname(to), { recursive: true })
    symlinkSync(from, to, linkType(process.platform, statSync(from).isDirectory()))
    return done
  } catch (cause) {
    return failed(doing, said(cause))
  }
}

/** A command handed to the runner, in its folder under the Workspace, with its variables. */
const runStep = (place: Place, workspace: Workspace, step: PreparationStep) =>
  Effect.gen(function* () {
    if (!inWorkspace(workspace, step)) return skipped
    const values = templateValuesOf(place)
    const line = step.line === null ? null : fillTemplate(step.line, values)
    const doing = line ?? `the command ${step.commandId ?? ''}`
    const ended = yield* (yield* RecipeRunner)
      .run({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        commandId: step.commandId,
        line,
        folder: join(workspace.folder, step.base ?? '', fillTemplate(step.path ?? '', values)),
        variables: yield* givenVariables(place),
      })
      .pipe(Effect.result)
    if (Result.isFailure(ended)) return failed(doing, ended.failure.reason)
    const { exitCode, output } = ended.success
    if (exitCode === 0) return done
    return failed(
      doing,
      output.trim() === ''
        ? `it ended with ${exitCode === null ? 'no exit code' : `exit ${String(exitCode)}`}`
        : output,
    )
  })

const outcomeOf = (place: Place, workspace: Workspace, step: PreparationStep) => {
  switch (step.kind) {
    case 'worktree':
      return worktreeStep(place, workspace, step)
    case 'copy':
      return Effect.sync(() => copyStep(place, workspace, step))
    case 'link':
      return Effect.sync(() => linkStep(place, workspace, step))
    case 'run':
      return runStep(place, workspace, step)
  }
}

/**
 * Writes steps' states, with the events that tell them, in one transaction. What a failed step
 * printed is masked here, before it is kept.
 */
const writeSteps = (
  doing: string,
  steps: ReadonlyArray<{
    readonly id: string
    readonly state: StepState
    readonly failure: Failure | null
  }>,
  events: ReadonlyArray<NewEvent>,
) =>
  mutate(doing, (transaction) =>
    Effect.gen(function* () {
      const secrets = yield* Secrets
      for (const step of steps) {
        yield* transaction
          .update(workspaceSteps)
          .set({
            state: step.state,
            failedDoing: step.failure?.doing ?? null,
            failedOutput: step.failure === null ? null : secrets.mask(step.failure.output),
          })
          .where(eq(workspaceSteps.id, step.id))
          .pipe(Effect.mapError(refusedWhile('writing a step')))
      }
      return { result: undefined, events }
    }),
  )

const stepEvent = (workspace: Workspace, step: PreparationStep, state: StepState) =>
  workspaceEvent(
    `workspace.step_${state === 'running' ? 'started' : state}`,
    workspace,
    { position: step.position, kind: step.kind, base: step.base },
    'hemera',
  )

/** Runs the pending steps in order, until none is left or one fails. */
const drive = (id: string) =>
  Effect.gen(function* () {
    let workspace = yield* getWorkspace(id)
    const place = yield* placeOf(workspace.projectId, id)
    for (;;) {
      if (workspace.steps.some((step) => step.state === 'failed' || step.state === 'running')) {
        return
      }
      const next = nextPending(workspace.steps)
      if (next === undefined) return
      yield* writeSteps(
        'starting a step',
        [{ id: next.id, state: 'running', failure: null }],
        [stepEvent(workspace, next, 'running')],
      )
      const outcome = yield* outcomeOf(place, workspace, next)
      yield* writeSteps(
        'ending a step',
        [{ id: next.id, ...outcome }],
        [stepEvent(workspace, next, outcome.state)],
      )
      workspace = yield* getWorkspace(id)
    }
  })

/** Re-checks what was done against the disk, then carries on. */
const resuming = (id: string) =>
  Effect.gen(function* () {
    const workspace = yield* getWorkspace(id)
    const place = yield* placeOf(workspace.projectId, id)
    const present = (step: PreparationStep): boolean => {
      switch (step.kind) {
        case 'worktree': {
          const repository = workspace.repositories.find((one) => one.path === step.base)
          return repository === undefined || existsSync(join(repository.worktree, '.git'))
        }
        case 'copy':
        case 'link':
          return !inWorkspace(workspace, step) || occupied(endsOf(place, workspace, step).to)
        case 'run':
          return true
      }
    }
    const resumed = resumedSteps(workspace.steps, present)
    // A step going back to `pending` forgets how it failed.
    const changed = resumed
      .filter((step, at) => step.state !== workspace.steps[at]?.state)
      .map((step) => ({ id: step.id, state: step.state, failure: null }))
    const redone = changed.filter((step) =>
      workspace.steps.some((before) => before.id === step.id && before.state === 'done'),
    )
    yield* writeSteps('resuming a preparation', changed, [
      workspaceEvent(
        'workspace.resumed',
        workspace,
        { redone: redone.length, retried: changed.length - redone.length },
        'hemera',
      ),
    ])
    return yield* drive(id)
  })

/** Takes the Workspace for this engine's preparation, or refuses: one at a time. */
const claim = (id: string) =>
  Effect.gen(function* () {
    const workspace = yield* getWorkspace(id)
    if (!(yield* (yield* Preparations).hold(id))) return yield* new PreparationRunning({ id })
    return workspace
  })

/**
 * Runs a claimed preparation and lets the Workspace go, then says how it ended, so whoever
 * follows reads it no longer being prepared.
 */
const run = (id: string, resume: boolean) =>
  Effect.gen(function* () {
    const preparations = yield* Preparations
    yield* (resume ? resuming(id) : drive(id)).pipe(Effect.ensuring(preparations.release(id)))
    const workspace = yield* getWorkspace(id)
    yield* mutate('ending a preparation', () =>
      Effect.succeed({
        result: undefined,
        events: [
          workspaceEvent(
            'workspace.preparation_ended',
            workspace,
            { state: preparationStateOf(workspace.steps) },
            'hemera',
          ),
        ],
      }),
    )
    return yield* getWorkspace(id)
  })

/** Prepares a Workspace, and answers it once the preparation has ended. */
export const prepareWorkspace = (id: string) => Effect.andThen(claim(id), run(id, false))

/** Re-checks, retries and carries on a Workspace's preparation, and answers once it has ended. */
export const resumeWorkspace = (id: string) => Effect.andThen(claim(id), run(id, true))

/**
 * Starts a preparation, or a resume, in the engine's scope and answers at once: a preparation
 * takes minutes, and the window follows it through the Workspaces' changes.
 */
export const beginPreparation = (id: string, resume: boolean) =>
  Effect.gen(function* () {
    yield* claim(id)
    const preparations = yield* Preparations
    yield* run(id, resume).pipe(
      Effect.catch((refusal) =>
        Effect.sync(() =>
          preparations.log(`preparing the Workspace ${id} failed: ${said(refusal)}`),
        ),
      ),
      Effect.forkIn(preparations.scope),
    )
    return yield* getWorkspace(id)
  })

/**
 * At the engine's start: every preparation a stopped engine interrupted is resumed, in the
 * background. One never started, or stopped by a failure, waits for the user.
 */
export const resumeInterrupted = Effect.gen(function* () {
  const interrupted = (yield* readAllWorkspaces).filter(
    (workspace) => preparationStateOf(workspace.steps) === 'preparing',
  )
  for (const workspace of interrupted) {
    yield* beginPreparation(workspace.id, true).pipe(
      Effect.catchTag('PreparationRunning', () => Effect.void),
    )
  }
  return interrupted.map((workspace) => workspace.id)
})
