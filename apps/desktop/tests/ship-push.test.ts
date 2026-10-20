/**
 * Ship's push (R9, step 7): right after the freeze, each repository whose preparation pushes and
 * that changed since its last push is pushed by R6's own sequence, its pull request found or opened
 * as the rules say. Handed to the pushes in the freeze's transaction, so a restart between the
 * freeze and the push resumes it, once; a push that fails leaves the mission in Shipping with the
 * push's own need. On the engine as it starts, with a mission in Review as `ship-world.ts` leaves
 * it; each bare remote keeps a log of every update of its branches, the pushes it received.
 */

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ChosenAnswer, type DeliveryAction } from '@hemera/core/domain'
import type { Need, ShipProgress } from '@hemera/ipc'
import { Deferred, Effect, Fiber, Layer, Predicate, Result, Stream } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { type CheckResult, TaskChecks } from '../src/engine/building/checks.ts'
import { OutsideChanges } from '../src/engine/building/outside.ts'
import { type PushesHold, Pushes } from '../src/engine/delivery/pushes.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed, pendingNeedsOf } from '../src/engine/needs.ts'
import { Ship, type ShipHold } from '../src/engine/review/ship.ts'
import { builderAgents } from './builder-world.ts'
import { git } from './repositories.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import {
  type InReview,
  LONG,
  SLOW,
  type ShipWorld,
  pushedIn,
  rulesWith,
  shipReady,
  shipWorld,
  stopAt,
} from './ship-world.ts'
import { removeFolders } from './storage.ts'

afterEach(removeFolders)

/** The Project's final check `test`, green in `api` whenever it is asked. */
const greenChecks = Layer.succeed(TaskChecks, {
  run: (asked) =>
    Effect.succeed(
      asked.scope !== 'end'
        ? []
        : [
            {
              name: 'test',
              place: 'api',
              verdict: 'green',
              detail: 'it exited 0',
              outputTail: 'test: all passing',
              runId: null,
            } satisfies CheckResult,
          ],
    ),
})

/** The engine of these suites, Ship and the pushes held where the test says. */
const engineOf = (
  world: ShipWorld,
  holds: { readonly ship?: ShipHold; readonly delivery?: PushesHold } = {},
) =>
  sessionsEngine(world.data, builderAgents, {
    roles: [HELPER],
    tools: { home: world.work },
    building: {
      outside: { compareEveryMillis: 3_600_000, baseEveryMillis: 3_600_000 },
      checks: greenChecks,
    },
    forge: { env: world.fake.env },
    ship: { hold: holds.ship },
    delivery: { hold: holds.delivery },
  })

const bareOf = (world: ShipWorld, name: string) => join(world.work, 'remotes', `${name}.git`)

/** From now on, the bare remote of a repository logs every update of its branches. */
const recordPushes = (world: ShipWorld) => {
  for (const name of ['api', 'web']) {
    git(bareOf(world, name), 'config', 'core.logAllRefUpdates', 'true')
  }
}

/** How many times the remote's branch was updated since it started to record. */
const pushesTo = (world: ShipWorld, name: string, branch: string) => {
  const log = join(bareOf(world, name), 'logs', 'refs', 'heads', ...branch.split('/'))
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '').length
    : 0
}

/** The tree of the commit the remote's branch points at. */
const remoteTree = (world: ShipWorld, name: string, branch: string) =>
  git(bareOf(world, name), 'rev-parse', `refs/heads/${branch}^{tree}`)

/** The remote refuses every push, with a sentence of its own, until `accept` is called. */
const refusing = (world: ShipWorld, name: string) => {
  const hook = join(bareOf(world, name), 'hooks', 'pre-receive')
  writeFileSync(hook, '#!/bin/sh\necho "the remote refuses this push" >&2\nexit 1\n')
  chmodSync(hook, 0o755)
  return { accept: () => rmSync(hook) }
}

