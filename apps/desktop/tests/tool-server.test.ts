/**
 * The address an agent asks Hemera's tools on, and what a token buys (D6-01, D6-02, D6-05).
 *
 * The server is driven over the loopback interface with real requests, because the two promises
 * of this lot are about the wire: the port is not published, and a call without a token this
 * engine minted is answered without learning anything. What the suite mints here is the token
 * the engine would have handed an agent at `session/new`, and what it talks to is a listener on
 * a port the system picked.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Deferred, Effect, Layer } from 'effect'
import type { Scope } from 'effect'

import { type ToolName } from '@hemera/core'

import {
  StderrSink,
  hostProcessesLayer,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'
import { heldWordsLayer } from '#engine/agents/held.ts'
import { NoNotices } from '#engine/agents/notices.ts'
import { commandsLayer, type Commands } from '#engine/commands/service.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { NoSpecNotices } from '#engine/specs/notices.ts'
import { specsLayer } from '#engine/specs/specs.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import { classifierSettingsLayer } from '#engine/classifier/settings.ts'
import type { Database, SqliteClient } from '#engine/storage/database.ts'
import { type GrantedAccess, ToolAccess, toolAccessLayer } from '#engine/tools/access.ts'
import { toolCatalogueLayer, type ToolCatalogue } from '#engine/tools/catalogue.ts'
import { ToolPermissions, type ToolPermissionsService } from '#engine/tools/permissions.ts'
import { ToolServer, toolServerLayer } from '#engine/tools/server.ts'
import { variablesLayer } from '#engine/workspaces/variables.ts'

import { idleBuilds } from './build-harness.ts'

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
const noQuestions: ToolPermissionsService = {
  askOutside: () => Effect.succeed<'refused'>('refused'),
  answer: () => Effect.succeed(false),
  withdrawn: () => Effect.void,
}

/**
 * A human who is asked, and answers when the suite says so: what keeps a call waiting on the
 * question while another call of the same Session is answered.
 */
function humanHolding() {
  const decision = Deferred.makeUnsafe<'allowed' | 'refused'>()
  let asked: () => void = () => undefined
  const questioned = new Promise<void>((resolve) => {
    asked = resolve
  })
  const service: ToolPermissionsService = {
    askOutside: () =>
      Effect.gen(function* () {
        asked()
        return yield* Deferred.await(decision)
      }),
    answer: () => Effect.succeed(false),
    withdrawn: () => Effect.void,
  }
  return {
    service,
    asked: questioned,
    answer: (answer: 'allowed' | 'refused') => {
      Deferred.doneUnsafe(decision, Effect.succeed(answer))
    },
  }
}

