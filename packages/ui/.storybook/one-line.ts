/**
 * Whether two controls are drawn on one line, which is what "nothing wraps" means.
 *
 * Asked of the boxes the browser actually laid out, because that is the only thing that can
 * answer it: a row that wraps has the same markup, the same classes and the same order as a row
 * that does not, and the difference is entirely in where the second element ended up. A tolerance
 * of the shorter box's own height is what keeps a control that is a few pixels taller than its
 * neighbour from reading as a second line.
 *
 * It lives here rather than in a story file because two surfaces ask it — the composer, and the
 * Session the composer sits at the foot of — and the trial of 22 September 2026 is what made it
 * a thing worth asking at all.
 */
export function onOneLine(first: Element, second: Element): boolean {
  const one = first.getBoundingClientRect()
  const other = second.getBoundingClientRect()
  return Math.abs(one.top - other.top) < Math.min(one.height, other.height)
}
