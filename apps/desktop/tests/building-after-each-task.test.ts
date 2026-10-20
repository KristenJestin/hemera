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

import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  type DeliveryAction,
  DEFAULT_PULL_REQUEST_BODY,
  DEFAULT_PULL_REQUEST_TITLE,
  type DeliveryRulesDraft,
  defaultDeliveryRules,
} from '@hemera/core/domain'
import type { CommandDraft } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { type BuilderHold, BuildingEnd } from '../src/engine/building/builder.ts'
import { latestBuildingIn } from '../src/engine/building/tasks.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import {
  missionCopies,
  readDeliveryRules,
  saveDeliveryRules,
} from '../src/engine/delivery-rules.ts'
import { cancelMissionIn, getMission } from '../src/engine/missions.ts'
import { getProject } from '../src/engine/projects.ts'
import { retryNeed } from '../src/engine/needs.ts'
import { CommitRights, Judge, stepCommitRights } from '../src/engine/permissions/ports.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { openSession } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { effectfulActions, sessionDeliveries } from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { acmeAt, call, eventsOf, grantOf } from './building-world.ts'
import { builderAgents, builderOf, launched, taskIn } from './builder-world.ts'
import { nodeLine } from './commands-engine.ts'
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

/**
 * Acme, its api set to the user's own identity before Hemera knows the repository (#457), and to
 * the hooks of `hooks` when it is given.
 */
const userAcme = (folder: string, hooks: string | null = null) =>
  acmeAt(folder, 'acme', (api) => {
    git(api, 'config', 'user.name', 'Ada Lovelace')
    git(api, 'config', 'user.email', 'ada@example.com')
    git(api, 'config', 'commit.gpgsign', 'false')
    if (hooks !== null) git(api, 'config', 'core.hooksPath', hooks)
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
const building = (
  steps: ReadonlyArray<DeliveryAction>,
  template: string | null = null,
  hooks: string | null = null,
) =>
  Effect.gen(function* () {
    const { project, mission } = yield* launched(work, undefined, undefined, undefined, (folder) =>
      userAcme(folder, hooks),
    )
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

/**
 * A pre-commit hook in a folder of its own that refuses every commit, saying "lint failed", until
 * `allowed` exists: outside the hooks, since Hemera stops its Git when what shapes Git there changes.
 */
const refusingHook = () => {
  const hooks = join(work, 'hooks')
  const allowed = join(work, 'allowed')
  mkdirSync(hooks)
  writeFileSync(
    join(hooks, 'pre-commit'),
    `#!/bin/sh\ntest -e '${allowed.replaceAll('\\', '/')}' && exit 0\necho 'lint failed' >&2\nexit 1\n`,
    { mode: 0o755 },
  )
  return { hooks, allowed }
}

/** A helper session of the mission, in the Builder's Workspace: its grant. */
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

  test('a commit that fails stops the stack there, asks the user with Git’s words, and is made at its Retry', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* building([HEMERA, CHECKED])
          // Git cannot take the index while its lock is there: the commit fails.
          const lock = join(git(api, 'rev-parse', '--absolute-git-dir'), 'index.lock')
          writeFileSync(lock, '')
          yield* t1Done(mission.id, grantId)
          yield* asked(mission.id)
          const failed = {
            log: logOf(api, head),
            needs: yield* environments(mission.id),
            next: yield* call(grantId, 'task_start', { task: 'T2' }),
          }
          rmSync(lock)
          yield* retryNeed(failed.needs[0]?.id ?? '')
          // Committed at the Retry, then the confirm after it is asked.
          yield* committedTimes(mission.id, 1)
          yield* until(
            Effect.map(environments(mission.id), (rows) =>
              rows.some((row) => row.missing.includes('the diff was read')),
            ),
          )
          return { failed, log: logOf(api, head) }
        }),
      ),
    )
    expect(seen.failed.log).toBe('')
    // One need, the commit's: nothing after the failed step runs, the confirm is not asked.
    expect(seen.failed.needs).toHaveLength(1)
    expect(seen.failed.needs[0]?.missing).toContain('T1 was not committed in api')
    expect(seen.failed.needs[0]?.missing).toContain('index.lock')
    expect(seen.failed.next).toContain('T2 waits')
    expect(seen.log).toBe('ACME-1: Export as CSV')
  })

  test('a step that failed holds the next tasks of its repository back until it is done', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { hooks, allowed } = refusingHook()
          const { mission, session, grantId, api, head } = yield* building([HEMERA], null, hooks)
          // T2 runs beside T1, on a helper: it is done while T1's commit waits for the user.
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(helper, 'task_start', { task: 'T2' })
          yield* call(helper, 'fs_write', {
            repository: 'api',
            path: 'export.ts',
            content: 'export const markdown = true\n',
          })
          yield* t1Done(mission.id, grantId)
          yield* asked(mission.id)
          const waiting = yield* call(grantId, 'task_start', { task: 'T4' })
          yield* call(helper, 'task_finished', { task: 'T2', summary: 'Markdown.' })
          yield* taskIn(mission.id, 'T2', 'done')
          writeFileSync(allowed, '')
          yield* retryNeed((yield* environments(mission.id))[0]?.id ?? '')
          yield* committedTimes(mission.id, 2)
          return { waiting, log: logOf(api, head) }
        }),
      ),
    )
    expect(seen.waiting).toContain('T4 waits: T1 was not committed in api')
    // T1 first, once retried; T2's commit never went before it.
    expect(seen.log.split('\n')).toEqual(['ACME-1: Export as Markdown', 'ACME-1: Export as CSV'])
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

  test('a Cancel while commit-by-agent waits closes the right to commit', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* building([AGENT])
          const commits = Effect.provide(
            CommitRights.use((rights) => rights.agentsCommit(mission.id)),
            stepCommitRights,
          )
          yield* t1Done(mission.id, grantId)
          yield* until(Effect.map(actionsOf('delivery.commit_by_agent'), (rows) => rows.length > 0))
          const open = yield* commits
          yield* mutate('cancelling in a test', (transaction) =>
            Effect.map(cancelMissionIn(transaction, mission.id), (events) => ({
              result: undefined,
              events,
            })),
          )
          return { open, cancelled: yield* commits }
        }),
      ),
    )
    expect(seen.open).toBe(true)
    expect(seen.cancelled).toBe(false)
  })
})

