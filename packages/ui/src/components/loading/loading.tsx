import { cn } from 'cn'

/**
 * The loading indicator: a five by five grid of dots that lights up in rings from its middle
 * outwards (design D1-04b).
 *
 * It is opacity and nothing else, so the compositor carries it alone, and it is `currentColor`,
 * so it takes the colour of whatever it sits in — a button, a line of text, a panel. Under
 * reduced motion the grid is drawn at its resting opacity and stays there: `motion-safe`
 * leaves the animation out of the stylesheet entirely rather than playing it faster.
 */

/** How far each of the twenty-five cells is from the middle, which is the ring it lights in. */
const RINGS = Array.from(
  { length: 25 },
  (_, cell) => Math.abs(Math.floor(cell / 5) - 2) + Math.abs((cell % 5) - 2),
)

/** One class per ring, written out: a class name built at run time is one Tailwind never sees. */
const RING_DELAY = ['wave-ring-0', 'wave-ring-1', 'wave-ring-2', 'wave-ring-3', 'wave-ring-4']

const SIZE = {
  sm: 'size-icon-sm',
  md: 'size-icon-md',
  lg: 'size-icon-lg',
} as const

export interface LoadingProps {
  /** One step of the icon scale, so the grid sits where an icon would. */
  size?: keyof typeof SIZE
  /** What a screen reader says while this is on screen. */
  label?: string
  /** Where the indicator sits; never how it looks. */
  className?: string
}

export function Loading({ size = 'md', label = 'Loading', className }: LoadingProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('grid grid-cols-5 grid-rows-5', SIZE[size], className)}
    >
      {RINGS.map((ring, cell) => (
        <span
          key={cell}
          className={cn(
            'size-full scale-50 rounded-full bg-current opacity-20 motion-safe:animate-wave',
            RING_DELAY[ring],
          )}
        />
      ))}
    </span>
  )
}