/** A file changed in both repositories after Review's push, found as made outside Hemera. */
const changedInBoth = (mission: InReview) =>
  Effect.gen(function* () {
    writeFileSync(join(mission.api, 'invoices.ts'), 'export const invoices = [1]\n')
    writeFileSync(join(mission.web, 'page.ts'), 'export const page = 2\n')
    yield* OutsideChanges.use((outside) => outside.compare(mission.missionId, null))
  })

const preview = (missionId: string) => Ship.use((ship) => ship.preview(missionId))

const confirm = (missionId: string, previewId: string) =>
  Ship.use((ship) => ship.confirm(missionId, previewId))

/** A confirmation on the preview of now, once two previews in a row agree. */
const shipNow = (missionId: string) =>
  Effect.gen(function* () {
    yield* until(
      Effect.map(
        Effect.all([preview(missionId), preview(missionId)]),
        ([one, two]) => one.previewId === two.previewId,
      ),
      LONG,
    )
    const seen = yield* preview(missionId)
    return yield* confirm(missionId, seen.previewId)
  })

const pushesOf = (missionId: string) => Pushes.use((pushes) => pushes.pushes(missionId))

const pendingOf = (missionId: string, kind: Need['fields']['_tag']) =>
  Effect.map(pendingNeedsOf([missionId]), (all) =>
    (all.get(missionId) ?? []).filter((need) => Predicate.isTagged(need.fields, kind)),
  )

/** Waits for the first pending need of a kind on the mission. */
const needOf = (missionId: string, kind: Need['fields']['_tag']) =>
  Effect.gen(function* () {
    yield* until(
      Effect.map(pendingOf(missionId, kind), (found) => found.length > 0),
      LONG,
    )
    const [found] = yield* pendingOf(missionId, kind)
    if (found === undefined) return yield* Effect.die(new Error(`no ${kind} need`))
    return found
  })

const chosen = (need: Need, option: string) =>
  answerNeed({ id: need.id, key: `answer-${need.id}`, answer: ChosenAnswer.make({ option }) })

const journalOf = (missionId: string) =>
  Effect.gen(function* () {
    const memory = yield* Memory
    yield* memory.catchUp
    return (yield* memory.journal(missionId, null)).lines.map((line) => line.text)
  })

/** The steps a Ship's progress went through, each once, in order. */
const stepsOf = (progress: ReadonlyArray<ShipProgress>) =>
  progress.map((one) => one.step).filter((step, at, all) => all[at - 1] !== step)

/** The preparation on a click: Review asks before it pushes or opens a pull request. */
const CLICK_STACK: ReadonlyArray<DeliveryAction> = [
  { id: 'commit', kind: 'commit-by-hemera', mode: 'auto' },
  { id: 'push', kind: 'push', mode: 'click' },
  { id: 'pull-request', kind: 'pull-request', mode: 'click' },
]

