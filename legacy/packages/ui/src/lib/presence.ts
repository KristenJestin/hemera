/**
 * Keeping something on screen long enough to leave.
 *
 * The renderer has no exit animation: an element stops painting the frame React removes it,
 * so a panel closed by a button vanishes while a panel opened by one arrives softly. The
 * asymmetry is what reads as unfinished.
 *
 * So the removal is ours to delay. `usePresence` keeps the element mounted while its exit
 * plays, and hands it the stage to paint: arriving, leaving, gone. Nothing is animated here —
 * the caller does that, because only it knows what leaving looks like for what it paints.
 */

import { useEffect, useRef, useState } from 'react'

import { duration } from '#tokens/primitives.ts'
import type { MotionSpeed } from '#lib/motion.ts'

export type PresenceStage =
  /** Painted, and playing its entry. */
  | 'entering'
  /** Painted, and playing its exit; removed once it ends. */
  | 'leaving'
  /** Not painted at all. */
  | 'gone'

export interface Presence {
  /** Whether the caller paints anything at all. */
  present: boolean
  stage: PresenceStage
}

export interface UsePresenceOptions {
  open: boolean
  /** How long the exit lasts; the element is removed after it. */
  speed?: MotionSpeed
}

/**
 * Follows `open`, and outlives it by the length of the exit.
 *
 * A reopen during an exit cancels it: the element never leaves and comes back, it simply
 * returns to entering, which is what a hesitating pointer produces.
 */
export function usePresence({ open, speed = 'fast' }: UsePresenceOptions): Presence {
  const [stage, setStage] = useState<PresenceStage>(open ? 'entering' : 'gone')
  const [wasOpen, setWasOpen] = useState(open)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Adjusted while rendering, not in an effect: an element that opens has to paint on the
  // very frame it was asked for, and one that closes has to still be there on that frame.
  if (open !== wasOpen) {
    setWasOpen(open)
    setStage(open ? 'entering' : 'leaving')
  }

  useEffect(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (open) return undefined

    let cancelled = false
    timer.current = setTimeout(() => {
      if (!cancelled) setStage('gone')
    }, duration[speed] * 1000)
    return () => {
      cancelled = true
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }
  }, [open, speed])

  const current = open ? 'entering' : stage
  return { present: current !== 'gone', stage: current }
}
