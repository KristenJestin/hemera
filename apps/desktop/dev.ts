/**
 * Development run: the renderer is served, the three Node bundles are rebuilt on change, and
 * Electron is started once on the address the server picked.
 *
 * Electron is started last and on purpose: the main process reads the address from its
 * environment, so there is nothing to guess and no port kept in two places.
 *
 * The order of the steps is the whole of this file, and two of them were learned the hard way.
 *
 * A build in watch mode answers before its first build has been written, and that first build
 * empties its own output folder on the way in: started on that answer, Electron looks into a
 * folder being emptied under it and dies on `Cannot find module dist/main/index.js`. That is what
 * a second `pnpm dev` did, with the first one working. So each bundle is built once for real
 * before anything watches it.
 *
 * A watcher's first pass is a build like any other, and it rewrites its bundle in place: the file
 * is removed, written back in pieces, and only whole at the end. Measured on the engine bundle,
 * it is gone for 60 to 130 ms and has been seen at 266 KB of its 1 MB. Anything started in that
 * window dies on it, and `utilityProcess.fork` reads `dist/engine/index.js` as soon as Electron
 * boots — which is exactly when the watchers run that pass. So the pass is waited for, and only
 * then is the application started.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, createServer } from 'vite-plus'

import { VERSION_VARIABLE } from './src/main/channel.ts'
import { RENDERER_URL_VARIABLE } from './src/main/renderer-source.ts'
import {
  adapterBundle,
  mainBundle,
  preloadBundle,
  engineBundle,
  rendererBundle,
} from './bundles.ts'

const application = dirname(fileURLToPath(import.meta.url))

const NODE_BUNDLES = [mainBundle, preloadBundle, engineBundle, adapterBundle]

/**
 * A build in watch mode answers with its watcher before its first build is written, and the
 * watcher says `END` once that build is whole. `emptyOutDir` stays off: these bundles were just
 * built for real, and a watcher's pass has no business emptying what it is about to overwrite.
 */
const watched = async (): Promise<void> => {
  const armed = await Promise.all(
    NODE_BUNDLES.map((bundle) =>
      build({ ...bundle, build: { ...bundle.build, emptyOutDir: false, watch: {} } }),
    ),
  )
  await Promise.all(
    armed.map(
      (built) =>
        new Promise<void>((done, failed) => {
          // The watcher is the only arm of what `build` answers with that can be waited on.
          if (!('on' in built)) return done()
          built.on('event', (event) => {
            if (event.code === 'END') done()
            if (event.code === 'ERROR') failed(event.error)
          })
        }),
    ),
  )
}

// Once, for real, and only then can anything be started on what they write: a watcher answers
// before this point.
await Promise.all(NODE_BUNDLES.map((bundle) => build(bundle)))

// And the same three, watched — their first pass waited for, because it rewrites what they hold.
await watched()

const server = await createServer(rendererBundle)
await server.listen()
const address = server.resolvedUrls?.local[0]
if (address === undefined) throw new Error('the renderer development server has no address')

// Outside Electron, the module is the path of the binary this package installed: a string,
// which the package's own typing (written for the inside) does not say.
const binary: string = createRequire(import.meta.url)('electron')

// A terminal opened inside an Electron based editor exports ELECTRON_RUN_AS_NODE, and the
// binary then starts as a plain Node process: no window, and no `electron` module to import.
// The application is started as an application whatever the shell it is started from.
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env

// A development run has no version of its own: its manifest says `0.0.0` and a package is what
// carries one. The label the repository answers is handed over here rather than asked for by the
// main process, which has nothing blocking to do at start-up.
const described = spawnSync('git describe --tags --always', {
  cwd: application,
  encoding: 'utf8',
  shell: true,
})

const started = spawn(binary, [application], {
  stdio: 'inherit',
  env: {
    ...environment,
    [RENDERER_URL_VARIABLE]: address,
    [VERSION_VARIABLE]: described.status === 0 ? described.stdout.trim() : '',
  },
})
started.on('close', (code) => {
  void server.close().then(() => process.exit(code ?? 0))
})
