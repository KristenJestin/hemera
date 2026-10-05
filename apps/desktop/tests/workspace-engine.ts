/**
 * The engine the suites about Workspaces run on, and the Project they run it over.
 *
 * Nothing is faked but the runner of `run` steps, whose real implementation is the command
 * catalogue's: the database is in the suite's data folder, Git is the machine's own on real
 * repositories, and the disk is the disk. The Project is `Atlas`, whose main checkout holds three
 * repositories, `api`, `web` and `worker`, each with a bare repository on the same disk as its
 * remote, and a plain `.env` file at its root; nothing here can reach a network.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_BASE_BRANCH } from '@hemera/core/domain'
import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'

import { gitLayer } from '../src/engine/git.ts'
import { openProfile } from '../src/engine/migrate.ts'
import {
  type RecipeRun,
  RecipeRunner,
  type RecipeRunOutcome,
  RecipeRunRefused,
} from '../src/engine/recipe-runner.ts'
import { ProfileHome } from '../src/engine/profile-home.ts'
import { createProject } from '../src/engine/projects.ts'
import { repositoryStatusesLayer } from '../src/engine/repositories.ts'
import { Secrets, secretsRegistry } from '../src/engine/secrets.ts'
import { type WorkspaceServices, preparationsLayer } from '../src/engine/workspaces.ts'
import { remote, repository } from './repositories.ts'
import { SHIPPED, type Storage, on } from './storage.ts'

/** A runner that records what it was handed and answers as told, by the line it runs. */
export interface FakeRunner {
  readonly runs: RecipeRun[]
  readonly layer: Layer.Layer<RecipeRunner>
}

export function fakeRunner(
  answer: (run: RecipeRun) => RecipeRunOutcome | 'refused' = () => ({
    exitCode: 0,
    output: 'ok\n',
  }),
): FakeRunner {
  const runs: RecipeRun[] = []
  return {
    runs,
    layer: Layer.succeed(RecipeRunner, {
      run: (run) =>
        Effect.suspend(() => {
          runs.push(run)
          const answered = answer(run)
          return answered === 'refused'
            ? Effect.fail(new RecipeRunRefused({ reason: 'the user denied it' }))
            : Effect.succeed(answered)
        }),
    }),
  }
}

/** Opens the data folder once, so every later run finds it migrated. */
export const opened = (data: string) => on(data, openProfile(data, SHIPPED, '1.0.0'))

/**
 * One run of the engine over a data folder: its database, the machine's Git, Hemera's own
 * Workspaces folder under it, and the runner given. One call is one opening of the engine.
 */
export function workspaceEngine(data: string, runner: FakeRunner = fakeRunner()) {
  const services = Layer.mergeAll(
    gitLayer(),
    repositoryStatusesLayer,
    Layer.succeed(ProfileHome, { dataFolder: data, version: '1.0.0', migrations: SHIPPED }),
    runner.layer,
    preparationsLayer(() => {}),
    Layer.succeed(Secrets, secretsRegistry()),
  )
  return <A, E>(
    program: Effect.Effect<A, E, WorkspaceServices | Storage | Scope.Scope>,
  ): Promise<A> => on(data, Effect.provide(program, services))
}

/** The same, for a program expected to fail: its error is the answer. */
export function refusedBy(data: string, runner: FakeRunner = fakeRunner()) {
  const run = workspaceEngine(data, runner)
  return <A, E>(program: Effect.Effect<A, E, WorkspaceServices | Storage | Scope.Scope>) =>
    run(Effect.flip(program))
}

export const REPOSITORIES = ['api', 'web', 'worker'] as const

/**
 * Atlas's main checkout under `work`: the three repositories on the default base branch, each
 * pushed to a bare remote of its own under `work/remotes`, and a `.env` at the root.
 */
export function atlasOnDisk(work: string): string {
  const main = join(work, 'atlas')
  for (const name of REPOSITORIES) {
    const path = repository(join(main, name), DEFAULT_BASE_BRANCH)
    remote(path, join(work, 'remotes', `${name}.git`))
  }
  mkdirSync(main, { recursive: true })
  writeFileSync(join(main, '.env'), 'FROM_MAIN=1\n')
  return main
}

/** The Project over that main checkout, with its three repositories. */
export const atlas = (main: string) =>
  createProject({ name: 'Atlas', mainCheckout: main, repositories: [...REPOSITORIES] })
