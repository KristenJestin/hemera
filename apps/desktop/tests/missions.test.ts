/**
 * Missions and needs in the engine: a mission created in Planning with its key, moved only by the
 * moves its stage allows and by the actor each move is for, marked, cancelled; and the needs that
 * wait on the user, answered once, kept across a restart, and handed to their owner exactly once.
 *
 * Each test runs the engine as it starts, over a data folder of its own: one call of `engine` is
 * one opening, so two calls are a restart. The services that later tickets bring (the guards of a
 * move, the stoppers of a cancel, the owners of a need, the grants of a session) are handed as
 * parts of the Profile, never patched.
 */

import { cpSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import {
  ChangedOutsideMark,
  DecisionFields,
  Dependency,
  EnvironmentFields,
  ErrorFields,
  FixingMark,
  MISSION_TYPES,
  MissionOwner,
  type Move,
  MoveRefused,
  NeedAnswerRefused,
  PermissionAnswer,
  PermissionFields,
  ProjectOwner,
  ApplicationOwner,
  BlockedMark,
  ChosenAnswer,
  WaitingOnYou,
  WrittenAnswer,
} from '@hemera/core/domain'
import { InvalidMissionIdea, KeyPrefixTaken, type Mission, type Need } from '@hemera/ipc'
import { Effect, Result, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { readEvents } from '../src/engine/journal.ts'
import {
  type MissionParts,
  MarkRefused,
  type Stopper,
  StopFailed,
  createMission,
  getMission,
  listMissions,
  moveMission,
  setMark,
} from '../src/engine/missions.ts'
import {
  AgentRequestRefused,
  DeliveryFailed,
  type NeedHandler,
  NeedRefused,
  answerNeed,
  createNeed,
  getNeed,
  listNeeds,
  needService,
  requestFromAgent,
  retryNeed,
} from '../src/engine/needs.ts'
import { createProject, getProject, setKeyPrefix } from '../src/engine/projects.ts'
import { listRuns, startRun } from '../src/engine/runs.ts'
import { openProfile } from '../src/engine/migrate.ts'
import { Database, SqliteClient } from '../src/engine/storage/database.ts'
import { projects } from '../src/engine/storage/schema.ts'
import { STAYS_UP, commandsEngine, nodeLine, script, until } from './commands-engine.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('missions'))
  work = realpathSync.native(temporaryFolder('missions-work'))
})
afterEach(removeFolders)

/** Every guard registered and passing: the moves are the stages' to allow. */
const PASSING: MissionParts['guards'] = {
  freeze: () => Effect.succeed([]),
  launch: () => Effect.succeed([]),
  fix: () => Effect.succeed([]),
  ship: () => Effect.succeed([]),
}

const engine = (parts: Partial<MissionParts> = {}) =>
  commandsEngine(data, { missions: { guards: PASSING, ...parts } })

/** A Project with a main checkout of its own on disk. */
const acme = (name = 'Acme') => {
  const folder = join(work, name.toLowerCase().replaceAll(' ', '-'))
  mkdirSync(folder, { recursive: true })
  return createProject({ name, mainCheckout: folder, repositories: [] })
}

const idea = (sentence: string) => ({ sentence, ticket: null })

const BILLING = needService('billing')

const decision = DecisionFields.make({
  question: 'Which table holds the invoices?',
  options: ['invoices', 'billing_invoices'],
  recommended: { option: 'invoices', reason: 'the api already reads it' },
})

const eventsOf = (kind: string, id: string) =>
  Effect.map(readEvents({ entity: { kind, id } }), (page) => page.events)

/** The moves that take a mission from Planning to the stage named, in order. */
const ROAD: ReadonlyArray<readonly [Move, 'user' | 'hemera']> = [
  ['freeze', 'user'],
  ['launch', 'user'],
  ['endBuilding', 'hemera'],
  ['ship', 'user'],
  ['complete', 'hemera'],
]

