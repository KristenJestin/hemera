import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Card } from '../components/card/card.tsx'
import { List, ListItem } from '../components/list/list.tsx'
import { IconArchive, IconRestore } from '../icons.ts'
import { type ArchivedSession, shownTitle } from './model.ts'

/**
 * The Sessions taken out of the sidebar, and the one way back (design D4b-06).
 *
 * Archiving is a field and nothing else: the thread, its order and its title are all still
 * there, which is why this page lists what each Session holds rather than what is left of it.
 * `Restore` is the row's own control and not the row: pressing a line here brings a Session
 * back to the sidebar, and a page where the whole row did that would restore one by mistake
 * every time somebody went to read a title.
 *
 * There is no deletion, on this page least of all. The scenario « Aucune suppression proposée »
 * is what this version answers with: archiving is the end of a Session's life, and it is undone
 * with one press.
 */
const PAGE = 'mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10'

const NOTE = 'text-sm text-muted-foreground'

export interface ArchivedSessionsProps {
  /** The archived Sessions, in whatever order the caller decided. */
  sessions: ArchivedSession[]
  onRestore: (id: string) => void
}

/** What each row says under the title: when it was archived, and what it kept. */
function said(session: ArchivedSession): string {
  const archived = `archived ${session.archivedAt}`
  if (session.messages === undefined) return archived
  return `${archived} · ${session.messages} ${session.messages === 1 ? 'message' : 'messages'}`
}

export function ArchivedSessions({ sessions, onRestore }: ArchivedSessionsProps): ReactNode {
  return (
    <div className={PAGE}>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium">Archived Sessions</h1>
        <p className={NOTE}>Out of the sidebar, kept whole. Restore one to work in it again.</p>
      </div>
      <Card>
        {sessions.length === 0 ? (
          <p className={NOTE}>No archived Session. Nothing is ever deleted.</p>
        ) : (
          <List label="Archived Sessions">
            {sessions.map((session) => (
              <ListItem
                key={session.id}
                icon={<IconArchive size="sm" />}
                title={shownTitle(session.title)}
                description={said(session)}
                trailing={
                  <Button variant="secondary" size="sm" onClick={() => onRestore(session.id)}>
                    <IconRestore size="sm" />
                    Restore
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </Card>
    </div>
  )
}
