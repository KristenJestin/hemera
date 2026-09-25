import { cn } from 'cn'
import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconChevronLeft } from '../icons.ts'
import { CROSSFADE, crossfade, instant, morph, useTransition } from '../motion.ts'

/**
 * The panel a Session's mission opens beside the chat (lot 19, brief revisions 4 and 4b): the
 * Spec of a `define` Session today, the tasks, workers and evidence of a `build` one next. It is
 * the shell and nothing of what it holds: the fold, the width that pushes the chat, the rules of
 * who unfolds it, the keyboard across a fold; what it shows comes in slots.
 *
 * Mostly something to read, so it takes the room only when it is read. By default it is folded to
 * a band beside the chat — the rail's glyphs and what the mission says at their foot — and the chat
 * has the rest of the width. The band, a glyph or its unfold button unfolds it; the agent starting
 * on something new unfolds it too, unless the hand folded it during this Session: a fold by the
 * hand holds until the hand unfolds.
 *
 * Unfolded, a head that stays on top, and under it the rail beside the stage, and a foot under
 * both. The head is handed what folds the panel, so that its fold button stands among its own
 * controls.
 *
 * The width is what moves, and it pushes the chat (brief revision 4b). The panel is a slot of its
 * row and the chat takes the rest: unfolding, the slot widens on `morph` from the band to its
 * unfolded width and the chat narrows with it from the first frame; folding, the other way.
 * Nothing stands over the chat at any time. The two ends are lengths of different kinds — rems,
 * and a share of the row (`w-mission-panel`, asked of the row, which is its container) — so what
 * moves is how far open the panel is, from 0 to 1, which the slot's width is drawn from
 * (`mission-panel-slot`). What the panel holds is laid at the unfolded width from the first frame
 * and hangs from the slot's left edge, which clips the rest: the stage's text does not reflow on
 * the way, only the chat's does.
 *
 * The slot can also be the whole row: while the chat is minimised (`page`, lot 5c, issue #115) the
 * panel is the page. It grows from wherever the fold left it to the whole row on the same spring,
 * over the chat, which keeps the width it had and is covered — the same `mission-panel-slot` the
 * fold draws, blended to `100cqw` by `--mission-panel-page`. The fold is held while the panel is
 * the page: there is no band beside nothing, and the fold the hand had is the one the chat is
 * uncovered onto when it comes back.
 */

/** The slot the panel takes in its row, whose width moves; what it holds past it is clipped. */
const SLOT = 'relative min-h-0 shrink-0 overflow-hidden border-l border-border'

/** What the unfolded panel holds, laid at the unfolded width whatever the slot's own is. */
const OPEN = 'absolute inset-y-0 left-0 flex flex-col bg-surface-content'

/**
 * The two widths a panel unfolds to: the share a Spec takes beside the chat, and the narrower one
 * the chat itself takes beside a build (D10-12). Each is a slot whose width moves and the width
 * what it holds is laid at.
 */
const WIDTHS = {
  wide: { slot: 'mission-panel-slot', open: 'mission-panel-body' },
  narrow: { slot: 'mission-panel-slot-narrow', open: 'mission-panel-body-narrow' },
} as const

const BAND = 'absolute inset-y-0 left-0 z-10 flex w-mission-band flex-col bg-surface-content'

const BAND_TOP = 'flex shrink-0 justify-center pt-2'

/** The rail and the stage side by side. */
const BODY = 'flex min-h-0 flex-1'

