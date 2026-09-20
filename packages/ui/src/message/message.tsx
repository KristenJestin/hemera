import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from 'cn'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { IconAlertTriangle, IconCheck } from '../icons.ts'
import { MARK_TRAVEL, arrival, useTransition } from '../motion.ts'

/**
 * The thread of a Session, one message at a time (design D4b-02, D4b-08).
 *
 * Rows aligned by who wrote them — the user on one side, Hemera's own notes on the other —
 * and consecutive messages of the same author collected into a group: one name, one time, one
 * avatar, one state, however many bubbles. A name repeated above every line of a burst is a
 * column of the same word down the page, and the burst itself is what stops reading as one
 * thing said in one breath.
 *
 * Nothing here knows about an agent. `role` has one value in this lot and the thread is the
 * user's alone: no answer, no typing indicator, nothing that pretends something is coming.
 *
 * Nothing here formats anything either. The day and the time arrive already written for the
 * platform the page runs on, as everywhere else in this design system: a component that turned
 * a date into words would be a component with a locale of its own.
 */

/** Which side of the thread a group is written from. */
export type MessageSide = 'own' | 'other'

const GROUP = 'flex flex-col gap-1.5'

const GROUP_SIDE = {
  own: 'items-end',
  other: 'items-start',
} satisfies Record<MessageSide, string>

/** The avatar and the rows beside it, the avatar leading on whichever side the group is on. */
const STACK = 'flex w-full items-start gap-2.5'

const STACK_SIDE = {
  own: 'flex-row-reverse',
  other: 'flex-row',
} satisfies Record<MessageSide, string>

const ROWS = 'flex min-w-0 flex-1 flex-col gap-1.5'

/**
 * The head and the foot of a group, set in past the avatar so they line up with the bubbles.
 *
 * The room is kept on both sides rather than on the one the avatar is on: a group changes side
 * with its author, and a padding that changed with it would be a class built at run time.
 */
const META = 'flex items-center gap-1.5 px-10 text-xs text-muted-foreground'

const bubbleVariants = cva('max-w-2xl rounded-xl text-base leading-relaxed', {
  variants: {
    /**
     * What the bubble is: something said, something Hemera is highlighting, or a note the
     * application made about the Session itself.
     */
    tone: {
      soft: 'border border-border bg-card px-3 py-2 text-card-foreground',
      tint: 'bg-primary-muted px-3 py-2 text-primary-muted-foreground',
      ghost: 'flex items-center gap-2 py-1 text-sm text-muted-foreground',
    },
    /** Written, not yet kept: a message is shown as sent only once the engine has it (D4b-02). */
    pending: {
      true: 'opacity-70',
      false: '',
    },
  },
  defaultVariants: { tone: 'soft', pending: false },
})

export interface MessageBubbleProps extends VariantProps<typeof bubbleVariants> {
  children: ReactNode
}

/**
 * One message, drawn as what carries it.
 *
 * It rises into the thread rather than appearing in it: the arrival of the design system, in
 * opacity and travel, which is what makes a message that has just been written read as having
 * arrived rather than as having always been there.
 */
