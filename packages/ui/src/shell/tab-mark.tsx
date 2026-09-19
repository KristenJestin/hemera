import { animate, useMotionValue } from 'motion/react'
import { type ReactNode, type RefObject, useEffect, useRef } from 'react'

import {
  REACH_HANDOFF,
  REACH_OVERSHOOT,
  lead as leadPreset,
  reach,
  settle,
  trail as trailPreset,
  useTransition,
} from '../motion.ts'

/**
 * The mark of the active tab, and how it crosses the strip (design D2-02).
 *
 * It stretches rather than slides. It first opens far enough to cover both the tab it is
 * leaving and the tab it is going to, holds that for a moment, then closes onto the second —
 * the edge in the direction of travel arriving first and the one behind it after, which is what
 * leaves the stretch. It reads as one sheet reaching across rather than as a rectangle being
 * carried over. A slab that kept its width the whole way was tried first and read as a piece of
 * chrome in transit.
 *
 * It is one element, never one per tab, and what moves is its `clip-path`: the mark is drawn
 * once at the full width of the strip and cut down to the tab it is on. That is why there is no
 * `layoutId` here and nothing to keep in step — the two edges are the animation, and clip-path
 * is a property a compositor carries, which is the whole of what the design system allows.
 *
 * The flares at its feet are kept: they are siblings of the cut rather than children of it,
 * because a clip cuts everything under it and two squares meant to sit outside the mark's edges
 * are exactly what it would cut first. They find those edges through the same two properties.
 *
 * What it gives up is the line around the mark. A clip goes through a border as readily as
 * through anything else, so a sheet cut to a tab has no vertical edges of its own.
 */
/** What holds the whole thing and carries the two properties everything under it reads. */
const HOLDER = 'pointer-events-none absolute inset-y-0 left-0 w-full'

/** The sheet's own box, and the one thing the clip is applied to. */
const CUT = 'tab-mark block size-full'

/**
 * What is clipped: one sheet of the content's own surface, the width of the strip.
 *
 * `block`, because a span is not: an inline element takes no height and no width, and a sheet
 * of nothing is a mark that never appears however right its two cuts are.
 */
const SHEET = 'block size-full bg-surface-content'

/** Where a tab is, in the mark's own coordinates. */
interface Slot {
  left: number
  right: number
}

export interface TabMarkProps {
  /** Every tab, in order, so the mark can be told where to go. */
  tabs: RefObject<(HTMLElement | null)[]>
  /** Which of them is active. */
  active: number
  /** How many there are, so a tab arriving or leaving is measured again. */
  count: number
}

