/**
 * What notifies, in the engine: the registry of event kinds, the notices told as events commit,
 * and the switches behind them.
 *
 * Each test runs the engine as it starts, over a data folder of its own; the notices are read
 * from a subscription taken before anything is written, so what a test hears is exactly what its
 * own writes told.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import {
  ApplicationOwner,
  DecisionFields,
  EnvironmentFields,
  ErrorFields,
  MissionOwner,
  PermissionFields,
  ProjectOwner,
  WrittenAnswer,
} from '@hemera/core/domain'
import { HomeTarget, NeedEnded, type NoticeFeed, UnknownNotificationKind } from '@hemera/ipc'
import { Effect, Fiber, Option, Predicate, Result, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { DomainEvents } from '../src/engine/domain-events.ts'
import { createMission } from '../src/engine/missions.ts'
import {
  answerNeed,
  createNeed,
  expireNeed,
  needService,
  withdrawNeed,
} from '../src/engine/needs.ts'
import {
  KINDS,
  REGISTRY,
  defineKind,
  noticesOf,
  readNotificationSettings,
  registryOf,
  setNotificationKind,
  setNotificationSound,
  setSoundStyle,
} from '../src/engine/notifications.ts'
import { createProject } from '../src/engine/projects.ts'
import { addGithub } from '../src/engine/tickets/store.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { probes as probesTable, workspaces } from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { workspaceEvent } from '../src/engine/workspaces.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('notifications'))
  work = realpathSync.native(temporaryFolder('notifications-work'))
})
afterEach(removeFolders)

const BILLING = needService('billing')

const decision = DecisionFields.make({
  question: 'Which table holds the invoices?',
  options: ['invoices', 'billing_invoices'],
  recommended: null,
})

const acme = (name = 'Acme') => {
  const folder = join(work, name.toLowerCase())
  mkdirSync(folder, { recursive: true })
  return createProject({ name, mainCheckout: folder, repositories: [] })
}

/**
 * Runs `writes` on the engine with the notices followed from before the first of them, and
 * answers the first `count` things told.
 */
const told = <E>(count: number, writes: Effect.Effect<unknown, E, EngineServices>) =>
  commandsEngine(data)(({ profile }) =>
    profile.use(
      Effect.scoped(
        Effect.gen(function* () {
          const committed = yield* DomainEvents.use((events) => events.subscribe)
          const following = yield* Effect.forkChild(
            Stream.runCollect(Stream.take(noticesOf(REGISTRY, committed), count)),
          )
          yield* writes
          return yield* Fiber.join(following)
        }),
      ),
    ),
  )

const raised = (feed: NoticeFeed) => {
  if (!Predicate.isTagged(feed, 'NoticeRaised')) throw new Error('expected a notice')
  return feed.notice
}

