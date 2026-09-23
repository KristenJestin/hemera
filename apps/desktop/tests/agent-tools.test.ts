/**
 * The tools of Hemera as an agent reaches them: over MCP, with the token it was handed (D6-11).
 *
 * Every suite here runs the engine whole — the runtime, the tool server on a loopback port, the
 * catalogue behind it, the commands on the real supervisor — with the fake provider as the agent.
 * The agent is handed the server at `session/new` like any agent, connects to it, lists what it
 * lists and calls a tool by name; what is read is what the user and the agent each read: the
 * thread, the Commands panel, the Journal, and the answer the agent was given.
 *
 * Each suite is named after the scenario of the issue's Spec section it plays.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'
import { z } from 'zod'

import { TOOL_NAMES } from '@hemera/core'

import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { aSessionOn, threadOf, toolApplication } from './application.ts'

let dataFolder: string
let workspace: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-agent-tools-'))
  workspace = mkdtempSync(join(tmpdir(), 'hemera-agent-workspace-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

/** What the runtime keeps of a tool call the agent streamed: its input and its output, as text. */
const CALL = z.object({
  call: z.object({
    rawInput: z.object({ text: z.string() }).nullable(),
    rawOutput: z.object({ text: z.string() }).nullable(),
  }),
})

describe("The fake agent reaches Hemera's tools through the MCP server", () => {
  test('it lists the tools, calls one by name with its token, and streams what came back', async () => {
    writeFileSync(join(workspace, 'notes.md'), 'the answer is 42\n')
    const agent = fakeAgent({
      steps: [
        { does: 'uses', call: 'fs_read', arguments: { path: 'notes.md' }, id: 'read-1' },
        { does: 'says', text: 'read it' },
      ],
    })

    const entries = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'read the notes')
        return yield* threadOf(session.id)
      }),
    )

    // What the agent could see is the server's list, and the server lists Hemera's tools.
    expect(agent.answers.tools).toHaveLength(1)
    expect([...(agent.answers.tools[0] ?? [])].sort()).toEqual([...TOOL_NAMES].sort())
    // The call went through the door with the token of the Session: a 200, and the file.
    expect(agent.answers.used).toHaveLength(1)
    expect(agent.answers.used[0]?.status).toBe(200)
    expect(agent.answers.used[0]?.isError).toBe(false)
    expect(agent.answers.used[0]?.text).toContain('the answer is 42')

    // The agent's own call, as it streamed it: what it asked and what it was answered.
    const streamed = entries.find((entry) => entry.correlationId === 'call:read-1')
    expect(streamed?.kind).toBe('tool_call')
    expect(streamed?.state).toBe('completed')
    const call = CALL.parse(JSON.parse(streamed?.payload ?? '{}')).call
    expect(call.rawInput?.text).toContain('notes.md')
    expect(call.rawOutput?.text).toContain('the answer is 42')
    // And Hemera's record of the same call, written by the tool that answered it.
    const recorded = entries.filter((entry) => entry.kind === 'hemera_tool_call')
    expect(recorded.map((entry) => entry.state)).toEqual(['completed'])
    expect(recorded[0]?.body).toContain('notes.md')
  })
})
