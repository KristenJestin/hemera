/**
 * One frame loop for every face on the page.
 *
 * A list of agents is a column of faces, and a loop each is as many callbacks asking the
 * browser for the same frame. One loop runs while anything listens and stops when nothing does;
 * each listener is handed the frame's own time, in seconds, so every face on the page is drawn at
 * the same instant.
 */
const listeners = new Set<(at: number) => void>()
let request = 0

function tick(time: number): void {
  const at = time / 1000
  for (const listener of listeners) listener(at)
  request = listeners.size > 0 ? requestAnimationFrame(tick) : 0
}

/** Calls `listener` on every frame until the function handed back is called. */
export function onFrame(listener: (at: number) => void): () => void {
  listeners.add(listener)
  if (request === 0) request = requestAnimationFrame(tick)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The time the frames are told, in seconds: the time of the frame being made, the one
 * `requestAnimationFrame` hands the loop above.
 *
 * Not `performance.now()`, which moves between two reads of the same frame. Every face mounted in
 * one render reads it in a layout effect of its own, one after the other, each painting its first
 * frame before the next one reads: on a busy machine the second read came tens of milliseconds
 * after the first, and two faces with the same seed began that far apart — two lives, where the
 * seed promises one. The frame's time is the same for everything done in that frame. Where the
 * document has no timeline running, the time read now is all there is.
 */
export function clock(): number {
  const frame = document.timeline.currentTime
  return (frame === null ? performance.now() : Number(frame)) / 1000
}
