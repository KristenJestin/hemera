/**
 * A cancel the user gave is never undone by work already under way (#378): nothing opens a
 * session, records a run or moves a Building's phase for a mission cancelled in the database, and
 * what the cancel ends (the Building, its helpers, its review's passes) ends in its own
 * transaction.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent and the test driving the
 * Builder's tools through its grant; Acme's real repositories in temporary folders as the
 * Workspace. Every state is reached with a hold, never a sleep.
 */

import { realpathSync } from 'node:fs'

import { SESSION_STATES } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Deferred, Effect, Fiber, type Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { buildingOf } from '../src/engine/building/builder.ts'
import { latestBuildingIn } from '../src/engine/building/tasks.ts'
import { acceptDocRecipes } from '../src/engine/doc-recipes.ts'
import { type Stopper, cancelMissionIn, getMission, moveMission } from '../src/engine/missions.ts'
import type { FakeScript } from '../src/engine/agents/fake.ts'
import { type OpenAsked, Sessions } from '../src/engine/sessions/service.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { commandRuns, helpers, projects, reviewPasses } from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { call, grantOf, says } from './building-world.ts'
import { builderAgents, builderOf, buildingNow, launched } from './builder-world.ts'
import { HELPER, held, sessionsEngine, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { callTool } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-cancel'))
  work = realpathSync.native(temporaryFolder('building-cancel-work'))
})
afterEach(removeFolders)

const LONG = 30_000
const SLOW = { timeout: 180_000 }

/**
 * The engine with the Builder of this version, the holds a test gives, and its stoppers. Every
 * agent after the Builder keeps its turn open until the engine ends, so a pass is the test's to
 * report.
 */
const cancelEngine = (
  more: {
    readonly openHold?: (
      at: 'opening' | 'written' | 'refused',
      asked: OpenAsked,
    ) => Effect.Effect<void>
    readonly runHold?: (at: 'recording' | 'launched') => Effect.Effect<void>
    readonly stoppers?: ReadonlyArray<Stopper>
  } = {},
) => {
  const working = held()
  const engine = sessionsEngine(
    data,
    (index): FakeScript =>
      index < 2
        ? builderAgents(index)
        : { steps: [says('Working.')], between: () => working.promise },
    {
      roles: [HELPER],
      tools: { home: work },
      sessions: more.openHold === undefined ? {} : { openHold: more.openHold },
      runs: more.runHold === undefined ? {} : { hold: more.runHold },
      missions: more.stoppers === undefined ? {} : { stoppers: more.stoppers },
    },
  )
  return {
    run: <A, E>(program: Parameters<typeof engine.run<A, E>>[0]) =>
      engine.run(program).finally(working.release),
  }
}

/** Every task of the plan built, in an order its dependencies allow: T1 edits a file, T2 adds one. */
const builtAll = (grantId: string) =>
  Effect.gen(function* () {
    for (const task of ['T1', 'T2', 'T4', 'T3']) {
      const started = yield* call(grantId, 'task_start', { task })
      if (started.startsWith('refused')) return yield* Effect.die(new Error(started))
      if (task === 'T1') {
        yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
        yield* call(grantId, 'fs_write', {
          repository: 'api',
          path: 'invoices.ts',
          content: 'export const invoices = ["csv"]\n',
        })
      }
      if (task === 'T2') {
        yield* call(grantId, 'fs_write', {
          repository: 'api',
          path: 'export.ts',
          content: 'export const markdown = true\n',
        })
      }
      yield* call(grantId, 'task_finished', { task, summary: `${task} built.` })
    }
  })

/** A Project that documents its README: the end opens a documenter. */
const withReadme = (projectId: string) =>
  Effect.asVoid(
    acceptDocRecipes(projectId, [
      {
        repository: 'api',
        path: 'README.md',
        purpose: 'What the api is, and how to export the invoices.',
        applies: 'always',
        words: [],
      },
    ]),
  )

/**
 * The openings of the mission's sessions, as the sessions say them: the first opening of one of
 * `roles` once armed waits for the test, and its outcome is kept; every session written is kept.
 */
