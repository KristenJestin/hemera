/**
 * The Ship gesture (R9): its guard, its confirmation, the reruns it owes before anything is frozen,
 * the freeze, and the move from Review to Shipping. On the engine as it starts, with a mission in
 * Review the way the end of a Building leaves it (`ship-world.ts`).
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'

import {
  DecisionFields,
  MissionOwner,
  PermissionFields,
  SHIP_CHANGED,
  shipMovedSaid,
} from '@hemera/core/domain'
import { FeedbackUser, type ShipRefused, type UnknownMission } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Fiber, Result, Stream } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { OutsideChanges } from '../src/engine/building/outside.ts'
import { missionCopies, saveDeliveryRules } from '../src/engine/delivery-rules.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { getMission, moveMission } from '../src/engine/missions.ts'
import { createNeed, needService } from '../src/engine/needs.ts'
import { getProject } from '../src/engine/projects.ts'
import { Review } from '../src/engine/review/feedback.ts'
import { Ship } from '../src/engine/review/ship.ts'
import { Database, type DatabaseError } from '../src/engine/storage/database.ts'
import {
  buildingCheckResults,
  domainEvents,
  missionShips,
  proofRuns,
  reviewFeedback,
  reviewRounds,
  scenarioProofs,
} from '../src/engine/storage/schema.ts'
import { git } from './repositories.ts'
import { within } from './sessions-world.ts'
import {
  type InReview,
  LONG,
  SCENARIO,
  SLOW,
  type ShipWorld,
  pauseAt,
  rulesWith,
  shipEngine,
  shipReady,
  shipWorld,
  stopAt,
  treesNow,
} from './ship-world.ts'
import { removeFolders } from './storage.ts'
import { until } from './sessions-world.ts'

afterEach(removeFolders)

const USER = FeedbackUser.make({})

const preview = (missionId: string) => Ship.use((ship) => ship.preview(missionId))

const confirm = (missionId: string, previewId: string) =>
  Ship.use((ship) => ship.confirm(missionId, previewId))

/** A confirmation on the preview of now. */
const shipNow = (missionId: string) =>
  Effect.flatMap(preview(missionId), (seen) => confirm(missionId, seen.previewId))

/** What a Ship that ended in a failure failed with; null when it succeeded. */
const failureOf = <A, E>(outcome: Result.Result<A, E>): E | null =>
  Result.isFailure(outcome) ? outcome.failure : null

/** A refusal's reasons, or a defect when it was not refused. */
const refusedWith = <R>(
  effect: Effect.Effect<unknown, UnknownMission | DatabaseError | ShipRefused, R>,
) =>
  effect.pipe(
    Effect.flatMap(() => Effect.die(new Error('Ship was not refused'))),
    Effect.catchTag('ShipRefused', (failure) => Effect.succeed(failure.reasons)),
    Effect.orDie,
  )

const shipRow = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(missionShips)
      .where(eq(missionShips.missionId, missionId))
    return row ?? null
  })

const eventsOf = (missionId: string, type: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.entityId, missionId), eq(domainEvents.type, type)))
      .orderBy(asc(domainEvents.sequence))
  })

/** A file changed in a repository of the Workspace, found by the detector as made outside Hemera. */
const changedOutside = (mission: InReview, folder: string, path: string, content: string) =>
  Effect.gen(function* () {
    writeFileSync(join(folder, path), content)
    yield* OutsideChanges.use((outside) => outside.compare(mission.missionId, null))
  })

/** What the remote's branch points at, or null. */
const remoteHead = (world: ShipWorld, name: string, branch: string): string | null => {
  const printed = git(
    world.work,
    'ls-remote',
    join(world.work, 'remotes', `${name}.git`),
    `refs/heads/${branch}`,
  )
  return printed === '' ? null : (printed.split('\t')[0] ?? null)
}