describe('After each task: the Building’s own steps', () => {
  test('a step an earlier Building of the mission left open, or done, is not this Building’s', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* building([ME])
          // As a Building cancelled or ended before this one left them: T1's step done, and an
          // agent's commit never made.
          const before = '2000-01-01T00:00:00.000Z'
          const secrets = yield* Secrets
          const earlier = (id: string, kind: string, state: string) => ({
            id,
            kind,
            ownerKind: 'mission',
            ownerId: mission.id,
            taskId: 'T1',
            details: secrets.mask(JSON.stringify({ repository: 'api', step: 'mine', head: null })),
            state,
            startedAt: before,
          })
          yield* Effect.flatMap(Database, (database) =>
            database
              .insert(effectfulActions)
              .values([
                earlier('earlier-mine', 'delivery.commit_by_me', 'done'),
                earlier('earlier-agent', 'delivery.commit_by_agent', 'started'),
              ]),
          )
          const rights = yield* Effect.provide(
            CommitRights.use((one) => one.agentsCommit(mission.id)),
            stepCommitRights,
          )
          yield* t1Done(mission.id, grantId)
          // T1's step of this Building is asked, as if the earlier one were not there.
          yield* asked(mission.id)
          return { rights, needs: yield* environments(mission.id) }
        }),
      ),
    )
    expect(seen.rights).toBe(false)
    expect(seen.needs).toHaveLength(1)
    expect(seen.needs[0]?.missing).toContain('T1')
  })

  test('a commit an earlier Building of the mission made for a task of the same id is not this Building’s', async () => {
    const seen = await engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* building([HEMERA])
          const secrets = yield* Secrets
          yield* Effect.flatMap(Database, (database) =>
            database.insert(effectfulActions).values({
              id: 'earlier-commit',
              kind: 'git.commit',
              ownerKind: 'mission',
              ownerId: mission.id,
              taskId: 'T1',
              details: secrets.mask(
                JSON.stringify({ repository: 'api', paths: ['invoices.ts'], message: 'earlier' }),
              ),
              state: 'done',
              startedAt: '2000-01-01T00:00:00.000Z',
            }),
          )
          yield* t1Done(mission.id, grantId)
          yield* committedTimes(mission.id, 1)
          return { log: logOf(api, head) }
        }),
      ),
    )
    expect(seen.log).toBe('ACME-1: Export as CSV')
  })
})

