import { type DetailName } from './player.ts'

/**
 * Hemera's face: a small mascot whose expression says what an agent is doing.
 *
 * Two eyes and a mouth, each one stroke of three points, and every state a way of placing those
 * points. The face is calm: it holds still in its state, in the text's own colour for ordinary
 * work, and moves when its state changes — one short, designed movement from wherever the face
 * is, eyes, mouth, head and colour together, a change arriving half-way through another taken
 * from there — and is still again. Only loading, which is the loading indicator, goes on turning,
 * and the states that wait for the reader blink slowly now and then, at intervals drawn from a
 * seed, so the same seed always tells the same story.
 *
 * Telling two states apart never depends on the colour; it only says again what the shape says.
 * The state is said in words too — to whatever reads the page, and, with `legend`, in a tooltip
 * on the face.
 *
 * Small, it simplifies rather than blurs: heavier strokes, movements that travel further so they
 * still read. A reader asking for less movement gets still expressions and a soft
 * cross-fade between them.
 */

/** From an icon button to the hero of an empty page. */
export const FACE_SIZES = ['icon', 'sm', 'md', 'lg', 'hero'] as const

export type FaceSize = (typeof FACE_SIZES)[number]

/** The step of the scale each size is drawn at. */
export const SIZE_CLASSES = {
  icon: 'size-icon-md',
  sm: 'size-6',
  md: 'size-10',
  lg: 'size-16',
  hero: 'size-face-hero',
} as const satisfies Record<FaceSize, string>

/** How much of the face each size can hold. */
const DETAIL_OF: Record<FaceSize, DetailName> = {
  icon: 'icon',
  sm: 'small',
  md: 'full',
  lg: 'full',
  hero: 'full',
}

/** How much of the face a size holds. */
export function detailOf(size: FaceSize): DetailName {
  return DETAIL_OF[size]
}