describe('Ship pushes the frozen trees', () => {
  test(
    'a Ship with two repositories pushes both frozen trees once, to the pull requests Review opened, as its last step',
    async () => {
      const world = shipWorld()
      const { run } = engineOf(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            recordPushes(world)
            yield* changedInBoth(mission)
            const watching = yield* Effect.forkChild(
              Ship.use((ship) =>
                Stream.runCollect(
                  Stream.takeUntil(
                    ship.progress(mission.missionId),
                    (one) => one.step === 'shipped',
                  ),
                ),
              ),
            )
            const shipped = yield* shipNow(mission.missionId)
            // Read as Ship returns: its push has ended by then.
            const pushes = yield* pushesOf(mission.missionId)
            return {
              mission,
              shipped,
              pushes,
              progress: yield* Fiber.join(watching),
              stage: (yield* getMission(mission.missionId)).stage,
              lines: yield* journalOf(mission.missionId),
            }
          }),
        ),
      )
      const { mission, shipped } = seen
      expect(seen.stage).toBe('shipping')
      expect(seen.pushes.repositories.map((one) => [one.repository, one.state])).toEqual([
        ['api', 'done'],
        ['web', 'done'],
      ])
      for (const name of ['api', 'web'] as const) {
        const frozen = shipped.trees.find((one) => one.repository === name)?.tree
        expect(pushesTo(world, name, mission.branch)).toBe(1)
        expect(remoteTree(world, name, mission.branch)).toBe(frozen)
        expect(git(bareOf(world, name), 'rev-parse', `refs/heads/${mission.branch}`)).toBe(
          git(mission[name], 'rev-parse', 'HEAD'),
        )
        expect(seen.lines.some((line) => line.startsWith(`Hemera pushed ${name} at `))).toBe(true)
      }
      // The same pull requests: none opened again.
      expect(world.pullRequests()).toHaveLength(2)
      expect(stepsOf(seen.progress).slice(-3)).toEqual(['freezing', 'pushing', 'shipped'])
    },
    SLOW,
  )

  test(
    'Ship opens the pull requests the rules ask for, without asking again: Ship is the click',
    async () => {
      const world = shipWorld()
      const { run } = engineOf(world)
      const clicked = rulesWith((draft) => ({
        ...draft,
        preparation: {
          ...draft.preparation,
          presets: { ...draft.preparation.presets, application: CLICK_STACK },
        },
      }))
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world, clicked, false)
            // Review asked; "Not now" left both repositories unpushed.
            yield* chosen(yield* needOf(mission.missionId, 'Decision'), 'Not now')
            yield* pushedIn(mission.missionId, 'api', 'declined')
            yield* pushedIn(mission.missionId, 'web', 'declined')
            recordPushes(world)
            const shipped = yield* shipNow(mission.missionId)
            return {
              mission,
              shipped,
              pushes: yield* pushesOf(mission.missionId),
              asked: yield* pendingOf(mission.missionId, 'Decision'),
            }
          }),
        ),
      )
      const { mission, shipped } = seen
      expect(seen.asked).toEqual([])
      for (const name of ['api', 'web'] as const) {
        const frozen = shipped.trees.find((one) => one.repository === name)?.tree
        expect(pushesTo(world, name, mission.branch)).toBe(1)
        expect(remoteTree(world, name, mission.branch)).toBe(frozen)
        const push = seen.pushes.repositories.find((one) => one.repository === name)
        expect(push?.state).toBe('done')
        expect(push?.pullRequest?.number).toBeGreaterThan(0)
      }
      expect(
        world
          .pullRequests()
          .map((one) => one.repo)
          .toSorted(),
      ).toEqual(['acme/api', 'acme/web'])
    },
    SLOW,
  )

  test(
    'a restart between the freeze and the push pushes at the start, once',
    async () => {
      const world = shipWorld()
      const stopped = stopAt('pushing')
      const first = engineOf(world, { ship: stopped.hold })
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            recordPushes(world)
            yield* changedInBoth(mission)
            yield* Effect.forkDetach(Effect.result(shipNow(mission.missionId)))
            yield* stopped.reached
            return {
              mission,
              stage: (yield* getMission(mission.missionId)).stage,
              pushed: ['api', 'web'].map((name) => pushesTo(world, name, mission.branch)),
            }
          }),
        ),
      )
      // Frozen and in Shipping, nothing pushed yet.
      expect(left.stage).toBe('shipping')
      expect(left.pushed).toEqual([0, 0])
      const { mission } = left
      const second = engineOf(world)
      await second.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* pushedIn(mission.missionId, 'api', 'done')
            yield* pushedIn(mission.missionId, 'web', 'done')
          }),
        ),
      )
      for (const name of ['api', 'web'] as const) {
        expect(pushesTo(world, name, mission.branch)).toBe(1)
        expect(git(bareOf(world, name), 'rev-parse', `refs/heads/${mission.branch}`)).toBe(
          git(mission[name], 'rev-parse', 'HEAD'),
        )
      }
      expect(world.pullRequests()).toHaveLength(2)
    },
    SLOW,
  )

  test(
    'a push refused by the remote raises the push’s need, the mission stays in Shipping, and the need outlives a restart',
    async () => {
      const world = shipWorld()
      const { run } = engineOf(world)
      const remote = { accept: () => {} }
      const ran = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            recordPushes(world)
            remote.accept = refusing(world, 'api').accept
            yield* changedInBoth(mission)
            const shipped = yield* shipNow(mission.missionId)
            return {
              mission,
              shipped,
              stage: (yield* getMission(mission.missionId)).stage,
              pushes: yield* pushesOf(mission.missionId),
              need: yield* needOf(mission.missionId, 'Error'),
            }
          }),
        ),
      )
      expect(ran.stage).toBe('shipping')
      expect(ran.pushes.repositories.map((one) => [one.repository, one.state])).toEqual([
        ['api', 'failed'],
        ['web', 'done'],
      ])
      // An error need (`needOf` waited for that kind), with Git's own words.
      expect(ran.need.fields).toMatchObject({ failed: 'The push of api failed.' })
      expect(JSON.stringify(ran.need.fields)).toContain('the remote refuses this push')
      expect(pushesTo(world, 'api', ran.mission.branch)).toBe(0)
      expect(pushesTo(world, 'web', ran.mission.branch)).toBe(1)
      // Started again: what the stop left is caught up, and the push's need is still the user's.
      const caughtUp = Effect.runSync(Deferred.make<void>())
      const again = engineOf(world, {
        delivery: (at) =>
          at === 'caught-up' ? Deferred.succeed(caughtUp, undefined) : Effect.void,
      })
      const after = await again.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* Deferred.await(caughtUp)
            const still = yield* pendingOf(ran.mission.missionId, 'Error')
            remote.accept()
            yield* chosen(ran.need, 'Retry')
            yield* pushedIn(ran.mission.missionId, 'api', 'done')
            return {
              still: still.map((one) => one.id),
              stage: (yield* getMission(ran.mission.missionId)).stage,
            }
          }),
        ),
      )
      expect(after.still).toEqual([ran.need.id])
      expect(after.stage).toBe('shipping')
      expect(pushesTo(world, 'api', ran.mission.branch)).toBe(1)
      expect(remoteTree(world, 'api', ran.mission.branch)).toBe(
        ran.shipped.trees.find((one) => one.repository === 'api')?.tree,
      )
    },
    SLOW,
  )

  test(
    'two presses still ship and push once, and a repository with nothing new is not pushed',
    async () => {
      const world = shipWorld()
      const { run } = engineOf(world)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* shipReady(world)
            recordPushes(world)
            // Only api changed since Review's push: web has nothing new to push.
            writeFileSync(join(mission.api, 'invoices.ts'), 'export const invoices = [1]\n')
            yield* OutsideChanges.use((outside) => outside.compare(mission.missionId, null))
            yield* until(
              Effect.map(
                Effect.all([preview(mission.missionId), preview(mission.missionId)]),
                ([one, two]) => one.previewId === two.previewId,
              ),
              LONG,
            )
            const shown = yield* preview(mission.missionId)
            const outcomes = yield* Effect.all(
              [
                Effect.result(confirm(mission.missionId, shown.previewId)),
                Effect.result(confirm(mission.missionId, shown.previewId)),
              ],
              { concurrency: 'unbounded' },
            )
            return { mission, outcomes }
          }),
        ),
      )
      expect(seen.outcomes.filter(Result.isSuccess)).toHaveLength(1)
      expect(pushesTo(world, 'api', seen.mission.branch)).toBe(1)
      expect(pushesTo(world, 'web', seen.mission.branch)).toBe(0)
      expect(world.pullRequests()).toHaveLength(2)
    },
    SLOW,
  )
})