const openings = (roles: ReadonlyArray<string>) => {
  const reached = Deferred.makeUnsafe<void>()
  const go = Deferred.makeUnsafe<void>()
  const outcome = Deferred.makeUnsafe<string>()
  const written: string[] = []
  let armed = false
  let opening: string | null = null
  const hold = (at: 'opening' | 'written' | 'refused', asked: OpenAsked) =>
    Effect.gen(function* () {
      if (at === 'written' && asked.owner.kind === 'mission') written.push(asked.role)
      if (!roles.includes(asked.role)) return
      if (at === 'opening' && armed && opening === null) {
        armed = false
        opening = asked.id ?? ''
        yield* Deferred.succeed(reached, undefined)
        yield* Deferred.await(go)
        return
      }
      if (at !== 'opening' && opening !== null && asked.id === opening) {
        yield* Deferred.succeed(outcome, at)
      }
    })
  return {
    hold,
    arm: () => {
      armed = true
    },
    reached,
    release: Deferred.succeed(go, undefined),
    outcome,
    written,
  }
}

/** The runs recorded for the mission, by when they were. */
const runsOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.select().from(commandRuns).where(eq(commandRuns.missionId, missionId))
  })

/** The mission's sessions of these roles, whatever their state. */
const sessionsOfRoles = (missionId: string, roles: ReadonlyArray<string>) =>
  Effect.map(sessionsIn(SESSION_STATES, { kind: 'mission', missionId }), (rows) =>
    rows.filter((row) => roles.includes(row.role)),
  )

/** The Project's cap of sub-agents set to `cap`. */
const capped = (projectId: string, cap: number) =>
  Effect.gen(function* () {
    const database = yield* Database
    yield* database.update(projects).set({ subAgentCap: cap }).where(eq(projects.id, projectId))
  })

const REVIEWERS = ['spec-reviewer', 'code-reviewer']

/** The review's passes of the mission. */
const passesOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.select().from(reviewPasses).where(eq(reviewPasses.missionId, missionId))
  })

/**
 * A mission whose end reached its review with no slot free, so both its reviewers' passes wait:
 * the cap drops to none while the documenter holds its slot, then the documenter reports. The cap
 * is then raised, for an engine that starts on it.
 */
const reviewWaiting = Effect.gen(function* () {
  const { mission } = yield* launched(work)
  const { grantId } = yield* builderOf(mission.id)
  const { projectId } = yield* getMission(mission.id)
  yield* builtAll(grantId)
  yield* until(
    Effect.map(sessionsOfRoles(mission.id, ['documenter']), (rows) => rows.length === 1),
    LONG,
  )
  yield* capped(projectId, 0)
  const [documenter] = yield* sessionsOfRoles(mission.id, ['documenter'])
  if (documenter === undefined) return yield* Effect.die(new Error('no documenter'))
  const reported = yield* callTool(yield* grantOf(documenter.id), 'docs_report', {
    changed: [],
    no_change_reason: 'The exports change no behaviour the README describes to its readers.',
  })
  if (!reported.ok) return yield* Effect.die(new Error(reported.text))
  yield* until(
    Effect.map(
      passesOf(mission.id),
      (rows) => rows.length === 2 && rows.every((one) => one.state === 'waiting'),
    ),
    LONG,
  )
  yield* capped(projectId, 4)
  return { mission, projectId }
})

