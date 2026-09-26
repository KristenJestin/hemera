import type { ReactNode } from 'react'

import type { Mark } from './model.ts'

/**
 * The top of a part of the Spec document: its name, and one quiet line of facts beside it. The
 * heading is the title alone: the rail already says the part's state, and the facts say who wrote
 * it, so no dot stands in the margin; the state is said in words to a screen reader alone
 * (revision 2 of the brief, "No outline: the Spec is a document").
 *
 * The facts say who wrote it and what is happening to it — `you`, `writing…`, `to review`.
 */

/** What each mark says to whoever cannot see it. */
export const MARK_WORDS: Record<Mark, string> = {
  empty: 'empty',
  agent: 'written by the agent',
  human: 'edited by you',
  stale: 'to review',
  writing: 'the agent is writing this',
}

const HEAD = 'flex flex-wrap items-baseline gap-x-3 gap-y-0.5'

const HEADING = 'text-base font-semibold'

const META =
  'ml-auto flex min-h-control-sm items-center gap-1.5 text-xs font-medium text-muted-foreground'

export interface PartHeadProps {
  title: string
  mark: Mark
  /** The facts, in order; the line draws the dots between them. */
  facts: ReactNode[]
}

export function PartHead({ title, mark, facts }: PartHeadProps): ReactNode {
  return (
    <div className={HEAD}>
      <h3 className={HEADING}>
        {title}
        <span className="sr-only">{`, ${MARK_WORDS[mark]}`}</span>
      </h3>
      <p className={META}>
        {facts.map((fact, index) => (
          // A fact is a position in the line, and two of them can say the same word.
          <span key={index} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden="true">·</span>}
            {fact}
          </span>
        ))}
      </p>
    </div>
  )
}
