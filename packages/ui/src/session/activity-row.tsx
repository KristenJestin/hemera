import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { StatusDot } from '../components/status-dot/status-dot.tsx'
import { LiveMarker } from '../message/message.tsx'

/**
 * What the turn is doing right now, at the end of the thread (design D17-04, D17-13).
 *
 * A turn takes minutes and writes nothing for most of them. The thread carried a thought here, a
 * tool call there, and between them a column that had simply stopped: a reader watching an agent
 * work could not tell a turn that was thinking from a turn that had died. So one row stands at
 * the end of the thread for as long as the turn runs, it says which of the four things is
 * happening, and it goes when the turn does.
 *
 * It is built on the live marker the thread already had. That marker said "you are at the latest
 * message" and nothing more, which is true of a thread nobody is answering; this is the same
 * place, the same line and the same measure, saying what is being written into it — with the dot
 * that carries the state instead of the green one that means "nothing is coming".
 *
 * Collapsed it is one line: "Thinking…", "Running cat recap.md", "Waiting for your permission",
 * "Writing…". The chevron opens the thought that is arriving *now*, and only that one: the
 * thoughts already in the thread are blocks of their own and stay where they are, because a row
 * that swallowed them would be a second copy of the turn.
 *
 * A row with nothing to open does not open at all, and is then the marker itself. Waiting for a
 * permission is not a thought, and a chevron over an empty body is a chevron that lies.
 *
 * The indicator is the design system's own, which stands still under reduced motion, and the dot
 * is the shared one, where only `running` breathes: nothing here writes a movement of its own.
 */

/** The row when it folds: the same measure and the same end of the line as the marker. */
const ROW = 'flex w-full min-w-0 justify-end px-10'

/** The fold itself, which is as wide as what it holds rather than as wide as the thread. */
const FOLD = 'w-auto'

/** The line that is read: the dot, the indicator, and what is being done. */
const SUMMARY = 'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'

const LABEL = 'truncate'

/** The thought arriving now, under the line that announced it. */
const THOUGHT = 'max-w-3xl text-sm whitespace-pre-wrap text-muted-foreground'

/** The four things a turn is doing between one block of the thread and the next. */
export type ActivityState = 'thinking' | 'running' | 'waiting' | 'streaming'

/** What each of them is called, before the detail the caller may add to one of them. */
const SAID: Record<ActivityState, string> = {
  thinking: 'Thinking…',
  running: 'Running',
  waiting: 'Waiting for your permission',
  streaming: 'Writing…',
}

export interface ActivityRowProps {
  /** What the turn is doing, as the engine reports it. */
  state: ActivityState
  /**
   * What it is doing it to: the title of the tool call, `cat recap.md`.
   *
   * Only `running` has one to name. "Running" on its own is a row saying a command is going
   * without saying which, and the reader watching a turn is watching for exactly that.
   */
  detail?: string | undefined
  /** The thought arriving now, which is what the chevron opens. */
  thought?: string | undefined
  /** Where the row sits; never how it looks. */
  className?: string | undefined
}

export function ActivityRow({ state, detail, thought, className }: ActivityRowProps): ReactNode {
  const [open, setOpen] = useState(false)
  const said =
    state === 'running' && detail !== undefined ? `${SAID[state]} ${detail}` : SAID[state]
  // Waiting is the one state where nothing is moving: the turn has stopped and is asking. The
  // other three are work in flight, which is what the warning dot and the indicator say.
  const dot = <StatusDot status={state === 'waiting' ? 'pending' : 'running'} size="sm" />

  if (thought === undefined) {
    return (
      <div className={className}>
        <LiveMarker mark={dot}>
          <Loading size="sm" label={said} />
          <span className={LABEL}>{said}</span>
        </LiveMarker>
      </div>
    )
  }
  return (
    <div className={cn(ROW, className)}>
      <Disclosure
        className={FOLD}
        open={open}
        onOpenChange={setOpen}
        summary={
          <span className={SUMMARY}>
            {dot}
            <Loading size="sm" label={said} />
            <span className={LABEL}>{said}</span>
          </span>
        }
      >
        <p className={THOUGHT}>{thought}</p>
      </Disclosure>
    </div>
  )
}
