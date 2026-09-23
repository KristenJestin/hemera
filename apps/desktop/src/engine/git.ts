/**
 * The machine's `git`, and the few things Hemera asks of it (design D8-03, D8-15, D8-17).
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
import { Context, Data, Effect, Layer } from 'effect'

/** What a command may print before it is cut: a status of a large tree is long, not endless. */
const OUTPUT_LIMIT = 32 * 1024 * 1024

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
   * its folder was removed by hand, which a resume puts back (D8-05).
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
   * Forgets the worktrees whose folder is gone, which Git otherwise holds as still there.
   *
   * Repository-wide: it also forgets a stale worktree the user made themselves, whose folder is
   * gone too (one that is locked is kept). It is kept all the same, because it is the one way
   * every Git the user may have forgets a worktree whose folder is missing: a redone worktree and
   * a cleanup of a worktree that was never made both need that, and nothing narrower.
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
   * Whether a folder is the top of a repository: a folder inside another repository — `./docs`
   * in a `main` that is one — holds none of its own.
   */
  readonly isRepository: (path: string) => Effect.Effect<boolean, GitUnavailableError>
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

/** Git's own `git`, or the program named: a test names one that is not on the `PATH`. */
export const gitLayer = (program = 'git'): Layer.Layer<Git> => {
  const run = (cwd: string, args: readonly string[]) =>
    Effect.callback<string, Refusal>((resume) => {
      execFile(
        program,
        ['-C', cwd, ...args],
        {
          // Nothing may wait on a prompt, and no network is ever asked for: a credential
          // helper that would prompt fails instead (D8-04).
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          maxBuffer: OUTPUT_LIMIT,
          windowsHide: true,
        },
        (failure, stdout, stderr) => {
          if (failure === null) return resume(Effect.succeed(stdout))
          if (failure.code === 'ENOENT') {
            return resume(Effect.fail(new GitUnavailableError({ program })))
          }
          resume(Effect.fail(new GitError({ args, cwd, stderr })))
        },
      )
    })

  return Layer.succeed(Git, {
    revParse: (cwd, ref) =>
      run(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).pipe(
        Effect.map((printed) => printed.trim()),
      ),
    worktreeAdd: (cwd, branch, path, base) =>
      run(cwd, ['worktree', 'add', '--quiet', '-b', branch, path, base]).pipe(Effect.asVoid),
    worktreeAttach: (cwd, branch, path) =>
      run(cwd, ['worktree', 'add', '--quiet', path, branch]).pipe(Effect.asVoid),
    worktreeRemove: (cwd, path) => run(cwd, ['worktree', 'remove', path]).pipe(Effect.asVoid),
    worktreePrune: (cwd) => run(cwd, ['worktree', 'prune']).pipe(Effect.asVoid),
    branchExists: (cwd, branch) =>
      run(cwd, ['branch', '--list', branch]).pipe(Effect.map((printed) => printed.trim() !== '')),
    checkRefFormat: (cwd, branch) =>
      run(cwd, ['check-ref-format', '--branch', branch]).pipe(
        Effect.as(true),
        Effect.catchTag('GitError', () => Effect.succeed(false)),
      ),
    status: (cwd) => run(cwd, ['status', '--porcelain=v2', '--branch']).pipe(Effect.map(statusOf)),
    // At the top of a repository the prefix is empty; inside one it is the path down to here,
    // and outside any Git refuses — which is an answer here, not a failure.
    isRepository: (path) =>
      run(path, ['rev-parse', '--show-prefix']).pipe(
        Effect.map((printed) => printed.trim() === ''),
        Effect.catchTag('GitError', () => Effect.succeed(false)),
      ),
  })
}
