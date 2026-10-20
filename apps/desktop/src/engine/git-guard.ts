/**
 * The guard on the engine's own Git (#457): when what shapes Git in a repository changed, however
 * it was done, the engine runs none of its own Git calls there until the user has seen the change
 * and allowed it.
 *
 * Reading command lines (#448) can never be complete: a script the agent wrote, a program in
 * another language, a tool's side effect or a process an agent left running writes the Git folder
 * without saying so on the line. So the guard looks at the files instead (`./git-shapes.ts`), and
 * keeps one baseline per scope: a repository, by its real common Git folder, or the home's
 * configuration, which shapes every repository. Every Git call of the engine compares the scopes it
 * touches with their baselines first, whoever made a change and whenever: during an agent's
 * command, after it returned, or while the engine was stopped, since the baselines are kept
 * (`git_baselines`). Only the net change counts: a file changed then put back is none.
 *
 * Every repository Hemera knows is first seen at the start and as it is added, and any other one
 * when an agent's action opens on it or when the engine's Git first reaches it, before that call:
 * what it has then is its baseline, and nothing is asked, an index that cannot be read for its
 * submodules included (#474): one that cannot be read later asks, and one read again is dropped from
 * the baseline unasked, what it names compared from then on. The snapshot stores are repositories
 * as any. A scope with a baseline
 * kept is compared, so a change made while the engine was stopped asks at the next start; a scope
 * without one is a first sighting. A checkout's own `.git` is part of its repository's scope: one
 * pointed at another repository is a change of the first.
 *
 * An agent's action (`open`) also compares the scopes of its place when it starts and when it ends,
 * so a question comes as soon as the action is over. Whatever made a change, its reason is the same
 * and blames no one: the user, a program or a process an agent left running may have made it.
 *
 * A change holds its scope: every Git spawn of the engine (the Git service, the snapshots, the
 * checkpoints, the diffs) asks the guard first (`GitSpawnGuard`), the repository taken from the
 * Git folder the call names (`--git-dir`, `GIT_DIR`, `GIT_COMMON_DIR`) or from its folder, and a
 * held repository is refused in words, nothing spawned. The user is asked through a permission
 * need, sensitive (Allow once, Deny): the changed files and the diff of their text, masked.
 *
 * - Allow once: the state the question showed becomes the baseline, if the files are still as it
 *   showed them; otherwise the new state is asked about, the question written again.
 * - Deny: the engine's Git stays stopped and nothing is put back: the user decides. Once the files
 *   are as the baseline has them, the hold goes on its own; another state is asked about.
 *
 * The baseline moves only through an allowed hold, a first sighting, and the engine's own
 * `worktree` calls: the administrative folder of the worktree such a call names is taken into the
 * baseline, but for an index there that cannot be read, which asks (#500). What the engine's Git writes otherwise (the index, the refs, the
 * logs, `ORIG_HEAD`, `FETCH_HEAD`, `packed-refs`) is not part of any fingerprint.
 *
 * A hold is written before its question (`git_holds`), its answer with the answer, and is read back
 * at the next start with the baselines; one whose question is gone is asked again, one whose
 * repository is gone is kept. When they cannot be read, the engine's Git stays stopped everywhere
 * until the user allows it, and the scopes start again from first sightings.
 */

import { join, resolve, sep } from 'node:path'

import {
  ApplicationOwner,
  PermissionFields,
  ProjectOwner,
  ROOT_REPOSITORY,
  lineDifference,
} from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Predicate, Queue, Result, Schema } from 'effect'

import type { Log } from '../main/diagnostic.ts'
import type { GitSpawnGuard } from './git.ts'
import {
  type Shape,
  type ShapeChange,
  type ShapeHome,
  type Shapes,
  asCloned,
  checkoutOf,
  commonOf,
  isUnreadIndex,
  onlyWorktreeFormat,
  realPathOf,
  repositoryOf,
  shapeChanges,
  shapesOf,
} from './git-shapes.ts'
import {
  type NeedHandler,
  createNeedIn,
  getNeed,
  needService,
  reviseNeedIn,
  withdrawNeed,
} from './needs.ts'
import { getProject } from './projects.ts'
import type { DomainEvents } from './domain-events.ts'
import { Database, refusedWhile } from './storage/database.ts'
import { gitBaselines, gitHolds } from './storage/schema.ts'
import { mutate } from './transaction.ts'
import { shownPath } from './tools/paths.ts'

/** The engine service the guard's questions belong to. */
export const GIT_GUARD = needService('git-guard')

/** The most of the changes a question shows; past it, the rest is said cut. */
export const SHOWN_CAP = 20_000

