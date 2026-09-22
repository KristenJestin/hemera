import { cn } from 'cn'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useId } from 'react'

import { IconChevronDown } from '../icons.ts'
import { morph, useTransition } from '../motion.ts'
import { type EffortProps, stepUnder, steppedBy } from './agent-model-menu-shared.tsx'
import { FILLED, HALO, KNOB, MARK, MARK_DONE, SCALE, TRACK, filledTo } from './effort-scale.ts'

/**
 * The effort as a horizontal dial — variant 3 of three, and the maintainer's reference.
 *
 * A thin track with a dot on every step, the part of it behind the reader filled in the accent,
 * a round thumb on the step that is on, the agent's word for that step over the middle of it,
 * and what the effort is being set for — the model — under it. It is the shape the maintainer
 * brought back from another application, and what it buys over the row is that the step that is
 * on is said *once*, in full, instead of every step being written out and each of them cut to
 * four characters.
 *
 * **The fill is the value.** A dial whose only mark was the thumb would say where the thumb is
 * and not how much of the scale that is; the filled length is what is read at a glance, and the
 * word over it is what is read when the glance stops.
 *
 * **One control, not a list of them.** Same contract as the vertical slider: a `slider` that
 * takes the focus once, says where it stands in the agent's own word through `aria-valuetext`,
 * and is walked by the arrows with Home and End at the two ends. The dots are marks; the scale
 * itself is what answers the pointer.
 *
 * **What moves** is the thumb and the fill, both on `morph`, which is the spring made for a
 * dimension and the one that arrives without turning round — a thumb that overshot its dot and
 * came back would read as a value set and then changed. The two lines of type do not travel
 * with it: they are centred over and under the whole dial and change where the thumb lands,
 * because a word sliding along a row of dots is the one thing that would make this read as two
 * controls instead of one. Under the hand and under the focus the halo brightens and the thumb
 * grows, which is CSS and stops on its own where less movement was asked for.
 */

/** The whole control: the word, the dial, and what the effort is being set for. */
const FRAME =
  'group flex w-full min-w-menu-agents shrink-0 flex-col items-center gap-1 rounded-md px-2 py-1.5 outline-none focus-ring aria-disabled:opacity-50'

/** Where it stands, in the agent's own word, over the middle of the dial and in the accent. */
const LEVEL = 'flex items-center gap-1 text-xs font-medium text-primary'

/** The mark that says the word over the dial is what the dial sets, and not a caption. */
const AFFORDANCE = 'flex text-primary'

/** What the effort is being set for, under it and quieter, because it is not what is being set. */
const CAPTION = 'max-w-full truncate text-xs text-muted-foreground'

/** The dots and the track they sit on, across. */
const DIAL = 'relative flex w-full items-center justify-between'

/** The room one dot is drawn in, which is the thumb's own size. */
const CELL = 'relative flex size-4 shrink-0 items-center justify-center'

/** The thumb: the step that is on, as a round surface over its dot. */
const THUMB = 'absolute inset-0'

export function EffortDial({
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
    <div
      role="slider"
      aria-label="Effort"
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
      <span className={DIAL}>
        {/* The track runs from the middle of the first dot to the middle of the last, which is
            half a cell in from each end — so the fill ends on a dot and never past one. */}
        <span className={cn(TRACK, SCALE, 'inset-x-2 inset-y-0 my-auto h-track')}>
          <motion.span
            className={cn(FILLED, 'top-0 left-0 h-full')}
            animate={{ width: filledTo(here, last) }}
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
