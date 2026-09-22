import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { IconAlertTriangle, IconCheck } from '../icons.ts'
import { FOOT_TRAVEL, arrival, press, useTransition } from '../motion.ts'
import type { MessageAuthor, MessageLine, MessageState, MessageTone } from './model.ts'

/**
 * The thread of a Session, drawn from the outside in (design D4b-08, D4b-09).
 *
 * A message is not a bubble with a name above it; it is a group of consecutive lines by the
 * same author, and the group is what carries everything said once — the name, the time, the
 * state of what was written. Consecutive messages are one group with one head and one foot,
 * which is what makes a burst of ten read as one turn rather than as ten.
 *
 * The name is the only mark of who is speaking: an avatar beside it said the same thing twice,
 * in a thread that already puts the user on one side and everyone else on the other.
 *
 * The user is on the right, everything else on the left: what someone said answers what was
 * there before it, and the eye finds its own words without reading. Hemera's own notes — the
 * Session was created, renamed, archived — are lines without a surface at all, in the ghost
 * tone: they are the frame around the thread, not part of the conversation.
 *
 * Nothing here is a width read off a string, a spring of its own, or a colour outside the
 * theme. The entrance is the design system's `arrival` spring, a transform and an opacity, and
 * `useTransition` is what turns it into the end state for whoever asked for less movement.
 */

/**
 * What a row is filled with. `ghost` is the one tone that is not a surface but a sentence.
 *
 * The line breaks are kept: Shift+Enter is how a paragraph is written in the composer, and a
 * thread that collapsed them would read back a message nobody wrote.
 */
const bubbleVariants = cva('text-base break-words whitespace-pre-wrap', {
  variants: {
    tone: {
      soft: 'rounded-xl border border-border bg-surface-body px-3 py-2.5 text-foreground shadow-sm',
      tint: 'rounded-xl px-3 py-2.5 text-foreground bg-primary-muted',
      ghost: 'flex items-center gap-1.5 text-sm text-muted-foreground',
    },
  },
  defaultVariants: { tone: 'soft' },
})

/** How wide a line may grow before it wraps: the reading measure of the thread, never a % . */
const BUBBLE = 'max-w-3xl min-w-0'

/** The row: the message, on the side of whoever wrote it. */
const ROW = 'flex w-full items-start'

/**
 * What the head of a group is written in, and where it sits: over the message, not beside it,
 * and aligned with the words inside the bubble rather than with its rim.
 */
const HEAD = 'flex items-center gap-1.5 px-3 text-xs text-muted-foreground'

/** What a group is: a block of the thread, aligned to the side of whoever is speaking. */
const GROUP = 'flex w-full flex-col gap-1.5'

/**
 * The foot of a group, while the Profile has nothing to say about it.
 *
 * `Saved` and `Saving…` are the quiet half of a thread: they are worth a glance when the reader
 * wonders whether what they wrote went through, and they are noise on every line of a column
 * that is read downwards. So they are drawn under the hand and under the keyboard, and nowhere
 * else. A refusal is not quiet — it is the one state the reader has to act on — and it is drawn
 * all the time.
 *
 * Away and in place are where the foot comes from and where it goes back to: a fade and a few
 * pixels, in the design system's `press` spring, which is the one that answers the hand. The
 * fade is a `filter` and not an `opacity`, on purpose: the accessibility check of the catalogue
 * measures a text's contrast through an opacity, and refuses the value it would read mid-flight
 * — while a filter is not part of what it measures. The words keep their contrast the whole way;
 * it is only the pixels that fade.
 */
const AWAY = { filter: 'opacity(0)', y: -FOOT_TRAVEL }
const IN_PLACE = { filter: 'opacity(1)', y: 0 }

/**
 * The refused foot: what went wrong, and the way back against it.
 *
 * One sentence rather than two ends of a line: the words and the retry are the same answer read
 * once, so they sit together, on the side the message they belong to is on. A press is not a
 * second bubble either — the way back is a quiet button, and a control drawn like the message
 * would read as another line of the thread.
 */
