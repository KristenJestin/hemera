/**
 * The snapshots a build keeps of each repository, and the files changed between two of them
 * (design D10-05).
 *
 * A snapshot is a Git tree and nothing more: the working tree added whole to an index of
 * Hemera's own, then written. No commit, no ref, no change of branch, and the user's index is
 * never written — it is copied, and the copy is what `git add` changes. Starting from a copy
 * rather than from nothing keeps what the user's index knows that the working tree does not say,
 * a sparse checkout's skipped files first; `git rev-parse --git-path index` names it, which in a
 * linked worktree is the worktree's own. The copy lives in a temporary folder removed however the
 * snapshot ends.
 *
 * The tree has no ref, so Git's garbage collection may prune it one day: that is why the files an
 * attempt changed are copied into the database when it ends (D10-05), from `changedFiles`.
 *
 * Through `engine/git.ts`, never inside a transaction (AGENTS.md, "Data and migrations"): a use
 * case takes its snapshot, then writes the row that names it.
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Data, Effect } from 'effect'

import { Git } from '../git.ts'

/** The temporary folder a snapshot's index is copied into could not be made or filled. */
export class SnapshotFolderError extends Data.TaggedError('SnapshotFolderError')<{
  readonly repository: string
  readonly cause: unknown
}> {
  override get message(): string {
    return `A snapshot of ${this.repository} could not prepare its index: ${String(this.cause)}`
  }
}

/**
 * One file changed between two snapshots, as the evidence keeps it (D10-05).
 *
 * `status` is Git's letter — `A` added, `M` modified, `D` deleted, `R` renamed, `T` its type
 * changed — and a renamed file is named by its new path. `added` and `removed` count lines, and
 * are null for a binary file, which has none.
 */
export interface ChangedFile {
  readonly path: string
  readonly status: string
  readonly added: number | null
  readonly removed: number | null
}

/**
 * The tree of a repository as it stands now, staged, unstaged and untracked changes included and
 * ignored files left out, written without touching anything of the user's (D10-05).
 */
export function snapshotTree(repositoryPath: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const git = yield* Git
      const own = yield* git.gitPath(repositoryPath, 'index')
      const folder = yield* Effect.acquireRelease(
        Effect.try({
          try: () => mkdtempSync(join(tmpdir(), 'hemera-snapshot-')),
          catch: (cause) => new SnapshotFolderError({ repository: repositoryPath, cause }),
        }),
        // A folder left behind is litter in the temporary directory, not a failed snapshot.
        (made) =>
          Effect.try(() => rmSync(made, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      const index = join(folder, 'index')
      yield* Effect.try({
        try: () => copyIndex(own, index),
        catch: (cause) => new SnapshotFolderError({ repository: repositoryPath, cause }),
      })
      return yield* git.writeTree(repositoryPath, index)
    }),
  )
}

/**
 * The user's index copied to where the snapshot writes, or nothing when there is none yet: a
 * repository nothing was ever added to has no index, and its snapshot starts from an empty one.
 */
function copyIndex(from: string, to: string): void {
  try {
    copyFileSync(from, to)
  } catch (failure) {
    if (failure instanceof Error && 'code' in failure && failure.code === 'ENOENT') return
    throw failure
  }
}

/** The files changed from one snapshot to the next, in Git's order (D10-05). */
export function changedFiles(repositoryPath: string, fromTree: string, toTree: string) {
  return Effect.gen(function* () {
    const git = yield* Git
    const printed = yield* git.diffTrees(repositoryPath, fromTree, toTree)
    return filesOf(printed.numstat, printed.nameStatus)
  })
}

/**
 * The two `-z` listings of one diff, joined by path.
 *
 * `--name-status` prints `<letter>[score]\0<path>\0`, and a rename or a copy
 * `<letter><score>\0<old>\0<new>\0`. `--numstat` prints `<added>\t<removed>\t<path>\0`, and a
 * rename `<added>\t<removed>\t\0<old>\0<new>\0`, with `-` for both counts of a binary file. Paths
 * are as they are — `-z` quotes nothing — so a tab or a newline in a name is read whole.
 */
function filesOf(numstat: string, nameStatus: string): ChangedFile[] {
  const counts = new Map<string, { added: number | null; removed: number | null }>()
  const stats = fields(numstat)
  for (let at = 0; at < stats.length;) {
    const record = stats[at] ?? ''
    const first = record.indexOf('\t')
    const second = record.indexOf('\t', first + 1)
    const named = record.slice(second + 1)
    const path = named === '' ? (stats[at + 2] ?? '') : named
    at += named === '' ? 3 : 1
    counts.set(path, {
      added: count(record.slice(0, first)),
      removed: count(record.slice(first + 1, second)),
    })
  }

  const files: ChangedFile[] = []
  const statuses = fields(nameStatus)
  for (let at = 0; at < statuses.length;) {
    const status = (statuses[at] ?? '').charAt(0)
    const moved = status === 'R' || status === 'C'
    const path = statuses[at + (moved ? 2 : 1)] ?? ''
    at += moved ? 3 : 2
    const counted = counts.get(path)
    files.push({ path, status, added: counted?.added ?? null, removed: counted?.removed ?? null })
  }
  return files
}

/** A `-z` listing cut on its separators, without the empty field after the last one. */
function fields(printed: string): string[] {
  const cut = printed.split('\0')
  if (cut.at(-1) === '') cut.pop()
  return cut
}

/** A count of `--numstat`, and null for the `-` of a binary file. */
function count(printed: string): number | null {
  return printed === '-' ? null : Number(printed)
}
