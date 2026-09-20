import { useState } from 'react'
import type { ReactNode } from 'react'

import type { Session, SessionEntry } from '@hemera/ipc'
import {
  Composer,
  MessageDaySeparator,
  MessageGroup,
  MessageScroller,
  MessageText,
  SessionEmpty,
  SessionHeader,
  type MessageLine,
  type MessageState,
  type ScrollerEntry,
} from '@hemera/ui'

import { whenOf } from '../journal-lines.ts'

/**
 * The page of a Session: what it is called, what was written in it, and the way to write more
 * (design D4b-02, D4b-08).
 *
 * It is an adapter and nothing else: the engine holds the Session, the thread and the write, and
 * every surface here comes from `@hemera/ui`, where it was drawn and accepted on fixtures before
 * a database existed. Nothing is decided here — not what a title may be, not whether a message
 * landed.
 *
 * The thread is the user's alone. No agent answers, nothing is simulated, and a Session with
 * nothing in it says so rather than showing an invented first line: a thread with a fake reply in
 * it is the one thing this lot forbids the page to draw.
 */

/** A run of messages written on the same day, which is how the thread is separated. */
interface Run {
  day: string
  lines: MessageLine[]
  /** Its first line as plain text, which is what the scroller remembers the run by. */
  mark: string
}

/** The thread, cut into the days it was written on. */
function runsOf(entries: SessionEntry[], now: number): Run[] {
  const runs: Run[] = []
  for (const entry of entries) {
    const day = whenOf(entry.createdAt, now)
    const line: MessageLine = { id: entry.id, body: <MessageText body={entry.body} /> }
    const last = runs.at(-1)
    if (last !== undefined && last.day === day) last.lines.push(line)
    else runs.push({ day, lines: [line], mark: entry.body })
  }
  return runs
}

/** `4 messages`, and the singular for the one that has just been written. */
function countOf(entries: number): string {
  return entries === 1 ? '1 message' : `${String(entries)} messages`
}

/**
 * Where the last message stands with the profile.
 *
 * The foot belongs to the last write and not to a line of its own: a message that failed is a
 * message that is not in the thread, so what says so is the state of the thread's last group —
 * and what the composer still holds, which is the message itself.
 */
export function SessionPage({
  projectName,
  session,
  entries,
  loaded,
  now,
  editing,
  refusal,
  onWrite,
  onRename,
  onStartEditing,
  onCancelEditing,
  onArchive,
  onSearchFiles,
  onPickFiles,
}: {
  projectName: string
  session: Session
  /** The thread, oldest first, as the engine read it back. */
  entries: SessionEntry[]
  /** Whether the thread has come back, so an empty thread is drawn only once it is known. */
  loaded: boolean
  /** What "today" means for this render, so the separators are read once. */
  now: number
  /** Whether the title is being typed into, which the page that called this one decides. */
  editing: boolean
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
  onWrite: (body: string) => Promise<string | null>
  onRename: (title: string) => void
  onStartEditing: () => void
  onCancelEditing: () => void
  onArchive: () => void
  onSearchFiles: (query: string) => Promise<string[]>
  onPickFiles: () => Promise<string[]>
}): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [writes, setWrites] = useState<MessageState>('saved')
  const [failure, setFailure] = useState<string | undefined>(undefined)
  /** What was last handed to the engine, so `Retry` has something to send again. */
  const [attempted, setAttempted] = useState<string | null>(null)

  const write = async (body: string): Promise<string | null> => {
    setAttempted(body)
    setFailure(undefined)
    setWrites('saving')
    const said = await onWrite(body)
    setWrites(said === null ? 'saved' : 'failed')
    setFailure(said ?? undefined)
    return said
  }

  const runs = runsOf(entries, now)
  const scroller: ScrollerEntry[] = runs.flatMap((run, index) => [
    { id: `day-${run.day}`, day: true as const, content: <MessageDaySeparator day={run.day} /> },
    {
      id: `run-${String(index)}`,
      mark: run.mark,
      content: (
        <MessageGroup
          author="user"
          name="You"
          lines={run.lines}
          state={index === runs.length - 1 ? writes : undefined}
          error={index === runs.length - 1 ? failure : undefined}
          onRetry={
            attempted === null
              ? undefined
              : () => {
                  void write(attempted)
                }
          }
        />
      ),
    },
  ])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-6 pb-4">
        <SessionHeader
          title={session.title}
          projectName={projectName}
          meta={`created ${whenOf(session.createdAt, now)} · ${countOf(entries.length)}`}
          onRename={onRename}
          editing={editing}
          onStartEditing={onStartEditing}
          onCancelEditing={onCancelEditing}
          onArchive={onArchive}
          // A Session nothing was ever written in is one the user made by mistake far more often
          // than one they are done with, and putting it away is a press they would come to
          // regret: the archive is where threads go.
          archiveDisabled={entries.length === 0}
        />
        {refusal !== null && (
          <p role="alert" className="text-sm text-muted-foreground">
            {refusal}
          </p>
        )}
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6">
        {entries.length === 0 ? (
          loaded ? (
            <SessionEmpty />
          ) : null
        ) : (
          <MessageScroller label="The thread of this Session" entries={scroller} />
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-4">
        <Composer
          value={value}
          onValueChange={setValue}
          files={files}
          onFilesChange={setFiles}
          onSearchFiles={onSearchFiles}
          onPickFiles={onPickFiles}
          variant="inline"
          action="Send"
          placeholder="Write to this Session…"
          onSend={write}
        />
      </div>
    </div>
  )
}
