import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react'

import { IconButton } from '../../components/button/button.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconX } from '../../icons.ts'
import { CROSSFADE, SHEET, crossfade, sheet, useTransition } from '../../motion.ts'

/**
 * A sheet over the settings: where one thing of a section — a repository, a command, a step, a
 * variable — is written, and saved or let go.
 *
 * The same sheet a mission's views are: a solid surface slid in from the right edge on the `sheet`
 * kind, its own line and shadow on that edge, its head an icon, a title and an × with Escape on
 * it, over a scrim on `crossfade` that a press closes. It is narrow, because what it holds is a
 * form, and it has no expand: a form has no sub-view to grow into. Its foot is the form's own
 * buttons, under a rule, always in sight while the body scrolls.
 *
 * The focus goes to the title as it opens and back to what opened it as it closes; while it
 * stands, the page under it is out of reach (the caller makes it `inert`).
 */
export interface SettingsSheetContent {
  /** What the sheet is about: `api`, `New command`. */
  title: string
  icon: ReactNode
  body: ReactNode
  /** The buttons at its foot; a refusal in words stands above them. */
  footer: ReactNode
}

export interface SettingsSheetProps {
  /** What the sheet shows; null when no sheet stands. */
  content: SettingsSheetContent | null
  onClose: () => void
}

/** Over the page: dims what the sheet stands on, so the two are never read at once. */
const SCRIM = 'absolute inset-0 bg-overlay'

const BOX =
  'absolute inset-y-0 right-0 flex w-full max-w-view-narrow flex-col border-l border-border bg-surface-content shadow-lg'

const HEAD = 'flex h-control-lg shrink-0 items-center gap-2 border-b border-border px-4'

const TITLE = 'flex min-w-0 items-center gap-2 text-base font-semibold outline-none'

/** The room the fields stand in, which scrolls; the keyboard reaches it through its fields. */
const BODY = 'flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4'

const FOOT = 'flex shrink-0 flex-col gap-3 border-t border-border px-4 py-3'

export function SettingsSheet({ content, onClose }: SettingsSheetProps): ReactNode {
  const sliding = useTransition(sheet)
  const fading = useTransition(crossfade)
  const titleId = useId()
  const title = useRef<HTMLHeadingElement>(null)
  const before = useRef<HTMLElement | null>(null)
  const open = content !== null

  useEffect(() => {
    if (open) {
      before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      // Without scrolling: the sheet is still past the edge when its title takes the focus.
      title.current?.focus({ preventScroll: true })
      return undefined
    }
    before.current?.focus({ preventScroll: true })
    before.current = null
    return undefined
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onClose()
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.button
            key="scrim"
            type="button"
            aria-label="Back to the settings"
            tabIndex={-1}
            className={SCRIM}
            data-scrim=""
            initial={CROSSFADE.from}
            animate={CROSSFADE.to}
            exit={CROSSFADE.from}
            transition={fading}
            onClick={onClose}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {content !== null && (
          <motion.section
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={BOX}
            data-sheet=""
            initial={SHEET.from}
            animate={SHEET.to}
            exit={SHEET.from}
            transition={sliding}
            onKeyDown={onKeyDown}
          >
            <div className={HEAD}>
              <h2 id={titleId} ref={title} tabIndex={-1} className={TITLE}>
                <span className="flex text-muted-foreground">{content.icon}</span>
                <span className="truncate">{content.title}</span>
              </h2>
              <span className="ml-auto flex shrink-0">
                <Tooltip label="Close" keys="Esc">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconX size="md" />}
                    aria-label={`Close ${content.title}`}
                    onClick={onClose}
                  />
                </Tooltip>
              </span>
            </div>
            <div className={BODY}>{content.body}</div>
            <div className={FOOT}>{content.footer}</div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
