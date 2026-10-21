/**
 * The delivery from Ship to Done (S1): the plan Ship's copy gives, the waves, every step's states,
 * Retry, Stop delivery, the waits and a restart.
 *
 * On the engine as it starts, over a data folder of the suite's own: Acme's `shared`, `api` and
 * `web` as Git repositories in temporary folders, with remotes that are never reached. The steps
 * are fake types handed to the engine as a Profile part, reading and changing a world of the
 * suite's own: no forge, no agent, no network. A mission is put in Shipping as Ship's transaction
 * leaves it (its copies, its record, `mission.shipped`); Ship's own suite covers Ship.
 *
 * A wait is read every hour here: what a suite sees read again is a restart or a refresh, never
 * the time passing. Where a test needs a step caught midway, the engine's hold holds it.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { PermissionAnswer, type DeliveryAction, type RepositoryWaves } from '@hemera/core/domain'
import type { CommandDraft } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Deferred, Effect, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { saveCommand } from '../src/engine/catalogue.ts'
import { saveDeliveryRules } from '../src/engine/delivery-rules.ts'
import {
  ALREADY_DONE,
  Deliveries,
  type DeliveryHold,
  GO,
  RETRY,
  RUN_AGAIN,
  STOP_DELIVERY,
} from '../src/engine/delivery/run.ts'
import { type StepType, done, failed, waiting } from '../src/engine/delivery/steps.ts'
import { moveMission } from '../src/engine/missions.ts'
import { answerNeed } from '../src/engine/needs.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { createProject } from '../src/engine/projects.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { commandRuns, deliveryPushes, effectfulActions } from '../src/engine/storage/schema.ts'
import { STAYS_UP, commandsEngine, nodeLine, script, until } from './commands-engine.ts'
import {
  type Acme,
  NO_CHANGE,
  World,
  answer,
  delivered,
  deliveryOf,
  deliveryUntil,
  fakeType,
  isDecision,
  journalOf,
  memoryLines,
  needUntil,
  needsOf,
  repositoryWaves,
  rulesWith,
  shipped,
  stateOf,
  statusOf,
  typesOf,
} from './delivery-world.ts'
import { git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('delivery-run'))
  work = realpathSync.native(temporaryFolder('delivery-run-work'))
})
afterEach(removeFolders)

/** Every test opens an engine once or twice over Git repositories: far above its time alone. */
const SLOW = 60_000

/** A token of the shape the masking knows, joined at run time: a secret scanner never sees it. */
const TOKEN = ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('')

const REPOSITORIES = ['shared', 'api', 'web'] as const

const checkout = () => {
  const main = join(work, 'acme')
  for (const path of REPOSITORIES) {
    const folder = join(main, path)
    mkdirSync(folder, { recursive: true })
    git(folder, 'init', '-q', '-b', 'main')
    git(folder, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(folder, 'remote', 'add', 'origin', `git@github.com:acme/${path}.git`)
  }
  return main
}

interface Opening {
  readonly types?: ReadonlyArray<readonly [string, StepType]>
  readonly hold?: DeliveryHold
}

/** One opening of the engine over the suite's data folder: two calls are a restart. */
const engine =
  (world: World, opening: Opening = {}) =>
  <A, E>(program: Effect.Effect<A, E, EngineServices>) =>
    commandsEngine(data, {
      deliveries: {
        types: typesOf(world, opening.types),
        pollEvery: '1 hour',
        hold: opening.hold,
      },
    })(({ profile }) => profile.use(program))

// ——— Acme, its rules, a mission in Shipping ———

const acme = Effect.gen(function* () {
  const project = yield* createProject({
    name: 'Acme',
    mainCheckout: checkout(),
    repositories: [...REPOSITORIES],
  })
  const id = (path: string) => {
    const found = project.repositories.find((one) => one.path === path)
    if (found === undefined) throw new Error(`no repository ${path}`)
    return found.id
  }
  return { projectId: project.id, id } satisfies Acme
})

/** Acme as a chain: `shared` publishes, `api` bumps on it, `web` is an application over `api`. */
const chain = (world: Acme, steps: Partial<Record<string, RepositoryWaves['steps']>> = {}) =>
  rulesWith([
    repositoryWaves(world.id('shared'), 'library', [], steps['shared']),
    repositoryWaves(world.id('api'), 'library', [world.id('shared')], steps['api']),
    repositoryWaves(world.id('web'), 'application', [world.id('api')], steps['web']),
  ])

/** Acme as one wave: three applications that depend on nothing. */
const oneWave = (world: Acme, steps: Partial<Record<string, RepositoryWaves['steps']>> = {}) =>
  rulesWith(
    REPOSITORIES.map((path) => repositoryWaves(world.id(path), 'application', [], steps[path])),
  )

/** A step placed first in a repository's steps. */
const first = (step: DeliveryAction): RepositoryWaves['steps'] => ({
  ...NO_CHANGE,
  added: [{ after: null, step }],
})

/** A step of the preset changed to wait for the user's click. */
const clicked = (step: DeliveryAction): RepositoryWaves['steps'] => ({
  ...NO_CHANGE,
  changed: [{ ...step, mode: 'click' }],
})

/** A hold that stops a step once, and says when it got there. */
const holdOnce = (repository: string, step: string, at: 'running' | 'ran' = 'running') =>
  Effect.gen(function* () {
    const reached = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let held = false
    const hold: DeliveryHold = (moment, where, which) =>
      moment === at && where === repository && which === step && !held
        ? Effect.gen(function* () {
            held = true
            yield* Deferred.succeed(reached, undefined)
            yield* Deferred.await(release)
          })
        : Effect.void
    return { hold, reached, release }
  })

/** Runs an effect once to hand its value to a test's hold. */
const now = <A>(effect: Effect.Effect<A>) => Effect.runSync(effect)

// ——— The plan ———

describe('the plan of a delivery', () => {
  test(
    'participation: changed repositories and the bump-only dependants of a publishing one take part, skipped ones are absent from delivery.get',
    async () => {
      const world = new World()
      const view = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          // `shared` publishes, so `api` takes part to bump it; `web` depends on `api`, which
          // publishes too: in, transitively.
          const missionId = yield* shipped(company, chain(company), ['shared'])
          return yield* deliveryUntil(missionId, delivered)
        }),
      )
      expect(view?.repositories.map((one) => [one.repository, one.wave, one.bumpOnly])).toEqual([
        ['shared', 0, false],
        ['api', 1, true],
        ['web', 2, true],
      ])
    },
    SLOW,
  )

  test(
    'participation: an unchanged repository nobody bumps is skipped and never shown',
    async () => {
      const world = new World()
      const view = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api'])
          return yield* deliveryUntil(missionId, delivered)
        }),
      )
      expect(view?.repositories.map((one) => one.repository)).toEqual(['api'])
      expect(world.ran.every((key) => key.startsWith('api/'))).toBe(true)
    },
    SLOW,
  )

  test(
    'the plan does not change when the Project’s rules change after Ship',
    async () => {
      const world = new World()
      const hold = now(holdOnce('shared', 'merge'))
      const view = await engine(world, { hold: hold.hold })(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, chain(company), ['shared'])
          yield* Deferred.await(hold.reached)
          // The Project's waves change: `web` no longer depends on anything, `api` is off.
          yield* saveDeliveryRules(company.projectId, oneWave(company), 1)
          yield* Deferred.succeed(hold.release, undefined)
          return yield* deliveryUntil(missionId, delivered)
        }),
      )
      expect(view?.wavesVersion).toBe(1)
      expect(view?.waves.length).toBe(3)
      expect(view?.repositories.map((one) => one.repository)).toEqual(['shared', 'api', 'web'])
    },
    SLOW,
  )
})

