/**
 * The guard on the engine's own Git (#457): when an agent changed what shapes Git in its place,
 * however it did it, the engine runs none of its own Git calls on that repository until the user
 * has seen the change and allowed it.
 *
 * Reading command lines (#448) can never be complete: a script the agent wrote, a program in
 * another language or a tool's side effect writes the Git folder without saying so on the line.
 * So the guard looks at the files instead (`./git-shapes.ts`): a window opens right before each
 * write of an agent's file tools and before each command it runs, with the fingerprint of every
 * checkout of its place, and closes right after, the command once it has ended. While a window is
 * open, each Git call of the engine compares it first, so a change a long command makes is seen
 * before the engine's Git runs on it. Only the net change counts: a file changed then put back is
 * none.
 *
 * A change holds the repository: its common Git folder and the checkouts the agent worked in, or
 * every repository when the home's configuration changed. Every Git spawn of the engine (the Git
 * service, the snapshots, the checkpoints, the diffs) asks the guard first (`GitSpawnGuard`), and
 * a held repository is refused in words, nothing spawned. The user is asked through a permission
 * need, sensitive (Allow once, Deny): the changed files and the diff of their text, masked.
 *
 * - Allow once: the state the question showed becomes the baseline, if the files are still as it
 *   showed them; otherwise the new state is asked about, the question written again.
 * - Deny: the engine's Git stays stopped and nothing is put back: the user decides. Once the files
 *   are as they were before the change, the hold goes on its own; another state is asked about.
 *
 * What the engine's own Git writes (the index, the refs, the logs, `ORIG_HEAD`, `FETCH_HEAD`,
 * `packed-refs`) is not part of the fingerprint. A worktree it adds or removes while a window is
 * open changes the worktrees' administrative files: those its `worktree` call added or removed
 * whole are taken into the open windows as they now are, never asked about.
 */

import { join, sep } from 'node:path'

import {
  MissionOwner,
  type NeedOwner,
  PermissionFields,
  ProjectOwner,
  ROOT_REPOSITORY,
  lineDifference,
} from '@hemera/core/domain'
import { Context, Effect, Layer, Predicate, Queue } from 'effect'

import type { Log } from '../main/diagnostic.ts'
import type { GitSpawnGuard } from './git.ts'
import {
  type Shape,
  type ShapeChange,
  type ShapeHome,
  type Shapes,
  repositoryOf,
  shapeAt,
  shapeChanges,
  shapesOf,
} from './git-shapes.ts'
import { type NeedHandler, createNeed, needService, reviseNeedIn, withdrawNeed } from './needs.ts'
import { getProject } from './projects.ts'
import { mutate } from './transaction.ts'
import { shownPath } from './tools/paths.ts'

/** The engine service the guard's questions belong to. */
export const GIT_GUARD = needService('git-guard')

/** The most of the changes a question shows; past it, the rest is said cut. */
const SHOWN_CAP = 20_000

/** An agent's action the guard watches. */
export interface GuardedAction {
  /** The checkouts of its place: its root and each repository folder under it. */
  readonly checkouts: ReadonlyArray<string>
  /** Whom the question belongs to: the agent's mission, or its Project. */
  readonly owner: NeedOwner
  /** What the agent did, in words: `ran …`, `wrote …`. */
  readonly what: string
}

export class GitGuard extends Context.Service<
  GitGuard,
  {
    /**
     * Takes the fingerprint before an agent's action; answers what compares it after, to be run
     * once the action has ended, whatever ended it.
     */
    readonly open: (action: GuardedAction) => Effect.Effect<Effect.Effect<void>>
  }
>()('GitGuard') {}

/**
 * An agent's action in its place: every checkout of the place (its root, and each repository of
 * its Project under it), and whom its question belongs to.
 */
