/**
 * The machine's `git`, and what Hemera asks of it.
 *
 * No library: the user's own `git` is the one whose configuration, hooks and credentials they
 * already trust, and only it makes a worktree. It is spawned with its arguments and never through
 * a shell, always with `-C <folder>` rather than in that folder, so a folder that is not there is
 * refused by Git in its own words and a spawn failing with `ENOENT` can only mean that the program
 * is not on the PATH.
 *
 * Git never blocks the application:
 * - every call declares its class, and its class sets its limit: a read is given 30 seconds, work
 *   (a worktree made, removed or pruned, anything that walks the whole tree) 30 minutes;
 * - a command cut at its limit, or abandoned, is killed and waited for until it has exited: on
 *   Windows a folder a live process stands in cannot be removed (EPERM);
 * - what it prints is read up to 32 MB;
 * - nothing waits on a prompt: `GIT_TERMINAL_PROMPT=0`, and `GCM_INTERACTIVE=never` for Git
 *   Credential Manager (the helper Git for Windows ships), so a fetch that would ask for
 *   credentials fails at once; stored credentials still answer;
 * - never inside a database transaction.
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { type DirtyStatus, type Masked, maskText } from '@hemera/core/domain'
import { GitCut, GitFailed, GitMissing } from '@hemera/ipc'
import { Context, Effect, Layer, Option } from 'effect'

import { outsideTransaction } from './transaction.ts'

/** A read (status, rev-parse, remote, the fetch of one branch, log), or work on the tree. */
export type CallClass = 'read' | 'work'

/** How long each class of call may run before Hemera stops it, in milliseconds. */
export const LIMITS: Readonly<Record<CallClass, number>> = {
  read: 30_000,
  work: 30 * 60_000,
}

/** How much of what a command prints is read before it is cut: a long status, not an endless one. */
export const OUTPUT_LIMIT = 32 * 1024 * 1024

export type GitRefusal = GitFailed | GitMissing | GitCut

/** The program run as Git, and what goes before its arguments. */
export interface GitProgram {
  readonly command: string
  readonly leading: ReadonlyArray<string>
}

/** The machine's own `git`, found on the PATH. */
export const SYSTEM_GIT: GitProgram = { command: 'git', leading: [] }

/**
 * What Git's standard error is masked with when no registry of known secrets is handed: the
 * shapes of credentials (a URL's password, a token). The engine hands its registry.
 */
const SHAPES_ONLY = (text: string): Masked<string> => maskText(text, [])

/** Runs one command in `folder` and answers what it printed. */
export type GitSpawn = (
  folder: string,
  args: ReadonlyArray<string>,
  kind: CallClass,
) => Effect.Effect<string, GitRefusal>

/**
 * Stops a command and everything it started: `git fetch` runs a transport (ssh, a remote
 * helper) that would otherwise outlive it, holding the folder. On Windows the tree is ended by
 * `taskkill`; elsewhere the command leads a process group of its own, and the group is ended.
 */
