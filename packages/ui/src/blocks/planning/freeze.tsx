import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import type { FreezeOffer } from './planning-progress.ts'

/** The id of the line under Freeze, which describes it. */
const NOTE = 'planning-freeze-note'

/** The id Freeze carries, for the Now line to bring the user to it. */
export const FREEZE_ID = 'planning-freeze'

export interface FreezeProps {
  offer: FreezeOffer
  /** Why the last Freeze was refused, each reason in words. */
  refused?: readonly string[] | undefined
  onFreeze: () => void
}

/** What the line under Freeze says: the refusal first, else what is left, else nothing. */
function noteOf(offer: FreezeOffer, refused: readonly string[] | undefined): string | null {
  if (!offer.shown) return null
  if (refused !== undefined && refused.length > 0) return `Not frozen: ${refused.join(' · ')}`
  return offer.reasons.length === 0 ? null : offer.reasons.join(' · ')
}

/**
 * Freeze in the mission's head, from the declaration of the Spec on: disabled while something
 * must end first, enabled once nothing is left; never there and gone without a word.
 */
export function FreezeButton({ offer, refused, onFreeze }: FreezeProps): ReactNode {
  if (!offer.shown) return undefined
  const note = noteOf(offer, refused)
  return (
    <span id={FREEZE_ID} className="flex" data-focus-inside="">
      <Button
        variant="primary"
        size="sm"
        disabled={offer.reasons.length > 0}
        aria-describedby={note === null ? undefined : NOTE}
        onClick={onFreeze}
      >
        Freeze
      </Button>
    </span>
  )
}

/** The line under Freeze: what is left before it, or why it was refused. */
export function FreezeNote({ offer, refused }: Omit<FreezeProps, 'onFreeze'>): ReactNode {
  const note = noteOf(offer, refused)
  if (note === null) return undefined
  const refusing = refused !== undefined && refused.length > 0
  return (
    <p
      id={NOTE}
      className={
        refusing
          ? 'text-right text-xs break-words text-destructive-muted-foreground'
          : 'text-right text-xs break-words text-muted-foreground'
      }
    >
      {note}
    </p>
  )
}
