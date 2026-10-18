/**
 * After each task (#477): the mission copies the `tasks` section of its Project's delivery rules
 * when its first task is done, and runs each repository's stack from that copy after every task:
 * Hemera's commit with the repository's commit template, the user's own commit (a click, then a
 * new commit on the branch), an agent's commit under the permission rules, and the steps a user
 * confirms. An empty stack commits nothing.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent and the test driving the
 * Builder's tools through its grant; Acme's real repositories in temporary folders as the
 * Workspace. A step the user takes is taken by the test, through the need Hemera raised.
 */

import { realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  type DeliveryAction,
  DEFAULT_PULL_REQUEST_BODY,
  DEFAULT_PULL_REQUEST_TITLE,
  type DeliveryRulesDraft,
  defaultDeliveryRules,
} from '@hemera/core/domain'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { BuilderHold } from '../src/engine/building/builder.ts'
import { latestBuildingIn } from '../src/engine/building/tasks.ts'
import {
  missionCopies,
  readDeliveryRules,
  saveDeliveryRules,
} from '../src/engine/delivery-rules.ts'
import { cancelMissionIn, getMission } from '../src/engine/missions.ts'
import { retryNeed } from '../src/engine/needs.ts'
import { Judge } from '../src/engine/permissions/ports.ts'
import { Database } from '../src/engine/storage/database.ts'
import { effectfulActions, sessionDeliveries } from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { acmeAt, call, eventsOf } from './building-world.ts'
import { builderAgents, builderOf, launched, taskIn } from './builder-world.ts'
import { git } from './repositories.ts'
import { HELPER, held, sessionsEngine, until, within } from './sessions-world.ts'
import { ALLOW, questionsKept, verdictsSaying } from './tools-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('after-each-task'))
  work = realpathSync.native(temporaryFolder('after-each-task-work'))
})
afterEach(removeFolders)

/** The engine over `data`, every call the agents make allowed: the Building is what is judged. */
const engine = (hold?: BuilderHold) =>
  sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    building: hold === undefined ? {} : { hold },
  })

/** The engine with the real order of decision: a judge that allows what reaches it. */
const judgedEngine = () => {
  const questions = questionsKept()
  return sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: {
      home: work,
      permissionRequests: questions.layer,
      judge: Layer.succeed(Judge, {
        judge: () => Effect.succeed({ verdict: 'allow', reason: 'the suite allows it' }),
      }),
    },
  })
}

/** Acme, its api set to the user's own identity before Hemera knows the repository (#457). */
const userAcme = (folder: string) =>
  acmeAt(folder, 'acme', (api) => {
    git(api, 'config', 'user.name', 'Ada Lovelace')
    git(api, 'config', 'user.email', 'ada@example.com')
    git(api, 'config', 'commit.gpgsign', 'false')
  })

const HEMERA: DeliveryAction = { id: 'task-commit', kind: 'commit-by-hemera', mode: 'auto' }
const ME: DeliveryAction = { id: 'mine', kind: 'commit-by-me', mode: 'click' }
const AGENT: DeliveryAction = { id: 'agent-commit', kind: 'commit-by-agent', mode: 'auto' }
const ASKED: DeliveryAction = { id: 'task-commit', kind: 'commit-by-hemera', mode: 'click' }
const STOP: DeliveryAction = { id: 'stop', kind: 'stop-services', mode: 'auto' }
const CHECKED: DeliveryAction = {
  id: 'looked',
  kind: 'confirm',
  mode: 'click',
  what: 'the diff was read',
}

/**
 * The Project's After each task stack set to `steps` for every preset, api's commit template to
 * `template` when one is given; saved on the version read.
 */
