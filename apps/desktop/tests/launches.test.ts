/**
 * The build a Spec launches: the Workspace it waits for, the Session it starts, and the start
 * again that leaves the environment alone (design D8-13 of #20).
 *
 * Every suite is named after the scenario of `Spec · build-launch` that it covers, and runs over
 * the whole engine on the fake agent `window.ts` composes.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { Projects } from '#engine/projects.ts'
import { Sessions } from '#engine/sessions.ts'
import { ReopenRefusedError } from '#engine/specs/revisions.ts'
import { Specs } from '#engine/specs/specs.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import { Launches } from '#engine/workspaces/launches.ts'
import { Preparation, recovered } from '#engine/workspaces/preparation.ts'
import { Workspaces } from '#engine/workspaces/workspaces.ts'

import { bareMachine, until } from './application.ts'
import { repository } from './repositories.ts'
import { frozen } from './specs-harness.ts'
import { type OpenWindow, openWindow, openWindowOn } from './window.ts'

let dataFolder: string
let opened: OpenWindow | undefined

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-launches-')))
})

afterEach(async () => {
  await opened?.close()
  opened = undefined
  rmSync(dataFolder, { recursive: true, force: true })
})

/** The launches as their rows stand, oldest first. */
const launches = Effect.gen(function* () {
  const sql = yield* SqliteClient
  return yield* sql<{ state: string; session_id: string | null; detail: string | null }>`
    SELECT state, session_id, detail FROM build_launches ORDER BY created_at`
})

/** The build Sessions, with the revision and the Workspace their rows hold (D8-13). */
const builds = Effect.gen(function* () {
  const sql = yield* SqliteClient
  return yield* sql<{
    id: string
    spec_id: string | null
    revision_id: string | null
    workspace_id: string | null
  }>`SELECT id, spec_id, revision_id, workspace_id FROM sessions
    WHERE mission = 'build' ORDER BY created_at`
})

/** The Workspace a Spec is built in, which a launch writes (D8-12). */
const builtIn = (specId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    const [row] = yield* sql<{ workspace_id: string | null }>`
      SELECT workspace_id FROM specs WHERE id = ${specId}`
    return row?.workspace_id ?? null
  })

/**
 * The launch an engine that stopped is made to have left `waiting`: the identifier `request`
 * writes for a row no start ever reached.
 */
const LEFT_WAITING = 'launch-left-waiting'

/** A Project on a real `main`, one repository of its own, and a `ready` Spec with a writer. */
const atlas = (ready = true) =>
  Effect.gen(function* () {
    const main = join(dataFolder, 'main')
    mkdirSync(join(main, 'docs'), { recursive: true })
    repository(join(main, 'sources', 'api'))
    const projects = yield* Projects
    const created = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: main })
    const project = yield* projects.addRepository(created.id, created.version, './sources/api')
    const writer = yield* (yield* Sessions).create(project.id, 'claude')
    const { session, snapshot } = yield* (yield* Specs).create({
      sessionId: writer.id,
      type: 'feature',
      title: 'Export the journal',
    })
    if (ready) yield* frozen(snapshot.spec.id, session.id)
    return { project, key: snapshot.spec.key, specId: snapshot.spec.id, session }
  })

/** A Workspace of that Project: `preparing`, with the worktree of its repository as a step. */
const making = (projectId: string, specId: string, key: string) =>
  Effect.gen(function* () {
    const workspaces = yield* Workspaces
    const plan = yield* workspaces.plan(projectId, key, 'export')
    return yield* workspaces.create(projectId, {
      specId,
      name: plan.name,
      repositories: plan.repositories
        .filter((one) => one.included)
        .map((one) => ({
          relativePath: one.relativePath,
          base: one.base ?? '',
          branch: one.branch,
        })),
    })
  })

/** A Workspace on a folder the user picked: `ready`, with no step at all (D8-02). */
const picked = (projectId: string) =>
  Effect.gen(function* () {
    const folder = join(dataFolder, 'spike')
    mkdirSync(folder, { recursive: true })
    return yield* (yield* Workspaces).createOnFolder(projectId, folder, 'spike')
  })

/**
 * A ready Spec of that Project that nothing is writing: the agent of a build of it would be the
 * one the Project was left on, and this Project was left on nothing — so the build is refused
 * rather than guessed at (D8-13). The Specs are written by their own lot, which is why the row is
 * written here.
 */
