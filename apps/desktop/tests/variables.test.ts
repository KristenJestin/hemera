/**
 * The variables of a Project and of its Workspaces, and what a run is given (D8-06, D8-16).
 *
 * Each suite is named after the scenario of the Spec it covers, over the real engine: a run is a
 * real child of this machine, and what it prints is what it was given.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect } from 'effect'

import { InvalidVariableKeyError } from '@hemera/core'
import { Commands } from '#engine/commands/service.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import { Preparation } from '#engine/workspaces/preparation.ts'
import { Recipe } from '#engine/workspaces/recipe.ts'
import { Variables } from '#engine/workspaces/variables.ts'
import { UnknownWorkspaceError } from '#engine/workspaces/described.ts'
import { Workspaces } from '#engine/workspaces/workspaces.ts'

import { aSessionOf, atlas, atlasMain, saved, workspaceEngine } from './workspace-engine.ts'

let folder: string
let main: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'hemera-variables-'))
  main = atlasMain(folder)
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** A Project, and a Workspace of it that is `ready` on a folder of the suite's. */
const inAWorkspace = Effect.gen(function* () {
  const workspaces = yield* Workspaces
  const project = yield* atlas(main, [])
  const spike = join(folder, 'spike')
  mkdirSync(spike, { recursive: true })
  const workspace = yield* workspaces.createOnFolder(project.id, spike)
  return { project, workspace }
})

/** Reads until the run has ended, bounded: a run that never ends fails the suite. */
const ended = (sessionId: string, runId: string) =>
  Effect.gen(function* () {
    const commands = yield* Commands
    return yield* commands.awaited(sessionId, runId, 10_000)
  })

describe('A Workspace’s variable overrides the Project’s', () => {
  it('gives the process the Workspace’s value, and the run shows it among what it was given', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const variables = yield* Variables
        const commands = yield* Commands
        const { project, workspace } = yield* inAWorkspace
        yield* variables.set(project.id, null, 'PORT', '3000')
        yield* variables.set(project.id, null, 'MODE', 'dev')
        yield* variables.set(project.id, workspace.id, 'PORT', '3001')
        const environment = yield* variables.environmentFor(project.id, workspace.id)
        const inMain = yield* variables.environmentFor(project.id, null)
        const given = yield* variables.givenFor(project.id, workspace.id)
        const session = yield* aSessionOf(project.id)
        const started = yield* commands.run({
          sessionId: session.id,
          projectId: project.id,
          commandId: null,
          name: 'port',
          line: `"${process.execPath}" -e "console.log(process.env.PORT)"`,
          lineWindows: null,
          lineLinux: null,
          type: 'script',
          scope: 'workspace',
          portless: false,
          portlessName: null,
          folder: null,
          cwd: workspace.path,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          environment: given,
          startedBy: 'user',
        })
        return { environment, inMain, given, run: yield* ended(session.id, started.id) }
      }),
    )

    expect(seen.environment['PORT']).toBe('3001')
    expect(seen.environment['MODE']).toBe('dev')
    // The process's own environment is underneath what Hemera gives.
    expect(seen.environment['PATH']).toBe(process.env['PATH'])
    expect(seen.inMain['PORT']).toBe('3000')
    // What Hemera gave, without the process's environment: what a run shows.
    expect(seen.given).toEqual({ MODE: 'dev', PORT: '3001' })
    expect(seen.run.state).toBe('exited')
    expect(seen.run.output.trim()).toBe('3001')
    expect(seen.run.environment).toMatchObject({ PORT: '3001' })
  })

  it('gives a preparation step’s run the Workspace’s value, and the run keeps it', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const variables = yield* Variables
        const preparation = yield* Preparation
        const commands = yield* Commands
        const project = yield* atlas(main, ['./sources/api'])
        const port = yield* saved(
          project.id,
          'port',
          `"${process.execPath}" -e "console.log(process.env.PORT)"`,
          'script',
        )
        yield* (yield* Recipe).add(project.id, {
          kind: 'run',
          base: null,
          path: null,
          commandId: port.id,
        })
        const plan = yield* workspaces.plan(project.id, 'HEM-7', 'login-form')
        const workspace = yield* workspaces.create(project.id, {
          specId: 'HEM-7',
          name: plan.name,
          repositories: plan.repositories.map((one) => ({
            relativePath: one.relativePath,
            base: one.base ?? '',
            branch: one.branch,
          })),
        })
        yield* variables.set(project.id, null, 'PORT', '3000')
        yield* variables.set(project.id, workspace.id, 'PORT', '3001')
        const prepared = yield* preparation.prepare(workspace.id)
        const step = (yield* preparation.steps(workspace.id)).find((one) => one.kind === 'run')
        return { prepared, run: yield* commands.output(null, step?.runId ?? '') }
      }),
    )

    expect(seen.prepared.state).toBe('ready')
    expect(seen.run.sessionId).toBeNull()
    expect(seen.run.output.trim()).toBe('3001')
    expect(seen.run.environment).toEqual({ PORT: '3001' })
  })
})

