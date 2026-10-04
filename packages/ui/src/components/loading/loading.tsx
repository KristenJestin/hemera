import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Face, type FaceSize } from '../face/face.tsx'

/**
 * What stands in for something on its way, in two forms, chosen by what is known of its shape.
 *
 * - `Skeleton`: what is coming has a shape the page already knows — a row, a title, a line — so
 *   the component draws that shape now, in the skeleton's own fill, breathing. When the content
 *   arrives it takes the skeleton's place exactly, and nothing around it moves.
 * - `Loading`: what is coming has no shape to draw — a button working, a panel whose size depends
 *   on its answer. Hemera's face in its loading state: three dots going round, in `currentColor`.
 *   There is no other spinner in the catalogue.
 */

/** The size of face each step of the indicator is drawn at. */
const FACE: Record<'sm' | 'md' | 'lg', FaceSize> = {
  sm: 'icon',
  md: 'sm',
  lg: 'md',
}

export interface LoadingProps {
  /** Where it stands: beside a label, alone in a control, alone in a panel. */
  size?: keyof typeof FACE
  /** What a screen reader says while this is on screen. */
  label?: string
  /** Where the indicator sits; never how it looks. */
  className?: string
}

export function Loading({ size = 'md', label = 'Loading', className }: LoadingProps): ReactNode {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex shrink-0', className)}>
      <span aria-hidden="true" className="flex">
        <Face state="loading" size={FACE[size]} label={label} />
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
