import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'

import { crossfade, useTransition } from '../motion.ts'

/**
 * The top of what the stage shows: its name as a heading, and one quiet line of facts under it
 * (lot 19, brief "Stage").
 *
 * The line says who wrote it and at which version — `agent · v3`, `you · v4 · sent to the agent
 * next turn` — and whatever the item offers on its own sits at the end of it, as small as the
 * facts are: a preview toggle, nothing bigger. `saved` flashes in it for a second after a save,
 * and is the whole of the confirmation: a save that was asked for by leaving the field does not
 * need a toast to say it happened.
 */

const HEADING = 'text-base font-semibold'

const META = 'flex min-h-control-sm items-center gap-1.5 text-xs font-medium text-muted-foreground'

const SAVED = 'text-success-muted-foreground'

/** How long `saved` stays in the line, in milliseconds: a second, as the brief says. */
export const SAVED_FOR = 1000

export interface StageHeadProps {
  title: string
  /** The facts, in order; the line draws the dots between them. */
  facts: ReactNode[]
  /** Counts up on every save, and every change of it flashes `saved`. */
  saves?: number | undefined
  /** What stands at the end of the line: the preview toggle of a section. */
  end?: ReactNode
}

export function StageHead({ title, facts, saves = 0, end }: StageHeadProps): ReactNode {
  const transition = useTransition(crossfade)
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (saves === 0) return
    setFlashing(true)
    const done = setTimeout(() => setFlashing(false), SAVED_FOR)
    return () => clearTimeout(done)
  }, [saves])
  return (
    <div className="flex flex-col">
      <h3 className={HEADING}>{title}</h3>
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
        {end !== undefined && <span className="ml-auto flex">{end}</span>}
      </p>
    </div>
  )
}
