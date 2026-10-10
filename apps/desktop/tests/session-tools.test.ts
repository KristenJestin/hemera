/**
 * The tools of a role session across its restarts (#154): the tester mode's two tools are handed
 * from the preference at the session's first start, then kept with its instructions until the
 * session is replaced, so a restart keeps the cached tool list in front of the
 * conversation and the tools never disagree with the instructions.
 */

import { realpathSync } from 'node:fs'

import { TESTER_PARAGRAPH, TESTER_TOOLS } from '@hemera/core/domain'
import { Effect, Option, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import { callOverMcp } from '../src/engine/agents/fake.ts'
import type { FakeScript } from '../src/engine/agents/fake.ts'
import { writePreferences } from '../src/engine/preferences.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { instructionsKept } from '../src/engine/sessions/store.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { type World, acmeIn, sessionsEngine, within } from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('session-tools'))
  work = realpathSync.native(temporaryFolder('session-tools-work'))
})
afterEach(removeFolders)

const engine = (scriptOf: (index: number) => FakeScript) => sessionsEngine(data, scriptOf)

const acme = Effect.suspend(() => acmeIn(work))

const settled = (sessionId: string) => Sessions.use((sessions) => sessions.settled(sessionId))

const opened = (owner: { readonly kind: 'mission'; readonly missionId: string }, main: string) =>
  Sessions.use((sessions) =>
    sessions.open({ owner, role: 'builder', provider: 'claude', folder: main }),
  )

const tester = (testerMode: boolean) => writePreferences({ testerMode })

const ListedTools = Schema.Struct({
  result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
})
const readListed = Schema.decodeUnknownOption(ListedTools)

const listedOver = async (server: Parameters<typeof callOverMcp>[0]) => {
  const listed = readListed(await callOverMcp(server, 'tools/list', {}))
  return Option.isSome(listed) ? listed.value.result.tools.map((tool) => tool.name) : []
}

/** The tools the nth agent was offered at its start, asked over MCP as it would. */
const toolsOfAgent = (world: World, index: number) =>
  Effect.promise(async () => {
    const server = world.agents[index]?.answers.mcpServers
      .at(-1)
      ?.find((one) => one.name === 'hemera')
    return server === undefined || !('url' in server) ? [] : await listedOver(server)
  })

/** The tools a start of the session now would offer: a token minted as a start mints it. */
const toolsAtNextStart = (sessionId: string) =>
  Effect.gen(function* () {
    const endpoint = yield* HemeraEndpoint
    const token = yield* endpoint.mint(sessionId)
    const url = yield* endpoint.url
    return yield* Effect.promise(() =>
      listedOver({ url, headers: [{ name: 'authorization', value: `Bearer ${token}` }] }),
    )
  })

const withTesterTools = (tools: ReadonlyArray<string>) =>
  TESTER_TOOLS.every((tool) => tools.includes(tool))

const withoutTesterTools = (tools: ReadonlyArray<string>) =>
  TESTER_TOOLS.every((tool) => !tools.includes(tool))

describe('A session keeps the tester tools it started with, across its restarts', () => {
  test('the mode turned on before the next start leaves the session’s tools as they were', async () => {
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const [first, second] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          const started = yield* toolsOfAgent(world, 0)
          yield* tester(true)
          return [started, yield* toolsAtNextStart(session.id)] as const
        }),
      ),
    )
    expect(withoutTesterTools(first)).toBe(true)
    expect(second).toEqual(first)
  })

  test('the mode turned off before the next start leaves the session’s tools as they were', async () => {
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const [first, second] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* tester(true)
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          const started = yield* toolsOfAgent(world, 0)
          yield* tester(false)
          return [started, yield* toolsAtNextStart(session.id)] as const
        }),
      ),
    )
    expect(withTesterTools(first)).toBe(true)
    expect(second).toEqual(first)
  })

  test('its instructions and its tools agree: the paragraph is there when the tools are', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const [nextTools, kept] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* tester(true)
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          yield* tester(false)
          return [yield* toolsAtNextStart(session.id), yield* instructionsKept(session.id)] as const
        }),
      ),
    )
    expect(kept).toContain(TESTER_PARAGRAPH)
    expect(withTesterTools(nextTools)).toBe(true)
  })

  test('a replacement follows the preference again', async () => {
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const [before, after] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          const started = yield* toolsOfAgent(world, 0)
          yield* tester(true)
          const next = yield* Sessions.use((sessions) => sessions.replace(session.id, 'a test'))
          if (next === null) return yield* Effect.die(new Error('not replaced'))
          yield* settled(next.id)
          return [started, yield* toolsOfAgent(world, 1)] as const
        }),
      ),
    )
    expect(withoutTesterTools(before)).toBe(true)
    expect(withTesterTools(after)).toBe(true)
  })
})
