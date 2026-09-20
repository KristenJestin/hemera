import type { ReactNode } from 'react'

import type { Session } from '@hemera/ipc'
import { ArchivedSessions, type ArchivedSession } from '@hemera/ui'

import { dayOf } from '../when.ts'

/**
 * The Sessions of the active Project that have been put away (design D4b-06).
 *
 * It composes and nothing else. Archiving is a date and not a deletion, so every Session here
 * is whole and comes back with one press; there is no other action on this page, and there is
 * no deletion anywhere in this version.
 */
export function ArchivedPage({
  sessions,
  onRestore,
}: {
  /** The archived Sessions, as the engine answered them. */
  sessions: Session[]
  onRestore: (id: string) => void
}): ReactNode {
  const now = new Date()
  return (
    <ArchivedSessions
      sessions={sessions.map((session): ArchivedSession => ({
        id: session.id,
        title: session.title,
        archivedAt: dayOf(new Date(session.archivedAt ?? session.lastWrittenAt), now),
      }))}
      onRestore={onRestore}
    />
  )
}
