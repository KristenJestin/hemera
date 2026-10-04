import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { IconArrowsMaximize, IconArrowsMinimize, IconX } from '../../icons.ts'
import { CROSSFADE, SHEET, crossfade, sheet, useTransition } from '../../motion.ts'
import { IconButton } from '../button/button.tsx'
import { Tooltip } from '../tooltip/tooltip.tsx'

/**
 * Sheets over a page: one stack of them, slid in from the right edge over what they stand on, and
 * the one way every view of the window opens — a mission's Spec, a task, a round, the diff; a
 * Project's repository or command in its settings.
 *
 * A sheet is a solid surface of its own, its line and its shadow on the edge it came from, at the
 * width it asks for — `narrow` for a task or a form, `wide` for the Spec or the Memory. One head
 * for every sheet: its icon and title, its own actions, the expand that grows it to the whole
 * width of what it stands over and back, and an × at its end. None opens grown. Under it, its
 * body, which scrolls; at its foot, when it has one, its buttons, always in sight.
 *
 * The sheets are a stack: a sheet opened from a sheet comes on top, the × and Escape close the
 * one on top and show the one under it, or the page. Behind them, a scrim — the theme's overlay,
 * as behind a dialog — over the page, which a press leaves the sheets for altogether. The page is
 * the caller's to make `inert` while a sheet is shown. The focus goes to the title of the sheet
 * shown and back to where it was when the last one closes.
 *
 * A sheet slides in and out on the `sheet` kind, which carries its growing too (`sheet-motion`, a
 * transition of its width: a sheet scaled to its new width would stretch what it holds); the
 * scrim fades on `crossfade`. Asked for less movement, a sheet is there at once.
 *
 * The stack is placed against its caller's room: the caller gives it a `relative` box, clipped,
 * so a sheet past the edge on its way in is not a reason for the page to scroll.
 */
export type SheetWidth = 'narrow' | 'wide'

export interface SheetView {
  id: string
  title: string
  icon: ReactNode
  width: SheetWidth
  /** What the sheet adds to its head while it is shown. */
  actions?: ReactNode
  body: ReactNode
  /** What stands at its foot, always in sight: a form's buttons. */
  footer?: ReactNode
  /**
   * Whether the body is a form: its fields are what the keyboard reaches, so the body is not a
   * stop of its own, and it holds them with the room of a form.
   */
  form?: boolean | undefined
}

export interface SheetStackProps {
  /** Every sheet the stack can show, by id. */
  views: readonly SheetView[]
  /** The sheets open, in the order they were opened. */
  open: readonly string[]
  /** The sheet on top, or null for the page. */
  shown: string | null
  /** Shows the page, or a sheet already open: the scrim pressed, a crumb pressed. */
  onShow: (id: string | null) => void
  /** Closes a sheet and whatever was opened over it: its ×, or Escape. */
  onClose: (id: string) => void
  /** What the scrim is called: where a press on it goes back to. */
  scrimLabel: string
}

/** Over the page while a sheet stands: dims it, so the two are never read at once. */
const SCRIM = 'absolute inset-0 bg-overlay'

const BOX =
  'absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-surface-content shadow-lg sheet-motion'

/** How wide a sheet is at rest, by what it asked for; grown, the whole width. */
const WIDTH: Record<SheetWidth, string> = {
  narrow: 'max-w-view-narrow',
  wide: 'max-w-view-wide',
}

const GROWN = 'max-w-full'

const HEAD = 'flex h-control-lg shrink-0 items-center gap-2 border-b border-border px-4'

const TITLE = 'flex min-w-0 items-center gap-2 text-base font-semibold outline-none'

const END = 'ml-auto flex shrink-0 items-center gap-2'

/** A scroller the keyboard can take: its wheel is the arrows, once it has the focus. */
const BODY = 'flex min-h-0 flex-1 flex-col overflow-auto outline-none focus-ring'

/** A form's body: reached through its fields, with the room a form stands in. */
const FORM = 'flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4'

const FOOT = 'flex shrink-0 flex-col gap-3 border-t border-border px-4 py-3'

