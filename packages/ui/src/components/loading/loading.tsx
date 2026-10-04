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
 * The shapes a skeleton is drawn in. A line of text is held in a line of the very type it stands
 * for, so a skeleton is exactly as tall as what replaces it; the block is drawn inside it, a
 * little shorter, and shorter than the line is long.
 */
export type SkeletonShape = 'title' | 'line' | 'square'

const HOLDER: Record<SkeletonShape, string> = {
  title: 'relative block text-base font-semibold',
  line: 'relative block text-sm',
  square: 'block size-control-md shrink-0 rounded-md bg-skeleton motion-safe:animate-breathe',
}

const BLOCK: Record<Exclude<SkeletonShape, 'square'>, string> = {
  title: 'absolute inset-y-1 left-0 w-20 rounded-sm bg-skeleton motion-safe:animate-breathe',
  line: 'absolute inset-y-1 left-0 w-24 rounded-sm bg-skeleton motion-safe:animate-breathe',
}

export interface SkeletonProps {
  shape: SkeletonShape
}

/** One piece of a shape on its way. Decoration: what holds it says it is busy. */
export function Skeleton({ shape }: SkeletonProps): ReactNode {
  if (shape === 'square') return <span aria-hidden="true" className={HOLDER.square} />
  return (
    <span aria-hidden="true" className={HOLDER[shape]}>
      {' '}
      <span className={BLOCK[shape]} />
    </span>
  )
}
