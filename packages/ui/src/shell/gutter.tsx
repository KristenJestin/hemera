import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'

import {
  SIDEBAR_COLLAPSE,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_RAIL,
  SIDEBAR_STEP,
  clampedWidth,
} from './model.ts'

/**
 * The separator between the sidebar and the content (design D2-03).
 *
 * It is a `separator` with a value, which is what a screen reader needs in order to say how
 * wide the panel is and what it may become; that is also what makes it focusable, because a
 * separator with a value is something the user can change. The arrows move it by a line of
 * text, Home and End take it to its bounds, and Enter folds the panel — the same three things
 * the hand can do, without the hand.
 *
 * The pointer's own position is the width, because the sidebar starts at the window's left
 * edge: there is nothing to measure, which is just as well, since measuring is what the width
 * check refuses. Dragging under the fold threshold folds the panel instead of leaving it
 * uselessly narrow, and the separator stays where it is once folded, so the same drag brings
 * it back.
 *
 * The drag is followed on the window rather than on the separator itself: a pointer that
 * leaves a one-pixel-wide element is a pointer that has left it, and a drag that stops the
 * moment the hand moves faster than the panel is a drag nobody can finish.
 */
const BAR =
  'w-1 shrink-0 cursor-col-resize bg-transparent outline-none hover:bg-border focus-visible:bg-primary'

export interface GutterProps {
  /** The width the sidebar is showing, in pixels. */
  width: number
  /** Whether the sidebar is folded, which is what the separator says and what Enter changes. */
  collapsed: boolean
  /** Told the width the hand or the keyboard asks for, already inside the bounds. */
  onWidthChange: (width: number) => void
  /** Told to fold or unfold. */
  onToggleCollapsed: () => void
  /** Told when a drag begins and ends: a width under the hand follows it without a spring. */
  onDraggingChange: (dragging: boolean) => void
}

export function Gutter({
  width,
  collapsed,
  onWidthChange,
  onToggleCollapsed,
  onDraggingChange,
}: GutterProps): ReactNode {
  const shown = collapsed ? SIDEBAR_RAIL : width
  // A ref and not a state: the answer to a pointer that has already moved cannot wait for a
  // render, and nothing on screen depends on it.
  const holding = useRef(false)

  const askFor = (asked: number): void => {
    if (asked < SIDEBAR_COLLAPSE) {
      if (!collapsed) onToggleCollapsed()
      return
    }
    if (collapsed) onToggleCollapsed()
    onWidthChange(clampedWidth(asked))
  }

  useEffect(() => {
    const follow = (event: PointerEvent): void => {
      if (holding.current) askFor(event.clientX)
    }
    const release = (): void => {
      if (!holding.current) return
      holding.current = false
      onDraggingChange(false)
    }
    globalThis.addEventListener('pointermove', follow)
    globalThis.addEventListener('pointerup', release)
    globalThis.addEventListener('pointercancel', release)
    return () => {
      globalThis.removeEventListener('pointermove', follow)
      globalThis.removeEventListener('pointerup', release)
      globalThis.removeEventListener('pointercancel', release)
    }
  })

  const answer = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onToggleCollapsed()
      return
    }
    const asked = {
      ArrowLeft: shown - SIDEBAR_STEP,
      ArrowRight: shown + SIDEBAR_STEP,
      Home: SIDEBAR_MIN,
      End: SIDEBAR_MAX,
    }[event.key]
    if (asked === undefined) return
    event.preventDefault()
    if (collapsed) onToggleCollapsed()
    onWidthChange(clampedWidth(asked))
  }

  return (
    <div
      role="separator"
      aria-label="Sidebar width"
      aria-orientation="vertical"
      aria-valuenow={shown}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      className={BAR}
      onKeyDown={answer}
      onPointerDown={() => {
        holding.current = true
        onDraggingChange(true)
      }}
    />
  )
}