/** What a question shows of its changes: masked first, then at most `SHOWN_CAP` of it. */
export const questionText = (text: string, mask: (text: string) => string): string => {
  const masked = mask(text)
  return masked.length > SHOWN_CAP ? `${masked.slice(0, SHOWN_CAP)}\n… (cut)` : masked
}

/** The key of the home's scope. */
const HOME = '~'

/** The key of the hold made when the guard's records could not be read at the start. */
const UNREAD = '!unread'

/** The reason every change gives, whatever made it: never an agent blamed for what may be the user's. */
const FOUND =
  'changed since Hemera last saw it: by you, by a program, or by a process an agent left running'

/** An agent's action the guard watches. */
export interface GuardedAction {
  /** The checkouts of its place: its root and each repository folder under it. */
  readonly checkouts: ReadonlyArray<string>
  /** The Project whose place it is: the question belongs to it. */
  readonly projectId: string
}

export class GitGuard extends Context.Service<
  GitGuard,
  {
    /**
     * Compares the scopes of an agent's place before its action, a first sighting taken as their
     * baseline; answers what compares them again, to be run once the action has ended.
     */
    readonly open: (
      action: GuardedAction,
    ) => Effect.Effect<Effect.Effect<void>, never, Database | DomainEvents>
  }
>()('GitGuard') {}

/** An agent's action in its place: every checkout of the place, its root and each repository. */
export const actionIn = (place: { readonly projectId: string; readonly root: string }) =>
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
      projectId: place.projectId,
    }),
  )

/** No guard: a suite's engine that does not stand on one. */
export const noGitGuard = Layer.succeed(GitGuard, {
  open: () => Effect.succeed(Effect.void),
})

/** A repository, a checkout with none yet, or the home: what one baseline stands for. */
interface Scope {
  readonly key: string
  readonly home: boolean
  /** The checkouts the agents worked in; none for the home. */
  readonly checkouts: Set<string>
  projectId: string
  baseline: Shapes
}

/** One file of a hold: as the baseline has it, and as the question shows it. */
interface Held {
  readonly was: Shape | null
  readonly shown: Shape | null
}

const Answer = Schema.Literals(['none', 'allowed', 'denied'])
type Answer = typeof Answer.Type

/** A scope, or every one, whose Git the engine does not run until the user answers. */
interface Hold {
  readonly key: string
  readonly everywhere: boolean
  readonly checkouts: ReadonlySet<string>
  changes: ReadonlyMap<string, Held>
  projectId: string
  what: string
  /** Its question, once written. */
  needId: string | null
  answer: Answer
}

/** What the writer is handed: a hold to ask (again) about, one that ended, a baseline that moved. */
type Errand =
  | { readonly kind: 'ask'; readonly hold: Hold }
  | { readonly kind: 'release'; readonly key: string; readonly withdraw: string | null }
  | { readonly kind: 'baseline'; readonly scope: Scope }

/** What is kept of a file across restarts: its kind and digests, never its text. */
const Kept = Schema.Struct({
  kind: Schema.Literals(['file', 'link', 'folder', 'over', 'other']),
  digest: Schema.String,
  steady: Schema.optional(Schema.NullOr(Schema.String)),
})
const readChanges = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({ path: Schema.String, was: Schema.NullOr(Kept), shown: Schema.NullOr(Kept) }),
    ),
  ),
)
const readShapes = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ path: Schema.String, ...Kept.fields }))),
)
const readFolders = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
const readAnswer = Schema.decodeUnknownOption(Answer)

const keptOf = (shape: Shape | null): typeof Kept.Type | null =>
  shape === null ? null : { kind: shape.kind, digest: shape.digest, steady: shape.steady }

/** A file as kept across a restart: without its text, and with no steady digest in older records. */
const unkept = (shape: typeof Kept.Type, everywhere: boolean): Shape => ({
  kind: shape.kind,
  digest: shape.digest,
  steady: shape.steady ?? null,
  text: null,
  everywhere,
})

const restored = (shape: typeof Kept.Type | null, everywhere: boolean): Shape | null =>
  shape === null ? null : unkept(shape, everywhere)

const same = (one: Shape | null, other: Shape | null): boolean => one?.digest === other?.digest

const inside = (folder: string, path: string): boolean =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep)

const heldOf = (changes: ReadonlyArray<ShapeChange>): ReadonlyMap<string, Held> =>
  new Map(changes.map((one) => [one.path, { was: one.was, shown: one.now }]))

/** What a change does to one file, in words. */
const verb = (change: Held): string =>
  change.was === null ? 'added' : change.shown === null ? 'removed' : 'changed'

