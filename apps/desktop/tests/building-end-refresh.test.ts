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
 * This file: the refresh, and a restart in the middle of the end.
 */

import { ChosenAnswer, START_AGAIN } from '@hemera/core/domain'
import { and, asc, eq } from 'drizzle-orm'
import { Deferred, Duration, Effect, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { BuildDesk } from '../src/engine/building/desk.ts'
import type { SnapshotsService } from '../src/engine/building/snapshots.ts'
import { buildingEvent } from '../src/engine/building/tasks.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { setProofLimit } from '../src/engine/project-checks.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed, retryNeed } from '../src/engine/needs.ts'
import { Runs } from '../src/engine/runs.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { sessionsIn, sessionsOfLineage } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { mutate } from '../src/engine/transaction.ts'
import {
  agentSessions,
  buildings,
  checkpoints,
  documenterPasses,
  proofRuns,
  reviewPasses,
  sessionDeliveries,
  specProofs,
} from '../src/engine/storage/schema.ts'
import { QUIET, call, eventsOf, says } from './building-world.ts'
import { PLAN, builderOf, buildingNow, launched } from './builder-world.ts'
import { held, until, within } from './sessions-world.ts'
import { removeFolders } from './storage.ts'
import {
  work,
  LONG,
  SLOW,
  type ChecksOf,
  RED,
  GREEN,
  ending,
  withReadme,
  builtAll,
  agentOf,
  documented,
  reviewed,
  warning,
  specialDone,
  inReview,
  specialAvailable,
  reviewing,
  journalOf,
  typesOf,
  toBuilder,
  writtenInWorkspace,
  apiOf,
  proofState,
  exportProof,
  markdownTest,
  markdownProof,
  endAttempts,
  newFolders,
} from './end-world.ts'

beforeEach(() => newFolders('building-end'))
afterEach(removeFolders)

