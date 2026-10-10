/**
 * The task engine and the Builder (#141): a launched mission's Building starts with its tasks, a
 * Builder chooses from the ready set, claims keep two running tasks off each other's files, the
 * runner alone finishes or blocks its task, an amendment changes the plan only through the user's
 * answer, a restart resumes the Building with no human action, and the end calls its port once.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent and the test driving the
 * Builder's tools through its grant; Acme's real repositories in temporary folders as the
 * Workspace. Every wait is on state.
 */

import { realpathSync } from 'node:fs'

import { ChosenAnswer } from '@hemera/core/domain'
import { Effect, Layer, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  BuildingEnd,
  BuildingStart,
  TaskVerdict,
  buildingOf,
} from '../src/engine/building/builder.ts'
import { getMission, moveMission } from '../src/engine/missions.ts'
import { answerNeed } from '../src/engine/needs.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { getSession, openSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { call, eventsOf, grantOf } from './building-world.ts'
import {
  builderEngine,
  builderOf,
  buildingNow,
  launched,
  statesOf,
  taskIn,
} from './builder-world.ts'
import { text, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-tasks'))
  work = realpathSync.native(temporaryFolder('building-tasks-work'))
})
afterEach(removeFolders)

/** Everything the agents were sent, in order, as text. */
const promptsOf = (world: {
  readonly agents: ReadonlyArray<{
    answers: { prompts: ReadonlyArray<ReadonlyArray<{ type: string; text?: string }>> }
  }>
}) => world.agents.flatMap((agent) => agent.answers.prompts.map((prompt) => text(prompt)))

/** The Builder starts a task and says it is finished. */
const builds = (grantId: string, taskId: string) =>
  Effect.gen(function* () {
    yield* call(grantId, 'task_start', { task: taskId })
    return yield* call(grantId, 'task_finished', { task: taskId, summary: `${taskId} built.` })
  })

/** A helper session of the mission, in the Builder's Workspace, and its grant. */
const helperOf = (missionId: string, folder: string) =>
  Effect.gen(function* () {
    const helper = yield* openSession({
      provider: 'claude',
      owner: { kind: 'mission', missionId },
      role: 'helper',
      folder,
      parent: null,
      chosen: { model: null, effort: null, mode: null },
      modelLevel: null,
    })
    return yield* grantOf(helper.id)
  })

const REPLACE_T2 = {
  task: 'T2',
  kind: 'impossible',
  reason: 'Markdown needs two steps: read, then write.',
  options: ['Split it in two', 'Keep it whole'],
  recommended: 'Split it in two',
  recommended_reason: 'Each half is small and testable.',
  amendment: {
    kind: 'replace',
    task: 'T2',
    by: [
      {
        id: 'T2a',
        title: 'Read the invoices',
        result: 'The invoices are read.',
        requirements: ['R1'],
        scenarios: ['R1.S2'],
        targets: [{ repository: 'api', path: 'read.ts', intent: 'create' }],
        depends_on: [],
      },
      {
        id: 'T2b',
        title: 'Write the Markdown',
        result: 'The Markdown is written.',
        requirements: ['R1'],
        scenarios: [],
        targets: [{ repository: 'api', path: 'export.ts', intent: 'create' }],
        depends_on: ['T2a'],
      },
    ],
  },
}

describe('The start makes the ready set available, and a delivery lists what becomes available', () => {
  test('T1 and T2 are available at once, T3 only once both are done', async () => {
    const { world, run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          const first = statesOf(yield* buildingNow(mission.id))
          yield* builds(grantId, 'T1')
          const between = statesOf(yield* buildingNow(mission.id))
          yield* builds(grantId, 'T2')
          yield* taskIn(mission.id, 'T3', 'available')
          yield* until(
            Effect.sync(() => promptsOf(world).some((one) => one.includes('[hemera:ready]'))),
          )
          return { first, between, started: yield* eventsOf(mission.id, 'building.started') }
        }),
      ),
    )
    expect(seen.first).toEqual({ T1: 'available', T2: 'available', T3: 'waiting', T4: 'available' })
    expect(seen.between['T3']).toBe('waiting')
    expect(seen.started).toHaveLength(1)
    const prompts = promptsOf(world)
    // The cold read's agent is the first; the Builder's first prompt is its brief.
    const brief = text(world.agents[1]?.answers.prompts[0] ?? [])
    expect(brief).toContain('Builder · ACME-1')
    const readySet = brief.split('## Ready set')[1]?.split('\n## ')[0] ?? ''
    expect(readySet).toMatch(/T1 · Export as CSV[\s\S]*T2 · Export as Markdown/)
    expect(readySet).not.toContain('T3 · Document')
    const ready = prompts.filter((one) => one.includes('[hemera:ready]')).at(-1) ?? ''
    expect(ready).toContain('T3 · Document the exports')
  })
})

