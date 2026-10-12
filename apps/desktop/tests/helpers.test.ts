/**
 * The helpers of a Building (#145): a free helper launched on a task becomes its runner and hands
 * its result to its parent; the Prototyper writes only in its own folder and keeps its files as
 * evidence; the definitions, the depth, the cap and the budget refuse what they must; a helper's
 * call that asks becomes its mission's need; a stuck helper is flagged, told and replaced; a
 * restart rebuilds the tree and delivers what was queued, once; nothing stops a helper.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent and the test driving the
 * Builder's and the helpers' tools through their grants; Acme's real repositories in temporary
 * folders as the Workspace. Every wait is on state; the helpers' turns are held open, so none of
 * them ends on its own.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { PermissionAnswer, TOOL_NAMES, capRefusal, toolsOf } from '@hemera/core/domain'
import { HelpersRpcs } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { helperRowsOf, listHelpers } from '../src/engine/building/helper-store.ts'
import { setProjectLimits, projectLimits, spendBudget } from '../src/engine/budget.ts'
import { listEvidence } from '../src/engine/memory/evidence.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed, getNeed } from '../src/engine/needs.ts'
import { sessionsOfLineage } from '../src/engine/sessions/store.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingClaims,
  buildingTasks,
  helpers,
  permissionRequests,
  queuedResults,
  runnerLeases,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { callTool } from './tools-world.ts'
import { QUIET, READING, call, eventsOf, grantOf } from './building-world.ts'
import { builderOf, launched } from './builder-world.ts'
import { SILENCE, held, sessionsEngine, text, until, within } from './sessions-world.ts'
import { nodeLine, script } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('helpers'))
  work = realpathSync.native(temporaryFolder('helpers-work'))
})
afterEach(removeFolders)

/**
 * The engine with this version's roles: the cold read first, then the Builder, quiet; every agent
 * after them (the helpers) holds its turn open until the test lets it go, or ends it at once
 * when `quiet`.
 */
const helping = (options: Parameters<typeof sessionsEngine>[2] = {}, quiet = false) => {
  const hold = held()
  const working: FakeScript = quiet
    ? QUIET
    : { steps: [{ does: 'says', text: 'Working.' }], between: () => hold.promise }
  const first: ReadonlyArray<FakeScript> = [READING, QUIET]
  const engine = sessionsEngine(data, (index) => first[index] ?? working, {
    ...options,
    roles: [],
    tools: { home: work, ...options.tools },
  })
  return {
    world: engine.world,
    release: hold.release,
    run: <A, E>(program: Parameters<typeof engine.run<A, E>>[0]) =>
      engine.run(program).finally(hold.release),
  }
}

/** Each prompt an agent was sent, as text. */
const promptsOf = (
  agent:
    | { answers: { prompts: ReadonlyArray<ReadonlyArray<{ type: string; text?: string }>> } }
    | undefined,
) => agent?.answers.prompts.map((prompt) => text(prompt)) ?? []

/** The mission's helper of a number, once its session exists, and a grant the test drives it with. */
const helperNumbered = (missionId: string, number: number) =>
  Effect.gen(function* () {
    const sessionOf = Effect.gen(function* () {
      const row = (yield* helperRowsOf(missionId)).find((one) => one.number === number)
      if (row === undefined) return null
      const live = (yield* sessionsOfLineage(row.lineage)).filter((one) =>
        ['working', 'idle'].includes(one.state),
      )
      const session = live.toSorted((a, b) => b.epoch - a.epoch).at(0)
      return session === undefined ? null : { row, session }
    })
    yield* until(Effect.map(sessionOf, (found) => found !== null))
    const found = yield* sessionOf
    if (found === null) return yield* Effect.die(new Error(`no helper H${String(number)}`))
    return { ...found, grantId: yield* grantOf(found.session.id) }
  })

/** The task's row as the database holds it. */
const taskRow = (missionId: string, taskId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database.select().from(buildingTasks).where(eq(buildingTasks.id, taskId))
    const row = rows.at(0)
    if (row === undefined) return yield* Effect.die(new Error(`no task ${taskId} in ${missionId}`))
    return row
  })

/** Who holds a task's lease, and its epoch. */
const leaseOf = (taskId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database.select().from(runnerLeases)
    return rows.find((row) => row.workItem.endsWith(`:${taskId}`)) ?? null
  })