describe('The refresh', () => {
  test(
    'a proof red at the refresh is waited on, not the Builder: its green moves the end on with no turn of the Builder',
    SLOW,
    async () => {
      const markdown = [
        "import { test } from 'node:test'",
        "import assert from 'node:assert/strict'",
        "import { existsSync, readFileSync } from 'node:fs'",
        '',
        "test('the scenario holds', () => {",
        "  const file = new URL('../export.ts', import.meta.url)",
        "  assert.ok(existsSync(file) && readFileSync(file, 'utf8').includes('toMarkdown'), 'no toMarkdown')",
        '})',
        '',
      ].join('\n')
      const proofs = () => ({
        'R1.S2': {
          mode: 'automated',
          actions: ['Run the test'],
          starting_data: 'None.',
          expected: 'The assertion of the test holds.',
          test: {
            repository: 'api',
            path: 'tests/export.test.mjs',
            code: markdown,
            insertion: 'new_file',
            command: `"${process.execPath}" --test --test-reporter=tap tests/export.test.mjs`,
          },
          seen_today: false,
        },
      })
      const { world, run } = ending()
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
              proofs,
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId, 'export const toMarkdown = () => ""\n')
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // RV1 breaks what the proof reads: the refresh runs it again, red.
            yield* specialDone(builder.grantId, 'RV1', 'export.ts', 'export const toCsv = 1\n')
            yield* documented(world, mission.id, 2)
            yield* until(
              Effect.map(
                eventsOf(mission.id, 'building.proofs_refreshed'),
                (found) => found.length > 0,
              ),
              LONG,
            )
            // The rerun of the stale proof failed: it waits for its fix like a failed green.
            yield* until(
              Effect.map(
                Database.use((database) =>
                  database
                    .select()
                    .from(proofRuns)
                    .where(and(eq(proofRuns.missionId, mission.id), eq(proofRuns.phase, 'rerun'))),
                ),
                (runs) => runs.length > 0,
              ),
              LONG,
            )
            // Long enough for every turn the red started to be over.
            yield* Effect.sleep('1 second')
            // The fix lands as a write, outside any turn: the proof runs again, green.
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const toMarkdown = () => ""\n',
            })
            yield* inReview(mission.id)
            return yield* buildingNow(mission.id)
          }),
        ),
      )
      const proof = seen.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
    },
  )

  test(
    'a proof red at the refresh that the Builder looks at and leaves unfixed asks the user: Try again, or End without it, which moves the end on',
    SLOW,
    async () => {
      const { world, run } = ending()
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
              markdownProof,
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId, 'export const toMarkdown = () => ""\n')
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // RV1 breaks what the proof reads: the refresh runs it again, red, and the Builder,
            // told, ends its turn without writing.
            yield* specialDone(builder.grantId, 'RV1', 'export.ts', 'export const toCsv = 1\n')
            yield* documented(world, mission.id, 2)
            const decisions = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Decision')),
            )
            yield* until(
              Effect.map(decisions, (found) => found.length > 0),
              LONG,
            )
            const [asked] = yield* decisions
            if (asked === undefined) return yield* Effect.die(new Error('no question'))
            yield* answerNeed({
              id: asked.id,
              answer: ChosenAnswer.make({ option: 'End without it' }),
              key: asked.id,
            })
            // A Builder the exit brings back to take the answer holds its turn: it is let go.
            yield* until(
              Effect.gen(function* () {
                for (const index of world.agents.keys()) world.release(index)
                return (yield* getMission(mission.id)).stage === 'review'
              }),
              LONG,
            )
            return {
              asked,
              view: yield* buildingNow(mission.id),
              told: yield* toBuilder(mission.id, builder.session.lineage),
            }
          }),
        ),
      )
      const fields = seen.asked.fields
      if (!Predicate.isTagged(fields, 'Decision')) throw new Error('not a decision')
      expect(fields.question).toContain('R1.S2 is not proven')
      // Said as it is at the refresh: no task was skipped, and no answer came before.
      expect(fields.question).toContain("its proof failed again at the end's refresh")
      expect(fields.options).toEqual(['Try again', 'End without it'])
      // The end was called already: the summary it asked for is told what was left out.
      expect(seen.told.some((one) => one.includes('say so in the summary'))).toBe(true)
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof?.state).toBe('not_proven')
      // The end is called once: the refresh never calls it again.
      expect(seen.told.filter((one) => one.startsWith('done: '))).toHaveLength(1)
    },
  )

  test(
    'a proof red at the refresh whose Builder writes a file unchanged, then leaves it, still asks the user',
    SLOW,
    async () => {
      let holding = false
      const turns: Array<ReturnType<typeof held>> = []
      const { world, run } = ending({
        builder: {
          ...QUIET,
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
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              markdownProof,
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId, 'export const toMarkdown = () => ""\n')
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            yield* specialDone(builder.grantId, 'RV1', 'export.ts', 'export const toCsv = 1\n')
            yield* until(
              Effect.map(sessionsIn(['idle'], { kind: 'mission', missionId: mission.id }), (rows) =>
                rows.some((row) => row.role === 'builder'),
              ),
              LONG,
            )
            // The Builder's turn on the refresh's red holds while it writes.
            holding = true
            yield* documented(world, mission.id, 2)
            const database = yield* Database
            yield* until(
              Effect.map(
                database
                  .select({ state: sessionDeliveries.state, body: sessionDeliveries.body })
                  .from(sessionDeliveries)
                  .where(
                    and(
                      eq(sessionDeliveries.ownerId, mission.id),
                      eq(sessionDeliveries.kind, 'red'),
                    ),
                  ),
                (reds) =>
                  reds.some((one) => one.state === 'sent' && one.body.startsWith("R1.S2's proof")),
              ),
              LONG,
            )
            // The same content again: no tree moves, nothing runs the proof again.
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const toCsv = 1\n',
            })
            yield* Effect.sleep('1 second')
            holding = false
            for (const turn of turns) turn.release()
            const decisions = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Decision')),
            )
            yield* until(
              Effect.map(decisions, (found) => found.length > 0),
              LONG,
            )
            return yield* decisions
          }),
        ),
      ).finally(() => {
        holding = false
        for (const turn of turns) turn.release()
      })
      const fields = seen[0]?.fields
      expect(Predicate.isTagged(fields, 'Decision') ? fields.question : '').toContain(
        'R1.S2 is not proven',
      )
    },
  )

  test(
    'a stale proof the refresh cannot run is refreshed once, said once, and holds the end on an error need instead of looping',
    SLOW,
    async () => {
      const { world, run } = ending()
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
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Export a function, not a flag.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // The proof is no longer in the Spec: nothing can run it again once RV1 makes it stale.
            const database = yield* Database
            yield* database
              .delete(specProofs)
              .where(and(eq(specProofs.missionId, mission.id), eq(specProofs.scenarioId, 'R1.S2')))
            yield* specialDone(
              builder.grantId,
              'RV1',
              'export.ts',
              'export const toMarkdown = () => ""\n',
            )
            yield* documented(world, mission.id, 2)
            const refreshes = eventsOf(mission.id, 'building.proofs_refreshed')
            const errorNeeds = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
            )
            // The end asks, or loops: each turn of a loop refreshes again.
            yield* until(
              Effect.gen(function* () {
                return (yield* errorNeeds).length > 0 || (yield* refreshes).length >= 3
              }),
              LONG,
            )
            // Long enough for a loop to show itself.
            yield* Effect.sleep('1 second')
            return {
              refreshes: yield* refreshes,
              journal: yield* journalOf(mission.id),
              needs: yield* errorNeeds,
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
            }
          }),
        ),
      )
      expect(seen.refreshes).toHaveLength(1)
      expect(
        seen.journal.filter((line) => line.includes('The proofs were refreshed')),
      ).toHaveLength(1)
      expect(seen.stage).toBe('building')
      expect(seen.view.phase).toBe('refresh')
      expect(seen.needs).toHaveLength(1)
      const [need] = seen.needs
      if (need !== undefined && Predicate.isTagged(need.fields, 'Error')) {
        expect(need.fields.failed).toContain('R1.S2')
        expect(need.fields.proposals).toEqual(['Retry'])
      }
    },
  )
  test(
    'a refresh whose own snapshot sees a change is not run again on that same tree: the stale proof it cannot run asks the user after one refresh',
    SLOW,
    async () => {
      // A change no snapshot saw yet lands as the refresh takes its own snapshot.
      let unseen: (() => void) | null = null
      const { world, run } = ending({
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind === 'run' && owner.runId.startsWith('refresh-') && unseen !== null) {
              unseen()
              unseen = null
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
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Export a function, not a flag.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // The proof is no longer in the Spec: nothing can run it again once RV1 makes it stale.
            const database = yield* Database
            yield* database
              .delete(specProofs)
              .where(and(eq(specProofs.missionId, mission.id), eq(specProofs.scenarioId, 'R1.S2')))
            unseen = () => writtenInWorkspace(api, 'notes.md', 'A note of the user.\n')
            yield* specialDone(
              builder.grantId,
              'RV1',
              'export.ts',
              'export const toMarkdown = () => ""\n',
            )
            yield* documented(world, mission.id, 2)
            const refreshes = eventsOf(mission.id, 'building.proofs_refreshed')
            const errorNeeds = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
            )
            yield* until(
              Effect.gen(function* () {
                return (yield* errorNeeds).length > 0 || (yield* refreshes).length >= 3
              }),
              LONG,
            )
            // Long enough for a second refresh to show itself.
            yield* Effect.sleep('1 second')
            return {
              refreshes: yield* refreshes,
              needs: yield* errorNeeds,
              unseen,
            }
          }),
        ),
      )
      expect(seen.unseen).toBeNull()
      expect(seen.refreshes).toHaveLength(1)
      expect(seen.needs).toHaveLength(1)
    },
  )
  test(
    'a stale final check the refresh cannot run again is refreshed once and holds the end on an error need instead of looping',
    SLOW,
    async () => {
      // The end's check answers once, on a tree the Workspace has moved past; run again, the
      // Project has it no more.
      let ends = 0
      const { world, run } = ending({
        checks: ({ scope }) => {
          if (scope !== 'end') return []
          ends += 1
          return ends === 1
            ? [{ ...GREEN, trees: [{ repository: 'api', tree: '0'.repeat(40) }] }]
            : []
        },
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
            const refreshes = eventsOf(mission.id, 'building.proofs_refreshed')
            const errorNeeds = Effect.map(getMission(mission.id), (one) =>
              one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
            )
            yield* until(
              Effect.gen(function* () {
                return (yield* errorNeeds).length > 0 || (yield* refreshes).length >= 3
              }),
              LONG,
            )
            // Long enough for a loop to show itself.
            yield* Effect.sleep('1 second')
            return {
              refreshes: yield* refreshes,
              needs: yield* errorNeeds,
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
              ends,
            }
          }),
        ),
      )
      expect(seen.refreshes).toHaveLength(1)
      expect(seen.ends).toBe(2)
      expect(seen.stage).toBe('building')
      expect(seen.view.phase).toBe('refresh')
      expect(seen.needs).toHaveLength(1)
      const [need] = seen.needs
      if (need !== undefined && Predicate.isTagged(need.fields, 'Error')) {
        expect(need.fields.failed).toContain('unit tests · api')
        expect(need.fields.proposals).toEqual(['Retry'])
      }
    },
  )
})

