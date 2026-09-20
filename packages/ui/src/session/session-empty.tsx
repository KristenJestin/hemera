import type { ReactNode } from 'react'

import { IconMessage } from '../icons.ts'

/**
 * A Session with nothing in it yet, which says so and invents nothing (design D4b-09).
 *
 * The scenario « Aucune Session » asks for an empty state that offers the next step without
 * showing a message nobody wrote. So there is one sentence about what happens when the first
 * one is sent — the Session takes its name from it — and one about what this place is: what is
 * written here is kept, with or without an agent. The composer is underneath, in the page: it
 * is what this state points at, and drawing a second one here would be two boxes to type into.
 */
const EMPTY = 'flex flex-col items-center gap-2 py-16 text-center'

const SQUARE =
  'flex size-control-lg items-center justify-center rounded-lg bg-accent text-muted-foreground'

export function SessionEmpty(): ReactNode {
  return (
    <div className={EMPTY}>
      <span className={SQUARE}>
        <IconMessage size="md" />
      </span>
      <p className="font-medium">Nothing written yet</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Your first message names the Session for you. Everything you write here is kept, whether or
        not an agent ever joins.
      </p>
    </div>
  )
}