const tasksStack = (
  projectId: string,
  steps: ReadonlyArray<DeliveryAction>,
  template: string | null = null,
) =>
  Effect.gen(function* () {
    const view = yield* readDeliveryRules(projectId)
    const base = defaultDeliveryRules()
    const api = view.repositories.find((one) => one.name === 'api')
    const draft: DeliveryRulesDraft = {
      ...base,
      tasks: { presets: { library: steps, application: steps, local: steps }, repositories: [] },
      preparation: {
        ...base.preparation,
        repositories:
          template === null || api === undefined
            ? []
            : [
                {
                  repositoryId: api.repositoryId,
                  commitTemplate: template,
                  pullRequestTitle: DEFAULT_PULL_REQUEST_TITLE,
                  pullRequestBody: DEFAULT_PULL_REQUEST_BODY,
                  reviewers: [],
                  requireApproval: false,
                  steps: { off: [], changed: [], added: [] },
                },
              ],
      },
    }
    yield* saveDeliveryRules(projectId, draft, view.rules.version)
  })

/** A Building of Acme with the stack set before its first task, the Builder's grant, and api. */
const building = (steps: ReadonlyArray<DeliveryAction>, template: string | null = null) =>
  Effect.gen(function* () {
    const { project, mission } = yield* launched(work, undefined, undefined, undefined, userAcme)
    yield* tasksStack(project.id, steps, template)
    const { session, grantId } = yield* builderOf(mission.id)
    const api = join(session.folder, 'api')
    return { project, mission, session, grantId, api, head: git(api, 'rev-parse', 'HEAD') }
  })

/** T1 started, its file written and finished: done. */
const t1Done = (missionId: string, grantId: string) =>
  Effect.gen(function* () {
    yield* call(grantId, 'task_start', { task: 'T1' })
    yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
    yield* call(grantId, 'fs_write', {
      repository: 'api',
      path: 'invoices.ts',
      content: 'export const invoices = ["csv"]\n',
    })
    yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
    yield* taskIn(missionId, 'T1', 'done')
  })

/** T2 started, its file written and finished: done. */
const t2Done = (missionId: string, grantId: string) =>
  Effect.gen(function* () {
    const started = yield* call(grantId, 'task_start', { task: 'T2' })
    if (!started.startsWith('T2 started')) return yield* Effect.die(new Error(started))
    yield* call(grantId, 'fs_write', {
      repository: 'api',
      path: 'export.ts',
      content: 'export const markdown = true\n',
    })
    yield* call(grantId, 'task_finished', { task: 'T2', summary: 'Markdown.' })
    yield* taskIn(missionId, 'T2', 'done')
  })

const commitsOf = (missionId: string) => eventsOf(missionId, 'building.commit')

const committedTimes = (missionId: string, count: number) =>
  until(Effect.map(commitsOf(missionId), (rows) => rows.length >= count))

/** The mission's environment needs still open. */
const environments = (missionId: string) =>
  Effect.map(getMission(missionId), (one) =>
    one.needs.flatMap((need) =>
      Predicate.isTagged(need.fields, 'Environment') ? [{ id: need.id, ...need.fields }] : [],
    ),
  )

const asked = (missionId: string, count = 1) =>
  until(Effect.map(environments(missionId), (rows) => rows.length >= count))

/** The actions of a kind the mission recorded, with their state. */
const actionsOf = (kind: string) =>
  Effect.flatMap(Database, (database) =>
    database
      .select({ state: effectfulActions.state, taskId: effectfulActions.taskId })
      .from(effectfulActions)
      .where(eq(effectfulActions.kind, kind)),
  )

const logOf = (api: string, head: string) => git(api, 'log', '--format=%s', `${head}..HEAD`)