function end(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

const exited = (child: ChildProcess): boolean =>
  child.pid === undefined || child.exitCode !== null || child.signalCode !== null

/** What a call may hand Git beyond its arguments: variables of its environment, and its input. */
export interface GitCallOptions {
  readonly env?: Readonly<Record<string, string>>
  readonly input?: Uint8Array
}

/** Runs one command in `folder` and answers the bytes it printed, as they are. */
export type GitBytesSpawn = (
  folder: string,
  args: ReadonlyArray<string>,
  kind: CallClass,
  options?: GitCallOptions,
) => Effect.Effect<Buffer, GitRefusal>

/**
 * The machine's spawn: a child with its arguments and no shell. Abandoned (interrupted, or cut at
 * its limit), it is ended, and the interruption returns once it has exited, not once it was told
 * to go. What it printed is answered as bytes: a blob is not text.
 */
export const spawnGitBytes =
  (program: GitProgram, mask: (text: string) => Masked<string> = SHAPES_ONLY): GitBytesSpawn =>
  (folder, args, kind, options = {}) => {
    const run = Effect.callback<Buffer, GitRefusal>((resume) => {
      const child = spawn(program.command, [...program.leading, '-C', folder, ...args], {
        env: {
          ...process.env,
          ...options.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
        },
        stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
      const out: Buffer[] = []
      const err: Buffer[] = []
      let printed = 0
      let settled = false
      const settle = (answer: Effect.Effect<Buffer, GitRefusal>) => {
        if (settled) return
        settled = true
        resume(answer)
      }
      if (options.input !== undefined && child.stdin !== null) {
        // A command that stops reading early closes its end: what is left is not its to read.
        child.stdin.on('error', () => {})
        child.stdin.end(options.input)
      }
      child.stdout?.on('data', (chunk: Buffer) => {
        printed += chunk.length
        if (printed > OUTPUT_LIMIT) {
          end(child)
          settle(
            Effect.fail(
              new GitCut({
                args: [...args],
                folder,
                limit: 'output',
                seconds: LIMITS[kind] / 1000,
              }),
            ),
          )
          return
        }
        out.push(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
      child.once('error', (failure: NodeJS.ErrnoException) =>
        settle(
          failure.code === 'ENOENT'
            ? Effect.fail(new GitMissing({ program: program.command }))
            : Effect.fail(
                new GitFailed({ args: [...args], folder, stderr: mask(failure.message) }),
              ),
        ),
      )
      child.once('close', (code) =>
        settle(
          code === 0
            ? Effect.succeed(Buffer.concat(out))
            : Effect.fail(
                new GitFailed({
                  args: [...args],
                  folder,
                  stderr: mask(Buffer.concat(err).toString('utf8')),
                }),
              ),
        ),
      )
      return Effect.callback<void>((gone) => {
        if (exited(child)) return gone(Effect.void)
        child.once('exit', () => gone(Effect.void))
        end(child)
      })
    })
    return outsideTransaction(`run git ${args.join(' ')}`, run).pipe(
      Effect.catchTag('SideEffectInTransaction', (refused) => Effect.die(refused)),
      Effect.timeoutOrElse({
        duration: LIMITS[kind],
        orElse: () =>
          Effect.fail(
            new GitCut({ args: [...args], folder, limit: 'time', seconds: LIMITS[kind] / 1000 }),
          ),
      }),
    )
  }

/** The same spawn, answering what Git printed as text. */
export const spawnGit =
  (program: GitProgram, mask: (text: string) => Masked<string> = SHAPES_ONLY): GitSpawn =>
  (folder, args, kind) =>
    spawnGitBytes(program, mask)(folder, args, kind).pipe(
      Effect.map((printed) => printed.toString('utf8')),
    )

/** A repository as `git status` reads it. */
export interface GitStatus {
  /** The branch checked out, or null when HEAD is detached. */
  readonly branch: string | null
  /** The commit checked out, or null in a repository with no commit yet. */
  readonly commit: string | null
  /** Whether anything is staged, changed, unmerged or untracked. */
  readonly dirty: boolean
}

/** The local branches of a repository, and what HEAD is on. */
export interface GitBranches {
  /** In Git's order of their names. */
  readonly branches: ReadonlyArray<string>
  /** The branch checked out (null when detached) and its commit; null with no commit yet. */
  readonly head: { readonly branch: string | null; readonly commit: string } | null
}

/** How far a worktree's HEAD has moved from the commit it was made from. */
export interface AheadBehind {
  readonly ahead: number
  readonly behind: number
}

/** A file a worktree holds that its commit does not, created or modified, or one it deleted. */
export interface WorktreeChange {
  readonly path: string
  readonly status: 'new' | 'modified' | 'deleted'
}

/** A file of a checkout that differs from its HEAD, with how (#92, CT-23). */
export interface DirtyFile {
  readonly path: string
  readonly status: DirtyStatus
}

export interface GitRemote {
  readonly name: string
  readonly fetchUrl: string
  readonly pushUrl: string
}

export interface GitService {
  readonly status: (folder: string) => Effect.Effect<GitStatus, GitRefusal>
  readonly branches: (folder: string) => Effect.Effect<GitBranches, GitRefusal>
  readonly remotes: (folder: string) => Effect.Effect<ReadonlyArray<GitRemote>, GitRefusal>
  /**
   * Fetches one branch of a remote into its tracking ref, `refs/remotes/<remote>/<branch>`, and
   * nothing else: no local branch and no checkout is touched.
   */
  readonly fetchBranch: (
    folder: string,
    remote: string,
    branch: string,
  ) => Effect.Effect<void, GitRefusal>
  /** The commit a full ref points at, or none when the ref does not exist. */
  readonly commitOf: (
    folder: string,
    ref: string,
  ) => Effect.Effect<Option.Option<string>, GitRefusal>
  /** A worktree at `path` on a new branch made from `base`. */
  readonly worktreeAdd: (
    folder: string,
    branch: string,
    path: string,
    base: string,
  ) => Effect.Effect<void, GitRefusal>
  /** A worktree at `path` on a branch that already exists. */
  readonly worktreeAttach: (
    folder: string,
    branch: string,
    path: string,
  ) => Effect.Effect<void, GitRefusal>
  /** Removes a worktree, never with `--force`: uncommitted changes stop it, in Git's words. */
  readonly worktreeRemove: (folder: string, path: string) => Effect.Effect<void, GitRefusal>
  /** Forgets the worktrees whose folder is gone. */
  readonly worktreePrune: (folder: string) => Effect.Effect<void, GitRefusal>
  /** A worktree at `path` on a detached HEAD at `commit`: no branch is made. */
  readonly worktreeDetach: (
    folder: string,
    path: string,
    commit: string,
  ) => Effect.Effect<void, GitRefusal>
  /**
   * Removes a Probe's worktree with `--force` twice, what it holds with it and even if it is
   * locked: a separate call from the Workspaces' removal, which never forces.
   */
  readonly worktreeRemoveForced: (folder: string, path: string) => Effect.Effect<void, GitRefusal>
  /**
   * Deletes a branch only while it still points at `commit`: a branch that moved since, work
   * committed on it, is kept, in Git's words.
   */
  readonly branchDeleteAt: (
    folder: string,
    branch: string,
    commit: string,
  ) => Effect.Effect<void, GitRefusal>
  /**
   * What a worktree holds against a commit, whatever was committed since: each file created or
   * modified, tracked ones first, then the untracked; ignored ones left out.
   */
  readonly worktreeChanges: (
    folder: string,
    commit: string,
  ) => Effect.Effect<ReadonlyArray<WorktreeChange>, GitRefusal>
  /**
   * Each file that differs between two commits of a repository, renames as a removal and an
   * addition: its path, Git's status letter, and the lines added and removed (null for a binary
   * file). No checkout is read.
   */
  readonly changesBetween: (
    folder: string,
    from: string,
    to: string,
  ) => Effect.Effect<ReadonlyArray<CommitChange>, GitRefusal>
  /** The patch of one file between two commits. */
  readonly diffBetween: (
    folder: string,
    from: string,
    to: string,
    path: string,
  ) => Effect.Effect<string, GitRefusal>
  /** The patch of one file of a worktree against a commit. */
  readonly fileDiff: (
    folder: string,
    commit: string,
    path: string,
  ) => Effect.Effect<string, GitRefusal>
  /**
   * The repository a worktree belongs to, as Git reads it from the worktree's `.git` (absolute or
   * relative, either separator): the folder holding its common `.git`, or a bare repository.
   */
  readonly repositoryOf: (worktree: string) => Effect.Effect<string, GitRefusal>
  /** The folders of a repository's worktrees, its own first, as Git lists them. */
  readonly worktrees: (folder: string) => Effect.Effect<ReadonlyArray<string>, GitRefusal>
  /** The files a removal would lose: changed, staged, unmerged or untracked, relative to it. */
  readonly changedFiles: (folder: string) => Effect.Effect<ReadonlyArray<string>, GitRefusal>
  /**
   * Every file of a checkout that differs from its HEAD, ignored ones left out: modified, added,
   * deleted, or untracked, each untracked file named (never its folder). A repository inside the
   * checkout is named by its folder with a trailing `/`, and a submodule by its path.
   */
  readonly dirtyFiles: (folder: string) => Effect.Effect<ReadonlyArray<DirtyFile>, GitRefusal>
  /** Whether a file is modified, added or untracked in its repository; false outside one. */
  readonly fileChanged: (path: string) => Effect.Effect<boolean, GitRefusal>
  /** How many commits HEAD has that `base` has not, and the other way round. */
  readonly aheadBehind: (folder: string, base: string) => Effect.Effect<AheadBehind, GitRefusal>
  /** Whether a path is committed at a commit; the working tree is never read. */
  readonly pathAt: (
    folder: string,
    commit: string,
    path: string,
  ) => Effect.Effect<boolean, GitRefusal>
  /**
   * Whether a unified patch applies cleanly to the files of a commit (`git apply --check` on their
   * blobs, in a scratch folder): null when it does, Git's reason otherwise. No checkout is touched.
   */
  readonly patchApplies: (
    folder: string,
    commit: string,
    patch: string,
  ) => Effect.Effect<string | null, GitRefusal>
  /**
   * What a unified patch does, read by `git apply --numstat` and `--summary` without applying it:
   * the paths it touches, and each file it creates, deletes, renames or copies.
   */
  readonly patchShape: (folder: string, patch: string) => Effect.Effect<PatchShape, GitRefusal>
}

/** A file that differs between two commits. */
export interface CommitChange {
  readonly path: string
  /** `A`, `M`, `D` or `T`, as Git prints it. */
  readonly status: string
  /** Null for a binary file. */
  readonly added: number | null
  readonly removed: number | null
}

/**
 * What `git diff --name-status -z` and `git diff --numstat -z` printed for the same two commits,
 * renames off: each file with its letter and its lines.
 */
export function commitChangesOf(named: string, counted: string): ReadonlyArray<CommitChange> {
  const lines = new Map<
    string,
    { readonly added: number | null; readonly removed: number | null }
  >()
  const counts = counted.split('\0')
  for (const entry of counts) {
    const [added = '', removed = '', ...rest] = entry.split('\t')
    const path = rest.join('\t')
    if (path === '') continue
    lines.set(path, {
      added: added === '-' ? null : Number(added),
      removed: removed === '-' ? null : Number(removed),
    })
  }
  const fields = named.split('\0')
  const changes: CommitChange[] = []
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const status = fields[at] ?? ''
    const path = fields[at + 1] ?? ''
    if (status === '' || path === '') continue
    const lineCounts = lines.get(path) ?? { added: null, removed: null }
    changes.push({ path, status: status.slice(0, 1), ...lineCounts })
  }
  return changes
}

/** What a patch does to the files it touches. */
export interface PatchShape {
  readonly paths: ReadonlyArray<string>
  readonly changes: ReadonlyArray<'create' | 'delete' | 'rename' | 'copy'>
}

export class Git extends Context.Service<Git, GitService>()('Git') {}

/**
 * What `git status --porcelain=v2 --branch` printed. Any line that is not a header is an entry,
 * and an entry is a change: staged, changed, unmerged or untracked.
 */
export function statusOf(printed: string): GitStatus {
  let branch: string | null = null
  let commit: string | null = null
  let dirty = false
  for (const line of printed.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length)
      commit = oid === '(initial)' ? null : oid
    } else if (line !== '' && !line.startsWith('#')) dirty = true
  }
  return { branch, commit, dirty }
}

/**
 * What `git branch --format` printed, one line per branch: the HEAD mark, the full ref, the
 * short name and the commit, separated by NUL. Git's line for a detached HEAD is told apart by its
 * ref, which is none under `refs/heads/`; the sentence it prints there is translated and never read.
 */
export function branchesOf(printed: string): GitBranches {
  const branches: string[] = []
  let head: GitBranches['head'] = null
  for (const line of printed.split('\n')) {
    if (line.trim() === '') continue
    const [mark = '', ref = '', name = '', commit = ''] = line.split('\0')
    if (ref.startsWith('refs/heads/')) {
      branches.push(name)
      if (mark === '*') head = { branch: name, commit }
    } else if (mark === '*') head = { branch: null, commit }
  }
  return { branches, head }
}

/** What `git remote -v` printed: a fetch line and a push line per remote, in Git's order. */
export function remotesOf(printed: string): ReadonlyArray<GitRemote> {
  const found = new Map<string, { fetchUrl: string; pushUrl: string }>()
  for (const line of printed.split('\n')) {
    const match = /^(\S+)\t(.*) \((fetch|push)\)$/.exec(line.trimEnd())
    if (match === null) continue
    const [, name = '', url = '', direction] = match
    const remote = found.get(name) ?? { fetchUrl: url, pushUrl: url }
    if (direction === 'fetch') remote.fetchUrl = url
    else remote.pushUrl = url
    found.set(name, remote)
  }
  return [...found].map(([name, { fetchUrl, pushUrl }]) => ({ name, fetchUrl, pushUrl }))
}

/** What `git worktree list --porcelain -z` printed: the folder of each worktree, in Git's order. */
export function worktreesOf(printed: string): ReadonlyArray<string> {
  return printed
    .split('\0')
    .filter((field) => field.startsWith('worktree '))
    .map((field) => field.slice('worktree '.length))
}

/**
 * What `git status --porcelain=v1 -z` printed: one entry per file, its two status letters, a
 * space and its path. With `--no-renames` no entry carries a second path.
 */
export function changedFilesOf(printed: string): ReadonlyArray<string> {
  return printed
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3))
}

/**
 * What `git diff --name-status -z --no-renames <commit>` and `git ls-files --others -z` printed, as
 * the files a worktree created (added, or untracked), modified or deleted. A
 * repository inside the worktree is listed once, as its folder with a trailing `/`.
 */
export function worktreeChangesOf(
  diffed: string,
  untracked: string,
): ReadonlyArray<WorktreeChange> {
  const fields = diffed.split('\0')
  const changes: WorktreeChange[] = []
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const code = fields[at] ?? ''
    const path = fields[at + 1] ?? ''
    if (code === '' || path === '') continue
    const status = code.startsWith('D') ? 'deleted' : code.startsWith('A') ? 'new' : 'modified'
    changes.push({ path, status })
  }
  for (const path of untracked.split('\0')) {
    if (path !== '') changes.push({ path, status: 'new' })
  }
  return changes
}