const claimRunners = (taskId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(buildingClaims)
      .where(eq(buildingClaims.taskId, taskId))
    return rows.map((row) => row.runner)
  })

const FREE_RESULT = {
  summary: 'The CSV export is written.',
  changed: [{ repository: 'api', path: 'invoices.ts' }],
  checked: ['Read the export by hand.'],
  left: [],
}

describe('A free helper launched on a task runs it and hands its result to its parent', () => {
  test('it becomes the runner, takes the claims, gets the brief, and its result reaches the parent as [hemera:result]', async () => {
    const { world, run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'task_start', { task: 'T1' })
          const answer = yield* callTool(builder.grantId, 'helper_launch', {
            brief: 'Write the CSV export of the invoices.',
            task: 'T1',
          })
          const helper = yield* helperNumbered(mission.id, 1)
          const task = yield* taskRow(mission.id, 'T1')
          const lease = yield* leaseOf('T1')
          const claims = yield* claimRunners('T1')
          yield* until(Effect.sync(() => promptsOf(world.agents[2]).length > 0))
          const result = yield* callTool(helper.grantId, 'helper_result', FREE_RESULT)
          yield* until(
            Effect.sync(() =>
              promptsOf(world.agents[1]).some((one) => one.includes('[hemera:result]')),
            ),
          )
          return {
            mission,
            builder,
            answer,
            helper,
            task,
            lease,
            claims,
            result,
            chips: yield* listHelpers(mission.id),
            launchedEvents: yield* eventsOf(mission.id, 'helper.launched'),
            endedEvents: yield* eventsOf(mission.id, 'helper.ended'),
          }
        }),
      ),
    )
    expect(seen.answer.ok).toBe(true)
    expect(seen.answer.text).toMatch(/^H1 launched on T1: it works in the background/)
    expect(seen.helper.session).toMatchObject({
      role: 'helper',
      parent: seen.builder.session.lineage,
    })
    expect(seen.helper.session.folder).toBe(seen.builder.session.folder)
    expect(seen.task.runner).toBe(seen.helper.row.lineage)
    expect(seen.lease).toMatchObject({ lineage: seen.helper.row.lineage, epoch: 1 })
    expect(seen.claims.length).toBeGreaterThan(0)
    expect(new Set(seen.claims)).toEqual(new Set([seen.helper.row.lineage]))
    const brief = promptsOf(world.agents[2])[0] ?? ''
    expect(brief).toContain(`Helper H1 for the Builder of ${seen.mission.key} · depth 1`)
    expect(brief).toContain('Write the CSV export of the invoices.')
    expect(brief).toContain(
      'T1 Export as CSV: The invoices export as CSV; targets change api/invoices.ts',
    )
    expect(brief).toContain('spec_read (frozen)')
    expect(brief).toContain('You may write: yes')
    expect(seen.result.ok).toBe(true)
    const delivered =
      promptsOf(world.agents[1]).find((one) => one.includes('[hemera:result]')) ?? ''
    expect(delivered).toContain('H1 (Helper) handed back its result on T1')
    expect(delivered).toContain('The CSV export is written.')
    expect(seen.chips).toEqual([
      expect.objectContaining({ label: 'H1', name: 'Helper', task: 'T1', state: 'done', depth: 1 }),
    ])
    expect(seen.launchedEvents).toHaveLength(1)
    expect(seen.endedEvents).toHaveLength(1)
  })

  test('the task is the helper’s to finish while it runs, and its parent’s again once it ended', async () => {
    const { run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'task_start', { task: 'T1' })
          yield* call(builder.grantId, 'helper_launch', {
            brief: 'Write the CSV export.',
            task: 'T1',
          })
          const helper = yield* helperNumbered(mission.id, 1)
          // While the helper runs it, a red would reach the helper: the lease is its session's.
          const whileRunning = yield* leaseOf('T1')
          const parentRefused = yield* call(builder.grantId, 'task_finished', {
            task: 'T1',
            summary: 'Done.',
          })
          yield* call(helper.grantId, 'helper_result', { ...FREE_RESULT, left: ['The tests.'] })
          yield* until(
            Effect.map(taskRow(mission.id, 'T1'), (row) => row.runner === builder.session.lineage),
          )
          // Ended with its task not done: the next red reaches the parent.
          const afterEnd = yield* leaseOf('T1')
          const parentFinished = yield* call(builder.grantId, 'task_finished', {
            task: 'T1',
            summary: 'Done.',
          })
          return { builder, helper, whileRunning, parentRefused, afterEnd, parentFinished }
        }),
      ),
    )
    expect(seen.whileRunning?.sessionId).toBe(seen.helper.session.id)
    expect(seen.parentRefused).toMatch(/^refused/)
    expect(seen.afterEnd).toMatchObject({ sessionId: seen.builder.session.id, epoch: 2 })
    expect(seen.parentFinished).toMatch(/T1 is done/)
  })

  test('a helper tied to a task starts no other task', async () => {
    const { run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'helper_launch', { brief: 'Write the export.', task: 'T2' })
          const helper = yield* helperNumbered(mission.id, 1)
          const other = yield* call(helper.grantId, 'task_start', { task: 'T1' })
          const own = yield* call(helper.grantId, 'task_start', { task: 'T2' })
          return { other, own, helper, task: yield* taskRow(mission.id, 'T2') }
        }),
      ),
    )
    expect(seen.other).toBe('refused: H1 starts only its own task, T2.')
    expect(seen.own).not.toMatch(/^refused/)
    expect(seen.task.runner).toBe(seen.helper.row.lineage)
  })
})