describe('A variable is named as a shell names one', () => {
  it('refuses a key a shell would not take, and a Workspace of no such Project', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const variables = yield* Variables
        const { project } = yield* inAWorkspace
        const lower = yield* Effect.flip(variables.set(project.id, null, 'port', '1'))
        const digit = yield* Effect.flip(variables.set(project.id, null, '1PORT', '1'))
        const nowhere = yield* Effect.flip(variables.set(project.id, 'nobody', 'PORT', '1'))
        const trimmed = yield* variables.set(project.id, null, ' API_URL ', 'http://localhost')
        return { lower, digit, nowhere, trimmed, listed: yield* variables.list(project.id, null) }
      }),
    )

    expect(seen.lower).toBeInstanceOf(InvalidVariableKeyError)
    expect(seen.digit).toBeInstanceOf(InvalidVariableKeyError)
    expect(seen.nowhere).toBeInstanceOf(UnknownWorkspaceError)
    expect(seen.trimmed.key).toBe('API_URL')
    expect(seen.listed).toEqual([{ key: 'API_URL', value: 'http://localhost', workspaceId: null }])
  })
})

describe('A change of a variable is a line of the Journal, without its value', () => {
  it('names the key and the scope, on the Workspace or on the Project', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const variables = yield* Variables
        const { project, workspace } = yield* inAWorkspace
        yield* variables.set(project.id, null, 'TOKEN', 'secret-one')
        yield* variables.set(project.id, workspace.id, 'TOKEN', 'secret-two')
        yield* variables.remove(project.id, workspace.id, 'TOKEN')
        // A key that was never set: nothing changed, and nothing is written.
        yield* variables.remove(project.id, workspace.id, 'ABSENT')
        const sql = yield* SqliteClient
        const events = yield* sql<{ entity_kind: string; entity_id: string; payload: string }>`
          SELECT entity_kind, entity_id, payload FROM domain_events
          WHERE type = 'workspace.variables_changed' ORDER BY sequence`
        return { project, workspace, events, left: yield* variables.list(project.id, null) }
      }),
    )

    expect(seen.events).toEqual([
      {
        entity_kind: 'project',
        entity_id: seen.project.id,
        payload: JSON.stringify({ key: 'TOKEN', scope: 'project' }),
      },
      {
        entity_kind: 'workspace',
        entity_id: seen.workspace.id,
        payload: JSON.stringify({ key: 'TOKEN', scope: 'workspace' }),
      },
      {
        entity_kind: 'workspace',
        entity_id: seen.workspace.id,
        payload: JSON.stringify({ key: 'TOKEN', scope: 'workspace' }),
      },
    ])
    expect(seen.events.some((event) => event.payload.includes('secret'))).toBe(false)
    // Removing the Workspace's leaves the Project's where it was.
    expect(seen.left).toEqual([{ key: 'TOKEN', value: 'secret-one', workspaceId: null }])
  })
})

describe('Setting an existing key rewrites its value', () => {
  it('rewrites the Project’s value and the Workspace’s, each in its own scope', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const variables = yield* Variables
        const workspaces = yield* Workspaces
        const { project, workspace } = yield* inAWorkspace
        const own = (yield* workspaces.list(project.id)).find((one) => one.main)
        yield* variables.set(project.id, null, 'PORT', '3000')
        yield* variables.set(project.id, workspace.id, 'PORT', '3001')
        yield* variables.set(project.id, own?.id ?? null, 'PORT', '3002')
        // The same keys again, each in its scope: an edit, not a second variable.
        const project2 = yield* variables.set(project.id, null, 'PORT', '4000')
        const workspace2 = yield* variables.set(project.id, workspace.id, 'PORT', '4001')
        const main2 = yield* variables.set(project.id, own?.id ?? null, 'PORT', '4002')
        return {
          project2,
          workspace2,
          main2,
          ofProject: yield* variables.list(project.id, null),
          ofWorkspace: yield* variables.list(project.id, workspace.id),
          ofMain: yield* variables.list(project.id, own?.id ?? null),
          given: yield* variables.givenFor(project.id, workspace.id),
        }
      }),
    )

    expect(seen.project2).toMatchObject({ key: 'PORT', value: '4000', workspaceId: null })
    expect(seen.workspace2.value).toBe('4001')
    expect(seen.main2.value).toBe('4002')
    expect(seen.ofProject.map((one) => [one.key, one.value])).toEqual([['PORT', '4000']])
    expect(seen.ofWorkspace.map((one) => [one.key, one.value])).toEqual([['PORT', '4001']])
    expect(seen.ofMain.map((one) => [one.key, one.value])).toEqual([['PORT', '4002']])
    expect(seen.given).toEqual({ PORT: '4001' })
  })
})