/** What a question shows of one file: its path, what became of it, and the diff of its text. */
const shownChange = (path: string, change: Held, home: string): string => {
  const head = `${shownPath(path, home)} (${verb(change)})`
  const { was, shown } = change
  const textual = (shape: Shape | null) => shape === null || shape.text !== null
  if (!textual(shown)) {
    return `${head}\n  its content is not shown: a link, a binary, a folder or a file too large`
  }
  if (!textual(was)) {
    return `${head}\n  what it held before is not shown (not text, or kept across a restart without its text); it now reads:\n${lineDifference('', shown?.text ?? '')}`
  }
  const difference = lineDifference(was?.text ?? '', shown?.text ?? '')
  return difference === ''
    ? `${head}\n  only its mode, spacing or line endings changed`
    : `${head}\n${difference}`
}

/**
 * The repository a call of the engine works on: the common folder `GIT_COMMON_DIR` names, the
 * Git folder `--git-dir` or `GIT_DIR` names, or the one its folder is in.
 */
const targetOf = (
  folder: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>>,
): string | null => {
  const named = (name: string) => env[name] ?? process.env[name] ?? ''
  if (named('GIT_COMMON_DIR') !== '') return realPathOf(resolve(folder, named('GIT_COMMON_DIR')))
  let gitDir = named('GIT_DIR')
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] ?? ''
    if (arg === '--git-dir') {
      gitDir = args[at + 1] ?? gitDir
      break
    }
    if (arg.startsWith('--git-dir=')) {
      gitDir = arg.slice('--git-dir='.length)
      break
    }
    if (arg === '-c' || arg === '--work-tree' || arg === '--namespace') at += 1
    else if (!arg.startsWith('-')) break
  }
  return gitDir === '' ? repositoryOf(folder) : commonOf(resolve(folder, gitDir))
}

/** The worktree a `worktree add` or `worktree remove` names, as a real path; null for another. */
const worktreeNamed = (folder: string, args: ReadonlyArray<string>): string | null => {
  if (args[1] !== 'add' && args[1] !== 'remove') return null
  for (let at = 2; at < args.length; at += 1) {
    const arg = args[at] ?? ''
    if (arg === '-b' || arg === '-B' || arg === '--reason') at += 1
    else if (arg === '--') return realPathOf(resolve(folder, args[at + 1] ?? ''))
    else if (!arg.startsWith('-')) return realPathOf(resolve(folder, arg))
  }
  return null
}

/**
 * What an engine `worktree` call may add or remove of a repository's files: the administrative
 * folder whose `gitdir` names the worktree the call names, and that worktree's `.git`; for a
 * `prune`, the administrative folders whose worktree's `.git` was already gone.
 */
const ownedByCall = (
  common: string,
  folder: string,
  args: ReadonlyArray<string>,
  pre: Shapes,
  post: Shapes,
): ReadonlyArray<string> => {
  const worktrees = join(common, 'worktrees')
  const adminsLeadingTo = (shapes: Shapes, leads: (dotGit: string) => boolean) =>
    [...shapes].flatMap(([path, shape]) => {
      if (!inside(worktrees, path) || !path.endsWith(`${sep}gitdir`) || shape.text === null) {
        return []
      }
      const admin = path.slice(0, -`${sep}gitdir`.length)
      return leads(resolve(admin, shape.text.trim())) ? [admin] : []
    })
  if (args[1] === 'prune') return adminsLeadingTo(pre, (dotGit) => !post.has(dotGit))
  const named = worktreeNamed(folder, args)
  if (named === null) return []
  const dotGit = join(named, '.git')
  return [
    ...adminsLeadingTo(
      args[1] === 'add' ? post : pre,
      (leads) => realPathOf(leads) === dotGit || leads === dotGit,
    ),
    dotGit,
  ]
}

/** A shape's kind as a hold's line says it: what could not be read keeps its reason. */
const kindSaid = (shape: Shape | null): string =>
  shape === null ? 'absent' : shape.kind === 'other' ? shape.digest : shape.kind

