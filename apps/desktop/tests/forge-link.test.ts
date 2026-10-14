/**
 * The forge's waits as the window reaches them through main (#362): the window regaining the
 * focus, every check of which runs on its own, so that one failing skips none of the others, and
 * the forge's check wakes an operation that waits on a CLI signed in since; and Retry on a forge
 * need, whose answer says what the CLI lacks once it was checked again.
 *
 * The CLI is a fake alone on a `PATH` of its own (`fake-forge.ts`): no real `gh`, no forge.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  EngineMainRpcs,
  fromMessagePort,
  makeClientProtocol,
  makeServerProtocol,
  type EngineStart,
  WindowRpcs,
} from '@hemera/ipc'
import { Effect, Fiber, Predicate, Schedule, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ForgePort } from '../src/engine/forges/port.ts'
import { listNeeds } from '../src/engine/needs.ts'
import { startProfile } from '../src/engine/profile.ts'
import { createProject } from '../src/engine/projects.ts'
import { eachOnItsOwn, engineHandlers } from '../src/engine/serve.ts'
import { windowHandlers } from '../src/main/window-link.ts'
import { NO_AGENTS } from './commands-engine.ts'
import { type FakeForge, fakeForge, ghReady, ghSignedOut } from './fake-forge.ts'
import { git } from './repositories.ts'
import { SHIPPED, removeFolders, temporaryFolder } from './storage.ts'

let start: EngineStart
beforeEach(() => {
  start = {
    dataFolder: temporaryFolder('focus-link'),
    channel: 'dev',
    version: '1.0.0',
    migrations: SHIPPED,
  }
})
afterEach(removeFolders)

const unused = Effect.die('not asked of this main')

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

/**
 * The engine over the fake CLIs, main's client of it and the window's client of main, as
 * `links.test.ts` builds them, with Atlas's shop on GitHub.
 */
const engineWith = (fake: FakeForge) =>
  Effect.gen(function* () {
    const { port1: mainToEngine, port2: engineEnd } = new MessageChannel()
    const engineServer = yield* makeServerProtocol
    engineServer.accept(fromMessagePort(engineEnd))
    const quiet = (): void => undefined
    const profile = yield* startProfile(
      start,
      {
        backupFolders: [],
        reconciliationSteps: [],
        sessions: { discovery: NO_AGENTS },
        forge: { env: fake.env },
      },
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
    const { port1: windowEnd, port2: mainFromWindow } = new MessageChannel()
    const windowServer = yield* makeServerProtocol
    windowServer.accept(fromMessagePort(mainFromWindow))
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
    const window = yield* RpcClient.make(WindowRpcs).pipe(
      Effect.provideService(RpcClient.Protocol, windowProtocol),
    )
    const shop = join(temporaryFolder('focus-work'), 'atlas', 'shop')
    mkdirSync(shop, { recursive: true })
    git(shop, 'init', '-q', '-b', 'main')
    git(shop, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(shop, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git')
    const project = yield* profile.use(
      createProject({ name: 'Atlas', mainCheckout: join(shop, '..'), repositories: ['shop'] }),
    )
    return { engine, window, profile, project, shop: project.repositories[0]?.id ?? '' }
  })

describe('The window regaining the focus wakes an operation waiting on its forge CLI', () => {
  test('a waiter on a signed-out gh resumes after main tells the engine of the focus, once gh is signed in', () =>
    run(
      Effect.gen(function* () {
        const fake = fakeForge(ghSignedOut())
        const { engine, profile, project, shop } = yield* engineWith(fake)
        const waiting = yield* Effect.forkChild(
          profile.use(ForgePort.use((port) => port.currentUser(shop))),
        )
        yield* profile.use(listNeeds).pipe(
          Effect.repeat({
            schedule: Schedule.spaced('50 millis'),
            until: (groups) => groups.some((group) => group.needs.length > 0),
          }),
        )
        fake.answer(ghReady())
        yield* engine['mission.focused']()
        // Checked again by the focus itself, before it answered: no wait on a recheck.
        const states = yield* profile.use(ForgePort.use((port) => port.status(project.id)))
        expect(states.map((state) => state.state)).toEqual(['ready'])
        expect(yield* Fiber.join(waiting)).toBe('octo')
      }),
    ))
})

describe('A focus check that fails skips none of the others', () => {
  test.each([[['outside']], [['diffs']], [['outside', 'diffs']]])(
    'with %j failing, the forge is still checked again and each failure is written down',
    (failing) =>
      run(
        Effect.gen(function* () {
          const lines: string[] = []
          let forgeChecked = false
          const check = (name: string) =>
            failing.includes(name) ? Effect.die(new Error(`${name} broke`)) : Effect.void
          yield* eachOnItsOwn(
            [
              ['outside', check('outside')],
              ['diffs', check('diffs')],
              [
                'forge',
                Effect.sync(() => {
                  forgeChecked = true
                }),
              ],
            ],
            (line) => lines.push(line),
          )
          expect(forgeChecked).toBe(true)
          expect(lines).toEqual(
            failing.map((name) =>
              expect.stringMatching(
                new RegExp(`^mission\\.focused: ${name}: failed: .*${name} broke`),
              ),
            ),
          )
        }),
      ),
  )
})

describe('Retry on a forge need answers what the CLI lacks once checked again', () => {
  test('gh missing, then installed but signed out: the window’s Retry answers the need saying to sign in', () =>
    run(
      Effect.gen(function* () {
        const fake = fakeForge(ghSignedOut(), ['bkt'])
        const { window, profile, shop } = yield* engineWith(fake)
        yield* Effect.forkChild(profile.use(ForgePort.use((port) => port.currentUser(shop))))
        const [need] = yield* profile.use(listNeeds).pipe(
          Effect.map((groups) => groups.flatMap((group) => group.needs)),
          Effect.repeat({
            schedule: Schedule.spaced('50 millis'),
            until: (needs) => needs.length > 0,
          }),
        )
        fake.install('gh')
        const answered = yield* window['needs.retry']({ id: need?.id ?? '' })
        expect(answered.state).toBe('pending')
        expect(
          Predicate.isTagged(answered.fields, 'Environment') ? answered.fields : null,
        ).toMatchObject({
          missing: 'gh signed in on github.com',
          action: 'Sign in: gh auth login --hostname github.com\nThen choose Check again.',
        })
      }),
    ))
})
