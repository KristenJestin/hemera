/** What the preload puts on the page, and the only thing the renderer reaches the main by. */

import type { Bridge, MotionMeasure } from '@hemera/ipc'

declare global {
  interface Window {
    readonly hemera: Bridge
    /** The witness transition, offered to whatever drives the window from outside. */
    hemeraWitness: { play: () => Promise<MotionMeasure> }
  }
}
