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
import { runFromPanel } from '#engine/commands/panel.ts'
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
import { Variables, variablesLayer } from '#engine/workspaces/variables.ts'
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
    // And its context names that Workspace, its path and its repositories, inside the JSON the
    // agent is handed (where a Windows path's backslashes are escaped).
    expect(agent.answers.metas[0]).toContain(
      JSON.stringify(`Workspace: login-form at ${loginForm} (repositories: ./sources/api)`).slice(
        1,
        -1,
      ),
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

describe('A Project-scoped service is one instance for all', () => {
  test('auth asked from login-form runs in main with main’s variables, and main joins it', async () => {
    const running = (key: string) => [
      { does: 'uses' as const, call: 'commands_run', arguments: { name: 'auth', key } },
    ]
    // One agent per Session: a Session on login-form, then one on main.
    const fromLoginForm = fakeAgent({ steps: running('auth-1') })
    const fromMain = fakeAgent({ steps: running('auth-2') })

    const seen = await toolApplication(dataFolder)(fromLoginForm, fromMain)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const commands = yield* Commands
        const sessions = yield* Sessions
        const variables = yield* Variables
        const { session, workspaceId } = yield* inLoginForm
        // The Project sets PORT, and login-form sets it over: main's run is given the Project's.
        yield* variables.set(session.projectId, null, 'PORT', '3000')
        yield* variables.set(session.projectId, workspaceId, 'PORT', '3001')
        yield* commands.save(
          {
            projectId: session.projectId,
            name: 'auth',
            line: `"${process.execPath}" -e "console.log(process.cwd());setInterval(()=>{},1000)"`,
            lineWindows: null,
            lineLinux: null,
            type: 'serve',
            folder: './sources/api',
            scope: 'project',
            portless: false,
          },
          false,
        )
        yield* runtime.prompt(session.id, 'start auth')
        const onMain = yield* sessions.create(session.projectId, 'claude')
        yield* runtime.prompt(onMain.id, 'start auth too')
        return {
          first: (yield* commands.running(session.id))[0],
          running: yield* commands.runningOf(session.projectId),
          main: yield* sessions.mainOf(session.projectId),
        }
      }).pipe(Effect.provide(variablesLayer)),
    )

    expect(seen.running).toHaveLength(1)
    expect(seen.first?.cwd).toBe(join(main, 'sources', 'api'))
    expect(seen.first?.workspaceName).toBe('main')
    expect(seen.first?.workspaceId).toBe(seen.main.id)
    expect(seen.first?.environment).toEqual({ PORT: '3000' })
    expect(fromMain.answers.used[0]?.text).toContain('already running')
    expect(fromMain.answers.used[0]?.text).toContain(seen.first?.id ?? 'no run')
  })

  test('auth run from the panel of a login-form Session runs in main', async () => {
    const run = await toolApplication(dataFolder)(fakeAgent())(
      Effect.gen(function* () {
        const commands = yield* Commands
        const { session } = yield* inLoginForm
        yield* commands.save(
          {
            projectId: session.projectId,
            name: 'auth',
            line: `"${process.execPath}" -e "setInterval(()=>{},1000)"`,
            lineWindows: null,
            lineLinux: null,
            type: 'serve',
            folder: null,
            scope: 'project',
            portless: false,
          },
          false,
        )
        return yield* runFromPanel(session.id, 'auth', undefined)
      }).pipe(Effect.provide(variablesLayer)),
    )

    expect(run.cwd).toBe(main)
    expect(run.workspaceName).toBe('main')
  })
})

describe('An agent is given the variables of its Workspace', () => {
  test('PORT=3001 of login-form reaches the agent’s process, and its bare means stays on top', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'done' }] })

    await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessions = yield* Sessions
        const variables = yield* Variables
        const { session, workspaceId } = yield* inLoginForm
        yield* variables.set(session.projectId, null, 'PORT', '3000')
        yield* variables.set(session.projectId, null, 'API_URL', 'http://localhost:4000')
        yield* variables.set(session.projectId, workspaceId, 'PORT', '3001')
        // A variable that would move the agent's own configuration is not given over its bare mode.
        yield* variables.set(session.projectId, workspaceId, 'XDG_CONFIG_HOME', '/elsewhere')
        const onOpenCode = yield* sessions.create(session.projectId, 'opencode', workspaceId)
        yield* runtime.prompt(onOpenCode.id, 'hello')
      }).pipe(Effect.provide(variablesLayer)),
    )

    const environment = agent.environments[0] ?? {}
    expect(environment['PORT']).toBe('3001')
    expect(environment['API_URL']).toBe('http://localhost:4000')
    expect(environment['XDG_CONFIG_HOME']).not.toBe('/elsewhere')
    expect(environment['XDG_CONFIG_HOME']).toContain(dataFolder)
  })
})

describe('A variable set on main applies to a Session on main', () => {
  test('PORT set on main’s own row is given to a run from a Session that chose no Workspace', async () => {
    const agent = fakeAgent({
      steps: [{ does: 'uses', call: 'commands_run', arguments: { name: 'port', key: 'p1' } }],
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const projects = yield* Projects
        const sessions = yield* Sessions
        const commands = yield* Commands
        const variables = yield* Variables
        const runtime = yield* AgentRuntime
        const project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: main })
        const own = yield* sessions.mainOf(project.id)
        yield* variables.set(project.id, own.id, 'PORT', '3002')
        yield* commands.save(
          {
            projectId: project.id,
            name: 'port',
            line: `"${process.execPath}" -e "console.log('port=' + process.env.PORT)"`,
            lineWindows: null,
            lineLinux: null,
            type: 'script',
            folder: null,
            scope: 'workspace',
            portless: false,
          },
          false,
        )
        // A Session that chose no Workspace works in main, by main's own row.
        const session = yield* sessions.create(project.id, 'claude')
        yield* runtime.prompt(session.id, 'which port?')
        return {
          own,
          workspace: yield* sessions.workspace(session.id),
          run: (yield* commands.recent(session.id))[0],
        }
      }).pipe(Effect.provide(variablesLayer)),
    )

    expect(seen.workspace.id).toBe(seen.own.id)
    expect(seen.run?.workspaceId).toBe(seen.own.id)
    expect(seen.run?.environment).toEqual({ PORT: '3002' })
    expect(seen.run?.output).toContain('port=3002')
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