export const actionIn = (
  place: {
    readonly projectId: string
    readonly missionId: string | null
    readonly root: string
  },
  what: string,
) =>
  Effect.map(
    getProject(place.projectId).pipe(
      Effect.map((project) => project.repositories),
      Effect.orElseSucceed(() => []),
    ),
    (repositories): GuardedAction => ({
      checkouts: [
        ...new Set([
          place.root,
          ...repositories
            .filter((one) => one.path !== ROOT_REPOSITORY)
            .map((one) => join(place.root, one.path)),
        ]),
      ],
      owner:
        place.missionId === null
          ? ProjectOwner.make({ projectId: place.projectId })
          : MissionOwner.make({
              projectId: place.projectId,
              missionId: place.missionId,
              taskId: null,
            }),
      what,
    }),
  )

/** No guard: a suite's engine that does not stand on one. */
export const noGitGuard = Layer.succeed(GitGuard, {
  open: () => Effect.succeed(Effect.void),
})

/** An open window: an action going on, and the fingerprint it is compared with. */
interface Window {
  readonly action: GuardedAction
  readonly commons: ReadonlyArray<string>
  before: Shapes
}

/** One file of a hold: as it was before the change, and as the question shows it. */
interface Held {
  readonly was: Shape | null
  shown: Shape | null
}

/** A repository, or every one, whose Git the engine does not run until the user answers. */
interface Hold {
  readonly id: number
  readonly everywhere: boolean
  readonly commons: ReadonlySet<string>
  readonly checkouts: ReadonlySet<string>
  readonly changes: Map<string, Held>
  owner: NeedOwner
  what: string
  /** Its question, once written. */
  needId: string | null
  answer: 'none' | 'allowed' | 'denied'
}

/** What the questions' writer is handed: a hold to ask (again) about, or a question to withdraw. */
type Errand =
  | { readonly kind: 'ask'; readonly hold: Hold }
  | { readonly kind: 'withdraw'; readonly needId: string }

const same = (one: Shape | null, other: Shape | null): boolean => one?.digest === other?.digest

const inside = (folder: string, path: string): boolean =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep)

/** What a change does to one file, in words. */
const verb = (change: Held): string =>
  change.was === null ? 'added' : change.shown === null ? 'removed' : 'changed'

/** What a question shows of one file: its path, what became of it, and the diff of its text. */
const shownChange = (path: string, change: Held, home: string): string => {
  const head = `${shownPath(path, home)} (${verb(change)})`
  const { was, shown } = change
  const textual = (shape: Shape | null) => shape === null || shape.text !== null
  if (!textual(was) || !textual(shown)) {
    return `${head}\n  its content is not shown: a link, a binary, a folder or a file too large`
  }
  const difference = lineDifference(was?.text ?? '', shown?.text ?? '')
  return difference === ''
    ? `${head}\n  only its mode, spacing or line endings changed`
    : `${head}\n${difference}`
}