// ——— The waves ———

describe('the waves', () => {
  test(
    'waves follow the dependency order; repositories of a wave run in parallel',
    async () => {
      const world = new World()
      const both = now(Deferred.make<void>())
      const hold: DeliveryHold = (moment, repository, step) =>
        moment === 'running' && step === 'merge' && repository !== 'shared'
          ? Effect.gen(function* () {
              world.running.add(repository)
              // `api` and `web` both reach their merge before either goes on: in parallel.
              if (world.running.size === 2) yield* Deferred.succeed(both, undefined)
              yield* Deferred.await(both)
            })
          : Effect.void
      const view = await engine(world, { hold })(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = rulesWith([
            repositoryWaves(company.id('shared'), 'library'),
            repositoryWaves(company.id('api'), 'application', [company.id('shared')]),
            repositoryWaves(company.id('web'), 'application', [company.id('shared')]),
          ])
          const missionId = yield* shipped(company, rules, ['shared', 'api', 'web'])
          return yield* deliveryUntil(missionId, delivered)
        }),
      )
      expect(view?.waves.length).toBe(2)
      const sharedLast = world.ran.indexOf('shared/published-version')
      expect(sharedLast).toBeGreaterThanOrEqual(0)
      // Nothing of the second wave ran before the first was delivered.
      for (const key of world.ran.filter((one) => !one.startsWith('shared/'))) {
        expect(world.ran.indexOf(key)).toBeGreaterThan(sharedLast)
      }
      expect([...world.running].toSorted()).toEqual(['api', 'web'])
    },
    SLOW,
  )

  test(
    'CT-51: the next wave waits for the upstream’s Version published step',
    async () => {
      const world = new World()
      // `shared` merged and green, its version not seen published yet.
      world.answers.set('shared/published-version', waiting('2.4.0 is not on the registry yet.'))
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, chain(company), ['shared', 'api'])
          const waits = yield* deliveryUntil(
            missionId,
            (view) => stateOf(view, 'shared', 'published-version') === 'waiting',
          )
          const before = [...world.ran]
          world.found.set('shared/published-version', done('2.4.0'))
          yield* Deliveries.use((one) => one.refresh)
          const after = yield* deliveryUntil(missionId, delivered)
          return { waits, before, after }
        }),
      )
      expect(statusOf(seen.waits, 'api')).toBe('not-started')
      expect(seen.before.some((key) => key.startsWith('api/'))).toBe(false)
      expect(
        seen.after?.repositories.find((one) => one.repository === 'shared')?.steps.at(-1)?.outcome,
      ).toBe('2.4.0')
    },
    SLOW,
  )

  test(
    'CT-51: without a Version published step, the next wave waits for the merge and its CI',
    async () => {
      const world = new World()
      world.answers.set('shared/ci', waiting('2 of 5 checks.'))
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = rulesWith([
            repositoryWaves(company.id('shared'), 'application'),
            repositoryWaves(company.id('api'), 'application', [company.id('shared')]),
          ])
          const missionId = yield* shipped(company, rules, ['shared', 'api'])
          const waits = yield* deliveryUntil(
            missionId,
            (view) => stateOf(view, 'shared', 'ci') === 'waiting',
          )
          const before = [...world.ran]
          world.found.set('shared/ci', done('5 of 5 checks'))
          yield* Deliveries.use((one) => one.refresh)
          const after = yield* deliveryUntil(missionId, delivered)
          return { waits, before, after }
        }),
      )
      expect(seen.waits?.waves.length).toBe(2)
      expect(seen.before.some((key) => key.startsWith('api/'))).toBe(false)
      expect(delivered(seen.after)).toBe(true)
    },
    SLOW,
  )

  test(
    'an error in one repository lets the others of its wave finish and blocks the next wave',
    async () => {
      const world = new World()
      world.answers.set(
        'api/merge',
        failed('GraphQL: Pull request is not mergeable (mergePullRequest)'),
      )
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = rulesWith([
            repositoryWaves(company.id('shared'), 'application'),
            repositoryWaves(company.id('api'), 'application'),
            repositoryWaves(company.id('web'), 'application', [
              company.id('shared'),
              company.id('api'),
            ]),
          ])
          const missionId = yield* shipped(company, rules, ['shared', 'api', 'web'])
          const view = yield* deliveryUntil(
            missionId,
            (one) => statusOf(one, 'api') === 'failed' && statusOf(one, 'shared') === 'delivered',
          )
          const need = yield* needUntil(missionId, (one) => Predicate.isTagged(one.fields, 'Error'))
          return { view, need }
        }),
      )
      expect(statusOf(seen.view, 'shared')).toBe('delivered')
      expect(statusOf(seen.view, 'api')).toBe('failed')
      expect(statusOf(seen.view, 'web')).toBe('not-started')
      expect(seen.view?.status).toBe('partially-delivered')
      expect(world.ran.some((key) => key.startsWith('web/'))).toBe(false)
      const api = seen.view?.repositories.find((one) => one.repository === 'api')
      // The remote's message, verbatim.
      expect(api?.steps.find((one) => one.id === 'merge')?.message).toBe(
        'GraphQL: Pull request is not mergeable (mergePullRequest)',
      )
      expect(Predicate.isTagged(seen.need?.fields, 'Error') && seen.need.fields.proposals).toEqual([
        RETRY,
        STOP_DELIVERY,
      ])
    },
    SLOW,
  )

  test(
    'nothing is undone after a failure',
    async () => {
      const world = new World()
      world.answers.set('shared/ci', failed('3 of 5 checks failed.'))
      const view = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['shared', 'api'])
          return yield* deliveryUntil(
            missionId,
            (one) => statusOf(one, 'shared') === 'failed' && statusOf(one, 'api') === 'delivered',
          )
        }),
      )
      // The merge before the failed CI stays done, and nothing ran after the failure.
      expect(stateOf(view, 'shared', 'merge')).toBe('done')
      expect(Predicate.isTagged(world.found.get('shared/merge'), 'Done')).toBe(true)
      expect(world.ran.filter((key) => key.startsWith('shared/'))).toEqual([
        'shared/merge',
        'shared/ci',
      ])
      expect(statusOf(view, 'api')).toBe('delivered')
    },
    SLOW,
  )
})

