import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Frame, FrameFooter, FrameHeader, NESTED_RADIUS } from '../frame/frame.tsx'

/**
 * The card: one subject of a page, on a frame (design D4-07).
 *
 * It is a `Frame` and not a surface of its own: what a settings block needs is exactly what a
 * frame gives — a rim carrying the title and whatever the block offers, and a body carrying the
 * subject itself. Written twice, the two would drift apart; written this way, a change to the
 * frame is a change to every card.
 *
 * The title goes in the rim above, the actions in the rim below, and the fields in the body.
 * That is the whole of what a card decides.
 */
const BODY = 'flex flex-col gap-4 p-5'

/** A card whose subject is a thing that cannot be undone, marked by its edge. */
const DANGER = 'border-destructive-muted'

export interface CardProps {
  /** What the card is about. A card with no title is a surface, which is a card too. */
  title?: string | undefined
  /** A line under the title saying what the block is for. */
  description?: string | undefined
  /** What sits at the end of the title row: one control, never a second subject. */
  actions?: ReactNode
  /** What sits in the rim under the body: the one thing the block does. */
  footer?: ReactNode
  /** Whether the subject is one that takes something away. */
  tone?: 'default' | 'danger' | undefined
  /** Where the card sits; never how it looks. */
  className?: string | undefined
  children?: ReactNode
}

export function Card({
  title,
  description,
  actions,
  footer,
  tone = 'default',
  className,
  children,
}: CardProps): ReactNode {
  return (
    <Frame
      className={cn(tone === 'danger' && DANGER, className)}
      header={
        title === undefined && description === undefined && actions === undefined ? undefined : (
          <FrameHeader title={title ?? ''} description={description} action={actions} />
        )
      }
      footer={footer === undefined ? undefined : <FrameFooter>{footer}</FrameFooter>}
    >
      <div className={BODY}>{children}</div>
    </Frame>
  )
}

/**
 * One row inside a card: a repository, a path.
 *
 * Drawn on the page's quieter surface with a line of its own, one step rounder than the body it
 * sits in, so a list of them reads as rows of a form rather than as cards inside a card.
 */
const ROW = 'flex items-center gap-3 border border-border bg-muted px-3 py-2'

export function CardRow({
  className,
  children,
}: {
  className?: string | undefined
  children: ReactNode
}): ReactNode {
  return <div className={cn(ROW, NESTED_RADIUS, className)}>{children}</div>
}
