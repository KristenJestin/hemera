/**
 * The moments the sessions keep, strictly in the order they are taken (#306): a turn's end, then
 * the delivery its session sends next, then that next turn's end never share a millisecond, so
 * "a turn ended after it was taken" is never a tie.
 */

let last = 0

/** Now, as an ISO date, always later than the last one this answered. */
export const instant = (): string => {
  last = Math.max(Date.now(), last + 1)
  return new Date(last).toISOString()
}
