// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { check, instant, morph, ping, pinging, useTransition } from '../../motion.ts'
import { Legend } from '../tooltip/legend.tsx'
import { type MarkState, MARK_LEGENDS } from './mark-legends.ts'

const TONES: Record<MarkState, string> = {
  todo: 'relative inline-flex shrink-0 text-muted-foreground',
  running: 'relative inline-flex shrink-0 text-info',
  done: 'relative inline-flex shrink-0 text-success',
  unverified: 'relative inline-flex shrink-0 text-success',
  failed: 'relative inline-flex shrink-0 text-destructive',
  waiting: 'relative inline-flex shrink-0 text-warning',
  blocked: 'relative inline-flex shrink-0 text-destructive',
  skipped: 'relative inline-flex shrink-0 text-muted-foreground',
  // Quieter than every other state: nothing runs and nothing waits, so the mark is the line of
  // the window and nothing more.
  idle: 'relative inline-flex shrink-0 text-border',
}

/** The two steps a mark is drawn at: beside a task's line, and compact in a row of text. */
export type MarkSize = 'sm' | 'md'

const SVG: Record<MarkSize, string> = {
  sm: 'size-icon-sm stroke-current',
  md: 'size-5 stroke-current',
}

/** What holds the strokes still. */
const STILL = 'flex'

/**
 * The arc turns while the task runs: the loading indicator's own turn. The box around the svg
 * turns and not the svg, because a box is given a layer of its own and an svg is redrawn.
 */
const TURNING = 'flex motion-safe:animate-turn'

/** The ring leaving the dot of what waits for the user, the dot's own tone. */
const PING = 'absolute inset-1 rounded-full bg-warning motion-reduce:hidden'

/**
 * How small the dot of what waits is while it is not there: it grows from half its size as it
 * fades in, and never from nothing, which reads as a dot appearing from nowhere.
 */
const DOT_FROM = 0.5

/** How much of the ring the arc covers while it turns. */
const ARC = 0.28

/** How much of the ring each pose closes. */
function ringOf(state: MarkState): number {
  if (state === 'todo' || state === 'skipped' || state === 'idle' || state === 'unverified') {
    return 0
  }
  if (state === 'running') return ARC
  return 1
}

/** A stroke drawn whole, or not at all. */
function drawn(on: boolean) {
  return { pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }
}

export interface StatusMarkProps {
  state: MarkState
  /** Whether its state is said in a tooltip on the mark; left out, it is decoration. */
  legend?: boolean | undefined
  /** Compact (`sm`) where a dot would stand, in a row of text; `md` beside a task's line. */
  size?: MarkSize | undefined
}

export function StatusMark({ state, legend = false, size = 'md' }: StatusMarkProps): ReactNode {
  const ringing = useTransition(morph)
  const drawing = useTransition(check.draw)
  const beat = useTransition(pinging)
  const dashed =
    state === 'todo' || state === 'skipped' || state === 'idle' || state === 'unverified'
  const ring = ringOf(state)
  const waiting = state === 'waiting'
  const mark = (
    <span aria-hidden={legend ? undefined : true} className={TONES[state]} data-mark={state}>
      {waiting && beat !== instant && (
        <motion.span
          aria-hidden="true"
          className={PING}
          data-figure="ping"
          animate={ping}
          transition={beat}
        />
      )}
      <span className={state === 'running' ? TURNING : STILL} data-figure="turn">
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={SVG[size]}
        >
          <motion.circle
            cx="10"
            cy="10"
            r="7.25"
            strokeDasharray="2 2.55"
            data-figure="dashed"
            initial={false}
            animate={{ opacity: dashed ? 1 : 0 }}
            transition={ringing}
          />
          <g transform="rotate(-90 10 10)">
            <motion.circle
              cx="10"
              cy="10"
              r="7.25"
              data-figure="ring"
              initial={false}
              animate={{ pathLength: ring, opacity: ring === 0 ? 0 : 1 }}
              transition={ringing}
            />
          </g>
          <motion.path
            d="M6.6 10.3l2.3 2.3l4.5 -4.7"
            data-figure="check"
            initial={false}
            animate={drawn(state === 'done' || state === 'unverified')}
            transition={drawing}
          />
          <motion.path
            d="M7.6 7.6l4.8 4.8M12.4 7.6l-4.8 4.8"
            data-figure="cross"
            initial={false}
            animate={drawn(state === 'failed')}
            transition={drawing}
          />
          <motion.path
            d="M7 10h6"
            data-figure="bar"
            initial={false}
            animate={drawn(state === 'blocked')}
            transition={drawing}
          />
          <motion.path
            d="M6.5 13.5l7 -7"
            data-figure="strike"
            initial={false}
            animate={drawn(state === 'skipped')}
            transition={drawing}
          />
          <motion.circle
            cx="10"
            cy="10"
            r="2.25"
            className="fill-current"
            stroke="none"
            data-figure="dot"
            initial={false}
            animate={{ scale: waiting ? 1 : DOT_FROM, opacity: waiting ? 1 : 0 }}
            transition={ringing}
          />
        </svg>
      </span>
    </span>
  )
  if (!legend) return mark
  return <Legend label={MARK_LEGENDS[state]}>{mark}</Legend>
}
