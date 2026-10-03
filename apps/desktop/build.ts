/** Builds the bundles of the application, one after the other into the same folder. */

import { build } from 'vite-plus'

import { agentsBundle, engineBundle, mainBundle, preloadBundle, rendererBundle } from './bundles.ts'

await build(mainBundle)
await build(engineBundle)
await build(agentsBundle)
await build(preloadBundle)
await build(rendererBundle)