// ——— Every step ———

describe('every step', () => {
  test(
    'a step whose result is already true is recorded done with what was found, without running',
    async () => {
      const world = new World()
      world.found.set('api/merge', done('#41'))
      const view = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api'])
          return yield* deliveryUntil(missionId, delivered)
        }),
      )
      expect(world.ran).toEqual(['api/ci'])
      expect(view?.repositories[0]?.steps[0]?.outcome).toBe('#41')
    },
    SLOW,
  )

  test(
    'a click step opens a decision need Go / Stop delivery, and runs once answered',
    async () => {
      const world = new World()
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = oneWave(company, {
            api: clicked({ id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' }),
          })
          const missionId = yield* shipped(company, rules, ['api'])
          const need = yield* needUntil(missionId, isDecision(GO))
          const asked = yield* deliveryOf(missionId)
          const ranBefore = [...world.ran]
          yield* answer(need, GO)
          const after = yield* deliveryUntil(missionId, delivered)
          return { need, asked, ranBefore, after }
        }),
      )
      expect(Predicate.isTagged(seen.need?.fields, 'Decision') && seen.need.fields.options).toEqual(
        [GO, STOP_DELIVERY],
      )
      expect(
        Predicate.isTagged(seen.need?.fields, 'Decision') && seen.need.fields.recommended?.option,
      ).toBe(GO)
      expect(stateOf(seen.asked, 'api', 'merge')).toBe('needs-click')
      expect(seen.ranBefore).toEqual([])
      expect(world.ran).toEqual(['api/merge', 'api/ci'])
    },
    SLOW,
  )

  test(
    'a Confirm step always waits for the click, whatever its mode says, and is done once clicked',
    async () => {
      const world = new World()
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = oneWave(company, {
            api: first({
              id: 'announce',
              kind: 'confirm',
              mode: 'auto',
              what: 'Announce the release',
            }),
          })
          const missionId = yield* shipped(company, rules, ['api'])
          const need = yield* needUntil(missionId, isDecision('Done'))
          yield* answer(need, 'Done')
          const after = yield* deliveryUntil(missionId, delivered)
          return { need, after }
        }),
      )
      expect(Predicate.isTagged(seen.need?.fields, 'Decision') && seen.need.fields.question).toBe(
        'Announce the release',
      )
      expect(seen.after?.repositories[0]?.steps[0]?.mode).toBe('click')
      expect(seen.after?.repositories[0]?.steps[0]?.outcome).toBe('confirmed')
    },
    SLOW,
  )

  test(
    'an unknown read keeps the step waiting, never done',
    async () => {
      const world = new World()
      world.answers.set('api/ci', waiting('The checks are running.'))
      const seen = await engine(world, {
        types: [
          [
            'ci',
            fakeType(world, {
              // The CLI answered something no parser reads: it cannot say.
              watch: () => Effect.succeed(waiting('gh answered something unreadable: <html>')),
            }),
          ],
        ],
      })(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api'])
          yield* deliveryUntil(missionId, (view) => stateOf(view, 'api', 'ci') === 'waiting')
          yield* Deliveries.use((one) => one.refresh)
          return yield* deliveryUntil(
            missionId,
            (view) =>
              view?.repositories[0]?.steps[1]?.reason ===
              'gh answered something unreadable: <html>',
          )
        }),
      )
      expect(stateOf(seen, 'api', 'ci')).toBe('waiting')
      expect(statusOf(seen, 'api')).toBe('waiting')
    },
    SLOW,
  )

  test(
    'a read that does not answer within the read limit keeps the step waiting',
    async () => {
      const world = new World()
      const seen = await commandsEngine(data, {
        deliveries: {
          types: typesOf(world, [['merge', fakeType(world, { check: () => Effect.never })]]),
          pollEvery: '1 hour',
          readLimit: '10 millis',
        },
      })(({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const company = yield* acme
            const missionId = yield* shipped(company, oneWave(company), ['api'])
            return yield* deliveryUntil(
              missionId,
              (view) => stateOf(view, 'api', 'merge') === 'waiting',
            )
          }),
        ),
      )
      expect(seen?.repositories[0]?.steps[0]?.reason).toContain('did not answer within')
      expect(world.ran).toEqual([])
    },
    SLOW,
  )

  test(
    'a PR closed without merge fails its step',
    async () => {
      const world = new World()
      world.answers.set('api/merge', waiting('Waiting for the review of #41.'))
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api'])
          yield* deliveryUntil(missionId, (view) => stateOf(view, 'api', 'merge') === 'waiting')
          world.found.set('api/merge', failed('#41 was closed without being merged.'))
          yield* Deliveries.use((one) => one.refresh)
          return yield* deliveryUntil(missionId, (view) => statusOf(view, 'api') === 'failed')
        }),
      )
      expect(seen?.repositories[0]?.steps[0]?.message).toBe('#41 was closed without being merged.')
      expect(world.ran).toEqual(['api/merge'])
    },
    SLOW,
  )

  test(
    'one Journal line per finished step, none per poll',
    async () => {
      const world = new World()
      world.answers.set('api/ci', waiting('2 of 5 checks.'))
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api'])
          yield* deliveryUntil(missionId, (view) => stateOf(view, 'api', 'ci') === 'waiting')
          for (const _ of [1, 2, 3]) {
            const polls = world.watched.length
            yield* Deliveries.use((one) => one.refresh)
            yield* until(
              Effect.sync(() => world.watched.length),
              (count) => count > polls,
            )
          }
          const whileWaiting = yield* journalOf(missionId, 'delivery.run.step_ended')
          world.found.set('api/ci', done('5 of 5 checks'))
          yield* Deliveries.use((one) => one.refresh)
          yield* deliveryUntil(missionId, delivered)
          const lines = yield* journalOf(missionId, 'delivery.run.step_ended')
          const written = yield* memoryLines(missionId)
          return { whileWaiting, lines, written }
        }),
      )
      expect(world.watched.length).toBeGreaterThanOrEqual(4)
      expect(seen.whileWaiting.map((event) => event.payload['step'])).toEqual(['merge'])
      expect(
        seen.lines.map((event) => [
          event.payload['repository'],
          event.payload['step'],
          event.payload['outcome'],
        ]),
      ).toEqual([
        ['api', 'merge', 'merge of api'],
        ['api', 'ci', '5 of 5 checks'],
      ])
      // The Journal says each once, the latest first, and the polls nowhere.
      expect(seen.written).toEqual([
        'The delivery is done: every repository is delivered.',
        'The ci step of api is done: 5 of 5 checks.',
        'The merge step of api is done: merge of api.',
        'The delivery started, from version 1 of the waves: api, in 1 wave.',
      ])
    },
    SLOW,
  )

  test(
    'a failure message containing a known variable value and a ghp_ token is stored and shown masked',
    async () => {
      const world = new World()
      const SECRET = 'swordfish-9-horses'
      world.answers.set('api/merge', failed(`remote: denied for ${SECRET} with ${TOKEN}`))
      const secrets = secretsRegistry()
      secrets.register('suite', [SECRET], [SECRET])
      const seen = await commandsEngine(data, {
        secrets,
        deliveries: { types: typesOf(world), pollEvery: '1 hour' },
      })(({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const company = yield* acme
            const missionId = yield* shipped(company, oneWave(company), ['api'])
            const view = yield* deliveryUntil(missionId, (one) => statusOf(one, 'api') === 'failed')
            const need = yield* needUntil(missionId, (one) =>
              Predicate.isTagged(one.fields, 'Error'),
            )
            const lines = yield* journalOf(missionId, 'delivery.run.step_ended')
            return { view, need, lines }
          }),
        ),
      )
      const shown = [
        seen.view?.repositories[0]?.steps[0]?.message ?? '',
        JSON.stringify(seen.need?.fields),
        JSON.stringify(seen.lines),
      ]
      for (const text of shown) {
        expect(text).toContain('remote: denied for')
        expect(text).not.toContain(SECRET)
        expect(text).not.toContain(TOKEN)
      }
    },
    SLOW,
  )

  test(
    'a forge step waits while the forge CLI is missing, saying which; a non-forge step goes on',
    async () => {
      const world = new World()
      const seen = await engine(world, {
        types: [['merge', fakeType(world, { forge: true })]],
      })(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = oneWave(company, {
            web: first({ id: 'announce', kind: 'ci', mode: 'auto' }),
          })
          const missionId = yield* shipped(company, rules, ['api'])
          return yield* deliveryUntil(
            missionId,
            (view) => stateOf(view, 'api', 'merge') === 'waiting',
          )
        }),
      )
      const merge = seen?.repositories[0]?.steps[0]
      expect(merge?.waitingFor).toBe('gh')
      expect(merge?.reason).toContain('gh is missing')
      expect(world.ran).toEqual([])
    },
    SLOW,
  )

  test(
    'a repository waits for its push to end before its first step',
    async () => {
      const world = new World()
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api'], ['api'])
          const waits = yield* deliveryUntil(
            missionId,
            (view) => stateOf(view, 'api', 'merge') === 'waiting',
          )
          const ranBefore = [...world.ran]
          const database = yield* Database
          yield* database
            .update(deliveryPushes)
            .set({ state: 'done', commit: 'a'.repeat(40) })
            .where(eq(deliveryPushes.missionId, missionId))
            .pipe(Effect.orDie)
          yield* Deliveries.use((one) => one.refresh)
          const after = yield* deliveryUntil(missionId, delivered)
          return { waits, ranBefore, after }
        }),
      )
      expect(seen.waits?.repositories[0]?.steps[0]?.reason).toBe(
        'The push of api has not ended yet.',
      )
      expect(seen.ranBefore).toEqual([])
      expect(delivered(seen.after)).toBe(true)
    },
    SLOW,
  )
})

