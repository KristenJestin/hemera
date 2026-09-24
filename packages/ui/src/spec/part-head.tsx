import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'

import { crossfade, useTransition } from '../motion.ts'
import type { Mark } from './model.ts'

/**
 * The top of a part of the Spec document: its mark in the margin, its name, and one quiet line
 * of facts beside it (revision 2 of the brief, "No outline: the Spec is a document").
 *
 * The facts say who wrote it and at which version — `agent · v3`, `you · v4 · sent to the agent
 * next turn` — and whatever the part offers on its own sits at the end of them, as small as they
 * are: a preview toggle, nothing bigger. `saved` flashes among them for a second after a save,
 * and is the whole of the confirmation: a save asked for by leaving the field does not need a
 * toast to say it happened.
 */

/** What each mark says to whoever cannot see it. */
export const MARK_WORDS: Record<Mark, string> = {
  empty: 'empty',
  agent: 'written by the agent',
  human: 'edited by you',
  stale: 'to review',
  conflict: "your text and the agent's differ",
  writing: 'the agent is writing this',
}

/**
 * The dot in the margin: an empty ring, the muted foreground of a written text, the primary edge
 * of a human hand, amber when stale, red in conflict, and the primary pulse of a text being
 * written — the only one that moves, on the breath of every running thing in the window, and
 * not at all under reduced motion.
 */
const MARKS: Record<Mark, string> = {
  empty: 'size-1.5 rounded-full border border-input',
  agent: 'size-1.5 rounded-full bg-muted-foreground',
  human: 'size-1.5 rounded-full bg-muted-foreground outline outline-offset-1 outline-primary',
  stale: 'size-1.5 rounded-full bg-warning',
  conflict: 'size-1.5 rounded-full bg-destructive',
  writing: 'size-1.5 rounded-full bg-primary motion-safe:animate-breathe',
}

/** The box the dot sits in, in the margin left of the heading, so the headings line up. */
const MARK_BOX = 'absolute top-2 -left-4 flex size-2 items-center justify-center'

export function StateMark({ mark }: { mark: Mark }): ReactNode {
  return (
    <span className={MARK_BOX} aria-hidden="true">
      <span className={MARKS[mark]} />
    </span>
  )
}

const HEAD = 'relative flex flex-wrap items-baseline gap-x-3 gap-y-0.5'

const HEADING = 'text-base font-semibold'

const META =
  'ml-auto flex min-h-control-sm items-center gap-1.5 text-xs font-medium text-muted-foreground'

const SAVED = 'text-success-muted-foreground'

/** How long `saved` stays among the facts, in milliseconds: a second, as the brief says. */
export const SAVED_FOR = 1000

export interface PartHeadProps {
  title: string
  mark: Mark
  /** The facts, in order; the line draws the dots between them. */
  facts: ReactNode[]
  /** Counts up on every save, and every change of it flashes `saved`. */
  saves?: number | undefined
  /** What stands at the end of the line: the preview toggle of a section. */
  end?: ReactNode
}

export function PartHead({ title, mark, facts, saves = 0, end }: PartHeadProps): ReactNode {
  const transition = useTransition(crossfade)
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (saves === 0) return
    setFlashing(true)
    const done = setTimeout(() => setFlashing(false), SAVED_FOR)
    return () => clearTimeout(done)
  }, [saves])
  return (
    <div className={HEAD}>
      <StateMark mark={mark} />
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
        <AnimatePresence initial={false}>
          {flashing && (
            <motion.span
              key="saved"
              role="status"
              className={SAVED}
              initial={{ filter: 'opacity(0)' }}
              animate={{ filter: 'opacity(1)' }}
              exit={{ filter: 'opacity(0)' }}
              transition={transition}
            >
              · saved
            </motion.span>
          )}
        </AnimatePresence>
        {end !== undefined && <span className="flex">{end}</span>}
      </p>
    </div>
  )
}
