/** What the preload puts on the page, and the only thing the renderer reaches the main by. */

import type { Bridge } from '@hemera/ipc'

declare global {
  interface Window {
    readonly hemera: Bridge
  }
}
