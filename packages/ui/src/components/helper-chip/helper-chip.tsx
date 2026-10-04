import type { ReactNode } from 'react'

import { LetterAvatar, type LetterTone } from '../letter-avatar/letter-avatar.tsx'
import { LIVE_WORDS } from '../live-chip/live-chip.tsx'
import { type LiveState, LiveTint, useSweep } from '../live-chip/tint.tsx'
import { Legend } from '../tooltip/legend.tsx'

/**
 * A helper, and only the helper: its letter avatar and its name.
 *
 * No dot: its state is its background, as on the live chip — a tint of the running tone
 * breathing while it works, one sweep in the colour of the state it changes to. Nothing on it is
 * pressed and there is no ×: nobody stops a helper by hand. The state in words is a tooltip on
 * the avatar, the one glyph of the chip.
 */
const CHIP =
  'relative isolate inline-flex h-control-sm max-w-chip min-w-0 items-center gap-1.5 overflow-hidden rounded-md border border-border bg-card px-2 text-xs'

const NAME = 'min-w-0 truncate font-medium'

export interface HelperChipProps {
  name: string
  /** Where the helper stands. */
  state: LiveState
  /** The names of the other helpers beside it, which decide its avatar's letters. */
  others?: readonly string[] | undefined
  /** The tone its definition gives its avatar. */
  tone?: LetterTone | undefined
}

export function HelperChip({ name, state, others, tone }: HelperChipProps): ReactNode {
  const sweep = useSweep(state)
  return (
    <span
      className={CHIP}
      data-helper-chip=""
      data-state={state}
      data-sweep-tone={sweep.swept ?? undefined}
    >
      <LiveTint state={state} sweep={sweep} />
      <Legend label={`${name}, ${LIVE_WORDS[state]}`}>
        <LetterAvatar name={name} others={others} tone={tone} />
      </Legend>
      <span className={NAME}>{name}</span>
    </span>
  )
}
