import { useState } from 'react'
import type { ReactNode } from 'react'

import type { ConfigOption, Session, SessionEntry } from '@hemera/ipc'
import {
  BlockedBanner,
  Composer,
  MessageDaySeparator,
  MessageGroup,
  MessageScroller,
  MessageText,
  SessionEmpty,
  SessionHeader,
  SessionSideColumn,
  type MessageLine,
  type MessageState,
  type PermissionOption,
  type ScrollerEntry,
} from '@hemera/ui'

import type { AgentSessionState } from '../agent-store.ts'
import { controlsOf } from '../agent-controls.tsx'
import { drawEntry, planOf, touchedOf, waitingOf } from '../agent-blocks.tsx'
import { whenOf } from '../journal-lines.ts'

/**
 * The page of a Session: what it is called, what was said in it, and the way to say more
 * (design D4b-02, D4b-08, D5-12, D5-14, D5-17).
 *
 * It is an adapter and nothing else: the engine holds the Session, its thread and its agent, and
 * every surface here comes from `@hemera/ui`, where it was drawn and accepted on fixtures before
 * a database existed. Nothing is decided here — not what a title may be, not which block draws an
 * entry, not whether a message landed.
 *
 * The thread is what the engine read back when the Session was opened, and what has arrived since:
 * an entry the agent is still writing comes again with more of it rather than as a second entry,
 * so the two are one list, read in the order it was written. A Session with no agent is one the
 * user writes into and nothing answers — which is a Session, not an empty one, and the foot is
 * where the difference is drawn.
 */

/** A run of messages written on the same day, which is how the thread is separated. */
interface Run {
  day: string
  lines: MessageLine[]
  /** Its first line as plain text, which is what the scroller remembers the run by. */
  mark: string
  /** Whether the agent said something in the middle of it, which starts a new run after it. */
  broken: boolean
}

/**
 * The thread as one list: what was read back, with what has arrived since in its place.
 *
 * An entry written again — the same identifier, with more of it — takes the place of the one the
 * read-back held, and an entry nobody had seen yet goes at the end, where it was written.
 */
function together(read: readonly SessionEntry[], live: readonly SessionEntry[]): SessionEntry[] {
  const since = new Map(live.map((entry) => [entry.id, entry]))
  const known = new Set(read.map((entry) => entry.id))
  return [
    ...read.map((entry) => since.get(entry.id) ?? entry),
    ...live.filter((entry) => !known.has(entry.id)),
  ]
}

/** `4 messages`, and the singular for the one that has just been written. */
function countOf(entries: number): string {
  return entries === 1 ? '1 message' : `${String(entries)} messages`
}

/** The line under a Session's title: when it was made, what runs it, and how much is in it. */
function metaOf(session: Session, entries: number, now: number): string {
  const agent = session.provider === null ? 'no agent' : session.provider
  return `created ${whenOf(session.createdAt, now)} · ${agent} · ${countOf(entries)}`
}

/** What the last act of a thread was refused with, when the engine refused it. */
export interface SessionPageProps {
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
  /** What the engine has pushed for this Session since it was opened. */
  agent: AgentSessionState
  /** What the agent of this Session offers, as its own handshake answered. */
  options: readonly ConfigOption[]
  onWrite: (body: string) => Promise<string | null>
  /**
   * Says something to the agent, which writes the user's own message itself.
   *
   * A Session with an agent does not go through `onWrite`: the engine writes the message as part
   * of the prompt, and writing it here as well would put the same sentence in the thread twice.
   * Nothing is awaited — a turn lasts as long as it lasts, and what the composer's own state
   * tracks is the write rather than the answer (D5-12).
   */
  onSay: (text: string) => void
  /** Cancels the running turn, when there is one. */
  onStop: () => void
  /** Answers the permission the agent is waiting on. */
  onDecide: (option: PermissionOption) => void
  /** Sets one of the agent's own options for the turn to come. */
  onChooseOption: (optionId: string, value: string) => void
  onRename: (title: string) => void
  onStartEditing: () => void
  onCancelEditing: () => void
  onArchive: () => void
  onSearchFiles: (query: string) => Promise<string[]>
  onPickFiles: () => Promise<string[]>
  /** Opens one of the files the turn touched, when the page around this one can open one. */
  onOpenFile?: ((path: string) => void) | undefined
}

