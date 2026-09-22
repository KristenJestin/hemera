/**
 * The address an agent asks Hemera's tools on, and what a token buys (D6-01, D6-02, D6-05).
 *
 * The server is driven over the loopback interface with real requests, because the two promises
 * of this lot are about the wire: the port is not published, and a call without a token this
 * engine minted is answered without learning anything. What the suite mints here is the token
 * the engine would have handed an agent at `session/new`, and what it talks to is a listener on
 * a port the system picked.
 */

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'

import {
  StderrSink,
  hostProcessesLayer,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'
import { commandsLayer, type Commands } from '#engine/commands/service.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import type { Database, SqliteClient } from '#engine/storage/database.ts'
import { ToolAccess, toolAccessLayer } from '#engine/tools/access.ts'
import { toolCatalogueLayer, type ToolCatalogue } from '#engine/tools/catalogue.ts'
import { ToolPermissions } from '#engine/tools/permissions.ts'
import { ToolServer, toolServerLayer } from '#engine/tools/server.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')
const VERSION = '0.4.0'

let folder: string
let root: string

beforeEach(() => {
  folder = join(tmpdir(), `hemera-server-${String(Date.now())}-${String(Math.random())}`)
  root = join(folder, 'workspace')
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** A human who is never asked anything: nothing here leaves the root. */
const noQuestions = {
  askOutside: () => Effect.succeed<'refused'>('refused'),
  answer: () => Effect.succeed(false),
}

type Engine =
  | Projects
  | Sessions
  | Commands
  | ToolCatalogue
  | ToolAccess
  | ToolServer
  | ToolPermissions
  | Database
  | SqliteClient

/** The engine with its tools served, over one database in the suite's folder. */
function engine() {
  const sink = Layer.succeed(StderrSink, { write: () => Effect.void })
  const processes = processSupervisorLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(hostProcessesLayer, sink)),
  )
  const services: Layer.Layer<Engine> = toolServerLayer.pipe(
    Layer.provideMerge(toolCatalogueLayer),
    Layer.provideMerge(toolAccessLayer),
    Layer.provideMerge(Layer.succeed(ToolPermissions, noQuestions)),
    Layer.provideMerge(commandsLayer),
    Layer.provideMerge(
      Layer.mergeAll(projectsLayer, sessionsLayer).pipe(
        Layer.provideMerge(databaseLayer(join(folder, 'hemera.sqlite'))),
      ),
    ),
    Layer.provide(Layer.mergeAll(processes, sink)),
  )
  return <A, E>(program: Effect.Effect<A, E, Engine | Scope.Scope>): Promise<A> =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(folder, SHIPPED, VERSION)
            return yield* program
          }),
          services,
        ),
      ),
    )
}

/** One Session of a Project on the suite's folder, and the token its agent was handed. */
const aSessionWithAToken = Effect.gen(function* () {
  const projects = yield* Projects
  const sessions = yield* Sessions
  const access = yield* ToolAccess
  const project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: root })
  const session = yield* sessions.create(project.id, 'claude')
  const granted = yield* access.granted(session.id, 'agent-1', 'free')
  return { session, granted }
})

/** What one `tools/list` asked of an address answered. */
const listed = (server: { readonly forAgent: (token: string) => string }) =>
  Effect.gen(function* () {
    const granted = yield* aSessionWithAToken
    const response = yield* Effect.promise(() =>
      fetch(server.forAgent(granted.granted.token), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    )
    const body = yield* Effect.promise(() => response.text())
    return { status: response.status, body }
  })

describe('an address without a token', () => {
  it('is answered with a refusal that names nothing', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const response = yield* Effect.promise(() =>
          fetch(`${server.origin}/mcp`, { method: 'POST' }),
        )
        const body = yield* Effect.promise(() => response.text())
        return { status: response.status, body }
      }),
    )

    expect(seen.status).toBe(401)
    expect(seen.body).toBe('{"error":"unauthorized"}')
  })
})

describe('a token this engine never minted', () => {
  it('is answered exactly like an address without one, and says nothing about the Sessions', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const response = yield* Effect.promise(() =>
          fetch(`${server.origin}/mcp?t=${'a'.repeat(43)}`, { method: 'POST' }),
        )
        const body = yield* Effect.promise(() => response.text())
        return { status: response.status, body }
      }),
    )

    expect(seen.status).toBe(401)
    expect(seen.body).toBe('{"error":"unauthorized"}')
  })
})

describe('a token of a revoked grant', () => {
  it('stops being accepted the moment the Session releases it', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const access = yield* ToolAccess
        const held = yield* aSessionWithAToken
        yield* access.revoked(held.session.id)
        const response = yield* Effect.promise(() =>
          fetch(server.forAgent(held.granted.token), {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
          }),
        )
        return { status: response.status }
      }),
    )

    expect(seen.status).toBe(401)
  })
})

describe('the tools of the Session', () => {
  it('are served to the token its agent was handed', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        return yield* listed(server)
      }),
    )

    expect(seen.status).not.toBe(401)
    expect(seen.body).toContain('fs.read')
  })
})