describe('The Prototyper tries an approach in its own folder', () => {
  test('it writes only in missions/<key>/prototypes/1/, its files land in evidence, and the Workspace is unchanged', async () => {
    const { world, run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          const answer = yield* call(builder.grantId, 'helper_launch', {
            helper: 'prototyper',
            brief: 'Does a streaming CSV writer keep the accents?',
          })
          const helper = yield* helperNumbered(mission.id, 1)
          const own = yield* callTool(helper.grantId, 'fs_write', {
            path: 'try.ts',
            content: 'export const tried = true\n',
          })
          const workspace = yield* callTool(helper.grantId, 'fs_write', {
            repository: 'api',
            path: 'invoices.ts',
            content: 'overwritten\n',
          })
          const read = yield* callTool(helper.grantId, 'fs_read', {
            repository: 'api',
            path: 'README.md',
          })
          const result = yield* callTool(helper.grantId, 'helper_result', {
            tried: 'A streaming CSV writer.',
            works: ['The accents are kept.'],
            does_not_work: ['Quotes inside a name.'],
            files: ['try.ts'],
          })
          yield* until(
            Effect.sync(() =>
              promptsOf(world.agents[1]).some((one) => one.includes('[hemera:result]')),
            ),
          )
          const database = yield* Database
          return {
            key: (yield* getMission(mission.id)).key,
            builder,
            answer,
            helper,
            own,
            workspace,
            read,
            result,
            evidence: yield* listEvidence(mission.id, null),
            requests: yield* database.select().from(permissionRequests),
            prototyped: yield* eventsOf(mission.id, 'prototype.result'),
          }
        }),
      ),
    )
    const folder = join(data, 'missions', seen.key, 'prototypes', '1')
    expect(seen.answer).toMatch(/^H1 launched:/)
    expect(seen.helper.session).toMatchObject({ role: 'prototyper', folder })
    expect(seen.own.ok).toBe(true)
    expect(readFileSync(join(folder, 'try.ts'), 'utf8')).toBe('export const tried = true\n')
    expect(seen.workspace.text).toBe(
      `refused: the Prototyper writes only in its own folder, ${folder}: the Workspace is read-only to it`,
    )
    expect(seen.read.ok).toBe(true)
    expect(seen.read.text).not.toMatch(/^refused|Waiting/)
    expect(seen.requests).toEqual([])
    expect(seen.result.ok).toBe(true)
    expect(seen.evidence.map((one) => one.name)).toEqual(['H1/try.ts'])
    const repository = join(seen.builder.session.folder, 'api')
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: repository,
      encoding: 'utf8',
    })
    expect(status.stdout).toBe('')
    expect(seen.prototyped).toHaveLength(1)
    const delivered =
      promptsOf(world.agents[1]).find((one) => one.includes('[hemera:result]')) ?? ''
    expect(delivered).toContain('H1 (Prototyper) handed back its result')
    expect(delivered).toContain('The accents are kept.')
    expect(existsSync(folder)).toBe(true)
  })
})

