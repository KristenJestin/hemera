import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'

import { IconBell, IconCheck, IconClockPause, IconPlayerStop, IconX } from '../../icons.ts'
import { CROSSFADE, crossfade, useTransition } from '../../motion.ts'
import { Popover } from '../popover/popover.tsx'
import { Tooltip } from '../tooltip/tooltip.tsx'
import { type LiveGlance, LiveChipGlance } from './live-chip-glance.tsx'
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
  'relative isolate inline-flex h-control-sm max-w-chip shrink-0 items-center gap-1.5 overflow-hidden rounded-md border border-border bg-card px-2 text-xs outline-none hover:tinted focus-ring hover-motion'

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

/** The name takes what room is left, and never less than a few words: it ends in an ellipsis. */
const NAME = 'min-w-chip-name flex-1 truncate text-left font-medium'

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
  /**
   * What pressing the chip opens: its glance, with everything about it and its actions. A page
   * shows the chip alone, never a Restart or a Stop beside it.
   */
  glance?: LiveGlance | undefined
  /** What pressing a chip without a glance does. */
  onPress?: (() => void) | undefined
  /**
   * Whether it waits for the user — proposals to review, a stop to answer: its mark is a bell in
   * the warning tone, in the room of its state's glyph; done with nothing waiting is the green
   * check. The mark tells the two apart, so nothing stands beside the chip.
   */
  calls?: boolean | undefined
}

const CALLS_GLYPH = <IconBell size="sm" aria-hidden="true" />

const CALLING = 'absolute inset-0 flex items-center justify-center text-warning'

/** The chip's icon, or the glyph its state shows instead, in the same room. */
function Mark({
  icon,
  shown,
  calls,
}: {
  icon: ReactNode
  shown: LiveState
  /** What waits for the user stands in the glyph's room, in the warning tone. */
  calls: boolean
}): ReactNode {
  const fade = useTransition(crossfade)
  const instead = calls ? 'calls' : shown === 'running' ? null : shown
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
            className={instead === 'calls' ? CALLING : ENDED[instead]}
            data-end={instead === 'calls' ? shown : instead}
            data-calls={instead === 'calls' ? '' : undefined}
            initial={CROSSFADE.from}
            animate={CROSSFADE.to}
            exit={CROSSFADE.from}
            transition={fade}
          >
            {instead === 'calls' ? CALLS_GLYPH : GLYPHS[instead]}
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
  glance,
  onPress,
  calls = false,
}: LiveChipProps): ReactNode {
  const now = useNow(endedAt === null)
  const sweep = useSweep(state)
  const time = durationOf((endedAt ?? now) - startedAt)

  const chip = (
    <button
      type="button"
      className={CHIP}
      aria-label={`${name}, ${LIVE_WORDS[state]}${calls ? ', waits for you' : ''}`}
      data-live-chip=""
      data-state={state}
      data-sweep-tone={sweep.swept ?? undefined}
      onClick={glance === undefined ? () => onPress?.() : undefined}
    >
      <LiveTint state={state} sweep={sweep} />
      <Mark icon={icon} shown={state} calls={calls} />
      <span className={NAME} data-name="">
        {name}
      </span>
      <span className={TIME}>{time}</span>
    </button>
  )
  // With a glance, the glance is the legend, and more: the chip opens it rather than a tooltip.
  if (glance !== undefined) {
    return (
      <Popover trigger={chip} label={name} align="start">
        <LiveChipGlance name={name} state={state} time={time} glance={glance} />
      </Popover>
    )
  }
  return <Tooltip label={`${name} · ${legendOf(state, time)}`}>{chip}</Tooltip>
}