describe('A need created is told as a notice of its kind', () => {
  test('a decision on a mission says its key, its title and what waits, and leads to the need', async () => {
    let needId = ''
    const [feed] = await told(
      1,
      Effect.gen(function* () {
        const project = yield* acme()
        const mission = yield* createMission({
          projectId: project.id,
          idea: { sentence: 'Add roles', ticket: null },
        })
        const owner = MissionOwner.make({
          projectId: project.id,
          missionId: mission.id,
          taskId: null,
        })
        needId = (yield* createNeed(BILLING, owner, decision)).id
      }),
    )
    const notice = raised(feed!)
    expect(notice).toMatchObject({
      kind: 'need',
      sound: 'needs-you',
      tone: 'you',
      project: { name: 'Acme' },
      missionKey: 'ACME-1',
      subject: 'Add roles',
      what: 'a decision waits for you',
      needId,
      target: { missionKey: 'ACME-1', needId },
    })
  })

  test('a permission and something missing say what they are', async () => {
    const feed = await told(
      2,
      Effect.gen(function* () {
        const project = yield* acme()
        const owner = ProjectOwner.make({ projectId: project.id })
        yield* createNeed(
          BILLING,
          owner,
          PermissionFields.make({
            call: 'rm -rf build',
            agentReason: 'clean',
            hemeraReason: 'risk 2.9',
            sensitive: false,
          }),
        )
        yield* createNeed(
          BILLING,
          owner,
          EnvironmentFields.make({
            missing: 'Docker is not running',
            action: 'Start Docker',
            settingsSection: null,
          }),
        )
      }),
    )
    expect(feed.map((one) => raised(one).what)).toEqual([
      'a permission waits for you',
      'Docker is not running',
    ])
  })

  test('an error need is told as a failure, with the error sound', async () => {
    const [feed] = await told(
      1,
      Effect.gen(function* () {
        const project = yield* acme()
        yield* createNeed(
          BILLING,
          ProjectOwner.make({ projectId: project.id }),
          ErrorFields.make({
            failed: 'The shared package does not build',
            attempts: [],
            proposals: ['Retry'],
          }),
        )
      }),
    )
    expect(raised(feed!)).toMatchObject({
      kind: 'failure',
      sound: 'error',
      tone: 'failed',
      what: 'The shared package does not build',
    })
  })

  test('a Project’s need leads to Home filtered to the Project', async () => {
    let projectId = ''
    const [feed] = await told(
      1,
      Effect.gen(function* () {
        projectId = (yield* acme()).id
        yield* createNeed(BILLING, ProjectOwner.make({ projectId }), decision)
      }),
    )
    expect(raised(feed!)).toMatchObject({
      subject: 'Acme',
      missionKey: null,
      target: HomeTarget.make({ projectId }),
    })
  })

  test('an application need groups apart: Hemera needs you, and it leads to Home', async () => {
    const [feed] = await told(
      1,
      createNeed(
        BILLING,
        ApplicationOwner.make({}),
        EnvironmentFields.make({
          missing: 'Git is missing',
          action: 'Install Git',
          settingsSection: null,
        }),
      ),
    )
    expect(raised(feed!)).toMatchObject({
      project: null,
      subject: 'Hemera needs you',
      what: 'Git is missing',
      target: HomeTarget.make({ projectId: null }),
    })
  })

  test('its words are masked: a known secret in a mission’s title is not told', async () => {
    const [feed] = await told(
      1,
      Effect.gen(function* () {
        ;(yield* Secrets).register('project-variables:test', ['hunter2-value'])
        const project = yield* acme()
        const mission = yield* createMission({
          projectId: project.id,
          idea: { sentence: 'Rotate hunter2-value', ticket: null },
        })
        yield* createNeed(
          BILLING,
          MissionOwner.make({ projectId: project.id, missionId: mission.id, taskId: null }),
          decision,
        )
      }),
    )
    expect(raised(feed!).subject).toBe('Rotate •••')
  })
})

describe('A need that ends is never notified, and takes its notification away', () => {
  /** A need of Acme's, then once its notice is told, `end`; answers everything told. */
  const ending = (end: (needId: string) => Effect.Effect<unknown, unknown, EngineServices>) =>
    commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.scoped(
          Effect.gen(function* () {
            const heard: NoticeFeed[] = []
            const committed = yield* DomainEvents.use((events) => events.subscribe)
            yield* Effect.forkChild(
              Stream.runForEach(noticesOf(REGISTRY, committed), (one) =>
                Effect.sync(() => heard.push(one)),
              ),
            )
            const project = yield* acme()
            const need = yield* createNeed(
              BILLING,
              ProjectOwner.make({ projectId: project.id }),
              decision,
            )
            yield* until(
              Effect.sync(() => heard.length),
              (count) => count === 1,
            )
            yield* Effect.orDie(end(need.id))
            yield* until(
              Effect.sync(() => heard.length),
              (count) => count === 2,
            )
            return { heard, needId: need.id }
          }),
        ),
      ),
    )

  test.each([
    [
      'answered',
      (id: string) =>
        answerNeed({ id, answer: WrittenAnswer.make({ text: 'invoices' }), key: 'k' }),
    ],
    ['expired', (id: string) => expireNeed(id, 'the base moved')],
    ['withdrawn', (id: string) => withdrawNeed(id, 'resolved')],
  ] as const)('a need %s is told as ended', async (_, end) => {
    const { heard, needId } = await ending(end)
    expect(raised(heard[0]!).needId).toBe(needId)
    expect(heard[1]).toEqual(NeedEnded.make({ needId }))
  })
})