const unwrittenSpec = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    const id = 'spec-left-on-nothing'
    const revisionId = 'revision-of-the-spec-left-on-nothing'
    const at = '2026-09-25T08:00:00.000Z'
    yield* sql`INSERT INTO specs
      (id, project_id, key, slug, status, current_revision_id, created_at, updated_at)
      VALUES (${id}, ${projectId}, 'HEM-9', 'left-on-nothing', 'ready', ${revisionId}, ${at}, ${at})`
    yield* sql`INSERT INTO spec_revisions
      (id, spec_id, number, title, type, created_by, created_at)
      VALUES (${revisionId}, ${id}, 1, 'Left on nothing', 'feature', 'human', ${at})`
    return { id, revisionId }
  })

describe('A build waits for its environment', () => {
  test('Moving a Spec to ready starts nothing', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const { project, specId } = yield* atlas()
        const born = yield* (yield* Sessions).list(project.id)
        return {
          rows: yield* launches,
          builds: yield* builds,
          born: born.map((one) => one.mission),
          builtIn: yield* builtIn(specId),
        }
      }),
    )
    expect(seen.rows).toEqual([])
    expect(seen.builds).toEqual([])
    expect(seen.born).not.toContain('build')
    expect(seen.builtIn).toBeNull()
  })

  test('Prepare then start waits for the environment', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const { project, key, specId } = yield* atlas()
        const preparation = yield* Preparation
        const launched = yield* Launches
        const workspace = yield* making(project.id, specId, key)
        const asked = yield* launched.request(specId, workspace.id)
        const waiting = yield* launches
        yield* preparation.prepare(workspace.id)
        const started = yield* until(
          launched.one(asked.id),
          (one) => one.state === 'started' || one.state === 'failed',
        )
        return { asked, builds: yield* builds, builtIn: yield* builtIn(specId), started, waiting }
      }),
    )
    expect(seen.asked.state).toBe('waiting')
    expect(seen.waiting.map((row) => row.state)).toEqual(['waiting'])
    expect(seen.started.state).toBe('started')
    expect(seen.builds).toEqual([
      {
        id: seen.started.sessionId,
        spec_id: seen.asked.specId,
        revision_id: seen.asked.revisionId,
        workspace_id: seen.asked.workspaceId,
      },
    ])
    expect(seen.builtIn).toBe(seen.asked.workspaceId)
  })

  test('Start the build on a ready Workspace starts at once', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const { project, specId } = yield* atlas()
        const workspace = yield* picked(project.id)
        const launch = yield* (yield* Launches).request(specId, workspace.id)
        return { builds: yield* builds, builtIn: yield* builtIn(specId), launch, workspace }
      }),
    )
    expect(seen.launch.state).toBe('started')
    expect(seen.launch.sessionId).not.toBeNull()
    expect(seen.builds).toEqual([
      {
        id: seen.launch.sessionId,
        spec_id: seen.launch.specId,
        revision_id: seen.launch.revisionId,
        workspace_id: seen.workspace.id,
      },
    ])
    expect(seen.builtIn).toBe(seen.workspace.id)
  })

  test('A request and the Workspace becoming ready at once start the build once', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const { project, key, specId } = yield* atlas()
        const launched = yield* Launches
        const preparation = yield* Preparation
        const workspace = yield* making(project.id, specId, key)
        // The two arrive together: the request that writes the launch and the preparation whose
        // last step makes the Workspace ready. Either may read what the other wrote first, and
        // the launch is started by whoever finds it `waiting` — once (D8-13).
        const [asked] = yield* Effect.all(
          [launched.request(specId, workspace.id), preparation.prepare(workspace.id)],
          { concurrency: 'unbounded' },
        )
        const settled = yield* until(
          launched.one(asked.id),
          (one) => one.state === 'started' || one.state === 'failed',
        )
        return { asked, builds: yield* builds, rows: yield* launches, settled }
      }),
    )
    // Whoever arrived second found the launch and started it: never left waiting for an
    // environment that is already there.
    expect(seen.settled.state).toBe('started')
    expect(seen.rows).toEqual([
      { state: 'started', session_id: seen.settled.sessionId, detail: null },
    ])
    // And once: two starters, one build Session.
    expect(seen.builds).toEqual([
      {
        id: seen.settled.sessionId,
        spec_id: seen.asked.specId,
        revision_id: seen.asked.revisionId,
        workspace_id: seen.asked.workspaceId,
      },
    ])
  })
})