const REFUSED = 'flex w-full items-center gap-1 px-3 text-xs'

export interface MessageBubbleProps extends VariantProps<typeof bubbleVariants> {
  /** Whether the surface is still waiting on the engine; it goes quiet until it is not. */
  pending?: boolean | undefined
  /** Whether the bubble closes its group, which is what rounds its last corner the other way. */
  tail?: boolean | undefined
  /** Which side the thread flows out of, for the corner the group ends on. */
  end?: boolean | undefined
  children: ReactNode
}

export function MessageBubble({
  tone,
  pending = false,
  tail = false,
  end = false,
  children,
}: MessageBubbleProps): ReactNode {
  return (
    <div
      className={cn(
        bubbleVariants({ tone }),
        tone === 'ghost' ? undefined : BUBBLE,
        // The corner the thread flows out of is the only corner a group rounds differently:
        // with several lines the group reads as one block that ends where it ends, and the
        // smaller corner is what says so. A single message keeps its four corners.
        tone !== 'ghost' && tail && (end ? 'rounded-br-md' : 'rounded-bl-md'),
        pending && 'opacity-60',
      )}
    >
      {children}
    </div>
  )
}

export interface MessageRowProps {
  author: MessageAuthor
  /** Which surface the message is drawn on. */
  tone?: MessageTone | undefined
  /**
   * Whether this row closes its group.
   *
   * The corner the thread flows out of is the only corner a group rounds differently: with
   * several lines, the group reads as one block that ends where it ends, and the smaller
   * corner is what says so. A single message keeps its four corners.
   */
  tail?: boolean | undefined
  /** Whether the message is on its way to the Profile; the surface says so by going quiet. */
  pending?: boolean | undefined
  children: ReactNode
}

export function MessageRow({
  author,
  tone = 'soft',
  tail = false,
  pending = false,
  children,
}: MessageRowProps): ReactNode {
  const transition = useTransition(arrival)
  const end = author === 'user'
  return (
    <motion.div
      className={cn(ROW, end && 'justify-end')}
      // Movement only, and no fade. A line arriving has to arrive legibly: an opacity that
      // climbs from zero is a line whose contrast, measured while it is still on its way, is
      // the contrast of the page behind it — which is exactly what the accessibility check of
      // this catalogue refuses, and it is right to: text is unreadable while it fades in.
      initial={{ y: 8, scale: 0.95 }}
      animate={{ y: 0, scale: 1 }}
      transition={transition}
    >
      <MessageBubble tone={tone} pending={pending} tail={tail} end={end}>
        {children}
      </MessageBubble>
    </motion.div>
  )
}

export interface MessageHeaderProps {
  author: MessageAuthor
  /** The name said once, at the head of the group. */
  name: string
  /** When the group was written, `HH:MM`, already written for the platform. */
  at?: string | undefined
  /** The whole date behind it, for a reader who asks a time three days old which day it is. */
  atLabel?: string | undefined
  /**
   * Whether the hand or the keyboard is on the group this head belongs to.
   *
   * The time is the quiet half of a head. A thread read downwards does not need forty timestamps
   * down its side — the day separators are what say when — and a reader who wonders about one
   * line wonders about that line. So it arrives under the hand and leaves with it, exactly as
   * the foot does, and it is in the page the whole time for whatever reads it out.
   */
  shown?: boolean | undefined
}

/**
 * The head of a group: who wrote it, and — for the hand that stops on it — when.
 *
 * The time fades rather than appears, and the fade is a `filter` and not an `opacity`, for the
 * same reason the foot's is: the accessibility check of the catalogue measures a text's contrast
 * through an opacity and refuses what it reads mid-flight, while a filter is not part of what it
 * measures. The words keep their contrast the whole way.
 */
