/**
 * The end-to-end run with no window on screen.
 *
 * The same suite as `wdio.conf.ts`, with `HEMERA_E2E_HEADLESS=1` set on the launcher: the
 * workers, the driver and the application it starts inherit it from there, so the window opens
 * off screen and nothing takes the focus of whoever is using the machine. Set here rather
 * than on the command line, because `VAR=1 command` is not something every shell understands.
 *
 * On Linux, outside CI, an off-screen position means nothing to a Wayland compositor, which
 * places windows itself: the run starts a headless weston before each worker and stops it
 * after, and the workers inherit its socket the way they inherit the variable
 * (`e2e/compositor.ts`). It also starts and ends on a temporary directory with nothing of a
 * suite left in it. Elsewhere the run is the one it always was.
 *
 *   pnpm --filter @hemera/desktop e2e:headless
 */

import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compositorOf, inCompositor, startCompositor } from './e2e/compositor.ts'
import { HEADLESS_VARIABLE } from './src/main/window-options.ts'
import { config as suite } from './wdio.conf.ts'

process.env[HEADLESS_VARIABLE] = '1'

const compositor = compositorOf(process.platform, process.env)
let stopCompositor: (() => Promise<void>) | null = null

/**
 * Removes every folder and file the suite left in the temporary directory. Nothing holds them on
 * Linux, and a run that starts on what the last one left is not the run it claims to be.
 */
function removeLeftovers(): void {
  for (const entry of readdirSync(tmpdir())) {
    if (entry.startsWith('hemera-e2e-')) {
      rmSync(join(tmpdir(), entry), { recursive: true, force: true })
    }
  }
}

/**
 * Points the run at the compositor, before any of them is started: a window opened while none
 * listens finds no display at all, and never the desktop's.
 */
function useCompositor(): void {
  removeLeftovers()
  delete process.env.DISPLAY
  Object.assign(process.env, inCompositor(process.env))
}

/**
 * A compositor of its own for every spec file, as every spec file has a profile of its own:
 * one weston serving a whole run carries what each window left in it over to the next.
 */
async function openCompositor(command: readonly string[]): Promise<void> {
  stopCompositor = await startCompositor(command)
}

async function closeCompositor(): Promise<void> {
  await stopCompositor?.()
  stopCompositor = null
}

async function endRun(): Promise<void> {
  await closeCompositor()
  removeLeftovers()
}

// The launcher runs every hook of a list, the suite's own and these; workers never run them.
export const config: WebdriverIO.Config = {
  ...suite,
  onPrepare: [...[suite.onPrepare ?? []].flat(), ...(compositor ? [useCompositor] : [])],
  onWorkerStart: compositor ? [async () => await openCompositor(compositor)] : [],
  onWorkerEnd: compositor ? [closeCompositor] : [],
  onComplete: [...[suite.onComplete ?? []].flat(), ...(compositor ? [endRun] : [])],
}