describe('A launch refuses what cannot be built', () => {
  test('A launch on a Spec that is not ready is refused', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const { project, specId } = yield* atlas(false)
        const workspace = yield* picked(project.id)
        const refused = yield* Effect.flip((yield* Launches).request(specId, workspace.id))
        return { builtIn: yield* builtIn(specId), refused, rows: yield* launches }
      }),
    )
    expect(seen.refused.message).toContain('draft')
    expect(seen.rows).toEqual([])
    expect(seen.builtIn).toBeNull()
  })
})

describe('A failed start is retried on its own', () => {
  test('A failed agent launch is retried without redoing the preparation', async () => {
    // A machine that holds none of the agents' bare means: the agent cannot be started (D6-02).
    opened = await openWindowOn(dataFolder, bareMachine, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const { project, key, specId } = yield* atlas()
        const preparation = yield* Preparation
        const launched = yield* Launches
        const workspace = yield* making(project.id, specId, key)
        const asked = yield* launched.request(specId, workspace.id)
        yield* preparation.prepare(workspace.id)
        const first = yield* until(
          launched.one(asked.id),
          (one) => one.state === 'started' || one.state === 'failed',
        )
        const before = yield* preparation.steps(workspace.id)
        const again = yield* launched.retry(first.id)
        return {
          again,
          after: yield* preparation.steps(workspace.id),
          before,
          builds: yield* builds,
          first,
          workspace: yield* (yield* Workspaces).one(workspace.id),
        }
      }),
    )
    expect(seen.first.state).toBe('failed')
    expect(seen.first.detail).toContain('Claude Code')
    expect(seen.before).toHaveLength(1)
    // The same Session, started again: the environment is not touched a second time.
    expect(seen.again.sessionId).toBe(seen.first.sessionId)
    expect(seen.again.state).toBe('failed')
    expect(seen.after).toEqual(seen.before)
    expect(seen.workspace.state).toBe('ready')
    expect(seen.builds).toHaveLength(1)
  })
})

describe('One build left on nothing holds back nothing beside it', () => {
  test('A launch refused at its start fails on its own, and the next one still starts', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const { project, key, specId } = yield* atlas()
        const launched = yield* Launches
        const preparation = yield* Preparation
        const workspace = yield* making(project.id, specId, key)
        const nothing = yield* unwrittenSpec(project.id)
        // Two launches wait on the one Workspace: the one that will be refused is asked for
        // first, so it is the one started first.
        yield* launched.request(nothing.id, workspace.id)
        const asked = yield* launched.request(specId, workspace.id)
        yield* preparation.prepare(workspace.id)
        const settled = yield* until(launches, (all) =>
          all.every((row) => row.state !== 'waiting' && row.state !== 'starting'),
        )
        return { asked, builds: yield* builds, settled }
      }),
    )
    expect(seen.settled).toHaveLength(2)
    expect(seen.settled[0]?.state).toBe('failed')
    expect(seen.settled[0]?.detail).toContain('no agent has been chosen')
    expect(seen.settled[0]?.session_id).toBeNull()
    // The one beside it starts, and one build Session is what came of the two launches.
    expect(seen.settled[1]?.state).toBe('started')
    expect(seen.builds).toEqual([
      {
        id: seen.settled[1]?.session_id,
        spec_id: seen.asked.specId,
        revision_id: seen.asked.revisionId,
        workspace_id: seen.asked.workspaceId,
      },
    ])
  })
})

