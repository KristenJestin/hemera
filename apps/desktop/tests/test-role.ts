/**
 * The role the suites run on: a mission's writing role that reads the Memory. Registered by the
 * suites only, never shipped.
 */

import { Effect } from 'effect'

import type { RoleEntry } from '../src/engine/sessions/roles.ts'

export const TEST_ROLE: RoleEntry = {
  id: 'test',
  displayName: 'the test role',
  ownerKind: 'mission',
  placeKind: 'workspace',
  writes: true,
  readsMemory: true,
  projectLayer: true,
  mainOf: null,
  template: '# The test role\n\nDo what each delivery asks, and nothing else.',
  brief: () => Effect.succeed([]),
  countsInCap: true,
  ledByUser: false,
}