/** The guard: its windows and holds in memory, the spawns' check, and the questions' writer. */
export const engineGitGuard = (home: ShapeHome, log: Log) =>
  Effect.gen(function* () {
    const errands = yield* Queue.unbounded<Errand>()
    const windows = new Set<Window>()
    const holds = new Map<number, Hold>()
    let holdsMade = 0

    const commonsOf = (checkouts: ReadonlyArray<string>) => [
      ...new Set(checkouts.flatMap((one) => repositoryOf(one) ?? [])),
    ]

    const ask = (hold: Hold) => Queue.offerUnsafe(errands, { kind: 'ask', hold })

    /** The hold ends: its question, still open, is withdrawn. */
    const release = (hold: Hold) => {
      holds.delete(hold.id)
      if (hold.needId !== null && hold.answer === 'none') {
        Queue.offerUnsafe(errands, { kind: 'withdraw', needId: hold.needId })
      }
    }

    /** The files moved on from what the question showed: it shows them as they are now. */
    const showAgain = (hold: Hold, now: ReadonlyMap<string, Shape | null>) => {
      for (const [path, held] of hold.changes) held.shown = now.get(path) ?? null
      for (const [path, held] of hold.changes)
        if (same(held.was, held.shown)) hold.changes.delete(path)
      if (hold.changes.size === 0) return release(hold)
      if (hold.answer !== 'none') hold.needId = null
      hold.answer = 'none'
      ask(hold)
    }

    /**
     * Whether a hold still stands, settled with the files as they are now: allowed as shown, it
     * ends; moved on from what was shown, the question shows them as they are, and a hold whose
     * files are all back as they were ends.
     */
    const stands = (hold: Hold): boolean => {
      const now = new Map([...hold.changes.keys()].map((path) => [path, shapeAt(path)]))
      const asShown = [...hold.changes].every(([path, held]) =>
        same(now.get(path) ?? null, held.shown),
      )
      if (hold.answer === 'allowed' && asShown) {
        release(hold)
        return false
      }
      if (!asShown) showAgain(hold, now)
      return holds.has(hold.id)
    }

    /** A change a window saw: held, every other open window brought up to it. */
    const changed = (window: Window, now: Shapes, changes: ReadonlyArray<ShapeChange>) => {
      window.before = now
      for (const other of windows) {
        if (other === window) continue
        const theirs = shapesOf(other.action.checkouts, home)
        const before = new Map(other.before)
        for (const { path } of changes) {
          const shape = theirs.get(path)
          if (shape === undefined) before.delete(path)
          else before.set(path, shape)
        }
        other.before = before
      }
      const everywhere = changes.some((one) => (one.now ?? one.was)?.everywhere === true)
      const commons = new Set(window.commons)
      const hold =
        [...holds.values()].find((one) =>
          everywhere
            ? one.everywhere
            : !one.everywhere && [...commons].some((c) => one.commons.has(c)),
        ) ?? null
      if (hold === null) {
        holdsMade += 1
        const made: Hold = {
          id: holdsMade,
          everywhere,
          commons,
          checkouts: new Set(window.action.checkouts),
          changes: new Map(changes.map((one) => [one.path, { was: one.was, shown: one.now }])),
          owner: window.action.owner,
          what: window.action.what,
          needId: null,
          answer: 'none',
        }
        holds.set(made.id, made)
        ask(made)
        return
      }
      hold.owner = window.action.owner
      hold.what = window.action.what
      const kept = new Map([...hold.changes].map(([path, held]) => [path, held.shown]))
      for (const one of changes) {
        if (!hold.changes.has(one.path))
          hold.changes.set(one.path, { was: one.was, shown: one.now })
        kept.set(one.path, one.now)
      }
      showAgain(hold, kept)
    }

    /** Compares a window with the files as they are now. */
    const compare = (window: Window): Shapes => {
      const now = shapesOf(window.action.checkouts, home)
      const changes = shapeChanges(window.before, now)
      if (changes.length > 0) changed(window, now, changes)
      return now
    }

    const covers = (hold: Hold, folder: string, repository: () => string | null) =>
      hold.everywhere ||
      [...hold.checkouts].some((checkout) => inside(checkout, folder)) ||
      hold.commons.has(repository() ?? '')

    const spawn: GitSpawnGuard = {
      before: (folder, args) => {
        const seen = new Map<Window, Shapes>()
        for (const window of windows) seen.set(window, compare(window))
        let found: string | null | undefined
        const repository = () => {
          if (found === undefined) found = repositoryOf(folder)
          return found
        }
        const held = [...holds.values()].find(
          (hold) => covers(hold, folder, repository) && stands(hold),
        )
        if (held !== undefined) {
          return {
            refused: held.everywhere
              ? 'Hemera stopped its Git on every repository: the Git configuration of your home changed, and it waits for you to allow it in Needs you'
              : 'Hemera stopped its Git on this repository: what shapes Git there (its configuration, hooks or attributes) changed, and it waits for you to allow it in Needs you',
            after: () => {},
          }
        }
        // A worktree the engine adds or removes: its administrative files, added or removed
        // whole by this very call, are taken into the open windows as they now are.
        const after =
          args[0] !== 'worktree' || seen.size === 0
            ? () => {}
            : () => {
                for (const [window, pre] of seen) {
                  if (!windows.has(window)) continue
                  const post = shapesOf(window.action.checkouts, home)
                  const before = new Map(window.before)
                  for (const { path, was, now } of shapeChanges(pre, post)) {
                    if (was !== null && now !== null) continue
                    const administrative = window.commons.some((common) =>
                      inside(`${common}${sep}worktrees`, path),
                    )
                    if (!administrative && !path.endsWith(`${sep}.git`)) continue
                    if (now === null) before.delete(path)
                    else before.set(path, now)
                  }
                  window.before = before
                }
              }
        return { refused: null, after }
      },
    }

    const open = (action: GuardedAction) =>
      Effect.sync(() => {
        const window: Window = {
          action,
          commons: commonsOf(action.checkouts),
          before: shapesOf(action.checkouts, home),
        }
        windows.add(window)
        return Effect.sync(() => {
          if (!windows.has(window)) return
          compare(window)
          windows.delete(window)
        })
      })

    /** The question of a hold, as the need shows it. */
    const fieldsOf = (hold: Hold) => {
      const shown = [...hold.changes]
        .map(([path, held]) => shownChange(path, held, home.home))
        .join('\n\n')
      const where = hold.everywhere
        ? 'every repository'
        : [...hold.checkouts].map((one) => shownPath(one, home.home)).join(', ')
      return PermissionFields.make({
        call: shown.length > SHOWN_CAP ? `${shown.slice(0, SHOWN_CAP)}\n… (cut)` : shown,
        agentReason: hold.what,
        hemeraReason: hold.everywhere
          ? 'the Git configuration of your home changed: Hemera runs none of its own Git calls (status, commits, snapshots, diffs) on any repository until you allow it. Deny keeps them stopped; nothing is put back.'
          : 'what shapes Git in this repository changed (its configuration, hooks or attributes): Hemera runs none of its own Git calls on it (status, commits, snapshots, diffs) until you allow it. Deny keeps them stopped; nothing is put back.',
        sensitive: true,
        asked: `Let Hemera’s Git run again on ${where}`,
      })
    }

    /** Writes, or writes again, the question of a hold still waiting for one. */
    const asking = (hold: Hold) =>
      Effect.gen(function* () {
        if (!holds.has(hold.id) || hold.answer !== 'none') return
        const fields = fieldsOf(hold)
        if (hold.needId !== null) {
          const id = hold.needId
          const revised = yield* mutate('writing the guard’s question again', (transaction) =>
            Effect.map(reviseNeedIn(transaction, id, fields), (events) => ({
              result: events.length > 0,
              events,
            })),
          )
          if (revised) return
        }
        const need = yield* createNeed(GIT_GUARD, hold.owner, fields)
        hold.needId = need.id
      })

    const done = (errand: Errand) =>
      Effect.gen(function* () {
        if (errand.kind === 'ask') return yield* asking(errand.hold)
        yield* withdrawNeed(errand.needId, 'the files are as they were before the change')
      })

    const questions = Effect.forever(
      Effect.flatMap(Queue.take(errands), (errand) =>
        done(errand).pipe(
          Effect.catch((failed) =>
            Effect.sync(() => log(`the Git guard could not write its question: ${failed.message}`)),
          ),
        ),
      ),
    )

    const handler: NeedHandler = {
      deliver: (need) =>
        Effect.sync(() => {
          const hold = [...holds.values()].find((one) => one.needId === need.id)
          if (hold === undefined || need.answer === null) return []
          hold.answer =
            Predicate.isTagged(need.answer, 'Permission') && need.answer.choice !== 'deny'
              ? 'allowed'
              : 'denied'
          return []
        }),
    }

    return {
      layer: Layer.succeed(GitGuard, { open }),
      spawn,
      handler,
      questions,
    }
  })
