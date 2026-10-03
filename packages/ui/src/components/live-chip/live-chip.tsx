import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'

import { IconCheck, IconClockPause, IconPlayerStop, IconX } from '../../icons.ts'
import { CROSSFADE, WIPE, crossfade, instant, useTransition, wipe } from '../../motion.ts'
import { Tooltip } from '../tooltip/tooltip.tsx'

/**
 * What goes on, as one chip: a run, a helper and a Probe are the same chip, and differ only by
 * what fills its icon slot — a command's type icon, a helper's letter avatar.
 *
 * - Neutral: the chip's own surface, edge and text, and no dot.
 * - Its duration in seconds and nothing else (`84s`), in fixed-width digits and in a room kept
 *   for three of them, so the chip does not grow as a digit arrives; the seconds are never cut,
 *   a long name ends in "…" instead.
 * - Working, a faint tint breathes across its background.
 * - Stuck — no event for five minutes in the middle of a turn — the breath stops, the seconds go
 *   on, and its icon gives way to a paused clock in the warning tone.
 * - Ending while it is watched, one sweep crosses it in the tint it ended on, and the chip is
 *   neutral again: nothing tinted lasts. Its icon gives way to ✓ or ✕, the only thing coloured;
 *   stopped, a quiet stop glyph. The icon keeps its room, so nothing on the line moves.
 * - Its legend — the whole name and the state in words — is its tooltip.
 *
 * There is no × on the chip: nobody stops a helper or a Probe by hand, and a run's ×, which stops
 * the run, belongs to the line of the page the chip stands on.
 *
 * Asked for less movement, there is no breath and no sweep: the end is there at once.
 */

export type LiveState = 'running' | 'stuck' | 'finished' | 'failed' | 'stopped'

/** How each state is said to a screen reader, after the name. */
export const LIVE_WORDS: Record<LiveState, string> = {
  running: 'running',
  stuck: 'no activity',
  finished: 'done',
  failed: 'failed',
  stopped: 'stopped',
}

/** How long without an event a chip is said to be stuck, in the words of its legend. */
export const STUCK_AFTER = '5 minutes'

const CHIP =
  'relative isolate inline-flex h-control-sm max-w-chip min-w-0 items-center gap-1.5 overflow-hidden rounded-md border border-border bg-card px-2 text-xs outline-none hover:bg-accent focus-ring'

/** What says it works: the whole background, a faint tint breathing. */
const BREATH =
  'pointer-events-none absolute inset-0 -z-10 bg-warning-muted motion-safe:animate-breathe'

const SWEPT: Record<'finished' | 'failed', string> = {
  finished: 'pointer-events-none absolute inset-0 -z-10 bg-success-muted',
  failed: 'pointer-events-none absolute inset-0 -z-10 bg-destructive-muted',
}

/** The icon's room, held by the chip's own icon whether it shows or not. */
const MARK = 'relative flex shrink-0'

const OWN = 'flex text-muted-foreground'

/** What stands in the icon's room once it does not say "working" any more. */
type Shown = Exclude<LiveState, 'running'>

const ENDED: Record<Shown, string> = {
  stuck: 'absolute inset-0 flex items-center justify-center text-warning',
  finished: 'absolute inset-0 flex items-center justify-center text-success',
  failed: 'absolute inset-0 flex items-center justify-center text-destructive',
  stopped: 'absolute inset-0 flex items-center justify-center text-muted-foreground',
}

const GLYPHS: Record<Shown, ReactNode> = {
  stuck: <IconClockPause size="sm" aria-hidden="true" />,
  finished: <IconCheck size="sm" aria-hidden="true" />,
  failed: <IconX size="sm" aria-hidden="true" />,
  stopped: <IconPlayerStop size="sm" aria-hidden="true" />,
}

const NAME = 'min-w-0 truncate font-medium'