export function SessionPage({
  projectName,
  session,
  entries,
  loaded,
  now,
  editing,
  refusal,
  agent,
  options,
  onWrite,
  onSay,
  onStop,
  onDecide,
  onChooseOption,
  onRename,
  onStartEditing,
  onCancelEditing,
  onArchive,
  onSearchFiles,
  onPickFiles,
  onOpenFile,
}: SessionPageProps): ReactNode {
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
    if (session.provider !== null) {
      onSay(body)
      setWrites('saved')
      return null
    }
    const said = await onWrite(body)
    setWrites(said === null ? 'saved' : 'failed')
    setFailure(said ?? undefined)
    return said
  }

  const thread = together(entries, agent.entries)
  const waiting = waitingOf(thread)

  /**
   * The user's messages cut into the days they were written on.
   *
   * A day is named once, over the first message of that day: two messages written in the same
   * sitting are one run, and a day the user came back to later is another.
   */
  const runs: Run[] = []
  for (const entry of thread) {
    if (entry.role !== 'user' || entry.kind !== 'message') {
      // Anything the agent reported ends the run of what the user wrote.
      const open = runs.at(-1)
      if (open !== undefined) open.broken = true
      continue
    }
    const day = whenOf(entry.createdAt, now)
    const line: MessageLine = { id: entry.id, body: <MessageText body={entry.body} /> }
    const last = runs.at(-1)
    if (last === undefined || last.day !== day || last.broken) {
      runs.push({ day, lines: [line], mark: entry.body, broken: false })
      continue
    }
    last.lines.push(line)
  }

  /**
   * The thread in order, which is the user's runs and the agent's blocks in one list.
   *
   * Walking the entries a second time rather than the runs alone: a run belongs where its first
   * line was written, and what the agent reported stands between two of them.
   */
  const byLine = new Map(runs.map((run, index) => [run.lines[0]?.id ?? '', index]))
  const byEntry = new Map<string, ScrollerEntry>()
  for (let at = 0; at < thread.length; at += 1) {
    const entry = thread[at]
    if (entry === undefined) continue
    const next = thread[at + 1]
    const block = drawEntry(entry, {
      now,
      nextAt: next === undefined ? null : next.createdAt,
      onDecide,
    })
    if (block !== null) byEntry.set(entry.id, { id: entry.id, mark: entry.body, content: block })
  }

  const scroller: ScrollerEntry[] = []
  /** The day last named over the thread, so a run that follows the agent's words repeats nothing. */
  let named: string | null = null
  for (const entry of thread) {
    const run = byLine.get(entry.id)
    if (run !== undefined) {
      const held = runs[run]
      const last = run === runs.length - 1
      const day = held?.day ?? ''
      if (day !== named) {
        named = day
        scroller.push({
          id: `day-${day}`,
          day: true as const,
          content: <MessageDaySeparator day={day} />,
        })
      }
      scroller.push({
        id: `run-${String(run)}`,
        mark: held?.mark ?? '',
        content: (
          <MessageGroup
            author="user"
            name="You"
            lines={held?.lines ?? []}
            state={last ? writes : undefined}
            error={last ? failure : undefined}
            onRetry={
              attempted === null
                ? undefined
                : () => {
                    void write(attempted)
                  }
            }
          />
        ),
      })
      continue
    }
    // The agent said something: what the user writes next opens a run of its own, and the day
    // is named again over it rather than over a message that has moved down the thread.
    const held = runs.at(-1)
    if (held !== undefined) held.broken = true
    const block = byEntry.get(entry.id)
    if (block !== undefined) scroller.push(block)
  }

  // What the agent is on is the agent's own answer, read back after every change: this page
  // draws what it was told and never a value it remembers (D5-13).
  const controls = controlsOf(
    session.provider ?? '',
    options,
    (option) => option.current ?? '',
    onChooseOption,
  )

  // What the column beside the thread would hold: the plan the agent last published and the files
  // the turn has touched. Both are states rather than events, and they are read here because the
  // composer's own counter and the column are two readings of the same turn.
  const plan = planOf(thread)
  const touched = touchedOf(thread)

  return (
    /*
      One column, with the side column beside it (review of #40, defect 2). The header, the thread
      and the composer share one width and one left edge: a composer centred in the whole window
      while the thread was centred in what the column left over is what put them visibly out of
      line. The screen runs under the frame all the same, and the page's own scroll is the thread's.
    */
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-6 pb-4">
          <SessionHeader
            title={session.title}
            projectName={projectName}
            meta={metaOf(session, thread.length, now)}
            onRename={onRename}
            editing={editing}
            onStartEditing={onStartEditing}
            onCancelEditing={onCancelEditing}
            onArchive={onArchive}
            // A Session nothing was ever written in is one the user made by mistake far more often
            // than one they are done with, and putting it away is a press they would come to
            // regret: the archive is where threads go.
            archiveDisabled={thread.length === 0}
          />
          {refusal !== null && (
            <p role="alert" className="text-sm text-muted-foreground">
              {refusal}
            </p>
          )}
        </div>
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6">
          {thread.length === 0 ? (
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
            action={session.provider === null ? 'Write' : 'Send'}
            placeholder={
              session.provider === null
                ? 'Write to this Session…'
                : `Say something to ${session.provider}…`
            }
            onSend={write}
            controls={controls}
            running={agent.running}
            onStop={onStop}
            blocked={
              waiting === null ? undefined : (
                <BlockedBanner waiting="The agent is asking to go on." onStop={onStop} />
              )
            }
          />
        </div>
      </div>
      {/*
        The column stands beside the thread and not under it, and it is the width the thread gave
        up for it. A Session whose agent has sent neither a plan nor a file draws no column at all
        (review of #40, defect 3): `Plan 0 of 0` and `Files 0` take that width and say nothing with
        it. The box is the page's and the emptiness is the column's — there is no wrapper here, so
        a column that draws nothing leaves the width where it was.
      */}
      <SessionSideColumn plan={plan} files={touched} onSelectFile={onOpenFile} />
    </div>
  )
}
