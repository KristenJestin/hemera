/**
 * The end-to-end run with no window on screen (issue #67).
 *
 * The same suite as `wdio.conf.ts`, with `HEMERA_E2E_HEADLESS=1` set on the launcher: the
 * workers, the driver and the application it starts inherit it from there, so the window opens
 * off screen and nothing takes the focus of whoever is using the machine. Set here rather
 * than on the command line, because `VAR=1 command` is not something every shell understands.
 *
 *   pnpm --filter @hemera/desktop e2e:headless
 */

import { HEADLESS_VARIABLE } from './src/main/window-options.ts'

process.env[HEADLESS_VARIABLE] = '1'

export { config } from './wdio.conf.ts'
