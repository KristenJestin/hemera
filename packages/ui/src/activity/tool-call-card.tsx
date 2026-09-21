import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Badge, type BadgeProps } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
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
 * The file a call touched is a press at the end of the row rather than the title itself: the
 * title is the fold, a control cannot live inside a control, and a link inside a button is a
 * link the keyboard walks over and a screen reader never announces. The row still folds
 * anywhere the pointer lands on it.
 */

/** How a call is read at a glance: the kind is the mark, the status is the word. */
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

const STATUS: Record<ToolStatus, { word: string; tone: NonNullable<BadgeProps['tone']> }> = {
  pending: { word: 'Queued', tone: 'neutral' },
  in_progress: { word: 'Running', tone: 'info' },
  completed: { word: 'Done', tone: 'success' },
  failed: { word: 'Failed', tone: 'destructive' },
}

/** The row: the fold, and the file it touched at its end. */
const ROW = 'flex w-full min-w-0 items-center gap-2'

/** The block that folds takes the room that is left, so a long title shortens rather than runs on. */
const FOLDING = 'min-w-0 flex-1'

/** The line that is read: the mark of the kind, the title, and what the call is doing. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

const TITLE = 'truncate text-foreground'

/** What the call returned, quieter than the line above it. */
const BODY = 'text-sm text-muted-foreground'

/** A failure keeps the colour of a failure, in the body it opened for it. */
const ERROR = 'mb-1 text-sm text-destructive-muted-foreground'

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

/** Where a call is in its life, which is what says whether it folds. */
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

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
  /** Whether a reader who has not touched it finds it open. */
  defaultOpen?: boolean | undefined
  /** What a press on the file does: the reader goes there, which the card itself cannot do. */
  onOpenLocation?: ((location: ToolLocation) => void) | undefined
  /** What the call returned: text, a diff, a console, handed over already drawn. */
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
  return (
    <div className={cn(ROW, className)}>
      <Disclosure
        className={FOLDING}
        // Left uncontrolled once the call is done: `undefined` hands the fold back to the
        // reader, which is what makes a finished call foldable at all.
        open={forced ? true : undefined}
        defaultOpen={defaultOpen}
        summary={
          <span className={SUMMARY}>
            <span className="flex shrink-0 text-muted-foreground">{MARKS[kind]}</span>
            <span className={TITLE}>{title}</span>
            <Badge tone={tone}>{word}</Badge>
          </span>
        }
      >
        {error !== undefined && <p className={ERROR}>{error}</p>}
        <div className={BODY}>{children}</div>
      </Disclosure>
      {first !== undefined && onOpenLocation !== undefined && (
        <Button variant="link" size="sm" className="shrink-0" onClick={() => onOpenLocation(first)}>
          {at(first)}
        </Button>
      )}
    </div>
  )
}
