import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cn } from 'cn'
import { motion } from 'motion/react'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { IconX } from '../../icons.ts'
import { instant, morph, useTransition } from '../../motion.ts'
import { useOverlayContainer } from '../../overlay.ts'
import { Button, IconButton } from '../button/button.tsx'

/**
 * The dialog, on Base UI.
 *
 * The title and the description are parts rather than props of a box, so the dialog is named
 * and described to a screen reader by the same text the eye reads. Base UI traps the focus
 * while it is open and gives it back to whatever opened it on close; Escape and a click
 * outside both close it, because a dialog that can only be dismissed one way is a trap.
 *
 * It rises into place while the page behind it goes soft, and sinks back the same way. The
 * rise is a transform and the veil only fades: its blur is there from the first frame to the
 * last, and it is its opacity that comes and goes. A blur that grew from nothing
 * was worked out again over the whole page on every frame of the fade, which dropped frames and
 * drew the page's own layers — a field, a button — outside the veil for
 * a frame before they sank under it: the page behind a dialog seemed to move when nothing in it
 * had.
 */
const BACKDROP =
  'fixed inset-0 bg-overlay backdrop-blur-xs backdrop-motion data-starting-style:opacity-0 data-ending-style:opacity-0'

const POPUP =
  'fixed inset-0 m-auto flex w-full flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg outline-none translate-y-0 scale-100 popup-motion data-starting-style:translate-y-4 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:translate-y-4 data-ending-style:scale-95 data-ending-style:opacity-0'

/**
 * How wide the dialog is, and how tall it may be. `md` is a question and its answer, `wide` a
 * dialog that holds a page of its own. Neither is taller than what it
 * holds, and neither is taller than `dialog`: past that only the body scrolls, so the
 * buttons stay under it and a short dialog has no hole above them. What it holds scrolls while
 * the title and the close button stay where they are.
 */
export type DialogSize = 'md' | 'wide'

const SIZE: Record<DialogSize, string> = {
  md: 'h-fit max-h-dialog max-w-md',
  wide: 'h-fit max-h-dialog max-w-3xl',
}

/**
 * The body: the only part that scrolls, and the room a control moves in. It carries a little
 * more than the lift of a control under the hand — one per cent of its width, and this is the
 * widest body a dialog may have — so a hover never widens what holds it. Nothing is ever
 * scrolled sideways either: what a dialog is asked to hold wider than itself is cut, not slid.
 */
const BODY = '-mx-2 -my-1 min-h-0 overflow-x-clip'

/** The body at rest: it scrolls what the dialog cannot show. */
const SCROLLS = 'overflow-y-auto'

/**
 * The body while it grows or folds to what it holds: cut, because what is taller than the body
 * for the length of a spring is not something to scroll, and a scrollbar that came for that
 * long would be one more thing appearing at once.
 */
const CLIPPED = 'overflow-y-hidden'

/** What the body holds, with the room around it the body scrolls with. */
const CONTENT = 'px-2 py-1'

/** The footer: the buttons, at the same place in every dialog, under a rule that parts it. */
const FOOTER = 'flex shrink-0 justify-end gap-2 border-t border-border pt-4'

export interface DialogProps {
  title: string
  /** What stands before the title in the head: a face, a mark of whose dialog it is. */
  lead?: ReactNode
  /** A line under the title saying what the dialog is for. */
  description?: string | undefined
  /** What the dialog holds, between its description and its actions. */
  children?: ReactNode
  /** The buttons at the bottom; the dialog draws the row, the caller decides the buttons. */
  actions?: ReactNode
  /** What opens it, when a button is what opens it: a dialog a keystroke opens has none. */
  trigger?: string | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  /** How wide it is: `md`, unless it holds a page of its own. */
  size?: DialogSize | undefined
  /** Where the trigger sits; never how it looks. */
  className?: string | undefined
}

