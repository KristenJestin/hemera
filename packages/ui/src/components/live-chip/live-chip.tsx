import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'

import { IconCheck, IconClockPause, IconPlayerStop, IconX } from '../../icons.ts'
import { CROSSFADE, crossfade, useTransition } from '../../motion.ts'
import { Tooltip } from '../tooltip/tooltip.tsx'
import { type LiveState, LiveTint, useSweep } from './tint.tsx'

/**
 * What goes on, as one chip: a run, a helper and a Probe are the same chip, and differ only by what
 * fills its icon slot — the type of what runs: a command's type icon, a helper's letter avatar.
 *
 * - Neutral: the chip's own surface, edge and text, and no dot.
 * - Its duration in seconds and nothing else (`84s`), in fixed-width digits and in a room kept
 *   for three of them, so the chip does not grow as a digit arrives; the seconds are never cut,
 *   a long name ends in "…" instead.
 * - Working, a tint of the running tone breathes across its background (`LiveTint`).
 * - Every change from working plays one sweep in the colour of the state it changes to — stuck
 *   in the warning tone, done in the success tone, failed in the destructive one, stopped in the
 *   neutral accent — and the chip is neutral again: nothing tinted lasts. Its icon gives way to
 *   that state's glyph as the sweep sets off: a paused clock, ✓, ✕, a quiet stop. The icon keeps
 *   its room, so nothing on the line moves.
 * - Stuck — no event for five minutes in the middle of a turn — the breath stops and the seconds
 *   go on.
 * - Its legend — the whole name and the state in words — is its tooltip.
 *
 * There is no × on the chip: nobody stops a helper or a Probe by hand, and a run's ×, which stops
 * the run, belongs to the line of the page the chip stands on.
 *
 * Asked for less movement, there is no breath and no sweep: the end is there at once.
 */

export type { LiveState } from './tint.tsx'

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

/** What the chip's legend says after its name; without seconds, the state alone. */
function legendOf(state: LiveState, time: string | null): string {
  if (state === 'stuck') return `no activity for ${STUCK_AFTER}`
  if (time === null) return LIVE_WORDS[state]
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
  /**
   * When it started, in milliseconds since the epoch. Left out, the chip shows no seconds: a
   * helper's chip shows the helper and nothing else.
   */
  startedAt?: number | undefined
  /** When it ended; null or left out while it works or is stuck, and the seconds tick. */
  endedAt?: number | null | undefined
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
  const now = useNow(startedAt !== undefined && (endedAt ?? null) === null)
  const sweep = useSweep(state)
  const time = startedAt === undefined ? null : durationOf((endedAt ?? now) - startedAt)

  return (
    <Tooltip label={`${name} · ${legendOf(state, time)}`}>
      <button
        type="button"
        className={CHIP}
        aria-label={`${name}, ${LIVE_WORDS[state]}`}
        data-live-chip=""
        data-state={state}
        data-sweep-tone={sweep.swept ?? undefined}
        onClick={() => onPress?.()}
      >
        <LiveTint state={state} sweep={sweep} />
        <Mark icon={icon} shown={state} />
        <span className={NAME}>{name}</span>
        {time !== null && <span className={TIME}>{time}</span>}
      </button>
    </Tooltip>
  )
}
