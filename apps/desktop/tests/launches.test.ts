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
import { Specs } from '#engine/specs/specs.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import { Launches } from '#engine/workspaces/launches.ts'
import { Preparation } from '#engine/workspaces/preparation.ts'
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
