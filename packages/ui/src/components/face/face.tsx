import { cn } from 'cn'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { crossfade, instant, useTransition } from '../../motion.ts'
import { Legend } from '../tooltip/legend.tsx'
import { FaceFigure, type FacePainter } from './figure.tsx'
import { DETAILS, type FacePlayer, createFace } from './player.ts'
import { EXPRESSIONS, type FaceState } from './states.ts'
import { clock, onFrame } from './ticker.ts'
import { type FaceSize, SIZE_CLASSES, detailOf } from './face-sizes.ts'

const FRAME = 'inline-block shrink-0'

/**
 * A face set in a line of text: on the line's middle, a little room either side, and drawn into
 * the line's own leading rather than adding to it, so the line keeps the height it has without it.
 */
const INLINE = 'inline-block shrink-0 -my-1 mx-0.5 align-middle'

export interface FaceProps {
  /** What the agent is doing. */
  state: FaceState
  /** How big it is drawn. */
  size?: FaceSize | undefined
  /**
   * Makes the face deterministic: the same seed and the same changes at the same moments are the
   * same face. Left out, each face draws its own, so two waiting side by side never blink in step.
   */
  seed?: number | undefined
  /** What the face says in words; the state's own words when left out. */
  label?: string | undefined
  /** Whether the mouth is drawn: at every size unless it is turned off here. */
  mouth?: boolean | undefined
  /** Whether the state in words is a tooltip on the face, reached by the hand and the keyboard. */
  legend?: boolean | undefined
  /** Whether it is set inside a line of text, which keeps its height. */
  inline?: boolean | undefined
  /** Where the face sits; never how it looks. */
  className?: string | undefined
}

export function Face({
  state,
  size = 'md',
  seed,
  label,
  mouth = true,
  legend = false,
  inline = false,
  className,
}: FaceProps): ReactNode {
  const reduced = useTransition(crossfade) === instant
  const detail = useMemo(() => ({ ...DETAILS[detailOf(size)], mouth }), [size, mouth])
  const [drawn] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const chosen = seed ?? drawn
  const painter = useRef<FacePainter | null>(null)
  const player = useRef<FacePlayer | null>(null)
  const holder = useRef<HTMLSpanElement | null>(null)
  const latest = useRef(state)
  const wake = useRef<() => void>(() => undefined)

  /** Paints the face as it is now, and makes sure it goes on being painted. */
  const draw = (): void => {
    const face = player.current
    if (face !== null) painter.current?.paint(face.frame(clock()))
    wake.current()
  }

  // A new seed or a change of preference is a new face, begun where the state is.
  useLayoutEffect(() => {
    player.current = createFace({
      state: latest.current,
      at: clock(),
      seed: chosen,
      reduced,
    })
    draw()
  }, [chosen, reduced])

  useLayoutEffect(() => {
    latest.current = state
    player.current?.change(state, clock())
    draw()
  }, [state])

  // Painted on the page's one frame loop while it is on screen and has anything to move: a face
  // scrolled away, or one holding still in its state, costs nothing.
  useEffect(() => {
    let stop: (() => void) | null = null
    let seen = true
    const tick = (at: number): void => {
      const face = player.current
      if (face === null) return
      const frame = face.frame(at)
      painter.current?.paint(frame)
      if (frame.still) {
        stop?.()
        stop = null
      }
    }
    const run = (): void => {
      if (stop === null && seen) stop = onFrame(tick)
    }
    wake.current = run
    const observer = new IntersectionObserver((entries) => {
      seen = entries.some((entry) => entry.isIntersecting)
      if (seen) run()
      else {
        stop?.()
        stop = null
      }
    })
    if (holder.current !== null) observer.observe(holder.current)
    run()
    return () => {
      observer.disconnect()
      stop?.()
      wake.current = () => undefined
    }
  }, [])

  const words = label ?? EXPRESSIONS[state].label
  const figure = (
    <span
      ref={holder}
      role={legend ? undefined : 'img'}
      aria-label={legend ? undefined : words}
      data-state={state}
      data-waiting={EXPRESSIONS[state].waits}
      className={cn(inline ? INLINE : FRAME, SIZE_CLASSES[size], className)}
    >
      <FaceFigure detail={detail} painter={painter} />
    </span>
  )
  if (!legend) return figure
  return <Legend label={words}>{figure}</Legend>
}
