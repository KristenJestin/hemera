import { type ReactNode, useEffect, useState } from 'react'

import { SuggestInput, type SuggestInputProps, type Suggestion } from './suggest-input.tsx'

/**
 * A path typed under a base, offered one level at a time as it is typed (#109).
 *
 * The folder being typed in is everything up to the last slash: `src/co` lists `src`, and what
 * is offered is what `src` holds, written as the rest of the path — `src/components/`, with the
 * slash that a folder goes on under. Choosing a folder leaves the list open on what it holds, so
 * a path is walked down with the keyboard alone; choosing a file ends it.
 *
 * Nothing here reads a disk. Whoever can list a folder is handed the base, the folder under it
 * and the kinds of entry wanted, and answers the entries of that one folder. `..` is never
 * offered, and a folder that is absolute or climbs is not even asked for: the base is the top.
 * What the typed path is worth — whether it is refused, and why — is the caller's to say, in
 * `error`, like any other field's.
 */

/** What an entry of a folder may be. */
export type PathKind = 'folder' | 'file'

/** One entry of a folder, by its name alone. */
export interface PathEntry {
  name: string
  kind: PathKind
}

/** What a listing is asked: a folder under a base, and which of its entries to answer. */
export interface PathListing {
  /** The base the path is under, as the caller names it: null for its own root. */
  base: string | null
  /** The folder under the base, as typed up to its last slash; '' for the base itself. */
  relative: string
  kinds: readonly PathKind[]
}

export interface PathInputProps extends Omit<
  SuggestInputProps,
  'suggestions' | 'staysOpen' | 'listLabel'
> {
  /** The base the path is under, handed to the listing as it is; null for the caller's root. */
  base: string | null
  /** What may be offered: folders, or files and folders. */
  kinds: readonly PathKind[]
  /** Answers the entries of one folder under the base; a refusal offers nothing. */
  onList: (listing: PathListing) => Promise<readonly PathEntry[]>
}

/** The folder being typed in: everything up to the last slash, either slash. */
function folderOf(typed: string): string {
  return typed.slice(0, Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\')) + 1)
}

/** Whether a folder is not one to ask for: written absolute, or climbing above the base. */
function aboveTheBase(folder: string): boolean {
  return (
    /^([\\/]|[a-zA-Z]:)/.test(folder) || folder.split(/[\\/]/).some((segment) => segment === '..')
  )
}

export function PathInput({
  base,
  kinds,
  onList,
  value = '',
  emptyLabel,
  ...rest
}: PathInputProps): ReactNode {
  const folder = folderOf(value)
  const [offered, setOffered] = useState<Suggestion[]>([])
  const wanted = kinds.join(',')

  // One folder listed at a time, and only the answer for the folder still being typed in is kept:
  // a slow answer for a folder the path has already left is dropped.
  useEffect(() => {
    if (aboveTheBase(folder)) {
      setOffered([])
      return
    }
    let current = true
    onList({ base, relative: folder.replace(/[\\/]$/, ''), kinds })
      .then((entries) => {
        if (!current) return
        setOffered(
          entries.map((entry) => ({
            value: `${folder}${entry.name}${entry.kind === 'folder' ? '/' : ''}`,
          })),
        )
      })
      .catch(() => {
        if (current) setOffered([])
      })
    return () => {
      current = false
    }
  }, [base, folder, wanted])

  const folders = !kinds.includes('file')
  return (
    <SuggestInput
      {...rest}
      value={value}
      suggestions={offered}
      listLabel={folders ? 'Folders' : 'Files and folders'}
      emptyLabel={emptyLabel ?? (folders ? 'No folder there matches.' : 'Nothing there matches.')}
      staysOpen={(chosen) => chosen.endsWith('/')}
    />
  )
}