describe('Ship is refused, every reason named', () => {
  test(
    'Ship refused for a waiting remark, a round in grilling, a red final check, an open need, a pending permission request and a missing approval, all listed together',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            yield* Review.use((review) =>
              review.feedbackAdd(
                mission.missionId,
                { kind: 'remark', body: 'The export misses the totals.', anchor: null, images: [] },
                USER,
              ),
            )
            const database = yield* Database
            const at = new Date().toISOString()
            yield* database.insert(reviewRounds).values({
              missionId: mission.missionId,
              number: 9,
              state: 'grilling',
              createdAt: at,
              movedAt: at,
            })
            const trees = yield* treesNow(mission)
            const [check] = yield* database.select().from(buildingCheckResults)
            yield* database.insert(buildingCheckResults).values({
              ...check!,
              id: crypto.randomUUID(),
              verdict: 'red',
              at: new Date().toISOString(),
              trees: JSON.stringify(trees),
            })
            const owner = MissionOwner.make({
              projectId: mission.projectId,
              missionId: mission.missionId,
              taskId: null,
            })
            yield* createNeed(
              needService('test'),
              owner,
              DecisionFields.make({
                question: 'Keep the old export?',
                options: ['Yes', 'No'],
                recommended: null,
              }),
            )
            yield* createNeed(
              needService('permissions'),
              owner,
              PermissionFields.make({
                call: 'commands_run git status',
                agentReason: 'To see the tree.',
                hemeraReason: 'risk 2.9',
                sensitive: false,
                asked: 'Run git status',
              }),
            )
            return { seen: yield* preview(mission.missionId) }
          }),
        ),
      )
      expect(seen.seen.possible).toBe(false)
      expect(seen.seen.reasons).toEqual([
        '1 remark waits for a fix.',
        'Round 9 is being worked on.',
        'The final check `test` is red in api.',
        'A decision waits for you: Keep the old export?',
        'A permission request waits for you: Run git status',
      ])
    },
    SLOW,
  )

  test(
    'a missing team approval refuses Ship when the rules require it, and its approval lifts it',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            // The rules require web's approval: the preparation its first push copies says so.
            const mission = yield* shipReady(
              world,
              rulesWith((draft, idOf) => ({
                ...draft,
                preparation: {
                  ...draft.preparation,
                  repositories: [
                    {
                      repositoryId: idOf('web'),
                      commitTemplate: '{key}: {title}',
                      pullRequestTitle: '{key}: {title}',
                      pullRequestBody: '{summary}',
                      reviewers: [],
                      requireApproval: true,
                      steps: { off: [], changed: [], added: [] },
                    },
                  ],
                },
              })),
            )
            const before = yield* preview(mission.missionId)
            world.setPullRequest('web', { approved: true })
            const after = yield* preview(mission.missionId)
            return { before, after }
          }),
        ),
      )
      expect(seen.before.reasons).toEqual(['web’s pull request has no approval yet.'])
      expect(seen.after.reasons).toEqual([])
      expect(seen.after.possible).toBe(true)
    },
    SLOW,
  )
})

describe('Ship stays possible', () => {
  test(
    'Ship allowed with only a question waiting, a withdrawn remark, an addressed feedback, a red pull request CI shown, and a manual proof to verify listed',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            const add = (kind: 'remark' | 'question', body: string) =>
              Review.use((review) =>
                review.feedbackAdd(
                  mission.missionId,
                  { kind, body, anchor: null, images: [] },
                  USER,
                ),
              )
            yield* add('question', 'Why CSV first?')
            const withdrawn = yield* add('remark', 'The totals are off.')
            yield* Review.use((review) => review.feedbackWithdraw(withdrawn.id, USER))
            const addressed = yield* add('remark', 'Name the file.')
            const database = yield* Database
            yield* database
              .update(reviewFeedback)
              .set({ state: 'addressed' })
              .where(eq(reviewFeedback.id, addressed.id))
            world.setPullRequest('api', {
              checks: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }],
            })
            return yield* preview(mission.missionId)
          }),
        ),
      )
      expect(seen.reasons).toEqual([])
      expect(seen.possible).toBe(true)
      const api = seen.repositories.find((one) => one.repository === 'api')
      expect(api?.pullRequest?.ci).toBe('failing')
      expect(seen.repositories.find((one) => one.repository === 'web')?.pullRequest?.ci).toBe(
        'none',
      )
      expect(seen.manualProofs).toEqual([
        { scenario: 'R1.S1', state: 'to_verify' },
        { scenario: 'R1.S3', state: 'to_verify' },
      ])
    },
    SLOW,
  )
})