// ——— Retry ———

describe('Retry', () => {
  test(
    'Retry skips every step whose result check finds already true, and runs nothing twice',
    async () => {
      const world = new World()
      // The merge went through on the forge, but its answer was lost: the step failed.
      world.answers.set('api/merge', failed('error connecting to api.github.com'))
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api', 'web'])
          yield* deliveryUntil(
            missionId,
            (view) => statusOf(view, 'api') === 'failed' && statusOf(view, 'web') === 'delivered',
          )
          world.found.set('api/merge', done('#41'))
          const refused = yield* Deliveries.use((one) => one.retry(missionId, 'web')).pipe(
            Effect.flip,
          )
          yield* Deliveries.use((one) => one.retry(missionId, 'api'))
          const after = yield* deliveryUntil(missionId, delivered)
          return { after, refused }
        }),
      )
      expect(seen.refused.message).toContain('nothing failed or stopped')
      expect(world.ran.toSorted()).toEqual(['api/ci', 'api/merge', 'web/ci', 'web/merge'])
      expect(seen.after?.repositories[0]?.steps[0]?.outcome).toBe('#41')
    },
    SLOW,
  )

  test(
    'Retry from the error need runs the repository again',
    async () => {
      const world = new World()
      world.answers.set('api/ci', failed('1 of 5 checks failed.'))
      const view = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api'])
          const need = yield* needUntil(missionId, (one) => Predicate.isTagged(one.fields, 'Error'))
          world.answers.delete('api/ci')
          yield* answer(need, RETRY)
          return yield* deliveryUntil(missionId, delivered)
        }),
      )
      expect(world.ran).toEqual(['api/merge', 'api/ci', 'api/ci'])
      expect(delivered(view)).toBe(true)
    },
    SLOW,
  )

  test(
    'Retry of a repository of a blocked next wave is refused: the failed one is retried',
    async () => {
      const world = new World()
      world.answers.set('shared/ci', failed('1 of 5 checks failed.'))
      const refused = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = rulesWith([
            repositoryWaves(company.id('shared'), 'application'),
            repositoryWaves(company.id('api'), 'application', [company.id('shared')]),
          ])
          const missionId = yield* shipped(company, rules, ['shared', 'api'])
          yield* deliveryUntil(missionId, (view) => statusOf(view, 'shared') === 'failed')
          yield* Deliveries.use((one) => one.stop(missionId))
          return yield* Deliveries.use((one) => one.retry(missionId, 'api')).pipe(Effect.flip)
        }),
      )
      expect(refused.message).toBe('api waits for shared: retry that one first.')
    },
    SLOW,
  )
})

