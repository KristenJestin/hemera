import type { ReactNode } from 'react'

import { LetterAvatar, type LetterTone } from '../letter-avatar/letter-avatar.tsx'
import { LiveChip, type LiveState } from '../live-chip/live-chip.tsx'

/**
 * A helper, as a live chip: its letter avatar in the icon slot, its name, and no seconds. The
 * breath, the sweeps, the glyph of each state and the tooltip — the helper's name and its state —
 * are the live chip's own. There is no ×: nobody stops a helper by hand.
 */
export interface HelperChipProps {
  name: string
  /** Where the helper stands. */
  state: LiveState
  /** The names of the other helpers beside it, which decide its avatar's letters. */
  others?: readonly string[] | undefined
  /** The tone its definition gives its avatar. */
  tone?: LetterTone | undefined
  /** What pressing the chip does: open the helper. */
  onPress?: (() => void) | undefined
}

export function HelperChip({ name, state, others, tone, onPress }: HelperChipProps): ReactNode {
  return (
    <LiveChip
      name={name}
      icon={<LetterAvatar name={name} others={others} tone={tone} />}
      state={state}
      onPress={onPress}
    />
  )
}
