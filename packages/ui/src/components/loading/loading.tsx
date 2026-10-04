import { cn } from 'cn'
import type { ReactNode } from 'react'

/**
 * What stands in for something on its way, in two forms, chosen by what is known of its shape.
 *
 * - `Skeleton`: what is coming has a shape the page already knows — a row, a title, a line — so
 *   that shape is drawn now, in the skeleton's own fill, breathing. When the content arrives it takes
 *   the skeleton's place exactly, and nothing around it moves.
 * - `Loading`: what is coming has no shape to draw — a button working, a panel whose size
 *   depends on its answer. Three dots going round, in `currentColor`.
 *
 * One element turns and the dots ride it, so the spinner is a single rotation the compositor
 * carries on its own. Under reduced motion `motion-safe` leaves the rotation and the breath out
 * of the stylesheet entirely, and both stand still.
 */
const SIZE = {
  sm: 'size-icon-sm',
  md: 'size-icon-md',
  lg: 'size-icon-lg',
} as const

const DOT = {
  sm: 'size-1',
  md: 'size-1',
  lg: 'size-1.5',
} as const

/** One class per dot, written out: a class name built at run time is one Tailwind never sees. */
const ORBIT = ['orbit-0', 'orbit-1', 'orbit-2']

export interface LoadingProps {
  /** One step of the icon scale, so the indicator sits where an icon would. */
  size?: keyof typeof SIZE
  /** What a screen reader says while this is on screen. */
  label?: string
  /** Where the indicator sits; never how it looks. */
  className?: string
}

export function Loading({ size = 'md', label = 'Loading', className }: LoadingProps): ReactNode {
  return (
    <span role="status" aria-label={label} className={cn('relative', SIZE[size], className)}>
      <span className="absolute inset-0 flex items-center justify-center motion-safe:animate-turn">
        {ORBIT.map((orbit) => (
          <span key={orbit} className={cn('absolute rounded-full bg-current', DOT[size], orbit)} />
        ))}
      </span>
    </span>
  )
}

/**
 * What a skeleton is drawn over: a line of text, or a block — a control, an icon's square.
 */
export type SkeletonShape = 'text' | 'block'

/** What it holds, kept in its place and never shown, so the skeleton is exactly its size. */
const HELD: Record<SkeletonShape, string> = {
  text: 'relative inline-block max-w-full truncate align-top',
  block: 'relative inline-flex max-w-full',
}

/**
 * The fill drawn over it: a little shorter than a line of text, so it reads as a word rather than
 * as a box; the whole of a block.
 */
const FILL: Record<SkeletonShape, string> = {
  text: 'absolute inset-x-0 inset-y-1 rounded-sm bg-skeleton motion-safe:animate-breathe',
  block: 'absolute inset-0 rounded-md bg-skeleton motion-safe:animate-breathe',
}

export interface SkeletonProps {
  /** What it stands for: the very text or control it will be, at the length it will have. */
  children: ReactNode
  shape?: SkeletonShape | undefined
}

/**
 * One part of a component on its way, drawn by the component itself in its loading mode: what it
 * will show is laid out and hidden, and the skeleton's fill is drawn over exactly that room. A
 * skeleton is therefore the size of what replaces it by construction, and nothing of the content
 * is ever seen. Decoration: what holds it says it is busy.
 */
export function Skeleton({ children, shape = 'text' }: SkeletonProps): ReactNode {
  return (
    <span aria-hidden="true" className={HELD[shape]} data-skeleton="">
      <span className="invisible">{children}</span>
      <span className={FILL[shape]} />
    </span>
  )
}
