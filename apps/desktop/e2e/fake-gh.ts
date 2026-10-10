/**
 * A fake `gh` for the spec files that add a GitHub provider: a POSIX shell script, so it runs
 * everywhere but on Windows, where those parts of the suite are skipped.
 *
 * The engine looks for `gh` on the `PATH` it was started with, and the application is started
 * before a spec file is read: the launcher puts the fake's folder at the head of that `PATH` before
 * the worker of such a spec file starts (`wdio.conf.ts`), and the spec file writes the fake into
 * the folder as it loads, before any test asks for it.
 */

import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

/** The spec files that run on a fake `gh`. */
export const FAKE_GH_SPECS: readonly string[] = ['start-mission.e2e.ts', 'ticket-providers.e2e.ts']

/** Whether this platform runs the fake: a shell script, which Windows does not run. */
export const RUNS_FAKE_GH = process.platform !== 'win32'

/** The folder of a spec file's fake `gh`. */
export function fakeGhOf(spec: string): string {
  return join(tmpdir(), `hemera-e2e-${basename(spec, '.e2e.ts')}-gh`)
}

/** Writes a spec file's fake `gh`, emptied first; answers its folder. Nothing on Windows. */
export function writeFakeGh(spec: string, script: string): string {
  const folder = fakeGhOf(spec)
  if (!RUNS_FAKE_GH) return folder
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'gh'), script)
  chmodSync(join(folder, 'gh'), 0o755)
  return folder
}