/** A script command of the catalogue in a repository, writing what it writes. */
const lateCommand = (line: string, repositoryId: string | null): CommandDraft => ({
  name: 'late',
  type: 'script',
  line,
  lineWindows: null,
  lineLinux: null,
  repositoryId,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
})

/**
 * The engine whose Building end only records, in `seen`, that it was called: the order of the
 * end and of what the test did shows whether the end waited.
 */
const recordedEnd = (seen: string[]) =>
  sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    building: {
      end: Layer.succeed(BuildingEnd, {
        end: () => Effect.sync(() => void seen.push('end')),
      }),
    },
  })

/** T1, T2 and T4 done with no change, then T3, the last task, done with its README changed. */
const lastTaskDone = (missionId: string, grantId: string) =>
  Effect.gen(function* () {
    for (const id of ['T1', 'T2', 'T4']) {
      const started = yield* call(grantId, 'task_start', { task: id })
      if (!started.startsWith(`${id} started`)) return yield* Effect.die(new Error(started))
      yield* call(grantId, 'task_finished', { task: id, summary: 'Nothing to change.' })
      yield* taskIn(missionId, id, 'done')
    }
    yield* call(grantId, 'task_start', { task: 'T3' })
    yield* call(grantId, 'fs_read', { repository: 'api', path: 'README.md' })
    yield* call(grantId, 'fs_write', {
      repository: 'api',
      path: 'README.md',
      content: 'Acme api, with exports\n',
    })
    yield* call(grantId, 'task_finished', { task: 'T3', summary: 'README.' })
    yield* taskIn(missionId, 'T3', 'done')
  })

