import type { ReactNode } from 'react'

import { LetterAvatar, type LetterTone } from '../letter-avatar/letter-avatar.tsx'
import { StatusDot, type StatusTone } from '../status-dot/status-dot.tsx'
import { Legend } from '../tooltip/legend.tsx'

/**
 * A helper, and only the helper: its letter avatar, its name, a state dot.
 *
 * Nothing on it is pressed and there is no ×: nobody stops a helper by hand. The dot is the one
 * glyph whose meaning is not written beside it, so its legend is a tooltip on the dot.
 */
const CHIP =
  'inline-flex h-control-sm max-w-chip min-w-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs'

const NAME = 'min-w-0 truncate font-medium'

/** What each state of a helper is said as, in its legend. */
export const HELPER_LEGENDS: Record<StatusTone, string> = {
  pending: 'Waiting',
  running: 'Running',
  success: 'Done',
  failure: 'Failed',
  cancelled: 'Cancelled',
}

export interface HelperChipProps {
  name: string
  /** Where the helper stands. */
  status: StatusTone
  /** The names of the other helpers beside it, which decide its avatar's letters. */
  others?: readonly string[] | undefined
  /** The tone its definition gives its avatar. */
  tone?: LetterTone | undefined
}

export function HelperChip({ name, status, others, tone }: HelperChipProps): ReactNode {
  return (
    <span className={CHIP} data-helper-chip="">
      <LetterAvatar name={name} others={others} tone={tone} />
      <span className={NAME}>{name}</span>
      <Legend label={HELPER_LEGENDS[status]}>
        <StatusDot status={status} />
      </Legend>
    </span>
  )
}
