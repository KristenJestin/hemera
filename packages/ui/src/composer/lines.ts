/**
 * How tall the prompt input stands: two lines empty, eight at the most (design D4b-08).
 *
 * Two, because one line reads as a search field and a message is not a query; eight, because a
 * box that keeps growing eventually pushes the thread it is written into off the screen, and
 * what is being written matters less than what has been.
 *
 * The growing itself is the browser's own `field-sizing`, so nothing here writes a height. What
 * this decides is the `rows` the box starts at — the floor the browser grows from, and the
 * height it stands at where `field-sizing` is not answered. A wrapped line is the browser's to
 * count; the lines the writer typed are ours.
 */

/** How many lines the box shows with nothing in it. */
export const PROMPT_MIN_LINES = 2

/** How many it shows at the most, after which it scrolls what is above. */
export const PROMPT_MAX_LINES = 8

/** How many lines the box stands at for the text it holds, inside those two bounds. */
export function promptRows(text: string): number {
  const written = text.split('\n').length
  return Math.min(Math.max(written, PROMPT_MIN_LINES), PROMPT_MAX_LINES)
}
