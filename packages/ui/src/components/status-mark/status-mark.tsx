import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { check, instant, morph, ping, pinging, useTransition } from '../../motion.ts'
import { Legend } from '../tooltip/legend.tsx'

/**
 * Where a task stands, as one small mark that changes in place: one ring and what it holds, every
 * state a pose of the same strokes, so a change is a stroke moving and never one glyph swapped
 * for another.
 *
 * - `todo` · a dotted ring, quiet: nothing has started.
 * - `running` · an arc of the ring, turning, in the running tone.
 * - `done` · the ring closes and a ✓ draws itself in it; `failed`, a ✕.
 * - `waiting` · the ring closes around a dot that waits for the user, a ring leaving it on the
 *   beat of the theme's `ping`.
 * - `blocked` · the ring closes around a bar: the way is shut.
 * - `skipped` · the dotted ring, a stroke across it.
 *
 * Asked for less movement, every pose is there at once, the arc does not turn and no ring leaves
 * the dot. With `legend`, the state in words is a tooltip on the mark; without, the mark is
 * decoration beside a line that already says the state.
 */

export type MarkState = 'todo' | 'running' | 'done' | 'failed' | 'waiting' | 'blocked' | 'skipped'

/** What each state means, in words: the legend, and what a screen reader says. */
export const MARK_LEGENDS: Record<MarkState, string> = {
  todo: 'To do',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  waiting: 'Waiting for you',
  blocked: 'Blocked',
  skipped: 'Skipped',
}

const TONES: Record<MarkState, string> = {
  todo: 'relative inline-flex shrink-0 text-muted-foreground',
  running: 'relative inline-flex shrink-0 text-info',
  done: 'relative inline-flex shrink-0 text-success',
  failed: 'relative inline-flex shrink-0 text-destructive',
  waiting: 'relative inline-flex shrink-0 text-warning',
  blocked: 'relative inline-flex shrink-0 text-destructive',
  skipped: 'relative inline-flex shrink-0 text-muted-foreground',
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
  if (state === 'todo' || state === 'skipped') return 0
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
  const dashed = state === 'todo' || state === 'skipped'
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
            animate={drawn(state === 'done')}
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
