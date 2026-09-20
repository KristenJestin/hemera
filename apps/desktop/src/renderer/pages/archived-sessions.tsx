import type { ReactNode } from 'react'

import type { Session } from '@hemera/ipc'
import { ArchivedSessions } from '@hemera/ui'

import { whenOf } from '../journal-lines.ts'

/**
 * What was written, put away (design D4b-06).
 *
 * Archiving hides a Session from the list and changes nothing about it: the thread is still
 * there, its lines are still in the Journal, and nothing is ever deleted — a Session is restored,
 * never recovered. The page is the list of what is put away and the one way back, which is why it
 * is a page and not a corner of the sidebar: the sidebar is about work in progress, and this is
 * where work that was finished with goes to be found again.
 */

export function ArchivedSessionsPage({
  sessions,
  now,
  onRestore,
}: {
  /** What was archived, most recently put away first. */
  sessions: Session[]
  now: number
  onRestore: (id: string) => void
}): ReactNode {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <ArchivedSessions
        sessions={sessions.map((session) => ({
          id: session.id,
          title: session.title,
          archivedAt: whenOf(session.archivedAt ?? session.lastWrittenAt, now),
        }))}
        onRestore={onRestore}
      />
    </div>
  )
}
