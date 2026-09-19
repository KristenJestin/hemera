import { cn } from 'cn'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { arrival, useTransition } from '../../motion.ts'

/**
 * The frame: a border that follows, and a body inside it with a border of its own (design
 * D4-07, D4-08).
 *
 * The one motif that runs through every surface of Hemera. A frame is a thin rim — the page's
 * quieter surface, a line around it, a large radius and six pixels of room — and inside it a
 * body: the card surface, its own line, its corners the frame's minus the room between them, so
 * the two borders run parallel round the corner instead of the inner one cutting across it.
 * Whatever is not in the body stays *in the rim*, open on the frame's own surface: an icon, a
 * title and a link above the body, as the Activity frame has; a Workspace and the actions below
 * it, as the composer has; or both at once, the moment a file is attached.
 *
 * `animated` puts `layout` on the frame *and on every band inside it*, for the one frame whose
 * rim comes and goes — the composer's header appears when a file is attached. Both are needed:
 * `layout` on the rim alone animates its size by scaling it, which stretches whatever is drawn
 * inside; the bands carrying it too is what makes each of them keep its own shape and simply
 * travel. Nothing animates a height — motion measures where each band ended up and plays the
 * difference as a transform.
 */
const RIM = 'flex flex-col rounded-xl border border-border bg-surface-rim p-1.5'

const HEAD = 'flex items-start gap-2 px-2.5 pt-2 pb-2.5 text-base font-semibold'

const DESCRIPTION = 'text-sm font-normal text-muted-foreground'

const FOOT = 'flex flex-wrap items-center gap-2 px-2 pt-2.5 pb-1'

const BODY = 'flex flex-col rounded-lg border border-border bg-surface-body shadow-sm'

/**
 * The radius of anything drawn inside a body, one step in from the body's own.
 *
 * Exported because a row, a field and a chip all need it and none of them should be deciding
 * it: concentric corners are a rule of the design system, not a taste of the page.
 */
export const NESTED_RADIUS = 'rounded-md'

/** A body the caret lives in: the input line, and the ring the moment something inside it has the focus. */
const FOCUSABLE = 'border-input focus-ring'

export interface FrameProps {
  /** What stays open above the body: an icon, a title, a link at the end. */
  header?: ReactNode
  /** What stays open below the body. */
  footer?: ReactNode
  /** Whether the body is where a caret goes, and wears the ring when it does. */
  focusable?: boolean | undefined
  /** Whether the rim carries `layout`, for a header or a footer that comes and goes. */
  animated?: boolean | undefined
  /** Where the frame sits; never how it looks. */
  className?: string | undefined
  /** The body. */
  children: ReactNode
}

export function Frame({
  header,
  footer,
  focusable = false,
  animated = false,
  className,
  children,
}: FrameProps): ReactNode {
  const transition = useTransition(arrival)
  if (animated) {
    return (
      <motion.div layout className={cn(RIM, className)} transition={transition}>
        {header}
        <motion.div layout className={cn(BODY, focusable && FOCUSABLE)} transition={transition}>
          {children}
        </motion.div>
        {footer !== undefined && (
          <motion.div layout transition={transition}>
            {footer}
          </motion.div>
        )}
      </motion.div>
    )
  }
  return (
    <div className={cn(RIM, className)}>
      {header}
      <div className={cn(BODY, focusable && FOCUSABLE)}>{children}</div>
      {footer}
    </div>
  )
}

/** The open band above the body: an icon, what the frame is about, and one link at the end. */
export function FrameHeader({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  /** A line under the title, for a frame whose subject needs saying in words. */
  description?: string | undefined
  /** One control at the end of the band: a link to the whole of what the body shows. */
  action?: ReactNode
}): ReactNode {
  return (
    <div className={HEAD}>
      {icon !== undefined && <span className="flex pt-0.5">{icon}</span>}
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2>{title}</h2>
        {description !== undefined && <p className={DESCRIPTION}>{description}</p>}
      </div>
      {action !== undefined && <div className="ml-auto flex shrink-0">{action}</div>}
    </div>
  )
}

/** The open band below the body, which the caller fills. */
export function FrameFooter({ children }: { children: ReactNode }): ReactNode {
  return <div className={FOOT}>{children}</div>
}
