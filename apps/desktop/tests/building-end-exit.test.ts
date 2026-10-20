/**
 * The end of a Building (#147): once every task is done, one sequence runs the documenter, the
 * final checks, a checkpoint of the result, the two reviewers (one pass each, read-only, on the
 * checkpoint), the special tasks born from their findings, the documenter's delta and the proofs
 * made fresh again, then moves the mission to Review on its own.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent and the test driving the
 * Builder's, the documenter's and both reviewers' tools through their grants; Acme's real
 * repositories in temporary folders as the Workspace. The cold read reads, the Builder answers
 * every prompt and does nothing else; every agent after them holds its turn open until the test
 * lets it go, once it reported. The checks are a fake `TaskChecks`: none unless a test says.
 *
 * This file: the exit, and a pass or a step of the end that fails.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PermissionAnswer, SESSION_STATES } from '@hemera/core/domain'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { LaunchFailed } from '@hemera/ipc'
import { Deferred, Effect, Fiber, Layer, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { STOPPED_AT_THE_END, helperRowsOf } from '../src/engine/building/helper-store.ts'
import { autoReviewOf } from '../src/engine/building/review-store.ts'
import { attemptsIn } from '../src/engine/building/tasks.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed } from '../src/engine/needs.ts'
import { Runs, getRun } from '../src/engine/runs.ts'
import { TaskStates } from '../src/engine/permissions/requests.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import {
  getSession,
  openSession,
  sessionsIn,
  sessionsOfLineage,
} from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildings,
  permissionRequests,
  documenterPasses,
  needDeliveries,
  needs,
  proofRuns,
  runnerLeases,
} from '../src/engine/storage/schema.ts'
import { call, eventsOf, grantOf, says } from './building-world.ts'
import { PLAN, builderOf, buildingNow, launched } from './builder-world.ts'
import { held, text, until, within } from './sessions-world.ts'
import { ALLOW, callTool } from './tools-world.ts'
import { ToolAccess } from '../src/engine/tools/access.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { type Verdict, Verdicts, WriteAttribution } from '../src/engine/tools/ports.ts'
import { removeFolders } from './storage.ts'
import {
  data,
  work,
  LONG,
  SLOW,
  ending,
  withReadme,
  builtAll,
  agentOf,
  documented,
  reviewed,
  warning,
  specialDone,
  helperNumbered,
  inReview,
  specialAvailable,
  writtenInWorkspace,
  apiOf,
  proofState,
  exportProof,
  retried,
  newFolders,
} from './end-world.ts'

beforeEach(() => newFolders('building-end'))
afterEach(removeFolders)

describe('The exit', () => {
  test(
    'once the Building ended, a call the user allows runs again for a session born after the exit, never for its tree',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            // What Hemera does on a call the user allowed, as Review's own session would ask it.
            const allowed = (lineage: string) =>
              ToolAccess.use((access) =>
                access.counted({ missionId: mission.id, lineage }, Effect.succeed('ran')),
              )
            return {
              born: yield* allowed(crypto.randomUUID()),
              builder: yield* allowed(builder.session.lineage),
            }
          }),
        ),
      )
      expect(seen.born).toBe('ran')
      expect(seen.builder).toBeNull()
    },
  )
  test(
    'a write that lands after the last checks, as the end exits, is checked before Review',
    SLOW,
    async () => {
      let late: (() => void) | null = null
      const { world, run } = ending({
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            // The write lands as the exit looks at the Workspace, after every check of the end.
            if (owner.kind === 'review_exit' && late !== null) {
              late()
              late = null
            }
            return real.take(place, owner)
          },
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              exportProof,
            )
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            late = () => writtenInWorkspace(api, 'src/late.ts', 'export const late = true\n')
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            const database = yield* Database
            return {
              late,
              runs: yield* database
                .select()
                .from(proofRuns)
                .where(and(eq(proofRuns.missionId, mission.id), eq(proofRuns.scenario, 'R1.S2')))
                .orderBy(asc(proofRuns.at)),
              view: yield* buildingNow(mission.id),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.late).toBeNull()
      // The proof the late write made stale ran again on its tree before the move to Review.
      expect(seen.runs.map((one) => one.phase)).toContain('rerun')
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
      expect(seen.review?.changedAfter.map((one) => one.path)).toContain('src/late.ts')
    },
  )
  test(
    'a Builder the exit sends back after a late write is handed what was queued for it before the exit',
    SLOW,
    async () => {
      let late: (() => void) | null = null
      let holding = false
      const turn = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => (holding ? turn.promise : Promise.resolve()),
        },
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind === 'review_exit' && late !== null) {
              late()
              late = null
            }
            return real.take(place, owner)
          },
        }),
      })
      const QUEUED = 'ACME-12 is to be named in the changelog.'
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              exportProof,
            )
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            late = () => writtenInWorkspace(api, 'src/late.ts', 'export const late = true\n')
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            // The Builder is in a turn that does not end: what is delivered to it now waits.
            holding = true
            const owner = { kind: 'mission', missionId: mission.id } as const
            const target = { lineage: builder.session.lineage }
            yield* Sessions.use((sessions) =>
              sessions.deliver({ owner, target, kind: 'note', body: 'One more thing.' }),
            )
            yield* until(
              Effect.map(getSession(builder.session.id), (one) => one.state === 'working'),
              LONG,
            )
            yield* Sessions.use((sessions) =>
              sessions.deliver({ owner, target, kind: 'note', body: QUEUED }),
            )
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return {
              late,
              handed: world.agents
                .slice(2)
                .some((agent) => agent.answers.prompts.some((one) => text(one).includes(QUEUED))),
              lineage: yield* sessionsOfLineage(builder.session.lineage),
            }
          }),
        ),
      ).finally(() => turn.release())
      expect(seen.late).toBeNull()
      // The exit went back once: the Builder's lineage was resumed, and its successor had it.
      expect(seen.lineage.length).toBeGreaterThan(1)
      expect(seen.handed).toBe(true)
    },
  )
  test(
    'a helper and a command still running at the exit are stopped before the snapshot: nothing they do after it lands',
    SLOW,
    async () => {
      // What the helper and the command do once the exit looked at the Workspace.
      let afterSnapshot: Effect.Effect<void> | null = null
      const { world, run } = ending({
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real.take(place, owner).pipe(
              Effect.tap(() => {
                if (owner.kind !== 'review_exit') return Effect.void
                const after = afterSnapshot
                afterSnapshot = null
                return after ?? Effect.void
              }),
            ),
        }),
      })
      const trigger = join(work, 'trigger')
      const script = join(work, 'late-command.mjs')
      writeFileSync(
        script,
        [
          "import { existsSync, writeFileSync } from 'node:fs'",
          'const [trigger, target] = process.argv.slice(2)',
          'const wait = setInterval(() => {',
          '  if (!existsSync(trigger)) return',
          "  writeFileSync(target, 'export const command = true\\n')",
          '  clearInterval(wait)',
          '}, 20)',
          '',
        ].join('\n'),
      )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            const byCommand = join(api, 'command.ts')
            const launch = yield* call(builder.grantId, 'helper_launch', {
              brief: 'Tidy the export.',
              writes: true,
            })
            if (launch.startsWith('refused')) return yield* Effect.die(new Error(launch))
            const helper = yield* helperNumbered(mission.id, 1)
            const context = yield* Effect.context<EngineServices>()
            const writing = yield* Deferred.make<string>()
            afterSnapshot = Effect.gen(function* () {
              writeFileSync(trigger, '')
              // Long enough for a command still running to write, and end: it holds the write lock.
              yield* until(
                Effect.sync(() => existsSync(byCommand)),
                3_000,
              ).pipe(Effect.exit)
              // Its own fiber: a write waits for the exit it lands after.
              yield* call(helper.grantId, 'fs_write', {
                repository: 'api',
                path: 'helper.ts',
                content: 'export const helper = true\n',
              }).pipe(
                Effect.flatMap((answer) => Deferred.succeed(writing, answer)),
                Effect.forkDetach,
              )
            }).pipe(Effect.provide(context))
            yield* builtAll(builder.grantId)
            // Started once its tasks are done: a command running holds the Workspace's write lock.
            const started = yield* call(builder.grantId, 'commands_run', {
              line: `"${process.execPath}" "${script}" "${trigger}" "${byCommand}"`,
              repository: 'api',
              timeout: 1,
            })
            const runId = /^run (\S+):/.exec(started)?.[1] ?? ''
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            const failed = Effect.map(helperRowsOf(mission.id), (rows) =>
              rows.find((one) => one.number === 1),
            )
            // Not a failure here: the expectations below say what was left instead.
            yield* until(
              Effect.map(failed, (row) => row?.state === 'failed'),
              LONG,
            ).pipe(Effect.exit)
            const database = yield* Database
            return {
              started,
              written: yield* Deferred.await(writing),
              helperWrote: existsSync(join(api, 'helper.ts')),
              commandWrote: existsSync(byCommand),
              run: yield* getRun(runId),
              helper: yield* failed,
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: mission.id,
              }),
              leases: (yield* database.select().from(runnerLeases)).filter(
                (one) => one.lineage === helper.row.lineage,
              ),
              needs: (yield* getMission(mission.id)).needs,
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      // Both still ran when the exit came.
      expect(seen.started).toContain('it keeps going')
      // The helper's write after the snapshot is refused, and the command was stopped before it.
      expect(seen.written).toBe('refused: this session has ended')
      expect(seen.helperWrote).toBe(false)
      expect(seen.commandWrote).toBe(false)
      expect(seen.run.state).toBe('stopped')
      // Nothing of the tree is left: no session, no lease, no need; the helper ended, said why.
      expect(seen.live).toEqual([])
      expect(seen.leases).toEqual([])
      expect(seen.needs).toEqual([])
      expect(seen.helper).toMatchObject({ state: 'failed', failure: STOPPED_AT_THE_END })
      expect(seen.review?.changedAfter.map((one) => one.path)).not.toContain('helper.ts')
    },
  )
  test(
    'a write the user allows as the end exits is done before the snapshot and seen, or refused: never after it unseen',
    SLOW,
    async () => {
      const snapshotted = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            Effect.succeed<Verdict>(
              asked.tool === 'fs_write' && asked.path?.named.endsWith('approved.ts') === true
                ? { verdict: 'ask', reason: 'a file no task names', by: 'suite' }
                : ALLOW,
            ),
          // Hemera acts on the allowed call once the exit looked at the Workspace: the latest it can.
          refusal: () => Effect.as(Deferred.await(snapshotted), null),
        }),
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit'
                    ? Deferred.succeed(snapshotted, undefined)
                    : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            yield* builtAll(builder.grantId)
            const asked = yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'approved.ts',
              content: 'export const approved = true\n',
            })
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const database = yield* Database
            const request = Effect.map(
              database
                .select()
                .from(permissionRequests)
                .where(eq(permissionRequests.missionId, mission.id)),
              ([row]) => row,
            )
            // The end holds at its refresh on the question.
            yield* until(
              Effect.gen(function* () {
                const view = yield* buildingNow(mission.id)
                return view.phase === 'refresh' && (yield* getMission(mission.id)).needs.length > 0
              }),
              LONG,
            )
            const row = yield* request
            if (row === undefined) return yield* Effect.die(new Error('no request'))
            yield* answerNeed({
              id: row.needId,
              answer: PermissionAnswer.make({ choice: 'allow-once' }),
              key: crypto.randomUUID(),
            })
            yield* inReview(mission.id)
            yield* until(
              Effect.map(request, (one) => one?.state === 'ended'),
              LONG,
            )
            return {
              asked,
              request: yield* request,
              wrote: existsSync(join(api, 'approved.ts')),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.asked).toContain('request #1')
      // Its session stopped at the exit: the approved write is not done, and says so.
      expect(seen.request).toMatchObject({ state: 'ended', result: 'not-executed' })
      expect(seen.wrote).toBe(false)
      expect(seen.review?.changedAfter.map((one) => one.path)).not.toContain('approved.ts')
    },
  )
  test(
    'a call the user allowed and the end refused tells the agent and the user that the end of the Building stopped it',
    SLOW,
    async () => {
      const snapshotted = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            Effect.succeed<Verdict>(
              asked.tool === 'fs_write' && asked.path?.named.endsWith('approved.ts') === true
                ? { verdict: 'ask', reason: 'a file no task names', by: 'suite' }
                : ALLOW,
            ),
          // Hemera acts on the allowed call once the exit looked at the Workspace: the latest it can.
          refusal: () => Effect.as(Deferred.await(snapshotted), null),
        }),
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit'
                    ? Deferred.succeed(snapshotted, undefined)
                    : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'approved.ts',
              content: 'export const approved = true\n',
            })
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const database = yield* Database
            const request = Effect.map(
              database
                .select()
                .from(permissionRequests)
                .where(eq(permissionRequests.missionId, mission.id)),
              ([row]) => row,
            )
            // The end holds at its refresh on the question.
            yield* until(
              Effect.gen(function* () {
                const view = yield* buildingNow(mission.id)
                return view.phase === 'refresh' && (yield* getMission(mission.id)).needs.length > 0
              }),
              LONG,
            )
            const row = yield* request
            if (row === undefined) return yield* Effect.die(new Error('no request'))
            yield* answerNeed({
              id: row.needId,
              answer: PermissionAnswer.make({ choice: 'allow-once' }),
              key: crypto.randomUUID(),
            })
            yield* inReview(mission.id)
            yield* until(
              Effect.map(request, (one) => one?.state === 'ended'),
              LONG,
            )
            const [need] = yield* database.select().from(needs).where(eq(needs.id, row.needId))
            return { request: yield* request, need }
          }),
        ),
      )
      expect(seen.request).toMatchObject({ state: 'ended', result: 'not-executed' })
      expect(seen.request?.resultText).toBe(
        `Request #1 (fs_write) was not executed: ${STOPPED_AT_THE_END}.`,
      )
      expect(seen.need).toMatchObject({ state: 'expired', endedReason: STOPPED_AT_THE_END })
    },
  )
  test(
    'a helper’s write the user allows after the helper ended, as the end exits, is refused or seen: never after the snapshot unseen',
    SLOW,
    async () => {
      const snapshotted = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            Effect.succeed<Verdict>(
              asked.tool === 'fs_write' && asked.path?.named.endsWith('approved.ts') === true
                ? { verdict: 'ask', reason: 'a file no task names', by: 'suite' }
                : ALLOW,
            ),
          // Hemera acts on the allowed call once the exit looked at the Workspace: the latest it can.
          refusal: () => Effect.as(Deferred.await(snapshotted), null),
        }),
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit'
                    ? Deferred.succeed(snapshotted, undefined)
                    : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            const launch = yield* call(builder.grantId, 'helper_launch', {
              brief: 'Tidy the export.',
              writes: true,
            })
            if (launch.startsWith('refused')) return yield* Effect.die(new Error(launch))
            const helper = yield* helperNumbered(mission.id, 1)
            // The helper's agent is the last one started.
            const helperAgent = world.agents.length - 1
            const asked = yield* call(helper.grantId, 'fs_write', {
              repository: 'api',
              path: 'approved.ts',
              content: 'export const approved = true\n',
            })
            // The helper hands back its result: its lineage ends on its own, before the end.
            const handed = yield* call(helper.grantId, 'helper_result', {
              summary: 'The export is tidied.',
              changed: [],
              checked: ['Read the export by hand.'],
              left: [],
            })
            if (!handed.includes('handed to your parent'))
              return yield* Effect.die(new Error(handed))
            // Its turn ends, and with it the helper's session.
            world.release(helperAgent)
            yield* until(
              Effect.map(sessionsOfLineage(helper.row.lineage), (all) =>
                all.every((one) => one.state === 'ended'),
              ),
              LONG,
            )
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const database = yield* Database
            const request = Effect.map(
              database
                .select()
                .from(permissionRequests)
                .where(eq(permissionRequests.missionId, mission.id)),
              ([row]) => row,
            )
            // The end holds at its refresh on the question.
            yield* until(
              Effect.gen(function* () {
                const view = yield* buildingNow(mission.id)
                return view.phase === 'refresh' && (yield* getMission(mission.id)).needs.length > 0
              }),
              LONG,
            )
            const row = yield* request
            if (row === undefined) return yield* Effect.die(new Error('no request'))
            yield* answerNeed({
              id: row.needId,
              answer: PermissionAnswer.make({ choice: 'allow-once' }),
              key: crypto.randomUUID(),
            })
            yield* inReview(mission.id)
            yield* until(
              Effect.map(request, (one) => one?.state === 'ended'),
              LONG,
            )
            const review = yield* autoReviewOf(mission.id)
            return {
              asked,
              request: yield* request,
              wrote: existsSync(join(api, 'approved.ts')),
              seen: review?.changedAfter.map((one) => one.path) ?? [],
            }
          }),
        ),
      )
      expect(seen.asked).toContain('request #1')
      // Hemera acts on it after the snapshot: the exit's mark refuses it, so nothing lands unseen.
      expect(seen.request).toMatchObject({ state: 'ended', result: 'not-executed' })
      expect(seen.wrote).toBe(false)
      expect(seen.seen).not.toContain('approved.ts')
    },
  )
  test(
    'a write the user allows, acting as the tree stops, is waited for: the snapshot sees it',
    SLOW,
    async () => {
      const acting = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            Effect.succeed<Verdict>(
              asked.tool === 'fs_write' &&
                ['approved.ts', 'denied.ts'].some((name) => asked.path?.named.endsWith(name))
                ? { verdict: 'ask', reason: 'a file no task names', by: 'suite' }
                : ALLOW,
            ),
          refusal: () => Effect.succeed(null),
        }),
        // Hemera's last check of the allowed call holds it, its session read live, until let go.
        taskStates: Layer.succeed(TaskStates, {
          holds: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(acting, undefined)
              yield* Deferred.await(release)
              return true
            }),
        }),
        // An exit that does not wait looks at the Workspace first, and only then lets it go.
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit' ? Deferred.succeed(release, undefined) : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            yield* builtAll(builder.grantId)
            for (const path of ['approved.ts', 'denied.ts']) {
              yield* call(builder.grantId, 'fs_write', {
                repository: 'api',
                path,
                content: 'export const asked = true\n',
              })
            }
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const database = yield* Database
            const requests = database
              .select()
              .from(permissionRequests)
              .where(eq(permissionRequests.missionId, mission.id))
              .orderBy(asc(permissionRequests.number))
            // The end holds at its refresh on both questions.
            yield* until(
              Effect.gen(function* () {
                const view = yield* buildingNow(mission.id)
                return view.phase === 'refresh' && (yield* getMission(mission.id)).needs.length > 1
              }),
              LONG,
            )
            const [approved, denied] = yield* requests
            if (approved === undefined || denied === undefined) {
              return yield* Effect.die(new Error('no requests'))
            }
            const answer = (needId: string, choice: 'allow-once' | 'deny') =>
              answerNeed({
                id: needId,
                answer: PermissionAnswer.make({ choice }),
                key: crypto.randomUUID(),
              })
            yield* answer(approved.needId, 'allow-once')
            // Allowed while the Builder still runs: the second question holds the end meanwhile.
            yield* Deferred.await(acting)
            // Let go a second after the Builder stopped: long after an exit that did not wait.
            yield* Effect.gen(function* () {
              yield* until(
                Effect.map(getSession(builder.session.id), (session) => session.state === 'ended'),
                LONG,
              )
              yield* Effect.sleep('1 second')
              yield* Deferred.succeed(release, undefined)
            }).pipe(Effect.forkDetach)
            yield* answer(denied.needId, 'deny')
            yield* inReview(mission.id)
            yield* until(
              Effect.map(requests, ([one]) => one?.state === 'ended'),
              LONG,
            )
            return {
              request: (yield* requests)[0],
              wrote: existsSync(join(api, 'approved.ts')),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.request).toMatchObject({ state: 'ended', result: 'done' })
      expect(seen.wrote).toBe(true)
      expect(seen.review?.changedAfter.map((one) => one.path)).toContain('approved.ts')
    },
  )
  test(
    'a write still executing as the tree stops is waited for: the snapshot sees what it wrote',
    SLOW,
    async () => {
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        // The write to held.ts executes until the test lets it go.
        attribution: Layer.succeed(WriteAttribution, {
          written: () => () => Effect.void,
          command: () => Effect.succeed(null),
          holding: (file, write) =>
            Effect.gen(function* () {
              if (file.path.endsWith('held.ts')) {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
              }
              return { result: yield* write, waited: null }
            }),
        }),
        // An exit that does not wait looks at the Workspace first, and only then lets it go.
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            real
              .take(place, owner)
              .pipe(
                Effect.tap(() =>
                  owner.kind === 'review_exit' ? Deferred.succeed(release, undefined) : Effect.void,
                ),
              ),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            yield* builtAll(builder.grantId)
            const writing = yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'held.ts',
              content: 'export const held = true\n',
            }).pipe(Effect.forkDetach)
            yield* Deferred.await(entered)
            // Let go a second after the Builder stopped: long after an exit that did not wait.
            yield* Effect.gen(function* () {
              yield* until(
                Effect.map(getSession(builder.session.id), (session) => session.state === 'ended'),
                LONG,
              )
              yield* Effect.sleep('1 second')
              yield* Deferred.succeed(release, undefined)
            }).pipe(Effect.forkDetach)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return {
              written: yield* Fiber.join(writing),
              wrote: existsSync(join(api, 'held.ts')),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.written).not.toContain('refused')
      expect(seen.wrote).toBe(true)
      expect(seen.review?.changedAfter.map((one) => one.path)).toContain('held.ts')
    },
  )
  test(
    'a question raised as the tree stops holds the exit with the Builder back, to take its answer',
    SLOW,
    async () => {
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const asking = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        // The write to held.ts executes until the test lets it go: the exit settles on it.
        attribution: Layer.succeed(WriteAttribution, {
          written: () => () => Effect.void,
          command: () => Effect.succeed(null),
          holding: (file, write) =>
            Effect.gen(function* () {
              if (file.path.endsWith('held.ts')) {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
              }
              return { result: yield* write, waited: null }
            }),
        }),
        // The write to question.ts becomes a question once the tree stopped.
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            asked.tool === 'fs_write' && asked.path?.named.endsWith('question.ts') === true
              ? Effect.as(Deferred.await(asking), {
                  verdict: 'ask',
                  reason: 'a file no task names',
                  by: 'suite',
                } satisfies Verdict)
              : Effect.succeed<Verdict>(ALLOW),
          refusal: () => Effect.succeed(null),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const owner = { kind: 'mission', missionId: mission.id } as const
            yield* builtAll(builder.grantId)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'held.ts',
              content: 'export const held = true\n',
            }).pipe(Effect.forkDetach)
            yield* Deferred.await(entered)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'question.ts',
              content: 'export const question = true\n',
            }).pipe(Effect.forkDetach)
            // Once the Builder stopped, its call asks; once asked, the exit's settle ends.
            yield* Effect.gen(function* () {
              yield* until(
                Effect.map(getSession(builder.session.id), (session) => session.state === 'ended'),
                LONG,
              )
              yield* Deferred.succeed(asking, undefined)
              yield* until(
                Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
                LONG,
              )
              yield* Deferred.succeed(release, undefined)
            }).pipe(Effect.forkDetach)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* Deferred.await(release)
            // The exit holds on the question, and the Builder works again meanwhile.
            const liveBuilder = Effect.map(
              sessionsIn(['starting', 'working', 'idle'], owner),
              (rows) => rows.filter((row) => row.role === 'builder'),
            )
            yield* until(
              Effect.map(liveBuilder, (rows) => rows.length > 0),
              LONG,
            )
            const holding = yield* buildingNow(mission.id)
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: need.id,
              answer: PermissionAnswer.make({ choice: 'allow-once' }),
              key: crypto.randomUUID(),
            })
            yield* inReview(mission.id)
            return {
              phase: holding.phase,
              builders: yield* liveBuilder,
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], owner),
            }
          }),
        ),
      )
      expect(seen.phase).toBe('refresh')
      // The exit that follows the answer stops it again: nothing of the tree runs in Review.
      expect(seen.live).toEqual([])
    },
  )

  test(
    'a question raised as the tree stops, answered with its hand-over failing, holds the exit after the stops: the end says it, and its Retry hands it over',
    SLOW,
    async () => {
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const asking = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        attribution: Layer.succeed(WriteAttribution, {
          written: () => () => Effect.void,
          command: () => Effect.succeed(null),
          holding: (file, write) =>
            Effect.gen(function* () {
              if (file.path.endsWith('held.ts')) {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
              }
              return { result: yield* write, waited: null }
            }),
        }),
        verdicts: Layer.succeed(Verdicts, {
          judge: (asked) =>
            asked.tool === 'fs_write' && asked.path?.named.endsWith('question.ts') === true
              ? Effect.as(Deferred.await(asking), {
                  verdict: 'ask',
                  reason: 'a file no task names',
                  by: 'suite',
                } satisfies Verdict)
              : Effect.succeed<Verdict>(ALLOW),
          refusal: () => Effect.succeed(null),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const database = yield* Database
            yield* builtAll(builder.grantId)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'held.ts',
              content: 'export const held = true\n',
            }).pipe(Effect.forkDetach)
            yield* Deferred.await(entered)
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'question.ts',
              content: 'export const question = true\n',
            }).pipe(Effect.forkDetach)
            // Once the Builder stopped, its call asks: the user answers it while the exit still
            // stops the tree, and every hand-over of an answer fails; then the stops end.
            yield* Effect.gen(function* () {
              yield* until(
                Effect.map(getSession(builder.session.id), (session) => session.state === 'ended'),
                LONG,
              )
              yield* Deferred.succeed(asking, undefined)
              yield* until(
                Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
                LONG,
              )
              const need = (yield* getMission(mission.id)).needs[0]
              if (need === undefined) return yield* Effect.die(new Error('no question'))
              yield* database.run(sql`CREATE TRIGGER refuse_hand_overs BEFORE UPDATE OF delivered_at
                ON need_deliveries BEGIN SELECT RAISE(ABORT, 'refused'); END`)
              yield* answerNeed({
                id: need.id,
                answer: PermissionAnswer.make({ choice: 'allow-once' }),
                key: crypto.randomUUID(),
              })
              yield* Deferred.succeed(release, undefined)
            }).pipe(Effect.forkDetach)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* Deferred.await(release)
            // The exit's check after the stops sees the answer not handed over, and hands it
            // over: that fails, and the end says so rather than close the Building.
            const errors = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
            )
            const state = Effect.map(
              database
                .select({ state: buildings.state })
                .from(buildings)
                .where(eq(buildings.missionId, mission.id)),
              (rows) => rows[0]?.state,
            )
            yield* until(
              Effect.gen(function* () {
                return (yield* state) !== 'active' || (yield* errors).length > 0
              }),
              LONG,
            )
            const holding = { state: yield* state, errors: yield* errors }
            yield* database.run(sql`DROP TRIGGER refuse_hand_overs`)
            if (holding.state !== 'active') return { holding, undelivered: [] }
            yield* retried(mission.id)
            yield* inReview(mission.id)
            const undelivered = yield* database
              .select()
              .from(needDeliveries)
              .where(isNull(needDeliveries.deliveredAt))
            return { holding, undelivered }
          }),
        ),
      )
      expect(seen.holding.state).toBe('active')
      expect(seen.holding.errors).toHaveLength(1)
      const [error] = seen.holding.errors
      if (error !== undefined && Predicate.isTagged(error.fields, 'Error')) {
        expect(error.fields.failed).toContain('A step of the end did not run (refresh)')
      }
      expect(seen.undelivered).toEqual([])
    },
  )
})

describe('A run a call started, as the exit begins', () => {
  test(
    'a proof_run that hangs when the exit begins: the exit does not wait for its limit, and nothing it writes after the snapshot reaches Review unseen',
    SLOW,
    async () => {
      // Once armed, the exit is held as it begins until the test lets it go.
      let arming = false
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        endHold: (at) =>
          at === 'exiting' && arming
            ? Effect.gen(function* () {
                arming = false
                yield* Deferred.succeed(reached, undefined)
                yield* Deferred.await(go)
              })
            : Effect.void,
      })
      // While this file is there, the proof's next run writes into the Workspace and never ends.
      const hang = join(data, 'hang')
      const hanging = [
        "import { test } from 'node:test'",
        "import assert from 'node:assert/strict'",
        "import { appendFileSync, existsSync, rmSync } from 'node:fs'",
        '',
        "test('the scenario holds', async () => {",
        `  if (existsSync(${JSON.stringify(hang)})) {`,
        `    rmSync(${JSON.stringify(hang)})`,
        '    for (;;) {',
        "      appendFileSync(new URL('../late.txt', import.meta.url), 'late\\n')",
        '      await new Promise((resolve) => setTimeout(resolve, 50))',
        '    }',
        '  }',
        "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'no export.ts')",
        '})',
        '',
      ].join('\n')
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              () => ({
                'R1.S2': {
                  ...exportProof()['R1.S2'],
                  test: { ...exportProof()['R1.S2'].test, code: hanging },
                },
              }),
            )
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            arming = true
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* Deferred.await(reached)
            const proofAttempts = Effect.gen(function* () {
              const view = yield* buildingNow(mission.id)
              return (yield* attemptsIn(yield* Database, view.buildingId)).filter(
                (one) => one.scope === 'proof',
              )
            })
            const before = yield* proofAttempts
            // The Builder runs its green proof again as the exit begins; the run hangs, writing.
            writeFileSync(hang, '')
            yield* Effect.forkChild(call(builder.grantId, 'proof_run', { scenario: 'R1.S2' }))
            yield* until(
              Effect.sync(() => existsSync(join(api, 'late.txt'))),
              LONG,
            )
            yield* Deferred.succeed(go, undefined)
            // Far within the proof's limit of ten minutes.
            yield* inReview(mission.id)
            const runs = yield* Runs
            return {
              going: [...runs.live.values()].filter((one) => one.run.missionId === mission.id),
              before,
              after: yield* proofAttempts,
              review: yield* autoReviewOf(mission.id),
              view: yield* buildingNow(mission.id),
            }
          }),
        ),
      )
      // Stopped before the snapshot: nothing of it is still going, nor writes any more.
      expect(seen.going).toEqual([])
      // What it wrote before its stop was seen: in the snapshot, and checked before Review.
      expect(seen.review?.changedAfter.map((one) => one.path)).toContain('late.txt')
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
      // A run the exit stopped is no red of the Builder's.
      expect(seen.after).toEqual(seen.before)
    },
  )
  test(
    'two proof_run calls, the second queued behind the first as the exit begins: the exit reaches Review within the stop grace, and no run of theirs starts after it began',
    SLOW,
    async () => {
      let arming = false
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      // Each proof_run call, as it begins to execute.
      let called = 0
      const { world, run } = ending({
        hold: (at) =>
          Effect.sync(() => {
            if (at === 'proof-called') called += 1
          }),
        endHold: (at) =>
          at === 'exiting' && arming
            ? Effect.gen(function* () {
                arming = false
                yield* Deferred.succeed(reached, undefined)
                yield* Deferred.await(go)
              })
            : Effect.void,
      })
      // While this file is there, every run of the proof notes it started, and never ends.
      const hang = join(data, 'hang')
      const started = join(data, 'started')
      const hanging = [
        "import { test } from 'node:test'",
        "import assert from 'node:assert/strict'",
        "import { appendFileSync, existsSync } from 'node:fs'",
        '',
        "test('the scenario holds', async () => {",
        `  if (existsSync(${JSON.stringify(hang)})) {`,
        `    appendFileSync(${JSON.stringify(started)}, 'started\\n')`,
        '    for (;;) await new Promise((resolve) => setTimeout(resolve, 50))',
        '  }',
        "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'no export.ts')",
        '})',
        '',
      ].join('\n')
      const startedRuns = () =>
        existsSync(started) ? readFileSync(started, 'utf8').trim().split('\n').length : 0
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              () => ({
                'R1.S2': {
                  ...exportProof()['R1.S2'],
                  test: { ...exportProof()['R1.S2'].test, code: hanging },
                },
              }),
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            arming = true
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* Deferred.await(reached)
            writeFileSync(hang, '')
            // The first call's run hangs; the second call executes, queued behind it.
            yield* Effect.forkChild(call(builder.grantId, 'proof_run', { scenario: 'R1.S2' }))
            yield* until(
              Effect.sync(() => startedRuns() === 1),
              LONG,
            )
            yield* Effect.forkChild(call(builder.grantId, 'proof_run', { scenario: 'R1.S2' }))
            yield* until(
              Effect.sync(() => called === 2),
              LONG,
            )
            const released = Date.now()
            yield* Deferred.succeed(go, undefined)
            yield* inReview(mission.id)
            const runs = yield* Runs
            return {
              after: Date.now() - released,
              going: [...runs.live.values()].filter((one) => one.run.missionId === mission.id),
              view: yield* buildingNow(mission.id),
            }
          }),
        ),
      )
      // Within the stop's grace and the calls' own ends, far from the proof's limit.
      expect(seen.after).toBeLessThan(LONG)
      expect(seen.going).toEqual([])
      // Only the first run ever started: the second call's was refused as the exit stood.
      expect(startedRuns()).toBe(1)
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
    },
  )
  test(
    'a session opened while the exit stops the tree, and a proof_run it calls: the exit ends without waiting for the run’s limit',
    SLOW,
    async () => {
      // The second pass of the exit's stops, once its runs are stopped, before its calls are waited
      // for: the test opens a session there, and its call executes, before the pass goes on.
      let settling = 0
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      let called = 0
      const { world, run } = ending({
        hold: (at) =>
          Effect.sync(() => {
            if (at === 'proof-called') called += 1
          }),
        endHold: (at) =>
          at === 'settling'
            ? Effect.gen(function* () {
                settling += 1
                if (settling !== 2) return
                yield* Deferred.succeed(reached, undefined)
                yield* Deferred.await(go)
              })
            : Effect.void,
      })
      // While this file is there, every run of the proof notes it started, and never ends.
      const hang = join(data, 'hang')
      const started = join(data, 'started')
      const hanging = [
        "import { test } from 'node:test'",
        "import assert from 'node:assert/strict'",
        "import { appendFileSync, existsSync } from 'node:fs'",
        '',
        "test('the scenario holds', async () => {",
        `  if (existsSync(${JSON.stringify(hang)})) {`,
        `    appendFileSync(${JSON.stringify(started)}, 'started\\n')`,
        '    for (;;) await new Promise((resolve) => setTimeout(resolve, 50))',
        '  }',
        "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'no export.ts')",
        '})',
        '',
      ].join('\n')
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              () => ({
                'R1.S2': {
                  ...exportProof()['R1.S2'],
                  test: { ...exportProof()['R1.S2'].test, code: hanging },
                },
              }),
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* Deferred.await(reached)
            // Born after the exit read its tree, and after this pass stopped the sessions.
            const helper = yield* openSession({
              provider: 'claude',
              owner: { kind: 'mission', missionId: mission.id },
              role: 'helper',
              folder: builder.session.folder,
              parent: null,
              chosen: { model: null, effort: null, mode: null },
              modelLevel: null,
            })
            const grantId = yield* grantOf(helper.id)
            writeFileSync(hang, '')
            const before = called
            yield* Effect.forkChild(call(grantId, 'proof_run', { scenario: 'R1.S2' }))
            yield* until(
              Effect.sync(() => called > before),
              LONG,
            )
            const released = Date.now()
            yield* Deferred.succeed(go, undefined)
            yield* inReview(mission.id)
            const runs = yield* Runs
            return {
              after: Date.now() - released,
              going: [...runs.live.values()].filter((one) => one.run.missionId === mission.id),
            }
          }),
        ),
      )
      expect(seen.after).toBeLessThan(LONG)
      expect(seen.going).toEqual([])
      // The call the session made while the stops ran started no run.
      expect(existsSync(started)).toBe(false)
    },
  )
})

describe('A pass that fails', () => {
  test(
    'a reviewer that cannot start holds the end on an error need; Retry runs its pass again',
    SLOW,
    async () => {
      // Every agent but those already known when it is set: the reviewers.
      let known: ReadonlySet<string> | null = null
      const { world, run } = ending({
        starting: (sessionId) =>
          known === null || known.has(sessionId)
            ? Effect.void
            : Effect.fail(new LaunchFailed({ reason: 'the agent could not be spawned' })),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* agentOf(world, mission.id, 'documenter')
            known = new Set(
              (yield* sessionsIn(SESSION_STATES, { kind: 'mission', missionId: mission.id })).map(
                (one) => one.id,
              ),
            )
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(
                autoReviewOf(mission.id),
                (review) =>
                  review !== null &&
                  review.passes.length === 2 &&
                  review.passes.every((one) => one.state === 'failed'),
              ),
              LONG,
            )
            // Long enough for anything on its way to move the end on.
            yield* Effect.sleep('1 second')
            const holding = yield* buildingNow(mission.id)
            known = null
            const need = yield* retried(mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return { need, holding, review: yield* autoReviewOf(mission.id) }
          }),
        ),
      )
      expect(seen.holding.phase).toBe('review')
      expect(Predicate.isTagged(seen.need.fields, 'Error')).toBe(true)
      if (Predicate.isTagged(seen.need.fields, 'Error')) {
        expect(seen.need.fields.failed).toContain('the agent could not be spawned')
        expect(seen.need.fields.proposals).toEqual(['Retry'])
      }
      expect(seen.review?.passes.map((one) => one.state).toSorted()).toEqual([
        'done',
        'done',
        'failed',
        'failed',
      ])
    },
  )

  test(
    'a reviewer lineage that stops for good holds the end on an error need; Retry runs a new pass',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            const code = yield* agentOf(world, mission.id, 'code-reviewer')
            yield* Sessions.use((sessions) =>
              sessions.end(code.session.lineage, 'the agent was closed'),
            )
            yield* until(
              Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
              LONG,
            )
            yield* Effect.sleep('1 second')
            const holding = yield* buildingNow(mission.id)
            const need = yield* retried(mission.id)
            const again = yield* agentOf(world, mission.id, 'code-reviewer', 2)
            const answer = yield* callTool(again.grantId, 'review_report', { findings: [] })
            if (!answer.ok) return yield* Effect.die(new Error(answer.text))
            world.release(again.index)
            yield* inReview(mission.id)
            return { need, holding, review: yield* autoReviewOf(mission.id) }
          }),
        ),
      )
      expect(seen.holding.phase).toBe('review')
      if (Predicate.isTagged(seen.need.fields, 'Error')) {
        expect(seen.need.fields.failed).toContain('Code reviewer')
      }
      expect(seen.review?.passes.map((one) => `${one.reviewer} ${one.state}`).toSorted()).toEqual([
        'code-reviewer done',
        'code-reviewer failed',
        'spec-reviewer done',
      ])
    },
  )
})

describe('A step that cannot go on', () => {
  test(
    'a step that throws holds the end on an error need; Retry runs the step again',
    SLOW,
    async () => {
      let failing = false
      const { world, run } = ending({
        snapshots: (real) => ({
          ...real,
          take: (place, owner) =>
            failing && owner.kind === 'checkpoint'
              ? Effect.die(new Error('the disk is full'))
              : real.take(place, owner),
        }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            failing = true
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
              LONG,
            )
            const holding = yield* buildingNow(mission.id)
            failing = false
            const need = yield* retried(mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return { holding, need }
          }),
        ),
      )
      expect(seen.holding.phase).toBe('checkpoint')
      if (Predicate.isTagged(seen.need.fields, 'Error')) {
        expect(seen.need.fields.failed).toContain('the disk is full')
        expect(seen.need.fields.proposals).toEqual(['Retry'])
      }
    },
  )

  test(
    'a documenter’s delta refused before its pass runs holds the end on an error need, once',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            writtenInWorkspace(api, 'src/x.ts', 'export const x = 1\n')
            yield* builtAll(builder.grantId)
            const first = yield* documented(world, mission.id)
            // A second pass already spent: the delta the special task asks for is refused.
            const database = yield* Database
            const view = yield* buildingNow(mission.id)
            yield* until(
              Effect.map(
                database.select().from(documenterPasses),
                (rows) => rows[0]?.endedAt !== null && rows.length === 1,
              ),
              LONG,
            )
            yield* database.insert(documenterPasses).values({
              id: crypto.randomUUID(),
              buildingId: view.buildingId,
              missionId: mission.id,
              number: 2,
              mode: 'full',
              files: '[]',
              state: 'reported',
              lineage: crypto.randomUUID(),
              attemptId: crypto.randomUUID(),
              noChangeReason: null,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
            })
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('src/x.ts', 'Fix src/x.ts.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            yield* specialDone(builder.grantId, 'RV1', 'src/x.ts', 'export const x = 2\n')
            yield* until(
              Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
              LONG,
            )
            // Long enough for a loop to write its events again.
            yield* Effect.sleep('1 second')
            return {
              first,
              mission: yield* getMission(mission.id),
              view: yield* buildingNow(mission.id),
              deltas: yield* eventsOf(mission.id, 'building.documenter_delta'),
            }
          }),
        ),
      )
      expect(seen.view.phase).toBe('documenter_delta')
      expect(seen.deltas).toHaveLength(1)
      const [need] = seen.mission.needs
      expect(Predicate.isTagged(need?.fields, 'Error')).toBe(true)
      if (Predicate.isTagged(need?.fields, 'Error')) {
        expect(need.fields.failed).toContain('the documenter already ran twice')
      }
    },
  )
})