describe('A change made outside Hemera is redone at Ship, never a refusal', () => {
  test(
    'a file changed outside Hemera after the last check is listed, its checks and proofs rerun, and green ships: frozen trees, Shipping, the same pull request',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            yield* changedOutside(
              mission,
              mission.api,
              'invoices.ts',
              'export const invoices = [1]\n',
            )
            const shown = yield* preview(mission.missionId)
            const shipped = yield* confirm(mission.missionId, shown.previewId)
            const trees = yield* treesNow(mission)
            const database = yield* Database
            const [proof] = yield* database
              .select()
              .from(scenarioProofs)
              .where(eq(scenarioProofs.scenario, SCENARIO))
            const [green] = yield* database
              .select()
              .from(proofRuns)
              .where(eq(proofRuns.id, proof?.greenRunId ?? ''))
            const memory = yield* Memory
            yield* memory.catchUp
            const lines = (yield* memory.journal(mission.missionId, null)).lines.map(
              (one) => one.text,
            )
            return {
              mission,
              seen: shown,
              shipped,
              trees,
              row: yield* shipRow(mission.missionId),
              stage: (yield* getMission(mission.missionId)).stage,
              proof: { state: proof?.state, phase: green?.phase, trees: green?.trees },
              shippedEvents: yield* eventsOf(mission.missionId, 'mission.shipped'),
              reruns: yield* eventsOf(mission.missionId, 'mission.ship_rerun'),
              copied: (yield* missionCopies(mission.missionId)).map((one) => one.section),
              lines,
            }
          }),
        ),
      )
      const api = seen.seen.repositories.find((one) => one.repository === 'api')
      expect(api?.files.find((one) => one.path === 'invoices.ts')?.changedOutside).toBe(true)
      expect(api?.toRedo).toEqual({ proofs: [SCENARIO], checks: ['test · api'] })
      expect(seen.seen.possible).toBe(true)
      expect(seen.stage).toBe('shipping')
      expect(seen.shipped.trees).toEqual(seen.trees)
      expect(JSON.parse(seen.row?.trees ?? '[]')).toEqual(seen.trees)
      expect(seen.proof.state).toBe('green')
      expect(seen.proof.phase).toBe('rerun')
      expect(JSON.parse(seen.proof.trees ?? '[]')).toEqual(
        seen.trees.filter((one) => one.repository === 'api'),
      )
      expect(world.asked.count).toBe(1)
      expect(seen.shippedEvents).toHaveLength(1)
      // The waves and the End are copied as Ship freezes the mission (CT-47).
      expect(seen.copied).toEqual(expect.arrayContaining(['preparation', 'waves', 'end']))
      expect(seen.reruns).toHaveLength(1)
      expect(seen.lines).toContain(
        'Ship ran again the proof R1.S2 and the final check test · api: green.',
      )
      expect(seen.lines).toContain('Shipped: the trees of api and web are frozen.')
      // The pull requests stay the ones Review opened.
      expect(world.pullRequests()).toHaveLength(2)
    },
    SLOW,
  )

  test(
    'a red rerun stops Ship: nothing frozen, nothing pushed, still in Review, and the red check refuses Ship',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            const pushed = remoteHead(world, 'api', mission.branch)
            yield* changedOutside(
              mission,
              mission.api,
              'invoices.ts',
              'export const invoices = [1]\n',
            )
            world.checks.set('test', 'red')
            const reasons = yield* refusedWith(shipNow(mission.missionId))
            return {
              reasons,
              pushed,
              after: remoteHead(world, 'api', mission.branch),
              row: yield* shipRow(mission.missionId),
              stage: (yield* getMission(mission.missionId)).stage,
              again: yield* preview(mission.missionId),
              refused: yield* eventsOf(mission.missionId, 'mission.ship_refused'),
            }
          }),
        ),
      )
      expect(seen.reasons).toEqual(['The final check `test` is red in api.'])
      expect(seen.row).toBeNull()
      expect(seen.stage).toBe('review')
      expect(seen.after).toBe(seen.pushed)
      expect(seen.again.reasons).toEqual(['The final check `test` is red in api.'])
      expect(seen.refused).toHaveLength(1)
    },
    SLOW,
  )

  test(
    'a red proof at its rerun stops Ship, nothing frozen',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            yield* changedOutside(mission, mission.api, 'broken.txt', 'broken\n')
            const reasons = yield* refusedWith(shipNow(mission.missionId))
            return {
              reasons,
              row: yield* shipRow(mission.missionId),
              stage: (yield* getMission(mission.missionId)).stage,
            }
          }),
        ),
      )
      expect(seen.reasons).toEqual(['The proof R1.S2 is red.'])
      expect(seen.row).toBeNull()
      expect(seen.stage).toBe('review')
    },
    SLOW,
  )
})

