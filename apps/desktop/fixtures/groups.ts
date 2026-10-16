/**
 * The fixture groups (#420): one per state worth testing by hand, each built from an empty base,
 * its state reached through the engine's services as a user and scripted agents would reach it.
 * Each says what to look at once the application is open on it.
 */

import { Effect } from 'effect'
import type { Cause } from 'effect'

import type { EngineServices } from '../src/engine/profile.ts'
import type { FixtureGit } from './git.ts'
import { larkspur } from './larkspur.ts'

/** What a group builds in: its folder for repositories, and a Git that commits the same way twice. */
export interface FixtureWorld {
  readonly work: string
  readonly git: FixtureGit
}

export interface FixtureGroup {
  readonly name: string
  /** What to test once the application is open on it. */
  readonly look: string
  /** Its state, through the engine's services, on a Profile opened from nothing. */
  readonly build: (world: FixtureWorld) => Effect.Effect<void, Cause.YieldableError, EngineServices>
}

export const FIXTURE_GROUPS: ReadonlyArray<FixtureGroup> = [
  {
    name: 'empty',
    look: 'The first launch: no project, the setup and the home as a new user sees them.',
    // The Profile opened once, its migrations applied: nothing else.
    build: () => Effect.void,
  },
  {
    name: 'project-ready',
    look: 'Larkspur, one project with two repositories (api, web), three variables and a fake secret (PAYMENTS_API_KEY, masked), nothing launched: the project page and its settings.',
    build: ({ work, git }) => Effect.asVoid(larkspur(work, git)),
  },
]
