/**
 * What the process that holds the database accepts, and what it refuses (design D3-02).
 *
 * Each suite is named after the scenario of `specs/profile-storage/spec.md` it covers. None of
 * this needs Electron or a port: a decision is a pure reading of a name and a schema, and what
 * follows an accepted one is a service standing on a database made for the test.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import type { EngineArguments, EngineRequestName, EngineResponse } from '@hemera/ipc'

import { AgentNotices, runtimeLayer } from '#engine/agents/runtime.ts'
import type { AgentRuntime } from '#engine/agents/runtime.ts'
import { MachineEnvironment, discoveryLayer } from '#engine/agents/discovery.ts'
import type { Discovery } from '#engine/agents/discovery.ts'
import { Agents } from '#engine/agents/service.ts'
import { fakeAgent, fakeSupervisor } from '#engine/agents/fake.ts'
import { clockLayer, poolLayer } from '#engine/agents/pool.ts'
import { StderrSink } from '#engine/agents/supervisor.ts'
import { agentDirectoriesLayer } from '#engine/agents/bare.ts'
import { heldWordsLayer } from '#engine/agents/held.ts'
import { type Proposals, proposalsLayer } from '#engine/commands/proposals.ts'
import { type Commands, commandsLayer } from '#engine/commands/service.ts'
import { type Context, contextLayer } from '#engine/context/service.ts'
import { carriedMigrations, openProfile } from '#engine/migrate.ts'
import { type Journal, journalLayer } from '#engine/journal.ts'
import { type Preferences, preferencesLayer } from '#engine/preferences.ts'
import { type Projects, projectsLayer } from '#engine/projects.ts'
import { answer, decideRequest } from '#engine/request.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { type EngineStatus, engineStatusLayer } from '#engine/status.ts'
import { DatabaseError, SqliteClient, databaseLayer } from '#engine/storage/database.ts'
import type { Database } from '#engine/storage/database.ts'
import { toolAccessLayer } from '#engine/tools/access.ts'
import { toolPermissionsLayer } from '#engine/tools/permissions.ts'
import { ToolServer } from '#engine/tools/server.ts'
import { gitLayer } from '#engine/git.ts'
import { type Preparation, hostLinks, preparationLayer } from '#engine/workspaces/preparation.ts'
import { type Recipe, recipeLayer } from '#engine/workspaces/recipe.ts'
import { type Variables, variablesLayer } from '#engine/workspaces/variables.ts'
import { type Workspaces, WorkspacesRoot, workspacesLayer } from '#engine/workspaces/workspaces.ts'

import { until } from './application.ts'
import { repository } from './repositories.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')
/**
 * The last migration this application ships, which is where a freshly opened profile stands.
 *
 * Read from the folder rather than named, because the name changes with every lot that touches
 * the schema and what is under test is that the status reports it, not which one it is.
 */
const LAST_MIGRATION = carriedMigrations(SHIPPED).at(-1)?.name

let dataFolder: string

/** Every Workspace the window was told had changed, in the order it was told (D8-05). */
let told: { projectId: string; workspaceId: string }[]

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-request-'))
  mkdirSync(dataFolder, { recursive: true })
  told = []
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

