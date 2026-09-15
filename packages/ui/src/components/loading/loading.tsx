import { cn } from 'cn'

/**
 * The loading indicator: three dots going round (design D1-04b).
 *
 * One element turns and the dots ride it, so the whole thing is a single rotation the
 * compositor carries on its own — no dot animates anything of its own, and there is no
 * keyframe per dot to keep in step. It is drawn in `currentColor`, so it takes the colour of
 * whatever it sits in: a button, a line of text, a panel.
 *
 * Under reduced motion `motion-safe` leaves the rotation out of the stylesheet entirely rather
 * than playing it slower, and the three dots stay where they are.
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

export function Loading({ size = 'md', label = 'Loading', className }: LoadingProps) {
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
