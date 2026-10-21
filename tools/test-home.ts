/**
 * The home every test file runs on (#488): a folder of its own in the temporary directory, named by
 * `HOME` and `USERPROFILE` (what `homedir()` reads, on POSIX and on Windows), `XDG_CONFIG_HOME`
 * and `GIT_CONFIG_GLOBAL`. The engine's Git guard watches the home's Git configuration, and the
 * Windows runner creates `~/.gitconfig` mid-run: an engine a test opened on the machine's home was
 * stopped by it (#483, #517). Set in the process, the environment reaches the engines, the Git
 * they spawn and the Git a test spawns, with no suite saying so; a test that wants a particular
 * home hands one (`tools: { home }`).
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** The homes of a test file. */
export interface TestHome {
  /** The home the process started with: the machine's, which no test may touch. */
  readonly machine: string
  /** The test file's own. */
  readonly home: string
}

const STATE = Symbol.for('hemera.test-home')

const stateOf = (): TestHome | undefined => {
  const state: TestHome | undefined = Reflect.get(globalThis, STATE)
  return state
}

/** Puts the process on a new home of its own, remembering the one it started with. */
export function installTestHome(): TestHome {
  const machine = stateOf()?.machine ?? homedir()
  const home = mkdtempSync(join(realpathSync.native(tmpdir()), 'hemera-test-home-'))
  process.env['HOME'] = home
  process.env['USERPROFILE'] = home
  process.env['XDG_CONFIG_HOME'] = join(home, '.config')
  process.env['GIT_CONFIG_GLOBAL'] = join(home, '.gitconfig')
  const state = { machine, home }
  Reflect.set(globalThis, STATE, state)
  return state
}

/** The homes of the file being run, once `installTestHome` has run. */
export function testHome(): TestHome {
  const state = stateOf()
  if (state === undefined)
    throw new Error('the test home is not installed (tools/test-home.setup.ts)')
  return state
}

/** Removes the file's home. */
export function removeTestHome(): void {
  const state = stateOf()
  if (state !== undefined) rmSync(state.home, { recursive: true, force: true, maxRetries: 3 })
}
