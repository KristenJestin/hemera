import { useState } from 'react'
import type { ReactNode } from 'react'

import {
  ActivityFrame,
  Composer,
  Greeting,
  SessionsFrame,
  type JournalLine,
  type ShellSession,
} from '@hemera/ui'

/**
 * The Home of the active Project (design D4-07, D4b-07).
 *
 * The page is the assembly: the greeting, the composer, the Sessions to come back to, the last
 * entries of the Journal. None of that is a component, because none of it is drawn anywhere
 * else.
 *
 * What is written and what is attached live here for as long as the page does. Sending opens a
 * Session with the text as its first message — which is what the composer of the Home has
 * always been for — and the window goes to it; what comes back from `onSend` is a refusal or
 * nothing, and the composer shows the refusal under itself.
 */
const PAGE = 'mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10'

/** How many entries the Activity frame carries, which the prototype settled at four. */
const ACTIVITY_ENTRIES = 4

/** How many Sessions the frame offers to come back to, which the prototype settled at three. */
const SESSIONS_SHOWN = 3

export function HomePage({
  projectName,
  entries,
  sessions,
  onOpenJournal,
  onOpenSession,
  onResume,
  onSearchFiles,
  onPickFiles,
  onSend,
}: {
  projectName: string
  entries: JournalLine[]
  /** The Sessions of this Project, last written first. */
  sessions: ShellSession[]
  onOpenJournal: () => void
  onOpenSession: (id: string) => void
  onResume: () => void
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
        onSend={async (text) => {
          const refused = await onSend(text)
          // Cleared only once a Session holds it: a box emptied on a refusal is a message the
          // user has to type again (design D4b-02).
          if (refused === null) setValue('')
          return refused
        }}
      />
      <SessionsFrame
        sessions={sessions.slice(0, SESSIONS_SHOWN)}
        onOpen={onOpenSession}
        onResume={onResume}
      />
      <ActivityFrame entries={entries.slice(0, ACTIVITY_ENTRIES)} onOpenJournal={onOpenJournal} />
    </div>
  )
}