/** The guard: its scopes and holds in memory, the spawns' check, and the records' writer. */
export const engineGitGuard = (
  home: ShapeHome,
  log: Log,
  mask: (text: string) => string,
  own: ReadonlyArray<string>,
  probes: string,
) =>
  Effect.gen(function* () {
    const errands = yield* Queue.unbounded<Errand>()
    const scopes = new Map<string, Scope>()
    const holds = new Map<string, Hold>()
    /** The engine's `worktree` calls going on, by scope: their folder and arguments. */
    const flying = new Map<
      string,
      Set<{ readonly folder: string; readonly args: ReadonlyArray<string> }>
    >()
    /** The actions going on, each with the scopes of its place. */
    const windows = new Set<{ readonly keys: Set<string> }>()

    const only = (shapes: Shapes, everywhere: boolean): Shapes =>
      new Map([...shapes].filter(([, shape]) => shape.everywhere === everywhere))

    const fingerprintOf = (scope: Scope): Shapes =>
      scope.home
        ? only(shapesOf([], home), true)
        : only(
            shapesOf(
              [...scope.checkouts],
              home,
              scope.key.startsWith('checkout:') ? [] : [scope.key],
            ),
            false,
          )

    /**
     * Each hold asked, said in the engine's lines: its scope, and each path with its kind before and
     * after, an error's code where it could not be read, never what a file holds.
     */
    const ask = (hold: Hold) => {
      for (const [path, change] of hold.changes) {
        log(
          `the Git guard holds ${hold.key}: ${path} ${kindSaid(change.was)} → ${kindSaid(change.shown)}`,
        )
      }
      Queue.offerUnsafe(errands, { kind: 'ask', hold })
    }
    const keep = (scope: Scope) => Queue.offerUnsafe(errands, { kind: 'baseline', scope })

    /** The hold ends: its record goes, and its question, still open, is withdrawn. */
    const release = (hold: Hold) => {
      holds.delete(hold.key)
      Queue.offerUnsafe(errands, {
        kind: 'release',
        key: hold.key,
        withdraw: hold.answer === 'none' ? hold.needId : null,
      })
    }

    /** Whether a path is in the engine's scratch folders: never a scope of the guard. */
    const owned = (path: string) => own.some((prefix) => path.startsWith(prefix))
    /** Whether a path is in the folder of the Probes' worktrees. */
    const probed = (path: string) => inside(probes, path)

    /**
     * Whether a change is the engine's own bookkeeping of a Probe's worktree, in the Probes' folder:
     * that worktree's `.git`, which the engine never trusts and reads past with the Git
     * folder it made (#439), and the `commondir` and `gitdir` of its administrative folder added or
     * removed whole. Its `config.worktree` is guarded as any.
     */
    const theEngines = (scope: Scope, change: ShapeChange, now: Shapes): boolean => {
      if (change.path.endsWith(`${sep}.git`) && probed(change.path)) return true
      if (change.was !== null && change.now !== null) return false
      const worktrees = join(scope.key, 'worktrees')
      if (!inside(worktrees, change.path)) return false
      const name = change.path.slice(change.path.lastIndexOf(sep) + 1)
      if (name !== 'commondir' && name !== 'gitdir') return false
      const admin = change.path.slice(0, -(name.length + 1))
      const gitdir = join(admin, 'gitdir')
      const text = (now.get(gitdir) ?? scope.baseline.get(gitdir))?.text ?? null
      return text !== null && probed(resolve(admin, text.trim()))
    }

    /** Whether a change is the repository format a `worktree add` writes into its `config`. */
    const worktreeFormat = (scope: Scope, change: ShapeChange): boolean =>
      change.path === join(scope.key, 'config') &&
      change.was?.text != null &&
      change.now?.text != null &&
      onlyWorktreeFormat(change.was.text, change.now.text)

    /**
     * A configuration that changed only by what a user's everyday Git writes on its own and that
     * runs nothing (a submodule's address, a branch's upstream): its steady digest is the same, and
     * what it has now is taken into the baseline, whoever wrote it. So is a submodule's Git folder
     * as `git submodule` clones it (#470). Nothing is asked.
     */
    const everyday = (scope: Scope, now: Shapes): void => {
      const taken = [...now].filter(([path, shape]) => {
        const was = scope.baseline.get(path)
        if (was === undefined) return !scope.home && asCloned(scope.key, path, shape)
        return was.digest !== shape.digest && shape.steady !== null && was.steady === shape.steady
      })
      // An index read again: what it names is compared from now on, and asks as any.
      const read = [...scope.baseline].filter(
        ([path, shape]) => isUnreadIndex(shape) && !now.has(path),
      )
      if (taken.length === 0 && read.length === 0) return
      const baseline = new Map([...scope.baseline, ...taken])
      for (const [path] of read) baseline.delete(path)
      scope.baseline = baseline
      keep(scope)
    }

    /**
     * Compares a scope with its baseline, and settles its hold with the files as they are now:
     * back as the baseline, it ends; allowed as shown, the shown state becomes the baseline; moved
     * on from what was shown, the question shows them as they are. Answers the files now.
     */
    const compare = (scope: Scope): Shapes => {
      const now = fingerprintOf(scope)
      everyday(scope, now)
      // What an engine `worktree` call still going on adds or removes whole is its own, not asked.
      const calls = [...(flying.get(scope.key) ?? [])]
      const ofCalls = calls.flatMap((call) =>
        ownedByCall(scope.key, call.folder, call.args, scope.baseline, now),
      )
      const changes = shapeChanges(scope.baseline, now).filter(
        (one) =>
          !((one.was === null || one.now === null) && ofCalls.some((o) => inside(o, one.path))) &&
          !(calls.length > 0 && worktreeFormat(scope, one)) &&
          !theEngines(scope, one, now),
      )
      const hold = holds.get(scope.key)
      if (hold === undefined) {
        if (changes.length === 0) return now
        const made: Hold = {
          key: scope.key,
          everywhere: scope.home,
          checkouts: scope.checkouts,
          changes: heldOf(changes),
          projectId: scope.projectId,
          what: FOUND,
          needId: null,
          answer: 'none',
        }
        holds.set(made.key, made)
        ask(made)
        return now
      }
      if (changes.length === 0) {
        release(hold)
        return now
      }
      const asShown =
        changes.length === hold.changes.size &&
        changes.every((one) => same(hold.changes.get(one.path)?.shown ?? null, one.now))
      if (asShown) {
        if (hold.answer === 'allowed') {
          scope.baseline = now
          keep(scope)
          release(hold)
        }
        return now
      }
      hold.changes = heldOf(changes)
      hold.what = FOUND
      if (hold.answer !== 'none') hold.needId = null
      hold.answer = 'none'
      ask(hold)
      return now
    }

    /** A scope first seen: what it has now is its baseline. */
    const sightedScope = (key: string, checkout: string | null, projectId: string): Scope => {
      const scope: Scope = {
        key,
        home: key === HOME,
        checkouts: new Set(checkout === null ? [] : [checkout]),
        projectId,
        baseline: new Map(),
      }
      scope.baseline = fingerprintOf(scope)
      scopes.set(key, scope)
      return scope
    }

    /**
     * Sees the checkouts of a place: a scope not seen yet takes what it has as its baseline, a
     * known one is compared and a checkout it did not have adds only the paths it did not have. A
     * checkout with no repository is a scope of its own only when `bare` says so (an agent's place).
     * Answers the scopes of the place, the home's first, and those whose baseline moved.
     */
    const sightIn = (checkouts: ReadonlyArray<string>, projectId: string, bare: boolean) => {
      const keys = new Set<string>([HOME])
      const moved: Scope[] = []
      const homeScope = scopes.get(HOME)
      if (homeScope === undefined) moved.push(sightedScope(HOME, null, projectId))
      else compare(homeScope)
      for (const checkout of checkouts.map(realPathOf)) {
        const repository = repositoryOf(checkout)
        if (repository === null && !bare) continue
        const key = repository ?? `checkout:${checkout}`
        keys.add(key)
        const scope = scopes.get(key)
        if (scope === undefined) {
          moved.push(sightedScope(key, checkout, projectId))
          continue
        }
        if (scope.projectId === '') scope.projectId = projectId
        const had = compare(scope)
        if (scope.checkouts.has(checkout)) continue
        // A checkout first seen in a known repository: what it adds is taken as it is.
        scope.checkouts.add(checkout)
        const baseline = new Map(scope.baseline)
        for (const [path, shape] of fingerprintOf(scope)) {
          if (!had.has(path)) baseline.set(path, shape)
        }
        scope.baseline = baseline
        moved.push(scope)
      }
      return { keys, moved }
    }

    const covers = (hold: Hold, folder: string, target: string | null) =>
      hold.everywhere ||
      hold.key === target ||
      [...hold.checkouts].some((checkout) => inside(checkout, folder))

    const spawn: GitSpawnGuard = {
      before: (folder, args, env) => {
        const real = realPathOf(folder)
        const target = targetOf(real, args, env)
        // A repository the engine works on that has no baseline yet takes one now, before the
        // call runs: what is compared is never nothing.
        if (target !== null && !scopes.has(target) && !owned(target)) {
          const checkout = repositoryOf(real) === target ? checkoutOf(real) : null
          keep(sightedScope(target, checkout, ''))
        }
        const seen = new Map<Scope, Shapes>()
        for (const scope of scopes.values()) {
          const touched =
            scope.home ||
            scope.key === target ||
            [...scope.checkouts].some((checkout) => inside(checkout, real))
          if (touched) seen.set(scope, compare(scope))
        }
        for (const hold of [...holds.values()]) {
          if (!covers(hold, real, target)) continue
          // A hold with no scope to settle it (the records unread) ends once allowed.
          if (hold.answer === 'allowed' && !scopes.has(hold.key)) {
            release(hold)
            continue
          }
          return {
            refused: hold.everywhere
              ? 'Hemera stopped its Git on every repository: the Git configuration of your home changed, or what Hemera kept of it could not be read, and it waits for you to allow it in Needs you'
              : 'Hemera stopped its Git on this repository: what shapes Git there (its configuration, hooks or attributes) changed, and it waits for you to allow it in Needs you',
            after: () => {},
          }
        }
        // A worktree the engine adds, removes or prunes: the administrative folder of the worktree
        // the call names, and its `.git`, added or removed whole by this very call, are taken into
        // the baseline; nothing else.
        const scope = target === null ? undefined : scopes.get(target)
        const pre = scope === undefined ? undefined : seen.get(scope)
        if (args[0] !== 'worktree' || scope === undefined || pre === undefined) {
          return { refused: null, after: () => {} }
        }
        const call = { folder: real, args }
        const calls = flying.get(scope.key) ?? new Set()
        calls.add(call)
        flying.set(scope.key, calls)
        return {
          refused: null,
          after: () => {
            calls.delete(call)
            const post = fingerprintOf(scope)
            const callOwns = ownedByCall(scope.key, real, args, pre, post)
            const baseline = new Map(scope.baseline)
            for (const { path, was, now } of shapeChanges(pre, post)) {
              if (was !== null && now !== null) {
                if (!worktreeFormat(scope, { path, was, now })) continue
              } else if (!callOwns.some((one) => inside(one, path))) continue
              // An index it cannot read is not the call's own: anyone may have written it (#500).
              if (now !== null && isUnreadIndex(now)) continue
              if (now === null) baseline.delete(path)
              else baseline.set(path, now)
            }
            scope.baseline = baseline
            keep(scope)
          },
        }
      },
    }

    /** A baseline's record, as it now stands. */
    const baselineRow = (scope: Scope) => ({
      id: scope.key,
      projectId: scope.projectId,
      checkouts: JSON.stringify([...scope.checkouts]),
      shapes: JSON.stringify(
        [...scope.baseline].map(([path, shape]) => ({
          path,
          kind: shape.kind,
          digest: shape.digest,
          steady: shape.steady,
        })),
      ),
    })

    const writeBaseline = (scope: Scope) =>
      mutate('keeping a baseline of the Git guard', (transaction) => {
        const row = baselineRow(scope)
        return transaction
          .insert(gitBaselines)
          .values(row)
          .onConflictDoUpdate({ target: gitBaselines.id, set: row })
          .pipe(
            Effect.mapError(refusedWhile('keeping a baseline of the Git guard')),
            Effect.as({ result: undefined, events: [] }),
          )
      })

    const keepNow = (scopesMoved: ReadonlyArray<Scope>) =>
      Effect.forEach(scopesMoved, (scope) =>
        writeBaseline(scope).pipe(
          Effect.catch((failed) =>
            Effect.sync(() => log(`the Git guard could not keep a baseline: ${failed.message}`)),
          ),
        ),
      ).pipe(Effect.asVoid)

    const open = (action: GuardedAction) =>
      Effect.gen(function* () {
        const { keys, moved } = sightIn(action.checkouts, action.projectId, true)
        // A first sighting is kept before the action starts: a change it makes is a change.
        yield* keepNow(moved)
        const window = { keys }
        windows.add(window)
        return Effect.sync(() => {
          if (!windows.has(window)) return
          windows.delete(window)
          for (const key of keys) {
            const scope = scopes.get(key)
            if (scope !== undefined) compare(scope)
          }
        })
      })

    /**
     * Sees the repositories of the places Hemera knows (each Project's main checkout and
     * Workspaces): at the start, and as they are added, so none waits for an agent's action to be
     * given its baseline.
     */
    const sight = (
      places: ReadonlyArray<{
        readonly projectId: string
        readonly checkouts: ReadonlyArray<string>
      }>,
    ) => keepNow(places.flatMap((place) => sightIn(place.checkouts, place.projectId, false).moved))

    /** The question of a hold, as the need shows it. */
    const fieldsOf = (hold: Hold) => {
      if (hold.key === UNREAD) {
        return PermissionFields.make({
          call: questionText(
            `The records of Hemera’s Git guard could not be read at the start: ${hold.what}. Hemera cannot tell what changed in your repositories while it was stopped.`,
            mask,
          ),
          agentReason: 'none: Hemera’s start',
          hemeraReason:
            'what the guard on Hemera’s own Git kept could not be read: Hemera runs none of its own Git calls (status, commits, snapshots, diffs) on any repository until you allow it. Allowed, what each repository has now becomes its baseline.',
          sensitive: true,
          asked: 'Let Hemera’s Git run again on every repository',
        })
      }
      const shown = [...hold.changes]
        .map(([path, held]) => shownChange(path, held, home.home))
        .join('\n\n')
      const where = hold.everywhere
        ? 'every repository'
        : [...hold.checkouts].map((one) => shownPath(one, home.home)).join(', ')
      return PermissionFields.make({
        call: questionText(shown, mask),
        agentReason: hold.what,
        hemeraReason: hold.everywhere
          ? 'the Git configuration of your home changed: Hemera runs none of its own Git calls (status, commits, snapshots, diffs) on any repository until you allow it. Deny keeps them stopped; nothing is put back.'
          : 'what shapes Git in this repository changed (its configuration, hooks or attributes): Hemera runs none of its own Git calls on it (status, commits, snapshots, diffs) until you allow it. Deny keeps them stopped; nothing is put back.',
        sensitive: true,
        asked: `Let Hemera’s Git run again on ${where}`,
      })
    }

    /** A hold's record, as it now stands. */
    const holdRow = (hold: Hold) => ({
      id: hold.key,
      projectId: hold.projectId,
      needId: hold.needId,
      everywhere: hold.everywhere,
      checkouts: JSON.stringify([...hold.checkouts]),
      changes: JSON.stringify(
        [...hold.changes].map(([path, held]) => ({
          path,
          was: keptOf(held.was),
          shown: keptOf(held.shown),
        })),
      ),
      answer: hold.answer,
    })

    /**
     * Writes the hold as it stands, then its question, written again if it has one still open, and
     * the question's id on the hold: a question that cannot be written leaves the hold kept, asked
     * again at the next start. A Project gone meanwhile leaves the question to the application.
     */
    const asking = (hold: Hold) =>
      Effect.gen(function* () {
        if (!holds.has(hold.key) || hold.answer !== 'none') return
        const kept = hold.key !== UNREAD
        if (kept) {
          yield* mutate('keeping a hold of the Git guard', (transaction) => {
            const row = holdRow(hold)
            return transaction
              .insert(gitHolds)
              .values(row)
              .onConflictDoUpdate({ target: gitHolds.id, set: row })
              .pipe(
                Effect.mapError(refusedWhile('keeping a hold of the Git guard')),
                Effect.as({ result: undefined, events: [] }),
              )
          })
        }
        const fields = fieldsOf(hold)
        const write = (owner: typeof ProjectOwner.Type | typeof ApplicationOwner.Type) =>
          Effect.gen(function* () {
            const create = yield* createNeedIn(GIT_GUARD, owner, fields)
            return yield* mutate('writing the guard’s question', (transaction) =>
              Effect.gen(function* () {
                const revised =
                  hold.needId === null ? [] : yield* reviseNeedIn(transaction, hold.needId, fields)
                const written = revised.length > 0 ? null : yield* create(transaction)
                const needId = written?.id ?? hold.needId ?? ''
                if (kept) {
                  yield* transaction
                    .update(gitHolds)
                    .set({ needId })
                    .where(eq(gitHolds.id, hold.key))
                    .pipe(Effect.mapError(refusedWhile('writing the question of a hold')))
                }
                return { result: needId, events: [...revised, ...(written?.events ?? [])] }
              }),
            )
          })
        hold.needId = yield* kept
          ? write(ProjectOwner.make({ projectId: hold.projectId })).pipe(
              Effect.catchTag('UnknownProject', () => write(ApplicationOwner.make({}))),
            )
          : write(ApplicationOwner.make({}))
      })

    const done = (errand: Errand) =>
      Effect.gen(function* () {
        if (errand.kind === 'ask') return yield* asking(errand.hold)
        if (errand.kind === 'baseline') return yield* writeBaseline(errand.scope)
        yield* mutate('ending a hold of the Git guard', (transaction) =>
          transaction
            .delete(gitHolds)
            .where(eq(gitHolds.id, errand.key))
            .pipe(
              Effect.mapError(refusedWhile('ending a hold of the Git guard')),
              Effect.as({ result: undefined, events: [] }),
            ),
        )
        if (errand.withdraw !== null) {
          yield* withdrawNeed(errand.withdraw, 'the files are as they were before the change')
        }
      })

    /** One errand written whole: a stop of the engine waits for it rather than cutting it. */
    const handled = (errand: Errand) =>
      done(errand).pipe(
        Effect.catch((failed) =>
          Effect.sync(() => log(`the Git guard could not write its records: ${failed.message}`)),
        ),
        Effect.uninterruptible,
      )

    const questions = Effect.forever(Effect.flatMap(Queue.take(errands), handled))

    /** What is still to be written when the engine stops, written: no baseline that moved is lost. */
    const flush = Effect.gen(function* () {
      for (;;) {
        const next = yield* Queue.poll(errands)
        if (Option.isNone(next)) return
        yield* handled(next.value)
      }
    })

    const handler: NeedHandler = {
      deliver: (need, transaction) =>
        Effect.gen(function* () {
          const hold = [...holds.values()].find((one) => one.needId === need.id)
          if (hold === undefined || need.answer === null) return []
          const answer =
            Predicate.isTagged(need.answer, 'Permission') && need.answer.choice !== 'deny'
              ? 'allowed'
              : 'denied'
          yield* transaction
            .update(gitHolds)
            .set({ answer })
            .where(eq(gitHolds.id, hold.key))
            .pipe(Effect.mapError(refusedWhile('recording the answer of the Git guard')))
          hold.answer = answer
          return []
        }),
    }

    /** The baselines and holds a stopped engine kept; a record that does not read is a failure. */
    const read = Effect.gen(function* () {
      const database = yield* Database
      const baselines = yield* database
        .select()
        .from(gitBaselines)
        .pipe(Effect.mapError(refusedWhile('reading the baselines of the Git guard')))
      const rows = yield* database
        .select()
        .from(gitHolds)
        .pipe(Effect.mapError(refusedWhile('reading the holds of the Git guard')))
      const unread = (what: string) => Effect.fail(new Error(`a record does not read: ${what}`))
      const readScopes: Scope[] = []
      /** The baselines kept before their files had a steady digest (before #458's round 5). */
      const unsteady: Scope[] = []
      for (const row of baselines) {
        const shapes = Option.getOrNull(readShapes(row.shapes))
        const checkouts = Option.getOrNull(readFolders(row.checkouts))
        if (shapes === null || checkouts === null) return yield* unread(`baseline ${row.id}`)
        const everywhere = row.id === HOME
        const scope: Scope = {
          key: row.id,
          home: everywhere,
          checkouts: new Set(checkouts),
          projectId: row.projectId,
          baseline: new Map(shapes.map(({ path, ...shape }) => [path, unkept(shape, everywhere)])),
        }
        readScopes.push(scope)
        if (shapes.some((shape) => shape.steady === undefined)) unsteady.push(scope)
      }
      const readHolds: Hold[] = []
      for (const row of rows) {
        const changes = Option.getOrNull(readChanges(row.changes))
        const checkouts = Option.getOrNull(readFolders(row.checkouts))
        const answer = Option.getOrNull(readAnswer(row.answer))
        if (changes === null || checkouts === null || answer === null) {
          return yield* unread(`hold ${row.id}`)
        }
        readHolds.push({
          key: row.id,
          everywhere: row.everywhere,
          checkouts: new Set(checkouts),
          changes: new Map(
            changes.map((one) => [
              one.path,
              {
                was: restored(one.was, row.everywhere),
                shown: restored(one.shown, row.everywhere),
              },
            ]),
          ),
          projectId: row.projectId,
          what: FOUND,
          needId: row.needId,
          answer,
        })
      }
      return { readScopes, readHolds, unsteady }
    })

    /**
     * At the start, before any Git of the engine runs: the baselines and holds a stopped engine
     * kept, read back. A hold still waiting whose question ended without an answer is asked about
     * again. When they cannot be read, the engine's Git is stopped everywhere until the user allows
     * it.
     */
    const restore = Effect.gen(function* () {
      const outcome = yield* Effect.result(read)
      if (Result.isFailure(outcome)) {
        const why = outcome.failure.message
        log(`the records of the Git guard were not read: ${why}`)
        const hold: Hold = {
          key: UNREAD,
          everywhere: true,
          checkouts: new Set(),
          changes: new Map(),
          projectId: '',
          what: why,
          needId: null,
          answer: 'none',
        }
        holds.set(hold.key, hold)
        ask(hold)
        return
      }
      const { readScopes, readHolds, unsteady } = outcome.success
      for (const scope of readScopes) scopes.set(scope.key, scope)
      // A baseline kept without steady digests takes them from its files still as it has them: an
      // everyday change made from now on is taken as one. A file changed meanwhile keeps none, and
      // asks.
      for (const scope of unsteady) {
        const now = fingerprintOf(scope)
        scope.baseline = new Map(
          [...scope.baseline].map(([path, was]) => {
            const shape = now.get(path)
            return [path, shape?.digest === was.digest ? { ...was, steady: shape.steady } : was]
          }),
        )
        keep(scope)
      }
      for (const hold of readHolds) {
        holds.set(hold.key, hold)
        if (hold.answer !== 'none') continue
        const need =
          hold.needId === null
            ? null
            : yield* getNeed(hold.needId).pipe(Effect.orElseSucceed(() => null))
        if (need?.state === 'pending') continue
        hold.needId = null
        ask(hold)
      }
    })

    return {
      layer: Layer.succeed(GitGuard, { open }),
      spawn,
      handler,
      questions,
      flush,
      restore,
      sight,
    }
  })