// ——— Stop delivery ———

describe('Stop delivery', () => {
  test(
    'Stop delivery stops pending, running and waiting steps, keeps done ones, sends nothing to the remote, and records published repositories as delivered',
    async () => {
      const world = new World()
      const hold = now(holdOnce('api', 'merge'))
      world.answers.set('web/ci', waiting('2 of 5 checks.'))
      const seen = await engine(world, { hold: hold.hold })(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = rulesWith([
            repositoryWaves(company.id('shared'), 'library'),
            repositoryWaves(company.id('api'), 'application', [company.id('shared')]),
            repositoryWaves(company.id('web'), 'application', [company.id('shared')]),
          ])
          const missionId = yield* shipped(company, rules, ['shared', 'api', 'web'])
          yield* Deferred.await(hold.reached)
          yield* deliveryUntil(missionId, (view) => stateOf(view, 'web', 'ci') === 'waiting')
          const ranBefore = [...world.ran]
          const watchedBefore = world.watched.length
          const stopped = yield* Deliveries.use((one) => one.stop(missionId))
          yield* Deliveries.use((one) => one.refresh)
          const needs = yield* needsOf(missionId)
          const lines = yield* journalOf(missionId, 'delivery.run.step_ended')
          return { stopped, ranBefore, watchedBefore, needs, lines }
        }),
      )
      const view = seen.stopped
      expect(view?.status).toBe('partially-delivered')
      expect(statusOf(view, 'shared')).toBe('delivered')
      expect(stateOf(view, 'api', 'merge')).toBe('stopped')
      expect(stateOf(view, 'api', 'ci')).toBe('stopped')
      expect(stateOf(view, 'web', 'merge')).toBe('done')
      expect(stateOf(view, 'web', 'ci')).toBe('stopped')
      // Nothing more ran, nothing more was read, after the stop.
      expect(world.ran).toEqual(seen.ranBefore)
      expect(world.watched.length).toBe(seen.watchedBefore)
      expect(seen.needs).toEqual([])
      const stoppedLines = seen.lines.filter((event) => event.payload['state'] === 'stopped')
      expect(
        stoppedLines
          .map((event) => `${String(event.payload['repository'])}/${String(event.payload['step'])}`)
          .toSorted(),
      ).toEqual(['api/merge', 'web/ci'])
    },
    SLOW,
  )

  test(
    'a click need expires on Stop delivery, and Stop delivery from a need stops the delivery',
    async () => {
      const world = new World()
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = oneWave(company, {
            api: clicked({ id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' }),
            web: clicked({ id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' }),
          })
          const missionId = yield* shipped(company, rules, ['api', 'web'])
          const needs = yield* until(needsOf(missionId), (all) => all.length === 2)
          yield* answer(needs[0], STOP_DELIVERY)
          const view = yield* deliveryUntil(missionId, (one) => one?.status === 'stopped')
          const left = yield* until(needsOf(missionId), (all) => all.length === 0)
          return { view, left }
        }),
      )
      expect(seen.left).toEqual([])
      expect(seen.view?.stoppedAt).not.toBeNull()
      expect(world.ran).toEqual([])
    },
    SLOW,
  )

  test(
    'a Cancel during Shipping stops the delivery like Stop delivery',
    async () => {
      const world = new World()
      world.answers.set('api/ci', waiting('2 of 5 checks.'))
      const view = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api'])
          yield* deliveryUntil(missionId, (one) => stateOf(one, 'api', 'ci') === 'waiting')
          yield* moveMission(missionId, 'cancel', 'user').pipe(Effect.orDie)
          return yield* deliveryUntil(
            missionId,
            (one) => one?.status === 'partially-delivered' || one?.status === 'stopped',
          )
        }),
      )
      expect(stateOf(view, 'api', 'merge')).toBe('done')
      expect(stateOf(view, 'api', 'ci')).toBe('stopped')
    },
    SLOW,
  )
})

