import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { IconFileText, IconX } from '../icons.ts'
import { MARK_TRAVEL, PRESSED_COMPACT, arrival, press, useTransition } from '../motion.ts'

/**
 * The files attached to what is being written, above the box (design D4-08).
 *
 * The prototype animates `grid-template-rows` here, which is a layout property and refused. The
 * same movement is made another way, and the way matters: the frame and its bands all carry
 * `layout`, so motion measures where each of them ended up and plays the difference as a
 * transform. This band rises into the room the frame just made for it rather than dropping onto
 * the box from above — a header that came down reads as something landing on the text.
 *
 * Leaving is where it is easy to get wrong, and where the first pass jumped: `popLayout` takes
 * the band out of the flow the moment it starts to go, so the frame closes over it smoothly
 * instead of holding its height and collapsing at the end.
 *
 * The files are named, not labelled: a row of file chips under a paperclip does not need the
 * word `Attached` to be understood.
 */
const HEAD = 'flex flex-wrap items-center gap-2 px-2.5 pt-1.5 pb-2'

/** A file, in the tone of something that is only referenced: it is not a state, it is a link. */
const CHIP =
  'inline-flex items-center gap-1.5 rounded-md bg-info-muted py-1 pr-1.5 pl-2 font-mono text-xs text-info-muted-foreground'

/** The one control of a chip, drawn at the size of the word beside it. */
const REMOVE = 'flex size-icon-md items-center justify-center rounded-sm hover:bg-info-muted'

export interface ComposerAttachmentsProps {
  /** The files chosen so far, as paths relative to the folder of the Workspace. */
  files: string[]
  onRemove: (file: string) => void
  onClear: () => void
}

/** What a path is called where only the name fits: the file, never the folders above it. */
function named(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function ComposerAttachments({
  files,
  onRemove,
  onClear,
}: ComposerAttachmentsProps): ReactNode {
  const transition = useTransition(arrival)
  const chip = useTransition(press)
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {files.length > 0 && (
        <motion.div
          key="attached"
          layout
          className={HEAD}
          initial={{ opacity: 0, y: MARK_TRAVEL }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: MARK_TRAVEL }}
          transition={transition}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {files.map((file) => (
              <motion.span
                key={file}
                layout
                className={CHIP}
                title={file}
                initial={{ opacity: 0, scale: PRESSED_COMPACT, y: MARK_TRAVEL }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: PRESSED_COMPACT }}
                transition={chip}
              >
                <IconFileText size="sm" />
                {named(file)}
                {/* Its own control rather than an `IconButton`: a control of the catalogue is
                    as tall as a control, and a chip built around one is a chip twice the size
                    of the word it carries. */}
                <button
                  type="button"
                  className={REMOVE}
                  aria-label={`Remove ${file}`}
                  onClick={() => onRemove(file)}
                >
                  <IconX size="sm" />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          <Button variant="link" size="sm" className="ml-auto" onClick={onClear}>
            Clear
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
