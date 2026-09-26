import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { InPlaceText } from './in-place-text.tsx'
import type { SpecType } from './model.ts'
import { SPEC_TYPE_ICONS } from './spec-icons.ts'

/**
 * The agent proposing a Spec, in the thread of a `free` Session (lot 19, brief revision 2, "No
 * empty state"; D7-07).
 *
 * A `define` Session never exists without its Spec, so there is no empty panel to fill: the
 * conversation is where a Spec begins. The agent says what it understood — a title, editable in
 * place, and a type, one of three chips — and the reader answers `Create` or `Not now`. Created,
 * the Session becomes `define`, the panel opens beside the thread, and the thread stays as it is.
 *
 * Once answered, the block folds to the line that says what happened.
 */

const CARD = 'flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3'

const ASK = 'text-sm text-muted-foreground'

const TYPES = 'flex gap-1.5'

const TYPE =
  'flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium outline-none focus-ring hover:border-primary'

const TYPE_ON = 'border-primary bg-primary-muted text-primary-muted-foreground'

const TYPE_OFF = 'border-border text-muted-foreground'

const FOLDED = 'text-sm text-muted-foreground'

const ALL_TYPES: readonly SpecType[] = ['feature', 'bug', 'maintenance']

/** Where the proposal stands: waiting for the reader, or answered one way or the other. */
export type ProposalState = 'proposed' | 'created' | 'declined'

export interface CreateSpecProposalProps {
  /** The title the agent understood. */
  title: string
  /** The type the agent understood. */
  type: SpecType
  state?: ProposalState | undefined
  /** The key the Spec was given, once created: `ATL-7`. */
  createdKey?: string | undefined
  /** Creates the Spec with the title and the type as the reader left them. */
  onCreate: (title: string, type: SpecType) => void
  onDecline: () => void
}

export function CreateSpecProposal({
  title: proposed,
  type: understood,
  state = 'proposed',
  createdKey,
  onCreate,
  onDecline,
}: CreateSpecProposalProps): ReactNode {
  const [title, setTitle] = useState(proposed)
  const [type, setType] = useState(understood)
  if (state === 'created') {
    return (
      <p role="status" className={FOLDED}>
        {`Created ${createdKey ?? 'the Spec'} « ${title} » · ${type} · this Session defines it now`}
      </p>
    )
  }
  if (state === 'declined') {
    return <p className={FOLDED}>{`Not now: « ${title} » was not created.`}</p>
  }
  return (
    <div role="group" aria-label="Create a Spec" className={CARD}>
      <p className={ASK}>Create the Spec</p>
      <InPlaceText label="Title of the Spec" value={title} onCommit={setTitle} />
      <div role="radiogroup" aria-label="Type" className={TYPES}>
        {ALL_TYPES.map((one) => (
          <button
            key={one}
            type="button"
            role="radio"
            aria-checked={one === type}
            className={cn(TYPE, one === type ? TYPE_ON : TYPE_OFF)}
            onClick={() => setType(one)}
          >
            <TypeIcon type={one} />
            {one}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDecline}>
          Not now
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => onCreate(title.trim() === '' ? proposed : title.trim(), type)}
        >
          Create
        </Button>
      </div>
    </div>
  )
}

/** The glyph of a type, beside its word on the chip (issue #130). */
function TypeIcon({ type }: { type: SpecType }): ReactNode {
  const Icon = SPEC_TYPE_ICONS[type]
  return <Icon size="sm" aria-hidden="true" />
}