describe('After each task: the end waits for the last task’s steps', () => {
  test('the last task with commit-by-agent: the end waits for the agent’s commit', async () => {
    const order: string[] = []
    await recordedEnd(order).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* building([AGENT])
          yield* lastTaskDone(mission.id, grantId)
          yield* until(Effect.map(actionsOf('delivery.commit_by_agent'), (rows) => rows.length > 0))
          order.push('commit')
          const made = yield* call(grantId, 'commands_run', {
            line: 'git commit -a -m ACME-1',
            repository: 'api',
          })
          if (made.includes('refused')) return yield* Effect.die(new Error(made))
          yield* until(Effect.sync(() => order.includes('end')))
        }),
      ),
    )
    expect(order).toEqual(['commit', 'end'])
  })

  test('the last task with commit-by-me: the end waits for the user’s commit', async () => {
    const order: string[] = []
    await recordedEnd(order).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api } = yield* building([ME])
          yield* lastTaskDone(mission.id, grantId)
          yield* asked(mission.id)
          order.push('commit')
          git(api, 'commit', '-q', '-a', '-m', 'README, by hand')
          yield* retryNeed((yield* environments(mission.id))[0]?.id ?? '')
          yield* until(Effect.sync(() => order.includes('end')))
        }),
      ),
    )
    expect(order).toEqual(['commit', 'end'])
  })

  test('the last task with a confirm: the end waits for the user’s confirm', async () => {
    const order: string[] = []
    await recordedEnd(order).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId } = yield* building([CHECKED])
          yield* lastTaskDone(mission.id, grantId)
          yield* asked(mission.id)
          order.push('confirm')
          yield* retryNeed((yield* environments(mission.id))[0]?.id ?? '')
          yield* until(Effect.sync(() => order.includes('end')))
        }),
      ),
    )
    expect(order).toEqual(['confirm', 'end'])
  })

  test('the last task whose own command still runs: the end waits for that command and its commit', async () => {
    // What the end saw: how many commits were made when it was called.
    const seen: number[] = []
    let commits: Effect.Effect<number> = Effect.succeed(-1)
    const engineOf = sessionsEngine(data, builderAgents, {
      roles: [HELPER],
      tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
      building: {
        end: Layer.succeed(BuildingEnd, {
          end: () =>
            Effect.flatMap(
              Effect.suspend(() => commits),
              (count) => Effect.sync(() => void seen.push(count)),
            ),
        }),
      },
    })
    await engineOf.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId } = yield* building([HEMERA])
          commits = within(
            profile,
            Effect.map(commitsOf(mission.id), (rows) => rows.length),
          )
          const release = join(work, 'release')
          const script = join(work, 'late.mjs')
          writeFileSync(
            script,
            `import { existsSync, writeFileSync } from 'node:fs'\nwhile (!existsSync(process.argv[2])) await new Promise((done) => setTimeout(done, 20))\nwriteFileSync('README.md', 'Acme api, late\\n')\n`,
          )
          const api = (yield* getProject(project.id)).repositories.find((one) => one.path === 'api')
          const late = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: lateCommand(nodeLine(script, release), api?.id ?? null),
          })
          for (const id of ['T1', 'T2', 'T4']) {
            yield* call(grantId, 'task_start', { task: id })
            yield* call(grantId, 'task_finished', { task: id, summary: 'Nothing to change.' })
            yield* taskIn(mission.id, id, 'done')
          }
          yield* call(grantId, 'task_start', { task: 'T3' })
          yield* call(grantId, 'fs_read', { repository: 'api', path: 'README.md' })
          yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'README.md',
            content: 'Acme api, with exports\n',
          })
          yield* call(grantId, 'commands_run', { command: late.id, timeout: 1 })
          yield* call(grantId, 'task_finished', { task: 'T3', summary: 'README.' })
          yield* taskIn(mission.id, 'T3', 'done')
          writeFileSync(release, '')
          yield* until(Effect.sync(() => seen.length > 0))
        }),
      ),
    )
    // Called once, after T3's commit, which holds what the command wrote last.
    expect(seen).toEqual([1])
  })

  test('the last task’s commit refused by a hook asks the user and holds the end; fixed and retried, it commits and the Building ends', async () => {
    const order: string[] = []
    const seen = await recordedEnd(order).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { hooks, allowed } = refusingHook()
          const { mission, grantId, api, head } = yield* building([HEMERA], null, hooks)
          yield* lastTaskDone(mission.id, grantId)
          yield* asked(mission.id)
          const needs = yield* environments(mission.id)
          order.push('fixed')
          writeFileSync(allowed, '')
          yield* retryNeed(needs[0]?.id ?? '')
          yield* until(Effect.sync(() => order.includes('end')))
          return { needs, log: logOf(api, head) }
        }),
      ),
    )
    expect(seen.needs).toHaveLength(1)
    expect(seen.needs[0]?.missing).toContain('T3 was not committed in api')
    expect(seen.needs[0]?.missing).toContain('lint failed')
    expect(order).toEqual(['fixed', 'end'])
    expect(seen.log).toBe('ACME-1: Document the exports')
  })

  test('a Cancel while the last task’s failed commit waits for the user ends the Building cleanly', async () => {
    const order: string[] = []
    const seen = await recordedEnd(order).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { hooks } = refusingHook()
          const { mission, grantId, api, head } = yield* building([HEMERA], null, hooks)
          yield* lastTaskDone(mission.id, grantId)
          yield* asked(mission.id)
          const state = yield* mutate('cancelling in a test', (transaction) =>
            Effect.gen(function* () {
              const events = yield* cancelMissionIn(transaction, mission.id)
              const one = yield* latestBuildingIn(transaction, mission.id)
              return { result: one?.state, events }
            }),
          )
          return { state, needs: yield* environments(mission.id), log: logOf(api, head) }
        }),
      ),
    )
    expect(seen.state).toBe('cancelled')
    expect(seen.needs).toEqual([])
    expect(seen.log).toBe('')
    expect(order).toEqual([])
  })
})