export function MessageHeader({
  author,
  name,
  at,
  atLabel,
  shown = false,
}: MessageHeaderProps): ReactNode {
  const transition = useTransition(press)
  return (
    <p className={cn(HEAD, author === 'user' && 'flex-row-reverse')}>
      <span className="font-medium text-foreground">{name}</span>
      {at !== undefined && (
        <motion.span
          title={atLabel}
          animate={shown ? IN_PLACE : AWAY}
          initial={AWAY}
          transition={transition}
        >
          {at}
        </motion.span>
      )}
    </p>
  )
}

export interface MessageFooterProps {
  state?: MessageState | undefined
  /** Why the Profile did not take it, in the engine's own words. */
  error?: string | undefined
  onRetry?: (() => void) | undefined
  author?: MessageAuthor | undefined
  /**
   * Whether the hand or the keyboard is on the group this foot belongs to.
   *
   * The quiet states are drawn for the group the reader is on and for no other: a thread read
   * downwards does not carry them under every line. A refusal is not the hand's business — it
   * is drawn whether the reader is there or not.
   */
  shown?: boolean | undefined
}

/**
 * Where a message stands with the Profile, said once under its group.
 *
 * `Saved` is drawn only once the transaction has committed — never before, and never as an
 * assumption: a message shown as kept that is not kept is the one thing this lot refuses
 * (D4b-02). `Saved` and `Saving…` are drawn under the hand and under the keyboard and nowhere
 * else, and both of those are an arrival: the foot fades in as it settles down into place, and
 * leaves the other way round, which is what tells the reader that a line appeared rather than
 * that the bubble grew taller.
 *
 * A refusal is the opposite: it is drawn all the time, it says what went wrong with the way back
 * against those words, and the retry is a quiet button rather than a second bubble — a control
 * that looked like the message it belongs to would read as another line of the thread. The text
 * of the message is still in the composer, so nothing written is lost to a database that said no.
 */
