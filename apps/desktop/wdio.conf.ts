/**
 * End-to-end run of the application.
 *
 * The suite drives the real application: the binary this package installed, the bundles this
 * package built, on the target the run happens on. Nothing is mocked, because what it claims is
 * about a window on a machine, and a mock has neither. Build first (`pnpm build`).
 *
 *   pnpm --filter @hemera/desktop e2e
 *   pnpm --filter @hemera/desktop e2e:headless   (the same, with no window on screen)
 */

import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FAKE_GH_SPECS, RUNS_FAKE_GH, fakeGhOf } from './e2e/fake-gh.ts'

const application = dirname(fileURLToPath(import.meta.url))

/** What a spec file is named after to run on the profile another one left: Hemera started again. */
const RESTARTED = /\.restarted$/

/**
 * The Electron profile one spec file runs on, made for it and thrown away after the run.
 *
 * A suite that opened the profile of this machine would write into it, which is the one thing no
 * test is allowed to do. The path is spelled out rather than drawn from `mkdtemp`, because this
 * file is evaluated once by the launcher and once again inside every worker: a folder made on
 * evaluation would be a different folder in each of them.
 *
 * `<name>.restarted.e2e.ts` runs on the profile of `<name>.e2e.ts`, which it follows in the run:
 * it is the application started again on the data folder the first one left.
 */
export function e2eProfileOf(spec: string): string {
  return join(tmpdir(), `hemera-e2e-${basename(spec, '.e2e.ts').replace(RESTARTED, '')}`)
}

/** Every spec file of the suite, which is one capability and one profile each. */
const SPECS = readdirSync(join(application, 'e2e'))
  .filter((entry) => entry.endsWith('.e2e.ts'))
  .toSorted()

/** The `PATH` the run was started with, before any spec file's fake led it. */
const PATH = process.env.PATH ?? ''

/**
 * The `PATH` a spec file's application is started with: led by the folder of its fake `gh` when
 * it runs on one (`e2e/fake-gh.ts`), the run's own otherwise. Set on the launcher before each
 * worker starts, as the worker, its driver and the application inherit the launcher's variables.
 */
export function pathFor(spec: string): string {
  return RUNS_FAKE_GH && FAKE_GH_SPECS.includes(basename(spec))
    ? `${fakeGhOf(spec)}${delimiter}${PATH}`
    : PATH
}

// A terminal opened inside an Electron based editor exports ELECTRON_RUN_AS_NODE, and the
// binary would then start as a plain Node process: no window for the suite to drive.
delete process.env.ELECTRON_RUN_AS_NODE

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./e2e/**/*.e2e.ts'],
  services: ['electron'],
  // One capability per spec file, each pointed at a profile of its own. The driver looks for the
  // port file Chromium writes inside the user data directory, so the folder is given as such.
  capabilities: SPECS.map((spec) => ({
    browserName: 'electron',
    specs: [`./e2e/${spec}`],
    'wdio:electronServiceOptions': {
      appEntryPoint: `${application}/dist/main/index.js`,
      appArgs: [`--user-data-dir=${e2eProfileOf(spec)}`],
    },
  })),
  logLevel: 'warn',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  // One window at a time.
  maxInstances: 1,

  // Emptied before the run and after it, so a suite never reads what the last one left and the
  // machine is not left carrying profiles nobody asked for.
  onPrepare() {
    for (const spec of SPECS) rmSync(e2eProfileOf(spec), { recursive: true, force: true })
  },
  onComplete() {
    for (const spec of SPECS) rmSync(e2eProfileOf(spec), { recursive: true, force: true })
  },
  onWorkerStart(_cid, _capabilities, specs) {
    process.env.PATH = pathFor(specs[0] ?? '')
  },
}