describe('Available, chosen, started (CT-32)', () => {
  test('a task not started stays available after a turn with other calls; task_start opens its attempt on its start snapshot', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'build_read', {})
          yield* call(grantId, 'spec_read', {})
          const after = statesOf(yield* buildingNow(mission.id))
          const answer = yield* call(grantId, 'task_start', { task: 'T1' })
          return { after, answer, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.after['T1']).toBe('available')
    expect(seen.answer).toMatch(/T1 started/)
    const t1 = seen.view.tasks.find((task) => task.id === 'T1')
    expect(t1?.state).toBe('in_progress')
    expect(t1?.attempts).toHaveLength(1)
    expect(t1?.attempts[0]?.starts.map((one) => one.repository)).toEqual(['api'])
    expect(t1?.attempts[0]?.starts[0]?.tree).toMatch(/^[0-9a-f]{40}$/)
    expect(t1?.attempts[0]?.endedAt).toBeNull()
  })

  test('task_start on a task whose files a running task holds names the holder; the task is delivered again once they are free', async () => {
    const { world, run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          const refused = yield* call(grantId, 'task_start', { task: 'T4' })
          const waiting = statesOf(yield* buildingNow(mission.id))
          const before = promptsOf(world).length
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'Done.' })
          yield* until(
            Effect.sync(() =>
              promptsOf(world)
                .slice(before)
                .some((one) => one.includes('[hemera:ready]') && one.includes('T4 ·')),
            ),
          )
          return { refused, waiting }
        }),
      ),
    )
    expect(seen.refused).toBe(
      'T4 waits: api/invoices.ts is held by T1 (Export as CSV), which runs now. It is delivered again once T1 releases it.',
    )
    expect(seen.waiting['T4']).toBe('available')
  })
})

describe('Claims: a file held by another running task is refused, a file outside the targets is recorded', () => {
  test('the helper is refused T1’s file, naming T1; the Builder’s write outside its targets is recorded', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          const helper = yield* helperOf(mission.id, session.folder)
          const refused = yield* call(helper, 'fs_write', {
            repository: 'api',
            path: 'invoices.ts',
            content: 'export const invoices = [1]\n',
          })
          const outside = yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'notes.md',
            content: 'A note.\n',
          })
          return { refused, outside, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.refused).toBe(
      'refused: api/invoices.ts is held by T1 (Export as CSV), which runs now: leave it, or wait for T1.',
    )
    expect(seen.outside).not.toMatch(/^refused/)
    const t1 = seen.view.tasks.find((task) => task.id === 'T1')
    expect(t1?.attempts[0]?.outside).toEqual(['api/notes.md'])
  })
})

describe('Only the runner at the current epoch finishes its task', () => {
  test('another session, then the replaced Builder, are refused; the default verdict says done, not verified', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          const helper = yield* helperOf(mission.id, session.folder)
          const notRunner = yield* call(helper, 'task_finished', { task: 'T1', summary: 'Mine.' })
          const fresh = yield* Sessions.use((sessions) => sessions.replace(session.id, 'a test'))
          const oldEpoch = yield* call(grantId, 'task_finished', { task: 'T1', summary: 'Old.' })
          yield* until(Effect.map(getSession(fresh?.id ?? ''), (one) => one.state === 'idle'))
          const newGrant = yield* grantOf(fresh?.id ?? '')
          const done = yield* call(newGrant, 'task_finished', { task: 'T1', summary: 'Done.' })
          return { notRunner, oldEpoch, done, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.notRunner).toBe(
      'refused: T1 is run by another session: only its runner says it is finished.',
    )
    // The replace revokes the old session's grant: its call names it ended.
    expect(seen.oldEpoch).toBe('refused: this session has ended')
    expect(seen.done).toMatch(/T1 is done, not verified/)
    const t1 = seen.view.tasks.find((task) => task.id === 'T1')
    expect([t1?.state, t1?.verified]).toEqual(['done', false])
    expect(seen.view.percent).toBe(25)
  })
})

