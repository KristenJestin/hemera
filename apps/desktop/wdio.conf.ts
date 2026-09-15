/**
 * End-to-end run of the application (design D0-10).
 *
 * The suite drives the real application: the binary this package installed, the bundles this
 * package built, on the target the run happens on. Nothing is mocked, because what the lot
 * claims is about a window on a machine, and a mock has neither.
 *
 *   pnpm --filter @hemera/desktop e2e
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const application = dirname(fileURLToPath(import.meta.url))

// A terminal opened inside an Electron based editor exports ELECTRON_RUN_AS_NODE, and the
// binary would then start as a plain Node process: no window for the suite to drive.
delete process.env.ELECTRON_RUN_AS_NODE

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./e2e/**/*.e2e.ts'],
  services: ['electron'],
  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        appEntryPoint: `${application}/dist/main/index.js`,
      },
    },
  ],
  logLevel: 'warn',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  // One window at a time: the suite moves, measures and closes the same one.
  maxInstances: 1,
}
