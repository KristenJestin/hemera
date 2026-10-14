/**
 * A Project's checks and doc recipes, asked from the window through main to the engine (#152):
 * the proposals, accepted, listed and moved; a refusal arriving typed, with the field the settings
 * say it under.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  CheckRefused,
  DocRecipeRefused,
  EngineMainRpcs,
  fromMessagePort,
  InvalidProofLimit,
  makeClientProtocol,
  makeServerProtocol,
  WindowRpcs,
  type CheckDraft,
  type CommandDraft,
  type EngineStart,
} from '@hemera/ipc'
import { Effect, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { startProfile } from '../src/engine/profile.ts'
import { engineHandlers } from '../src/engine/serve.ts'
import { windowHandlers } from '../src/main/window-link.ts'
import { NO_AGENTS } from './commands-engine.ts'
import { SHIPPED, removeFolders, temporaryFolder } from './storage.ts'

let start: EngineStart
beforeEach(() => {
  start = {
    dataFolder: temporaryFolder('checks-link'),
    channel: 'dev',
    version: '1.0.0',
    migrations: SHIPPED,
  }
})
afterEach(removeFolders)

const unused = Effect.die('not asked of this main')

/** The window → main → engine chain, as `links.test.ts` builds it. */
const chain = Effect.gen(function* () {
  const { port1: mainToEngine, port2: engineEnd } = new MessageChannel()
  const engineServer = yield* makeServerProtocol
  engineServer.accept(fromMessagePort(engineEnd))
  const quiet = (): void => undefined
  const profile = yield* startProfile(
    start,
    { backupFolders: [], reconciliationSteps: [], sessions: { discovery: NO_AGENTS } },
    quiet,
  )
  yield* RpcServer.make(EngineMainRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(engineHandlers(start, profile, quiet)),
    Effect.provideService(RpcServer.Protocol, engineServer.protocol),
    Effect.forkScoped,
  )
  const engineProtocol = yield* makeClientProtocol(fromMessagePort(mainToEngine), 'the engine')
  const engine = yield* RpcClient.make(EngineMainRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, engineProtocol),
  )
  const { port1: windowEnd, port2: mainEnd } = new MessageChannel()
  const windowServer = yield* makeServerProtocol
  windowServer.accept(fromMessagePort(mainEnd))
  yield* RpcServer.make(WindowRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(
      windowHandlers(
        engine,
        {
          report: unused,
          relaunch: unused,
          showLog: unused,
          chooseFolder: unused,
          display: () => unused,
          notices: Stream.empty,
          preview: () => unused,
          hemeraAuto: { status: unused, save: () => unused, remove: unused },
          jiraToken: { status: () => unused, save: () => unused, remove: () => unused },
        },
        quiet,
      ),
    ),
    Effect.provideService(RpcServer.Protocol, windowServer.protocol),
    Effect.forkScoped,
  )
  const windowProtocol = yield* makeClientProtocol(fromMessagePort(windowEnd), 'main')
  return yield* RpcClient.make(WindowRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, windowProtocol),
  )
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

const command = (change: Partial<CommandDraft>): CommandDraft => ({
  name: 'lint',
  type: 'lint',
  line: 'node lint.mjs',
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: true,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
  ...change,
})

const check = (change: Partial<CheckDraft>): CheckDraft => ({
  name: 'unit',
  commandId: null,
  line: 'node test.mjs',
  where: 'changed',
  repository: null,
  when: 'task',
  expect: null,
  files: null,
  ...change,
})

/** Acme with `api`, its readme in the main checkout, and a lint and a build marked as checks. */
const acmeOf = (window: Effect.Success<typeof chain>) =>
  Effect.gen(function* () {
    const main = temporaryFolder('acme')
    mkdirSync(join(main, 'api', '.git'), { recursive: true })
    writeFileSync(join(main, 'api', 'README.md'), '# api\n')
    const acme = yield* window['projects.create']({
      name: 'Acme',
      mainCheckout: main,
      repositories: ['api'],
    })
    for (const [name, type] of [
      ['lint', 'lint'],
      ['build', 'build'],
    ] as const) {
      yield* window['catalogue.save']({
        projectId: acme.id,
        id: null,
        command: command({ name, type }),
      })
    }
    return acme
  })

