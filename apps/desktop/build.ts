/** Builds the four bundles of the application, one after the other into the same folder. */

import { build } from 'vite-plus'

import { mainBundle, preloadBundle, engineBundle, rendererBundle } from './bundles.ts'

await build(mainBundle)
await build(preloadBundle)
await build(engineBundle)
await build(rendererBundle)
