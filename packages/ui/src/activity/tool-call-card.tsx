import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'
import {
  IconActivity,
  IconArrowUp,
  IconFileText,
  IconPencil,
  IconPlayerPlay,
  IconPlugConnected,
  IconSearch,
  IconSparkles,
  IconTrash,
} from '../icons.ts'
import { Disclosure } from './disclosure.tsx'

/**
 * One tool call of a turn: what the agent asked for, and what came back (design D17-04).
 *
 * A turn is mostly tool calls — reads, edits, commands — and the thread has to say what the
 * agent did without becoming a log. So a call is one line while it runs, one line when it is
 * done, and the body only when somebody asks: the parameters of a read are noise after the read
 * succeeded, and they are the whole story when it failed.
 *
 * Three states drive it, and the honest one is the middle. A call in flight is open, because a
 * call in flight is what the reader is waiting on, and the caller is the one who knows it is in
 * flight: `status` forces the fold open and the reader's own press cannot close it. A call that
 * failed is open too, and stays open — an error hidden behind a fold is an error nobody sees,
 * and a turn that went wrong is exactly when the details matter. Everything else folds.
 *
 * What the call is called is drawn in the reading colour of a caption and not of the thread: a
 * column of forty call titles in the colour of what the agent *said* is a column where the
 * answer and the plumbing weigh the same. A command keeps the mono face, because a command is
 * read character by character and not as words.
 *
 * Where it stands is a dot, and no longer a word. `Done` under `Done` under `Done` said nothing
 * the reader did not already know and stole the eye from the one line that had gone wrong; the
 * colour says the same five things in the width of a dot, and the word is kept for whatever
 * reads the page.
 *
 * A call with nothing behind it — no input, no output, no body of its own and no error — does
 * not fold at all: no chevron, no press, nothing to open. A control that opens onto nothing is
 * a control that lied about having something there.
 *
 * The file a call touched is a press at the end of the row rather than the title itself: the
 * title is the fold, a control cannot live inside a control, and a link inside a button is a
 * link the keyboard walks over and a screen reader never announces. The row still folds
 * anywhere the pointer lands on it.
 */

/** How a call is read at a glance: the kind is the mark, the status is the colour of the dot. */
const MARKS: Record<ToolKind, ReactNode> = {
  read: <IconFileText size="sm" aria-hidden="true" />,
  edit: <IconPencil size="sm" aria-hidden="true" />,
  delete: <IconTrash size="sm" aria-hidden="true" />,
  // A move is a displacement, and the catalogue has one arrow: what matters about a move is that
  // the file went somewhere, which is what an arrow says.
  move: <IconArrowUp size="sm" aria-hidden="true" />,
  search: <IconSearch size="sm" aria-hidden="true" />,
  execute: <IconPlayerPlay size="sm" aria-hidden="true" />,
  think: <IconSparkles size="sm" aria-hidden="true" />,
  fetch: <IconPlugConnected size="sm" aria-hidden="true" />,
  other: <IconActivity size="sm" aria-hidden="true" />,
}

/** Where a call stands, in the word the dot is announced by and the tone it is drawn in. */
const STATUS: Record<ToolStatus, { word: string; tone: StatusTone }> = {
  pending: { word: 'Queued', tone: 'pending' },
  in_progress: { word: 'Running', tone: 'running' },
  completed: { word: 'Done', tone: 'success' },
  failed: { word: 'Failed', tone: 'failure' },
  cancelled: { word: 'Cancelled', tone: 'cancelled' },
}

/** The row: the fold, and the file it touched at its end. */
const ROW = 'flex w-full min-w-0 items-center gap-2'

/** The block that folds takes the room that is left, so a long title shortens rather than runs on. */
const FOLDING = 'min-w-0 flex-1'

/** The line that is read: the mark of the kind, the title, and what the call is doing. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

/** A row that does not fold, drawn exactly where the one that folds would have been. */
const FLAT = 'flex w-full items-center gap-2 px-1 py-0.5 text-left text-sm'

const TITLE = 'truncate text-muted-foreground'

/** A command is read character by character, so it keeps the mono face it was written in. */
const COMMAND = 'truncate font-mono text-muted-foreground'

/** What the call returned, quieter than the line above it. */
const BODY = 'flex flex-col gap-2 text-sm text-muted-foreground'

/** A failure keeps the colour of a failure, in the body it opened for it. */
const ERROR = 'text-sm text-destructive-muted-foreground'

/** What a labelled half of the body is called: the quietest line the card has. */
const SECTION_HEAD = 'text-xs font-medium tracking-wide text-muted-foreground uppercase'

