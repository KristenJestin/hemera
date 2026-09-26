import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'

/**
 * What the turn is doing right now, at the end of the thread (design D17-04, D17-13).
 *
 * A turn takes minutes and writes nothing for most of them. The thread carried a thought here, a
 * tool call there, and between them a column that had simply stopped: a reader watching an agent
 * work could not tell a turn that was thinking from a turn that had died. So one row stands at
 * the end of the thread for as long as the turn runs, it says which of the four things is
 * happening, and it goes when the turn does.
 *
 * It stands where the agent's own content stands — at the start of the line, not at the end of
 * it — and it lives on the row the usage meter is on, above the composer: what the turn is doing
 * on the left, what it has spent on the right (trial of 22 September 2026). It was the last
 * entry of the thread, right-aligned under the reader's own bubble, which said the wrong two
 * things at once: that the agent was answering from the reader's side of the column, and that
 * the thread had grown by a block every time the turn changed its mind.
 *
 * It is drawn for the whole of a turn — thinking, running a tool, writing — and it stays once the
 * turn is over, as a quiet line that says how it ended: "Done in 12 s", "Stopped", "Failed"
 * (trial of 22 September 2026). A row that vanished the moment the turn ended left the reader
 * wondering whether it had ended or died; the quiet line answers that, and goes when the next
 * message is sent. The page is what knows which of the two to draw.
 *
 * Collapsed it is one line: "Thinking…", "Running cat recap.md", "Waiting for your permission",
 * "Writing…". The chevron opens the thought that is arriving *now*, and only that one: the
 * thoughts already in the thread are blocks of their own and stay where they are, because a row
 * that swallowed them would be a second copy of the turn.
 *
 * A row with nothing to open does not open at all. Waiting for a permission is not a thought,
 * and a chevron over an empty body is a chevron that lies.
 *
 * It is drawn in one tree whatever it has to open: the fold is the same element from the first
 * render on, and a thought arriving while the reader is looking at the row arrives inside it
 * rather than in a second fold built beside the first.
 *
 * No dot beside the indicator: the indicator already says that something is in flight, and two
 * marks of the same fact on one line is one of them saying nothing. The indicator is the design
 * system's own, which stands still under reduced motion — nothing here writes a movement of its
 * own. A turn that has ended has nothing in flight, so it takes the dot in the indicator's place:
 * the mark the thread already uses for where a piece of work stands, settled and still.
 */

/**
 * The row: at the start of the line, and as wide as what it holds rather than as the column.
 *
 * It is pulled back by the padding the fold carries on its own line, so what is read starts on
 * the column's edge whether or not there is a thought to open — the fold is one tree, and a row
 * that was inset by four pixels only when it had nothing to say is a row that moves.
 */
const ROW = '-ml-1 flex min-w-0 items-center'

/** The fold itself, which is as wide as what it holds rather than as wide as the thread. */
const FOLD = 'w-auto'

/** The line that is read: the dot, the indicator, and what is being done. */
const SUMMARY = 'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'

const LABEL = 'truncate'

/** Stop and the trace, beside a line that has heard nothing for too long. */
const ACTIONS = 'flex shrink-0 items-center gap-1'

/** The thought arriving now, under the line that announced it. */
const THOUGHT = 'max-w-3xl text-sm whitespace-pre-wrap text-muted-foreground'

/**
 * The four things a turn is doing between one block of the thread and the next, and the three
 * ways it can have ended.
 */
export type ActivityState =
  | 'thinking'
  | 'running'
  | 'waiting'
  | 'streaming'
  | 'done'
  | 'stopped'
  | 'failed'

/** What each of them is called, before the detail the caller may add to one of them. */
const SAID: Record<ActivityState, string> = {
  thinking: 'Thinking…',
  running: 'Running',
  waiting: 'Waiting for your permission',
  streaming: 'Writing…',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
}

/** The dot an ended turn is drawn with; a turn still in flight draws the indicator instead. */
const ENDED: Partial<Record<ActivityState, StatusTone>> = {
  done: 'success',
  stopped: 'cancelled',
  failed: 'failure',
}

/** How long a turn took, in the words a reader glances at: `12 s`, `2 min 5 s`. */
function lasted(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000))
  if (seconds < 60) return `${String(seconds)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(rest)} s`
}