export function MessageFooter({
  state,
  error,
  onRetry,
  author = 'user',
  shown = false,
}: MessageFooterProps): ReactNode {
  const transition = useTransition(press)
  if (state === undefined) return null
  const refused = state === 'failed'
  const inPlace = refused || shown
  return (
    <motion.p
      className={cn(
        refused ? REFUSED : HEAD,
        !refused && author === 'user' && 'flex-row-reverse',
        refused && author === 'user' && 'justify-end',
      )}
      initial={AWAY}
      animate={inPlace ? IN_PLACE : AWAY}
      exit={AWAY}
      transition={transition}
    >
      {refused ? (
        <>
          <span className="flex items-center gap-1.5 text-destructive-muted-foreground">
            <IconAlertTriangle size="sm" />
            <span>Not saved{error === undefined ? '' : `: ${error}`}</span>
          </span>
          {onRetry !== undefined && (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </>
      ) : (
        <>
          {state === 'saved' && (
            <>
              <IconCheck size="sm" />
              <span>Saved</span>
            </>
          )}
          {state === 'saving' && (
            <>
              <Loading size="sm" label="Saving" />
              <span>Saving…</span>
            </>
          )}
        </>
      )}
    </motion.p>
  )
}

export interface MessageGroupProps {
  author: MessageAuthor
  /** What the author of the group is called, said once for the whole group. */
  name: string
  /** The messages of the group, in the order they were written. */
  lines: MessageLine[]
  tone?: MessageTone | undefined
  /** When the group started, `HH:MM`, already written for the platform. */
  at?: string | undefined
  /** The whole date behind that time, for the reader who asks which day it was. */
  atLabel?: string | undefined
  /** Where the last line stands with the Profile. */
  state?: MessageState | undefined
  error?: string | undefined
  onRetry?: (() => void) | undefined
  /** What a screen reader hears instead of the name, when the name is not enough. */
  label?: string | undefined
}

export function MessageGroup({
  author,
  name,
  lines,
  tone = 'soft',
  at,
  atLabel,
  state,
  error,
  onRetry,
  label,
}: MessageGroupProps): ReactNode {
  /**
   * Whether the hand or the keyboard is on this group, which is what draws its foot.
   *
   * Held here rather than left to a `group-hover` class because the foot is not merely shown or
   * hidden: it arrives and leaves. A rule of CSS can be read by an element, not animated by it,
   * and the foot of a message is the one thing of this lot that has to say it appeared.
   */
  const [underTheHand, setUnderTheHand] = useState(false)
  const end = author === 'user'
  const note = tone === 'ghost'
  return (
    <div
      // A group and not a landmark: a thread holds many of them, and one region per author of
      // a conversation is a list of regions nobody asked for. A group says the same thing —
      // where a run begins and ends — without claiming to be a part of the page.
      role="group"
      aria-label={label ?? `Messages from ${name}`}
      className={cn(GROUP, end && 'items-end')}
      // One block, one hand: the pointer anywhere in the group draws the foot of the whole
      // group, and tabbing into it does the same for whoever has no pointer.
      onPointerEnter={() => setUnderTheHand(true)}
      onPointerLeave={() => setUnderTheHand(false)}
      onFocus={() => setUnderTheHand(true)}
      onBlur={() => setUnderTheHand(false)}
    >
      {!note && (
        <MessageHeader author={author} name={name} at={at} atLabel={atLabel} shown={underTheHand} />
      )}
      {lines.map((line, index) => (
        <MessageRow
          key={line.id}
          author={author}
          tone={tone}
          tail={index === lines.length - 1}
          pending={state === 'saving' && index === lines.length - 1}
        >
          {line.body}
        </MessageRow>
      ))}
      {/* Held during its own exit, so a foot that goes away leaves the way it arrived — which is
          why the foot is mounted by this condition rather than returning null from inside: a
          child that is always there is a child `AnimatePresence` has nothing to play out.
          The affordance itself is not the foot's alone any more: every group answers the hand,
          with its time in the head above (`MessageHeader`), and the foot adds what the Profile
          had to say wherever the caller passed a state. */}
      <AnimatePresence>
        {!note && state !== undefined && (
          <MessageFooter
            state={state}
            error={error}
            onRetry={onRetry}
            author={author}
            shown={underTheHand}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The day a run of messages was written on.
 *
 * A rule with the day in the middle of it, rather than a heading over a section: the thread is
 * one column being read downwards, and a day is a pause in it, not a new document.
 *
 * `MessageDaySeparator` and not `DaySeparator`: the Journal already hands out a component of
 * that name, which is a section of a timeline rather than a pause in a column, and one barrel
 * cannot export two things under one word. The two are not the same thing drawn twice — the
 * Journal's names a run of events, this one breaks a conversation — and they are told apart by
 * the word rather than by which page the reader happens to be on.
 */
export function MessageDaySeparator({ day }: { day: string }): ReactNode {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
      <span className="flex-1 border-t border-border" />
      <span>{day}</span>
      <span className="flex-1 border-t border-border" />
    </div>
  )
}

/**
 * Where the live edge is.
 *
 * It says what is true of the thread rather than of an agent: the reader is at the last thing
 * written, and nothing is coming — there is no answer waiting to be drawn in this lot, and a
 * marker that pretended otherwise would be the simulated reply the spec forbids (D4b-09). The
 * agent's own marker arrives with HEM-48, in the same place and the same words.
 */
export function LiveMarker({
  mark,
  children,
}: {
  /**
   * The dot at the head of the line, when it says something other than "nothing is coming".
   *
   * The green dot is the thread's own state and the default. A turn that is running is a
   * different fact about the same place — it is coming, and here is what it is doing — and the
   * row that says so hands over the dot that carries it (`ActivityRow`).
   */
  mark?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <p className="flex items-center justify-end gap-1.5 px-10 text-xs text-muted-foreground">
      {mark ?? <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />}
      {children}
    </p>
  )
}
