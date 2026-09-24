/**
 * What a suite does when the run has no window on screen (issue #67).
 *
 * Not a spec file. `pnpm e2e:headless` opens the window off every display, where nobody sees
 * it: a frame time measured there is not the frame time of a window anyone looks at, and what
 * the GPU reports is not what it does for one. Those measurements say they were skipped, and
 * why, rather than pass or fail on something they did not measure.
 */

import { headless } from '../src/main/window-options.ts'

/** Skips the running test when the window is off screen, naming what it would have measured. */
export function skipWithoutScreen(test: Mocha.Context, measured: string): void {
  if (!headless(process.env)) return
  console.log(
    `skipped: ${measured} needs a window on screen, and HEMERA_E2E_HEADLESS=1 opens it off screen`,
  )
  test.skip()
}