/** Runs one accepted message against a data folder of this test's own. */
function running<A, E>(
  program: Effect.Effect<
    A,
    E,
    | Preferences
    | EngineStatus
    | Projects
    | Journal
    | Sessions
    | SqliteClient
    | AgentRuntime
    | Discovery
    | Agents
    | Commands
    | Context
    | Variables
    | Workspaces
    | Preparation
    | Recipe
    | Proposals
  >,
) {
  // The agents are the fake ones here: a suite that asks for a turn is asking whether the message
  // reaches the runtime, and the runtime itself is proved by its own suite, on the fake provider.
  const agents = Layer.mergeAll(
    Layer.succeed(MachineEnvironment, {
      home: '/home/ana',
      env: {},
      locate: () => Effect.succeed('/usr/local/bin/claude'),
      bundled: () => Effect.succeed('/opt/hemera/node_modules/adapter/dist/index.js'),
      readVersion: () => Effect.succeed('1.0.0'),
      holds: () => Effect.succeed(true),
      read: () => Effect.succeed(undefined),
    }),
    fakeSupervisor(fakeAgent()),
    // Nobody watches a Session here; a Workspace that changed is kept, for the suite about it.
    Layer.succeed(AgentNotices, {
      wrote: () => undefined,
      changed: () => undefined,
      ran: () => undefined,
      workspace: (projectId, workspaceId) => {
        told.push({ projectId, workspaceId })
      },
    }),
    Layer.succeed(StderrSink, { write: () => Effect.void }),
  )
  // The tools an agent would be lent: the tokens are the engine's own, and the address is one
  // nothing listens on — what this suite asks is whether a message reaches its use case.
  const tools = Layer.mergeAll(
    toolAccessLayer,
    toolPermissionsLayer,
    contextLayer.pipe(Layer.provide(gitLayer())),
    commandsLayer,
    variablesLayer,
    Layer.succeed(ToolServer, {
      origin: 'http://127.0.0.1:1',
      forAgent: () => 'http://127.0.0.1:1/mcp',
      gaveUp: () => Effect.void,
    }),
  )
  // The rows of a Session and its thread stand on one file, and the runtime is built on the very
  // same ones: `provideMerge` hands them up rather than hiding them.
  const rows = Layer.mergeAll(projectsLayer, sessionsLayer).pipe(Layer.provide(agents))
  // Nothing here asks the three agents of the machine: their own suite is where that is proved,
  // and what this one is about is whether a message reaches the use case it names.
  const listed = Layer.succeed(Agents, {
    list: () => Effect.succeed([]),
    check: () => Effect.succeed([]),
    update: () => Effect.die('nothing in this file updates an agent'),
  })
  const lent = tools.pipe(Layer.provide(rows), Layer.provide(agents), Layer.provide(heldWordsLayer))
  const services: Layer.Layer<
    | Preferences
    | EngineStatus
    | Projects
    | Journal
    | Sessions
    | AgentRuntime
    | Discovery
    | Agents
    | Commands
    | Context
    | Variables
    | Workspaces
    | Preparation
    | Recipe
    | Proposals
    | Database
    | SqliteClient
  > = Layer.mergeAll(
    preferencesLayer,
    engineStatusLayer({ directory: dataFolder, channel: 'dev', version: '0.3.0' }),
    journalLayer,
    rows,
    listed,
    runtimeLayer.pipe(
      Layer.provideMerge(discoveryLayer),
      Layer.provide(rows),
      Layer.provide(preferencesLayer),
      // Handed up, as the engine hands them up: the settings and the Commands panel ask for the
      // very catalogue and runs the runtime lends.
      Layer.provideMerge(lent),
      Layer.provide(poolLayer.pipe(Layer.provide(clockLayer))),
      Layer.provide(agents),
      Layer.provide(heldWordsLayer),
      Layer.provide(agentDirectoriesLayer(dataFolder)),
    ),
    // What a human decides of the commands the agent proposed, on the very catalogue (D8-11).
    proposalsLayer.pipe(Layer.provide(lent), Layer.provide(rows), Layer.provide(agents)),
    // The Workspaces of the Projects, made under the data folder over the machine's `git`, and
    // prepared in the scope of these services: what a background preparation runs in.
    preparationLayer.pipe(
      Layer.provideMerge(Layer.mergeAll(workspacesLayer, recipeLayer)),
      Layer.provide(variablesLayer),
      Layer.provide(gitLayer()),
      Layer.provide(hostLinks),
      Layer.provide(Layer.succeed(WorkspacesRoot, join(dataFolder, 'workspaces'))),
      Layer.provide(agents),
    ),
  ).pipe(Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite'))))

  return Effect.runPromise(
    // The program's scope closes before the services': what it holds ends first.
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          yield* openProfile(dataFolder, SHIPPED, '0.3.0')
          return yield* program
        }),
      ),
      services,
    ),
  )
}

