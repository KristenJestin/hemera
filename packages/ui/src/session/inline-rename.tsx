import { cn } from 'cn'
import { type ReactNode, useRef, useState } from 'react'

import { committedTitle } from './model.ts'

/**
 * The box a title becomes while it is being renamed (design D4b-03).
 *
 * The same three keys wherever a Session is renamed — the header of a page and a row of the
 * sidebar — so they are written once: Enter keeps what was typed, Escape leaves the title
 * where it was, and leaving the box keeps it too, because a rename abandoned by clicking
 * somewhere else is a rename that was finished with the hand.
 *
 * It is a plain control and not the catalogue's `Input`: a field draws a label above itself and
 * a rename has one already — the title it is replacing, in its own place, at its own size.
 * The caller says how it is drawn so that it lands where the title was.
 */
const BOX =
  'min-w-0 flex-1 rounded-md border border-input bg-muted px-2 py-0.5 text-foreground outline-none focus-ring'

export interface InlineRenameProps {
  /** The title being renamed, which is also what an empty box goes back to. */
  title: string
  /** What the box is called, since the title it replaces is no longer there to say it. */
  label: string
  /** What the Session is now called; not called at all when nothing changed. */
  onRename: (title: string) => void
  /** Said when the rename is over, whichever way it ended. */
  onDone: () => void
  /** Where the box sits and at what size; never how it looks. */
  className?: string | undefined
}

export function InlineRename({
  title,
  label,
  onRename,
  onDone,
  className,
}: InlineRenameProps): ReactNode {
  const [typed, setTyped] = useState(title)
  // Escape takes the box away, and a control taken away is a control that may still hand its
  // blur over on the way out. Once is once: the second ending is the one that would commit what
  // Escape just refused.
  const ended = useRef(false)

  const end = (next: string) => {
    if (ended.current) return
    ended.current = true
    if (next !== title) onRename(next)
    onDone()
  }

  return (
    <input
      // The caret is in it the moment it appears: what opened it was Enter, F2 or a click on
      // the title, and every one of those is a hand already aiming at the words.
      autoFocus
      type="text"
      aria-label={label}
      className={cn(BOX, className)}
      value={typed}
      onChange={(event) => setTyped(event.target.value)}
      onBlur={() => end(committedTitle(typed, title))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          end(committedTitle(typed, title))
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          end(title)
        }
      }}
    />
  )
}