describe('A Workspace preparation that ends is told by its own kind', () => {
  const ended = (state: string, probes = false) =>
    Effect.gen(function* () {
      const project = yield* acme()
      const database = yield* Database
      if (probes) {
        // A Probe's own Workspace (#89): its preparation is the Probe's to report.
        const secrets = yield* Secrets
        const mission = yield* createMission({
          projectId: project.id,
          idea: { sentence: 'Import names as written', ticket: null },
        })
        yield* database.insert(probesTable).values({
          id: 'probe-1',
          missionId: mission.id,
          number: 1,
          scenario: null,
          question: secrets.mask('does the importer keep accents?'),
          brief: secrets.mask('Look at api/importer.ts.'),
          state: 'preparing',
          stuck: false,
          folder: join(work, 'ws'),
          workspaceId: null,
          bases: null,
          lineage: 'lineage-1',
          parentLineage: 'lineage-0',
          reminded: false,
          outcome: null,
          answer: null,
          report: null,
          failure: null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          wipeAttempts: 0,
          wipeError: null,
        })
      }
      yield* database.insert(workspaces).values({
        id: 'ws-1',
        projectId: project.id,
        name: 'add-roles',
        folder: join(work, 'ws'),
        branch: null,
        createdAt: new Date().toISOString(),
      })
      yield* mutate('ending a preparation', () =>
        Effect.succeed({
          result: undefined,
          events: [
            workspaceEvent(
              'workspace.preparation_ended',
              { id: 'ws-1', projectId: project.id },
              { state },
              'hemera',
            ),
          ],
        }),
      )
      // Something after it, so a preparation that is told nothing still ends the test.
      yield* createNeed(BILLING, ProjectOwner.make({ projectId: project.id }), decision)
    })

  test('failed: on by default, with the error sound, leading to the Project', async () => {
    const [feed] = await told(1, ended('failed'))
    expect(raised(feed!)).toMatchObject({
      kind: 'workspace-failed',
      sound: 'error',
      subject: 'add-roles',
      what: 'its preparation failed',
      target: { projectId: expect.any(String) },
    })
  })

  test('ready: its own kind, with no sound', async () => {
    const [feed] = await told(1, ended('ready'))
    expect(raised(feed!)).toMatchObject({ kind: 'workspace-ready', sound: null })
  })

  test.each(['failed', 'ready'])('a Probe’s Workspace %s is told nothing', async (state) => {
    const [feed] = await told(1, ended(state, true))
    expect(raised(feed!).kind).toBe('need')
  })

  test('a preparation interrupted is told nothing', async () => {
    const [feed] = await told(1, ended('preparing'))
    expect(raised(feed!).kind).toBe('need')
  })
})

describe('A tracker that becomes unreachable is told once, and its return is not', () => {
  const outage = (type: string) =>
    Effect.gen(function* () {
      const project = yield* acme()
      const provider = yield* addGithub(project.id, { host: 'github.com', repositories: [] })
      yield* mutate('saying an outage', () =>
        Effect.succeed({
          result: undefined,
          events: [
            {
              type,
              entityKind: 'ticket_provider',
              entityId: provider.id,
              source: 'system' as const,
              author: 'hemera' as const,
              payload: {
                projectId: project.id,
                host: 'github.com',
                provider: 'GitHub',
                message: 'GitHub is unreachable: error connecting to api.github.com',
              },
            },
          ],
        }),
      )
      // Something after it, so an event that is told nothing still ends the test.
      yield* createNeed(BILLING, ProjectOwner.make({ projectId: project.id }), decision)
    })

  test('unreachable: on by default, with the error sound, leading to the Project', async () => {
    const [feed] = await told(1, outage('tickets.provider_unreachable'))
    expect(raised(feed!)).toMatchObject({
      kind: 'tracker-unreachable',
      sound: 'error',
      project: { name: 'Acme' },
      subject: 'GitHub',
      what: 'it cannot be read; its tickets keep the version last read',
      target: { projectId: expect.any(String) },
    })
  })

  test('back: told nothing', async () => {
    const [feed] = await told(1, outage('tickets.provider_back'))
    expect(raised(feed!).kind).toBe('need')
  })
})

describe('The registry of event kinds', () => {
  const kind = (id: string, routed = true) =>
    defineKind({
      id,
      label: id,
      byDefault: true,
      sound: null,
      importance: 0,
      tone: 'done',
      source: 'test.event',
      facts: () => Effect.succeed(Option.none()),
      words: () => ({ subject: '', what: '' }),
      route: routed ? () => HomeTarget.make({ projectId: null }) : undefined,
    })

  test('two kinds sharing an id are refused', () => {
    const refused = registryOf([kind('a'), kind('a')])
    expect(Result.isFailure(refused)).toBe(true)
    expect(Result.getFailure(refused).pipe(Option.getOrThrow).reason).toContain('share the id a')
  })

  test('a kind without a route is refused', () => {
    const refused = registryOf([kind('a'), kind('b', false)])
    expect(Result.getFailure(refused).pipe(Option.getOrThrow).reason).toContain('b has no route')
  })

  test('the kinds of this version, each once, each with a route', () => {
    expect(Result.isSuccess(registryOf(KINDS))).toBe(true)
    expect(KINDS.map((one) => [one.id, one.byDefault, one.sound])).toEqual([
      ['need', true, 'needs-you'],
      ['failure', true, 'error'],
      ['workspace-ready', false, null],
      ['workspace-failed', true, 'error'],
      ['triage-answer', true, 'needs-you'],
      ['questions-asked', true, 'needs-you'],
      ['living-spec-ready', false, null],
      ['tracker-unreachable', true, 'error'],
      ['ticket-comment', true, null],
      ['ticket-changed', true, null],
      ['ticket-status', true, null],
      ['ticket-write-failed', true, 'error'],
      ['can-be-built', true, 'done'],
      ['workspace-prepared', true, 'done'],
      ['workspace-preparation-failed', true, 'error'],
    ])
  })
})

