/**
 * The machine's `git`, and the few things Hemera asks of it (design D8-03, D8-15, D8-17, D10-05).
 *
 * No library: a JavaScript Git cannot make a worktree, and the user's own `git` is the one whose
 * configuration, hooks and credentials they already trust. It is spawned with its arguments and
 * no shell, answers with what it printed, and a refusal is its standard error as it wrote it —
 * in the machine's language, because that is the message the user can search for (D8-15).
 *
 * Never inside a transaction (AGENTS.md, "Data and migrations"): a use case asks Git before it
 * writes, or after it has written, and never while a lock is held.
 *
 * Every command runs with `-C <folder>` rather than in that folder, so a folder that is not
 * there is refused by Git in its own words, and a spawn that fails with `ENOENT` can only mean
 * one thing: the program itself is not on the `PATH`.
 */

import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { Context, Data, Effect, Layer } from 'effect'

/** What a command may print before it is cut: a status of a large tree is long, not endless. */
const OUTPUT_LIMIT = 32 * 1024 * 1024

/**
 * How long a read may take before Git is taken as refusing it: `rev-parse`, a ref listing and a
 * branch test answer in milliseconds, and a plan waits for several of them per repository. A
 * Windows runner held `workspaces.plan` past a test's half-minute (#101, #102) because nothing
 * bounded a child that never exited: a plan now ends, or fails in Git's words, within seconds.
 */
const READ_LIMIT = 10_000

/**
 * How long a command that writes may take: a `worktree add` checks out a whole tree, which is
 * slow on a large repository and must not be cut short. It is a bound against a child that never
 * exits, not a deadline.
 */
const WORK_LIMIT = 30 * 60 * 1000

/** The program named is not on the `PATH`: shown by name where a Workspace is created (D8-03). */
export class GitUnavailableError extends Data.TaggedError('GitUnavailableError')<{
  readonly program: string
}> {
  override get message(): string {
    return `${this.program} was not found on the PATH`
  }
}

/** Git refused: its standard error, as it wrote it (D8-15). */
export class GitError extends Data.TaggedError('GitError')<{
  readonly args: readonly string[]
  readonly cwd: string
  readonly stderr: string
}> {
  override get message(): string {
    const said = this.stderr.trim()
    return said === '' ? `git ${this.args.join(' ')} failed in ${this.cwd}` : said
  }
}

/** A repository as `git status` sees it when it is shown, and never stored (D8-15). */
export interface GitStatus {
  /** The branch checked out, or `(detached)` when none is. */
  readonly branch: string
  /** The commit checked out, or `(initial)` in a repository with none yet. */
  readonly commit: string
  readonly staged: number
  readonly unstaged: number
  readonly untracked: number
}

/**
 * What `HEAD` is on, for the base a creation proposes (D8-04): the branch checked out, or the
 * commit it is on when it is on none of its own, with that commit shortened the way Git
 * abbreviates it.
 */
export interface GitHead {
  /** The branch checked out, or null when `HEAD` is on no branch at all (D8-04). */
  readonly branch: string | null
  /** The commit `HEAD` is on. */
  readonly commit: string
  /**
   * That commit as Git abbreviates it: the one hash the creation dialog ever shows, and null
   * where the branch it is on names it already and no hash is read at all.
   */
  readonly short: string | null
}

type Refusal = GitError | GitUnavailableError

