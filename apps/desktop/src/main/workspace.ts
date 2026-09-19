/**
 * What the main process can say about a folder on disk, and nothing more (design D4-09, D4-10).
 *
 * Neither of these belongs to the engine. A Git branch and a list of files change without
 * anyone touching a row, so a database asked about them would be answering from memory; and
 * neither is worth storing, because what is wanted is what is true at the moment it is shown.
 *
 * Nothing here writes. Nothing here runs `git`, either: what tells a repository from a folder
 * is one file, and reading it is cheaper and safer than starting a process for every location a
 * page draws.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** How deep a Workspace is walked, and how many entries are looked at before it stops. */
const DEPTH = 6
const ENTRIES = 2_000

/** What a walk never descends into, because none of it is a Project's own source. */
const SKIPPED = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])

/** How many paths a menu is handed when the caller does not say. */
const SHOWN = 20

/**
 * How many matches are collected before any of them is ranked.
 *
 * More than are shown, and bounded all the same: ranking twenty paths taken in the order a disk
 * happens to be laid out is ranking the wrong twenty, and collecting every match in a Workspace
 * to sort it is the walk this file exists to avoid.
 */
const KEPT = 200

/** What a declared location turns out to hold, read at the moment it is asked about. */
export interface RepositoryStatus {
  path: string
  /** The branch checked out there, or null when the location holds no repository. */
  git: string | null
  exists: boolean
}

/**
 * What each declared location holds, read from `.git/HEAD` rather than from `git`.
 *
 * A detached head has no branch and says so with null: it is a repository, and the interface
 * shows it as one without inventing a name for where it is.
 */
export async function repositoryStatus(
  root: string,
  paths: readonly string[],
): Promise<RepositoryStatus[]> {
  return await Promise.all(
    paths.map(async (path) => {
      const at = resolve(root, path)
      try {
        const head = await readFile(join(at, '.git', 'HEAD'), 'utf8')
        const branch = /^ref: refs\/heads\/(.+)$/m.exec(head.trim())
        return { path, git: branch?.[1] ?? null, exists: true }
      } catch {
        return { path, git: null, exists: await reachable(at) }
      }
    }),
  )
}

/** Whether a folder can hold a Workspace, and what is wrong with it when it cannot. */
export interface FolderCheck {
  ok: boolean
  /** The cause, in the words the field shows, or null when there is nothing wrong. */
  reason: string | null
}

/**
 * What is actually at a path (design D4-03).
 *
 * The specification asks for a creation on a folder that is not there, is not a folder, or
 * cannot be read to be refused *naming the cause*, and those are three different causes. Only a
 * process with a disk can tell them apart, which is why the answer is a sentence and not a
 * boolean: the field shows what comes back.
 */
export async function checkFolder(path: string): Promise<FolderCheck> {
  const at = resolve(path)
  try {
    const found = await stat(at)
    if (!found.isDirectory()) return { ok: false, reason: 'That path is not a folder.' }
  } catch {
    return { ok: false, reason: 'There is no folder there yet.' }
  }
  try {
    await readdir(at)
  } catch {
    return { ok: false, reason: 'That folder cannot be read.' }
  }
  return { ok: true, reason: null }
}

/**
 * A path under the root, written the way a declared location is written, or null when it is not.
 *
 * The one place that can tell the two apart: the renderer has no disk and no idea what `..`
 * resolves to, and a path outside the Workspace is not a location of this Project.
 */
export function within(root: string, path: string): string | null {
  const inside = relative(resolve(root), resolve(path))
  // Absolute as well as climbing out, because Windows has somewhere a relative path cannot
  // reach: two paths on different drives have no `..` between them, and `relative` answers the
  // whole of the second one — which is outside the root by every measure but a `..` count.
  if (inside === '' || isAbsolute(inside)) return null
  if (inside === '..' || inside.startsWith(`..${sep}`)) return null
  return `./${inside.split(sep).join('/')}`
}

/**
 * The folders directly under the root, and what each of them holds (design D4-09).
 *
 * One level and no deeper: what a Workspace holds at its top is the list of things a Project
 * is made of, and walking further would be offering a `src` of one of them as a location of
 * its own. Nothing is walked twice and nothing is read but `.git/HEAD`.
 */
export async function workspaceFolders(root: string): Promise<RepositoryStatus[]> {
  const entries = await readdir(resolve(root), { withFileTypes: true }).catch(() => [])
  const folders = entries
    .filter((entry) => entry.isDirectory() && !SKIPPED.has(entry.name))
    .map((entry) => `./${entry.name}`)
    .toSorted()
  return await repositoryStatus(root, folders)
}

/** Whether something is there at all, which is a different answer from having no repository. */
async function reachable(at: string): Promise<boolean> {
  try {
    await readdir(at)
    return true
  } catch {
    return false
  }
}

/**
 * The files of a Workspace whose path contains what was typed.
 *
 * Bounded three ways, because a Workspace is a folder of someone else's making: six levels
 * down, two thousand entries looked at, and twenty paths handed back. A menu that walked an
 * entire disk to offer twenty lines would be a menu that stops the window while it does it.
 *
 * Matched on the whole path and not on the name, since what tells two `index.ts` apart is the
 * folder above them.
 */
export async function workspaceFiles(
  root: string,
  query: string,
  limit = SHOWN,
): Promise<string[]> {
  const asked = query.trim().toLowerCase()
  const found: string[] = []
  let looked = 0

  const walk = async (at: string, depth: number): Promise<void> => {
    if (depth > DEPTH || looked >= ENTRIES || found.length >= KEPT) return
    const entries = await readdir(at, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (looked >= ENTRIES || found.length >= KEPT) return
      looked += 1
      if (SKIPPED.has(entry.name)) continue
      const full = join(at, entry.name)
      if (entry.isDirectory()) {
        // One folder at a time on purpose: the walk stops the moment it has enough, and reading
        // every branch in parallel would be reading most of them for nothing.
        // oxlint-disable-next-line no-await-in-loop -- the bound is the point; see above
        await walk(full, depth + 1)
        continue
      }
      const path = relative(root, full).split(sep).join('/')
      if (asked === '' || path.toLowerCase().includes(asked)) found.push(path)
    }
  }

  await walk(root, 0)
  return ranked(found, asked).slice(0, limit)
}

/**
 * The matches, best first.
 *
 * A walk answers in the order a disk is laid out, which for `pfm-` put six files of an
 * `openspec/changes/pfm-1886-…` folder ahead of the two repositories actually called `pfm-…`.
 * What someone typing a few letters means is almost always a name — so a name that starts with
 * them comes first, then a name that holds them, then a folder on the way, then the rest; and
 * within each, what is nearest the top of the Workspace.
 */
function ranked(paths: readonly string[], asked: string): string[] {
  if (asked === '') return [...paths].toSorted(byDepth)
  const scored = paths.map((path) => ({ path, rank: rankOf(path, asked) }))
  return scored
    .toSorted((one, other) => one.rank - other.rank || byDepth(one.path, other.path))
    .map((one) => one.path)
}

function rankOf(path: string, asked: string): number {
  const segments = path.toLowerCase().split('/')
  const name = segments.at(-1) ?? ''
  if (name.startsWith(asked)) return 0
  if (name.includes(asked)) return 1
  if (segments.some((segment) => segment.startsWith(asked))) return 2
  return 3
}

/** Nearer the top of the Workspace first, and alphabetical between equals. */
function byDepth(one: string, other: string): number {
  const depth = one.split('/').length - other.split('/').length
  return depth === 0 ? one.localeCompare(other) : depth
}
