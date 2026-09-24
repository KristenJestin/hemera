/**
 * What the process that holds the database accepts, and what it refuses (design D3-02).
 *
 * Each suite is named after the scenario of `specs/profile-storage/spec.md` it covers. None of
 * this needs Electron or a port: a decision is a pure reading of a name and a schema, and what
 * follows an accepted one is a service standing on a database made for the test.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { DELIVERY_MARKER, contextUri } from '@hemera/core'

import { AgentRuntime, NoNotices, runtimeLayer } from '#engine/agents/runtime.ts'
import { MachineEnvironment, discoveryLayer } from '#engine/agents/discovery.ts'
import type { Discovery } from '#engine/agents/discovery.ts'
import { Agents } from '#engine/agents/service.ts'
import { type FakeAgent, fakeAgent, fakeSupervisor } from '#engine/agents/fake.ts'
import { clockLayer, poolLayer } from '#engine/agents/pool.ts'
import { StderrSink } from '#engine/agents/supervisor.ts'
import { agentDirectoriesLayer } from '#engine/agents/bare.ts'
import { heldWordsLayer } from '#engine/agents/held.ts'
import { type Commands, commandsLayer } from '#engine/commands/service.ts'
import { type Context, contextLayer } from '#engine/context/service.ts'
import { carriedMigrations, openProfile } from '#engine/migrate.ts'
import { type Journal, journalLayer } from '#engine/journal.ts'
import { type Preferences, preferencesLayer } from '#engine/preferences.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { answer, decideRequest } from '#engine/request.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { NoSpecNotices } from '#engine/specs/notices.ts'
import { Specs, specsLayer } from '#engine/specs/specs.ts'
import { type EngineStatus, engineStatusLayer } from '#engine/status.ts'
import { DatabaseError, SqliteClient, databaseLayer } from '#engine/storage/database.ts'
import type { Database } from '#engine/storage/database.ts'
import { toolAccessLayer } from '#engine/tools/access.ts'
import { toolPermissionsLayer } from '#engine/tools/permissions.ts'
import { ToolServer } from '#engine/tools/server.ts'
import { threadOf, until } from './application.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')
/**
 * The last migration this application ships, which is where a freshly opened profile stands.
 *
 * Read from the folder rather than named, because the name changes with every lot that touches
 * the schema and what is under test is that the status reports it, not which one it is.
 */