export function Dialog({
  title,
  lead,
  description,
  children,
  actions,
  trigger,
  open,
  onOpenChange,
  size = 'md',
  className,
}: DialogProps) {
  const container = useOverlayContainer()
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      {trigger !== undefined && (
        <BaseDialog.Trigger render={<Button variant="secondary" className={className} />}>
          {trigger}
        </BaseDialog.Trigger>
      )}
      <BaseDialog.Portal container={container}>
        <BaseDialog.Backdrop className={BACKDROP} />
        <BaseDialog.Popup className={cn(POPUP, SIZE[size])}>
          <div className="flex items-start gap-2">
            {lead !== undefined && <div className="flex shrink-0 items-center">{lead}</div>}
            <div className="flex flex-col gap-1">
              <BaseDialog.Title className="text-lg font-medium">{title}</BaseDialog.Title>
              {description !== undefined && (
                <BaseDialog.Description className="text-sm text-muted-foreground">
                  {description}
                </BaseDialog.Description>
              )}
            </div>
            <BaseDialog.Close
              render={
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconX size="sm" />}
                  aria-label="Close"
                  className="ml-auto"
                />
              }
            />
          </div>
          {children !== undefined && <Body>{children}</Body>}
          {actions !== undefined && <div className={FOOTER}>{actions}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/** A height the body read off what it holds, and whether it is taken without a journey. */
interface Reading {
  readonly value: number
  readonly atOnce: boolean
}

/**
 * The body of a dialog, as tall as what it holds and never jumping to it.
 *
 * What a dialog holds changes while it is open: a choice brings fields in or takes them away, a
 * tab shows another panel. The body follows it on `morph`, the spring made for a dimension, so
 * the dialog grows or folds as one thing — everything under the change moves with it on the same
 * beat, instead of some of it gliding and the rest landing at once. What arrives is at its place
 * from the first frame and is uncovered by the growth; what it is taller than stays cut until
 * the spring has settled, and only then may the body scroll.
 *
 * The height is read off what it holds, whenever that changes size, and two readings are taken
 * at once rather than played. The first is where the body already is, so a dialog opening does
 * not grow into place on top of its own rise. And a reading that comes on the frame after the
 * last one is something inside the body moving on its own — a disclosure unfolding on its own
 * spring — which the body follows frame by frame: played again, the growth would trail behind
 * it and cut what it had already uncovered. A reader asking for less movement gets the new
 * height at once.
 */
function Body({ children }: { children: ReactNode }): ReactNode {
  const transition = useTransition(morph)
  const content = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<Reading | null>(null)
  const [moving, setMoving] = useState(false)
  useLayoutEffect(() => {
    const node = content.current
    if (node === null) return undefined
    // Whether the last reading was taken on the frame before this one: held for two frames, since
    // a reading is taken after the frame's own callbacks and the next one's would clear it first.
    let recent = false
    let clearing = 0
    // The reading is handed over on the next frame and not from inside the observer: the body it
    // resizes holds what is observed, and a size changed while the observer is still delivering is
    // a loop the browser refuses to finish.
    let writing = 0
    const observer = new ResizeObserver(() => {
      const value = node.offsetHeight
      const following = recent
      recent = true
      cancelAnimationFrame(clearing)
      clearing = requestAnimationFrame(() => {
        clearing = requestAnimationFrame(() => {
          recent = false
        })
      })
      cancelAnimationFrame(writing)
      writing = requestAnimationFrame(() => {
        setHeight((before) => ({ value, atOnce: before === null || following }))
      })
    })
    observer.observe(node)
    return () => {
      cancelAnimationFrame(writing)
      cancelAnimationFrame(clearing)
      observer.disconnect()
    }
  }, [])
  // Only a height that is played is cut on its way: one taken at once has no way to be on.
  const played = height !== null && !height.atOnce && transition !== instant
  return (
    <motion.div
      className={cn(BODY, moving ? CLIPPED : SCROLLS)}
      initial={false}
      animate={{ height: height?.value ?? 'auto' }}
      transition={played ? transition : instant}
      onAnimationStart={() => {
        setMoving(played)
      }}
      onAnimationComplete={() => {
        setMoving(false)
      }}
    >
      <div ref={content} className={CONTENT}>
        {children}
      </div>
    </motion.div>
  )
}

export const DialogClose = BaseDialog.Close
