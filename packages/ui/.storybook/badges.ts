import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import type { Indexer } from 'storybook/internal/types'

/**
 * The two badges of the sidebar, computed from Git when Storybook indexes the stories rather than
 * written into each story file.
 *
 * A story file the branch created is `new`; one whose own file or whose component the branch
 * changed is `updated`. "The branch" is everything between the point it left the base and the
 * working tree, uncommitted and untracked files included, so a badge shows up as soon as the file
 * is saved. The base is `origin/feature/1.0`, the integration branch of 1.0, unless
 * `HEMERA_STORYBOOK_BASE` names another. Where Git cannot answer — no remote, a shallow clone, no Git at all — no badge
 * is shown and nothing fails: a badge is a help to the reader, never a reason for the catalogue
 * not to start.
 */
export type Badge = 'new' | 'updated'

export const DEFAULT_BASE = 'origin/feature/1.0'

/** What the base says about the files of the repository, every path as Git names it. */
export interface Comparison {
  /** The repository's root, which every path below is relative to. */
  root: string
  /** Every file the base holds, at the point the branch left it. */
  onBase: ReadonlySet<string>
  /** Every file the branch changed since it left the base, committed or not, untracked included. */
  changed: ReadonlySet<string>
}

/** The badge a story file wears, given what the base says; none when the base is unknown. */
export function badgeOf(
  comparison: Omit<Comparison, 'root'> | null,
  story: string,
  component: string | undefined,
): Badge | null {
  if (comparison === null) return null
  if (!comparison.onBase.has(story)) return 'new'
  if (comparison.changed.has(story)) return 'updated'
  if (component !== undefined && comparison.changed.has(component)) return 'updated'
  return null
}

/**
 * Asks Git what the branch checked out in `directory` did since it left `base`, or `null` when
 * Git cannot tell: the base missing, a history too shallow to find where the branch left it, or
 * no repository at all.
 */
export function compareWithBase(directory: string, base: string): Comparison | null {
  const gitIn = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    // Every command below runs from the root: `ls-tree` and `ls-files` name what they list
    // relative to the folder they are asked from, and the paths have to meet the diff's.
    const root = gitIn(directory, 'rev-parse', '--show-toplevel').trim()
    const git = (...args: string[]): string => gitIn(root, ...args)
    const files = (...args: string[]): Set<string> =>
      new Set(
        git(...args)
          .split('\0')
          .filter((path) => path !== ''),
      )
    const fork = git('merge-base', base, 'HEAD').trim()
    const changed = files('diff', '--name-only', '-z', fork)
    for (const path of files('ls-files', '--others', '--exclude-standard', '-z')) changed.add(path)
    return { root, onBase: files('ls-tree', '-r', '--name-only', '-z', fork), changed }
  } catch {
    return null
  }
}

/**
 * A file as Git names it: relative to the repository's root, with forward slashes.
 *
 * Both sides are resolved to the path the file system itself keeps first: Git answers with the
 * long form of a folder, and the path Storybook hands over may be a short Windows name
 * (`RUNNER~1`) or go through a link, which `relative` alone would read as another folder.
 */
function asGitPath(root: string, file: string): string {
  return relative(realpathSync.native(root), realpathSync.native(file)).replaceAll('\\', '/')
}

/**
 * The file a story's `meta.component` is imported from, as the indexer reported the import.
 *
 * Only an import of the package's own files is resolved; a component taken from a dependency is
 * nobody's change on this branch.
 */
function componentFile(story: string, imported: string | undefined): string | undefined {
  if (imported === undefined || !imported.startsWith('.')) return undefined
  const path = resolve(dirname(story), imported)
  return ['', '.tsx', '.ts', '/index.tsx', '/index.ts']
    .map((extension) => `${path}${extension}`)
    .find((candidate) => existsSync(candidate))
}

/**
 * How long one answer from Git is reused. Storybook indexes every story file in one burst when it
 * starts, and asking Git once per file would be seventy processes where one does; a file saved
 * later is indexed again after the answer went stale, so its badge follows the edit.
 */
const REUSED_FOR_MS = 5_000

/**
 * The indexers Storybook already has, each handing out the badge of the file it indexes on top of
 * the tags the file declares itself.
 */
export function withBadges(
  indexers: Indexer[],
  base: string = process.env['HEMERA_STORYBOOK_BASE'] ?? DEFAULT_BASE,
): Indexer[] {
  let asked: { at: number; comparison: Comparison | null } | undefined
  const comparisonFor = (directory: string): Comparison | null => {
    if (asked === undefined || Date.now() - asked.at > REUSED_FOR_MS) {
      asked = { at: Date.now(), comparison: compareWithBase(directory, base) }
    }
    return asked.comparison
  }
  return indexers.map((indexer) => ({
    ...indexer,
    createIndex: async (fileName, options) => {
      const entries = await indexer.createIndex(fileName, options)
      const comparison = comparisonFor(dirname(fileName))
      if (comparison === null) return entries
      for (const entry of entries) {
        const component = componentFile(fileName, entry.rawComponentPath)
        const badge = badgeOf(
          comparison,
          asGitPath(comparison.root, fileName),
          component === undefined ? undefined : asGitPath(comparison.root, component),
        )
        if (badge !== null) entry.tags = [...(entry.tags ?? []), badge]
      }
      return entries
    },
  }))
}