export interface GitService {
  /** The commit a reference resolves to, locally: no fetch is ever made (D8-04). */
  readonly revParse: (cwd: string, ref: string) => Effect.Effect<string, Refusal>
  /** A worktree at `path` on a new branch made from `base` (D8-04). */
  readonly worktreeAdd: (
    cwd: string,
    branch: string,
    path: string,
    base: string,
  ) => Effect.Effect<void, Refusal>
  /**
   * A worktree at `path` on a branch that already exists: the one a worktree step made before
   * its folder was removed by hand, which a resume puts back (D8-04 and D8-05 as amended by
   * Decided 14: a creation never checks out an existing branch, a resume re-attaches its own).
   */
  readonly worktreeAttach: (
    cwd: string,
    branch: string,
    path: string,
  ) => Effect.Effect<void, Refusal>
  /**
   * Removes a worktree, and never with `--force`: Git's refusal of uncommitted changes is what
   * stops a cleanup (D8-14).
   */
  readonly worktreeRemove: (cwd: string, path: string) => Effect.Effect<void, Refusal>
  /**
   * Forgets the worktrees whose folder is gone, which Git otherwise holds as still there (D8-03
   * as amended by Decided 15: run when a worktree folder is found missing on a resume or a
   * cleanup).
   *
   * Repository-wide, as Decided 15 accepts: it also forgets a stale worktree the user made
   * themselves, whose folder is gone too (one that is locked is kept). It is the one way every Git
   * the user may have forgets a worktree whose folder is missing: a redone worktree and a cleanup
   * of a worktree that was never made both need that, and nothing narrower.
   */
  readonly worktreePrune: (cwd: string) => Effect.Effect<void, Refusal>
  readonly branchExists: (cwd: string, branch: string) => Effect.Effect<boolean, Refusal>
  /** Whether Git takes a name as a branch name: `check-ref-format --branch` (D8-04). */
  readonly checkRefFormat: (
    cwd: string,
    branch: string,
  ) => Effect.Effect<boolean, GitUnavailableError>
  readonly status: (cwd: string) => Effect.Effect<GitStatus, Refusal>
  /**
   * What `HEAD` is on, read for the base the creation dialog proposes: the branch it is on, or
   * the commit it is on when it is on none (D8-04). A repository with no commit yet answers
   * null, which is an answer and not a refusal: Git refusing to read `HEAD` at all stays one,
   * and the plan shows it.
   */
  readonly head: (cwd: string) => Effect.Effect<GitHead | null, Refusal>
  /** The repository's local branches, in Git's own order: what a base is chosen from (D8-04). */
  readonly localBranches: (cwd: string) => Effect.Effect<readonly string[], Refusal>
  /**
   * Whether a folder is the top of a repository: a folder inside another repository — `./docs`
   * in a `main` that is one — holds none of its own.
   */
  readonly isRepository: (path: string) => Effect.Effect<boolean, GitUnavailableError>
  /**
   * The absolute path of a file of the repository's Git folder, as `rev-parse --git-path` names
   * it: a linked worktree's `index` is its own, not the main repository's (D10-05).
   */
  readonly gitPath: (cwd: string, name: string) => Effect.Effect<string, Refusal>
  /**
   * The working tree added whole — what `.gitignore` leaves out left out — to the index file
   * named, then the tree that index holds written, and its id (D10-05).
   *
   * The index is the caller's and never the repository's own: `GIT_INDEX_FILE` points both
   * commands at it. Nothing but objects is written — no commit, no ref, no change of branch
   * (D10-05).
   */
  readonly writeTree: (cwd: string, indexFile: string) => Effect.Effect<string, Refusal>
  /**
   * What changed between two trees, as `diff-tree -z` prints it with `--numstat` and with
   * `--name-status`, renames detected in both (D10-05).
   */
  readonly diffTrees: (
    cwd: string,
    from: string,
    to: string,
  ) => Effect.Effect<{ readonly numstat: string; readonly nameStatus: string }, Refusal>
}

export class Git extends Context.Service<Git, GitService>()('Git') {}

/**
 * The counts of `git status --porcelain=v2 --branch` (D8-15).
 *
 * `1` is a changed entry and `2` a renamed or copied one, each with its `XY`: a letter in `X`
 * is staged, one in `Y` is not. `u` is an unmerged entry, which is both; `?` is untracked.
 */
export function statusOf(printed: string): GitStatus {
  let branch = ''
  let commit = ''
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const line of printed.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length)
    else if (line.startsWith('# branch.oid ')) commit = line.slice('# branch.oid '.length)
    else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      if (line[2] !== '.') staged += 1
      if (line[3] !== '.') unstaged += 1
    } else if (line.startsWith('u ')) {
      staged += 1
      unstaged += 1
    } else if (line.startsWith('? ')) untracked += 1
  }
  return { branch, commit, staged, unstaged, untracked }
}

/**
 * How a command is started and what it answered: the machine's own `git`, spawned with its
 * arguments and no shell. A suite names its own only to make one read of it fail once — a machine
 * at work — and never to replace what the service makes of the answer.
 */
export type GitSpawn = (
  program: string,
  cwd: string,
  args: readonly string[],
  limit: number,
  environment?: Record<string, string>,
) => Effect.Effect<string, Refusal>