/**
 * What was sent, and what came back: the agent's own text, in the agent's own shape.
 *
 * Mono, because both of them are values rather than prose, and scrolling rather than growing: a
 * command that answered two thousand lines is a thread nobody can scroll past otherwise.
 */
const SECTION_BODY =
  'scroll-quiet max-h-40 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap'

/** What is drawn where an answer would be, when there was none. */
const NOTHING = 'italic'

/** The kind ACP names for a tool call, which is what says how it is read. */
export type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'other'

/**
 * Where a call is in its life, which is what says whether it folds.
 *
 * `cancelled` is a call that never finished because the turn it belonged to was stopped. It is
 * not a failure — nothing went wrong — and it is not done either, so it is neither of the two
 * the thread used to make it choose between.
 */
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

/** A file the call touched, and where in it the call landed. */
export interface ToolLocation {
  /** The absolute path, as the agent reported it. */
  path: string
  /** The line, when the agent named one. */
  line?: number | undefined
}

export interface ToolCallCardProps {
  /** What the call is called, as the agent wrote it. */
  title: string
  /** The kind, which decides the mark and nothing else. */
  kind: ToolKind
  /**
   * Where the call is in its life.
   *
   * It is the caller's, and the caller is the only one who knows: a call reported as running is
   * open, and one reported as failed is open and stays open.
   */
  status: ToolStatus
  /** The files the call touched, in the order the agent named them. */
  locations?: readonly ToolLocation[] | undefined
  /** What went wrong, when it did — the reason a failed call cannot be folded away. */
  error?: string | undefined
  /** What the agent sent: the parameters of the call, in its own words. */
  input?: ReactNode
  /** What came back. Absent beside an input, the section says so rather than vanishing. */
  output?: ReactNode
  /** Whether a reader who has not touched it finds it open. */
  defaultOpen?: boolean | undefined
  /** What a press on the file does: the reader goes there, which the card itself cannot do. */
  onOpenLocation?: ((location: ToolLocation) => void) | undefined
  /** What the call returned in a shape of its own: a diff, a console, handed over already drawn. */
  children?: ReactNode
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

/** The file a call touched, written as the reader would look it up. */
function at(location: ToolLocation): string {
  return location.line === undefined ? location.path : `${location.path}:${location.line}`
}

export function ToolCallCard({
  title,
  kind,
  status,
  locations,
  error,
  input,
  output,
  defaultOpen = false,
  onOpenLocation,
  children,
  className,
}: ToolCallCardProps): ReactNode {
  const { word, tone } = STATUS[status]
  // A call in flight, and a call that failed, are open whatever the reader last said. The two
  // are the states in which the body is the answer to the question the reader is asking.
  const forced = status === 'in_progress' || status === 'failed'
  const first = locations?.[0]
  const sectioned = input !== undefined || output !== undefined
  const opens = sectioned || children !== undefined || error !== undefined
  const summary = (
    <span className={SUMMARY}>
      <span className="flex shrink-0 text-muted-foreground">{MARKS[kind]}</span>
      <span className={kind === 'execute' ? COMMAND : TITLE}>{title}</span>
      <StatusDot status={tone} size="sm" label={word} />
    </span>
  )
  return (
    <div className={cn(ROW, className)}>
      {opens ? (
        <Disclosure
          className={FOLDING}
          // Left uncontrolled once the call is done: `undefined` hands the fold back to the
          // reader, which is what makes a finished call foldable at all.
          open={forced ? true : undefined}
          defaultOpen={defaultOpen}
          summary={summary}
        >
          <div className={BODY}>
            {error !== undefined && <p className={ERROR}>{error}</p>}
            {sectioned && (
              <>
                <Section head="Input" body={input} />
                <Section head="Output" body={output} />
              </>
            )}
            {children}
          </div>
        </Disclosure>
      ) : (
        <span className={cn(FOLDING, FLAT)}>{summary}</span>
      )}
      {first !== undefined && onOpenLocation !== undefined && (
        <Button variant="link" size="sm" className="shrink-0" onClick={() => onOpenLocation(first)}>
          {at(first)}
        </Button>
      )}
    </div>
  )
}

/**
 * One labelled half of the body: what was sent, or what came back.
 *
 * An empty half is drawn and says so rather than being left out: a card showing an `Input` and
 * no `Output` reads as a call still running, and the one thing a finished call has to be able to
 * say is that it answered nothing at all.
 */
function Section({ head, body }: { head: string; body: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <p className={SECTION_HEAD}>{head}</p>
      <div className={SECTION_BODY}>
        {body === undefined ? <span className={NOTHING}>Nothing was returned.</span> : body}
      </div>
    </div>
  )
}