export interface MissionPanelProps {
  /** What the panel is called, as a region: `Spec ATL-7`. */
  label: string
  /** What it is, in the words of its fold: `Spec` makes `Unfold the Spec`. */
  noun: string
  /** The head, handed what folds the panel for its fold button. */
  head: (fold: () => void) => ReactNode
  /** The rail beside the stage, unfolded. */
  rail: ReactNode
  /** What the rail shows on. */
  stage: ReactNode
  /** The band's column of glyphs, folded; anything pressed in it unfolds the panel. */
  band: ReactNode
  /** What stands under the rail and the stage, unfolded. */
  foot?: ReactNode
  /**
   * What the agent is working on now. When it changes to something, the panel unfolds onto it —
   * unless the hand folded it.
   */
  following?: string | undefined
  /** Told when the agent unfolded the panel, before it opens: the mission shows what it follows. */
  onFollow?: (() => void) | undefined
  /** Whether the panel starts folded to its band, which it does unless told otherwise. */
  defaultFolded?: boolean | undefined
  /** Told each time the panel folds or unfolds, by the hand or because the agent works. */
  onFoldChange?: ((folded: boolean) => void) | undefined
  /**
   * Whether it is folded, for a caller that folds it itself: a change is taken as a hand's, and
   * holds against the agent the same way. A build folds the chat to its band when the Spec opens
   * beside it, since the two are never open together (core.md, "Session view").
   */
  folded?: boolean | undefined
  /**
   * How wide it unfolds: `wide`, the share a Spec takes beside the chat, or `narrow`, the chat
   * beside a build, which leaves the build the larger part of the row (D10-12).
   */
  width?: 'wide' | 'narrow' | undefined
  /**
   * Whether the chat beside it is minimised, which makes the panel the page (lot 5c, issue #115):
   * the slot grows from the fold to the whole row over the chat, and the fold it holds is the one
   * the chat comes back to. Nothing is folded while this is on — the control that folds the panel
   * belongs to the caller's head, and a head drawn on the page is drawn without one.
   */
  page?: boolean | undefined
}