/** Three digits and the unit, set against its end; a fourth digit widens it. */
const TIME = 'min-w-8 shrink-0 text-right font-mono text-muted-foreground tabular-nums'

/** A duration in seconds and nothing else, the unit against the number: `1s`, `84s`, `1200s`. */
export function durationOf(ms: number): string {
  return `${String(Math.max(0, Math.floor(ms / 1000)))}s`
}

/** What the chip's legend says after its name. */
function legendOf(state: LiveState, time: string): string {
  if (state === 'stuck') return `no activity for ${STUCK_AFTER}`
  if (state === 'finished') return `done in ${time}`
  if (state === 'failed') return `failed after ${time}`
  return LIVE_WORDS[state]
}

/** The time now, read again every second while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [ticking])
  return now
}

export interface LiveChipProps {
  /** The whole name, which the chip ends in an ellipsis when it is long. */
  name: string
  /** The slot: a command's type icon, a helper's letter avatar. */
  icon: ReactNode
  state: LiveState
  /** When it started, in milliseconds since the epoch. */
  startedAt: number
  /** When it ended; null while it works or is stuck, and the seconds tick. */
  endedAt: number | null
  /** What pressing the chip does: open what it stands for. */
  onPress?: (() => void) | undefined
}

/** The chip's icon, or the glyph its state shows instead, in the same room. */
function Mark({ icon, shown }: { icon: ReactNode; shown: LiveState }): ReactNode {
  const fade = useTransition(crossfade)
  const instead = shown === 'running' ? null : shown
  return (
    <span className={MARK}>
      <motion.span
        className={OWN}
        initial={false}
        animate={instead === null ? CROSSFADE.to : CROSSFADE.from}
        transition={fade}
      >
        {icon}
      </motion.span>
      <AnimatePresence initial={false}>
        {instead !== null && (
          <motion.span
            key={instead}
            className={ENDED[instead]}
            data-end={instead}
            initial={CROSSFADE.from}
            animate={CROSSFADE.to}
            exit={CROSSFADE.from}
            transition={fade}
          >
            {GLYPHS[instead]}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

export function LiveChip({
  name,
  icon,
  state,
  startedAt,
  endedAt,
  onPress,
}: LiveChipProps): ReactNode {
  const crossing = useTransition(wipe)
  const now = useNow(endedAt === null)

  // Ended while it was watched, it is swept once in the tint it ended on. Decided as the state
  // changes, during the render, so the end's glyph never shows for a frame before the sweep.
  const [seen, setSeen] = useState(state)
  const [sweeping, setSweeping] = useState(false)
  if (seen !== state) {
    setSeen(state)
    setSweeping(
      (seen === 'running' || seen === 'stuck') &&
        (state === 'finished' || state === 'failed') &&
        crossing !== instant,
    )
  }

  const time = durationOf((endedAt ?? now) - startedAt)
  const shown = sweeping ? 'running' : state

  return (
    <Tooltip label={`${name} · ${legendOf(state, time)}`}>
      <button
        type="button"
        className={CHIP}
        aria-label={`${name}, ${LIVE_WORDS[state]}`}
        data-state={state}
        onClick={() => onPress?.()}
      >
        {state === 'running' && <span aria-hidden="true" className={BREATH} data-breath="" />}
        {/* A presence of its own: on a line whose presence skips what is there at first, the
            sweep would otherwise start where it ends, and never cross. */}
        <AnimatePresence>
          {sweeping && (state === 'finished' || state === 'failed') && (
            <motion.span
              key="sweep"
              aria-hidden="true"
              className={SWEPT[state]}
              data-sweep=""
              initial={WIPE.before}
              animate={WIPE.past}
              transition={crossing}
              onAnimationComplete={() => setSweeping(false)}
            />
          )}
        </AnimatePresence>
        <Mark icon={icon} shown={shown} />
        <span className={NAME}>{name}</span>
        <span className={TIME}>{time}</span>
      </button>
    </Tooltip>
  )
}