describe('The switches are the application’s, listed from the registry', () => {
  const engine = () => commandsEngine(data)

  test('nothing chosen: each kind at its default, every sound on', async () => {
    const settings = await engine()(({ profile }) =>
      profile.use(readNotificationSettings(REGISTRY)),
    )
    expect(settings.kinds.map((one) => [one.id, one.on])).toEqual([
      ['need', true],
      ['failure', true],
      ['workspace-ready', false],
      ['workspace-failed', true],
      ['triage-answer', true],
      ['questions-asked', true],
      ['living-spec-ready', false],
      ['tracker-unreachable', true],
      ['ticket-comment', true],
      ['ticket-changed', true],
      ['ticket-status', true],
      ['ticket-write-failed', true],
      ['can-be-built', true],
      ['workspace-prepared', true],
      ['workspace-preparation-failed', true],
    ])
    expect(settings.sounds.map((one) => [one.sound, one.on])).toEqual([
      ['needs-you', true],
      ['error', true],
      ['done', true],
    ])
  })

  test('a kind registered later appears with its default, without touching the settings', async () => {
    const later = Result.getOrThrow(
      registryOf([
        ...KINDS,
        defineKind({
          id: 'mission-done',
          label: 'A mission is done',
          byDefault: true,
          sound: 'done',
          importance: 1,
          tone: 'done',
          source: 'mission.done',
          facts: () => Effect.succeed(Option.none()),
          words: () => ({ subject: '', what: '' }),
          route: () => HomeTarget.make({ projectId: null }),
        }),
      ]),
    )
    const settings = await engine()(({ profile }) => profile.use(readNotificationSettings(later)))
    expect(settings.kinds.at(-1)).toEqual({
      id: 'mission-done',
      label: 'A mission is done',
      on: true,
      byDefault: true,
      sound: 'done',
    })
  })

  test('a kind and a sound turned off stay off at the next start', async () => {
    await engine()(({ profile }) =>
      profile.use(
        Effect.andThen(
          setNotificationKind(REGISTRY, 'need', false),
          setNotificationSound(REGISTRY, 'error', false),
        ),
      ),
    )
    const settings = await engine()(({ profile }) =>
      profile.use(readNotificationSettings(REGISTRY)),
    )
    expect(settings.kinds.find((one) => one.id === 'need')?.on).toBe(false)
    expect(settings.sounds.find((one) => one.sound === 'error')?.on).toBe(false)
    expect(settings.sounds.find((one) => one.sound === 'done')?.on).toBe(true)
  })

  test('the sound styles: thirteen listed with their names, Hemera’s chosen by default', async () => {
    const settings = await engine()(({ profile }) =>
      profile.use(readNotificationSettings(REGISTRY)),
    )
    expect(settings.style).toBe('hemera')
    expect(settings.styles.map((one) => one.label)).toEqual([
      'Hemera',
      'Minimal',
      'Soft',
      'Glass',
      'Arcade',
      'Mechanical',
      'Organic',
      'Dreamy',
      'Sci-fi',
      'Rubber',
      'Cinematic',
      'Studio',
      'Zen',
    ])
  })

  test('the sound style chosen survives a restart', async () => {
    const chosen = await engine()(({ profile }) => profile.use(setSoundStyle(REGISTRY, 'glass')))
    expect(chosen.style).toBe('glass')
    const settings = await engine()(({ profile }) =>
      profile.use(readNotificationSettings(REGISTRY)),
    )
    expect(settings.style).toBe('glass')
  })

  test('a kind that is not registered is refused', async () => {
    const refusal = await engine()(({ profile }) =>
      profile.use(Effect.flip(setNotificationKind(REGISTRY, 'nothing', true))),
    )
    expect(refusal).toBeInstanceOf(UnknownNotificationKind)
  })
})