describe('After each task: the copy', () => {
  test('the first task done takes the tasks copy once, and a later Project change does not change it', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId, api, head } = yield* building([HEMERA])
          const before = yield* missionCopies(mission.id)
          yield* t1Done(mission.id, grantId)
          yield* committedTimes(mission.id, 1)
          const first = yield* missionCopies(mission.id)
          // The Project stops committing after each task: the mission keeps its copy.
          yield* tasksStack(project.id, [])
          yield* t2Done(mission.id, grantId)
          yield* committedTimes(mission.id, 2)
          return {
            before,
            first,
            second: yield* missionCopies(mission.id),
            copied: yield* eventsOf(mission.id, 'delivery.rules_copied'),
            log: logOf(api, head),
          }
        }),
      ),
    )
    expect(seen.before).toEqual([])
    expect(seen.first.map((one) => one.section)).toEqual(['tasks'])
    expect(seen.second).toEqual(seen.first)
    expect(seen.copied.map((one) => JSON.parse(one.payload).section)).toEqual(['tasks'])
    expect(seen.log.split('\n')).toEqual(['ACME-1: Export as Markdown', 'ACME-1: Export as CSV'])
  })

  test('an empty tasks stack commits nothing', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* building([])
          yield* t1Done(mission.id, grantId)
          // The copy is the last thing the pass writes: once it is there, the pass is over.
          yield* until(Effect.map(missionCopies(mission.id), (copies) => copies.length > 0))
          return {
            log: logOf(api, head),
            commits: yield* commitsOf(mission.id),
            needs: yield* environments(mission.id),
            status: git(api, 'status', '--porcelain'),
          }
        }),
      ),
    )
    expect(seen.log).toBe('')
    expect(seen.commits).toEqual([])
    expect(seen.needs).toEqual([])
    expect(seen.status).toContain('invoices.ts')
  })
})

describe('After each task: Hemera commits', () => {
  test('a stack commit-by-hemera after a task makes one commit with the rendered template, and its post-condition holds', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* building(
            [HEMERA],
            '{key} on {branch}: {title} ({slug})',
          )
          yield* t1Done(mission.id, grantId)
          yield* committedTimes(mission.id, 1)
          return {
            log: git(api, 'log', '--format=%an <%ae>|%s', `${head}..HEAD`),
            branch: git(api, 'rev-parse', '--abbrev-ref', 'HEAD'),
            status: git(api, 'status', '--porcelain'),
            actions: yield* actionsOf('git.commit'),
          }
        }),
      ),
    )
    expect(seen.log).toBe(
      `Ada Lovelace <ada@example.com>|ACME-1 on ${seen.branch}: Export as CSV (acme-1-invoices-exports)`,
    )
    // The Workspace has no uncommitted change.
    expect(seen.status).toBe('')
    expect(seen.actions).toEqual([{ state: 'done', taskId: 'T1' }])
  })

  test('a commit that fails stops the stack there, and is made at the next pass', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* building([HEMERA, CHECKED])
          // Git cannot take the index while its lock is there: the commit fails.
          const lock = join(git(api, 'rev-parse', '--absolute-git-dir'), 'index.lock')
          writeFileSync(lock, '')
          yield* t1Done(mission.id, grantId)
          yield* until(
            Effect.map(actionsOf('git.commit'), (rows) =>
              rows.some((row) => row.state === 'failed'),
            ),
          )
          const failed = { log: logOf(api, head), needs: yield* environments(mission.id) }
          rmSync(lock)
          // The next pass, after T2: T1 is committed first, then T2, and T1's confirm is asked.
          yield* t2Done(mission.id, grantId)
          yield* committedTimes(mission.id, 1)
          yield* asked(mission.id)
          return { failed, log: logOf(api, head), needs: yield* environments(mission.id) }
        }),
      ),
    )
    expect(seen.failed.log).toBe('')
    // Nothing after the failed step runs: the confirm is not asked.
    expect(seen.failed.needs).toEqual([])
    expect(seen.log).toBe('ACME-1: Export as CSV')
    expect(seen.needs).toHaveLength(1)
    expect(seen.needs[0]?.missing).toContain('T1')
  })

  test('a Cancel during a commit makes no commit', async () => {
    const gate = held()
    const seen = await engine((at) =>
      at === 'mid-commit' ? Effect.promise(() => gate.promise) : Effect.void,
    ).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* building([HEMERA])
          yield* t1Done(mission.id, grantId)
          yield* until(
            Effect.map(actionsOf('git.commit'), (rows) =>
              rows.some((row) => row.state === 'started'),
            ),
          )
          const cancelled = yield* mutate('cancelling in a test', (transaction) =>
            Effect.gen(function* () {
              const events = yield* cancelMissionIn(transaction, mission.id)
              const one = yield* latestBuildingIn(transaction, mission.id)
              return { result: one?.state, events }
            }),
          )
          gate.release()
          yield* until(
            Effect.map(actionsOf('git.commit'), (rows) =>
              rows.every((row) => row.state !== 'started'),
            ),
          )
          return { cancelled, log: logOf(api, head), actions: yield* actionsOf('git.commit') }
        }),
      ),
    )
    expect(seen.cancelled).toBe('cancelled')
    expect(seen.log).toBe('')
    expect(seen.actions).toEqual([{ state: 'failed', taskId: 'T1' }])
  })
  test('a commit-by-hemera on a click waits for it, then commits', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* building([ASKED])
          yield* t1Done(mission.id, grantId)
          yield* asked(mission.id)
          const waiting = { log: logOf(api, head), needs: yield* environments(mission.id) }
          yield* retryNeed(waiting.needs[0]?.id ?? '')
          yield* committedTimes(mission.id, 1)
          return { waiting, log: logOf(api, head) }
        }),
      ),
    )
    expect(seen.waiting.log).toBe('')
    expect(seen.waiting.needs[0]?.missing).toContain('waits for your click')
    expect(seen.log).toBe('ACME-1: Export as CSV')
  })

  test('a step Hemera cannot run after each task yet is the user’s to confirm', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* building([STOP, HEMERA])
          yield* t1Done(mission.id, grantId)
          yield* asked(mission.id)
          const needs = yield* environments(mission.id)
          yield* retryNeed(needs[0]?.id ?? '')
          yield* committedTimes(mission.id, 1)
          return { needs, taken: yield* actionsOf('delivery.step_taken') }
        }),
      ),
    )
    expect(seen.needs).toHaveLength(1)
    expect(seen.needs[0]?.missing).toContain('cannot run “stop” (stop-services)')
    expect(seen.taken).toEqual([{ state: 'done', taskId: 'T1' }])
  })

  test('a task that changed nothing in a repository runs no step there', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* building([ME])
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'Nothing to change.' })
          yield* taskIn(mission.id, 'T1', 'done')
          yield* until(Effect.map(missionCopies(mission.id), (copies) => copies.length > 0))
          return {
            needs: yield* environments(mission.id),
            started: yield* call(grantId, 'task_start', { task: 'T2' }),
          }
        }),
      ),
    )
    expect(seen.needs).toEqual([])
    expect(seen.started).toContain('T2 started')
  })
})