const LAST_MIGRATION = carriedMigrations(SHIPPED).at(-1)?.name

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-request-'))
  mkdirSync(dataFolder, { recursive: true })
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
    | Specs
    | SqliteClient
    | AgentRuntime
    | Discovery
    | Agents
    | Commands
    | Context
  >,
  agent: FakeAgent = fakeAgent(),
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
    fakeSupervisor(agent),
    NoNotices,
    Layer.succeed(StderrSink, { write: () => Effect.void }),
  )
  // The tools an agent would be lent: the tokens are the engine's own, and the address is one
  // nothing listens on — what this suite asks is whether a message reaches its use case.
  const tools = Layer.mergeAll(
    toolAccessLayer,
    toolPermissionsLayer,
    contextLayer,
    commandsLayer,
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
  const services: Layer.Layer<
    | Preferences
    | EngineStatus
    | Projects
    | Journal
    | Sessions
    | Specs
    | AgentRuntime
    | Discovery
    | Agents
    | Commands
    | Context
    | Database
    | SqliteClient
  > = Layer.mergeAll(
    preferencesLayer,
    engineStatusLayer({ directory: dataFolder, channel: 'dev', version: '0.3.0' }),
    journalLayer,
    rows,
    specsLayer.pipe(Layer.provide(NoSpecNotices)),
    listed,
    runtimeLayer.pipe(
      Layer.provideMerge(discoveryLayer),
      Layer.provide(rows),
      Layer.provide(preferencesLayer),
      // Handed up, as the engine hands them up: the settings and the Commands panel ask for the
      // very catalogue and runs the runtime lends.
      Layer.provideMerge(tools.pipe(Layer.provide(rows), Layer.provide(agents))),
      Layer.provide(poolLayer.pipe(Layer.provide(clockLayer))),
      Layer.provide(agents),
      Layer.provide(heldWordsLayer),
      Layer.provide(agentDirectoriesLayer(dataFolder)),
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
 * A `define` Session whose agent took its first turn, the brief with it, on a Workspace of its
 * own, and a question its agent asked: what a human change of its Spec is handed to.
 */
const defined = (workspace: string) =>
  running(
    Effect.gen(function* () {
      const project = yield* (yield* Projects).create({
        name: 'Atlas',
        tone: 'primary',
        mainPath: workspace,
      })
      const free = yield* (yield* Sessions).create(project.id, 'claude')
      const specs = yield* Specs
      const { snapshot } = yield* specs.create({
        sessionId: free.id,
        type: 'feature',
        title: 'Export the journal',
      })
      const specId = snapshot.spec.id
      yield* (yield* AgentRuntime).prompt(free.id, 'First turn.')
      const raised = yield* specs.raiseQuestion(
        { kind: 'agent', sessionId: free.id },
        { specId, body: 'Which format?', blocking: true, phase: 'shape', options: [] },
      )
      const scope = raised.sections.find((section) => section.name === 'scope')
      return {
        sessionId: free.id,
        specId,
        questionId: raised.questions[0]?.id ?? '',
        scopeVersion: scope?.version ?? 0,
      }
    }),
  )

/**
 * Runs a message the window sends, as the entry point does, to a Session whose agent was started
 * again and runs no turn: what reaches the agent then is what the message handed it, and not what
 * the end of a turn would have.
 */
const sentWhileIdle = (
  sessionId: string,
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a message as it arrives, which is what `decideRequest` is for
  argument: unknown,
  agent: FakeAgent,
) =>
  running(
    Effect.gen(function* () {
      yield* (yield* AgentRuntime).start(sessionId)
      const decision = decideRequest(name, argument)
      if (!decision.accepted) return yield* Effect.die(decision.reason)
      yield* answer(decision)
      // The thread once a turn Hemera opened to hand something over has ended in it (D6-08).
      return yield* until(threadOf(sessionId), (thread) =>
        thread.some(
          (entry) => entry.kind === 'turn' && entry.payload.includes('"kind":"delivery"'),
        ),
      )
    }),
    agent,
  )

/** The text of the resource a prompt carried at an address, if it carried one. */
const handedAt = (agent: FakeAgent, prompt: number, uri: string) => {
  const block = agent.answers.blocks[prompt]?.find(
    (one) => one.type === 'resource' && one.resource.uri === uri,
  )
  return block?.type === 'resource' && 'text' in block.resource ? block.resource.text : null
}

describe('An answer resolves the question and reaches the agent at the next safe point', () => {
  test('answered from the window while no turn runs, it is handed to the agent at once, in a turn of its own', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'hemera-request-workspace-'))
    const { sessionId, specId, questionId } = await defined(workspace)
    const agent = fakeAgent()

    const thread = await sentWhileIdle(
      sessionId,
      'specs.answerQuestion',
      { specId, questionId, text: 'CSV' },
      agent,
    )
    rmSync(workspace, { recursive: true, force: true })

    expect(agent.answers.prompts).toEqual([DELIVERY_MARKER])
    expect(handedAt(agent, 0, contextUri('answer'))).toBe(
      '# Answers since your last turn\n\n- Which format?\n  The user answered: CSV',
    )
    const line = thread.find((entry) => entry.kind === 'context_delivery')
    expect(line).toMatchObject({ role: 'hemera', turnId: expect.any(String) })
  })
})

describe('A human edit is recorded and reaches the agent', () => {
  test('saved from the panel while no turn runs, it is handed to the agent at once, never as a message', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'hemera-request-workspace-'))
    const { sessionId, specId, scopeVersion } = await defined(workspace)
    const agent = fakeAgent()

    const thread = await sentWhileIdle(
      sessionId,
      'specs.writeSection',
      { specId, sessionId, name: 'scope', body: 'CSV only.', baseVersion: scopeVersion },
      agent,
    )
    rmSync(workspace, { recursive: true, force: true })

    expect(agent.answers.prompts).toEqual([DELIVERY_MARKER])
    expect(handedAt(agent, 0, contextUri('edit'))).toContain('CSV only.')
    expect(thread.filter((entry) => entry.role === 'user').map((entry) => entry.body)).toEqual([
      'First turn.',
    ])
  })
})