/** The machine's own spawn: a child with its arguments, no shell, killed when it is abandoned. */
export const spawnGit: GitSpawn = (program, cwd, args, limit, environment = {}) =>
  Effect.callback<string, Refusal>((resume, signal) => {
    const child = execFile(
      program,
      ['-C', cwd, ...args],
      {
        // Nothing may wait on a prompt, and no network is ever asked for: a credential
        // helper that would prompt fails instead (D8-04). `environment` is what a command is
        // given on top of that: the index a snapshot is written through (D10-05), and nothing
        // else.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...environment },
        maxBuffer: OUTPUT_LIMIT,
        timeout: limit,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (failure, stdout, stderr) => {
        if (failure === null) return resume(Effect.succeed(stdout))
        if (failure.code === 'ENOENT') {
          return resume(Effect.fail(new GitUnavailableError({ program })))
        }
        resume(
          Effect.fail(
            new GitError({
              args,
              cwd,
              // A child cut for taking too long said nothing: its refusal is the limit.
              stderr:
                failure.killed === true
                  ? `Git did not answer within ${limit / 1000} seconds`
                  : stderr,
            }),
          ),
        )
      },
    )
    // A read that is abandoned — an interrupted plan, a test that ended — may not leave the
    // child behind: it holds the folder its `-C` names, and a cleanup then fails with EPERM.
    signal.addEventListener('abort', () => child.kill('SIGKILL'))
  })

/** Git's own `git`, or the program named: a test names one that is not on the `PATH`. */
export const gitLayer = (program = 'git', spawn: GitSpawn = spawnGit): Layer.Layer<Git> => {
  // `environment` is what a command is given on top of the process's own: the index a snapshot
  // is written through (D10-05), and nothing else.
  const run = (
    cwd: string,
    args: readonly string[],
    limit = READ_LIMIT,
    environment: Record<string, string> = {},
  ) => spawn(program, cwd, args, limit, environment)

  /**
   * Whether `HEAD` is on a branch that has no ref yet: what a repository with no commit yet is, and
   * the only thing it is. `rev-parse --verify --quiet HEAD` fails, `symbolic-ref --short HEAD` names
   * a branch, and that branch is not stored — a read that fails for any other reason fails one of
   * the three, and is a refusal the plan keeps and retries (#102).
   */
  const unbornHead = (cwd: string) =>
    Effect.gen(function* () {
      const resolves = yield* run(cwd, [
        '--no-optional-locks',
        'rev-parse',
        '--verify',
        '--quiet',
        'HEAD',
      ]).pipe(
        Effect.as(true),
        Effect.catchTag('GitError', () => Effect.succeed(false)),
      )
      if (resolves) return false
      const named = yield* run(cwd, [
        '--no-optional-locks',
        'symbolic-ref',
        '--short',
        'HEAD',
      ]).pipe(Effect.catchTag('GitError', () => Effect.succeed(null)))
      if (named === null || named.trim() === '') return false
      const stored = yield* run(cwd, [
        '--no-optional-locks',
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${named.trim()}`,
      ]).pipe(
        Effect.as(true),
        Effect.catchTag('GitError', () => Effect.succeed(false)),
      )
      return !stored
    })

  return Layer.succeed(Git, {
    revParse: (cwd, ref) =>
      run(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).pipe(
        Effect.map((printed) => printed.trim()),
      ),
    worktreeAdd: (cwd, branch, path, base) =>
      run(cwd, ['worktree', 'add', '--quiet', '-b', branch, path, base], WORK_LIMIT).pipe(
        Effect.asVoid,
      ),
    worktreeAttach: (cwd, branch, path) =>
      run(cwd, ['worktree', 'add', '--quiet', path, branch], WORK_LIMIT).pipe(Effect.asVoid),
    worktreeRemove: (cwd, path) =>
      run(cwd, ['worktree', 'remove', path], WORK_LIMIT).pipe(Effect.asVoid),
    worktreePrune: (cwd) => run(cwd, ['worktree', 'prune'], WORK_LIMIT).pipe(Effect.asVoid),
    branchExists: (cwd, branch) =>
      run(cwd, ['branch', '--list', branch]).pipe(Effect.map((printed) => printed.trim() !== '')),
    checkRefFormat: (cwd, branch) =>
      run(cwd, ['check-ref-format', '--branch', branch]).pipe(
        Effect.as(true),
        Effect.catchTag('GitError', () => Effect.succeed(false)),
      ),
    // An observation writes nothing (D8-15): without `--no-optional-locks` a status refreshes the
    // index and takes its lock, and a `worktree add` under way in that folder is refused for it.
    status: (cwd) =>
      run(cwd, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'], WORK_LIMIT).pipe(
        Effect.map(statusOf),
      ),
    // `--abbrev-ref` answers `HEAD` itself when it is on no branch: a detached commit, which is
    // an answer here and not a refusal. A repository with no commit yet refuses every read of
    // `HEAD`, and only the branch a commit will land on is left to name: nothing to start a base
    // from is an answer, where Git refusing to read `HEAD` at all is a refusal (D8-04).
    head: (cwd) =>
      Effect.gen(function* () {
        const named = yield* run(cwd, ['--no-optional-locks', 'rev-parse', '--abbrev-ref', 'HEAD'])
        const commit = yield* run(cwd, ['--no-optional-locks', 'rev-parse', 'HEAD'])
        const branch = named.trim()
        const detached = branch === '' || branch === 'HEAD'
        // Git's own abbreviation, asked of Git, and only where a hash is shown at all: the length
        // depends on the repository, and a prefix cut by hand would be a hash that reads like a
        // name (D8-04).
        const short = detached
          ? yield* run(cwd, ['--no-optional-locks', 'rev-parse', '--short', 'HEAD'])
          : null
        return {
          branch: detached ? null : branch,
          commit: commit.trim(),
          short: short === null ? null : short.trim(),
        } satisfies GitHead
      }).pipe(
        // A repository with no commit yet is the one read that fails and is still an answer, and it
        // is told apart from a refusal by asking Git: a `symbolic-ref` that answers used to be
        // enough, and it swallowed every other failure of the reads above — a Git at work for a
        // moment lost the repository from the plan without a word (#102).
        Effect.catchTag('GitError', (refusal) =>
          unbornHead(cwd).pipe(
            Effect.flatMap((unborn): Effect.Effect<GitHead | null, Refusal> =>
              unborn ? Effect.succeed(null) : Effect.fail(refusal),
            ),
          ),
        ),
      ),
    // The refs as they are stored: `branch --list` prints a line naming a detached commit, which
    // Git writes in the machine's language, and nothing in Hemera reads a sentence Git translates.
    localBranches: (cwd) =>
      run(cwd, [
        '--no-optional-locks',
        'for-each-ref',
        '--format=%(refname:short)',
        'refs/heads',
      ]).pipe(
        Effect.map((printed) =>
          printed
            .split('\n')
            .map((branch) => branch.trim())
            .filter((branch) => branch !== ''),
        ),
      ),
    // At the top of a repository the prefix is empty; inside one it is the path down to here,
    // and outside any Git refuses — which is an answer here, not a failure.
    isRepository: (path) =>
      run(path, ['rev-parse', '--show-prefix']).pipe(
        Effect.map((printed) => printed.trim() === ''),
        Effect.catchTag('GitError', () => Effect.succeed(false)),
      ),
    // Relative to the folder asked about in a main repository, absolute in a linked worktree.
    gitPath: (cwd, name) =>
      run(cwd, ['rev-parse', '--git-path', name]).pipe(
        Effect.map((printed) => resolve(cwd, printed.replace(/\r?\n$/, ''))),
      ),
    writeTree: (cwd, indexFile) =>
      Effect.gen(function* () {
        const through = { GIT_INDEX_FILE: indexFile }
        yield* run(cwd, ['add', '--all'], WORK_LIMIT, through)
        const printed = yield* run(cwd, ['write-tree'], WORK_LIMIT, through)
        return printed.trim()
      }),
    // `diff-tree` rather than `diff`: plumbing, which no diff setting of the user's reshapes.
    diffTrees: (cwd, from, to) =>
      Effect.gen(function* () {
        const between = ['-r', '-z', '-M', '--end-of-options', from, to]
        const numstat = yield* run(cwd, ['diff-tree', '--numstat', ...between])
        const nameStatus = yield* run(cwd, ['diff-tree', '--name-status', ...between])
        return { numstat, nameStatus }
      }),
  })
}