/**
 * What `git status --porcelain=v1 -z --no-renames --untracked-files=all` printed, as each file that
 * differs from HEAD with how.
 */
export function dirtyFilesOf(printed: string): ReadonlyArray<DirtyFile> {
  return printed
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry): DirtyFile => {
      const code = entry.slice(0, 2)
      const path = entry.slice(3)
      if (code === '??') return { path, status: 'untracked' }
      if (code.includes('D')) return { path, status: 'deleted' }
      if (code.startsWith('A')) return { path, status: 'added' }
      return { path, status: 'modified' }
    })
}

/** What `git rev-list --left-right --count <base>...HEAD` printed: behind, then ahead. */
export function aheadBehindOf(printed: string): AheadBehind {
  const [behind = 0, ahead = 0] = printed
    .trim()
    .split(/\s+/)
    .map((count) => Number(count) || 0)
  return { ahead, behind }
}

/** Git through a spawn: the machine's own `git` unless a test hands another. */
export const gitLayer = (run: GitSpawn = spawnGit(SYSTEM_GIT)): Layer.Layer<Git> =>
  Layer.succeed(Git, {
    status: (folder) =>
      run(folder, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'], 'read').pipe(
        Effect.map(statusOf),
      ),
    // `branch.sort` is pinned so the order is Git's own whatever the user's configuration says.
    branches: (folder) =>
      run(
        folder,
        [
          '--no-optional-locks',
          '-c',
          'branch.sort=refname',
          'branch',
          '--format=%(HEAD)%00%(refname)%00%(refname:short)%00%(objectname)',
        ],
        'read',
      ).pipe(Effect.map(branchesOf)),
    remotes: (folder) => run(folder, ['remote', '-v'], 'read').pipe(Effect.map(remotesOf)),
    fetchBranch: (folder, remote, branch) =>
      run(
        folder,
        [
          'fetch',
          '--quiet',
          '--no-tags',
          '--end-of-options',
          remote,
          `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
        ],
        'read',
      ).pipe(Effect.asVoid),
    // `--quiet` answers a ref that does not exist with nothing and a failure, which is an answer.
    commitOf: (folder, ref) =>
      run(
        folder,
        ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
        'read',
      ).pipe(
        Effect.map((printed) => Option.some(printed.trim())),
        Effect.catchTag('GitFailed', (refused) =>
          refused.stderr.trim() === '' ? Effect.succeed(Option.none()) : Effect.fail(refused),
        ),
      ),
    worktreeAdd: (folder, branch, path, base) =>
      run(folder, ['worktree', 'add', '--quiet', '-b', branch, path, base], 'work').pipe(
        Effect.asVoid,
      ),
    worktreeAttach: (folder, branch, path) =>
      run(folder, ['worktree', 'add', '--quiet', path, branch], 'work').pipe(Effect.asVoid),
    worktreeRemove: (folder, path) =>
      run(folder, ['worktree', 'remove', path], 'work').pipe(Effect.asVoid),
    worktreePrune: (folder) => run(folder, ['worktree', 'prune'], 'work').pipe(Effect.asVoid),
    worktreeDetach: (folder, path, commit) =>
      run(folder, ['worktree', 'add', '--quiet', '--detach', path, commit], 'work').pipe(
        Effect.asVoid,
      ),
    worktreeRemoveForced: (folder, path) =>
      run(folder, ['worktree', 'remove', '--force', '--force', path], 'work').pipe(Effect.asVoid),
    branchDeleteAt: (folder, branch, commit) =>
      run(folder, ['update-ref', '-d', `refs/heads/${branch}`, commit], 'work').pipe(Effect.asVoid),
    worktreeChanges: (folder, commit) =>
      Effect.all([
        run(
          folder,
          [
            '--no-optional-locks',
            'diff',
            '--name-status',
            '-z',
            '--no-renames',
            '--end-of-options',
            commit,
            '--',
          ],
          'read',
        ),
        run(
          folder,
          ['--no-optional-locks', 'ls-files', '--others', '--exclude-standard', '-z'],
          'read',
        ),
      ]).pipe(Effect.map(([diffed, untracked]) => worktreeChangesOf(diffed, untracked))),
    changesBetween: (folder, from, to) =>
      Effect.all([
        run(
          folder,
          ['diff', '--name-status', '-z', '--no-renames', '--end-of-options', from, to, '--'],
          'read',
        ),
        run(
          folder,
          ['diff', '--numstat', '-z', '--no-renames', '--end-of-options', from, to, '--'],
          'read',
        ),
      ]).pipe(Effect.map(([named, counted]) => commitChangesOf(named, counted))),
    diffBetween: (folder, from, to, path) =>
      run(
        folder,
        [
          'diff',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          '--end-of-options',
          from,
          to,
          '--',
          path,
        ],
        'read',
      ),
    fileDiff: (folder, commit, path) =>
      run(
        folder,
        [
          'diff',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          '--end-of-options',
          commit,
          '--',
          path,
        ],
        'read',
      ),
    repositoryOf: (worktree) =>
      run(worktree, ['rev-parse', '--git-common-dir'], 'read').pipe(
        Effect.map((printed) => {
          const common = resolve(worktree, printed.trim())
          return basename(common) === '.git' ? dirname(common) : common
        }),
      ),
    worktrees: (folder) =>
      run(folder, ['worktree', 'list', '--porcelain', '-z'], 'read').pipe(Effect.map(worktreesOf)),
    changedFiles: (folder) =>
      run(
        folder,
        ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--no-renames'],
        'read',
      ).pipe(Effect.map(changedFilesOf)),
    dirtyFiles: (folder) =>
      run(
        folder,
        [
          '--no-optional-locks',
          'status',
          '--porcelain=v1',
          '-z',
          '--no-renames',
          '--untracked-files=all',
        ],
        'read',
      ).pipe(Effect.map(dirtyFilesOf)),
    fileChanged: (path) =>
      run(
        dirname(path),
        [
          '--no-optional-locks',
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--',
          basename(path),
        ],
        'read',
      ).pipe(
        Effect.map((printed) => printed !== ''),
        Effect.catchTag('GitFailed', () => Effect.succeed(false)),
      ),
    aheadBehind: (folder, base) =>
      run(
        folder,
        ['rev-list', '--left-right', '--count', '--end-of-options', `${base}...HEAD`],
        'read',
      ).pipe(Effect.map(aheadBehindOf)),
    pathAt: (folder, commit, path) =>
      run(
        folder,
        [
          '--literal-pathspecs',
          'ls-tree',
          '-z',
          '--name-only',
          '--end-of-options',
          commit,
          '--',
          path,
        ],
        'read',
      ).pipe(Effect.map((printed) => printed !== '')),
    patchShape: (folder, patch) =>
      withPatchFile(patch, (file) =>
        Effect.gen(function* () {
          const paths = patchedPathsOf(
            yield* run(folder, ['apply', '--numstat', '-z', file], 'read'),
          )
          const summary = yield* run(folder, ['apply', '--summary', file], 'read')
          return { paths, changes: patchChangesOf(summary) }
        }),
      ),
    patchApplies: (folder, commit, patch) =>
      withPatchFile(patch, (file) =>
        Effect.gen(function* () {
          // A repository of its own that borrows the objects of this one: its index holds the
          // commit's tree, and the patch is checked against the blobs themselves, byte for byte.
          const objects = yield* run(
            folder,
            ['rev-parse', '--path-format=absolute', '--git-path', 'objects'],
            'read',
          )
          const scratch = join(dirname(file), 'repository')
          mkdirSync(scratch)
          yield* run(scratch, ['init', '--quiet'], 'read')
          const borrowed = join(scratch, '.git', 'objects', 'info')
          mkdirSync(borrowed, { recursive: true })
          writeFileSync(join(borrowed, 'alternates'), `${objects.trim()}\n`)
          yield* run(scratch, ['read-tree', '--end-of-options', commit], 'read')
          return yield* run(scratch, ['apply', '--cached', '--check', file], 'read').pipe(
            Effect.as(null),
            Effect.catchTag('GitFailed', (refused) => Effect.succeed(refused.stderr.trim())),
          )
        }),
      ),
  })

/** A patch written to a scratch file for the time of a use, then removed. */
const withPatchFile = <A, E>(patch: string, use: (file: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), 'hemera-patch-'))),
    (scratch) =>
      Effect.suspend(() => {
        const file = join(scratch, 'change.patch')
        writeFileSync(file, patch)
        return use(file)
      }),
    (scratch) => Effect.sync(() => rmSync(scratch, { recursive: true, force: true })),
  )

/**
 * What `git apply --summary` printed, as the files a patch creates, deletes, renames or copies; a
 * change of mode alone is none of them.
 */
export function patchChangesOf(printed: string): PatchShape['changes'] {
  return printed.split('\n').flatMap((line): PatchShape['changes'] => {
    const said = line.trim()
    if (said.startsWith('create mode ')) return ['create']
    if (said.startsWith('delete mode ')) return ['delete']
    if (said.startsWith('rename ')) return ['rename']
    if (said.startsWith('copy ')) return ['copy']
    return []
  })
}

/**
 * The paths a patch touches, from what `git apply --numstat -z` printed: each entry is the counts
 * and the path, or the counts and an empty path followed by the path before and after a rename.
 */
export function patchedPathsOf(printed: string): ReadonlyArray<string> {
  const tokens = printed.split('\0')
  const paths: string[] = []
  for (let at = 0; at < tokens.length; at += 1) {
    const fields = (tokens[at] ?? '').split('\t')
    if (fields.length < 3) continue
    const path = fields.slice(2).join('\t')
    if (path !== '') {
      paths.push(path)
      continue
    }
    for (const one of [tokens[at + 1], tokens[at + 2]])
      if (one !== undefined && one !== '') paths.push(one)
    at += 2
  }
  return [...new Set(paths)]
}