describe('The engine comes back to what a stopped engine left', () => {
  test('A launch left starting is failed as interrupted, and its Session starts again', async () => {
    // A machine that holds none of the agents' bare means: the agent cannot be started (D6-02),
    // and that is where the first engine is closed on the launch.
    opened = await openWindowOn(dataFolder, bareMachine, fakeAgent())
    const left = await opened.running(
      Effect.gen(function* () {
        const { project, key, specId } = yield* atlas()
        const launched = yield* Launches
        const workspace = yield* making(project.id, specId, key)
        const asked = yield* launched.request(specId, workspace.id)
        yield* (yield* Preparation).prepare(workspace.id)
        const failed = yield* until(launched.one(asked.id), (one) => one.state === 'failed')
        // The engine stops while that build was being started: what it leaves behind is a launch
        // `starting`, with the Session it had already written (D8-13).
        const sql = yield* SqliteClient
        yield* sql`UPDATE build_launches SET state = 'starting', detail = NULL
          WHERE id = ${failed.id}`
        return failed
      }),
    )
    await opened.close()
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const launched = yield* Launches
        yield* recovered
        const back = yield* launched.one(left.id)
        const before = yield* builds
        const again = yield* launched.retry(left.id)
        return { after: yield* builds, again, back, before }
      }),
    )
    expect(seen.back.state).toBe('failed')
    expect(seen.back.detail).toBe('interrupted')
    // Its Session and its Workspace stand, and the build is not started again on its own: Retry
    // is what starts that same Session again (D8-13).
    expect(seen.back.sessionId).toBe(left.sessionId)
    expect(seen.again.state).toBe('started')
    expect(seen.again.sessionId).toBe(left.sessionId)
    // One build, before and after: Retry starts the Session the launch already had.
    expect(seen.before).toHaveLength(1)
    expect(seen.after).toEqual(seen.before)
  })

  test('A launch left waiting on a Workspace that is ready starts on the way back', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const left = await opened.running(
      Effect.gen(function* () {
        const { project, specId } = yield* atlas()
        const sql = yield* SqliteClient
        const workspace = yield* picked(project.id)
        const [spec] = yield* sql<{ current_revision_id: string }>`
          SELECT current_revision_id FROM specs WHERE id = ${specId}`
        const revisionId = spec?.current_revision_id
        if (revisionId === undefined) {
          return yield* Effect.fail(new Error('the Spec has no current revision'))
        }
        // The launch the last engine wrote before it stopped, on a Workspace that was ready all
        // along (D8-02): the row `request` writes, which no start ever reached (D8-13).
        const at = '2026-09-25T08:00:00.000Z'
        yield* sql`INSERT INTO build_launches
          (id, spec_id, revision_id, workspace_id, state, created_at, updated_at)
          VALUES (${LEFT_WAITING}, ${specId}, ${revisionId}, ${workspace.id}, 'waiting', ${at}, ${at})`
        return { revisionId, specId, workspace }
      }),
    )
    await opened.close()
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const launched = yield* Launches
        yield* recovered
        return { builds: yield* builds, launch: yield* launched.one(LEFT_WAITING) }
      }),
    )
    // What it waited for is there: the build starts, on the revision and in the Workspace the
    // launch was written with.
    expect(seen.launch.state).toBe('started')
    expect(seen.builds).toEqual([
      {
        id: seen.launch.sessionId,
        spec_id: left.specId,
        revision_id: left.revisionId,
        workspace_id: left.workspace.id,
      },
    ])
  })
})

