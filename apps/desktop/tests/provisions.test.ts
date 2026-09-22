/**
 * What a Session's agent is lent and what it is provided with (design D6-01, D6-07, D6-08).
 *
 * Each suite is named after the scenario of the issue's Spec section it covers, and every one of
 * them runs a real turn: the fake provider behind the supervisor's port, a Workspace on a real
 * folder, and the thread the engine writes. What is read is what the agent was actually sent —
 * `answers.prompts` is the text of every prompt as it arrived, and `answers.mcpServers` is what
 * `session/new` was configured with — because all of D6-07 is about what reaches an agent and
 * what deliberately does not.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'

import { AGENTS_FILE, CONTEXT_BASE, DELIVERY_MARKER } from '@hemera/core'

import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { ToolAccess } from '#engine/tools/access.ts'
import { application, aSession, threadOf } from './application.ts'

let dataFolder: string
let workingDirectory: string
let opened: ReturnType<typeof application>

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-provisions-'))
  workingDirectory = mkdtempSync(join(tmpdir(), 'hemera-workspace-'))
  opened = application(dataFolder)
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workingDirectory, { recursive: true, force: true })
})

/** The instructions of the Workspace, as the user writes them. */
const instructions = (text: string): void => {
  writeFileSync(join(workingDirectory, AGENTS_FILE), text)
}

/** An agent that answers every turn with one line, which is all these suites need of it. */
const answering = () => fakeAgent({ steps: [{ does: 'says', text: 'done' }] })

describe('The base is provided once, by the agent’s means', () => {
  test('it rides on the first prompt of the Session and on no other', async () => {
    const agent = answering()

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)

        yield* runtime.prompt(session.id, 'start on the reader')
        yield* runtime.prompt(session.id, 'carry on')

        // The base is in front of what the user asked, word for word, and the second turn is the
        // user's own text and nothing else: a provision is given once per session.
        expect(agent.answers.prompts[0]?.startsWith(CONTEXT_BASE)).toBe(true)
        expect(agent.answers.prompts[0]).toContain('start on the reader')
        expect(agent.answers.prompts[1]).toBe('carry on')
      }),
    )
  })
})

describe('A new Session starts from the current instructions', () => {
  test('AGENTS.md is read by the agent itself and never sent', async () => {
    instructions('Be brief.\n')
    const agent = answering()

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)

        yield* runtime.prompt(session.id, 'start on the reader')

        // The file was there when the Session started, so it is what the agent read itself:
        // nothing of it crosses, and nothing was delivered.
        expect(agent.answers.prompts[0]).not.toContain('Be brief.')
        expect(agent.answers.prompts[0]).not.toContain(DELIVERY_MARKER)
        const entries = yield* threadOf(session.id)
        expect(entries.filter((entry) => entry.kind === 'context_delivery')).toHaveLength(0)
      }),
    )
  })
})

describe('A change during a turn leaves at the next safe point', () => {
  test('the next prompt carries it, and the thread says it was handed over', async () => {
    instructions('Be brief.\n')
    const agent = answering()

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)

        yield* runtime.prompt(session.id, 'start on the reader')
        instructions('Be brief, and say why.\n')
        yield* runtime.prompt(session.id, 'carry on')

        // Nothing reached the agent while the first turn was running, and the change left at the
        // one moment nothing is in flight: in front of the next prompt, as its own text.
        expect(agent.answers.prompts[0]).not.toContain(DELIVERY_MARKER)
        expect(agent.answers.prompts[1]).toContain(DELIVERY_MARKER)
        expect(agent.answers.prompts[1]).toContain('Be brief, and say why.')
        expect(agent.answers.prompts[1]).toContain('carry on')

        const delivered = (yield* threadOf(session.id)).filter(
          (entry) => entry.kind === 'context_delivery',
        )
        expect(delivered).toHaveLength(1)
        expect(delivered[0]?.role).toBe('hemera')
        expect(delivered[0]?.body).toContain('changed')
      }),
    )
  })
})

describe('The tools are lent to the agent’s own process', () => {
  test('session/new carries the loopback address and the token of the Session', async () => {
    const agent = answering()

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)

        yield* runtime.start(session.id)

        // One server, the address of this engine's own tools, and the token as a bearer header
        // and nowhere else: not in the address, which is what a log keeps (D6-01).
        expect(agent.answers.mcpServers[0]).toEqual([
          {
            type: 'http',
            name: 'hemera',
            url: expect.stringMatching(/\/mcp$/),
            headers: [{ name: 'Authorization', value: expect.stringMatching(/^Bearer .+/) }],
          },
        ])
      }),
    )
  })
})

describe('A token is revoked when the agent is let go', () => {
  test('a Session that let its agent go has nothing left that may ask', async () => {
    const agent = answering()

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const access = yield* ToolAccess
        const session = yield* aSession(workingDirectory)

        yield* runtime.prompt(session.id, 'start on the reader')
        expect(yield* access.live(session.id)).toBe(true)

        yield* runtime.release(session.id)
        // The grant went with the process it was handed to: a call arriving after this is a call
        // with a token this engine no longer knows anything about (D6-01).
        expect(yield* access.live(session.id)).toBe(false)
      }),
    )
  })
})
