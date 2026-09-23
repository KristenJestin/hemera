/**
 * A Session runs in its Workspace (D8-08): the agent is started there, Hemera's tools take it as
 * their root, a catalogue command's folder resolves under it, and the choice is fixed once the
 * agent has started.
 *
 * The whole engine over the fake provider, as `agent-tools.test.ts` runs it: a Project whose
 * `main` is one folder, and a second Workspace `login-form` on another, written straight into the
 * `workspaces` table as a prepared one would be. Each suite is named after the scenario of the
 * Spec it plays.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Fiber } from 'effect'
import { z } from 'zod'

import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Commands } from '#engine/commands/service.ts'
import { Projects } from '#engine/projects.ts'
import {
  Sessions,
  UnknownWorkspaceError,
  WorkspaceFixedError,
  WorkspaceNotReadyError,
} from '#engine/sessions.ts'
import { Database } from '#engine/storage/database.ts'
import { workspaces } from '#engine/storage/schema.ts'
import { threadOf, toolApplication, until } from './application.ts'

let dataFolder: string
let main: string
let loginForm: string

/** A `sources/api/package.json` under a folder, naming whose it is. */
const packageIn = (folder: string, name: string): void => {
  mkdirSync(join(folder, 'sources', 'api'), { recursive: true })
  writeFileSync(join(folder, 'sources', 'api', 'package.json'), JSON.stringify({ name }))
}

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-session-workspace-'))
  // Both folders as the disk spells them, which is how a Workspace keeps its path.
  main = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-main-')))
  loginForm = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-login-form-')))
  packageIn(main, 'api-of-main')
  packageIn(loginForm, 'api-of-login-form')
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(main, { recursive: true, force: true })
  rmSync(loginForm, { recursive: true, force: true })
})

/** A Workspace of a Project, written as a prepared one is: its row, in the state given. */
const aWorkspace = (projectId: string, name: string, path: string, state = 'ready') =>
  Effect.gen(function* () {
    const database = yield* Database
    const id = crypto.randomUUID()
    yield* database
      .insert(workspaces)
      .values({ id, projectId, name, path, state, createdAt: new Date().toISOString() })
    return id
  })

/** A Project on `main`, its Workspace `login-form`, and a Session created on `login-form`. */
const inLoginForm = Effect.gen(function* () {
  const projects = yield* Projects
  const sessions = yield* Sessions
  const created = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: main })
  const project = yield* projects.addRepository(created.id, created.version, './sources/api')
  const workspaceId = yield* aWorkspace(project.id, 'login-form', loginForm)
  const session = yield* sessions.create(project.id, 'claude', workspaceId)
  return { session, workspaceId }
})

/** The identifier a question was asked under, which is what its answer is sent with. */
const QUESTION = z.object({ toolCallId: z.string(), root: z.string() })

/** A turn in which the human is asked, answered as the human does. */
const answeredTurn = (sessionId: string, text: string, optionId: 'allowed' | 'refused') =>
  Effect.gen(function* () {
    const runtime = yield* AgentRuntime
    const turn = yield* Effect.forkScoped(runtime.prompt(sessionId, text))
    const entries = yield* until(threadOf(sessionId), (seen) =>
      seen.some((entry) => entry.kind === 'permission_request' && entry.state === 'pending'),
    )
    const pending = entries.find(
      (entry) => entry.kind === 'permission_request' && entry.state === 'pending',
    )
    const question = QUESTION.parse(JSON.parse(pending?.payload ?? '{}'))
    yield* runtime.decide(sessionId, question.toolCallId, optionId)
    yield* Fiber.join(turn)
    return question
  })

