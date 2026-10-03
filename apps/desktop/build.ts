/** Builds the three bundles of the application, one after the other into the same folder. */

import { build } from 'vite-plus'

import { mainBundle, preloadBundle, rendererBundle } from './bundles.ts'

await build(mainBundle)
await build(preloadBundle)
await build(rendererBundle)