// ——— Restart ———

describe('a restart', () => {
  test(
    'restart: a step with an intent and no outcome and a post-condition is checked and recorded',
    async () => {
      const world = new World()
      const hold = now(holdOnce('api', 'merge', 'ran'))
      let missionId = ''
      await engine(world, { hold: hold.hold })(
        Effect.gen(function* () {
          const company = yield* acme
          missionId = yield* shipped(company, oneWave(company), ['api'])
          // The merge went through on the forge; the engine stops before it records it.
          yield* Deferred.await(hold.reached)
        }),
      )
      const ranBefore = [...world.ran]
      const view = await engine(world)(deliveryUntil(missionId, delivered))
      expect(ranBefore).toEqual(['api/merge'])
      // Checked, found merged, recorded: never merged twice.
      expect(world.ran).toEqual(['api/merge', 'api/ci'])
      expect(view?.repositories[0]?.steps[0]?.outcome).toBe('merge of api')
      const actions = await engine(world)(
        Effect.gen(function* () {
          const database = yield* Database
          return yield* database.select().from(effectfulActions).pipe(Effect.orDie)
        }),
      )
      expect(actions.every((one) => one.state !== 'started')).toBe(true)
    },
    SLOW,
  )

  test(
    'restart: a post-condition found not done runs the step again',
    async () => {
      const world = new World()
      const hold = now(holdOnce('api', 'merge'))
      let missionId = ''
      await engine(world, { hold: hold.hold })(
        Effect.gen(function* () {
          const company = yield* acme
          missionId = yield* shipped(company, oneWave(company), ['api'])
          // Its intent is written; the engine stops before the merge is asked.
          yield* Deferred.await(hold.reached)
        }),
      )
      const view = await engine(world)(deliveryUntil(missionId, delivered))
      expect(world.ran).toEqual(['api/merge', 'api/ci'])
      expect(delivered(view)).toBe(true)
    },
    SLOW,
  )

  test(
    'restart: a Command or Agent step without one becomes a decision need Run again / It is already done',
    async () => {
      const world = new World()
      const types: ReadonlyArray<readonly [string, StepType]> = [
        [
          'merge',
          fakeType(world, {
            postCondition: false,
            lastOutput: () => Effect.succeed('deploying… 40%'),
          }),
        ],
      ]
      const hold = now(holdOnce('api', 'merge'))
      let missionId = ''
      await engine(world, { types, hold: hold.hold })(
        Effect.gen(function* () {
          const company = yield* acme
          missionId = yield* shipped(company, oneWave(company), ['api', 'web'])
          yield* Deferred.await(hold.reached)
          yield* deliveryUntil(missionId, (view) => statusOf(view, 'web') === 'delivered')
        }),
      )
      const seen = await engine(world, { types })(
        Effect.gen(function* () {
          const need = yield* needUntil(missionId, isDecision(RUN_AGAIN))
          const asked = yield* deliveryOf(missionId)
          const ranBefore = [...world.ran]
          yield* answer(need, ALREADY_DONE)
          const after = yield* deliveryUntil(missionId, delivered)
          return { need, asked, ranBefore, after }
        }),
      )
      expect(stateOf(seen.asked, 'api', 'merge')).toBe('indeterminate')
      expect(statusOf(seen.asked, 'api')).toBe('needs-you')
      expect(Predicate.isTagged(seen.need?.fields, 'Decision') && seen.need.fields.options).toEqual(
        [RUN_AGAIN, ALREADY_DONE],
      )
      expect(
        Predicate.isTagged(seen.need?.fields, 'Decision') && seen.need.fields.question,
      ).toContain('deploying… 40%')
      // Never run on its own: the user said it was done.
      expect(seen.ranBefore.filter((key) => key === 'api/merge')).toEqual([])
      expect(world.ran.filter((key) => key === 'api/merge')).toEqual([])
      expect(delivered(seen.after)).toBe(true)
    },
    SLOW,
  )

  test(
    'restart: Run again on an indeterminate step runs it, once',
    async () => {
      const world = new World()
      const types: ReadonlyArray<readonly [string, StepType]> = [
        ['merge', fakeType(world, { postCondition: false })],
      ]
      const hold = now(holdOnce('api', 'merge'))
      let missionId = ''
      await engine(world, { types, hold: hold.hold })(
        Effect.gen(function* () {
          const company = yield* acme
          missionId = yield* shipped(company, oneWave(company), ['api'])
          yield* Deferred.await(hold.reached)
        }),
      )
      await engine(world, { types })(
        Effect.gen(function* () {
          const need = yield* needUntil(missionId, isDecision(RUN_AGAIN))
          yield* answer(need, RUN_AGAIN)
          yield* deliveryUntil(missionId, delivered)
        }),
      )
      expect(world.ran).toEqual(['api/merge', 'api/ci'])
    },
    SLOW,
  )

  test(
    'restart: waits are re-read at start, and delivery.refresh() re-reads them',
    async () => {
      const world = new World()
      world.answers.set('api/ci', waiting('2 of 5 checks.'))
      let missionId = ''
      await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          missionId = yield* shipped(company, oneWave(company), ['api'])
          yield* deliveryUntil(missionId, (view) => stateOf(view, 'api', 'ci') === 'waiting')
        }),
      )
      const watchedBefore = world.watched.length
      world.found.set('api/ci', done('5 of 5 checks'))
      const view = await engine(world)(deliveryUntil(missionId, delivered))
      expect(world.watched.length).toBe(watchedBefore + 1)
      expect(world.ran).toEqual(['api/merge', 'api/ci'])
      expect(view?.repositories[0]?.steps[1]?.outcome).toBe('5 of 5 checks')
    },
    SLOW,
  )

  test(
    'restart: a Ship committed before the engine stopped is planned at the next start',
    async () => {
      const world = new World()
      let missionId = ''
      await commandsEngine(data, {
        deliveries: { types: typesOf(world), pollEvery: '1 hour' },
      })(({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const company = yield* acme
            missionId = yield* shipped(company, oneWave(company), ['api'])
            yield* deliveryUntil(missionId, delivered)
            // As if the engine had stopped between Ship's transaction and its plan.
            const database = yield* Database
            for (const table of ['delivery_steps', 'delivery_repositories', 'delivery_runs']) {
              yield* database.run(`DELETE FROM ${table}`).pipe(Effect.orDie)
            }
          }),
        ),
      )
      const view = await engine(world)(deliveryUntil(missionId, delivered))
      expect(view?.repositories.map((one) => one.repository)).toEqual(['api'])
      // Checked and found done: nothing ran twice.
      expect(world.ran).toEqual(['api/merge', 'api/ci'])
    },
    SLOW,
  )
})