describe('A need blocks its task and its dependants, not the build', () => {
  test('task_blocked blocks T1 and T3 only; T2 and T4 go on, and the decision is a need', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          const answer = yield* call(grantId, 'task_blocked', {
            task: 'T1',
            kind: 'decision',
            reason: 'The CSV separator is not settled.',
            options: ['Comma', 'Semicolon'],
            recommended: 'Comma',
            recommended_reason: 'It is the default of every spreadsheet.',
          })
          const view = yield* buildingNow(mission.id)
          return { answer, view, mission: yield* getMission(mission.id) }
        }),
      ),
    )
    expect(seen.answer).toMatch(/T1 is blocked/)
    expect(statesOf(seen.view)).toEqual({
      T1: 'blocked',
      T2: 'available',
      T3: 'blocked',
      T4: 'available',
    })
    expect(seen.view.tasks.find((task) => task.id === 'T3')?.blockedBy).toBe('T1 is blocked')
    const [need] = seen.mission.needs
    expect(need?.owner).toMatchObject({ missionId: seen.mission.id, taskId: 'T1' })
    expect(Predicate.isTagged(need?.fields, 'Decision') ? need?.fields.options : []).toEqual([
      'Comma',
      'Semicolon',
    ])
  })

  test('report_need of kind error or permission is refused', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          const asked = (kind: string) =>
            call(grantId, 'report_need', { kind, text: 'Something failed.', tasks: [] })
          return {
            error: yield* asked('error'),
            permission: yield* asked('permission'),
            mission: yield* getMission(mission.id),
          }
        }),
      ),
    )
    expect(seen.error).toMatch(/^refused: the arguments of report_need do not read/)
    expect(seen.permission).toMatch(/^refused: the arguments of report_need do not read/)
    expect(seen.mission.needs).toEqual([])
  })
})

describe('An amendment changes the plan only through the user’s answer (CT-33)', () => {
  test('removing T2, whose scenario no other task covers, is refused, and nothing is asked', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T2' })
          const answer = yield* call(grantId, 'task_blocked', {
            ...REPLACE_T2,
            amendment: { kind: 'remove', task: 'T2', reason: 'Markdown is not needed.' },
          })
          const view = yield* buildingNow(mission.id)
          return { answer, view, mission: yield* getMission(mission.id) }
        }),
      ),
    )
    expect(seen.answer).toBe(
      'refused: the amendment does not apply: Removing T2 leaves R1.S2 covered by no task of the plan.',
    )
    expect(statesOf(seen.view)['T2']).toBe('in_progress')
    expect(seen.mission.needs).toEqual([])
  })

  test('replacing T2 with T2a and T2b applies on the answer: T2 skipped, T3 waits for both', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1')
          yield* call(grantId, 'task_start', { task: 'T2' })
          yield* call(grantId, 'task_blocked', REPLACE_T2)
          const asked = statesOf(yield* buildingNow(mission.id))
          const [need] = (yield* getMission(mission.id)).needs
          yield* answerNeed({
            id: need?.id ?? '',
            answer: ChosenAnswer.make({ option: 'Split it in two' }),
            key: 'answer-1',
          })
          yield* taskIn(mission.id, 'T2a', 'available')
          const answered = statesOf(yield* buildingNow(mission.id))
          yield* builds(grantId, 'T2a')
          const half = statesOf(yield* buildingNow(mission.id))
          yield* builds(grantId, 'T2b')
          yield* taskIn(mission.id, 'T3', 'available')
          const spec = yield* call(grantId, 'spec_read', {})
          return { asked, answered, half, spec, need, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.asked['T2']).toBe('blocked')
    expect(seen.asked['T2a']).toBeUndefined()
    const fields = seen.need?.fields
    expect(Predicate.isTagged(fields, 'Decision') ? fields.question : '').toContain(
      'T2 is replaced by T2a (Read the invoices) and T2b (Write the Markdown).',
    )
    expect(seen.answered).toMatchObject({
      T2: 'skipped',
      T2a: 'available',
      T2b: 'waiting',
      T3: 'waiting',
    })
    expect(seen.half).toMatchObject({ T2b: 'available', T3: 'waiting' })
    expect(seen.view.decisions).toEqual([
      expect.objectContaining({
        answer: 'Split it in two',
        amendment: 'T2 is replaced by T2a (Read the invoices) and T2b (Write the Markdown).',
        applied: true,
      }),
    ])
    expect(seen.spec).toContain('Decisions taken during Building')
    expect(seen.spec).toMatch(/T2a · Read the invoices/)
  })
})