/** Decides a message and runs it, which is what the entry point does with one that arrives. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a message as it arrives, which is what `decideRequest` is for
function send(name: string, argument: unknown) {
  const decision = decideRequest(name, argument)
  if (!decision.accepted) throw new Error(decision.reason)
  return running(answer(decision))
}

describe('Un argument refusé par son cas d’usage', () => {
  test.each([
    ['journal.read', { projectId: 'atlas', before: -1 }, 'before'],
    ['journal.read', { projectId: 'atlas', before: 1.5 }, 'before'],
    ['journal.markSeen', { upTo: -3 }, 'upTo'],
    ['projects.create', { name: 'Atlas', tone: 'fuchsia', mainPath: '/tmp' }, 'tone'],
    ['projects.archive', { id: 'atlas' }, 'version'],
    ['repositories.add', { id: 'atlas', version: 1 }, 'relativePath'],
  ])('%s refuses %o, naming the field', (name, argument, field) => {
    const decision = decideRequest(name, argument)

    expect(decision.accepted).toBe(false)
    // The name of the use case and the field, so a refusal read in a log says what to fix.
    if (!decision.accepted) {
      expect(decision.reason).toContain(name)
      expect(decision.reason).toContain(field)
    }
  })

  test('a cursor that is a whole number is accepted', () => {
    expect(decideRequest('journal.read', { projectId: 'atlas', before: 61 }).accepted).toBe(true)
  })

  test('nothing reaches a service when the argument is refused', async () => {
    const answered = await running(
      Effect.gen(function* () {
        const decision = decideRequest('projects.create', { name: 'Atlas' })
        return decision.accepted ? yield* answer(decision) : null
      }),
    )

    expect(answered).toBeNull()
  })
})

describe('Un message conforme est traité', () => {
  test('data folder.status asked with no argument answers what the data folder stands at', async () => {
    const status = await send('engine.status', {})

    expect(status).toEqual({
      directory: dataFolder,
      channel: 'dev',
      version: '0.3.0',
      lastMigration: LAST_MIGRATION,
      writtenByVersion: '0.3.0',
      // Read off the filesystem at the moment it is asked for: a database that has just been
      // created is a file with something in it, and a profile opened once has no backups.
      databaseSize: expect.any(Number),
      backups: { count: 0, latest: null },
    })
  })

  test('preferences.write is accepted and preferences.read gives it back', async () => {
    const written = decideRequest('preferences.write', { theme: 'dark' })
    const read = decideRequest('preferences.read', {})
    expect(written.accepted).toBe(true)
    expect(read.accepted).toBe(true)

    const both = await running(
      Effect.gen(function* () {
        if (!written.accepted || !read.accepted) return null
        yield* answer(written)
        return yield* answer(read)
      }),
    )
    expect(both).toEqual({
      theme: 'dark',
      sidebar: { collapsed: false, width: null },
      activeProjectId: null,
      activeSessions: {},
      composers: {},
    })
  })
})

describe('Un message non conforme est refusé sans effet', () => {
  test('a theme outside system, light and dark is refused, naming the use case and the field', () => {
    const decision = decideRequest('preferences.write', { theme: 'sepia' })

    expect(decision.accepted).toBe(false)
    expect(decision.accepted || decision.reason).toContain('preferences.write')
    expect(decision.accepted || decision.reason).toContain('theme')
  })

  test('a refused message carries a reason and no argument, so nothing can be run on it', () => {
    const decision = decideRequest('preferences.write', { theme: 'sepia' })
    expect(decision).not.toHaveProperty('argument')
  })

  test('the database is untouched by a message that was refused', async () => {
    const before = await send('preferences.read', {})
    expect(decideRequest('preferences.write', { theme: 'sepia' }).accepted).toBe(false)
    expect(await send('preferences.read', {})).toEqual(before)
  })

  test.each([
    ['a use case that is not declared', 'preferences.reed', {}],
    ['a use case from another process', 'window.command', { command: 'minimize' }],
    ['a sidebar missing a field', 'preferences.write', { sidebar: { collapsed: true } }],
    ['a sidebar of the wrong type', 'preferences.write', { sidebar: 'wide' }],
    ['nothing at all', 'engine.status', undefined],
  ])('%s is refused', (_case, name, argument) => {
    const decision = decideRequest(name, argument)
    expect(decision.accepted).toBe(false)
    expect(decision.accepted || decision.reason).toContain(name)
  })
})

describe('Une erreur typée traverse la frontière', () => {
  test('a use case that fails answers with the name of what failed, not an anonymous throw', async () => {
    const decision = decideRequest('preferences.read', {})
    expect(decision.accepted).toBe(true)
    if (!decision.accepted) return

    // The table the use case reads is taken out from under it, which is the closest a test can
    // get to a database that answers something other than what it was asked.
    const failed = await running(
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`DROP TABLE app_preferences`
        return yield* Effect.flip(answer(decision))
      }),
    )

    expect(failed).toBeInstanceOf(DatabaseError)
    if (failed instanceof DatabaseError) expect(failed.doing).toBe('reading the preferences')
  })
})

/**
 * Decides a message and answers it, inside a program that runs several: what a background
 * preparation runs in is the scope of the services that program stands on.
 */
