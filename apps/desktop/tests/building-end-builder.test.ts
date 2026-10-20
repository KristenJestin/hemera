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
 * This file: the Builder while the end waits on it.
 */

import { ChosenAnswer, WrittenAnswer } from '@hemera/core/domain'
import { and, eq, sql } from 'drizzle-orm'
import { LaunchFailed } from '@hemera/ipc'
import { Deferred, Effect, Fiber, Predicate, Semaphore } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import type { FakeStep } from '../src/engine/agents/fake.ts'
import type { BuilderHold } from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { buildingEvent } from '../src/engine/building/tasks.ts'
import { getMission } from '../src/engine/missions.ts'
import { NeedOwners, answerNeed, getNeed, retryNeed } from '../src/engine/needs.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { getSession, sessionsIn, sessionsOfLineage } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { mutate } from '../src/engine/transaction.ts'
import {
  agentSessions,
  buildings,
  needDeliveries,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { call, says } from './building-world.ts'
import { builderOf, buildingNow, launched } from './builder-world.ts'
import { held, text, until, within } from './sessions-world.ts'
import { ToolAccess } from '../src/engine/tools/access.ts'
import { removeFolders } from './storage.ts'
import {
  work,
  LONG,
  SLOW,
  type ChecksOf,
  RED,
  ending,
  withReadme,
  builtAll,
  agentOf,
  documented,
  reviewed,
  warning,
  inReview,
  specialAvailable,
  endAttempts,
  retried,
  newFolders,
} from './end-world.ts'

beforeEach(() => newFolders('building-end'))
afterEach(removeFolders)

describe('A Builder stopped at a provider limit', () => {
  test(
    'a Builder stopped at a provider limit is not resumed while the end waits at refresh: the limit need is left to the user',
    SLOW,
    async () => {
      let limiting = false
      const limit: FakeStep = { does: 'limits', title: 'The Acme account has no available quota.' }
      const { world, run } = ending({
        builder: {
          get steps() {
            return limiting ? [limit] : [says('Read.')]
          },
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            // The Builder's next turn meets the provider's limit: its session ends, the user is asked.
            limiting = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            const limitNeeds = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter(
                (need) =>
                  Predicate.isTagged(need.fields, 'Environment') &&
                  need.fields.missing.includes('provider limit'),
              ),
            )
            yield* until(
              Effect.map(limitNeeds, (found) => found.length === 1),
              LONG,
            )
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            // The end waits at its last step on the user's answer.
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            // Mission events, as a proof run or a need brings them: each drives the end again.
            for (let count = 0; count < 3; count += 1) {
              yield* mutate('driving the end', () =>
                Effect.succeed({
                  result: undefined,
                  events: [buildingEvent(mission.id, 'building.resumed')],
                }),
              )
              yield* Effect.sleep('200 millis')
            }
            // Long enough for a resume to show itself.
            yield* Effect.sleep('1 second')
            return {
              lineage: yield* sessionsOfLineage(builder.session.lineage),
              needs: yield* limitNeeds,
              view: yield* buildingNow(mission.id),
            }
          }),
        ),
      )
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended'])
      expect(seen.needs).toHaveLength(1)
      expect(seen.view.phase).toBe('refresh')
    },
  )
})

