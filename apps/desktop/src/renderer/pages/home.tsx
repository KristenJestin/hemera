import { useState } from 'react'
import type { ReactNode } from 'react'

import {
  ActivityFrame,
  Composer,
  EmptyProject,
  Greeting,
  SessionsFrame,
  type HomeSession,
  type JournalLine,
} from '@hemera/ui'

/**
 * The Home of the active Project (design D4-07, D4b-02).
 *
 * The page is the assembly: the greeting, the composer, the last Sessions of the Project, the
 * last entries of the Journal. None of that is a component, because none of it is drawn anywhere
 * else.
 *
 * What is written and what is attached live here for as long as the page does. Sending is the
 * caller's: from here a message makes a Session, which is what the greeting promises — "it
 * becomes a Session the moment you send" — and what happens when the engine refuses is the
 * caller's to say.
 */
const PAGE = 'mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10'

/** How many entries the Activity frame carries, which the prototype settled at four. */
const ACTIVITY_ENTRIES = 4

export function HomePage({
  projectName,
  sessions,
  entries,
  onOpenSession,
  onOpenAllSessions,
  onOpenJournal,
  onSearchFiles,
  onPickFiles,
  onSend,
}: {
  projectName: string
  /** The last Sessions of this Project, most recently written first. */
  sessions: HomeSession[]
  entries: JournalLine[]
  onOpenSession: (id: string) => void
  onOpenAllSessions: () => void
  onOpenJournal: () => void
  onSearchFiles: (query: string) => Promise<string[]>
  onPickFiles: () => Promise<string[]>
  onSend: (text: string) => Promise<string | null>
}): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])

  return (
    <div className={PAGE}>
      <Greeting
        projectName={projectName}
        note="Write freely. It becomes a Session the moment you send."
      />
      <Composer
        value={value}
        onValueChange={setValue}
        files={files}
        onFilesChange={setFiles}
        onSearchFiles={onSearchFiles}
        onPickFiles={onPickFiles}
        onSend={onSend}
      />
      {sessions.length === 0 ? (
        <EmptyProject projectName={projectName} onOpenJournal={onOpenJournal} />
      ) : (
        <SessionsFrame
          sessions={sessions}
          onOpenSession={onOpenSession}
          onOpenAll={onOpenAllSessions}
        />
      )}
      <ActivityFrame entries={entries.slice(0, ACTIVITY_ENTRIES)} onOpenJournal={onOpenJournal} />
    </div>
  )
}