function asked<K extends EngineRequestName>(name: K, argument: EngineArguments<K>) {
  const decision = decideRequest(name, argument)
  if (!decision.accepted) return Effect.die(decision.reason)
  return answer(decision).pipe(
    // SAFETY: the answer of the use case `name`, which the router answers by that very name.
    Effect.map((value) => value as EngineResponse<K>),
  )
}

describe('Every Workspace channel reaches its use case', () => {
  let main: string

  beforeEach(() => {
    main = join(dataFolder, 'main')
    repository(join(main, 'sources', 'api'))
    writeFileSync(join(main, '.env'), 'PORT=3000\n')
    mkdirSync(join(main, 'docs'))
    mkdirSync(join(dataFolder, 'spike'))
  })

  test('a dedicated Workspace is planned, created, prepared, observed and cleaned up', async () => {
    const seen = await running(
      Effect.gen(function* () {
        const created = yield* asked('projects.create', {
          name: 'Atlas',
          tone: 'primary',
          mainPath: main,
        })
        const project = yield* asked('repositories.add', {
          id: created.id,
          version: created.version,
          relativePath: './sources/api',
        })
        const projectId = project.id

        // The recipe: two steps added, the second moved above the first, then taken out.
        yield* asked('recipe.add', {
          projectId,
          kind: 'copy',
          path: '.env',
          scope: 'root',
          commandId: null,
        })
        const added = yield* asked('recipe.add', {
          projectId,
          kind: 'link',
          path: 'docs',
          scope: 'root',
          commandId: null,
        })
        const moved = yield* asked('recipe.move', {
          projectId,
          id: added[1]?.id ?? '',
          direction: 'up',
        })
        yield* asked('recipe.remove', { projectId, id: moved[0]?.id ?? '' })
        const recipe = yield* asked('recipe.list', { projectId })

        const plan = yield* asked('workspaces.plan', {
          projectId,
          key: 'HEM-7',
          slug: 'login-form',
        })
        const workspace = yield* asked('workspaces.create', {
          projectId,
          specId: null,
          name: plan.name,
          repositories: plan.repositories.map((one) => ({
            relativePath: one.relativePath,
            base: one.base ?? '',
            branch: one.branch,
          })),
        })
        const begun = yield* asked('preparation.prepare', { workspaceId: workspace.id })
        // A second preparation while the first runs is still answered as a refusal.
        const twice = yield* Effect.flip(
          asked('preparation.prepare', { workspaceId: workspace.id }),
        )
        const listed = yield* until(asked('workspaces.list', { projectId }), (all) =>
          all.some((one) => one.id === workspace.id && one.state === 'ready'),
        )
        const steps = yield* asked('preparation.steps', { workspaceId: workspace.id })
        const status = yield* asked('workspaces.status', { id: workspace.id })

        yield* asked('variables.set', { projectId, workspaceId: null, key: 'PORT', value: '3000' })
        const set = yield* asked('variables.set', {
          projectId,
          workspaceId: workspace.id,
          key: 'PORT',
          value: '3001',
        })
        yield* asked('variables.remove', { projectId, workspaceId: null, key: 'PORT' })
        const variables = {
          project: yield* asked('variables.list', { projectId, workspaceId: null }),
          workspace: yield* asked('variables.list', { projectId, workspaceId: workspace.id }),
        }

        const cleaned = yield* asked('workspaces.cleanup', { id: workspace.id })
        const resumed = yield* asked('preparation.resume', { workspaceId: workspace.id })
        const picked = yield* asked('workspaces.createOnFolder', {
          projectId,
          path: join(dataFolder, 'spike'),
        })
        return {
          recipe,
          moved,
          plan,
          workspace,
          begun,
          twice,
          listed,
          steps,
          status,
          set,
          variables,
          cleaned,
          resumed,
          picked,
        }
      }),
    )

    expect(seen.moved.map((step) => step.kind)).toEqual(['link', 'copy'])
    expect(seen.recipe.map((step) => [step.kind, step.path])).toEqual([['copy', './.env']])

    expect(seen.plan).toMatchObject({ name: 'login-form', gitAvailable: true })
    expect(seen.plan.repositories).toEqual([
      expect.objectContaining({ relativePath: './sources/api', branch: 'atlas/HEM-7-login-form' }),
    ])
    expect(seen.workspace).toMatchObject({ state: 'preparing', dedicated: true, main: false })

    // Answered at once, before any step ran; the Workspace became ready afterwards.
    expect(seen.begun.map((step) => [step.kind, step.state])).toEqual([
      ['worktree', 'pending'],
      ['copy', 'pending'],
    ])
    expect(seen.twice.message).toBe('this Workspace is already being prepared')
    expect(seen.listed.map((one) => [one.name, one.main])).toEqual([
      ['main', true],
      ['login-form', false],
    ])
    expect(seen.steps.map((step) => step.state)).toEqual(['done', 'done'])
    expect(seen.status).toEqual([
      {
        relativePath: './sources/api',
        git: expect.objectContaining({ ok: true, branch: 'atlas/HEM-7-login-form' }),
      },
    ])

    expect(seen.set).toEqual({ key: 'PORT', value: '3001', workspaceId: seen.workspace.id })
    expect(seen.variables.project).toEqual([])
    expect(seen.variables.workspace).toEqual([seen.set])

    expect(seen.cleaned).toMatchObject({ state: 'cleaned' })
    expect(seen.resumed).toHaveLength(2)
    expect(seen.picked).toMatchObject({ name: 'spike', state: 'ready', dedicated: false })
  })

  test('a Project, a Session and a proposal are decided through their channels', async () => {
    const seen = await running(
      Effect.gen(function* () {
        const created = yield* asked('projects.create', {
          name: 'Atlas',
          tone: 'primary',
          mainPath: main,
        })
        const added = yield* asked('repositories.add', {
          id: created.id,
          version: created.version,
          relativePath: './sources/api',
        })
        const left = yield* asked('projects.setRepositoryIncluded', {
          id: added.id,
          version: added.version,
          path: './sources/api',
          included: false,
        })
        const rooted = yield* asked('projects.setWorkspacesRoot', {
          id: left.id,
          version: left.version,
          path: join(dataFolder, 'elsewhere'),
        })
        const project = yield* asked('projects.setBranchPrefix', {
          id: rooted.id,
          version: rooted.version,
          prefix: 'hemera',
        })

        const picked = yield* asked('workspaces.createOnFolder', {
          projectId: project.id,
          path: join(dataFolder, 'spike'),
          name: 'spike',
        })
        const sessions = yield* Sessions
        const session = yield* sessions.create(project.id, 'claude')
        const chosen = yield* asked('sessions.chooseWorkspace', {
          id: session.id,
          version: session.version,
          workspaceId: picked.id,
        })
        const services = yield* asked('commands.services', {
          projectId: project.id,
          workspaceId: picked.id,
        })

        // Two proposals as `commands_propose` writes them: one accepted, one declined (D8-11).
        for (const [proposalId, name] of [
          ['p-1', 'seed'],
          ['p-2', 'reset'],
        ] as const) {
          yield* sessions.write(session.id, {
            role: 'hemera',
            kind: 'command_proposal',
            body: name,
            payload: JSON.stringify({
              proposalId,
              name,
              line: `node ${name}.js`,
              type: 'script',
              folder: null,
              why: 'run by hand twice',
              state: 'pending',
            }),
            correlationId: `proposal:${proposalId}`,
            state: 'pending',
          })
        }
        const accepted = yield* asked('commands.proposeAccept', {
          sessionId: session.id,
          proposalId: 'p-1',
        })
        yield* asked('commands.proposeDecline', { sessionId: session.id, proposalId: 'p-2' })
        const catalogue = yield* asked('commands.list', { projectId: project.id })
        return { left, rooted, project, chosen, picked, services, accepted, catalogue }
      }),
    )

    expect(seen.left.included).toEqual([])
    expect(seen.rooted.workspacesRoot).toBe(join(dataFolder, 'elsewhere'))
    expect(seen.project).toMatchObject({ branchPrefix: 'hemera', repositories: ['./sources/api'] })
    expect(seen.chosen.workspaceId).toBe(seen.picked.id)
    expect(seen.services).toEqual([])
    expect(seen.accepted).toMatchObject({ name: 'seed', line: 'node seed.js' })
    expect(seen.catalogue.map((command) => command.name)).toEqual(['seed'])
  })

  test('the window is told when a Workspace is created, prepared and cleaned up', async () => {
    const seen = await running(
      Effect.gen(function* () {
        const created = yield* asked('projects.create', {
          name: 'Atlas',
          tone: 'primary',
          mainPath: main,
        })
        const project = yield* asked('repositories.add', {
          id: created.id,
          version: created.version,
          relativePath: './sources/api',
        })
        const plan = yield* asked('workspaces.plan', {
          projectId: project.id,
          key: 'HEM-7',
          slug: 'login-form',
        })
        const workspace = yield* asked('workspaces.create', {
          projectId: project.id,
          specId: null,
          name: plan.name,
          repositories: plan.repositories.map((one) => ({
            relativePath: one.relativePath,
            base: one.base ?? '',
            branch: one.branch,
          })),
        })
        const afterCreation = [...told]
        yield* asked('preparation.prepare', { workspaceId: workspace.id })
        yield* until(asked('preparation.steps', { workspaceId: workspace.id }), (steps) =>
          steps.every((step) => step.state === 'done'),
        )
        // The end of the preparation is told after its last step is written.
        const afterPreparation = yield* until(
          Effect.sync(() => [...told]),
          (all) => all.length >= afterCreation.length + 3,
        )
        yield* asked('workspaces.cleanup', { id: workspace.id })
        const picked = yield* asked('workspaces.createOnFolder', {
          projectId: project.id,
          path: join(dataFolder, 'spike'),
        })
        return { project, workspace, picked, afterCreation, afterPreparation, all: [...told] }
      }),
    )

    const about = (workspaceId: string) => ({ projectId: seen.project.id, workspaceId })
    expect(seen.afterCreation).toEqual([about(seen.workspace.id)])
    // The one step going to `running`, then to `done` with the Workspace `ready`, then the end.
    expect(seen.afterPreparation).toEqual(Array(4).fill(about(seen.workspace.id)))
    expect(seen.all.slice(4)).toEqual([about(seen.workspace.id), about(seen.picked.id)])
  })

  test.each([
    ['workspaces.create', { projectId: 'atlas', specId: null, name: 'login-form' }, 'repositories'],
    ['preparation.prepare', {}, 'workspaceId'],
    [
      'recipe.add',
      { projectId: 'atlas', kind: 'delete', path: null, scope: 'root', commandId: null },
      'kind',
    ],
    ['variables.set', { projectId: 'atlas', workspaceId: null, key: 'PORT' }, 'value'],
    ['projects.setBranchPrefix', { id: 'atlas', prefix: 'hemera' }, 'version'],
    ['sessions.chooseWorkspace', { id: 'session-1', version: 1 }, 'workspaceId'],
    ['commands.services', { workspaceId: null }, 'projectId'],
    ['commands.proposeAccept', { sessionId: 'session-1' }, 'proposalId'],
  ])('%s refuses %o, naming the field', (name, argument, field) => {
    const decision = decideRequest(name, argument)

    expect(decision.accepted).toBe(false)
    if (!decision.accepted) {
      expect(decision.reason).toContain(name)
      expect(decision.reason).toContain(field)
    }
  })
})