describe('The Builder while the end waits on it', () => {
  test(
    'a red of the final checks delivered while a Builder turn runs is judged again only after a turn that started once it was delivered',
    SLOW,
    async () => {
      // Once armed, each turn of the Builder holds until the test lets it go.
      let holding = false
      const turns: Array<ReturnType<typeof held>> = []
      const { world, run } = ending({
        checks: ({ scope }) => (scope === 'end' ? [RED] : []),
        builder: {
          steps: [says('Read.')],
          between: () => {
            if (!holding) return Promise.resolve()
            const turn = held()
            turns.push(turn)
            return turn.promise
          },
        },
      })
      const turnsHeld = (count: number) =>
        until(
          Effect.sync(() => turns.length >= count),
          LONG,
        )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            // The Builder is in a turn of its own before the final checks run.
            holding = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { role: 'builder' },
                kind: 'note',
                body: 'Read the export once more.',
              }),
            )
            yield* turnsHeld(1)
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
              LONG,
            )
            // The turn that started before the red ends: the red is taken by the next one.
            turns[0]?.release()
            yield* turnsHeld(2)
            // Long enough for a judgement on the first turn's end to have run.
            yield* Effect.sleep('1 second')
            const whileTaken = yield* endAttempts(mission.id)
            turns[1]?.release()
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 3),
              LONG,
            )
            return { whileTaken, after: yield* endAttempts(mission.id) }
          }),
        ),
      ).finally(() => {
        holding = false
        for (const turn of turns) turn.release()
      })
      expect(seen.whileTaken).toEqual(['red', null])
      expect(seen.after).toEqual(['red', 'red', null])
    },
  )

  test(
    'a turn end the end takes in late, once the red it left queued was taken, does not count as the turn on the red',
    SLOW,
    async () => {
      let holding = false
      const turns: Array<ReturnType<typeof held>> = []
      // Once armed, the end takes in a Builder's turn end only when the test lets it.
      let late: ReturnType<typeof held> | null = null
      const { world, run } = ending({
        checks: ({ scope }) => (scope === 'end' ? [RED] : []),
        builder: {
          steps: [says('Read.')],
          between: () => {
            if (!holding) return Promise.resolve()
            const turn = held()
            turns.push(turn)
            return turn.promise
          },
        },
        endHold: () => {
          const gate = late
          return gate === null ? Effect.void : Effect.promise(() => gate.promise)
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            holding = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { role: 'builder' },
                kind: 'note',
                body: 'Read the export once more.',
              }),
            )
            yield* until(
              Effect.sync(() => turns.length >= 1),
              LONG,
            )
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
              LONG,
            )
            // The end of the turn that started before the red is taken in only once the next
            // turn took the red.
            const gate = held()
            late = gate
            turns[0]?.release()
            yield* until(
              Effect.sync(() => turns.length >= 2),
              LONG,
            )
            late = null
            gate.release()
            // Long enough for a judgement on the late turn end to have run.
            yield* Effect.sleep('1 second')
            return { whileTaken: yield* endAttempts(mission.id) }
          }),
        ),
      ).finally(() => {
        holding = false
        late?.release()
        for (const turn of turns) turn.release()
      })
      expect(seen.whileTaken).toEqual(['red', null])
    },
  )

  test(
    'a red of the final checks no turn took, its Builder ended mid-turn, is judged again only after the Builder brought back took it',
    SLOW,
    async () => {
      let holding = false
      const turns: Array<ReturnType<typeof held>> = []
      const { world, run } = ending({
        checks: ({ scope }) => (scope === 'end' ? [RED] : []),
        builder: {
          steps: [says('Read.')],
          between: () => {
            if (!holding) return Promise.resolve()
            const turn = held()
            turns.push(turn)
            return turn.promise
          },
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            holding = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { role: 'builder' },
                kind: 'note',
                body: 'Read the export once more.',
              }),
            )
            yield* until(
              Effect.sync(() => turns.length >= 1),
              LONG,
            )
            yield* documented(world, mission.id)
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
              LONG,
            )
            // Its session ends in the turn that started before the red: nobody took the red.
            yield* Sessions.use((sessions) =>
              sessions.end(builder.session.lineage, 'the test ended it'),
            )
            // The end brings it back, and the red reaches its first turn, which holds.
            const database = yield* Database
            yield* until(
              Effect.map(
                database
                  .select({ state: sessionDeliveries.state })
                  .from(sessionDeliveries)
                  .where(
                    and(
                      eq(sessionDeliveries.ownerId, mission.id),
                      eq(sessionDeliveries.kind, 'red'),
                    ),
                  ),
                (reds) => reds.length === 1 && reds[0]?.state === 'sent',
              ),
              LONG,
            )
            yield* Effect.sleep('1 second')
            const whileTaken = yield* endAttempts(mission.id)
            for (const index of world.agents.keys()) world.release(index)
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length >= 3),
              LONG,
            )
            // Let go, the Builder may already have ended its turn on the third red too.
            return { whileTaken, after: (yield* endAttempts(mission.id)).slice(0, 2) }
          }),
        ),
      ).finally(() => {
        holding = false
        for (const turn of turns) turn.release()
      })
      expect(seen.whileTaken).toEqual(['red', null])
      expect(seen.after).toEqual(['red', 'red'])
    },
  )

  /** A Builder session that ended with no need of its own, as the store reads it. */
  const endedQuietly = (sessionId: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      yield* database
        .update(agentSessions)
        .set({ state: 'ended', stateReason: null, endedAt: new Date().toISOString() })
        .where(eq(agentSessions.id, sessionId))
    })

  /** Mission events, as a proof run or a need brings them: each drives the end again. */
  const driven = (missionId: string) =>
    Effect.gen(function* () {
      for (let count = 0; count < 3; count += 1) {
        yield* mutate('driving the end', () =>
          Effect.succeed({
            result: undefined,
            events: [buildingEvent(missionId, 'building.resumed')],
          }),
        )
        yield* Effect.sleep('200 millis')
      }
      // Long enough for a resume to show itself.
      yield* Effect.sleep('1 second')
    })

  /** The Builder's question, which holds the end at refresh until the user answers it. */
  const asked = (grantId: string) =>
    call(grantId, 'report_need', {
      kind: 'decision',
      text: 'Which separator do the exports use?',
      options: ['Comma', 'Semicolon'],
      tasks: [],
    })

  const errorNeedsOf = (missionId: string) =>
    Effect.map(getMission(missionId), (one) =>
      one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
    )

  test(
    'an answered three-reds need on a final check: no red is counted again before the Builder’s next turn ends',
    SLOW,
    async () => {
      // Once armed, each turn of the Builder holds until the test lets it go.
      let holding = false
      const turns: Array<ReturnType<typeof held>> = []
      // Each pass of the end over its steps, numbered as it begins, and those that finished.
      let begun = 0
      const finished: Array<number> = []
      const { world, run } = ending({
        checks: ({ scope }) => (scope === 'end' ? [RED] : []),
        builder: {
          steps: [says('Read.')],
          between: () => {
            if (!holding) return Promise.resolve()
            const turn = held()
            turns.push(turn)
            return turn.promise
          },
        },
        endHold: (at) =>
          Effect.sync(() => {
            if (at === 'advancing') begun += 1
            if (at === 'advanced') finished.push(begun)
          }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const [need] = yield* until(
              Effect.map(errorNeedsOf(mission.id), (found) => found.length > 0),
              LONG,
            ).pipe(Effect.andThen(errorNeedsOf(mission.id)))
            if (need === undefined) return yield* Effect.die(new Error('no error need'))
            const reds = yield* endAttempts(mission.id)
            // The Builder is in a turn of its own when the user answers: that turn ends after the
            // answer, and the next one takes it.
            yield* Sessions.use((sessions) => sessions.settled(builder.session.id))
            holding = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { role: 'builder' },
                kind: 'note',
                body: 'Read the export once more.',
              }),
            )
            yield* until(
              Effect.sync(() => turns.length >= 1),
              LONG,
            )
            yield* answerNeed({
              id: need.id,
              answer: WrittenAnswer.make({ text: 'Read the header row from the file.' }),
              key: need.id,
            })
            turns[0]?.release()
            yield* until(
              Effect.sync(() => turns.length >= 2),
              LONG,
            )
            const database = yield* Database
            yield* until(
              Effect.map(
                database
                  .select({ state: sessionDeliveries.state })
                  .from(sessionDeliveries)
                  .where(
                    and(
                      eq(sessionDeliveries.ownerId, mission.id),
                      eq(sessionDeliveries.kind, 'answer'),
                    ),
                  ),
                (answers) => answers.length === 1 && answers[0]?.state === 'sent',
              ),
              LONG,
            )
            // The end is driven while the turn on the answer runs: a whole pass, begun after it.
            const from = begun
            yield* mutate('driving the end', () =>
              Effect.succeed({
                result: undefined,
                events: [buildingEvent(mission.id, 'building.resumed')],
              }),
            )
            yield* until(
              Effect.sync(() => finished.some((one) => one > from)),
              LONG,
            )
            const whileTaken = yield* endAttempts(mission.id)
            turns[1]?.release()
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length >= 4),
              LONG,
            )
            return { reds, whileTaken, after: (yield* endAttempts(mission.id)).slice(0, 4) }
          }),
        ),
      ).finally(() => {
        holding = false
        for (const turn of turns) turn.release()
      })
      expect(seen.reds).toEqual(['red', 'red', 'red'])
      expect(seen.whileTaken).toEqual(['red', 'red', 'red'])
      expect(seen.after).toEqual(['red', 'red', 'red', 'red'])
    },
  )

  test(
    'a Builder that was live when the end first waited at refresh, then stopped with no need, is brought back: only a resume the end started counts',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            // The end first waits at refresh with its Builder live: nothing to bring back.
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            yield* driven(mission.id)
            const first = yield* lineage
            // Then the Builder stops, with no need of its own.
            yield* endedQuietly(builder.session.id)
            yield* driven(mission.id)
            return { first, lineage: yield* lineage, view: yield* buildingNow(mission.id) }
          }),
        ),
      )
      expect(seen.first).toHaveLength(1)
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended', 'working'])
      expect(seen.view.phase).toBe('refresh')
    },
  )

  test(
    'a Builder the end brought back that stops again with no need holds the end on an error need, and its Retry brings the Builder back',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            // A Builder session that ended with no need of its own, before the end reaches refresh.
            yield* endedQuietly(builder.session.id)
            yield* reviewed(world, mission.id, 'code-reviewer')
            // The end brings it back as it first waits at refresh.
            yield* until(
              Effect.map(lineage, (rows) => rows.length === 2),
              LONG,
            )
            // Its successor ends too, with no need: mission events drive the end again.
            yield* endedQuietly((yield* lineage).at(-1)?.id ?? '')
            yield* driven(mission.id)
            const holding = {
              lineage: yield* lineage,
              needs: yield* errorNeedsOf(mission.id),
              view: yield* buildingNow(mission.id),
            }
            // The user's Retry brings the Builder back once more.
            yield* retried(mission.id)
            yield* until(
              Effect.map(lineage, (rows) => rows.length === 3 && rows[2]?.state === 'working'),
              LONG,
            )
            return { holding, lineage: yield* lineage }
          }),
        ),
      )
      expect(seen.holding.lineage).toHaveLength(2)
      expect(seen.holding.view.phase).toBe('refresh')
      expect(seen.holding.needs).toHaveLength(1)
      const [need] = seen.holding.needs
      if (need !== undefined && Predicate.isTagged(need.fields, 'Error')) {
        expect(need.fields.failed).toContain('The Builder stopped')
        expect(need.fields.proposals).toEqual(['Retry'])
      }
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended', 'ended', 'working'])
    },
  )

  test(
    'a Builder the end brings back whose start fails before it has a driver holds the end on an error need',
    SLOW,
    async () => {
      let failing = false
      const { world, run } = ending({
        // Once armed, a Builder's start fails before anything of it starts: no driver, no turn.
        sessionHold: (at, session) =>
          at === 'starting' && failing && session.role === 'builder'
            ? Effect.die(new Error('the brief could not be read'))
            : Effect.void,
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* endedQuietly(builder.session.id)
            // The end brings the Builder back at refresh, and that start fails.
            failing = true
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(errorNeedsOf(mission.id), (found) => found.length > 0),
              LONG,
            )
            return { lineage: yield* lineage, view: yield* buildingNow(mission.id) }
          }),
        ),
      )
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended', 'failed'])
      expect(seen.view.phase).toBe('refresh')
    },
  )

  test(
    'a Builder whose failure is written after the end of its turn was heard is still brought back',
    SLOW,
    async () => {
      let dying = false
      let failing = false
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const { world, run } = ending({
        builder: {
          get steps(): ReadonlyArray<FakeStep> {
            return dying ? [{ does: 'dies' }] : [says('Read.')]
          },
        },
        // Once armed, the next agent to start cannot: its turn ends, then its session fails.
        starting: () =>
          Effect.suspend(() => {
            if (!failing) return Effect.void
            failing = false
            return Effect.fail(new LaunchFailed({ reason: 'the agent could not be spawned' }))
          }),
        // The Builder's failure is written only once the test lets it, after its turn's end.
        sessionHold: (at, session) =>
          at === 'failing' && session.role === 'builder'
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void,
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            const turned = Effect.map(buildingNow(mission.id), (view) => view.buildingId).pipe(
              Effect.flatMap((id) =>
                Database.use((database) =>
                  database
                    .select({ at: buildings.builderTurnedAt })
                    .from(buildings)
                    .where(eq(buildings.id, id)),
                ),
              ),
              Effect.map((rows) => rows[0]?.at ?? null),
            )
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            // The end waits at refresh on the question, its Builder live.
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            yield* Effect.sleep('500 millis')
            const before = yield* turned
            // The Builder's process dies, and its replacement cannot start.
            dying = true
            failing = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            // The end hears the replacement's turn end while its session still reads live.
            yield* Deferred.await(entered)
            yield* until(
              Effect.map(turned, (at) => at !== before),
              LONG,
            )
            yield* Effect.sleep('1 second')
            yield* Deferred.succeed(release, undefined)
            yield* until(
              Effect.map(lineage, (rows) =>
                ['starting', 'working', 'idle'].includes(rows.at(-1)?.state ?? ''),
              ),
              LONG,
            )
            return yield* lineage
          }),
        ),
      ).finally(() => Effect.runSync(Deferred.succeed(release, undefined)))
      expect(seen.map((one) => one.state)).toContain('failed')
    },
  )

  test(
    'after a restart, a Builder the start cannot bring back holds the end on an error need',
    SLOW,
    async () => {
      const checks: ChecksOf = ({ scope }) => (scope === 'end' ? [RED] : [])
      let holding = false
      const turn = held()
      const before = ending({
        checks,
        builder: {
          steps: [says('Read.')],
          between: () => (holding ? turn.promise : Promise.resolve()),
        },
      })
      const left = await before
        .run(({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              const { mission } = yield* launched(work, withReadme)
              const builder = yield* builderOf(mission.id)
              yield* builtAll(builder.grantId)
              yield* agentOf(before.world, mission.id, 'documenter')
              // The Builder's turns from now on hold: the one the red starts is not over.
              holding = true
              yield* documented(before.world, mission.id)
              yield* until(
                Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
                LONG,
              )
              // The Builder's last session is one its lineage cannot be started again from.
              yield* Database.use((database) =>
                database
                  .update(agentSessions)
                  .set({ state: 'replaced', endedAt: new Date().toISOString() })
                  .where(eq(agentSessions.id, builder.session.id)),
              )
              return mission
            }),
          ),
        )
        .finally(() => turn.release())
      // The start is held once it tried the Builder, while the end is driven at the start.
      const settled = held()
      const after = ending({
        checks,
        resumed: true,
        hold: (at) => (at === 'resumed' ? Effect.promise(() => settled.promise) : Effect.void),
      })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* Effect.sleep('2 seconds')
            settled.release()
            yield* until(
              Effect.map(errorNeedsOf(left.id), (found) => found.length > 0),
              LONG,
            )
            return { needs: yield* errorNeedsOf(left.id), view: yield* buildingNow(left.id) }
          }),
        ),
      )
      expect(seen.view.phase).toBe('final_checks')
      expect(seen.needs).toHaveLength(1)
    },
  )

  test(
    'an answer the Builder acted on releases the exit even when the end of its turn could not be kept',
    SLOW,
    async () => {
      let gate: ReturnType<typeof held> | null = null
      const first = held()
      const second = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => gate?.promise ?? Promise.resolve(),
        },
      })
      await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const database = yield* Database
            const answers = Effect.map(
              database
                .select()
                .from(sessionDeliveries)
                .where(
                  and(
                    eq(sessionDeliveries.ownerId, mission.id),
                    eq(sessionDeliveries.kind, 'answer'),
                  ),
                ),
              (rows) => rows.map((row) => row.state),
            )
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            gate = first
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            gate = second
            first.release()
            yield* until(
              Effect.map(answers, (rows) => rows.includes('sent')),
              LONG,
            )
            // From now on, the end of a Builder's turn cannot be written.
            yield* database.run(sql`CREATE TRIGGER refuse_turns BEFORE UPDATE OF builder_turned_at
              ON buildings BEGIN SELECT RAISE(ABORT, 'refused'); END`)
            gate = null
            second.release()
            yield* inReview(mission.id)
          }),
        ),
      ).finally(() => {
        first.release()
        second.release()
      })
    },
  )

  test(
    'a Builder that cannot be started for want of a Workspace says so, not that Retry starts it',
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
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            // The Builder stops, and the Building has no Workspace to open one in any more.
            yield* endedQuietly(builder.session.id)
            const database = yield* Database
            yield* database
              .update(agentSessions)
              .set({ role: 'retired' })
              .where(eq(agentSessions.id, builder.session.id))
            yield* database
              .update(buildings)
              .set({ workspaceId: null })
              .where(eq(buildings.missionId, mission.id))
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(errorNeedsOf(mission.id), (found) => found.length > 0),
              LONG,
            )
            return yield* errorNeedsOf(mission.id)
          }),
        ),
      )
      const [need] = seen
      const failed =
        need !== undefined && Predicate.isTagged(need.fields, 'Error') ? need.fields.failed : ''
      expect(failed).toContain('no Workspace')
      expect(failed).not.toContain('Retry starts it again')
    },
  )

  test(
    'a Builder that cannot be spoken to while a red of the final checks waits on it is brought back',
    SLOW,
    async () => {
      let dying = false
      let failing = false
      // The Builder's turns hold before each step while the gate is set.
      let gate: ReturnType<typeof held> | null = null
      const turn = held()
      const { world, run } = ending({
        checks: ({ scope }) => (scope === 'end' ? [RED] : []),
        builder: {
          get steps(): ReadonlyArray<FakeStep> {
            return dying ? [says('Working.'), { does: 'dies' }] : [says('Read.')]
          },
          between: () => gate?.promise ?? Promise.resolve(),
        },
        // Once armed, the next agent to start cannot: its session fails, with no need.
        starting: () =>
          Effect.suspend(() => {
            if (!failing) return Effect.void
            failing = false
            return Effect.fail(new LaunchFailed({ reason: 'the agent could not be spawned' }))
          }),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            // The Builder's next turn holds, then dies once let go.
            dying = true
            gate = turn
            yield* documented(world, mission.id)
            // The red of the final checks waits on the Builder, live in its held turn.
            yield* until(
              Effect.map(endAttempts(mission.id), (verdicts) => verdicts.length === 2),
              LONG,
            )
            yield* Effect.sleep('500 millis')
            // Its process dies, and its replacement cannot start.
            failing = true
            turn.release()
            yield* until(
              Effect.map(lineage, (rows) => rows.some((row) => row.state === 'failed')),
              LONG,
            )
            yield* until(
              Effect.map(lineage, (rows) =>
                ['starting', 'working', 'idle'].includes(rows.at(-1)?.state ?? ''),
              ),
              LONG,
            )
            return {
              lineage: yield* lineage,
              view: yield* buildingNow(mission.id),
              needs: (yield* getMission(mission.id)).needs,
            }
          }),
        ),
      ).finally(() => turn.release())
      expect(seen.lineage.map((one) => one.state)).toContain('failed')
      expect(seen.view.phase).toBe('final_checks')
      expect(seen.needs).toEqual([])
    },
  )

  test(
    'a Builder that stops with no need while a special task waits on it is brought back',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // RV1 is the Builder's, and the Builder stops with no need of its own.
            yield* endedQuietly(builder.session.id)
            yield* driven(mission.id)
            return { lineage: yield* lineage, view: yield* buildingNow(mission.id) }
          }),
        ),
      )
      expect(seen.lineage.map((one) => one.state)).toEqual(['ended', 'working'])
      expect(seen.view.phase).toBe('special_tasks')
    },
  )

  test(
    'an answer that reaches the Builder once the exit looked at the Workspace sends the exit back, and waits for a turn of the Builder on it',
    SLOW,
    async () => {
      const looking = Deferred.makeUnsafe<void>()
      const answered = Deferred.makeUnsafe<void>()
      let first = true
      const { world, run } = ending({
        // The exit's first look at the Workspace waits until an answer reached the Builder.
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind !== 'review_exit' || !first) return real.take(place, owner)
            first = false
            return Deferred.succeed(looking, undefined).pipe(
              Effect.andThen(Deferred.await(answered)),
              Effect.andThen(real.take(place, owner)),
            )
          },
        }),
      })
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
            yield* Deferred.await(looking)
            // An answer the user gave a moment before, stored for the Builder only now.
            const id = yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { role: 'builder' },
                kind: 'answer',
                body: 'The user answered: Comma',
              }),
            )
            yield* Deferred.succeed(answered, undefined)
            // The exit goes back to the Builder, started again to take the answer: its turn ends.
            const lineage = sessionsOfLineage(builder.session.lineage)
            yield* until(
              Effect.map(lineage, (rows) => rows.at(-1)?.state === 'working'),
              LONG,
            )
            yield* until(
              Effect.sync(() => world.agents.length > 0),
              LONG,
            )
            for (const index of world.agents.keys()) world.release(index)
            yield* inReview(mission.id)
            const database = yield* Database
            const [answer] = yield* database
              .select()
              .from(sessionDeliveries)
              .where(eq(sessionDeliveries.id, id))
            const [ended] = yield* database
              .select({ turned: buildings.builderTurnedAt })
              .from(buildings)
              .where(eq(buildings.missionId, mission.id))
            return { answer, turned: ended?.turned ?? null }
          }),
        ),
      )
      expect(seen.answer?.state).toBe('sent')
      expect(seen.turned).not.toBeNull()
      expect((seen.turned ?? '') > (seen.answer?.sentAt ?? '')).toBe(true)
    },
  )

  /** The answers kept for a mission's agents, and the state of its Building. */
  const answersAndBuilding = (missionId: string) =>
    Effect.gen(function* () {
      const database = yield* Database
      const answers = yield* database
        .select()
        .from(sessionDeliveries)
        .where(and(eq(sessionDeliveries.ownerId, missionId), eq(sessionDeliveries.kind, 'answer')))
      const [building] = yield* database
        .select({ state: buildings.state, turned: buildings.builderTurnedAt })
        .from(buildings)
        .where(eq(buildings.missionId, missionId))
      return { answers, building }
    })

  /** The Builder's event follower, held as it takes in an answer once `lagging` is set. */
  const laggingFollower = () => {
    const state = { lagging: false }
    const entered = Deferred.makeUnsafe<void>()
    const behind = held()
    const hold: BuilderHold = (at) =>
      at === 'answering' && state.lagging
        ? Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.promise(() => behind.promise)),
          )
        : Effect.void
    return { state, entered, behind, hold }
  }

  test(
    'an answer applied while the Builder’s event follower lags behind is kept for the Builder before the end can close the Building, and its turn on it is waited for',
    SLOW,
    async () => {
      const follower = laggingFollower()
      const { world, run } = ending({ hold: follower.hold })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            follower.state.lagging = true
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            // The answer is applied; the follower that acts on it has not taken it in yet.
            yield* Deferred.await(follower.entered)
            // Whatever drives the end meanwhile, it does not close the Building on that answer.
            yield* driven(mission.id)
            const lagged = yield* answersAndBuilding(mission.id)
            follower.behind.release()
            yield* inReview(mission.id)
            return { lagged, after: yield* answersAndBuilding(mission.id) }
          }),
        ),
      ).finally(() => follower.behind.release())
      expect(seen.lagged.building?.state).toBe('active')
      expect(seen.lagged.answers).toHaveLength(1)
      expect(seen.lagged.answers[0]?.body).toContain('The user answered: Comma')
      // One answer, sent to the Builder, and a turn of the Builder ended after it was sent.
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer applied right before a stop, its Builder’s event follower behind, reaches the Builder after the start before the end closes the Building',
    SLOW,
    async () => {
      const follower = laggingFollower()
      const before = ending({ hold: follower.hold })
      const left = await before
        .run(({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              const { mission } = yield* launched(work, withReadme)
              const builder = yield* builderOf(mission.id)
              yield* builtAll(builder.grantId)
              yield* asked(builder.grantId)
              yield* documented(before.world, mission.id)
              yield* reviewed(before.world, mission.id, 'spec-reviewer')
              yield* reviewed(before.world, mission.id, 'code-reviewer')
              yield* until(
                Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
                LONG,
              )
              const need = (yield* getMission(mission.id)).needs[0]
              if (need === undefined) return yield* Effect.die(new Error('no question'))
              follower.state.lagging = true
              yield* answerNeed({
                id: need.id,
                answer: ChosenAnswer.make({ option: 'Comma' }),
                key: crypto.randomUUID(),
              })
              // Hemera stops with the answer applied and its follower behind.
              yield* Deferred.await(follower.entered)
              return mission
            }),
          ),
        )
        .finally(() => follower.behind.release())
      const after = ending({ resumed: true })
      // Every agent of the start ends its turn as soon as it is given one.
      for (let index = 0; index < 8; index += 1) after.world.release(index)
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* inReview(left.id)
            return {
              kept: yield* answersAndBuilding(left.id),
              prompts: after.world.agents.flatMap((agent) =>
                agent.answers.prompts.map((one) => text(one)),
              ),
            }
          }),
        ),
      )
      expect(seen.kept.answers.map((one) => one.state)).toEqual(['sent'])
      expect(seen.prompts.some((one) => one.includes('The user answered: Comma'))).toBe(true)
      const [answer] = seen.kept.answers
      expect((seen.kept.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer given before the end is called, its Builder’s turn on it still running at the refresh, holds the exit until that turn ended',
    SLOW,
    async () => {
      let gate: ReturnType<typeof held> | null = null
      const turn = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => gate?.promise ?? Promise.resolve(),
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* asked(builder.grantId)
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            // The Builder's turn on the answer, before its last task ends, stays open.
            gate = turn
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            yield* until(
              Effect.map(answersAndBuilding(mission.id), (now) =>
                now.answers.some((one) => one.state === 'sent'),
              ),
              LONG,
            )
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            yield* driven(mission.id)
            const waiting = yield* answersAndBuilding(mission.id)
            gate = null
            turn.release()
            yield* inReview(mission.id)
            const [called] = yield* (yield* Database)
              .select({ at: buildings.endCalledAt })
              .from(buildings)
              .where(eq(buildings.missionId, mission.id))
            return {
              called: called?.at ?? '',
              waiting,
              after: yield* answersAndBuilding(mission.id),
            }
          }),
        ),
      ).finally(() => turn.release())
      // Stored before the end was called, and waited on all the same.
      expect((seen.waiting.answers[0]?.createdAt ?? '~') < seen.called).toBe(true)
      expect(seen.waiting.building?.state).toBe('active')
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer the user gave at the refresh that is not handed to the Builder yet holds the exit, and reaches the Builder before Review',
    SLOW,
    async () => {
      const handing = held()
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            // Another round of answers holds the hand-over: this one is answered, not handed yet.
            const owners = yield* NeedOwners
            const other = yield* Semaphore.withPermits(
              owners.delivering,
              1,
            )(Effect.promise(() => handing.promise)).pipe(Effect.forkChild)
            const answering = yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            }).pipe(Effect.forkChild)
            yield* until(
              Effect.map(getNeed(need.id), (one) => one.state === 'answered'),
              LONG,
            )
            yield* driven(mission.id)
            const lagged = yield* answersAndBuilding(mission.id)
            handing.release()
            yield* Fiber.join(other)
            yield* Fiber.join(answering)
            yield* inReview(mission.id)
            return { lagged, after: yield* answersAndBuilding(mission.id) }
          }),
        ),
      ).finally(() => handing.release())
      expect(seen.lagged.building?.state).toBe('active')
      expect(seen.lagged.answers).toEqual([])
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer whose hand-over to the Builder failed is handed over again by the end, which waits for it before Review',
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
            yield* asked(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            // The hand-over's write fails once: the answer is kept, not handed over.
            const database = yield* Database
            yield* database.run(sql`CREATE TRIGGER refuse_answers BEFORE INSERT ON session_deliveries
              WHEN NEW.kind = 'answer' BEGIN SELECT RAISE(ABORT, 'refused'); END`)
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            const failed = yield* answersAndBuilding(mission.id)
            yield* database.run(sql`DROP TRIGGER refuse_answers`)
            // Nothing hands it over on its own now: the end, driven, does.
            yield* driven(mission.id)
            yield* inReview(mission.id)
            return { failed, after: yield* answersAndBuilding(mission.id) }
          }),
        ),
      )
      expect(seen.failed.answers).toEqual([])
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'an answer the Builder took in the tasks phase, its Builder stopped before the end and impossible to bring back, does not hold the exit: the Building reaches Review',
    SLOW,
    async () => {
      let failing = false
      let gate: ReturnType<typeof held> | null = null
      const turn = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => gate?.promise ?? Promise.resolve(),
        },
        // Once armed, a Builder's start fails: it cannot be brought back.
        sessionHold: (at, session) =>
          at === 'starting' && failing && session.role === 'builder'
            ? Effect.die(new Error('the provider is down'))
            : Effect.void,
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* asked(builder.grantId)
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            // The Builder takes the answer in the tasks phase and ends its turn on it.
            yield* until(
              Effect.map(answersAndBuilding(mission.id), (now) =>
                now.answers.some((one) => one.state === 'sent'),
              ),
              LONG,
            )
            yield* Sessions.use((sessions) => sessions.settled(builder.session.id))
            // From now on its turns stay open: none ends once the end is called. It finishes the
            // plan, then stops, and cannot be started again.
            gate = turn
            yield* builtAll(builder.grantId)
            yield* endedQuietly(builder.session.id)
            failing = true
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            const errors = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((found) => Predicate.isTagged(found.fields, 'Error')),
            )
            yield* until(
              Effect.gen(function* () {
                return (
                  (yield* getMission(mission.id)).stage === 'review' || (yield* errors).length > 0
                )
              }),
              LONG,
            )
            return { mission: yield* getMission(mission.id), errors: yield* errors }
          }),
        ),
      ).finally(() => turn.release())
      expect(seen.errors).toEqual([])
      expect(seen.mission.stage).toBe('review')
    },
  )

  /**
   * The Builder's question at the refresh, turned by hand into an answer the hand-over skips, as
   * `changed` rewrites its need; then the end is driven, up to Review.
   */
  const skippedAnswer = (changed: (needId: string) => ReturnType<typeof sql>) => {
    const { world, run } = ending()
    return run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          yield* builtAll(builder.grantId)
          yield* asked(builder.grantId)
          yield* documented(world, mission.id)
          yield* reviewed(world, mission.id, 'spec-reviewer')
          yield* reviewed(world, mission.id, 'code-reviewer')
          yield* until(
            Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
            LONG,
          )
          const need = (yield* getMission(mission.id)).needs[0]
          if (need === undefined) return yield* Effect.die(new Error('no question'))
          const database = yield* Database
          yield* database.run(sql`UPDATE needs SET state = 'answered',
            answer = '{"_tag":"Chosen","option":"Comma"}', ended_at = ${new Date().toISOString()}
            WHERE id = ${need.id}`)
          yield* database.run(changed(need.id))
          yield* database.insert(needDeliveries).values({ needId: need.id, deliveredAt: null })
          yield* driven(mission.id)
          yield* inReview(mission.id)
          return yield* getMission(mission.id)
        }),
      ),
    )
  }

  test(
    'an answer to a need no service takes, which the hand-over always skips, does not hold the exit',
    SLOW,
    async () => {
      const seen = await skippedAnswer(
        (needId) => sql`UPDATE needs SET service = 'nobody' WHERE id = ${needId}`,
      )
      expect(seen.stage).toBe('review')
    },
  )

  test(
    'an answer to a need this version cannot read, which the hand-over always skips, does not hold the exit',
    SLOW,
    async () => {
      const seen = await skippedAnswer(
        (needId) => sql`UPDATE needs SET fields = '{"_tag":"Unknown"}' WHERE id = ${needId}`,
      )
      expect(seen.stage).toBe('review')
    },
  )

  test(
    'a Retry of the Builder’s environment need at the refresh, its event follower behind, is kept for the Builder before the end can close the Building',
    SLOW,
    async () => {
      const state = { lagging: false }
      const entered = Deferred.makeUnsafe<void>()
      const behind = held()
      const { world, run } = ending({
        hold: (at) =>
          at === 'releasing' && state.lagging
            ? Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Effect.promise(() => behind.promise)),
              )
            : Effect.void,
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* call(builder.grantId, 'report_need', {
              kind: 'environment',
              text: 'The staging database is down.',
              tasks: [],
            })
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no need'))
            state.lagging = true
            yield* retryNeed(need.id)
            // The need is withdrawn; the follower that tells the Builder has not taken it in yet.
            yield* Deferred.await(entered)
            yield* driven(mission.id)
            const lagged = yield* answersAndBuilding(mission.id)
            behind.release()
            yield* inReview(mission.id)
            return { lagged, after: yield* answersAndBuilding(mission.id) }
          }),
        ),
      ).finally(() => behind.release())
      expect(seen.lagged.building?.state).toBe('active')
      expect(seen.lagged.answers).toHaveLength(1)
      expect(seen.lagged.answers[0]?.body).toContain('The user says it is fixed')
      expect(seen.after.answers.map((one) => one.state)).toEqual(['sent'])
      const [answer] = seen.after.answers
      expect((seen.after.building?.turned ?? '') > (answer?.sentAt ?? '~')).toBe(true)
    },
  )

  test(
    'a Builder the user’s Retry starts again after the exit marked the mission runs the calls the user allowed',
    SLOW,
    async () => {
      let limiting = false
      const limit: FakeStep = { does: 'limits', title: 'The Acme account has no available quota.' }
      const { run } = ending({
        builder: {
          get steps() {
            return limiting ? [limit] : [says('Read.')]
          },
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const owner = { kind: 'mission', missionId: mission.id } as const
            // The Builder's next turn meets the provider's limit: its session ends, the user is asked.
            limiting = true
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner,
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            const limitNeed = Effect.map(getMission(mission.id), (one) =>
              one.needs.find(
                (need) =>
                  Predicate.isTagged(need.fields, 'Environment') &&
                  need.fields.missing.includes('provider limit'),
              ),
            )
            yield* until(
              Effect.map(limitNeed, (found) => found !== undefined),
              LONG,
            )
            limiting = false
            // The exit marked the mission as its tree stopped, then asked for the Builder back, as
            // it does on a question raised meanwhile: the Builder waits on its own need.
            yield* ToolAccess.use((access) => access.exiting(mission.id, [builder.session.lineage]))
            yield* BuildDesk.use((desk) => desk.ensureBuilder(mission.id))
            // The user's Retry of that need starts the Builder again, through the sessions.
            yield* retryNeed((yield* limitNeed)?.id ?? '')
            yield* until(
              Effect.map(sessionsIn(['working', 'idle'], owner), (rows) =>
                rows.some((row) => row.role === 'builder'),
              ),
              LONG,
            )
            return {
              allowed: yield* ToolAccess.use((access) =>
                access.counted(
                  { missionId: mission.id, lineage: builder.session.lineage },
                  Effect.succeed('ran'),
                ),
              ),
            }
          }),
        ),
      )
      expect(seen.allowed).toBe('ran')
    },
  )

  test(
    'an answer to the Builder’s question holds the exit until a turn of the Builder on it ended',
    SLOW,
    async () => {
      // The Builder's turns hold on the gate set when they start, until the test lets it go.
      let gate: ReturnType<typeof held> | null = null
      const first = held()
      const second = held()
      const { world, run } = ending({
        builder: {
          steps: [says('Read.')],
          between: () => gate?.promise ?? Promise.resolve(),
        },
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const database = yield* Database
            const answers = Effect.map(
              database
                .select()
                .from(sessionDeliveries)
                .where(
                  and(
                    eq(sessionDeliveries.ownerId, mission.id),
                    eq(sessionDeliveries.kind, 'answer'),
                  ),
                ),
              (rows) => rows.map((row) => row.state),
            )
            const stage = Effect.map(getMission(mission.id), (one) => one.stage)
            yield* builtAll(builder.grantId)
            yield* asked(builder.grantId)
            // The Builder is in a long turn: what is delivered between turns waits for its end.
            gate = first
            yield* Sessions.use((sessions) =>
              sessions.deliver({
                owner: { kind: 'mission', missionId: mission.id },
                target: { lineage: builder.session.lineage },
                kind: 'note',
                body: 'One more thing.',
              }),
            )
            yield* until(
              Effect.map(getSession(builder.session.id), (session) => session.state === 'working'),
              LONG,
            )
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(buildingNow(mission.id), (view) => view.phase === 'refresh'),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            if (need === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: need.id,
              answer: ChosenAnswer.make({ option: 'Comma' }),
              key: crypto.randomUUID(),
            })
            yield* until(
              Effect.map(answers, (rows) => rows.length > 0),
              LONG,
            )
            // Long enough for an exit to have run.
            yield* Effect.sleep('1 second')
            const queued = { stage: yield* stage, answers: yield* answers }
            // The long turn ends; the next one takes the answer, and holds in turn.
            gate = second
            first.release()
            yield* until(
              Effect.map(answers, (rows) => rows.includes('sent')),
              LONG,
            )
            yield* Effect.sleep('1 second')
            const taken = { stage: yield* stage, answers: yield* answers }
            gate = null
            second.release()
            yield* inReview(mission.id)
            return { queued, taken }
          }),
        ),
      ).finally(() => {
        first.release()
        second.release()
      })
      expect(seen.queued).toEqual({ stage: 'building', answers: ['queued'] })
      expect(seen.taken).toEqual({ stage: 'building', answers: ['sent'] })
    },
  )
})
