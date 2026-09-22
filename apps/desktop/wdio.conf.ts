/**
 * End-to-end run of the application (design D0-10).
 *
 * The suite drives the real application: the binary this package installed, the bundles this
 * package built, on the target the run happens on. Nothing is mocked, because what the lot
 * claims is about a window on a machine, and a mock has neither.
 *
 *   pnpm --filter @hemera/desktop e2e
 */

import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installFakeAgent } from './e2e/agent/install.ts'

const application = dirname(fileURLToPath(import.meta.url))

/**
 * The spec files that go on with what another one left behind, and the file they go on from.
 *
 * A restart of the application is the one thing a spec file cannot do to itself — the service
 * starts one instance per file and has no way to close it and start it again — and it is exactly
 * what a Session has to survive. So a Session written by one file is opened again by the next,
 * on the folder the first one wrote: the second instance starts on a data folder that already
 * holds a thread, which is what reopening the application is. They run in order because the
 * capabilities are read in order and one window runs at a time.
 */
const CONTINUED: Record<string, string> = { 'sessions.reopened.e2e.ts': 'sessions.e2e.ts' }

/**
 * The data folder one spec file runs on, made for it and thrown away after the run (D3-06).
 *
 * A suite that opened the data folder of this machine would migrate it, back it up and write
 * to it — which is the one thing no test is allowed to do. The application accepts the folder
 * because it is a `dev` build; a package would ignore the argument.
 *
 * One folder per spec file, because a data folder is state and state shared between files is
 * one suite deciding what the next one starts on: a sidebar left folded by one is a header the
 * next cannot find its way around. Each spec file therefore gets a capability of its own, which
 * is the only place the service reads the folder from — but for the few that go on from another
 * one, which is what `CONTINUED` is and why it is written above.
 *
 * The path is spelled out rather than drawn from `mkdtemp`, because this file is evaluated once
 * by the launcher and once again inside every worker: a folder made on evaluation would be a
 * different folder in each of them, and a suite checking what a *second* start does would be
 * starting it somewhere else entirely.
 */
export function e2eDataOf(spec: string): string {
  const folder = CONTINUED[basename(spec)] ?? basename(spec)
  return join(tmpdir(), `hemera-e2e-${basename(folder, '.e2e.ts')}`)
}

/** Every spec file of the suite, which is one capability and one data folder each. */
const SPECS = readdirSync(join(application, 'e2e'))
  .filter((entry) => entry.endsWith('.e2e.ts'))
  .toSorted()

// A terminal opened inside an Electron based editor exports ELECTRON_RUN_AS_NODE, and the
// binary would then start as a plain Node process: no window for the suite to drive.
delete process.env.ELECTRON_RUN_AS_NODE

// The agent the suite talks to, put on this process's `PATH` before anything is started: the
// application looks a command up on the machine it runs on, and this is the machine it is given
// (`e2e/agent/install.ts`). Nothing of the product is aware of it, and no real agent is run.
installFakeAgent()

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./e2e/**/*.e2e.ts'],
  services: ['electron'],
  // One capability per spec file, each pointed at a data folder of its own.
  //
  // `--user-data-dir` as well as `--data-dir`, and both the same folder: the driver looks for
  // the port file Chromium writes inside the user data directory it chose, and the application
  // moves `userData` onto its data folder. Told the same folder twice, the two agree; told
  // nothing, they disagree and no session is ever created.
  capabilities: SPECS.map((spec) => ({
    browserName: 'electron',
    specs: [`./e2e/${spec}`],
    'wdio:electronServiceOptions': {
      appEntryPoint: `${application}/dist/main/index.js`,
      appArgs: [`--user-data-dir=${e2eDataOf(spec)}`, `--data-dir=${e2eDataOf(spec)}`],
    },
  })),
  logLevel: 'warn',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  // One window at a time: the suite moves, measures and closes the same one.
  maxInstances: 1,

  // Emptied before the run and after it, so a suite never reads what the last one left and the
  // machine is not left carrying data folders nobody asked for.
  onPrepare() {
    for (const spec of SPECS) rmSync(e2eDataOf(spec), { recursive: true, force: true })
  },
  onComplete() {
    for (const spec of SPECS) rmSync(e2eDataOf(spec), { recursive: true, force: true })
  },
}