describe('The definitions refuse what they do not know', () => {
  test('an unknown defined helper is refused naming the one that exists; a result missing a field is refused naming it', async () => {
    const { run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          const unknown = yield* call(builder.grantId, 'helper_launch', {
            helper: 'sketcher',
            brief: 'Draw the export.',
          })
          yield* call(builder.grantId, 'helper_launch', {
            helper: 'prototyper',
            brief: 'Try a CSV writer.',
          })
          const helper = yield* helperNumbered(mission.id, 1)
          const missing = yield* call(helper.grantId, 'helper_result', {
            tried: 'A CSV writer.',
            works: [],
            files: [],
          })
          return { unknown, missing, rows: yield* helperRowsOf(mission.id) }
        }),
      ),
    )
    expect(seen.unknown).toBe(
      'refused: there is no defined helper sketcher: the one that exists is prototyper',
    )
    expect(seen.missing).toMatch(/^refused: the result does not read: /)
    expect(seen.missing).toContain('does_not_work')
    expect(seen.rows.map((row) => row.state)).toEqual(['running'])
  })
})

describe('A helper launches its own to a depth of 2', () => {
  test('a helper’s helper is accepted, a third level refused', async () => {
    const { run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'helper_launch', { brief: 'Read the exports.' })
          const first = yield* helperNumbered(mission.id, 1)
          const second = yield* call(first.grantId, 'helper_launch', { brief: 'Read export.ts.' })
          const child = yield* helperNumbered(mission.id, 2)
          const third = yield* call(child.grantId, 'helper_launch', { brief: 'Read one line.' })
          return { first, second, child, third, rows: yield* helperRowsOf(mission.id) }
        }),
      ),
    )
    expect(seen.second).toMatch(/^H2 launched:/)
    expect(seen.child.row).toMatchObject({ depth: 2, parentLineage: seen.first.row.lineage })
    expect(seen.child.session.parent).toBe(seen.first.row.lineage)
    expect(seen.third).toBe('refused: a helper of a helper cannot launch helpers')
    expect(seen.rows).toHaveLength(2)
  })
})

describe('Helpers count in the cap and the launch budget', () => {
  test('the fourth launch at a cap of 3 is refused with the sentence', async () => {
    const { run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          for (const number of [1, 2, 3]) {
            yield* call(builder.grantId, 'helper_launch', { brief: `Read part ${String(number)}.` })
            yield* helperNumbered(mission.id, number)
          }
          const fourth = yield* call(builder.grantId, 'helper_launch', { brief: 'Read part 4.' })
          return {
            fourth,
            rows: yield* helperRowsOf(mission.id),
            refusedEvents: yield* eventsOf(mission.id, 'helper.refused'),
          }
        }),
      ),
    )
    expect(seen.fourth).toBe(`refused: ${capRefusal(3, 3)}`)
    expect(seen.rows).toHaveLength(3)
    expect(seen.refusedEvents).toHaveLength(1)
  })

  test('two launches at the same instant never both pass the cap', async () => {
    const { run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 1, budget: limits.budget })
          const builder = yield* builderOf(mission.id)
          const answers = yield* Effect.all(
            [
              callTool(builder.grantId, 'helper_launch', { brief: 'Read part 1.' }),
              callTool(builder.grantId, 'helper_launch', { brief: 'Read part 2.' }),
            ],
            { concurrency: 'unbounded' },
          )
          return { answers, rows: yield* helperRowsOf(mission.id) }
        }),
      ),
    )
    expect(seen.answers.filter((one) => one.ok)).toHaveLength(1)
    expect(seen.answers.find((one) => !one.ok)?.text).toBe(`refused: ${capRefusal(1, 1)}`)
    expect(seen.rows).toHaveLength(1)
  })

  test('a launch over the budget is refused', async () => {
    const { run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          for (let spent = 0; spent < 8; spent += 1) yield* spendBudget(mission.id, 'launches')
          const over = yield* call(builder.grantId, 'helper_launch', { brief: 'Read part 1.' })
          return { over, rows: yield* helperRowsOf(mission.id) }
        }),
      ),
    )
    expect(seen.over).toMatch(/^refused: /)
    expect(seen.over).toContain('the launches of this mission are spent')
    expect(seen.rows).toEqual([])
  })
})

/** A script that appends one line to the file it is given: its effect is counted. */
const APPENDS = `
import { appendFileSync } from 'node:fs'
appendFileSync(process.argv[2], 'ran\\n')
`

