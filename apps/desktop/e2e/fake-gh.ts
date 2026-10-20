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
export const FAKE_GH_SPECS: readonly string[] = [
  'delivery-rules.e2e.ts',
  'delivery-rules.restarted.e2e.ts',
  'start-mission.e2e.ts',
  'ticket-providers.e2e.ts',
]

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

/**
 * The fake `gh`: its version, and its sign-in for a host, which it has once the file `signed-in`
 * stands beside it. It reaches no network and answers nothing else.
 */
export const GH_SIGNED_IN_BY_FILE = `#!/bin/sh
here=$(dirname "$0")
case "$1" in
  --version) echo "gh version 2.60.0 (2026-10-01)"; exit 0 ;;
  auth)
    if [ -f "$here/signed-in" ]; then echo "Logged in to github.com account octo"; exit 0; fi
    echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2
    exit 1 ;;
esac
echo "this fake answers only --version and auth status" >&2
exit 1
`