export function MessageBubble({ tone, pending, children }: MessageBubbleProps): ReactNode {
  const transition = useTransition(arrival)
  return (
    <motion.div
      // What it is, said in the DOM as plainly as the eye reads it off the colour — and what a
      // story waits on to know that every bubble has finished arriving.
      data-tone={tone ?? 'soft'}
      className={bubbleVariants({ tone, pending })}
      initial={{ opacity: 0, y: MARK_TRAVEL }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
    >
      {children}
    </motion.div>
  )
}

export interface MessageRowProps {
  side?: MessageSide | undefined
  children: ReactNode
}

/** One line of a group: a bubble, pushed to the side the group is written from. */
export function MessageRow({ side = 'own', children }: MessageRowProps): ReactNode {
  return <div className={cn('flex w-full', GROUP_SIDE[side])}>{children}</div>
}

export interface MessageHeaderProps {
  /** Who wrote it, in the words the page uses for them: `You`, `Hemera`. */
  author: string
  /** When, already written for the platform. */
  time: string
}

/** Who said it and when, once for the whole group. */
export function MessageHeader({ author, time }: MessageHeaderProps): ReactNode {
  return (
    <p className={META}>
      <span className="font-medium text-foreground">{author}</span>
      <span>{time}</span>
    </p>
  )
}

/**
 * Where a message stands with the engine (design D4b-02).
 *
 * `saved` is the quiet one and says the least, because the ordinary case deserves the least
 * ink: a check and the word, and nothing moving. `saving` is the moment between the keystroke
 * and the commit. `failed` is the one that matters — the message was not kept, it does not
 * claim to have been, and the way back is a button and not a hope.
 */
export type MessageState = 'saved' | 'saving' | 'failed'

export interface MessageFooterProps {
  state: MessageState
  /** Why it was not kept, in the engine's own words. Shown on `failed`, ignored elsewhere. */
  reason?: string | undefined
  /** Writes it again. Given on `failed`, where it is the only way out. */
  onRetry?: (() => void) | undefined
}

export function MessageFooter({ state, reason, onRetry }: MessageFooterProps): ReactNode {
  if (state === 'saving') {
    return (
      <p className={META} role="status">
        <Loading size="sm" label="Saving" />
        Saving…
      </p>
    )
  }
  if (state === 'failed') {
    return (
      <p className={cn(META, 'text-destructive-muted-foreground')} role="alert">
        <IconAlertTriangle size="sm" />
        {reason ?? 'Not saved'}
        {onRetry !== undefined && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </p>
    )
  }
  return (
    <p className={META}>
      <IconCheck size="sm" />
      Saved
    </p>
  )
}

export interface MessageGroupProps {
  side?: MessageSide | undefined
  /** Drawn once, beside the first row and level with it. */
  avatar?: ReactNode
  /** Who and when, above the rows. */
  header?: ReactNode
  /** Where the messages stand with the engine, under the rows. */
  footer?: ReactNode
  /** The rows themselves. */
  children: ReactNode
}

/**
 * The consecutive messages of one author, with one head, one foot and one avatar.
 *
 * The avatar sits beside the whole stack rather than beside each row, which is the difference
 * between a group and a list of messages that happen to follow each other: one person spoke,
 * several times, and the column of identical faces down the side said otherwise.
 */
export function MessageGroup({
  side = 'own',
  avatar,
  header,
  footer,
  children,
}: MessageGroupProps): ReactNode {
  return (
    <div className={cn(GROUP, GROUP_SIDE[side])}>
      {header}
      <div className={cn(STACK, STACK_SIDE[side])}>
        {avatar !== undefined && <span className="flex shrink-0">{avatar}</span>}
        <div className={cn(ROWS, GROUP_SIDE[side])}>{children}</div>
      </div>
      {footer}
    </div>
  )
}

/**
 * The break between two days of a thread.
 *
 * Not the Journal's separator, which is a section of a timeline and brings its rail with it. A
 * thread has no rail: what it needs is a line the eye crosses, so the day sits between two
 * hairlines and the messages start again under it.
 */
export function MessageDaySeparator({ day }: { day: string }): ReactNode {
  return (
    <p className="flex items-center gap-3 text-xs text-muted-foreground">
      <span aria-hidden="true" className="h-0 flex-1 border-t border-border" />
      {day}
      <span aria-hidden="true" className="h-0 flex-1 border-t border-border" />
    </p>
  )
}

/**
 * The foot of the thread: the reader is at the last message there is.
 *
 * Static, and static on purpose. It is the place lot 5 will hang a running agent off, and in
 * this lot there is nothing running — a mark that pulsed would be an indicator of generation,
 * which the spec of this lot forbids in as many words.
 */
export function LiveMarker({
  label = 'You are at the latest message',
}: {
  label?: string | undefined
}): ReactNode {
  return (
    <p className="flex items-center gap-1.5 self-end px-10 text-xs text-muted-foreground">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
      {label}
    </p>
  )
}