// ——— Before a merge ———

describe('the pre-merge guard', () => {
  test(
    'a pull request whose head is not the last commit Hemera pushed is not merged',
    async () => {
      const world = new World()
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const missionId = yield* shipped(company, oneWave(company), ['api'])
          const database = yield* Database
          const pushed = 'a'.repeat(40)
          yield* database
            .insert(deliveryPushes)
            .values({
              missionId,
              repositoryId: company.id('api'),
              repository: 'api',
              round: 1,
              state: 'done',
              commit: pushed,
              updatedAt: new Date().toISOString(),
            })
            .pipe(Effect.orDie)
          const guards = yield* Deliveries.use((one) =>
            Effect.all([
              one.beforeMerge(missionId, company.id('api'), pushed),
              one.beforeMerge(missionId, company.id('api'), 'b'.repeat(40)),
            ]),
          )
          return guards
        }),
      )
      expect(seen[0]).toBeNull()
      expect(seen[1]?.unexpected).toBe('b'.repeat(40))
      expect(seen[1]?.sentence).toContain('someone pushed to its branch')
    },
    SLOW,
  )
})

// ——— Command ———

const commandDraft = (
  name: string,
  line: string,
  more: Partial<CommandDraft> = {},
): CommandDraft => ({
  name,
  type: 'script',
  line,
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
  ...more,
})

