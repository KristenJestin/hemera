#!/usr/bin/env bun
/** Points git at the versioned hooks of this repository. */

import { resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..')
const result = Bun.spawnSync(['git', 'config', 'core.hooksPath', '.githooks'], { cwd: repository })
if (result.exitCode !== 0) {
  console.error('failed to set core.hooksPath')
  process.exit(1)
}
console.log('git hooks installed from .githooks')