export function MissionPanel({
  label,
  noun,
  head,
  rail,
  stage,
  band,
  foot,
  following,
  onFollow,
  defaultFolded = true,
  onFoldChange,
  folded: asked,
  width: size = 'wide',
  page = false,
}: MissionPanelProps): ReactNode {
  const starts = asked ?? defaultFolded
  const [folded, setFolded] = useState(starts)
  // Whether the width is on its way. Folding, what was open stays in the slot until it has closed.
  const [moving, setMoving] = useState(false)
  // The fold as it is now, read by the several hands one click may bubble through.
  const isFolded = useRef(starts)
  // Whether the last fold was the hand's: it holds against the agent until the hand unfolds.
  const byHand = useRef(false)
  const followed = useRef(following)
  const slot = useRef<HTMLElement>(null)
  // Whether the keyboard was in the panel when the hand folded or unfolded it: the control it
  // was on is gone, and the focus goes to what stands in its place.
  const refocus = useRef(false)
  const width = useTransition(morph)
  // How far open the panel is, from the band (0) to the unfolded width (1), and how far it has
  // grown over the chat, from its slot in the row (0) to the whole of it (1).
  const open = useMotionValue(starts ? 0 : 1)
  const whole = useMotionValue(page ? 1 : 0)
  const fade = useTransition(crossfade)

  function fold(next: boolean, hand: boolean): void {
    if (hand) byHand.current = next
    if (isFolded.current === next) return
    refocus.current = hand && (slot.current?.contains(document.activeElement) ?? false)
    isFolded.current = next
    setFolded(next)
    setMoving(true)
    onFoldChange?.(next)
  }

  // The caller folding or unfolding it is a hand doing so: a change of what it asks, and not the
  // fold it opened on.
  const askedBefore = useRef(asked)
  useEffect(() => {
    const before = askedBefore.current
    askedBefore.current = asked
    if (asked === undefined || asked === before) return
    fold(asked, true)
  }, [asked])

  // The agent starting on something unfolds the panel onto it — unless the hand folded it.
  useEffect(() => {
    const before = followed.current
    followed.current = following
    if (following === undefined || following === before) return
    if (!isFolded.current || byHand.current) return
    onFollow?.()
    fold(false, false)
  }, [following])

  /**
   * Writes how far open the panel is onto its slot, which draws its width from it.
   *
   * Called on every frame the value moves rather than subscribed to it, as the shell does with
   * the sidebar's width: a value that changes every frame cannot be a class, and a width
   * assembled in a style attribute is a length living outside the theme.
   */
  function pose(share: number): void {
    // Written on the row the panel stands in and not on the slot itself: the slot draws its width
    // from it by inheritance, and the chat beside it — laid at what the panel leaves it, so that
    // the panel can grow over it without its text reflowing (lot 5c) — reads the same value, which
    // a property on the slot alone would never reach.
    const row = slot.current?.parentElement
    row?.style.setProperty('--mission-panel-open', String(share))
  }

  /** Writes how far the panel has grown over the chat onto the same slot. */
  function poseWhole(grown: number): void {
    slot.current?.style.setProperty('--mission-panel-page', String(grown))
  }

  // The first frame has no animation to report a width: the resting one is written before it.
  useLayoutEffect(() => {
    pose(open.get())
    poseWhole(whole.get())
  }, [])

  // A fold moves the width on `morph`, from wherever it stands, pushing the chat on every frame.
  // Told to move less, it lands at once.
  useLayoutEffect(() => {
    const target = folded ? 0 : 1
    if (open.get() === target) return
    if (width === instant) {
      open.jump(target)
      pose(target)
      setMoving(false)
      return
    }
    let live = true
    const travel = animate(open, target, { ...width, onUpdate: pose })
    void travel.then(() => {
      if (live) setMoving(false)
    })
    return () => {
      live = false
      travel.stop()
    }
  }, [folded])

  // The chat leaving or coming back moves the panel over the row the same way a fold moves it into
  // it: on `morph`, from where it stands, and at once when the system asks for less movement.
  useLayoutEffect(() => {
    const target = page ? 1 : 0
    if (whole.get() === target) return
    if (width === instant) {
      whole.jump(target)
      poseWhole(target)
      setMoving(false)
      return
    }
    let live = true
    const travel = animate(whole, target, { ...width, onUpdate: poseWhole })
    void travel.then(() => {
      if (live) setMoving(false)
    })
    return () => {
      live = false
      travel.stop()
    }
  }, [page])

  // Folded, the keyboard lands on the band's unfold button; unfolded, on what is on the stage, or
  // on the head's fold button when the stage has no rows to land on — the chat has none.
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    const target = folded ? '[data-unfold]' : '[data-row][tabindex="0"]'
    const landing =
      slot.current?.querySelector<HTMLElement>(target) ??
      (folded ? null : slot.current?.querySelector<HTMLElement>('[data-fold]'))
    landing?.focus()
  }, [folded])

  // The panel is the page while the chat is minimised: folded or not, what it holds is what is
  // drawn, and the band — a rail beside nothing — is not.
  const shown = page || !folded

  return (
    <section ref={slot} aria-label={label} className={cn(SLOT, WIDTHS[size].slot)}>
      {(shown || moving) && (
        // Folding, what was open stays under the band until the slot has closed on it, and
        // is out of reach of the keyboard and of a screen reader the whole way.
        <div
          inert={!shown}
          aria-hidden={shown ? undefined : true}
          className={cn(OPEN, WIDTHS[size].open)}
        >
          {head(() => fold(true, true))}
          <div className={BODY}>
            {rail}
            {stage}
          </div>
          {foot}
        </div>
      )}
      <AnimatePresence initial={false}>
        {folded &&
          !page && (
            // The band: anything pressed in it unfolds the panel, a glyph onto what it names. It
            // comes up over the closing panel and goes at once when the slot opens: what it was
            // pressed for is already there under it, and two rails are one too many.
            <motion.div
              key="band"
              className={BAND}
              initial={CROSSFADE.from}
              animate={CROSSFADE.to}
              transition={fade}
              onClick={() => fold(false, true)}
            >
              <div className={BAND_TOP}>
                <Tooltip label={`Unfold the ${noun}`} side="left">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconChevronLeft size="sm" />}
                    aria-label={`Unfold the ${noun}`}
                    data-unfold
                    onClick={() => fold(false, true)}
                  />
                </Tooltip>
              </div>
              {band}
            </motion.div>
          )}
      </AnimatePresence>
    </section>
  )
}
