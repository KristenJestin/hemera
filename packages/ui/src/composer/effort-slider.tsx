import { cn } from 'cn'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useId } from 'react'

import { IconChevronDown } from '../icons.ts'
import { morph, useTransition } from '../motion.ts'
import { type EffortProps, stepUnder, steppedBy } from './agent-model-menu-shared.tsx'
import { FILLED, HALO, KNOB, MARK, MARK_DONE, SCALE, TRACK, filledTo } from './effort-scale.ts'

/**
 * The effort as a vertical slider — variant 2 of three (trial of 22 September 2026).
 *
 * The same control as the dial, stood on end: a thin track with a dot on every step, the part
 * of it under the thumb filled in the accent, a round thumb on the step that is on, the agent's
 * word for that step over the top of it and what it is being set for under the bottom.
 *
 * **Why down and not across.** A scale of six steps read across a narrow panel gives each step
 * four characters and reads as six buttons; read down, it reads as what it is — more of
 * something at the top, less of it at the bottom — and the panel has height to spare where it
 * has no width at all. The highest effort is at the top, which is the one thing a vertical
 * scale is not allowed to get wrong: the fill grows up from the foot of the track.
 *
 * **One control, not a list of them.** It is a `slider`: it takes the focus once, says where it
 * stands in the agent's own word through `aria-valuetext` — "High", not "4 of 6" — and the
 * arrows walk it, with Home and End at the two ends. The notches are marks and answer the
 * pointer through the scale itself, because a notch that took the focus would be a second
 * control inside a control that already has a role.
 *
 * **What moves** is the thumb and the fill, both on `morph`: a thing changing place along a
 * track and a length changing with it, and `morph` is the spring that arrives without turning
 * round — a thumb that overshot its notch and came back would read as a value set and then
 * changed. Under the hand and under the focus the halo brightens and the thumb grows, which is
 * CSS and stops on its own where less movement was asked for.
 */

/** The whole control: the word, the track, and what the effort is being set for. */
const FRAME =
  'group flex shrink-0 flex-col items-center gap-1 rounded-md px-2 py-1.5 outline-none focus-ring aria-disabled:opacity-50'

/** Where it stands, in the agent's own word, over the top of the track and in the accent. */
const LEVEL = 'flex items-center gap-1 text-xs font-medium text-primary'

/** The mark that says the word over the track is what the track sets, and not a caption. */
const AFFORDANCE = 'flex text-primary'

/** What the effort is being set for, under it and quieter, because it is not what is being set. */
const CAPTION = 'max-w-full truncate text-xs text-muted-foreground'

/** The notches and the track they sit on, down — and `col-reverse`, so the first step is lowest. */
const COLUMN = 'relative flex flex-col-reverse items-center justify-between gap-2'

/** The room one notch is drawn in, which is the thumb's own size. */
const CELL = 'relative flex size-4 shrink-0 items-center justify-center'

/** The thumb: the step that is on, as a round surface over its notch. */
const THUMB = 'absolute inset-0'

export function EffortSlider({
  efforts,
  effort,
  onEffortChange,
  disabled,
  caption,
}: EffortProps): ReactNode {
  const thumb = useId()
  const transition = useTransition(morph)
  if (efforts.length === 0) return null

  const here = efforts.findIndex((one) => one.id === effort)
  const last = efforts.length - 1
  const current = efforts[here]

  return (
    /*
      One element with the role, the focus and the keys. `aria-disabled` and not `disabled`,
      which a div has no notion of: what is off is still read, and still says where it stands.
    */
    <div
      role="slider"
      aria-label="Effort"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={here === -1 ? 0 : here}
      aria-valuetext={current?.label ?? 'Not set'}
      aria-disabled={disabled === true ? true : undefined}
      tabIndex={disabled === true ? -1 : 0}
      className={FRAME}
      onKeyDown={(event) => {
        if (disabled === true) return
        const next = steppedBy(event.key, here === -1 ? 0 : here, last)
        if (next === null) return
        event.preventDefault()
        const one = efforts[next]
        if (one !== undefined) onEffortChange(one.id)
      }}
      onClick={(event) => {
        if (disabled === true) return
        const id = stepUnder(event.target)
        if (id !== null) onEffortChange(id)
      }}
    >
      <span className={LEVEL}>
        {current?.label ?? 'Effort'}
        <span aria-hidden="true" className={AFFORDANCE}>
          <IconChevronDown size="sm" />
        </span>
      </span>
      <span className={COLUMN}>
        {/* The track runs from the middle of the lowest notch to the middle of the highest,
            which is half a cell in from each end — so the fill ends on a notch, never past it. */}
        <span className={cn(TRACK, SCALE, 'inset-y-2 inset-x-0 mx-auto w-track')}>
          <motion.span
            className={cn(FILLED, 'bottom-0 left-0 w-full')}
            animate={{ height: filledTo(here, last) }}
            transition={transition}
          />
        </span>
        {efforts.map((one, index) => (
          <span key={one.id} data-step={one.id} className={CELL}>
            <span className={cn(MARK, index <= here && MARK_DONE)} />
            {one.id === effort && (
              <motion.span layoutId={thumb} transition={transition} className={THUMB}>
                <span className={HALO} />
                <span className={KNOB} />
              </motion.span>
            )}
          </span>
        ))}
      </span>
      {/* Only where there is one: a caption drawn empty is a line of nothing under a control. */}
      {caption !== undefined && <span className={CAPTION}>{caption}</span>}
    </div>
  )
}