describe('A mission is created in Planning, with its key', () => {
  test('its identifier is a ULID, its key the prefix and the next number, and it started', async () => {
    const [mission, events] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const created = yield* createMission({
            projectId: project.id,
            idea: idea('Export the invoices as CSV'),
          })
          return [created, yield* eventsOf('mission', created.id)] as const
        }),
      ),
    )
    expect(Schema.is(Schema.String.check(Schema.isULID()))(mission.id)).toBe(true)
    expect(mission).toMatchObject({
      key: 'ACME-1',
      title: 'Export the invoices as CSV',
      type: 'feature',
      stage: 'planning',
      round: 0,
      frozen: false,
      cleanup: null,
    })
    expect(events.map((event) => event.type)).toEqual(['mission.started'])
  })

  test('a mission with neither a sentence nor a ticket is refused', async () => {
    const refused = await engine()(({ profile }) =>
      profile.use(
        Effect.flip(
          Effect.flatMap(acme(), (project) =>
            createMission({ projectId: project.id, idea: { sentence: '  ', ticket: null } }),
          ),
        ),
      ),
    )
    expect(refused).toBeInstanceOf(InvalidMissionIdea)
  })

  test('numbers go in order per Project and are never reused after a cancel', async () => {
    const keys = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const other = yield* acme('Hemera')
          const first = yield* createMission({ projectId: project.id, idea: idea('one') })
          yield* moveMission(first.id, 'cancel', 'user')
          yield* createMission({ projectId: project.id, idea: idea('two') })
          const elsewhere = yield* createMission({ projectId: other.id, idea: idea('three') })
          const listed = yield* listMissions(project.id)
          return [...listed.map((mission) => mission.key), elsewhere.key]
        }),
      ),
    )
    expect(keys).toEqual(['ACME-1', 'ACME-2', 'HEME-1'])
  })

  test('a second Project of the same name is given a prefix of its own', async () => {
    const prefixes = await engine()(({ profile }) =>
      profile.use(Effect.all([acme('Acme'), acme('Acme Labs')])),
    )
    expect(prefixes.map((project) => project.keyPrefix)).toEqual(['ACME', 'ACME2'])
  })

  test('a Project made before missions existed is given its prefix at the next start', async () => {
    await engine()(({ profile }) => profile.use(acme()))
    await on(
      data,
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.update(projects).set({ keyPrefix: null })
      }),
    )
    const [project] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const database = yield* Database
          return yield* database.select().from(projects)
        }),
      ),
    )
    expect(project?.keyPrefix).toBe('ACME')
  })

  test('a Profile from before missions keeps its Projects and repositories, and they get a prefix', async () => {
    // The migrations as they were before missions: the data folder of a build of tranche 0.
    const before = temporaryFolder('missions-before')
    const shippedNames = readdirSync(SHIPPED).toSorted()
    const missionsAt = shippedNames.findIndex((name) => name.endsWith('_missions'))
    for (const shipped of shippedNames.slice(0, missionsAt)) {
      cpSync(join(SHIPPED, shipped), join(before, shipped), { recursive: true })
    }
    await on(data, openProfile(data, before, '1.0.0'))
    await on(
      data,
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO projects (id, name, main_checkout, created_at, updated_at, version)
          VALUES ('acme', 'Acme', ${work}, '2026-10-01', '2026-10-01', 1)`
        yield* sql`INSERT INTO project_repositories
          (id, project_id, path, position, included_by_default, base_branch)
          VALUES ('api', 'acme', 'api', 1, 1, 'main')`
      }),
    )
    const project = await engine()(({ profile }) => profile.use(getProject('acme')))
    expect(project.keyPrefix).toBe('ACME')
    expect(project.repositories.map((repository) => repository.path)).toEqual(['api'])
  })

  test('the key does not change when the prefix does, and the old prefix stays taken', async () => {
    const [mission, later, refused] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const first = yield* createMission({ projectId: project.id, idea: idea('one') })
          const renamed = yield* setKeyPrefix({
            id: project.id,
            version: project.version,
            prefix: 'ac',
          })
          const second = yield* createMission({ projectId: project.id, idea: idea('two') })
          const other = yield* acme('Hemera')
          const taken = yield* Effect.flip(
            setKeyPrefix({ id: other.id, version: other.version, prefix: 'ACME' }),
          )
          expect(renamed.keyPrefix).toBe('AC')
          return [yield* getMission(first.id), second, taken] as const
        }),
      ),
    )
    expect(mission.key).toBe('ACME-1')
    expect(later.key).toBe('AC-2')
    expect(refused).toBeInstanceOf(KeyPrefixTaken)
  })
})

describe('A mission moves only as its stage allows, and only by the actor each move is for', () => {
  test('a mission goes the whole road, a round is counted, and each move is written down', async () => {
    const [stages, rounds, events] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          const seen: string[] = []
          const roundsSeen: number[] = []
          for (const [move, actor] of [
            ['freeze', 'user'],
            ['backToPlanning', 'user'],
            ['freeze', 'user'],
            ['launch', 'user'],
            ['endBuilding', 'hemera'],
            ['fix', 'user'],
            ['endBuilding', 'hemera'],
            ['ship', 'user'],
            ['complete', 'hemera'],
          ] as const) {
            const moved = yield* moveMission(id, move, actor)
            seen.push(moved.stage)
            roundsSeen.push(moved.round)
          }
          return [seen, roundsSeen, yield* eventsOf('mission', id)] as const
        }),
      ),
    )
    expect(stages).toEqual([
      'ready',
      'planning',
      'ready',
      'building',
      'review',
      'building',
      'review',
      'shipping',
      'done',
    ])
    expect(rounds).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1])
    const moved = events.filter((event) => event.type === 'mission.moved')
    expect(moved).toHaveLength(9)
    expect(moved[5]?.payload).toMatchObject({
      from: 'review',
      to: 'building',
      move: 'fix',
      actor: 'user',
      round: 1,
    })
    expect(moved[4]).toMatchObject({ author: 'hemera', source: 'system' })
  })

  test('a human move made by Hemera is refused: no agent tool can Freeze, Launch, Ship or Cancel', async () => {
    const refusals = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          return [
            yield* Effect.flip(moveMission(id, 'freeze', 'hemera')),
            yield* Effect.flip(moveMission(id, 'cancel', 'hemera')),
          ]
        }),
      ),
    )
    for (const refused of refusals) expect(refused).toBeInstanceOf(MoveRefused)
  })

  test('a move whose guard is not registered is refused as not available yet', async () => {
    const refused = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          return yield* Effect.flip(moveMission(id, 'freeze', 'user'))
        }),
      ),
    )
    expect(refused).toBeInstanceOf(MoveRefused)
    expect(refused.message).toBe('Freeze is refused: not available yet.')
  })

  test('a guard that finds reasons refuses the move with them', async () => {
    const refused = await engine({
      guards: { ...PASSING, freeze: () => Effect.succeed(['two tasks have no proof']) },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          return yield* Effect.flip(moveMission(id, 'freeze', 'user'))
        }),
      ),
    )
    expect(refused.message).toBe('Freeze is refused: two tasks have no proof.')
  })

  test('two launches at once make one Building: the second is refused', async () => {
    const outcomes = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          yield* moveMission(id, 'freeze', 'user')
          return yield* Effect.all(
            [
              Effect.result(moveMission(id, 'launch', 'user')),
              Effect.result(moveMission(id, 'launch', 'user')),
            ],
            { concurrency: 'unbounded' },
          )
        }),
      ),
    )
    expect(outcomes.filter(Result.isSuccess)).toHaveLength(1)
  })

  test('the stages, the marks and the ball are the same for the three types', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.forEach(MISSION_TYPES, (type) =>
          Effect.gen(function* () {
            const project = yield* acme(`Acme ${type}`)
            const { id } = yield* createMission({ projectId: project.id, idea: idea('one'), type })
            const steps: Array<Partial<Mission>> = []
            /** What a mission's behaviour is made of; its identity, type and dates are not. */
            const keep = (mission: Mission) =>
              steps.push({
                stage: mission.stage,
                round: mission.round,
                frozen: mission.frozen,
                ball: mission.ball,
                cleanup: mission.cleanup,
                unstopped: mission.unstopped,
                needs: mission.needs,
              })
            yield* setMark(
              id,
              BlockedMark.make({ cause: Dependency.make({ missionKey: 'ACME-11' }) }),
            )
            keep(yield* getMission(id))
            for (const [move, actor] of ROAD) keep(yield* moveMission(id, move, actor))
            return steps
          }),
        ),
      ),
    )
    expect(seen[1]).toEqual(seen[0])
    expect(seen[2]).toEqual(seen[0])
  })
})

describe('A mark is set only where it may be', () => {
  test('fixing is refused outside Shipping', async () => {
    const refused = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          return yield* Effect.flip(setMark(id, FixingMark.make({})))
        }),
      ),
    )
    expect(refused).toBeInstanceOf(MarkRefused)
  })

  test('a mark is said in a sentence, once however often it is set, and blocks the ball', async () => {
    const mission = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          const blocked = BlockedMark.make({ cause: Dependency.make({ missionKey: 'ACME-11' }) })
          yield* setMark(id, blocked)
          yield* setMark(id, blocked)
          yield* setMark(id, ChangedOutsideMark.make({ repositoryId: 'api' }))
          return yield* getMission(id)
        }),
      ),
    )
    expect(mission.marks.map((mark) => mark.sentence)).toEqual([
      'blocked by ACME-11',
      'Changed outside Hemera',
    ])
    expect(mission.ball).toMatchObject({ causes: [{ missionKey: 'ACME-11' }] })
  })
})

describe('A need is answered once', () => {
  const pendingDecision = (projectId: string, missionId: string) =>
    createNeed(BILLING, MissionOwner.make({ projectId, missionId, taskId: 'task-3' }), decision)

  test('a need answered twice gives one write and the same outcome', async () => {
    const [first, second, events] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const mission = yield* createMission({ projectId: project.id, idea: idea('one') })
          const need = yield* pendingDecision(project.id, mission.id)
          const once = yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: 'invoices' }),
            key: 'a',
          })
          const twice = yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: 'billing_invoices' }),
            key: 'b',
          })
          return [once, twice, yield* eventsOf('need', need.id)] as const
        }),
      ),
    )
    expect(first.state).toBe('answered')
    expect(second).toEqual(first)
    expect(events.filter((event) => event.type === 'need.answered')).toHaveLength(1)
  })

  test('concurrent answers write once and hand the owner one answer', async () => {
    const delivered: string[] = []
    const owner: NeedHandler = {
      deliver: (need) => Effect.sync(() => (delivered.push(need.id), [])),
    }
    const [outcomes, events] = await engine({ owners: new Map([['billing', owner]]) })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const project = yield* acme()
            const mission = yield* createMission({ projectId: project.id, idea: idea('one') })
            const need = yield* pendingDecision(project.id, mission.id)
            const answers = yield* Effect.all(
              ['a', 'b', 'c'].map((key) =>
                answerNeed({ id: need.id, answer: WrittenAnswer.make({ text: key }), key }),
              ),
              { concurrency: 'unbounded' },
            )
            return [answers, yield* eventsOf('need', need.id)] as const
          }),
        ),
    )
    expect(new Set(outcomes.map((need) => JSON.stringify(need.answer))).size).toBe(1)
    expect(events.filter((event) => event.type === 'need.answered')).toHaveLength(1)
    expect(delivered).toHaveLength(1)
  })

  test('an answer the need does not offer is refused', async () => {
    const refused = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const mission = yield* createMission({ projectId: project.id, idea: idea('one') })
          const need = yield* pendingDecision(project.id, mission.id)
          return yield* Effect.flip(
            answerNeed({ id: need.id, answer: ChosenAnswer.make({ option: 'ledger' }), key: 'a' }),
          )
        }),
      ),
    )
    expect(refused).toBeInstanceOf(NeedAnswerRefused)
  })

  test('a mission that owns a pending need has the ball waiting on you, and blocks no stage', async () => {
    const mission = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          yield* moveMission(id, 'freeze', 'user')
          yield* moveMission(id, 'launch', 'user')
          yield* pendingDecision(project.id, id)
          return yield* getMission(id)
        }),
      ),
    )
    expect(mission.stage).toBe('building')
    expect(mission.ball).toEqual(WaitingOnYou.make({}))
    expect(mission.needs[0]?.owner).toMatchObject({ taskId: 'task-3' })
  })
})

describe('A need survives a restart, and its answer reaches its owner exactly once', () => {
  test('a pending need is still pending after a restart, and nothing answered it', async () => {
    const created = await engine()(({ profile }) =>
      profile.use(
        createNeed(
          BILLING,
          ApplicationOwner.make({}),
          EnvironmentFields.make({
            missing: 'Git is not on the PATH',
            action: 'Install Git',
            settingsSection: null,
          }),
        ),
      ),
    )
    const [again, groups] = await engine()(({ profile }) =>
      profile.use(Effect.all([getNeed(created.id), listNeeds])),
    )
    expect(again).toEqual(created)
    expect(again.state).toBe('pending')
    expect(groups).toEqual([{ projectId: null, needs: [created] }])
  })

  test('an answer given just before a crash is handed to its owner once, after it', async () => {
    const delivered: Need[] = []
    const owners = new Map([
      ['billing', { deliver: (need: Need) => Effect.sync(() => (delivered.push(need), [])) }],
    ])
    // The first engine stops before the owner had the answer: it never got to hand it over.
    const id = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const mission = yield* createMission({ projectId: project.id, idea: idea('one') })
          const need = yield* createNeed(
            BILLING,
            MissionOwner.make({ projectId: project.id, missionId: mission.id, taskId: null }),
            decision,
          )
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: 'invoices' }),
            key: 'a',
          })
          return need.id
        }),
      ),
    )
    await engine({ owners })(({ profile }) =>
      until(
        Effect.sync(() => delivered.length),
        (count) => count > 0,
      ).pipe(Effect.andThen(profile.gate)),
    )
    await engine({ owners })(() => Effect.sleep('200 millis'))
    expect(delivered.map((need) => need.id)).toEqual([id])
    expect(delivered[0]?.answer).toEqual(ChosenAnswer.make({ option: 'invoices' }))
  })
})

describe('An owner that cannot take an answer gets it again, once', () => {
  test('a delivery that fails waits for the next start, and is then taken once', async () => {
    const taken: string[] = []
    let refuses = true
    const owners = new Map<string, NeedHandler>([
      [
        'billing',
        {
          deliver: (need) =>
            refuses
              ? Effect.fail(new DeliveryFailed({ reason: 'the session is not there yet' }))
              : Effect.sync(() => (taken.push(need.id), [])),
        },
      ],
    ])
    const id = await engine({ owners })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const need = yield* createNeed(BILLING, ApplicationOwner.make({}), decision)
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: 'invoices' }),
            key: 'a',
          })
          return need.id
        }),
      ),
    )
    expect(taken).toEqual([])
    refuses = false
    await engine({ owners })(() =>
      until(
        Effect.sync(() => taken.length),
        (count) => count > 0,
      ),
    )
    await engine({ owners })(() => Effect.sleep('200 millis'))
    expect(taken).toEqual([id])
  })
})

describe('Retry checks an environment need again', () => {
  test('a need whose owner finds it resolved is withdrawn; one still holding stays', async () => {
    let holds = true
    const owners = new Map([
      [
        'billing',
        {
          deliver: () => Effect.succeed([]),
          recheck: () => Effect.sync(() => holds),
        },
      ],
    ])
    const [still, withdrawn] = await engine({ owners })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const need = yield* createNeed(
            BILLING,
            ApplicationOwner.make({}),
            EnvironmentFields.make({
              missing: 'Docker is not running',
              action: 'Start Docker',
              settingsSection: null,
            }),
          )
          const first = yield* retryNeed(need.id)
          holds = false
          return [first, yield* retryNeed(need.id)] as const
        }),
      ),
    )
    expect(still.state).toBe('pending')
    expect(withdrawn.state).toBe('withdrawn')
  })
})

describe('Cancel stops everything and keeps the work', () => {
  test('cancel expires the pending needs with the move, calls each stopper, and deletes nothing', async () => {
    const stopped: string[] = []
    const stoppers: ReadonlyArray<Stopper> = [
      { name: 'sessions', stop: (id) => Effect.sync(() => void stopped.push(`sessions ${id}`)) },
      { name: 'probes', stop: (id) => Effect.sync(() => void stopped.push(`probes ${id}`)) },
    ]
    const [mission, need, events] = await engine({ stoppers })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          const pending = yield* createNeed(
            BILLING,
            MissionOwner.make({ projectId: project.id, missionId: id, taskId: null }),
            decision,
          )
          const cancelled = yield* moveMission(id, 'cancel', 'user')
          const all = yield* readEvents({})
          return [cancelled, yield* getNeed(pending.id), all.events] as const
        }),
      ),
    )
    expect(mission).toMatchObject({
      stage: 'cancelled',
      cleanup: 'awaiting-confirmation',
      ball: null,
      needs: [],
      unstopped: [],
    })
    expect(need).toMatchObject({ state: 'expired', endedReason: 'the mission was cancelled' })
    expect(stopped.toSorted()).toEqual([`probes ${mission.id}`, `sessions ${mission.id}`])
    // The cancel and the expiry are one transaction: their events share their place in the journal.
    const cancel = events.findIndex((event) => event.type === 'mission.cancelled')
    const expiry = events.findIndex((event) => event.type === 'need.expired')
    expect(cancel).toBeGreaterThan(-1)
    expect(Math.abs(cancel - expiry)).toBe(1)
    expect(events.at(-1)?.type).not.toBe('mission.deleted')
  })

  test('no need is created on a mission that has ended', async () => {
    const refused = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          yield* moveMission(id, 'cancel', 'user')
          return yield* Effect.flip(
            createNeed(
              BILLING,
              MissionOwner.make({ projectId: project.id, missionId: id, taskId: null }),
              decision,
            ),
          )
        }),
      ),
    )
    expect(refused).toBeInstanceOf(NeedRefused)
  })

  test('the cancel records who made it, from where, and the round', async () => {
    const [event] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          for (const [move, actor] of [...ROAD.slice(0, 3), ['fix', 'user']] as const) {
            yield* moveMission(id, move, actor)
          }
          yield* moveMission(id, 'cancel', 'user')
          const events = yield* eventsOf('mission', id)
          return events.filter((one) => one.type === 'mission.cancelled')
        }),
      ),
    )
    expect(event?.payload).toMatchObject({ from: 'building', actor: 'user', round: 1 })
  })

  test('Cancelled is final', async () => {
    const refused = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          yield* moveMission(id, 'cancel', 'user')
          return yield* Effect.flip(moveMission(id, 'freeze', 'user'))
        }),
      ),
    )
    expect(refused).toBeInstanceOf(MoveRefused)
  })

  test('a stopper that fails is listed, and tried again at the next start', async () => {
    let fails = true
    const stoppers: ReadonlyArray<Stopper> = [
      {
        name: 'delivery',
        stop: () =>
          fails ? Effect.fail(new StopFailed({ reason: 'the forge did not answer' })) : Effect.void,
      },
    ]
    const cancelled = await engine({ stoppers })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          return yield* moveMission(id, 'cancel', 'user')
        }),
      ),
    )
    expect(cancelled.unstopped).toEqual(['delivery'])
    const { id } = cancelled
    fails = false
    const mission = await engine({ stoppers })(({ profile }) =>
      profile.use(until(getMission(id), (seen) => seen.unstopped.length === 0)),
    )
    expect(mission.unstopped).toEqual([])
  })

  test('the runs started for the mission are stopped', async () => {
    const [run, after] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          const started = yield* startRun({
            projectId: project.id,
            workspaceId: null,
            commandId: null,
            line: nodeLine(script(STAYS_UP)),
            folder: null,
            startedBy: 'user',
            sessionId: null,
            missionId: id,
          })
          yield* moveMission(id, 'cancel', 'user')
          const runs = yield* listRuns(project.id, null)
          return [started, runs.find((one) => one.id === started.id)] as const
        }),
      ),
    )
    expect(run.missionId).not.toBeNull()
    expect(after?.state).toBe('stopped')
  })
})

describe('Allow for this mission is offered only where it may be', () => {
  const permission = (sensitive: boolean) =>
    PermissionFields.make({
      call: 'cat ~/.ssh/config',
      agentReason: 'read the deploy host',
      hemeraReason: sensitive ? 'sensitive place: ~/.ssh' : 'outside the Workspace: ~/notes',
      sensitive,
    })

  test('absent on a sensitive place and on a need a Project owns', async () => {
    const choices = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          const owner = MissionOwner.make({ projectId: project.id, missionId: id, taskId: null })
          const ordinary = yield* createNeed(BILLING, owner, permission(false))
          const sensitive = yield* createNeed(BILLING, owner, permission(true))
          const chat = yield* createNeed(
            BILLING,
            ProjectOwner.make({ projectId: project.id }),
            permission(false),
          )
          const refused = yield* Effect.flip(
            answerNeed({
              id: chat.id,
              answer: PermissionAnswer.make({ choice: 'allow-for-mission' }),
              key: 'a',
            }),
          )
          expect(refused).toBeInstanceOf(NeedAnswerRefused)
          return [ordinary.choices, sensitive.choices, chat.choices]
        }),
      ),
    )
    expect(choices).toEqual([
      ['allow-once', 'allow-for-mission', 'deny'],
      ['allow-once', 'deny'],
      ['allow-once', 'deny'],
    ])
  })
})

describe('An agent asks for a need, and Hemera decides whether it is one', () => {
  const builder = (missionId: string) => ({ id: 'session-1', role: 'builder', missionId })
  const granted = { grants: { holds: () => Effect.succeed(true) } }

  const asked = {
    question: 'Which table holds the invoices?',
    options: ['invoices'],
    recommended: null,
  }

  test('a decision asked by a session with a live grant is created, and says who asked', async () => {
    const [need, owner] = await engine(granted)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          const requested = yield* requestFromAgent(builder(id), 'Decision', asked, 'task-3')
          return [
            requested,
            MissionOwner.make({ projectId: project.id, missionId: id, taskId: 'task-3' }),
          ] as const
        }),
      ),
    )
    expect(need).toMatchObject({ state: 'pending', requestedBy: 'builder' })
    expect(need.owner).toEqual(owner)
  })

  test('an error or a permission is never asked for by an agent', async () => {
    const refusals = await engine(granted)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          const error = ErrorFields.make({ failed: 'x', attempts: [], proposals: ['y'] })
          return [
            yield* Effect.flip(requestFromAgent(builder(id), 'Error', error, null)),
            yield* Effect.flip(requestFromAgent(builder(id), 'Permission', asked, null)),
          ]
        }),
      ),
    )
    for (const refused of refusals) expect(refused).toBeInstanceOf(AgentRequestRefused)
  })

  test('a session without a live grant on the mission is refused', async () => {
    const refused = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          return yield* Effect.flip(requestFromAgent(builder(id), 'Decision', asked, null))
        }),
      ),
    )
    expect(refused).toBeInstanceOf(AgentRequestRefused)
    expect(refused.message).toMatch(/grant/)
  })

  test('a raw payload shaped like a need is refused', async () => {
    /** What an agent sends is JSON it wrote: here, one that tries to answer its own need. */
    const shaped: Schema.Json = JSON.parse(
      '{"question":"Which table?","options":["invoices"],"recommended":null,' +
        '"state":"answered","answer":{"_tag":"Chosen","option":"invoices"},"owner":{"_tag":"Application"}}',
    )
    const refused = await engine(granted)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({ projectId: project.id, idea: idea('one') })
          return yield* Effect.flip(requestFromAgent(builder(id), 'Decision', shaped, null))
        }),
      ),
    )
    expect(refused).toBeInstanceOf(AgentRequestRefused)
  })
})

describe('Needs you lists every pending need, the application’s first', () => {
  test('grouped by owner, the application first, then each Project, oldest first', async () => {
    const groups = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acmeProject = yield* acme()
          const hemera = yield* acme('Hemera')
          const git = EnvironmentFields.make({
            missing: 'Git is not on the PATH',
            action: 'Install Git',
            settingsSection: null,
          })
          const { id } = yield* createMission({ projectId: acmeProject.id, idea: idea('one') })
          const first = yield* createNeed(
            BILLING,
            MissionOwner.make({ projectId: acmeProject.id, missionId: id, taskId: null }),
            decision,
          )
          const onHemera = yield* createNeed(
            BILLING,
            ProjectOwner.make({ projectId: hemera.id }),
            git,
          )
          const second = yield* createNeed(
            BILLING,
            ProjectOwner.make({ projectId: acmeProject.id }),
            git,
          )
          const app = yield* createNeed(BILLING, ApplicationOwner.make({}), git)
          return [
            yield* listNeeds,
            [app.id, first.id, second.id, onHemera.id],
            [acmeProject.id, hemera.id],
          ] as const
        }),
      ),
    )
    const [listed, order, projectIds] = groups
    expect(listed.map((group) => group.projectId)).toEqual([null, ...projectIds])
    expect(listed.flatMap((group) => group.needs.map((need) => need.id))).toEqual(order)
  })
})

describe('A Project carries its key prefix', () => {
  test('a Project read back has the prefix it was given', async () => {
    const project = await engine()(({ profile }) =>
      profile.use(Effect.flatMap(acme(), (created) => getProject(created.id))),
    )
    expect(project.keyPrefix).toBe('ACME')
  })
})