describe('After each task: the user commits', () => {
  test('commit-by-me waits for the click and refuses to go on when no new commit exists', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* building([ME, CHECKED])
          yield* t1Done(mission.id, grantId)
          yield* asked(mission.id)
          const [first] = yield* environments(mission.id)
          // Confirmed with no new commit: Hemera asks again, and goes no further.
          yield* retryNeed(first?.id ?? '')
          yield* until(
            Effect.map(environments(mission.id), (rows) =>
              rows.some((row) => row.id !== first?.id),
            ),
          )
          const again = yield* environments(mission.id)
          git(api, 'add', 'invoices.ts')
          git(api, 'commit', '-q', '-m', 'CSV, by hand')
          yield* retryNeed(again[0]?.id ?? '')
          // The next step of the stack, the confirm, is asked once the commit is seen.
          yield* until(
            Effect.map(environments(mission.id), (rows) =>
              rows.some((row) => row.missing.includes('the diff was read')),
            ),
          )
          return {
            first,
            again,
            log: logOf(api, head),
            commits: yield* commitsOf(mission.id),
            mine: yield* actionsOf('delivery.commit_by_me'),
          }
        }),
      ),
    )
    expect(seen.first?.missing).toContain('T1')
    expect(seen.first?.action).toContain('api')
    expect(seen.again).toHaveLength(1)
    expect(seen.again[0]?.missing).toContain('no new commit')
    // Hemera never committed: the one commit is the user's.
    expect(seen.log).toBe('CSV, by hand')
    expect(seen.commits).toEqual([])
    expect(seen.mine).toEqual([{ state: 'done', taskId: 'T1' }])
  })

  test('a click step waiting while the next task starts: the next task waits until it is taken', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api } = yield* building([ME])
          yield* t1Done(mission.id, grantId)
          yield* asked(mission.id)
          const waiting = yield* call(grantId, 'task_start', { task: 'T2' })
          git(api, 'add', 'invoices.ts')
          git(api, 'commit', '-q', '-m', 'CSV, by hand')
          yield* retryNeed((yield* environments(mission.id))[0]?.id ?? '')
          yield* until(
            Effect.map(actionsOf('delivery.commit_by_me'), (rows) =>
              rows.some((row) => row.state === 'done'),
            ),
          )
          return { waiting, started: yield* call(grantId, 'task_start', { task: 'T2' }) }
        }),
      ),
    )
    expect(seen.waiting).toContain('T2 waits')
    expect(seen.waiting).toContain('T1')
    expect(seen.started).toContain('T2 started')
  })

  test('a restart while commit-by-me waits keeps its one need, and the click after it goes on', async () => {
    const first = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* building([ME])
          yield* t1Done(mission.id, grantId)
          yield* asked(mission.id)
          return { mission, api, head }
        }),
      ),
    )
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const missionId = first.mission.id
          // Long enough for a second need, if the start wrongly raised one.
          yield* Effect.sleep('500 millis')
          const needs = yield* environments(missionId)
          git(first.api, 'add', 'invoices.ts')
          git(first.api, 'commit', '-q', '-m', 'CSV, by hand')
          yield* retryNeed(needs[0]?.id ?? '')
          yield* until(
            Effect.map(actionsOf('delivery.commit_by_me'), (rows) =>
              rows.some((row) => row.state === 'done'),
            ),
          )
          return { needs, after: yield* environments(missionId) }
        }),
      ),
    )
    expect(seen.needs).toHaveLength(1)
    expect(seen.after).toEqual([])
  })
})