describe('A restart resumes the Building with no human action', () => {
  test('a fresh Builder with the resume block, the same states, the attempt still open; a task left checking is judged again', async () => {
    const holding = Layer.succeed(TaskVerdict, { judge: () => Effect.succeed('pending' as const) })
    const before = builderEngine(data, work, { verdict: holding })
    const first = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session, grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1')
          yield* call(grantId, 'task_start', { task: 'T2' })
          return { mission, builder: session, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(statesOf(first.view)).toMatchObject({ T1: 'checking', T2: 'in_progress' })
    const after = builderEngine(data, work)
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(Effect.map(getSession(first.builder.id), (one) => one.state === 'replaced'))
          yield* taskIn(first.mission.id, 'T1', 'done')
          yield* until(Effect.sync(() => (after.world.agents[0]?.answers.prompts.length ?? 0) > 0))
          const live = yield* sessionsIn(['starting', 'working', 'idle'], {
            kind: 'mission',
            missionId: first.mission.id,
          })
          return {
            view: yield* buildingNow(first.mission.id),
            resumed: yield* eventsOf(first.mission.id, 'building.resumed'),
            builders: live.filter((one) => one.role === 'builder'),
          }
        }),
      ),
    )
    expect(statesOf(seen.view)).toMatchObject({ T1: 'done', T2: 'in_progress' })
    const t2 = seen.view.tasks.find((task) => task.id === 'T2')
    expect(t2?.attempts.map((one) => one.endedAt)).toEqual([null])
    expect(seen.resumed).toHaveLength(1)
    expect(seen.builders.map((one) => one.lineage)).toEqual([first.builder.lineage])
    expect(text(after.world.agents[0]?.answers.prompts[0] ?? [])).toContain('[hemera:resume]')
  })
})

describe('The end and Cancel', () => {
  test('every task done calls BuildingEnd once', async () => {
    const ended: string[] = []
    const end = Layer.succeed(BuildingEnd, {
      end: (missionId: string) => Effect.sync(() => ended.push(missionId)).pipe(Effect.asVoid),
    })
    const { run } = builderEngine(data, work, { end })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          for (const id of ['T1', 'T2', 'T4', 'T3']) yield* builds(grantId, id)
          yield* until(Effect.sync(() => ended.length > 0))
          const summary = yield* call(grantId, 'build_summary', { text: 'Built the exports.' })
          return { mission, summary, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(ended).toEqual([seen.mission.id])
    expect(seen.view.percent).toBe(100)
    expect(seen.view.summary).toBe('Built the exports.')
  })

  test('Cancel stops the Builder and ends the Building as cancelled; the work stays', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* moveMission(mission.id, 'cancel', 'user')
          yield* until(Effect.map(buildingOf(mission.id), (view) => view?.state === 'cancelled'))
          return { builder: yield* getSession(session.id), view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.builder.state).toBe('ended')
    expect(seen.view.state).toBe('cancelled')
    expect(statesOf(seen.view)['T1']).toBe('in_progress')
  })

  test('BuildingStart called again for a mission already started begins nothing', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          yield* builderOf(mission.id)
          yield* BuildingStart.use((port) => port.start(mission.id))
          const live = yield* sessionsIn(['starting', 'working', 'idle'], {
            kind: 'mission',
            missionId: mission.id,
          })
          return {
            builders: live.filter((one) => one.role === 'builder'),
            started: yield* eventsOf(mission.id, 'building.started'),
          }
        }),
      ),
    )
    expect(seen.builders).toHaveLength(1)
    expect(seen.started).toHaveLength(1)
  })
})
