/**
 * Run before every file of the `repository` project: the spawn guard (`spawn-guard.ts`) on, and a
 * test that asked for a refused program, or for a Git on a home outside the temporary folder (#488),
 * failed, naming it, even when the code under test swallowed the refusal.
 */

import { tmpdir } from 'node:os'

import { afterEach } from 'vite-plus/test'

import { REPOSITORY, SYSTEM_PROGRAMS, installSpawnGuard, takeRefused } from './spawn-guard.ts'

installSpawnGuard({
  folders: [tmpdir(), REPOSITORY],
  homes: [tmpdir()],
  names: SYSTEM_PROGRAMS,
  platform: process.platform,
})

afterEach(() => {
  const programs = takeRefused()
  if (programs.length > 0) {
    throw new Error(`this test started what the spawn guard refuses: ${programs.join(', ')}`)
  }
})