describe('After each task: an agent commits', () => {
  test('commit-by-agent lets an Agent step run git commit, and the permission rules still judge it', async () => {
    const seen = await judgedEngine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, session, api, head } = yield* building([AGENT, CHECKED])
          const commit = (line: string) =>
            call(grantId, 'commands_run', { line, repository: 'api' })
          const before = yield* commit('git commit --allow-empty -m early')
          yield* t1Done(mission.id, grantId)
          yield* until(Effect.map(actionsOf('delivery.commit_by_agent'), (rows) => rows.length > 0))
          const told = yield* Effect.flatMap(Database, (database) =>
            database
              .select({ body: sessionDeliveries.body })
              .from(sessionDeliveries)
              .where(
                and(
                  eq(sessionDeliveries.targetLineage, session.lineage),
                  eq(sessionDeliveries.kind, 'commit'),
                ),
              ),
          )
          const amend = yield* commit('git commit --amend -m again')
          const skip = yield* commit('git commit --no-verify -a -m skipped')
          const push = yield* commit('git push origin HEAD')
          const made = yield* commit('git commit -a -m ACME-1')
          yield* until(
            Effect.map(actionsOf('delivery.commit_by_agent'), (rows) =>
              rows.some((row) => row.state === 'done'),
            ),
          )
          // Once the step is done, the right to commit is gone again.
          const after = yield* commit('git commit --allow-empty -m late')
          return {
            before,
            told: told.map((one) => one.body),
            amend,
            skip,
            push,
            made,
            after,
            log: logOf(api, head),
            commits: yield* commitsOf(mission.id),
          }
        }),
      ),
    )
    const refused = 'refused: no agent of a mission may run git commit in this Project'
    expect(seen.before).toBe(refused)
    expect(seen.told).toHaveLength(1)
    expect(seen.told[0]).toContain('T1')
    expect(seen.told[0]).toContain('git commit')
    expect(seen.amend).toBe('refused: no agent of a mission may run git commit --amend')
    expect(seen.skip).toBe('refused: no agent of a mission may run git commit --no-verify')
    expect(seen.push).toBe('refused: no agent of a mission may run git push')
    expect(seen.made).not.toContain('refused')
    expect(seen.after).toBe(refused)
    expect(seen.log).toBe('ACME-1')
    // The agent's commit, not Hemera's.
    expect(seen.commits).toEqual([])
  })
})
