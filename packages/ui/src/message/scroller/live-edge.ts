/**
 * Where the reader is in a thread, and whether the thread should follow the live edge (D4b-08).
 *
 * A thread that always scrolls to the bottom takes the page away from whoever is reading it;
 * a thread that never does leaves a new message under the fold of a page nobody has moved. So
 * it follows the edge while the reader is at it, and lets go the moment they leave — which is
 * the one rule, and the whole reason the distance is a named number here rather than a literal
 * in a scroll handler.
 *
 * The threshold is not zero because the bottom is not a point: a wheel notch, a trackpad's
 * inertia and a browser rounding a fractional height all leave the reader a few pixels short
 * of an edge they are plainly at. Fifty-six is about two lines of the thread — near enough to
 * still be reading the last message, far enough that a deliberate scroll up reads as one.
 */

/** How near the bottom the reader stays for the thread to keep following it, in pixels. */
export const LIVE_EDGE_THRESHOLD = 56

/** What a scroll container says about itself, which is all this needs to answer. */
export interface ScrollPosition {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** How far the reader is from the last message, in pixels; never less than nothing. */
export function distanceToLiveEdge(position: ScrollPosition): number {
  return Math.max(0, position.scrollHeight - position.scrollTop - position.clientHeight)
}

/** Whether the thread should pull the reader along when something new arrives in it. */
export function atLiveEdge(position: ScrollPosition): boolean {
  return distanceToLiveEdge(position) <= LIVE_EDGE_THRESHOLD
}
