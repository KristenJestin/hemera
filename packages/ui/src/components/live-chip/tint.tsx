import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { WIPE, instant, useTransition, wipe } from '../../motion.ts'

/**
 * The background of a live chip: how it says its state, without a dot.
 *
 * - Working, a tint of the running tone breathes across the whole background.
 * - Every change from working — or from stuck — to another state plays one sweep across it, in
 *   the colour of the state it changes to, and the chip is neutral again: nothing tinted lasts.
 *
 * Asked for less movement, there is no breath and no sweep.
 */

export type LiveState = 'running' | 'stuck' | 'finished' | 'failed' | 'stopped'

/** What a state that is not working is swept in. */
type Swept = Exclude<LiveState, 'running'>

/** The running tone breathing: its own, apart from the warning a stuck chip is swept in. */
const BREATH =
  'pointer-events-none absolute inset-0 -z-10 bg-running-muted motion-safe:animate-breathe'

const SWEPT: Record<Swept, string> = {
  stuck: 'pointer-events-none absolute inset-0 -z-10 bg-warning-muted',
  finished: 'pointer-events-none absolute inset-0 -z-10 bg-success-muted',
  failed: 'pointer-events-none absolute inset-0 -z-10 bg-destructive-muted',
  stopped: 'pointer-events-none absolute inset-0 -z-10 bg-accent',
}

/** Whether a change from `before` to `after` is one the background sweeps. */
function sweeps(before: LiveState, after: LiveState): after is Swept {
  return after !== 'running' && (before === 'running' || before === 'stuck')
}

/**
 * The state a chip last changed to with a sweep, and whether the sweep is still crossing. Decided
 * as the state changes, during the render, so the sweep starts on the frame the change lands.
 */
export interface Sweep {
  /** The state the chip last changed to with a sweep, if it did. */
  readonly swept: Swept | null
  /** Whether that sweep is still crossing the chip. */
  readonly crossing: boolean
  /** Said by the sweep once it has crossed. */
  readonly done: () => void
}

export function useSweep(state: LiveState): Sweep {
  const travel = useTransition(wipe)
  const [seen, setSeen] = useState(state)
  const [swept, setSwept] = useState<Swept | null>(null)
  const [crossing, setCrossing] = useState(false)
  if (seen !== state) {
    setSeen(state)
    const landed = sweeps(seen, state) ? state : null
    setSwept(landed)
    setCrossing(landed !== null && travel !== instant)
  }
  return { swept, crossing, done: () => setCrossing(false) }
}

export interface LiveTintProps {
  state: LiveState
  /** What `useSweep` said of the chip. */
  sweep: Sweep
}

/** The breath and the sweep, behind the chip's content. The chip is `relative isolate`. */
export function LiveTint({ state, sweep }: LiveTintProps): ReactNode {
  const travel = useTransition(wipe)
  return (
    <>
      {state === 'running' && <span aria-hidden="true" className={BREATH} data-breath="" />}
      {/* A presence of its own: on a line whose presence skips what is there at first, the
          sweep would otherwise start where it ends, and never cross. */}
      <AnimatePresence>
        {sweep.crossing && sweep.swept !== null && (
          <motion.span
            key={sweep.swept}
            aria-hidden="true"
            className={SWEPT[sweep.swept]}
            data-sweep={sweep.swept}
            initial={WIPE.before}
            animate={WIPE.past}
            transition={travel}
            onAnimationComplete={sweep.done}
          />
        )}
      </AnimatePresence>
    </>
  )
}