describe('The checks of a Project, from the window', () => {
  test('accept the proposed checks: they are listed, and moved', () =>
    run(
      Effect.gen(function* () {
        const window = yield* chain
        const acme = yield* acmeOf(window)
        const proposed = yield* window['checks.propose']({ projectId: acme.id, asked: false })
        expect(proposed.map((one) => [one.name, one.when, one.where])).toEqual([
          ['lint', 'task', 'changed'],
          ['build', 'end', 'root'],
        ])
        expect(yield* window['checks.list']({ projectId: acme.id })).toEqual([])
        yield* window['checks.accept']({ projectId: acme.id, proposals: proposed })
        const [lint, build] = yield* window['checks.list']({ projectId: acme.id })
        const moved = yield* window['checks.move']({
          projectId: acme.id,
          id: build?.id ?? '',
          rank: 0,
        })
        expect(moved.map((one) => one.name)).toEqual(['build', 'lint'])
        yield* window['checks.remove']({ projectId: acme.id, id: lint?.id ?? '' })
        expect(
          (yield* window['checks.list']({ projectId: acme.id })).map((one) => one.name),
        ).toEqual(['build'])
      }),
    ))

  test('a free line with | is refused at the line, in the engine’s words', () =>
    run(
      Effect.gen(function* () {
        const window = yield* chain
        const acme = yield* acmeOf(window)
        const refused = yield* Effect.flip(
          window['checks.save']({
            projectId: acme.id,
            id: null,
            check: check({ line: 'node test.mjs | tee out.txt' }),
          }),
        )
        expect(refused).toBeInstanceOf(CheckRefused)
        expect(refused).toMatchObject({ field: 'line' })
        expect(refused.message).toContain('“|”')
      }),
    ))

  test('a coverage check is saved with its pattern and its minimum', () =>
    run(
      Effect.gen(function* () {
        const window = yield* chain
        const acme = yield* acmeOf(window)
        const coverage = check({
          name: 'coverage',
          line: 'node coverage.mjs',
          when: 'requirement',
          expect: { pattern: 'Coverage: ([0-9.]+)%', minimum: 70 },
        })
        const saved = yield* window['checks.save']({
          projectId: acme.id,
          id: null,
          check: coverage,
        })
        expect(saved).toMatchObject(coverage)
        const refused = yield* Effect.flip(
          window['checks.save']({
            projectId: acme.id,
            id: saved.id,
            check: { ...coverage, expect: { pattern: 'Coverage: [0-9.]+%', minimum: 70 } },
          }),
        )
        expect(refused).toMatchObject({ field: 'pattern' })
      }),
    ))

  test('a minimum that is not a number crosses the links and is refused at the minimum', () =>
    run(
      Effect.gen(function* () {
        const window = yield* chain
        const acme = yield* acmeOf(window)
        const refused = yield* Effect.flip(
          window['checks.save']({
            projectId: acme.id,
            id: null,
            check: check({ expect: { pattern: 'Coverage: ([0-9.]+)%', minimum: Number.NaN } }),
          }),
        )
        expect(refused).toBeInstanceOf(CheckRefused)
        expect(refused).toMatchObject({ field: 'minimum' })
      }),
    ))
})

describe('How long a proof may run, from the window', () => {
  test('a Project with no value keeps the default; a value set is kept, a refused one arrives with its reason', () =>
    run(
      Effect.gen(function* () {
        const window = yield* chain
        const acme = yield* acmeOf(window)
        expect(yield* window['checks.proofLimit']({ projectId: acme.id })).toBeNull()
        expect(yield* window['checks.setProofLimit']({ projectId: acme.id, minutes: 20 })).toBe(20)
        expect(yield* window['checks.proofLimit']({ projectId: acme.id })).toBe(20)
        const refused = yield* Effect.flip(
          window['checks.setProofLimit']({ projectId: acme.id, minutes: 0 }),
        )
        expect(refused).toBeInstanceOf(InvalidProofLimit)
        expect(refused.message).toBe('A proof needs at least 1 minute.')
        expect(yield* window['checks.setProofLimit']({ projectId: acme.id, minutes: null })).toBe(
          null,
        )
      }),
    ))
})

describe('The doc recipes of a Project, from the window', () => {
  test('accept the proposed doc recipes from the main checkout: they are listed', () =>
    run(
      Effect.gen(function* () {
        const window = yield* chain
        const acme = yield* acmeOf(window)
        const proposed = yield* window['docRecipes.propose']({ projectId: acme.id, asked: false })
        expect(proposed.map((one) => [one.repository, one.path])).toEqual([['api', 'README.md']])
        yield* window['docRecipes.accept']({ projectId: acme.id, proposals: proposed })
        const listed = yield* window['docRecipes.list']({ projectId: acme.id })
        expect(listed.map((one) => one.path)).toEqual(['README.md'])
        const refused = yield* Effect.flip(
          window['docRecipes.save']({
            projectId: acme.id,
            id: listed[0]?.id ?? null,
            recipe: { ...proposed[0]!, path: '../web/README.md' },
          }),
        )
        expect(refused).toBeInstanceOf(DocRecipeRefused)
        expect(refused).toMatchObject({ field: 'path' })
      }),
    ))
})
