import { useState } from 'react'
import type { ReactNode } from 'react'

import { ActivityFrame, Composer, EmptyProject, Greeting, type JournalLine } from '@hemera/ui'

/**
 * The Home of the active Project (design D4-07).
 *
 * The page is the assembly: the greeting, the composer, one thing worth a press, the last
 * entries of the Journal, and — in this lot, always — the fact that the Project has no Session
 * yet. None of that is a component, because none of it is drawn anywhere else.
 *
 * What is written and what is attached live here for as long as the page does, and sending is
 * refused by whoever owns the window: in this lot, by the ticket that brings Sessions.
 */
const PAGE = 'mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10'

/** How many entries the Activity frame carries, which the prototype settled at four. */
const ACTIVITY_ENTRIES = 4

export function HomePage({
  projectName,
  entries,
  onOpenJournal,
  onSearchFiles,
  onPickFiles,
  onSend,
}: {
  projectName: string
  entries: JournalLine[]
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
      <ActivityFrame entries={entries.slice(0, ACTIVITY_ENTRIES)} onOpenJournal={onOpenJournal} />
      <EmptyProject projectName={projectName} onOpenJournal={onOpenJournal} />
    </div>
  )
}
