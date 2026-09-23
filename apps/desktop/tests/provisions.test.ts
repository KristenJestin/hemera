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
import { z } from 'zod'

import { AGENTS_FILE, CONTEXT_BASE, DELIVERY_MARKER, contextUri } from '@hemera/core'

import { bareModeOf } from '#engine/agents/bare.ts'
import { claude } from '#engine/agents/adapters/claude.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Context as AgentContext } from '#engine/context/service.ts'
import { ToolAccess } from '#engine/tools/access.ts'
import { application, aSession, aSessionOn, threadOf } from './application.ts'
import { withQualifiedOpenCode } from './unqualified.ts'

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

/** The base a Session on `main` at that folder is given: it names its Workspace (D8-08). */
const based = (folder: string): string => `${CONTEXT_BASE}\nWorkspace: main at ${folder}`

/** An agent that answers every turn with one line, which is all these suites need of it. */
const answering = () => fakeAgent({ steps: [{ does: 'says', text: 'done' }] })

/** What Claude Code reads its system prompt from, on the `_meta` of `session/new`. */
const SYSTEM_PROMPT = z.object({
  claudeCode: z.object({
    options: z.object({
      systemPrompt: z.object({ type: z.literal('custom'), prompt: z.string() }),
    }),
  }),
})

describe('The base is provided once, by the agent’s means', () => {
  withQualifiedOpenCode()

  test('on Claude Code, through the system prompt, and never in a prompt', async () => {
    const agent = answering()

    const provided = await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const context = yield* AgentContext
        const session = yield* aSessionOn(workingDirectory, 'claude')

        yield* runtime.prompt(session.id, 'start on the reader')
        yield* runtime.prompt(session.id, 'carry on')
        return yield* context.provided(session.id)
      }),
    )

    // Handed once, with the session, as the system prompt Claude Code takes on `_meta`.
    const meta = SYSTEM_PROMPT.parse(JSON.parse(agent.answers.metas[0] ?? '{}'))
    expect(meta.claudeCode.options.systemPrompt.prompt).toBe(based(workingDirectory))
    // So the prompts are the user's own text, and nothing else.
    expect(agent.answers.prompts).toEqual(['start on the reader', 'carry on'])
    expect(agent.answers.blocks.flat().some((block) => block.type === 'resource')).toBe(false)
    // And the Context view lists it as provided, and says how it reached the agent.
    const base = provided.find((one) => one.kind === 'base')
    expect(base?.reached).toBe('system_prompt')
  })

  test('on OpenCode, as an embedded resource of the first prompt, behind the marker', async () => {
    const agent = answering()

    const provided = await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const context = yield* AgentContext
        const session = yield* aSessionOn(workingDirectory, 'opencode')

        yield* runtime.prompt(session.id, 'start on the reader')
        yield* runtime.prompt(session.id, 'carry on')
        return yield* context.provided(session.id)
      }),
    )

    // Nothing on `_meta`: this agent has no system prompt to hand it through.
    expect(agent.answers.metas).toEqual([null])
    // The first prompt: Hemera's marker, the base as a resource, then what the user asked.
    expect(agent.answers.blocks[0]).toEqual([
      { type: 'text', text: DELIVERY_MARKER },
      {
        type: 'resource',
        resource: { uri: contextUri(''), mimeType: 'text/plain', text: based(workingDirectory) },
      },
      { type: 'text', text: 'start on the reader' },
    ])
    // The second one is the user's text alone: a provision is given once per session.
    expect(agent.answers.blocks[1]).toEqual([{ type: 'text', text: 'carry on' }])
    const base = provided.find((one) => one.kind === 'base')
    expect(base?.reached).toBe('embedded_resource')
  })

  test('Codex takes it the way OpenCode does', () => {
    // Its adapter hands the base to no system prompt, even patched: it goes with the first prompt.
    expect(bareModeOf(codex, 'linux').base).toBe('embedded_resource')
    expect(bareModeOf(claude, 'linux').base).toBe('system_prompt')
  })
})

describe('A native instruction file is not injected twice', () => {
  test('AGENTS.md goes once to an agent that does not read it, and never again unchanged', async () => {
    instructions('Be brief.\n')
    const agent = answering()

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)

        yield* runtime.prompt(session.id, 'start on the reader')
        yield* runtime.prompt(session.id, 'carry on')

        // Claude Code reads no instruction file bare: the file crosses once, with the first
        // prompt, and an unchanged file is nothing to deliver after that.
        const resources = agent.answers.blocks.map((blocks) =>
          blocks.filter((block) => block.type === 'resource'),
        )
        expect(resources[0]).toHaveLength(1)
        expect(resources[1]).toHaveLength(0)
        const entries = yield* threadOf(session.id)
        expect(entries.filter((entry) => entry.kind === 'context_delivery')).toHaveLength(0)
      }),
    )
  })

  test('a CLAUDE.md of the Workspace is never sent', async () => {
    instructions('Be brief.\n')
    writeFileSync(join(workingDirectory, 'CLAUDE.md'), 'Answer in French.\n')
    const agent = answering()

    await opened(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        yield* runtime.prompt(session.id, 'start on the reader')
      }),
    )

    expect(JSON.stringify(agent.answers.blocks)).not.toContain('Answer in French.')
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

        // Nothing reached the agent while the first turn was running — its first prompt carries
        // the file as the Session started with it — and the change left at the one moment nothing
        // is in flight: before the next prompt, as a prompt of its own made of the marker and the
        // new text as a resource — then the user's prompt, untouched.
        expect(JSON.stringify(agent.answers.blocks[0])).not.toContain('say why')
        expect(agent.answers.blocks[1]).toEqual([
          { type: 'text', text: DELIVERY_MARKER },
          {
            type: 'resource',
            resource: {
              uri: contextUri(AGENTS_FILE),
              mimeType: 'text/markdown',
              text: 'Be brief, and say why.\n',
            },
          },
        ])
        expect(agent.answers.prompts[2]).toBe('carry on')

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