export function SheetStack({
  views,
  open,
  shown,
  onShow,
  onClose,
  scrimLabel,
}: SheetStackProps): ReactNode {
  const sliding = useTransition(sheet)
  const fading = useTransition(crossfade)
  const prefix = useId()
  // The sheets grown to the whole width, by id: the hand's doing, and nothing else's.
  const [grown, setGrown] = useState<ReadonlySet<string>>(() => new Set())
  const grow = (id: string, on: boolean): void =>
    setGrown((before) => {
      const next = new Set(before)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const byId = new Map(views.map((view) => [view.id, view]))
  const opened = open.flatMap((id) => {
    const view = byId.get(id)
    return view === undefined ? [] : [view]
  })
  const current = shown === null ? null : (byId.get(shown) ?? null)

  // Where the focus was when the first sheet opened, to put it back when the last one closes.
  const before = useRef<HTMLElement | null>(null)
  const titles = useRef(new Map<string, HTMLElement>())
  const wasShown = useRef<string | null>(null)
  useEffect(() => {
    if (shown === wasShown.current) return
    if (wasShown.current === null && shown !== null) {
      before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    wasShown.current = shown
    // Without scrolling: the sheet is still past the edge when its title takes the focus.
    if (shown !== null) titles.current.get(shown)?.focus({ preventScroll: true })
    else {
      before.current?.focus({ preventScroll: true })
      before.current = null
    }
  }, [shown])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && shown !== null) {
      event.stopPropagation()
      onClose(shown)
    }
  }

  return (
    <>
      <AnimatePresence>
        {current !== null && (
          <motion.button
            key="scrim"
            type="button"
            aria-label={scrimLabel}
            tabIndex={-1}
            className={SCRIM}
            data-scrim=""
            initial={CROSSFADE.from}
            animate={CROSSFADE.to}
            exit={CROSSFADE.from}
            transition={fading}
            onClick={() => onShow(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {opened.map((view) => (
          <motion.section
            key={view.id}
            aria-labelledby={`${prefix}${view.id}`}
            className={cn(BOX, grown.has(view.id) ? GROWN : WIDTH[view.width])}
            data-view={view.id}
            data-grown={grown.has(view.id)}
            // Out of sight while another stands over it; a sheet on its way out stays in
            // sight, or its leaving would be a cut.
            hidden={open.includes(view.id) && shown !== view.id}
            initial={SHEET.from}
            animate={SHEET.to}
            exit={SHEET.from}
            transition={sliding}
            onKeyDown={onKeyDown}
          >
            <div className={HEAD}>
              <h2
                id={`${prefix}${view.id}`}
                tabIndex={-1}
                ref={(node) => {
                  if (node === null) titles.current.delete(view.id)
                  else titles.current.set(view.id, node)
                }}
                className={TITLE}
              >
                <span className="flex text-muted-foreground">{view.icon}</span>
                <span className="truncate">{view.title}</span>
              </h2>
              <div className={END}>
                {view.actions}
                <Tooltip label={grown.has(view.id) ? 'Collapse' : 'Expand'}>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={
                      grown.has(view.id) ? (
                        <IconArrowsMinimize size="md" />
                      ) : (
                        <IconArrowsMaximize size="md" />
                      )
                    }
                    aria-label={`${grown.has(view.id) ? 'Collapse' : 'Expand'} ${view.title}`}
                    aria-pressed={grown.has(view.id)}
                    onClick={() => grow(view.id, !grown.has(view.id))}
                  />
                </Tooltip>
                <Tooltip label="Close" keys="Esc">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconX size="md" />}
                    aria-label={`Close ${view.title}`}
                    onClick={() => onClose(view.id)}
                  />
                </Tooltip>
              </div>
            </div>
            {view.form === true ? (
              <div className={FORM}>{view.body}</div>
            ) : (
              <div className={BODY} tabIndex={0}>
                {view.body}
              </div>
            )}
            {view.footer !== undefined && <div className={FOOT}>{view.footer}</div>}
          </motion.section>
        ))}
      </AnimatePresence>
    </>
  )
}
