/**
 * A repository's test runner and report in Project settings (#421): the guess read from the files
 * at its root and named with its rule, the value written by hand that replaces it and is stored
 * with the Project, "back to the guess", and the checks on save, a link leading outside the
 * repository among them.
 *
 * Each test runs on a data folder and on repositories made for it under the temporary directory,
 * migrated by the migrations the application ships.
 */

import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { TestReportingRefused } from '@hemera/core/domain'
import { type Project, StaleVersion } from '@hemera/ipc'
import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { gitLayer } from '../src/engine/git.ts'
import { openProfile } from '../src/engine/migrate.ts'
import { createProject, getProject } from '../src/engine/projects.ts'
import { type ProjectServices, repositoryStatusesLayer } from '../src/engine/repositories.ts'
import { setTestReporting, testGuessOf } from '../src/engine/repository-tests.ts'
import { repository } from './repositories.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(async () => {
  data = temporaryFolder('repository-tests')
  work = realpathSync.native(temporaryFolder('repository-tests-work'))
  await on(data, openProfile(data, SHIPPED, '1.0.0'))
})
afterEach(removeFolders)

const run = <A, E>(program: Effect.Effect<A, E, ProjectServices | Scope.Scope>): Promise<A> =>
  on(data, program.pipe(Effect.provide(Layer.merge(gitLayer(), repositoryStatusesLayer))))

/** Acme, its `api` a pytest project, its `web` a vite one, its `shared` with only a Makefile. */
const acme = () => {
  const main = join(work, 'acme')
  mkdirSync(main, { recursive: true })
  for (const path of ['api', 'web', 'shared']) repository(join(main, path))
  writeFileSync(join(main, 'api', 'pyproject.toml'), '[project]\nname = "api"\n')
  writeFileSync(join(main, 'web', 'vite.config.ts'), 'export default {}\n')
  writeFileSync(join(main, 'shared', 'Makefile'), 'test:\n\t./run-tests\n')
  return {
    main,
    project: createProject({
      name: 'Acme',
      mainCheckout: main,
      repositories: ['api', 'web', 'shared'],
    }),
  }
}

const idOf = (project: Project, path: string) =>
  project.repositories.find((one) => one.path === path)?.id ?? ''

const reportingOf = (project: Project, path: string) =>
  project.repositories.find((one) => one.path === path)?.testReporting

describe('the guess is shown with its rule', () => {
  test('each repository is guessed from the file at its root, and one with none has no runner', async () => {
    const guesses = await run(
      Effect.gen(function* () {
        const project = yield* acme().project
        return yield* Effect.forEach(['api', 'web', 'shared'], (path) =>
          testGuessOf(idOf(project, path)),
        )
      }),
    )
    expect(guesses).toEqual([
      { runner: 'pytest', from: 'pyproject.toml' },
      { runner: 'vitest', from: 'vite.config.ts' },
      null,
    ])
  })
})

describe('a custom value replaces the guess, and back to the guess removes it', () => {
  test('a value written by hand is stored with the Project, and null goes back to the guess', async () => {
    const seen = await run(
      Effect.gen(function* () {
        const project = yield* acme().project
        const web = idOf(project, 'web')
        const custom = yield* setTestReporting({
          id: web,
          version: project.version,
          reporting: {
            runner: 'vitest',
            report: { format: 'json', path: ' reports/vitest.json ' },
          },
        })
        const read = yield* getProject(project.id)
        const back = yield* setTestReporting({ id: web, version: read.version, reporting: null })
        return { custom, read, back }
      }),
    )
    const value = { runner: 'vitest', report: { format: 'json', path: 'reports/vitest.json' } }
    expect(reportingOf(seen.custom, 'web')).toEqual(value)
    expect(reportingOf(seen.read, 'web')).toEqual(value)
    expect(reportingOf(seen.read, 'api')).toBeNull()
    expect(reportingOf(seen.back, 'web')).toBeNull()
  })

  test('a value that says what the guess says stores nothing', async () => {
    const after = await run(
      Effect.gen(function* () {
        const project = yield* acme().project
        return yield* setTestReporting({
          id: idOf(project, 'api'),
          version: project.version,
          reporting: { runner: 'pytest' },
        })
      }),
    )
    expect(reportingOf(after, 'api')).toBeNull()
  })

  test('a value saved on an older version of the Project is refused', async () => {
    const refused = await run(
      Effect.gen(function* () {
        const project = yield* acme().project
        return yield* Effect.flip(
          setTestReporting({
            id: idOf(project, 'api'),
            version: project.version - 1,
            reporting: { runner: 'go' },
          }),
        )
      }),
    )
    expect(refused).toBeInstanceOf(StaleVersion)
  })
})

describe('a path outside the repository and an unknown format are refused', () => {
  const refusedFor = (
    path: string,
    reporting: Parameters<typeof setTestReporting>[0]['reporting'],
    plant: (main: string) => void = () => {},
  ) =>
    run(
      Effect.gen(function* () {
        const made = acme()
        const project = yield* made.project
        plant(made.main)
        const refused = yield* Effect.flip(
          setTestReporting({ id: idOf(project, path), version: project.version, reporting }),
        )
        return { refused, after: yield* getProject(project.id) }
      }),
    )

  test('a path outside the repository is refused with the reason, and nothing is stored', async () => {
    const { refused, after } = await refusedFor('web', {
      runner: 'vitest',
      report: { format: 'json', path: '../reports/vitest.json' },
    })
    expect(refused).toEqual(
      new TestReportingRefused({
        field: 'path',
        reason: '../reports/vitest.json is outside web: the report must be written inside it.',
      }),
    )
    expect(reportingOf(after, 'web')).toBeNull()
  })

  test('a path that leads outside the repository through a link is refused', async () => {
    const outside = join(work, 'outside')
    mkdirSync(outside)
    // A junction on Windows, which needs no privilege; a directory link elsewhere.
    const { refused, after } = await refusedFor(
      'api',
      { runner: 'pytest', report: { format: 'junit', path: 'reports/junit.xml' } },
      (main) => symlinkSync(outside, join(main, 'api', 'reports'), 'junction'),
    )
    expect(refused).toEqual(
      new TestReportingRefused({
        field: 'path',
        reason:
          'reports/junit.xml leads outside api through a link: the report must be written inside it.',
      }),
    )
    expect(reportingOf(after, 'api')).toBeNull()
  })

  test('a format the reader does not read from that runner is refused', async () => {
    const { refused } = await refusedFor('api', {
      runner: 'pytest',
      report: { format: 'json', path: 'reports/pytest.json' },
    })
    expect(refused).toEqual(
      new TestReportingRefused({
        field: 'report',
        reason: 'Hemera reads no JSON report from pytest: choose JUnit XML.',
      }),
    )
  })

  test('a report that does not exist yet is accepted: the run writes it', async () => {
    const after = await run(
      Effect.gen(function* () {
        const project = yield* acme().project
        return yield* setTestReporting({
          id: idOf(project, 'api'),
          version: project.version,
          reporting: {
            runner: 'pytest',
            report: { format: 'junit', path: 'build/reports/junit.xml' },
          },
        })
      }),
    )
    expect(reportingOf(after, 'api')).toEqual({
      runner: 'pytest',
      report: { format: 'junit', path: 'build/reports/junit.xml' },
    })
  })
})
