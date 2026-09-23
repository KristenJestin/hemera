/**
 * The services of a Project: `serve` runs per Workspace or per Project (D8-07, D8-08).
 *
 * Each suite is named after a scenario of the Spec section `services`. Nothing is mocked: the
 * runs are real children of this machine that print an address and stay up, as a dev server
 * does, over the real engine on a database in a temporary folder. The second Workspace is a row
 * written as its creation would leave it, `ready`, with a folder of its own.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { Effect } from 'effect'

import { Commands } from '#engine/commands/service.ts'
import { Sessions } from '#engine/sessions.ts'
import { Database } from '#engine/storage/database.ts'
import { workspaces } from '#engine/storage/schema.ts'

import { PUBLISHES_AN_ADDRESS, engine, opened, request, scratch } from './commands-engine.ts'

/** A dedicated Workspace of the Project, `ready`, in a folder beside `main`. */
const loginForm = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const id = crypto.randomUUID()
    const path = join(scratch.folder, 'login-form')
    mkdirSync(path, { recursive: true })
    yield* database.insert(workspaces).values({
      id,
      projectId,
      name: 'login-form',
      path,
      createdAt: new Date().toISOString(),
      state: 'ready',
    })
    return { id, name: 'login-form', path }
  })

/**
 * The Project with its `login-form` Workspace, and a Session in each Workspace: what a `serve`
 * command is asked for from.
 */
const twoWorkspaces = Effect.gen(function* () {
  const main = yield* opened
  const workspace = yield* loginForm(main.projectId)
  const sessions = yield* Sessions
  const inLoginForm = yield* sessions.create(main.projectId, 'claude', workspace.id)
  return {
    main,
    workspace,
    inLoginForm: { projectId: main.projectId, sessionId: inLoginForm.id },
  }
})

/** `dev`, a `serve` command of the catalogue scoped to the Workspace, as the caller asks it. */
const dev = { name: 'dev', line: PUBLISHES_AN_ADDRESS, type: 'serve' as const }

describe('Two Workspaces run the same command as two instances', () => {
  it('runs dev once in login-form and once in main, and joins the login-form one again', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const { main, workspace, inLoginForm } = yield* twoWorkspaces
        const commands = yield* Commands
        const inWorkspace = request(inLoginForm, {
          ...dev,
          cwd: workspace.path,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        })
        const first = yield* commands.run(inWorkspace)
        const second = yield* commands.run(request(main, dev))
        const again = yield* commands.run(inWorkspace)
        return {
          first,
          second,
          again,
          workspace,
          running: yield* commands.runningOf(main.projectId),
        }
      }),
    )

    expect(seen.second.joined).toBe(false)
    expect(seen.second.id).not.toBe(seen.first.id)
    // Two runs going, each in its own Workspace's folder; started in the same millisecond, they
    // are read by Workspace rather than by order.
    expect(Object.fromEntries(seen.running.map((run) => [run.workspaceName, run.cwd]))).toEqual({
      'login-form': seen.workspace.path,
      main: scratch.root,
    })
    // A third ask in login-form is its instance, handed back rather than started.
    expect(seen.again.joined).toBe(true)
    expect(seen.again.id).toBe(seen.first.id)
  })
})

describe('A Project-scoped service is one instance for all', () => {
  it('starts auth in main from a login-form Session, and joins it from a main Session', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const { main, inLoginForm } = yield* twoWorkspaces
        const commands = yield* Commands
        // The caller resolves a Project-scoped command under main, whichever Workspace asks.
        const auth = { name: 'auth', line: PUBLISHES_AN_ADDRESS, type: 'serve' as const }
        const first = yield* commands.run(request(inLoginForm, { ...auth, scope: 'project' }))
        const second = yield* commands.run(request(main, { ...auth, scope: 'project' }))
        return { first, second, running: yield* commands.runningOf(main.projectId) }
      }),
    )

    expect(seen.running).toHaveLength(1)
    expect(seen.first.cwd).toBe(scratch.root)
    expect(seen.first.workspaceName).toBe('main')
    expect(seen.second.joined).toBe(true)
    expect(seen.second.id).toBe(seen.first.id)
  })
})

describe('Stopping one instance leaves the other running', () => {
  it('stops the login-form instance, and the main one is still running', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const { main, workspace, inLoginForm } = yield* twoWorkspaces
        const commands = yield* Commands
        const there = yield* commands.run(
          request(inLoginForm, {
            ...dev,
            cwd: workspace.path,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
          }),
        )
        const here = yield* commands.run(request(main, dev))
        const stopped = yield* commands.stop(inLoginForm.sessionId, there.id)
        return {
          here,
          stopped,
          still: yield* commands.output(main.sessionId, here.id),
          inMain: yield* commands.runningIn(null, main.projectId),
          inLoginForm: yield* commands.runningIn(workspace.id, main.projectId),
        }
      }),
    )

    expect(seen.stopped.state).toBe('stopped')
    expect(seen.still.state).toBe('running')
    expect(seen.inMain.map((run) => run.id)).toEqual([seen.here.id])
    expect(seen.inLoginForm).toEqual([])
  })
})
