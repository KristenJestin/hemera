import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { cn } from 'cn'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { press, useHand, useTransition } from '../../motion.ts'
import { PROJECT_TONES, type ProjectTone } from '../../shell/model.ts'

/**
 * The five tones a Project is told apart by, offered as five dots (design D4-07).
 *
 * A radio group and not a row of buttons: one of them is chosen at a time, the arrows move
 * between them, the group is one stop of the tab order, and a screen reader says which is
 * which — all of which Base UI's own group does, so none of it is written here. The chosen
 * one wears a ring of the theme rather than a second shape, so the row stays five equal dots.
 */
const ROW = 'flex items-center gap-2'

const SWATCH =
  'size-5 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring'

const CHOSEN = 'outline-2 outline-primary'

const TONE: Record<ProjectTone, string> = {
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  neutral: 'bg-mission-free',
}

/** What each tone is called where a name is read rather than seen. */
const NAMED: Record<ProjectTone, string> = {
  primary: 'Pink',
  info: 'Blue',
  success: 'Green',
  warning: 'Amber',
  neutral: 'Grey',
}

export interface ToneSwatchesProps {
  value: ProjectTone
  onValueChange: (tone: ProjectTone) => void
  /** What the group is called to a screen reader; the field's own label, usually. */
  label?: string | undefined
}

export function ToneSwatches({
  value,
  onValueChange,
  label = 'Colour',
}: ToneSwatchesProps): ReactNode {
  const transition = useTransition(press)
  const hand = useHand()
  return (
    <RadioGroup
      className={ROW}
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        // SAFETY: the group only ever holds the five tones it renders, and `next` is the value
        // of the one that was chosen; Base UI types a group's value as whatever was passed.
        onValueChange(next as ProjectTone)
      }}
    >
      {PROJECT_TONES.map((tone) => (
        <Radio.Root
          key={tone}
          value={tone}
          // A real `<button>` is what motion renders and what the hand presses, and Base UI is
          // told so: left to guess, it adds the attributes a non-button would have needed.
          nativeButton
          aria-label={NAMED[tone]}
          className={cn(SWATCH, TONE[tone], tone === value && CHOSEN)}
          render={<motion.button ref={hand.element} whileTap={hand.tap} transition={transition} />}
        />
      ))}
    </RadioGroup>
  )
}