describe('Work under way never undoes a cancel', () => {
  test(
    'a cancel while the end opens its documenter: the documenter is never written, and the end moves no phase',
    SLOW,
    async () => {
      const open = openings(['documenter'])
      let cancelled = false
      const recorded: string[] = []
      const seen = await cancelEngine({
        openHold: open.hold,
        runHold: (at) =>
          Effect.sync(() => {
            if (at === 'recording' && cancelled) recorded.push(at)
          }),
      }).run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const { grantId } = yield* builderOf(mission.id)
            open.arm()
            yield* builtAll(grantId)
            yield* Deferred.await(open.reached)
            const before = yield* buildingNow(mission.id)
            yield* moveMission(mission.id, 'cancel', 'user')
            cancelled = true
            yield* open.release
            return {
              outcome: yield* Deferred.await(open.outcome),
              before,
              after: yield* buildingNow(mission.id),
              documenters: yield* sessionsOfRoles(mission.id, ['documenter']),
            }
          }),
        ),
      )
      expect(seen.outcome).toBe('refused')
      expect(seen.documenters).toEqual([])
      expect(seen.after.state).toBe('cancelled')
      expect(seen.after.phase).toBe(seen.before.phase)
      expect(recorded).toEqual([])
    },
  )

  test(
    'a cancel while a start relaunches a reviewer’s pass a stop left waiting: its session is never written',
    SLOW,
    async () => {
      const first = await cancelEngine().run(({ profile }) => within(profile, reviewWaiting))
      const open = openings(REVIEWERS)
      open.arm()
      const seen = await cancelEngine({ openHold: open.hold }).run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* Deferred.await(open.reached)
            yield* moveMission(first.mission.id, 'cancel', 'user')
            yield* open.release
            return {
              outcome: yield* Deferred.await(open.outcome),
              reviewers: yield* sessionsOfRoles(first.mission.id, REVIEWERS),
              passes: yield* passesOf(first.mission.id),
              building: yield* buildingOf(first.mission.id),
            }
          }),
        ),
      )
      expect(seen.outcome).toBe('refused')
      expect(seen.reviewers).toEqual([])
      expect(seen.passes.map((one) => one.state)).toEqual(['failed', 'failed'])
      expect(seen.building?.state).toBe('cancelled')
    },
  )

  test(
    'a start after a cancel whose stops a stop cut, its end in review: no session is written, no run recorded, no phase moved, no question asked',
    SLOW,
    async () => {
      const cut = Deferred.makeUnsafe<void>()
      let armed = false
      // Once armed, the tree's stop never ends in the first engine: the stop cuts the cancel there.
      // The launch's Freeze stops the tree too, before.
      const tree: Stopper = {
        name: 'sessions',
        stop: () =>
          armed ? Effect.andThen(Deferred.succeed(cut, undefined), Effect.never) : Effect.void,
      }
      const first = await cancelEngine({ stoppers: [tree] }).run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const waiting = yield* reviewWaiting
            const before = yield* buildingNow(waiting.mission.id)
            armed = true
            yield* Effect.forkChild(moveMission(waiting.mission.id, 'cancel', 'user'))
            yield* Deferred.await(cut)
            return { ...waiting, before }
          }),
        ),
      )
      const open = openings([])
      const recorded: string[] = []
      const seen = await cancelEngine({
        openHold: open.hold,
        runHold: (at) =>
          Effect.sync(() => {
            if (at === 'recording') recorded.push(at)
          }),
      }).run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(
              Effect.map(getMission(first.mission.id), (one) => one.unstopped.length === 0),
              LONG,
            )
            return {
              mission: yield* getMission(first.mission.id),
              building: yield* buildingNow(first.mission.id),
              passes: yield* passesOf(first.mission.id),
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: first.mission.id,
              }),
            }
          }),
        ),
      )
      expect(open.written).toEqual([])
      expect(recorded).toEqual([])
      expect(seen.live).toEqual([])
      expect(seen.building.state).toBe('cancelled')
      expect(seen.building.phase).toBe(first.before.phase)
      expect(seen.passes.map((one) => one.state)).toEqual(['failed', 'failed'])
      expect(seen.mission.needs).toEqual([])
    },
  )

  test(
    'a cancel while the Builder’s proof run is about to be recorded: the run is never recorded',
    SLOW,
    async () => {
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      let armed = false
      const runHold = (at: 'recording' | 'launched') =>
        at === 'recording' && armed
          ? Effect.gen(function* () {
              armed = false
              yield* Deferred.succeed(reached, undefined)
              yield* Deferred.await(go)
            })
          : Effect.void
      const broken: Schema.JsonObject = {
        mode: 'automated',
        actions: ['Run the test'],
        starting_data: 'None.',
        expected: 'The assertion of the test holds.',
        test: {
          repository: 'api',
          path: 'tests/export.test.mjs',
          code: 'const = 1\n',
          insertion: 'new_file',
          command: `"${process.execPath}" --test --test-reporter=tap tests/export.test.mjs`,
        },
        seen_today: false,
      }
      const seen = await cancelEngine({ runHold }).run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              () => ({ 'R1.S2': broken }),
            )
            const { grantId } = yield* builderOf(mission.id)
            // The start's red ran: the proof is the Builder's to run again.
            yield* until(
              Effect.map(runsOf(mission.id), (rows) => rows.length === 1),
              LONG,
            )
            armed = true
            const running = yield* Effect.forkChild(
              call(grantId, 'proof_run', { scenario: 'R1.S2' }),
            )
            yield* Deferred.await(reached)
            yield* moveMission(mission.id, 'cancel', 'user')
            yield* Deferred.succeed(go, undefined)
            const answer = yield* Fiber.join(running)
            return { answer, runs: yield* runsOf(mission.id) }
          }),
        ),
      )
      expect(seen.runs).toHaveLength(1)
    },
  )
})