export function TabMark({ tabs, active, count }: TabMarkProps): ReactNode {
  // Read once per render rather than per frame: `useTransition` answers the reduced-motion
  // preference, and everything below is imperative.
  const still = useTransition(reach).duration === 0
  const holder = useRef<HTMLSpanElement>(null)
  const width = useMotionValue(0)
  const edgeLeft = useMotionValue(0)
  const edgeRight = useMotionValue(0)
  const slots = useRef<Slot[]>([])
  const landing = useRef<ReturnType<typeof setTimeout>>(undefined)
  const shown = useRef(active)

  /**
   * Writes the two cuts onto the element.
   *
   * Called wherever an edge moves rather than subscribed to the values that hold them. A
   * subscription is one more thing that has to be alive at the right moment, and the moment it
   * was not — the very first paint — is exactly the one that decides whether the mark is ever
   * seen at all. The same thing the shell does with the sidebar's width, and for the same
   * reason: a value that changes every frame cannot be a class, and a clip-path assembled in a
   * style attribute is a visual value living outside the theme. The theme owns the shape; this
   * owns the number.
   */
  const write = () => {
    const node = holder.current
    if (node === null) return
    node.style.setProperty('--tab-mark-left', `${String(Math.max(0, edgeLeft.get()))}px`)
    node.style.setProperty(
      '--tab-mark-right',
      `${String(Math.max(0, width.get() - edgeRight.get()))}px`,
    )
  }

  /**
   * Where every tab is, in the mark's own coordinates.
   *
   * Measured against the mark and not against the strip, because the mark is already stretched
   * across the whole of what it can cover: whatever box it was given is the box its two cuts
   * are counted from.
   *
   * Measured when it is needed and never kept: a tab is as wide as the name of a Project in a
   * font the browser may still be loading, so anything written down once is written down before
   * the strip has finished happening.
   */
  const measure = () => {
    const box = holder.current?.getBoundingClientRect()
    if (box === undefined) return
    width.set(box.width)
    slots.current = tabs.current.map((tab) => {
      const at = tab?.getBoundingClientRect()
      return at === undefined
        ? { left: 0, right: 0 }
        : { left: at.left - box.left, right: at.right - box.left }
    })
  }

  /**
   * Puts the mark on a tab with no journey: the first paint, a resize, reduced motion.
   *
   * On no tab at all, it closes onto nothing. A Project can be active and absent from the strip
   * — while it is being archived, or when a page hands over one that is not in the list — and a
   * mark with nowhere to go has to disappear rather than lie across the whole bar.
   */
  const settleOn = (to: number) => {
    clearTimeout(landing.current)
    const slot = slots.current[to] ?? { left: 0, right: 0 }
    edgeLeft.jump(slot.left)
    edgeRight.jump(slot.right)
    write()
  }

  /**
   * Closes the mark onto its tab, the leading edge first.
   *
   * The trailing edge is sent a few pixels past its mark and relaxed back, which is what keeps
   * the stretch from ending square — the sheet catches up with itself instead of stopping.
   */
  const land = (to: number, forward: boolean) => {
    const slot = slots.current[to]
    if (slot === undefined) return
    const [leadEdge, leadTo, trailEdge, trailTo] = forward
      ? ([edgeRight, slot.right, edgeLeft, slot.left] as const)
      : ([edgeLeft, slot.left, edgeRight, slot.right] as const)
    void animate(leadEdge, leadTo, { ...leadPreset, onUpdate: write })
    void animate(trailEdge, trailTo + (forward ? -REACH_OVERSHOOT : REACH_OVERSHOOT), {
      ...trailPreset,
      onUpdate: write,
    }).then(() => {
      void animate(trailEdge, trailTo, { ...settle, onUpdate: write })
    })
  }

  // After paint, not before it. The mark is rendered ahead of the tabs it measures, and React
  // attaches a ref as it walks the tree: by the time a layout effect on the first child runs,
  // its later siblings have none yet, so a measurement taken there is a measurement of nothing.
  useEffect(() => {
    measure()
    settleOn(shown.current)
    const observer = new ResizeObserver(() => {
      measure()
      settleOn(shown.current)
    })
    const node = holder.current
    if (node !== null) observer.observe(node)
    // Every tab as well, and not only the strip they are in. A tab is as wide as what it says,
    // and what it says grows after it is drawn: the count of what nobody has seen arrives from
    // the engine a moment later and the strip itself never changes size for it — so a mark cut
    // to the tab it measured first ends short of the badge that turned up afterwards.
    for (const tab of tabs.current) if (tab !== null) observer.observe(tab)

    // And when the strip scrolls. The mark is positioned against the bar and the tabs travel
    // inside a strip that slides under it, so the two come apart the moment there are more
    // Projects than fit: everything it knew about where the tabs were is a scroll out of date.
    const scroller = node?.parentElement ?? null
    const follow = () => {
      measure()
      settleOn(shown.current)
    }
    scroller?.addEventListener('scroll', follow, { passive: true })

    return () => {
      observer.disconnect()
      scroller?.removeEventListener('scroll', follow)
      clearTimeout(landing.current)
    }
  }, [count])

  useEffect(() => {
    const from = shown.current
    shown.current = active
    if (from === active) return
    measure()
    const here = slots.current[from]
    const there = slots.current[active]
    if (here === undefined || there === undefined) return
    if (still) {
      settleOn(active)
      return
    }
    // Open over both, hold, then close: the stretch is the whole point, and it has to be seen
    // before anything starts closing.
    clearTimeout(landing.current)
    void animate(edgeLeft, Math.min(here.left, there.left), { ...reach, onUpdate: write })
    void animate(edgeRight, Math.max(here.right, there.right), { ...reach, onUpdate: write })
    landing.current = setTimeout(() => {
      land(active, there.left > here.left)
    }, REACH_HANDOFF * 1000)
  }, [active])

  // Nothing at all when the active Project is not one of the tabs — while it is being archived,
  // or when a page hands over one that is not in the list. The flares are placed by the same two
  // properties as the cut, so a mark left to its defaults is not merely invisible: it is two
  // white squares stacked at the near end of the strip.
  const known = active >= 0 && active < count

  return (
    <span ref={holder} aria-hidden="true" hidden={!known} className={HOLDER}>
      <span className={CUT}>
        <span className={SHEET} />
      </span>
      <span className="tab-flare tab-flare-start tab-mark-start" />
      <span className="tab-flare tab-flare-end tab-mark-end" />
    </span>
  )
}
