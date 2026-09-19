import type { ReactNode } from 'react'

import { Journal, type JournalFilter, type JournalLine } from '@hemera/ui'

/**
 * The Journal of the active Project (design D4-05, D4-07).
 *
 * It composes and nothing else. The filters, the cursor and the page they produce belong to
 * the store that asks the engine: a page that narrowed a list it had already been given would
 * be a page deciding what the Journal holds, and a page that held the cursor would be a second
 * place where the walk down the Journal is written.
 */
export function JournalPage({
  projectName,
  entries,
  filter,
  byYou,
  onFilterChange,
  onByYouChange,
  hasEarlier,
  onLoadEarlier,
  loading,
}: {
  projectName: string
  /** The page as it stands, newest first, already read by whoever asked for it. */
  entries: JournalLine[]
  filter: JournalFilter
  byYou: boolean
  onFilterChange: (filter: JournalFilter) => void
  onByYouChange: (byYou: boolean) => void
  hasEarlier: boolean
  onLoadEarlier: () => void
  loading?: boolean
}): ReactNode {
  return (
    <Journal
      projectName={projectName}
      entries={entries}
      filter={filter}
      onFilterChange={onFilterChange}
      byYou={byYou}
      onByYouChange={onByYouChange}
      hasEarlier={hasEarlier}
      onLoadEarlier={onLoadEarlier}
      loading={loading}
    />
  )
}