describe('A cancelled mission’s session is never taken over', () => {
  test(
    'a replacement asked for a helper’s session once its mission is cancelled, the tree not stopped yet: the session ends, and nothing takes over',
    SLOW,
    async () => {
      const cut = Deferred.makeUnsafe<void>()
      let armed = false
      // Once armed, the tree's stop never ends: the helper's session is still live after the cancel.
      const tree: Stopper = {
        name: 'sessions',
        stop: () =>
          armed ? Effect.andThen(Deferred.succeed(cut, undefined), Effect.never) : Effect.void,
      }
      const seen = await cancelEngine({ stoppers: [tree] }).run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work)
            const { grantId } = yield* builderOf(mission.id)
            const launch = yield* call(grantId, 'helper_launch', {
              brief: 'Tidy the export.',
              writes: false,
            })
            if (launch.startsWith('refused')) return yield* Effect.die(new Error(launch))
            const database = yield* Database
            const lineageOf = Effect.map(
              database.select().from(helpers).where(eq(helpers.missionId, mission.id)),
              (rows) => rows[0]?.lineage ?? null,
            )
            yield* until(
              Effect.map(lineageOf, (lineage) => lineage !== null),
              LONG,
            )
            const lineage = yield* lineageOf
            const ofLineage = Effect.map(
              sessionsIn(SESSION_STATES, { kind: 'mission', missionId: mission.id }),
              (rows) => rows.filter((one) => one.lineage === lineage),
            )
            yield* until(
              Effect.map(ofLineage, (rows) => rows.some((one) => one.state !== 'starting')),
              LONG,
            )
            const [session] = yield* ofLineage
            if (session === undefined) return yield* Effect.die(new Error('no helper session'))
            armed = true
            yield* Effect.forkChild(moveMission(mission.id, 'cancel', 'user'))
            yield* Deferred.await(cut)
            const successor = yield* Sessions.use((sessions) =>
              sessions.replace(session.id, 'its context is full'),
            )
            return { successor, sessions: yield* ofLineage }
          }),
        ),
      )
      expect(seen.successor).toBeNull()
      expect(seen.sessions.map((one) => one.state)).toEqual(['ended'])
    },
  )
})

describe('What a cancel ends, it ends in its own transaction', () => {
  test(
    'the Building and a running helper end with the cancel, in its transaction',
    SLOW,
    async () => {
      const seen = await cancelEngine().run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work)
            const { grantId } = yield* builderOf(mission.id)
            const launch = yield* call(grantId, 'helper_launch', {
              brief: 'Tidy the export.',
              writes: false,
            })
            if (launch.startsWith('refused')) return yield* Effect.die(new Error(launch))
            const database = yield* Database
            const running = Effect.map(
              database.select().from(helpers).where(eq(helpers.missionId, mission.id)),
              (rows) => rows.filter((one) => one.state === 'running'),
            )
            yield* until(
              Effect.map(running, (rows) => rows.length === 1),
              LONG,
            )
            // Read inside the cancel's own transaction: nothing else writes in between.
            return yield* mutate('cancelling in a test', (transaction) =>
              Effect.gen(function* () {
                const events = yield* cancelMissionIn(transaction, mission.id)
                const building = yield* latestBuildingIn(transaction, mission.id)
                const rows = yield* transaction
                  .select()
                  .from(helpers)
                  .where(eq(helpers.missionId, mission.id))
                return {
                  result: { building: building?.state, helpers: rows.map((one) => one.state) },
                  events,
                }
              }),
            )
          }),
        ),
      )
      expect(seen.building).toBe('cancelled')
      expect(seen.helpers).toEqual(['failed'])
    },
  )

  test('the review’s waiting passes end with the cancel, in its transaction', SLOW, async () => {
    const seen = await cancelEngine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* reviewWaiting
          return yield* mutate('cancelling in a test', (transaction) =>
            Effect.gen(function* () {
              const events = yield* cancelMissionIn(transaction, mission.id)
              const rows = yield* transaction
                .select()
                .from(reviewPasses)
                .where(eq(reviewPasses.missionId, mission.id))
              return { result: rows.map((one) => one.state), events }
            }),
          )
        }),
      ),
    )
    expect(seen).toEqual(['failed', 'failed'])
  })
})
