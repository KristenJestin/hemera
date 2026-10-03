/**
 * Development run: the renderer is served, the Node bundles are rebuilt on change, and
 * Electron is started once on the address the server picked.
 *
 * Electron is started last and on purpose: the main process reads the address from its
 * environment, so there is nothing to guess and no port kept in two places.
 *
 * A build in watch mode answers before its first build has been written, and that first build
 * empties its own output folder on the way in: started on that answer, Electron looks into a
 * folder being emptied under it and dies on `Cannot find module dist/main/index.js`. So each
 * bundle is built once for real before anything watches it, and the watchers' first pass, which
 * rewrites each bundle in place, is waited for before the application is started.
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, createServer } from 'vite-plus'

import { agentsBundle, engineBundle, mainBundle, preloadBundle, rendererBundle } from './bundles.ts'
import { RENDERER_URL_VARIABLE } from './src/main/renderer-source.ts'

const application = dirname(fileURLToPath(import.meta.url))

const NODE_BUNDLES = [mainBundle, engineBundle, agentsBundle, preloadBundle]

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

await Promise.all(NODE_BUNDLES.map((bundle) => build(bundle)))
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
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env

const started = spawn(binary, [application, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...environment, [RENDERER_URL_VARIABLE]: address },
})
started.on('close', (code) => {
  void server.close().then(() => process.exit(code ?? 0))
})