describe('A helper asks through its parent’s mission', () => {
  test('a helper’s command that asks becomes one permission need naming the helper, and an earlier Allow for this mission covers it', async () => {
    const appender = script(APPENDS)
    const { run } = helping()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'task_start', { task: 'T1' })
          yield* call(builder.grantId, 'helper_launch', { brief: 'Seed the notes.', task: 'T1' })
          const helper = yield* helperNumbered(mission.id, 1)
          const database = yield* Database
          // The helper's call asks: one need of the mission, naming the helper and its task.
          const first = join(work, 'first.txt')
          const asked = yield* call(helper.grantId, 'commands_run', {
            line: nodeLine(appender, first),
          })
          const [request] = yield* database.select().from(permissionRequests)
          const need = yield* getNeed(request?.needId ?? '')
          // The Builder's own call, allowed for the mission, covers the helper's same call after.
          const second = join(work, 'second.txt')
          yield* call(builder.grantId, 'commands_run', { line: nodeLine(appender, second) })
          const builderRequest = (yield* database.select().from(permissionRequests)).find(
            (one) => one.id !== request?.id,
          )
          yield* answerNeed({
            id: builderRequest?.needId ?? '',
            answer: PermissionAnswer.make({ choice: 'allow-for-mission' }),
            key: crypto.randomUUID(),
          })
          yield* until(Effect.sync(() => existsSync(second)))
          const covered = yield* call(helper.grantId, 'commands_run', {
            line: nodeLine(appender, second),
          })
          yield* until(
            Effect.sync(
              () => readFileSync(second, 'utf8').split('\n').filter(Boolean).length === 2,
            ),
          )
          return {
            asked,
            need,
            covered,
            requests: yield* database.select().from(permissionRequests),
          }
        }),
      ),
    )
    expect(seen.asked).toMatch(/^Waiting for the user's approval, request #1\./)
    expect(seen.need.owner).toMatchObject({ missionId: expect.any(String), taskId: 'T1' })
    expect(seen.need.fields).toMatchObject({ asked: expect.stringMatching(/^H1 \(T1\) asks: /) })
    expect(seen.covered).not.toMatch(/^Waiting|^refused/)
    expect(seen.requests).toHaveLength(2)
  })
})

describe('A helper silent in a turn is stuck', () => {
  test('the flag, the parent’s note, and a replacement with the same brief', async () => {
    const { world, run } = helping({ timings: SILENCE })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'helper_launch', { brief: 'Read the whole history.' })
          const helper = yield* helperNumbered(mission.id, 1)
          yield* until(Effect.map(listHelpers(mission.id), (chips) => chips[0]?.stuck === true))
          const chips = yield* listHelpers(mission.id)
          yield* until(
            Effect.map(sessionsOfLineage(helper.row.lineage), (rows) =>
              rows.some((one) => one.epoch > helper.session.epoch),
            ),
          )
          yield* until(Effect.sync(() => world.agents.length > 3))
          yield* until(Effect.sync(() => promptsOf(world.agents[3]).length > 0))
          yield* until(
            Effect.sync(() =>
              promptsOf(world.agents[1]).some((one) => one.includes('H1 has been silent')),
            ),
          )
          return {
            chips,
            stuck: yield* eventsOf(mission.id, 'helper.stuck'),
            replaced: yield* eventsOf(mission.id, 'helper.replaced'),
          }
        }),
      ),
    )
    expect(seen.chips[0]).toMatchObject({ label: 'H1', state: 'running', stuck: true })
    expect(seen.stuck.length).toBeGreaterThan(0)
    expect(seen.replaced.length).toBeGreaterThan(0)
    const note = promptsOf(world.agents[1]).find((one) => one.includes('H1 has been silent')) ?? ''
    expect(note).toContain('H1 has been silent for 5 minutes')
    // The replacement is briefed with the same brief.
    expect(promptsOf(world.agents[3])[0]).toContain('Read the whole history.')
  })
})

describe('A helper ends with its result', () => {
  test('a turn ended without helper_result is told once; a second fails the helper, its parent told and its task given back', async () => {
    const { world, run } = helping({}, true)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'task_start', { task: 'T1' })
          yield* call(builder.grantId, 'helper_launch', { brief: 'Write the export.', task: 'T1' })
          yield* until(Effect.map(listHelpers(mission.id), (chips) => chips[0]?.state === 'failed'))
          yield* until(
            Effect.sync(() =>
              promptsOf(world.agents[1]).some((one) => one.includes('H1 (Helper) failed')),
            ),
          )
          return {
            builder,
            chip: (yield* listHelpers(mission.id))[0],
            task: yield* taskRow(mission.id, 'T1'),
            failed: yield* eventsOf(mission.id, 'helper.failed'),
          }
        }),
      ),
    )
    expect(promptsOf(world.agents[2])[1]).toContain('End with helper_result')
    expect(seen.chip).toMatchObject({ state: 'failed', task: 'T1' })
    expect(seen.failed).toHaveLength(1)
    expect(seen.task).toMatchObject({ state: 'in_progress', runner: seen.builder.session.lineage })
    const told = promptsOf(world.agents[1]).find((one) => one.includes('H1 (Helper) failed')) ?? ''
    expect(told).toContain('it ended its turns without helper_result')
    expect(told).toContain('Its task T1 is yours again.')
  })
})

