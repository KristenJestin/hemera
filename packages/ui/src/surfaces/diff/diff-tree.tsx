import type { FileTreeRowDecoration, GitStatus, GitStatusEntry } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'

import { Input } from '../../components/field/field.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { IconSearch } from '../../icons.ts'
import type { DiffRepository, GitLetter } from './diff-types.ts'

/**
 * The left of the diff view: what changed, one root per repository of the Workspace, drawn by
 * `@pierre/trees` (virtualised, keyboard-driven, searched from the field above it).
 *
 * A file wears Git's letter in the colour of its change, and the lines it adds and removes; a
 * repository's root wears its totals, and the warning dot when it was changed outside Hemera.
 * Two files of the same name in two repositories stand under two roots, so they are never read
 * as one. A file chosen sends the diff to it.
 */

const GIT: Record<GitLetter, GitStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  // The tree has no type change of its own: it reads as modified, and its letter is written.
  T: 'modified',
}

/** The colours of the counts: the design system's roles, read inside the tree's shadow root. */
const ADDED = 'var(--success-muted-foreground)'
const REMOVED = 'var(--destructive-muted-foreground)'
const OUTSIDE = 'var(--warning-muted-foreground)'
const TYPE = 'var(--info-muted-foreground)'

/** The id of a file in the tree and in the diff: its repository, then its own path. */
export const idOf = (repository: string, path: string): string => `${repository}/${path}`

function statuses(repositories: readonly DiffRepository[]): GitStatusEntry[] {
  return repositories.flatMap((repository) =>
    repository.files.map((file) => ({
      path: idOf(repository.name, file.path),
      status: file.untracked === true ? 'untracked' : GIT[file.letter],
    })),
  )
}

interface Counted {
  added: number
  removed: number
  binary: boolean
  letter?: GitLetter | undefined
  outside?: boolean | undefined
}

/** `+12 −3`, `bin` for a file with no lines, the letter T, and the dot of a change outside. */
function decoration({ added, removed, binary, letter, outside }: Counted): FileTreeRowDecoration {
  const parts: { text: string; color?: string }[] = []
  if (outside === true) parts.push({ text: '●', color: OUTSIDE })
  if (letter === 'T') parts.push({ text: 'T', color: TYPE })
  if (binary) parts.push({ text: 'bin' })
  if (added > 0) parts.push({ text: `+${String(added)}`, color: ADDED })
  if (removed > 0) parts.push({ text: `−${String(removed)}`, color: REMOVED })
  const spaced = parts.flatMap((part, index) => (index === 0 ? [part] : [{ text: ' ' }, part]))
  const title = [
    outside === true ? 'Changed outside Hemera' : null,
    letter === 'T' ? 'Type changed' : null,
    binary ? 'Binary' : null,
    `${String(added)} added, ${String(removed)} removed`,
  ]
    .filter((one) => one !== null)
    .join(' · ')
  return { text: spaced.map((part) => part.text).join(''), parts: spaced, title }
}

export interface ChangesTreeProps {
  repositories: readonly DiffRepository[]
  loading?: boolean | undefined
  /** A file was chosen: its id, which is also the id of its diff. */
  onFile: (id: string) => void
}

/** The tree while the changes are read: rows of a known shape, a root and its files. */
function TreeSkeleton(): ReactNode {
  return (
    <ul aria-label="Changed files" aria-busy="true" className="flex flex-col gap-1 px-3 py-2">
      {[
        'api',
        'src/billing/export.ts',
        'src/billing/export.query.ts',
        'web',
        'export-button.tsx',
      ].map((name) => (
        <li key={name} className="flex h-control-sm items-center text-sm">
          <Skeleton>{name}</Skeleton>
        </li>
      ))}
    </ul>
  )
}

export function ChangesTree({
  repositories,
  loading = false,
  onFile,
}: ChangesTreeProps): ReactNode {
  const paths = useMemo(
    () =>
      repositories.flatMap((repository) =>
        repository.files.map((file) => idOf(repository.name, file.path)),
      ),
    [repositories],
  )
  const files = useMemo(() => {
    const index = new Map<string, Counted>()
    for (const repository of repositories) {
      let added = 0
      let removed = 0
      for (const file of repository.files) {
        added += file.added
        removed += file.removed
        index.set(idOf(repository.name, file.path), {
          added: file.added,
          removed: file.removed,
          binary: file.binary !== undefined,
          letter: file.letter,
          outside: file.outside,
        })
      }
      index.set(repository.name, { added, removed, binary: false, outside: repository.outside })
    }
    return index
  }, [repositories])

  // The tree keeps the callbacks it was made with: they read the counts of now through this.
  const known = useRef(files)

  const { model } = useFileTree({
    paths,
    gitStatus: statuses(repositories),
    initialExpansion: 'open',
    flattenEmptyDirectories: true,
    fileTreeSearchMode: 'hide-non-matches',
    density: 'compact',
    onSelectionChange: (selected) => {
      const chosen = selected.at(-1)
      if (chosen !== undefined && known.current.has(chosen) && chosen.includes('/')) onFile(chosen)
    },
    renderRowDecoration: ({ item, row }) => {
      if (item.kind === 'file') {
        const counted = known.current.get(item.path)
        return counted === undefined ? null : decoration(counted)
      }
      if (row.depth !== 0) return null
      const counted = known.current.get(item.name)
      return counted === undefined ? null : decoration(counted)
    },
  })

  // The changes arrive while the user reads (a round writing): the tree takes the new paths and
  // letters in place, keeping what is open and chosen.
  useEffect(() => {
    known.current = files
    model.resetPaths(paths)
    model.setGitStatus(statuses(repositories))
  }, [model, paths, repositories, files])

  return (
    <nav aria-label="Changed files" className="flex min-h-0 flex-1 flex-col gap-1 pt-2">
      <div className="px-2">
        <Input
          label="Find a file"
          size="sm"
          icon={<IconSearch size="sm" />}
          onValueChange={(value) => {
            const words = value.trim()
            model.setSearch(words === '' ? null : words)
          }}
        />
      </div>
      {loading ? (
        <TreeSkeleton />
      ) : (
        <FileTree model={model} data-diff-tree="" className="min-h-0 flex-1" />
      )}
    </nav>
  )
}