describe('Ship ships what the user saw', () => {
  test(
    'a confirm with an old preview id is refused',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            const old = yield* preview(mission.missionId)
            yield* changedOutside(mission, mission.web, 'page.ts', 'export const page = 2\n')
            const reasons = yield* refusedWith(confirm(mission.missionId, old.previewId))
            return { reasons, stage: (yield* getMission(mission.missionId)).stage }
          }),
        ),
      )
      expect(seen.reasons).toEqual([SHIP_CHANGED])
      expect(seen.stage).toBe('review')
    },
    SLOW,
  )

  test(
    'a change during the reruns aborts with its sentence, nothing frozen',
    async () => {
      const world = shipWorld()
      const paused = pauseAt('rerunning')
      const { run } = shipEngine(world, paused.hold)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            yield* changedOutside(
              mission,
              mission.api,
              'invoices.ts',
              'export const invoices = [1]\n',
            )
            const shipping = yield* Effect.forkChild(Effect.result(shipNow(mission.missionId)))
            yield* paused.reached
            const progress = yield* Ship.use((ship) =>
              Stream.runCollect(Stream.take(ship.progress(mission.missionId), 1)),
            )
            writeFileSync(join(mission.api, 'late.ts'), 'export const late = 1\n')
            yield* paused.release
            const outcome = yield* Fiber.join(shipping)
            return {
              outcome,
              progress,
              row: yield* shipRow(mission.missionId),
              stage: (yield* getMission(mission.missionId)).stage,
            }
          }),
        ),
      )
      expect(failureOf(seen.outcome)).toMatchObject({ reasons: [shipMovedSaid('api')] })
      expect(seen.progress[0]?.step).toBe('rerunning')
      expect(seen.progress[0]?.reruns).toEqual([
        { kind: 'proof', name: SCENARIO, state: 'waiting' },
        { kind: 'check', name: 'test · api', state: 'waiting' },
      ])
      expect(seen.row).toBeNull()
      expect(seen.stage).toBe('review')
    },
    SLOW,
  )

  test(
    'two presses ship once',
    async () => {
      const world = shipWorld()
      const paused = pauseAt('rerunning')
      const { run } = shipEngine(world, paused.hold)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            yield* changedOutside(
              mission,
              mission.api,
              'invoices.ts',
              'export const invoices = [1]\n',
            )
            const shown = yield* preview(mission.missionId)
            const first = yield* Effect.forkChild(
              Effect.result(confirm(mission.missionId, shown.previewId)),
            )
            yield* paused.reached
            const second = yield* Effect.forkChild(
              Effect.result(confirm(mission.missionId, shown.previewId)),
            )
            yield* paused.release
            return {
              first: yield* Fiber.join(first),
              second: yield* Fiber.join(second),
              shipped: yield* eventsOf(mission.missionId, 'mission.shipped'),
            }
          }),
        ),
      )
      expect(Result.isSuccess(seen.first)).toBe(true)
      expect(failureOf(seen.second)).toMatchObject({
        reasons: ['Ship is offered in Review: the mission is in Shipping.'],
      })
      expect(seen.shipped).toHaveLength(1)
    },
    SLOW,
  )

  test(
    'a cancel during the confirmation leaves nothing frozen',
    async () => {
      const world = shipWorld()
      const paused = pauseAt('freezing')
      const { run } = shipEngine(world, paused.hold)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            const shipping = yield* Effect.forkChild(Effect.result(shipNow(mission.missionId)))
            yield* paused.reached
            yield* moveMission(mission.missionId, 'cancel', 'user')
            yield* paused.release
            return {
              outcome: yield* Fiber.join(shipping),
              row: yield* shipRow(mission.missionId),
              stage: (yield* getMission(mission.missionId)).stage,
            }
          }),
        ),
      )
      expect(failureOf(seen.outcome)).toMatchObject({
        reasons: ['The mission moved meanwhile: nothing was frozen.'],
      })
      expect(seen.row).toBeNull()
      expect(seen.stage).toBe('cancelled')
    },
    SLOW,
  )

  test(
    'the confirmation shows the rules’ preparation changes since the copy',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            const project = yield* getProject(mission.projectId)
            const api = project.repositories.find((one) => one.path === 'api')?.id ?? ''
            const changed = rulesWith((draft, idOf) => ({
              ...draft,
              preparation: {
                ...draft.preparation,
                repositories: [
                  {
                    repositoryId: idOf('api'),
                    commitTemplate: '{key}: {title}',
                    pullRequestTitle: 'Invoices: {title}',
                    pullRequestBody: '{summary}\n\n{images}',
                    reviewers: [],
                    requireApproval: false,
                    steps: { off: [], changed: [], added: [] },
                  },
                ],
              },
            }))
            yield* saveDeliveryRules(
              mission.projectId,
              changed((path) => project.repositories.find((one) => one.path === path)?.id ?? path),
              1,
            )
            return { seen: yield* preview(mission.missionId), api }
          }),
        ),
      )
      expect(seen.seen.preparationChange).toEqual({
        copiedVersion: 1,
        currentVersion: 2,
        differences: [{ repositoryId: seen.api, field: 'pullRequestTitle' }],
      })
      expect(seen.seen.possible).toBe(true)
    },
    SLOW,
  )

  test(
    'Local preset: delivered recorded with the time',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const local = rulesWith((draft, idOf) => ({
              ...draft,
              waves: {
                ...draft.waves,
                repositories: ['api', 'web'].map((name) => ({
                  repositoryId: idOf(name),
                  preset: 'local' as const,
                  steps: { off: [], changed: [], added: [] },
                  deliversAfter: [],
                })),
              },
            }))
            // The Local preset pushes nothing: no push to wait for.
            const mission = yield* shipReady(world, local, false)
            // With nothing pushed, Review's entry still settles which change was made outside
            // Hemera after the mission got there: Ship is confirmed once two previews agree.
            yield* until(
              Effect.map(
                Effect.all([preview(mission.missionId), preview(mission.missionId)]),
                ([one, two]) => one.previewId === two.previewId,
              ),
              LONG,
            )
            const before = new Date().toISOString()
            const shown = yield* preview(mission.missionId)
            const shipped = yield* confirm(mission.missionId, shown.previewId)
            const after = new Date().toISOString()
            return { seen: shown, shipped, before, after, row: yield* shipRow(mission.missionId) }
          }),
        ),
      )
      expect(seen.seen.delivered).not.toBeNull()
      expect(seen.shipped.deliveredAt).not.toBeNull()
      expect(
        seen.shipped.deliveredAt! >= seen.before && seen.shipped.deliveredAt! <= seen.after,
      ).toBe(true)
      expect(seen.row?.deliveredAt).toBe(seen.shipped.deliveredAt)
    },
    SLOW,
  )

  test(
    'a restart during the reruns leaves the mission in Review with nothing frozen',
    async () => {
      const world = shipWorld()
      const stopped = stopAt('rerunning')
      const first = shipEngine(world, stopped.hold)
      const ready = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            yield* changedOutside(
              mission,
              mission.api,
              'invoices.ts',
              'export const invoices = [1]\n',
            )
            yield* Effect.forkDetach(Effect.result(shipNow(mission.missionId)))
            yield* stopped.reached
            return mission
          }),
        ),
      )
      const second = shipEngine(world)
      const seen = await second.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(Effect.succeed(true), LONG)
            return {
              stage: (yield* getMission(ready.missionId)).stage,
              row: yield* shipRow(ready.missionId),
              again: yield* preview(ready.missionId),
            }
          }),
        ),
      )
      expect(seen.stage).toBe('review')
      expect(seen.row).toBeNull()
      expect(seen.again.possible).toBe(true)
    },
    SLOW,
  )
})