describe('A restart rebuilds the tree and delivers what was queued, once', () => {
  test('the Builder then its helpers come back, and a queued result is delivered once', async () => {
    const before = helping()
    const first = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'helper_launch', { brief: 'Read the exports.' })
          const running = yield* helperNumbered(mission.id, 1)
          yield* call(builder.grantId, 'helper_launch', { brief: 'Read the README.' })
          const ended = yield* helperNumbered(mission.id, 2)
          // The engine stopped between H2's end and its delivery: its result is queued only.
          const database = yield* Database
          const secrets = yield* Secrets
          yield* database
            .update(helpers)
            .set({
              state: 'done',
              result: secrets.mask('Read.'),
              endedAt: new Date().toISOString(),
            })
            .where(eq(helpers.id, ended.row.id))
          yield* database.insert(queuedResults).values({
            helperId: ended.row.id,
            missionId: mission.id,
            parentLineage: builder.session.lineage,
            body: secrets.mask('H2 (Helper) handed back its result. Read the README.'),
            queuedAt: new Date().toISOString(),
            deliveredAt: null,
          })
          return { mission, builder, running, ended }
        }),
      ),
    )
    const deliveredOf = (helperId: string) =>
      Effect.gen(function* () {
        const database = yield* Database
        return yield* database
          .select()
          .from(sessionDeliveries)
          .where(eq(sessionDeliveries.id, `result-${helperId}`))
      })
    const live = (lineage: string) =>
      Effect.map(
        sessionsOfLineage(lineage),
        (rows) =>
          rows.filter((one) => ['starting', 'working', 'idle'].includes(one.state)).at(0) ?? null,
      )
    const after = helping()
    const second = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(Effect.map(deliveredOf(first.ended.row.id), (rows) => rows.length > 0))
          yield* until(Effect.map(live(first.running.row.lineage), (one) => one !== null))
          yield* until(Effect.map(live(first.builder.session.lineage), (one) => one !== null))
          const database = yield* Database
          return {
            builder: yield* live(first.builder.session.lineage),
            helper: yield* live(first.running.row.lineage),
            delivered: yield* deliveredOf(first.ended.row.id),
            queued: yield* database
              .select()
              .from(queuedResults)
              .where(eq(queuedResults.helperId, first.ended.row.id)),
          }
        }),
      ),
    )
    expect(second.builder?.epoch).toBeGreaterThan(first.builder.session.epoch)
    expect(second.helper).toMatchObject({ parent: first.builder.session.lineage, role: 'helper' })
    // Top-down: the Builder's successor is written before its helper's.
    expect((second.builder?.createdAt ?? '') <= (second.helper?.createdAt ?? '')).toBe(true)
    expect(second.delivered).toHaveLength(1)
    expect(second.delivered[0]).toMatchObject({
      kind: 'result',
      targetLineage: first.builder.session.lineage,
    })
    expect(second.queued[0]?.deliveredAt).not.toBeNull()
    // A third start delivers nothing more.
    const again = helping()
    const third = await again.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(Effect.map(live(first.builder.session.lineage), (one) => one !== null))
          return yield* deliveredOf(first.ended.row.id)
        }),
      ),
    )
    expect(third).toHaveLength(1)
  })
})

describe('Nothing stops a helper', () => {
  test('no helper_stop exists in the role table, and no RPC stops a helper', () => {
    expect(TOOL_NAMES.some((name) => name.includes('stop') && name.startsWith('helper'))).toBe(
      false,
    )
    expect(toolsOf('builder').filter((name) => name.startsWith('helper'))).toEqual([
      'helper_launch',
      'helper_read',
    ])
    expect([...HelpersRpcs.requests.keys()].toSorted()).toEqual([
      'helpers.changed',
      'helpers.list',
      'helpers.read',
    ])
  })
})