/**
 * How long a running turn may hear nothing before its line says so (issue #131).
 *
 * An agent between two blocks says nothing for a while, and that is thinking; half a minute of
 * nothing at all is worth saying, because a line that reads "Thinking…" for ten minutes while
 * the provider refused the request is a line that lies by omission.
 */
export const QUIET_AFTER_MS = 30_000

/**
 * How long before the line offers what can be done about it: stop the turn, or read the trace of
 * what was said to find out why nothing comes.
 */
export const STUCK_AFTER_MS = 120_000

/** The states in which a turn waits on its agent, whose silence is the agent's. */
const LISTENING: readonly ActivityState[] = ['thinking', 'running', 'streaming']

/**
 * How long nothing has come, in the words a reader glances at: seconds under a minute, counted by
 * fives so the line does not tick, and whole minutes after.
 */
function unheard(quietMs: number): string {
  const seconds = Math.floor(quietMs / 1000)
  if (seconds < 60) return `${String(seconds - (seconds % 5))} s`
  return `${String(Math.floor(seconds / 60))} min`
}

/** The line the row reads, from its state and whatever the caller gave it to name. */
function sayOf(state: ActivityState, detail?: string, elapsedMs?: number): string {
  if (state === 'running' && detail !== undefined) return `${SAID[state]} ${detail}`
  if (state === 'done' && elapsedMs !== undefined) return `${SAID[state]} in ${lasted(elapsedMs)}`
  return SAID[state]
}

/** How long a turn in this state has heard nothing, when that is long enough to say. */
function quietOf(state: ActivityState, quietMs: number | undefined): number | null {
  if (quietMs === undefined || !LISTENING.includes(state) || quietMs < QUIET_AFTER_MS) return null
  return quietMs
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
  /**
   * How long the turn took, from the message that started it to the entry that ended it.
   *
   * Only `done` says it: a turn that was stopped or failed took however long it took, and the
   * figure is not what the reader wants from it.
   */
  elapsedMs?: number | undefined
  /**
   * How long the running turn has heard nothing from its agent (issue #131).
   *
   * Past `QUIET_AFTER_MS` the line says it — "Thinking… · 2 min, no answer yet" — and past
   * `STUCK_AFTER_MS` it offers Stop and the trace beside it. A turn waiting on the reader's
   * permission is not its agent being silent, and says nothing of the sort.
   */
  quietMs?: number | undefined
  /** Stops the turn, offered once it has heard nothing for `STUCK_AFTER_MS`. */
  onStop?: (() => void) | undefined
  /** Opens the Session's trace, offered beside Stop when there is one to open. */
  onOpenTrace?: (() => void) | undefined
  /** Where the row sits; never how it looks. */
  className?: string | undefined
}

export function ActivityRow({
  state,
  detail,
  thought,
  elapsedMs,
  quietMs,
  onStop,
  onOpenTrace,
  className,
}: ActivityRowProps): ReactNode {
  const [open, setOpen] = useState(false)
  const quiet = quietOf(state, quietMs)
  const doing = sayOf(state, detail, elapsedMs)
  const said = quiet === null ? doing : `${doing} · ${unheard(quiet)}, no answer yet`
  const stuck = quiet !== null && quiet >= STUCK_AFTER_MS
  const ended = ENDED[state]
  const line = (
    <span className={SUMMARY}>
      {ended === undefined ? (
        <Loading size="sm" label={said} />
      ) : (
        <StatusDot status={ended} size="sm" />
      )}
      <span className={LABEL}>{said}</span>
    </span>
  )

  return (
    <div className={cn(ROW, className)}>
      <Disclosure className={FOLD} open={open} onOpenChange={setOpen} summary={line}>
        {thought === undefined ? undefined : <p className={THOUGHT}>{thought}</p>}
      </Disclosure>
      {stuck && (onStop !== undefined || onOpenTrace !== undefined) ? (
        // Beside the line and outside the fold: a button inside the summary would be a press
        // that opened the thought as well.
        <span className={ACTIONS}>
          {onStop === undefined ? null : (
            <Button variant="link" size="sm" onClick={onStop}>
              Stop
            </Button>
          )}
          {onOpenTrace === undefined ? null : (
            <Button variant="link" size="sm" onClick={onOpenTrace}>
              Open the trace
            </Button>
          )}
        </span>
      ) : null}
    </div>
  )
}