describe('The rules Ship copies must fit what the mission copied before', () => {
  test(
    'waves that need a pull request the copied preparation never opened refuse Ship, nothing frozen',
    async () => {
      const world = shipWorld()
      const { run } = shipEngine(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            // The preparation the mission copies pushes, and opens no pull request; no wave yet.
            const before = rulesWith((draft) => ({
              ...draft,
              preparation: {
                ...draft.preparation,
                presets: {
                  ...draft.preparation.presets,
                  application: [
                    { id: 'commit', kind: 'commit-by-hemera', mode: 'auto' },
                    { id: 'push', kind: 'push', mode: 'auto' },
                  ],
                },
              },
              waves: {
                ...draft.waves,
                presets: { ...draft.waves.presets, application: [] },
              },
            }))
            const mission = yield* shipReady(world, before)
            const project = yield* getProject(mission.projectId)
            // Then the Project's rules: a pull request, and waves that squash it.
            yield* saveDeliveryRules(
              mission.projectId,
              rulesWith()(
                (path) => project.repositories.find((one) => one.path === path)?.id ?? path,
              ),
              1,
            )
            const reasons = yield* refusedWith(shipNow(mission.missionId))
            return {
              reasons,
              row: yield* shipRow(mission.missionId),
              stage: (yield* getMission(mission.missionId)).stage,
              copied: (yield* missionCopies(mission.missionId)).map((one) => one.section),
            }
          }),
        ),
      )
      expect(seen.reasons).toEqual([
        'Merge needs a pull request: api has no pull request step.',
        'Merge needs a pull request: web has no pull request step.',
      ])
      expect(seen.row).toBeNull()
      expect(seen.stage).toBe('review')
      expect(seen.copied).not.toContain('waves')
    },
    SLOW,
  )
})

describe('Only a human ships', () => {
  test('no engine module but the window’s calls and the wiring reaches Ship', () => {
    const engine = join(import.meta.dirname, '..', 'src', 'engine')
    const files = readdirSync(engine, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.ts'))
      .map((path) => path.split(sep).join('/'))
    const reaching = files.filter((path) => {
      if (path === 'review/ship.ts') return false
      const source = readFileSync(join(engine, path), 'utf8')
      return /from '[./]*(review\/)?ship\.ts'/.test(source) || /\bShip\.use(Sync)?\(/.test(source)
    })
    expect(reaching.toSorted()).toEqual(['profile.ts', 'serve.ts'])
  })
})