describe('The agent and its tools work in the Workspace', () => {
  test('the agent starts in login-form, reads its file, and main is outside the root', async () => {
    const agent = fakeAgent({
      turns: [
        [{ does: 'uses', call: 'fs_read', arguments: { path: 'sources/api/package.json' } }],
        [
          {
            does: 'uses',
            call: 'fs_read',
            arguments: { path: join(main, 'sources', 'api', 'package.json') },
          },
        ],
      ],
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessions = yield* Sessions
        const { session } = yield* inLoginForm
        yield* runtime.prompt(session.id, 'read the package')
        const question = yield* answeredTurn(session.id, 'read the one of main', 'refused')
        return { question, one: yield* sessions.one(session.id) }
      }),
    )

    // The agent was opened in the Workspace's folder, which is what its Session keeps.
    expect(seen.one.native.cwd).toBe(loginForm)
    // And its context names that Workspace, its path and its repositories.
    expect(agent.answers.metas[0]).toContain(
      `Workspace: login-form at ${loginForm} (repositories: ./sources/api)`,
    )
    // A relative path reads the worktree's file, not main's.
    expect(agent.answers.used[0]?.isError).toBe(false)
    expect(agent.answers.used[0]?.text).toContain('api-of-login-form')
    // A path under main is outside the root: the human is asked, and refusing it refuses it.
    expect(seen.question.root).toBe(loginForm)
    expect(agent.answers.used[1]?.isError).toBe(true)
    expect(agent.answers.used[1]?.text).toContain(`is outside ${loginForm}`)
    expect(agent.answers.used[1]?.text).not.toContain('api-of-main')
  })
})

describe("A command's folder resolves inside the Workspace", () => {
  test('a catalogue command in ./sources/api runs under login-form', async () => {
    const agent = fakeAgent({
      steps: [{ does: 'uses', call: 'commands_run', arguments: { name: 'where', key: 'w1' } }],
    })

    const runs = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const commands = yield* Commands
        const { session } = yield* inLoginForm
        yield* commands.save(
          {
            projectId: session.projectId,
            name: 'where',
            line: `"${process.execPath}" -e "console.log(process.cwd())"`,
            lineWindows: null,
            lineLinux: null,
            type: 'script',
            folder: './sources/api',
            scope: 'workspace',
            portless: false,
          },
          false,
        )
        yield* runtime.prompt(session.id, 'where are you?')
        return yield* commands.recent(session.id)
      }),
    )

    expect(runs).toHaveLength(1)
    expect(runs[0]?.cwd).toBe(join(loginForm, 'sources', 'api'))
    expect(runs[0]?.workspaceId).not.toBeNull()
    expect(runs[0]?.output).toContain(join(loginForm, 'sources', 'api'))
  })
})

describe('The Workspace is fixed once the agent has started', () => {
  test('a change is accepted before the first turn and refused after it', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'done' }] })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessions = yield* Sessions
        const { session, workspaceId } = yield* inLoginForm
        // Before any turn the choice is open: to main, and back to login-form.
        const toMain = yield* sessions.chooseWorkspace(session.id, session.version, null)
        const back = yield* sessions.chooseWorkspace(session.id, toMain.version, workspaceId)
        yield* runtime.prompt(session.id, 'hello')
        const started = yield* sessions.one(session.id)
        const refused = yield* Effect.flip(
          sessions.chooseWorkspace(session.id, started.session.version, null),
        )
        const after = yield* sessions.one(session.id)
        return { workspaceId, toMain, back, refused, after }
      }),
    )

    expect(seen.toMain.workspaceId).toBeNull()
    expect(seen.back.workspaceId).toBe(seen.workspaceId)
    expect(seen.refused).toBeInstanceOf(WorkspaceFixedError)
    expect(seen.refused.message).toBe('The Workspace is fixed once the agent has started.')
    expect(seen.after.session.workspaceId).toBe(seen.workspaceId)
    expect(seen.after.native.cwd).toBe(loginForm)
  })
})

describe('a Session is created only on a ready Workspace of its Project', () => {
  test('a Workspace being prepared, unknown, or of another Project is refused', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'done' }] })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const projects = yield* Projects
        const sessions = yield* Sessions
        const project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: main })
        const other = yield* projects.create({
          name: 'Other',
          tone: 'primary',
          mainPath: loginForm,
        })
        const preparing = yield* aWorkspace(project.id, 'preparing', loginForm, 'preparing')
        const elsewhere = yield* aWorkspace(other.id, 'elsewhere', loginForm)
        return {
          preparing: yield* Effect.flip(sessions.create(project.id, 'claude', preparing)),
          unknown: yield* Effect.flip(sessions.create(project.id, 'claude', 'nothing')),
          elsewhere: yield* Effect.flip(sessions.create(project.id, 'claude', elsewhere)),
          sessions: yield* sessions.list(project.id),
        }
      }),
    )

    expect(seen.preparing).toBeInstanceOf(WorkspaceNotReadyError)
    expect(seen.unknown).toBeInstanceOf(UnknownWorkspaceError)
    expect(seen.elsewhere).toBeInstanceOf(UnknownWorkspaceError)
    expect(seen.sessions).toHaveLength(0)
  })
})