/** A script that writes a line into the file it is given each time it runs, then ends with `code`. */
const writesOnce = (code: number, printed = '') =>
  script(`
import { appendFileSync } from 'node:fs'
appendFileSync(process.argv[2], 'ran\\n')
${printed === '' ? '' : `process.stderr.write(${JSON.stringify(printed)})`}
process.exit(${String(code)})
`)

const ranIn = (file: string) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : []

/** A Command step of `api`, its command saved first; the rules hold it after the CI. */
const withCommand = (company: Acme, line: string, more: Partial<CommandDraft> = {}) =>
  Effect.gen(function* () {
    const saved = yield* saveCommand({
      projectId: company.projectId,
      id: null,
      command: commandDraft('release', line, more),
    })
    return oneWave(company, {
      api: {
        ...NO_CHANGE,
        added: [
          {
            after: 'ci',
            step: { id: 'release', kind: 'command', mode: 'auto', commandId: saved.id },
          },
        ],
      },
    })
  })

describe('a Command step', () => {
  test(
    'a Command step is done when its command exits 0',
    async () => {
      const world = new World()
      const log = join(work, 'release.log')
      const view = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = yield* withCommand(company, nodeLine(writesOnce(0), log))
          const missionId = yield* shipped(company, rules, ['api'])
          return yield* deliveryUntil(missionId, delivered)
        }),
      )
      expect(ranIn(log)).toEqual(['ran'])
      expect(view?.repositories[0]?.steps[2]?.outcome).toBe('exit 0')
    },
    SLOW,
  )

  test(
    'a Command step that exits otherwise fails with the end of its output, masked',
    async () => {
      const world = new World()
      const log = join(work, 'release.log')
      const view = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = yield* withCommand(
            company,
            nodeLine(writesOnce(3, `npm ERR! 403 Forbidden for token ${TOKEN}\n`), log),
          )
          const missionId = yield* shipped(company, rules, ['api'])
          return yield* deliveryUntil(missionId, (one) => statusOf(one, 'api') === 'failed')
        }),
      )
      const message = view?.repositories[0]?.steps[2]?.message ?? ''
      expect(message).toContain('exit 3')
      expect(message).toContain('npm ERR! 403 Forbidden for token')
      expect(message).not.toContain(TOKEN)
    },
    SLOW,
  )

  test(
    'a Command step marked "ask before running" opens a permission need first',
    async () => {
      const world = new World()
      const log = join(work, 'release.log')
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = yield* withCommand(company, nodeLine(writesOnce(0), log), {
            askBeforeRunning: true,
          })
          const missionId = yield* shipped(company, rules, ['api'])
          const need = yield* needUntil(missionId, (one) =>
            Predicate.isTagged(one.fields, 'Permission'),
          )
          const ranBefore = ranIn(log)
          if (need === undefined) return yield* Effect.die(new Error('no permission need'))
          yield* answerNeed({
            id: need.id,
            key: `answer-${need.id}`,
            answer: PermissionAnswer.make({ choice: 'allow-once' }),
          })
          const view = yield* deliveryUntil(missionId, delivered)
          return { need, ranBefore, view }
        }),
      )
      expect(seen.need.choices.map((one) => one)).toContain('allow-for-mission')
      expect(seen.ranBefore).toEqual([])
      expect(ranIn(log)).toEqual(['ran'])
    },
    SLOW,
  )

  test(
    'a Command step denied fails with "denied", and nothing runs',
    async () => {
      const world = new World()
      const log = join(work, 'release.log')
      const view = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const rules = yield* withCommand(company, nodeLine(writesOnce(0), log), {
            askBeforeRunning: true,
          })
          const missionId = yield* shipped(company, rules, ['api'])
          const need = yield* needUntil(missionId, (one) =>
            Predicate.isTagged(one.fields, 'Permission'),
          )
          if (need === undefined) return yield* Effect.die(new Error('no permission need'))
          yield* answerNeed({
            id: need.id,
            key: `answer-${need.id}`,
            answer: PermissionAnswer.make({ choice: 'deny' }),
          })
          return yield* deliveryUntil(missionId, (one) => statusOf(one, 'api') === 'failed')
        }),
      )
      expect(view?.repositories[0]?.steps[2]?.message).toBe('denied')
      expect(ranIn(log)).toEqual([])
    },
    SLOW,
  )

  test(
    'Stop delivery interrupts a running Command step: its process is stopped and the step recorded stopped',
    async () => {
      const world = new World()
      const pids = join(work, 'pids.log')
      const seen = await engine(world)(
        Effect.gen(function* () {
          const company = yield* acme
          const stays = script(`
import { appendFileSync } from 'node:fs'
appendFileSync(process.argv[2], String(process.pid) + '\\n')
${STAYS_UP}`)
          const rules = yield* withCommand(company, nodeLine(stays, pids))
          const missionId = yield* shipped(company, rules, ['api'])
          yield* until(
            Effect.sync(() => ranIn(pids)),
            (lines) => lines.length === 1,
          )
          const view = yield* Deliveries.use((one) => one.stop(missionId))
          const database = yield* Database
          const runs = yield* database.select().from(commandRuns).pipe(Effect.orDie)
          return { view, runs }
        }),
      )
      expect(stateOf(seen.view, 'api', 'release')).toBe('stopped')
      expect(seen.runs.map((one) => one.state)).toEqual(['stopped'])
    },
    SLOW,
  )
})