describe('The refresh and an environment need', () => {
  test(
    'an environment need’s Retry at the refresh, its rerun not recorded yet when the end judges, raises no "stayed stale" error, and the end moves on once it is green',
    SLOW,
    async () => {
      let proofCommand = ''
      let portHeld = false
      // The Retry's rerun, held once it ran and before its result is recorded.
      let arming = false
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      // Each pass of the end over its steps, numbered as it begins, and those that finished.
      let begun = 0
      const finished: Array<number> = []
      const { world, run } = ending({
        proofMinute: Duration.seconds(2),
        hold: (at) =>
          at === 'greening' && arming
            ? Effect.gen(function* () {
                arming = false
                yield* Deferred.succeed(reached, undefined)
                yield* Deferred.await(go)
              })
            : Effect.void,
        endHold: (at) =>
          Effect.sync(() => {
            if (at === 'advancing') begun += 1
            if (at === 'advanced') finished.push(begun)
          }),
      })
      const errors = (missionId: string) =>
        Effect.map(getMission(missionId), (one) =>
          one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
        )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              (projectId) =>
                Effect.gen(function* () {
                  yield* withReadme(projectId)
                  yield* setProofLimit(projectId, 1)
                  const saved = yield* saveCommand({
                    projectId,
                    id: null,
                    command: {
                      name: 'export proof',
                      type: 'script',
                      line: `"${process.execPath}" --test --test-reporter=tap api/tests/export.test.mjs`,
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
                    },
                  })
                  proofCommand = saved.id
                  // Free until the refresh; then another mission's service holds the port.
                  const runs = yield* Runs
                  const real = runs.reservations.current
                  runs.reservations.current = {
                    enter: (asked) =>
                      asked.commandId === proofCommand && portHeld
                        ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                        : real.enter(asked),
                  }
                }),
              undefined,
              PLAN,
              undefined,
              undefined,
              () => ({
                'R1.S2': {
                  mode: 'automated',
                  actions: ['Run the test'],
                  starting_data: 'None.',
                  expected: 'The assertion of the test holds.',
                  test: {
                    repository: 'api',
                    path: 'tests/export.test.mjs',
                    code: markdownTest,
                    insertion: 'new_file',
                    command: proofCommand,
                  },
                  seen_today: false,
                },
              }),
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId, 'export const toMarkdown = () => ""\n')
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // RV1 keeps the proof passing on a new tree: the refresh runs it again, and its rerun
            // waits for the port until the Project's limit.
            portHeld = true
            yield* specialDone(
              builder.grantId,
              'RV1',
              'export.ts',
              'export const toMarkdown = () => "md"\n',
            )
            yield* documented(world, mission.id, 2)
            const environment = Effect.map(getMission(mission.id), (one) =>
              one.needs.find((need) => Predicate.isTagged(need.fields, 'Environment')),
            )
            yield* until(
              Effect.map(environment, (need) => need !== undefined),
              LONG,
            )
            const need = yield* environment
            if (need === undefined) return yield* Effect.die(new Error('no environment need'))
            // The user frees the port and Retries: the rerun runs, and is held before its record.
            portHeld = false
            arming = true
            yield* retryNeed(need.id)
            yield* Deferred.await(reached)
            // Meanwhile the end is driven (the Builder's turn on the Retry ends, say): a whole
            // pass over its steps, begun once the rerun was held.
            const from = begun
            yield* mutate('driving the end', () =>
              Effect.succeed({
                result: undefined,
                events: [buildingEvent(mission.id, 'building.end_retried')],
              }),
            )
            yield* until(
              Effect.sync(() => finished.some((one) => one > from)),
              LONG,
            )
            const meanwhile = yield* errors(mission.id)
            yield* Deferred.succeed(go, undefined)
            yield* until(
              Effect.gen(function* () {
                for (const index of world.agents.keys()) world.release(index)
                const stage = (yield* getMission(mission.id)).stage
                return stage === 'review' || (yield* errors(mission.id)).length > 0
              }),
              LONG,
            )
            // Recorded, the rerun is no longer said to run: a later stale proof is judged again.
            yield* until(
              Effect.map(
                BuildDesk.use((desk) => desk.rerunning(mission.id)),
                (left) => left.length === 0,
              ),
              LONG,
            )
            return {
              meanwhile,
              after: yield* errors(mission.id),
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
            }
          }),
        ),
      )
      expect(seen.meanwhile.map((one) => one.fields)).toEqual([])
      expect(seen.after).toEqual([])
      expect(seen.stage).toBe('review')
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
    },
  )
  test(
    'an environment need’s Retry that commits while the refresh reads what is left stale raises no "stayed stale" error',
    SLOW,
    async () => {
      let proofCommand = ''
      let portHeld = false
      // The Retry's rerun, held once it ran and before its result is recorded.
      let arming = false
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      // A pass of the end, held once it read who a Retry runs again, before it reads the proofs.
      let reading = false
      const between = Deferred.makeUnsafe<void>()
      const read = Deferred.makeUnsafe<void>()
      // Each pass of the end over its steps, numbered as it begins, and those that finished.
      let begun = 0
      const finished: Array<number> = []
      const { world, run } = ending({
        proofMinute: Duration.seconds(2),
        hold: (at) =>
          at === 'greening' && arming
            ? Effect.gen(function* () {
                arming = false
                yield* Deferred.succeed(reached, undefined)
                yield* Deferred.await(go)
              })
            : Effect.void,
        endHold: (at) =>
          at === 'proofs_reading' && reading
            ? Effect.gen(function* () {
                reading = false
                yield* Deferred.succeed(between, undefined)
                yield* Deferred.await(read)
              })
            : Effect.sync(() => {
                if (at === 'advancing') begun += 1
                if (at === 'advanced') finished.push(begun)
              }),
      })
      const errors = (missionId: string) =>
        Effect.map(getMission(missionId), (one) =>
          one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
        )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              (projectId) =>
                Effect.gen(function* () {
                  yield* withReadme(projectId)
                  yield* setProofLimit(projectId, 1)
                  const saved = yield* saveCommand({
                    projectId,
                    id: null,
                    command: {
                      name: 'export proof',
                      type: 'script',
                      line: `"${process.execPath}" --test --test-reporter=tap api/tests/export.test.mjs`,
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
                    },
                  })
                  proofCommand = saved.id
                  // Free until the refresh; then another mission's service holds the port.
                  const runs = yield* Runs
                  const real = runs.reservations.current
                  runs.reservations.current = {
                    enter: (asked) =>
                      asked.commandId === proofCommand && portHeld
                        ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                        : real.enter(asked),
                  }
                }),
              undefined,
              PLAN,
              undefined,
              undefined,
              () => ({
                'R1.S2': {
                  mode: 'automated',
                  actions: ['Run the test'],
                  starting_data: 'None.',
                  expected: 'The assertion of the test holds.',
                  test: {
                    repository: 'api',
                    path: 'tests/export.test.mjs',
                    code: markdownTest,
                    insertion: 'new_file',
                    command: proofCommand,
                  },
                  seen_today: false,
                },
              }),
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId, 'export const toMarkdown = () => ""\n')
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // RV1 keeps the proof passing on a new tree: the refresh runs it again, and its rerun
            // waits for the port until the Project's limit.
            portHeld = true
            yield* specialDone(
              builder.grantId,
              'RV1',
              'export.ts',
              'export const toMarkdown = () => "md"\n',
            )
            yield* documented(world, mission.id, 2)
            const environment = Effect.map(getMission(mission.id), (one) =>
              one.needs.find((need) => Predicate.isTagged(need.fields, 'Environment')),
            )
            yield* until(
              Effect.map(environment, (need) => need !== undefined),
              LONG,
            )
            const need = yield* environment
            if (need === undefined) return yield* Effect.die(new Error('no environment need'))
            // The end is driven, and its pass is held once it read who a Retry runs again, before
            // it reads the proofs.
            reading = true
            const from = begun
            yield* mutate('driving the end', () =>
              Effect.succeed({
                result: undefined,
                events: [buildingEvent(mission.id, 'building.end_retried')],
              }),
            )
            yield* Deferred.await(between)
            // The user frees the port and Retries in between: the rerun runs, and is held before
            // its record.
            portHeld = false
            arming = true
            yield* retryNeed(need.id)
            yield* Deferred.await(reached)
            yield* Deferred.succeed(read, undefined)
            yield* until(
              Effect.sync(() => finished.some((one) => one > from)),
              LONG,
            )
            const meanwhile = yield* errors(mission.id)
            yield* Deferred.succeed(go, undefined)
            yield* until(
              Effect.gen(function* () {
                for (const index of world.agents.keys()) world.release(index)
                const stage = (yield* getMission(mission.id)).stage
                return stage === 'review' || (yield* errors(mission.id)).length > 0
              }),
              LONG,
            )
            // Recorded, the rerun is no longer said to run: a later stale proof is judged again.
            yield* until(
              Effect.map(
                BuildDesk.use((desk) => desk.rerunning(mission.id)),
                (left) => left.length === 0,
              ),
              LONG,
            )
            return {
              meanwhile,
              after: yield* errors(mission.id),
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
            }
          }),
        ),
      )
      expect(seen.meanwhile.map((one) => one.fields)).toEqual([])
      expect(seen.after).toEqual([])
      expect(seen.stage).toBe('review')
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
    },
  )
  test(
    'a Retry’s rerun recorded while the refresh reads what is left stale raises no "stayed stale" error',
    SLOW,
    async () => {
      let proofCommand = ''
      let portHeld = false
      // The Retry's rerun, held once it ran and before its result is recorded.
      let arming = false
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      // A pass of the end, held once it read the proofs, before it reads again who a Retry runs.
      let reading = false
      const between = Deferred.makeUnsafe<void>()
      const read = Deferred.makeUnsafe<void>()
      // Each pass of the end over its steps, numbered as it begins, and those that finished.
      let begun = 0
      const finished: Array<number> = []
      const { world, run } = ending({
        proofMinute: Duration.seconds(2),
        hold: (at) =>
          at === 'greening' && arming
            ? Effect.gen(function* () {
                arming = false
                yield* Deferred.succeed(reached, undefined)
                yield* Deferred.await(go)
              })
            : Effect.void,
        endHold: (at) =>
          at === 'retries_reading' && reading
            ? Effect.gen(function* () {
                reading = false
                yield* Deferred.succeed(between, undefined)
                yield* Deferred.await(read)
              })
            : Effect.sync(() => {
                if (at === 'advancing') begun += 1
                if (at === 'advanced') finished.push(begun)
              }),
      })
      const errors = (missionId: string) =>
        Effect.map(getMission(missionId), (one) =>
          one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
        )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              (projectId) =>
                Effect.gen(function* () {
                  yield* withReadme(projectId)
                  yield* setProofLimit(projectId, 1)
                  const saved = yield* saveCommand({
                    projectId,
                    id: null,
                    command: {
                      name: 'export proof',
                      type: 'script',
                      line: `"${process.execPath}" --test --test-reporter=tap api/tests/export.test.mjs`,
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
                    },
                  })
                  proofCommand = saved.id
                  // Free until the refresh; then another mission's service holds the port.
                  const runs = yield* Runs
                  const real = runs.reservations.current
                  runs.reservations.current = {
                    enter: (asked) =>
                      asked.commandId === proofCommand && portHeld
                        ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                        : real.enter(asked),
                  }
                }),
              undefined,
              PLAN,
              undefined,
              undefined,
              () => ({
                'R1.S2': {
                  mode: 'automated',
                  actions: ['Run the test'],
                  starting_data: 'None.',
                  expected: 'The assertion of the test holds.',
                  test: {
                    repository: 'api',
                    path: 'tests/export.test.mjs',
                    code: markdownTest,
                    insertion: 'new_file',
                    command: proofCommand,
                  },
                  seen_today: false,
                },
              }),
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId, 'export const toMarkdown = () => ""\n')
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // RV1 keeps the proof passing on a new tree: the refresh runs it again, and its rerun
            // waits for the port until the Project's limit.
            portHeld = true
            yield* specialDone(
              builder.grantId,
              'RV1',
              'export.ts',
              'export const toMarkdown = () => "md"\n',
            )
            yield* documented(world, mission.id, 2)
            const environment = Effect.map(getMission(mission.id), (one) =>
              one.needs.find((need) => Predicate.isTagged(need.fields, 'Environment')),
            )
            yield* until(
              Effect.map(environment, (need) => need !== undefined),
              LONG,
            )
            const need = yield* environment
            if (need === undefined) return yield* Effect.die(new Error('no environment need'))
            // The user frees the port and Retries: the rerun runs, and is held before its record.
            portHeld = false
            arming = true
            yield* retryNeed(need.id)
            yield* Deferred.await(reached)
            // The end is driven, and its pass is held once it read the proofs, the rerun's still
            // to run again.
            reading = true
            const from = begun
            yield* mutate('driving the end', () =>
              Effect.succeed({
                result: undefined,
                events: [buildingEvent(mission.id, 'building.end_retried')],
              }),
            )
            yield* Deferred.await(between)
            // In between, the rerun is recorded, and is no longer said to run.
            yield* Deferred.succeed(go, undefined)
            yield* until(
              Effect.map(
                BuildDesk.use((desk) => desk.rerunning(mission.id)),
                (left) => left.length === 0,
              ),
              LONG,
            )
            yield* Deferred.succeed(read, undefined)
            yield* until(
              Effect.sync(() => finished.some((one) => one > from)),
              LONG,
            )
            const meanwhile = yield* errors(mission.id)
            yield* until(
              Effect.gen(function* () {
                for (const index of world.agents.keys()) world.release(index)
                const stage = (yield* getMission(mission.id)).stage
                return stage === 'review' || (yield* errors(mission.id)).length > 0
              }),
              LONG,
            )
            return {
              meanwhile,
              after: yield* errors(mission.id),
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
            }
          }),
        ),
      )
      expect(seen.meanwhile.map((one) => one.fields)).toEqual([])
      expect(seen.after).toEqual([])
      expect(seen.stage).toBe('review')
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
    },
  )
  test(
    'a Retry’s rerun at the refresh that passes on a tree moved meanwhile is run again, never left stale',
    SLOW,
    async () => {
      let proofCommand = ''
      let portHeld = false
      // The Retry's rerun, held once it ran and before its result is recorded.
      let arming = false
      const reached = Deferred.makeUnsafe<void>()
      const go = Deferred.makeUnsafe<void>()
      // Each pass of the end over its steps, numbered as it begins, and those that finished.
      let begun = 0
      const finished: Array<number> = []
      let taking: SnapshotsService | null = null
      const { world, run } = ending({
        snapshots: (real) => {
          taking = real
          return real
        },
        // Its compare would drive the end on the change below: only the fix may.
        outside: { compareEveryMillis: 3_600_000 },
        proofMinute: Duration.seconds(2),
        hold: (at) =>
          at === 'greening' && arming
            ? Effect.gen(function* () {
                arming = false
                yield* Deferred.succeed(reached, undefined)
                yield* Deferred.await(go)
              })
            : Effect.void,
        endHold: (at) =>
          Effect.sync(() => {
            if (at === 'advancing') begun += 1
            if (at === 'advanced') finished.push(begun)
          }),
      })
      const errors = (missionId: string) =>
        Effect.map(getMission(missionId), (one) =>
          one.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
        )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              (projectId) =>
                Effect.gen(function* () {
                  yield* withReadme(projectId)
                  yield* setProofLimit(projectId, 1)
                  const saved = yield* saveCommand({
                    projectId,
                    id: null,
                    command: {
                      name: 'export proof',
                      type: 'script',
                      line: `"${process.execPath}" --test --test-reporter=tap api/tests/export.test.mjs`,
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
                    },
                  })
                  proofCommand = saved.id
                  // Free until the refresh; then another mission's service holds the port.
                  const runs = yield* Runs
                  const real = runs.reservations.current
                  runs.reservations.current = {
                    enter: (asked) =>
                      asked.commandId === proofCommand && portHeld
                        ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                        : real.enter(asked),
                  }
                }),
              undefined,
              PLAN,
              undefined,
              undefined,
              () => ({
                'R1.S2': {
                  mode: 'automated',
                  actions: ['Run the test'],
                  starting_data: 'None.',
                  expected: 'The assertion of the test holds.',
                  test: {
                    repository: 'api',
                    path: 'tests/export.test.mjs',
                    code: markdownTest,
                    insertion: 'new_file',
                    command: proofCommand,
                  },
                  seen_today: false,
                },
              }),
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId, 'export const toMarkdown = () => ""\n')
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('export.ts', 'Name the export after CSV.'),
            ])
            yield* specialAvailable(mission.id, 'RV1')
            // RV1 keeps the proof passing on a new tree: the refresh runs it again, and its rerun
            // waits for the port until the Project's limit.
            portHeld = true
            yield* specialDone(
              builder.grantId,
              'RV1',
              'export.ts',
              'export const toMarkdown = () => "md"\n',
            )
            yield* documented(world, mission.id, 2)
            const environment = Effect.map(getMission(mission.id), (one) =>
              one.needs.find((need) => Predicate.isTagged(need.fields, 'Environment')),
            )
            yield* until(
              Effect.map(environment, (need) => need !== undefined),
              LONG,
            )
            const need = yield* environment
            if (need === undefined) return yield* Effect.die(new Error('no environment need'))
            // The user frees the port and Retries: the rerun runs, and is held before its record.
            portHeld = false
            arming = true
            yield* retryNeed(need.id)
            yield* Deferred.await(reached)
            // Meanwhile the end is driven (the Builder's turn on the Retry ends, say): a whole
            // pass over its steps, begun once the rerun was held.
            const from = begun
            yield* mutate('driving the end', () =>
              Effect.succeed({
                result: undefined,
                events: [buildingEvent(mission.id, 'building.end_retried')],
              }),
            )
            yield* until(
              Effect.sync(() => finished.some((one) => one > from)),
              LONG,
            )
            const meanwhile = yield* errors(mission.id)
            // A change lands, and a snapshot sees it, while the rerun is held: it passed on a tree
            // that is no longer the current one.
            const api = yield* apiOf(mission.id)
            writtenInWorkspace(api, 'notes.md', 'A note of the user.\n')
            if (taking === null) return yield* Effect.die(new Error('no snapshots'))
            yield* taking.take(
              { name: 'api', folder: api },
              { kind: 'run', missionId: mission.id, runId: crypto.randomUUID(), side: 'before' },
            )
            const proven = Effect.map(buildingNow(mission.id), (view) =>
              view.requirements
                .flatMap((one) => one.scenarios)
                .find((one) => one.scenario === 'R1.S2'),
            )
            yield* Deferred.succeed(go, undefined)
            // Recorded stale, no longer said to run: the end is judged again and runs it again,
            // with no agent's turn to drive it.
            yield* until(
              Effect.map(proven, (proof) => proof?.state === 'green'),
              LONG,
            )
            yield* until(
              Effect.gen(function* () {
                for (const index of world.agents.keys()) world.release(index)
                const stage = (yield* getMission(mission.id)).stage
                return stage === 'review' || (yield* errors(mission.id)).length > 0
              }),
              LONG,
            )
            return {
              meanwhile,
              after: yield* errors(mission.id),
              view: yield* buildingNow(mission.id),
              stage: (yield* getMission(mission.id)).stage,
            }
          }),
        ),
      )
      expect(seen.meanwhile.map((one) => one.fields)).toEqual([])
      expect(seen.after).toEqual([])
      expect(seen.stage).toBe('review')
      const proof = seen.view.requirements
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof).toMatchObject({ state: 'green', upToDate: true })
    },
  )
})

