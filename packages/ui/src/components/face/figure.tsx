import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef } from 'react'

import type { FaceDetail, FaceFrame } from './player.ts'
import { TONES, TONE_CLASSES, tonesOf } from './pose.ts'
import { VIEW, drawnOf, pathOf } from './rig.ts'

/** What draws frames on a figure, once it is on the page. */
export interface FacePainter {
  readonly paint: (frame: FaceFrame) => void
}

/** How many faces a figure holds at once: the three a cross-fade can pass between. */
const GROUPS = [0, 1, 2] as const
const PARTS = ['left', 'right', 'mouth'] as const

/** A number as an attribute is written: to the thousandth, which is far below a pixel. */
function rounded(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

export interface FaceFigureProps {
  readonly detail: FaceDetail
  /** Filled in with what paints this figure, once it is on the page. */
  readonly painter: RefObject<FacePainter | null>
}

/**
 * The drawing of the face: the strokes of up to three faces, each laid once and shown in every
 * tone it is passing between.
 *
 * A face's strokes are defined once and used once per tone, each use in the colour of its tone's
 * role and at the share of it the face is in. A face half-way from one tone to another is the
 * second drawn over the first at half strength, which is exactly the colour half-way between
 * them: the colour travels with the shape, on the same clock, and no colour is ever written
 * anywhere but in the theme. Nothing goes through React after the first render — a frame sets a
 * few attributes and nothing else.
 */
export function FaceFigure({ detail, painter }: FaceFigureProps): ReactNode {
  const id = `face${useId().replaceAll(/[^\w-]/g, '')}`
  const root = useRef<SVGSVGElement | null>(null)

  useLayoutEffect(() => {
    const svg = root.current
    if (svg === null) return undefined
    const groups = GROUPS.map((group) => ({
      parts: PARTS.map((part) =>
        svg.querySelector<SVGPathElement>(`[data-face-part="${String(group)}-${part}"]`),
      ),
      uses: TONES.map((tone) =>
        svg.querySelector<SVGUseElement>(`[data-face-use="${String(group)}-${tone}"]`),
      ),
    }))
    // What was last written on each element, so a frame only touches what it changed: most of the
    // tones of a face are hidden most of the time, and a still face changes nothing at all.
    const written = new Map<Element, Map<string, string | null>>()
    const set = (element: Element | null, name: string, value: string | null): void => {
      if (element === null) return
      const known = written.get(element) ?? new Map<string, string | null>()
      written.set(element, known)
      if (known.has(name) && known.get(name) === value) return
      known.set(name, value)
      if (value === null) element.removeAttribute(name)
      else element.setAttribute(name, value)
    }
    const show = (element: Element | null, shown: boolean): void => {
      set(element, 'display', shown ? null : 'none')
    }
    painter.current = {
      paint: (frame) => {
        for (const group of GROUPS) {
          const { parts, uses } = groups[group]!
          const layer = frame.layers[group]
          if (layer === undefined) {
            for (const use of uses) show(use, false)
            continue
          }
          const drawn = drawnOf(layer.pose, detail)
          const strokes = [drawn.left, drawn.right, drawn.mouth]
          parts.forEach((path, index) => {
            const stroke = strokes[index] ?? null
            show(path, stroke !== null)
            if (stroke === null) return
            set(path, 'd', pathOf(stroke))
            set(path, 'stroke-width', rounded(stroke.width))
          })
          // Each tone over the ones before it, at its share of everything drawn so far: the
          // last is at its own weight, and what it leaves of the others is theirs.
          let below = 0
          tonesOf(layer.pose).forEach((weight, index) => {
            const use = uses[index] ?? null
            const share = Math.max(0, weight)
            below += share
            const opacity = below > 0 ? (share / below) * layer.opacity : 0
            show(use, opacity > 0.002)
            if (opacity > 0.002) set(use, 'opacity', rounded(opacity))
          })
        }
      },
    }
    return () => {
      painter.current = null
    }
  }, [detail, painter])

  return (
    <svg
      ref={root}
      viewBox={`0 0 ${String(VIEW)} ${String(VIEW)}`}
      fill="none"
      aria-hidden="true"
      className="size-full overflow-visible"
    >
      <defs>
        {GROUPS.map((group) => (
          <g
            key={group}
            id={`${id}-${String(group)}`}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {PARTS.map((part) => (
              <path key={part} data-face-part={`${String(group)}-${part}`} />
            ))}
          </g>
        ))}
      </defs>
      {GROUPS.map((group) =>
        TONES.map((tone) => (
          <use
            key={`${String(group)}-${tone}`}
            href={`#${id}-${String(group)}`}
            data-face-use={`${String(group)}-${tone}`}
            className={TONE_CLASSES[tone]}
            display="none"
          />
        )),
      )}
    </svg>
  )
}