/** A file inside the root, written by the suite rather than by a tool. */
function fileInRoot(name: string, content: string) {
  writeFileSync(join(root, name), content)
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
/**
 * The access of this engine, with every grant offering only `offered`: what a mission that lends
 * fewer tools than `free` will look like to the server.
 */
const offering = (offered: readonly ToolName[]) =>
  Layer.effect(
    ToolAccess,
    Effect.gen(function* () {
      const real = yield* ToolAccess
      const narrowed = <G extends { readonly offered: readonly ToolName[] }>(grant: G | null) =>
        grant === null ? null : { ...grant, offered }
      return {
        ...real,
        byToken: (token: string | null) => real.byToken(token).pipe(Effect.map(narrowed)),
        byId: (id: string) => real.byId(id).pipe(Effect.map(narrowed)),
      }
    }),
  ).pipe(Layer.provideMerge(toolAccessLayer))

function engine(
  permissions: ToolPermissionsService = noQuestions,
  written: string[] = [],
  offered: readonly ToolName[] | null = null,
) {
  const sink = Layer.succeed(StderrSink, {
    write: (line: string) =>
      Effect.sync(() => {
        written.push(line)
      }),
  })
  const processes = processSupervisorLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(hostProcessesLayer, sink)),
  )
  const services: Layer.Layer<Engine> = toolServerLayer.pipe(
    Layer.provideMerge(toolCatalogueLayer),
    Layer.provideMerge(classifierSettingsLayer),
    // No build runs here: a Session that is none passes through the builds untouched.
    Layer.provide(idleBuilds),
    Layer.provideMerge(offered === null ? toolAccessLayer : offering(offered)),
    Layer.provideMerge(Layer.succeed(ToolPermissions, permissions)),
    Layer.provideMerge(commandsLayer),
    Layer.provide(variablesLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        projectsLayer,
        sessionsLayer,
        specsLayer.pipe(Layer.provide(NoSpecNotices)),
      ).pipe(Layer.provideMerge(databaseLayer(join(folder, 'hemera.sqlite')))),
    ),
    Layer.provide(Layer.mergeAll(processes, sink)),
    Layer.provide(heldWordsLayer),
    // Nobody is watching: these suites read the thread and the runs, not what was pushed.
    Layer.provide(NoNotices),
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
const listed = (server: { readonly forAgent: (granted: GrantedAccess) => string }) =>
  Effect.gen(function* () {
    const granted = yield* aSessionWithAToken
    const response = yield* Effect.promise(() =>
      fetch(server.forAgent(granted.granted), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${granted.granted.token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    )
    const body = yield* Effect.promise(() => response.text())
    return { status: response.status, body }
  })

/** One `tools/call`, sent the way an agent sends it: the address, and the token as a bearer. */
const toolCall = (
  server: { readonly origin: string },
  token: string,
  id: number,
  name: string,
  sent: Record<string, string>,
  meta: Record<string, string> | null = null,
) =>
  Effect.promise(async () => {
    const response = await fetch(`${server.origin}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: meta === null ? { name, arguments: sent } : { name, arguments: sent, _meta: meta },
      }),
    })
    return { status: response.status, body: await response.text() }
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
          fetch(server.forAgent(held.granted), {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              authorization: `Bearer ${held.granted.token}`,
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
    expect(seen.body).toContain('fs_read')
  })
})

describe('A call the server turns away before any tool is recorded like any call', () => {
  it('an unknown tool and arguments that do not read are refused entries with their reason', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const sessions = yield* Sessions
        const held = yield* aSessionWithAToken
        const token = held.granted.token
        const unknown = yield* toolCall(server, token, 1, 'shell_run', { line: 'rm -rf /' })
        const invalid = yield* toolCall(server, token, 2, 'fs_read', { offset: 'far' })
        const page = yield* sessions.read(held.session.id)
        return { unknown, invalid, entries: page.entries }
      }),
    )

    // The agent is answered by the server as before; Hemera has written the refusals down.
    expect(seen.unknown.status).toBe(200)
    expect(seen.invalid.status).toBe(200)
    const calls = seen.entries.filter((entry) => entry.kind === 'hemera_tool_call')
    expect(calls.map((entry) => entry.state)).toEqual(['refused', 'refused'])
    expect(calls[0]?.body).toBe('Hemera has no tool named shell_run')
    expect(calls[1]?.body).toContain('the arguments of fs_read do not read')
  })
})

describe("A call carries the agent's own identifier of it", () => {
  it("is written into Hemera's entry, which is what the thread pairs the agent's report with", async () => {
    fileInRoot('inside.md', 'inside the root\n')
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const sessions = yield* Sessions
        const held = yield* aSessionWithAToken
        yield* toolCall(
          server,
          held.granted.token,
          1,
          'fs_read',
          { path: 'inside.md' },
          {
            'claudecode/toolUseId': 'toolu_01',
          },
        )
        const page = yield* sessions.read(held.session.id)
        return page.entries
      }),
    )

    const call = seen.find((entry) => entry.kind === 'hemera_tool_call')
    expect(JSON.parse(call?.payload ?? '{}')).toMatchObject({ callId: 'toolu_01' })
  })

  it("reads the id Hemera's patch of Codex's adapter sends, which its report carries too", async () => {
    fileInRoot('inside.md', 'inside the root\n')
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const sessions = yield* Sessions
        const held = yield* aSessionWithAToken
        yield* toolCall(
          server,
          held.granted.token,
          1,
          'fs_read',
          { path: 'inside.md' },
          { 'hemera/callId': 'exec-2c9eedea' },
        )
        const page = yield* sessions.read(held.session.id)
        return page.entries
      }),
    )

    const call = seen.find((entry) => entry.kind === 'hemera_tool_call')
    expect(JSON.parse(call?.payload ?? '{}')).toMatchObject({ callId: 'exec-2c9eedea' })
  })
})

describe('An agent that stops waiting for a call', () => {
  it('withdraws the question it was waiting on, and the call is written down as failed', async () => {
    const human = humanHolding()
    const seen = await engine(human.service)(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const sessions = yield* Sessions
        const held = yield* aSessionWithAToken
        const abort = new AbortController()
        const request = fetch(`${server.origin}/mcp`, {
          method: 'POST',
          signal: abort.signal,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${held.granted.token}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'fs_read', arguments: { path: join(folder, 'elsewhere.md') } },
          }),
        }).catch(() => null)
        yield* Effect.promise(() => human.asked)
        // The agent's own timeout: it closes the request while the human has not answered.
        abort.abort()
        yield* Effect.promise(() => request)
        const settled = (entries: readonly { kind: string; state: string | null }[]) =>
          entries.some((entry) => entry.kind === 'hemera_tool_call')
        let entries = (yield* sessions.read(held.session.id)).entries
        for (let tries = 0; tries < 200 && !settled(entries); tries += 1) {
          yield* Effect.sleep('25 millis')
          entries = (yield* sessions.read(held.session.id)).entries
        }
        return entries
      }),
    )

    const question = seen.find((entry) => entry.kind === 'permission_request')
    expect(question?.state).toBe('cancelled')
    const decision = seen.find((entry) => entry.kind === 'permission_decision')
    expect(decision?.body).toContain('Withdrawn')
    expect(seen.find((entry) => entry.kind === 'hemera_tool_call')?.state).toBe('failed')
  })
})

describe('The server lists only the tools the Session was offered', () => {
  it('shows what was offered, and a call to another tool is refused and recorded', async () => {
    const seen = await engine(
      noQuestions,
      [],
      ['fs_read'],
    )(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const sessions = yield* Sessions
        const held = yield* aSessionWithAToken
        const token = held.granted.token
        const list = yield* Effect.promise(async () => {
          const response = await fetch(`${server.origin}/mcp`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
          })
          return await response.text()
        })
        yield* toolCall(server, token, 2, 'fs_write', { path: 'x.md', content: 'no', key: 'k' })
        const page = yield* sessions.read(held.session.id)
        return { list, entries: page.entries }
      }),
    )

    expect(seen.list).toContain('"fs_read"')
    expect(seen.list).not.toContain('"fs_write"')
    const call = seen.entries.find((entry) => entry.kind === 'hemera_tool_call')
    expect(call?.state).toBe('refused')
    expect(call?.body).toBe('the tool fs_write is not offered to this Session')
  })
})

describe('two calls of one Session at the same time', () => {
  it('are each answered on their own request, one of them waiting on the human', async () => {
    fileInRoot('inside.md', 'inside the root\n')
    const human = humanHolding()
    const seen = await engine(human.service)(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const held = yield* aSessionWithAToken
        const token = held.granted.token
        // The first call leaves the root and waits on the human; the second is answered while
        // the first is still waiting, on the request that asked it and on no other.
        const outside = Effect.runPromise(
          toolCall(server, token, 1, 'fs_read', { path: join(folder, 'elsewhere.md') }),
        )
        yield* Effect.promise(() => human.asked)
        const inside = yield* toolCall(server, token, 2, 'fs_read', { path: 'inside.md' })
        human.answer('refused')
        return { inside, outside: yield* Effect.promise(() => outside) }
      }),
    )

    expect(seen.inside.status).toBe(200)
    expect(seen.inside.body).toContain('"id":2')
    expect(seen.inside.body).toContain('inside the root')
    expect(seen.outside.status).toBe(200)
    expect(seen.outside.body).toContain('"id":1')
    expect(seen.outside.body).toContain('the user refused')
  })
})

/** A `tools/list` sent to an address, with no header: the token, if any, is the address's own. */
const listedAt = (address: string) =>
  Effect.promise(async () => {
    const response = await fetch(address, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    return { status: response.status, body: await response.text() }
  })

describe('the token of a Session', () => {
  it('is handed to the agent as a bearer header, and the address carries no secret', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const held = yield* aSessionWithAToken
        return { address: server.forAgent(held.granted), origin: server.origin }
      }),
    )

    expect(seen.address).toBe(`${seen.origin}/mcp`)
  })

  it('is refused in the address of an agent that was not minted to carry it there', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const held = yield* aSessionWithAToken
        return yield* listedAt(`${server.origin}/mcp?t=${held.granted.token}`)
      }),
    )

    expect(seen.status).toBe(401)
    expect(seen.body).toBe('{"error":"unauthorized"}')
  })

  it('is read from the address only for a grant minted to carry it there', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const access = yield* ToolAccess
        const held = yield* aSessionWithAToken
        const inQuery = yield* access.granted(held.session.id, 'agent-2', 'free', true)
        const address = server.forAgent(inQuery)
        return { address, answer: yield* listedAt(address) }
      }),
    )

    expect(seen.address).toContain('/mcp?t=')
    expect(seen.answer.status).toBe(200)
    expect(seen.answer.body).toContain('fs_read')
  })
})

describe('a request from a web page', () => {
  it('is refused by its origin before its token is read', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const held = yield* aSessionWithAToken
        const response = yield* Effect.promise(() =>
          fetch(`${server.origin}/mcp`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              authorization: `Bearer ${held.granted.token}`,
              origin: 'https://elsewhere.example',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
          }),
        )
        return { status: response.status }
      }),
    )

    expect(seen.status).toBe(403)
  })
})

describe('A request larger than any call', () => {
  it('is refused by its size before its token is read', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const server = yield* ToolServer
        return yield* Effect.promise(async () => {
          const response = await fetch(`${server.origin}/mcp`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: 'x'.repeat(17 * 1024 * 1024),
          }).catch(() => null)
          return response?.status ?? null
        })
      }),
    )

    // Refused, or cut off before the answer: either way it was never read whole.
    expect(seen === 413 || seen === null).toBe(true)
  })
})

describe('the diagnostics of many refused accesses', () => {
  it('are a few lines and a count, and a name cannot forge a line of its own', async () => {
    const written: string[] = []
    await engine(
      noQuestions,
      written,
    )(
      Effect.gen(function* () {
        const server = yield* ToolServer
        yield* Effect.forEach(
          Array.from({ length: 30 }, (_, index) => index),
          (index) => toolCall(server, 'f'.repeat(43), index, 'fs_read\nforged line', {}),
        )
      }),
    )

    const refusals = written.filter((line) => line.includes('refused'))
    expect(refusals.length).toBeLessThanOrEqual(20)
    for (const line of written) expect(line).not.toContain('\n')
  })
})

describe('the diagnostics of a refused access', () => {
  it('name the Session and the tool, and never the token', async () => {
    const written: string[] = []
    const seen = await engine(
      noQuestions,
      written,
    )(
      Effect.gen(function* () {
        const server = yield* ToolServer
        const access = yield* ToolAccess
        const held = yield* aSessionWithAToken
        yield* access.revoked(held.session.id)
        const refused = yield* toolCall(server, held.granted.token, 1, 'fs_read', {
          path: 'notes.md',
        })
        const foreign = yield* toolCall(server, 'f'.repeat(43), 2, 'fs_write', { path: 'x' })
        return { refused, foreign, sessionId: held.session.id, token: held.granted.token }
      }),
    )

    expect(seen.refused.status).toBe(401)
    expect(seen.foreign.status).toBe(401)
    const granted = written.find((line) => line.includes('granted'))
    expect(granted).toContain(seen.sessionId)
    const refusals = written.filter((line) => line.includes('refused'))
    expect(refusals).toHaveLength(2)
    expect(refusals[0]).toContain(seen.sessionId)
    expect(refusals[0]).toContain('fs_read')
    expect(refusals[1]).toContain('fs_write')
    expect(refusals[1]).toContain('no Session this engine knows')
    for (const line of written) {
      expect(line).not.toContain(seen.token)
      expect(line).not.toContain('f'.repeat(43))
    }
  })
})