describe('A restart in the middle of the end', () => {
  test('a restart in the middle of the sequence resumes at its step', SLOW, async () => {
    const before = ending()
    const left = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          yield* builtAll(builder.grantId)
          yield* documented(before.world, mission.id)
          yield* reviewing(mission.id)
          return mission
        }),
      ),
    )
    const after = ending({ resumed: true })
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const spec = yield* reviewed(after.world, left.id, 'spec-reviewer')
          yield* reviewed(after.world, left.id, 'code-reviewer')
          yield* inReview(left.id)
          const database = yield* Database
          return {
            spec,
            documenter: yield* database.select().from(documenterPasses),
            checkpoints: yield* database.select().from(checkpoints),
            passes: yield* database.select().from(reviewPasses),
            types: yield* typesOf(left.id),
          }
        }),
      ),
    )
    expect(seen.spec.brief).toContain('[hemera:resume]')
    expect(seen.spec.brief).toContain(START_AGAIN)
    expect(seen.documenter).toHaveLength(1)
    expect(seen.checkpoints.filter((one) => one.kind === 'review')).toHaveLength(1)
    expect(seen.passes).toHaveLength(2)
    expect(seen.passes.every((one) => one.state === 'done')).toBe(true)
    expect(seen.types.filter((type) => type === 'building.end_started')).toHaveLength(1)
    expect(seen.types.filter((type) => type === 'building.ended')).toHaveLength(1)
  })

  test(
    'a restart between the checkpoint’s taking and its saving: one review checkpoint for the Building, no orphan',
    SLOW,
    async () => {
      const taken = held()
      const before = ending({
        // The engine stops once the review checkpoint is taken, before the end moves on.
        endHold: (at) =>
          at === 'checkpoint_taken'
            ? Effect.andThen(
                Effect.sync(() => taken.release()),
                Effect.never,
              )
            : Effect.void,
      })
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(before.world, mission.id)
            yield* Effect.promise(() => taken.promise)
            return mission
          }),
        ),
      )
      const after = ending({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* reviewed(after.world, left.id, 'spec-reviewer')
            yield* reviewed(after.world, left.id, 'code-reviewer')
            yield* inReview(left.id)
            const database = yield* Database
            return {
              checkpoints: yield* database
                .select()
                .from(checkpoints)
                .where(and(eq(checkpoints.missionId, left.id), eq(checkpoints.kind, 'review'))),
              buildings: yield* database
                .select()
                .from(buildings)
                .where(eq(buildings.missionId, left.id)),
              passes: yield* database.select().from(reviewPasses),
            }
          }),
        ),
      )
      expect(seen.checkpoints).toHaveLength(1)
      const [checkpoint] = seen.checkpoints
      expect(seen.buildings.map((one) => one.reviewCheckpointId)).toEqual([checkpoint?.id])
      expect(seen.passes.map((one) => one.checkpointId)).toEqual([checkpoint?.id, checkpoint?.id])
    },
  )

  test('a restart during the documenter’s pass runs the pass again', SLOW, async () => {
    const before = ending()
    const left = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          yield* builtAll(builder.grantId)
          yield* agentOf(before.world, mission.id, 'documenter')
          return mission
        }),
      ),
    )
    const after = ending({ resumed: true })
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* documented(after.world, left.id)
          yield* reviewed(after.world, left.id, 'spec-reviewer')
          yield* reviewed(after.world, left.id, 'code-reviewer')
          yield* inReview(left.id)
          const database = yield* Database
          return {
            documenter: yield* database
              .select()
              .from(documenterPasses)
              .orderBy(asc(documenterPasses.number)),
            mission: yield* getMission(left.id),
          }
        }),
      ),
    )
    expect(seen.documenter.map((one) => `${one.mode} ${one.state}`)).toEqual([
      'full failed',
      'full reported',
    ])
    expect(seen.mission.needs).toEqual([])
  })

  test(
    'a restart while a red of the final checks waits for the Builder counts no red until its turn ends',
    SLOW,
    async () => {
      let fixed = false
      const checks: ChecksOf = ({ scope }) => {
        if (scope !== 'end') return []
        return fixed ? [GREEN] : [RED]
      }
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
              yield* Effect.sleep('500 millis')
              return mission
            }),
          ),
        )
        .finally(() => turn.release())
      const after = ending({ checks, resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(
              Effect.sync(() => after.world.agents.length > 0),
              LONG,
            )
            // Long enough for a judgement at the start to have run.
            yield* Effect.sleep('1 second')
            const waited = yield* endAttempts(left.id)
            fixed = true
            for (const index of after.world.agents.keys()) after.world.release(index)
            yield* reviewed(after.world, left.id, 'spec-reviewer')
            yield* reviewed(after.world, left.id, 'code-reviewer')
            yield* inReview(left.id)
            return { waited, judged: yield* endAttempts(left.id) }
          }),
        ),
      )
      expect(seen.waited).toEqual(['red', null])
      expect(seen.judged).toEqual(['red', 'green'])
    },
  )

  test(
    'after a restart, a stopped Builder a red of the final checks waits on is brought back only once the start settled what the stop left',
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
              // The Builder stops with no need of its own before the engine does.
              yield* Database.use((database) =>
                database
                  .update(agentSessions)
                  .set({ state: 'ended', stateReason: null, endedAt: new Date().toISOString() })
                  .where(eq(agentSessions.id, builder.session.id)),
              )
              return { mission, lineage: builder.session.lineage }
            }),
          ),
        )
        .finally(() => turn.release())
      // Started again, the start's resume is held before it settles what the stop left.
      const settling = held()
      const after = ending({
        checks,
        resumed: true,
        hold: (at) => (at === 'resuming' ? Effect.promise(() => settling.promise) : Effect.void),
      })
      const seen = await after
        .run(({ profile }) =>
          within(
            profile,
            Effect.gen(function* () {
              const lineage = sessionsOfLineage(left.lineage)
              // Long enough for the end, driven at the start, to have brought it back.
              yield* Effect.sleep('2 seconds')
              const waited = yield* lineage
              settling.release()
              yield* until(
                Effect.map(lineage, (rows) =>
                  ['starting', 'working', 'idle'].includes(rows.at(-1)?.state ?? ''),
                ),
                LONG,
              )
              return { waited, lineage: yield* lineage }
            }),
          ),
        )
        .finally(() => settling.release())
      expect(seen.waited.map((one) => one.state)).toEqual(['ended'])
      expect(seen.lineage).toHaveLength(2)
    },
  )

  test(
    'a restart in the middle of the exit does not bring the Builder back: nothing of its tree runs in Review',
    SLOW,
    async () => {
      const stopped = held()
      const before = ending({
        snapshots: (real) => ({
          ...real,
          // The engine stops as the exit looks at the Workspace: the tree is stopped already.
          take: (place, owner) =>
            owner.kind === 'review_exit'
              ? Effect.andThen(
                  Effect.sync(() => stopped.release()),
                  Effect.never,
                )
              : real.take(place, owner),
        }),
      })
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(before.world, mission.id)
            yield* reviewed(before.world, mission.id, 'spec-reviewer')
            yield* reviewed(before.world, mission.id, 'code-reviewer')
            yield* Effect.promise(() => stopped.promise)
            return mission
          }),
        ),
      )
      // Started again, the Builder's resume is held until the exit looks at the Workspace once
      // more, and that look until the resume went past the Builder: the resume lands inside the
      // exit, after its stops.
      const looking = held()
      const resumed = held()
      let first = true
      const after = ending({
        resumed: true,
        hold: (at) => {
          if (at === 'resuming') return Effect.promise(() => looking.promise)
          if (at === 'resumed') return Effect.sync(() => resumed.release())
          return Effect.void
        },
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind !== 'review_exit' || !first) return real.take(place, owner)
            first = false
            looking.release()
            return Effect.andThen(
              Effect.promise(() => resumed.promise),
              real.take(place, owner),
            )
          },
        }),
      })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* inReview(left.id)
            yield* Effect.promise(() => resumed.promise)
            return {
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: left.id,
              }),
              mission: yield* getMission(left.id),
            }
          }),
        ),
      )
      expect(seen.live.map((one) => one.role)).toEqual([])
      expect(seen.mission.needs).toEqual([])
    },
  )

  test(
    'a Builder resume that lands between the exit’s stops and its commit sends the commit back, and the exit runs again',
    SLOW,
    async () => {
      const before = ending()
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(before.world, mission.id)
            yield* reviewing(mission.id)
            return mission
          }),
        ),
      )
      // Started again, the Builder's resume reads the end's step while the reviewers run, then is
      // held until the exit's stops are done: it brings the Builder back between them and the
      // commit, and the exit's first look at the Workspace waits for it.
      const stopped = held()
      const resumed = held()
      let exits = 0
      const after = ending({
        resumed: true,
        hold: (at) => {
          if (at === 'bringing') return Effect.promise(() => stopped.promise)
          if (at === 'resumed') return Effect.sync(() => resumed.release())
          return Effect.void
        },
        snapshots: (real) => ({
          ...real,
          take: (place, owner) => {
            if (owner.kind !== 'review_exit') return real.take(place, owner)
            exits += 1
            if (exits > 1) return real.take(place, owner)
            stopped.release()
            return Effect.andThen(
              Effect.promise(() => resumed.promise),
              real.take(place, owner),
            )
          },
        }),
      })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* reviewed(after.world, left.id, 'spec-reviewer')
            yield* reviewed(after.world, left.id, 'code-reviewer')
            yield* inReview(left.id)
            return {
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: left.id,
              }),
              types: yield* typesOf(left.id),
            }
          }),
        ),
      )
      // The commit went back once: the exit stopped the resumed Builder and looked again.
      expect(exits).toBe(2)
      expect(seen.live.map((one) => one.role)).toEqual([])
      expect(seen.types.filter((type) => type === 'building.ended')).toHaveLength(1)
    },
  )

  test(
    'a restart after the Builder’s turn ended, while the final checks ran again, judges them once',
    SLOW,
    async () => {
      let ends = 0
      const before = ending({
        checks: ({ scope }) => {
          if (scope !== 'end') return []
          ends += 1
          return ends === 1 ? [RED] : null
        },
      })
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(before.world, mission.id)
            // The Builder's turn after the red ended: the checks run again, and never end.
            yield* until(
              Effect.sync(() => ends >= 2),
              LONG,
            )
            return mission
          }),
        ),
      )
      const after = ending({
        resumed: true,
        checks: ({ scope }) => (scope === 'end' ? [GREEN] : []),
      })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* reviewed(after.world, left.id, 'spec-reviewer')
            yield* reviewed(after.world, left.id, 'code-reviewer')
            yield* inReview(left.id)
            return { judged: yield* endAttempts(left.id), mission: yield* getMission(left.id) }
          }),
        ),
      )
      expect(seen.judged).toEqual(['red', 'green'])
      expect(seen.mission.needs).toEqual([])
    },
  )

  test(
    'a Builder resume that reaches the sessions once the exit moved the mission to Review starts nothing',
    SLOW,
    async () => {
      const engine = ending()
      const seen = await engine.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(engine.world, mission.id)
            yield* reviewed(engine.world, mission.id, 'spec-reviewer')
            yield* reviewed(engine.world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            // A start-up resume that read the Building before the exit's stops reaches the
            // sessions only now: the exit's commit is in.
            const rows = yield* sessionsOfLineage(builder.session.lineage)
            const resumed = yield* Sessions.use((sessions) =>
              sessions.resume(rows.at(-1)?.id ?? ''),
            )
            return {
              resumed,
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: mission.id,
              }),
            }
          }),
        ),
      )
      expect(seen.resumed).toBeNull()
      expect(seen.live.map((one) => one.role)).toEqual([])
    },
  )

  test(
    'a restart that finds the Builder live once the mission is in Review ends it and starts no successor',
    SLOW,
    async () => {
      const before = ending()
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(before.world, mission.id)
            yield* reviewed(before.world, mission.id, 'spec-reviewer')
            yield* reviewed(before.world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            // What a restart reads when it took the live sessions before the exit stopped the
            // tree, and replaces them only after the exit's commit: the Builder still live.
            const rows = yield* sessionsOfLineage(builder.session.lineage)
            const database = yield* Database
            yield* database
              .update(agentSessions)
              .set({ state: 'idle', stateReason: null, endedAt: null })
              .where(eq(agentSessions.id, rows.at(-1)?.id ?? ''))
            return { mission, lineage: builder.session.lineage, sessions: rows.length }
          }),
        ),
      )
      const after = ending({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const lineage = sessionsOfLineage(left.lineage)
            yield* until(
              Effect.map(lineage, (rows) =>
                rows.every((one) => !['starting', 'working', 'idle', 'stuck'].includes(one.state)),
              ),
              LONG,
            )
            return {
              lineage: yield* lineage,
              live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                kind: 'mission',
                missionId: left.mission.id,
              }),
            }
          }),
        ),
      )
      expect(seen.live.map((one) => one.role)).toEqual([])
      expect(seen.lineage).toHaveLength(left.sessions)
    },
  )
})
