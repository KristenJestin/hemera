/**
 * Development run: the renderer is served, the two Node bundles are rebuilt on change, and
 * Electron is started once on the address the server picked.
 *
 * Electron is started last and on purpose: the main process reads the address from its
 * environment, so there is nothing to guess and no port kept in two places.
 */

import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import electron from 'electron'
import { build, createServer } from 'vite-plus'

import { RENDERER_URL_VARIABLE } from './src/main/renderer-source.ts'
import { mainBundle, preloadBundle, rendererBundle } from './bundles.ts'

const application = dirname(fileURLToPath(import.meta.url))

await build({ ...mainBundle, build: { ...mainBundle.build, watch: {} } })
await build({ ...preloadBundle, build: { ...preloadBundle.build, watch: {} } })

const server = await createServer(rendererBundle)
await server.listen()
const address = server.resolvedUrls?.local[0]
if (address === undefined) throw new Error('the renderer development server has no address')

// Outside Electron, the module is the path of the binary this package installed.
const binary = electron as unknown as string

// A terminal opened inside an Electron based editor exports ELECTRON_RUN_AS_NODE, and the
// binary then starts as a plain Node process: no window, and no `electron` module to import.
// The application is started as an application whatever the shell it is started from.
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env

const started = spawn(binary, [application], {
  stdio: 'inherit',
  env: { ...environment, [RENDERER_URL_VARIABLE]: address },
})
started.on('close', (code) => {
  void server.close().then(() => process.exit(code ?? 0))
})