describe('A Rework cancels a launch that has not started', () => {
  test('A Rework during the preparation cancels the launch and keeps the environment', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const { project, key, specId, session } = yield* atlas()
        const launched = yield* Launches
        const preparation = yield* Preparation
        const workspaces = yield* Workspaces
        const sql = yield* SqliteClient
        const workspace = yield* making(project.id, specId, key)
        const asked = yield* launched.request(specId, workspace.id)
        const [spec] = yield* sql<{ current_revision_id: string }>`
          SELECT current_revision_id FROM specs WHERE id = ${specId}`
        const revisionId = spec?.current_revision_id
        if (revisionId === undefined) {
          return yield* Effect.fail(new Error('the Spec has no current revision'))
        }
        const kept = yield* workspaces.one(workspace.id)
        // The user reworks the Spec while the launch waits for its environment (D7-05).
        yield* (yield* Specs).reopen({
          specId,
          expectedRevisionId: revisionId,
          reason: 'Another shape.',
          sessionId: session.id,
        })
        const cancelled = yield* launched.one(asked.id)
        // The preparation is not interrupted by it: its steps go on, and the Workspace is ready.
        yield* preparation.prepare(workspace.id)
        const settled = yield* until(launches, (all) =>
          all.every((row) => row.state !== 'waiting' && row.state !== 'starting'),
        )
        return {
          after: yield* workspaces.one(workspace.id),
          asked,
          builds: yield* builds,
          cancelled,
          events: yield* sql<{ type: string; payload: string }>`
            SELECT type, payload FROM domain_events WHERE type = 'launch.cancelled'`,
          kept,
          settled,
          steps: yield* preparation.steps(workspace.id),
        }
      }),
    )

    // Cancelled, saying what cancelled it (D8-13), and the Journal holds the line.
    expect(seen.cancelled.state).toBe('cancelled')
    expect(seen.cancelled.detail).toBe('reworked')
    expect(seen.settled).toEqual([{ state: 'cancelled', session_id: null, detail: 'reworked' }])
    expect(seen.events).toEqual([
      {
        type: 'launch.cancelled',
        payload: JSON.stringify({
          specId: seen.asked.specId,
          revisionId: seen.asked.revisionId,
          reason: 'reworked',
        }),
      },
    ])
    // The environment is kept as it was — the same Workspace, its worktrees untouched — and its
    // steps go on to ready, which starts nothing: the launch they were prepared for is cancelled.
    expect(seen.after.path).toBe(seen.kept.path)
    expect(seen.after.repositories).toEqual(seen.kept.repositories)
    expect(seen.after.state).toBe('ready')
    expect(seen.steps.length).toBeGreaterThan(0)
    expect(seen.steps.every((step) => step.state === 'done')).toBe(true)
    expect(seen.builds).toEqual([])
  })

  test('A started launch is not cancelled by a Rework', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    const seen = await opened.running(
      Effect.gen(function* () {
        const { project, specId, session } = yield* atlas()
        const specs = yield* Specs
        const launched = yield* Launches
        const workspaces = yield* Workspaces
        const sql = yield* SqliteClient
        // A Workspace that is already ready: the launch starts at once, and its build Session is
        // there (D8-13).
        const workspace = yield* picked(project.id)
        const launch = yield* launched.request(specId, workspace.id)
        const [spec] = yield* sql<{ current_revision_id: string }>`
          SELECT current_revision_id FROM specs WHERE id = ${specId}`
        const revisionId = spec?.current_revision_id
        if (revisionId === undefined) {
          return yield* Effect.fail(new Error('the Spec has no current revision'))
        }
        // The build has started and the Spec is still `ready`: it only moves to `in_progress`
        // when the build's first task runs (core.md, "The build mission protocol"). A Rework is
        // allowed there, and it cancels nothing — what has started keeps running (D8-13).
        const reworked = yield* specs.reopen({
          specId,
          expectedRevisionId: revisionId,
          reason: 'Another shape.',
          sessionId: session.id,
        })
        const kept = yield* launched.one(launch.id)
        // Once that first task has moved the Spec on, the Rework cannot reach the launch at all:
        // it is refused, as it is for any Spec that is not `ready` (D7-05).
        yield* sql`UPDATE specs SET status = 'in_progress' WHERE id = ${specId}`
        const refused = yield* Effect.flip(
          specs.reopen({
            specId,
            expectedRevisionId: reworked.revision.id,
            sessionId: session.id,
          }),
        )
        return {
          after: yield* launched.one(launch.id),
          builds: yield* builds,
          cancelled: yield* sql<{ count: number }>`
            SELECT count(*) AS count FROM domain_events WHERE type = 'launch.cancelled'`,
          kept,
          launch,
          refused,
          reworked,
          rows: yield* launches,
          workspace: yield* workspaces.one(workspace.id),
        }
      }),
    )

    expect(seen.refused).toBeInstanceOf(ReopenRefusedError)
    expect(seen.refused.message).toContain('in_progress')
    // The build that started is untouched: the same launch, the same Session, and no launch was
    // cancelled.
    expect(seen.reworked.revision.number).toBe(2)
    expect(seen.kept.state).toBe('started')
    expect(seen.kept.sessionId).toBe(seen.launch.sessionId)
    expect(seen.after.state).toBe('started')
    expect(Number(seen.cancelled[0]?.count)).toBe(0)
    expect(seen.rows).toEqual([
      { state: 'started', session_id: seen.launch.sessionId, detail: null },
    ])
    expect(seen.builds).toEqual([
      {
        id: seen.launch.sessionId,
        spec_id: seen.launch.specId,
        revision_id: seen.launch.revisionId,
        workspace_id: seen.workspace.id,
      },
    ])
    // And the Workspace the build works in is still there.
    expect(seen.workspace.state).toBe('ready')
  })
})
