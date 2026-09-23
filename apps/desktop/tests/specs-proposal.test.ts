/**
 * The agent of a `free` Session proposes a Spec in its answer (design D7-07).
 *
 * Until the agent has Hemera's `spec_propose` tool, it proposes with a marker line in its answer;
 * the runtime takes the line out of the message and writes the proposal the human accepts or not.
 * The agent is the fake provider behind the supervisor's port, so a turn really happens.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'

import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import { aSession, application, heldInThread } from './application.ts'

let dataFolder: string
let workingDirectory: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-specs-proposal-'))
  workingDirectory = mkdtempSync(join(tmpdir(), 'hemera-workspace-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workingDirectory, { recursive: true, force: true })
})

/** An agent that proposes a Spec in its answer; a fake is started once, so one per run. */
const proposing = () =>
  fakeAgent({
    steps: [
      {
        does: 'says',
        text: 'You want the Journal to leave the application.\n<!-- hemera:propose-spec title="Export the Journal" type="feature" -->\nShall I write it down?',
        messageId: 'msg-1',
      },
    ],
  })

describe('The agent’s proposal in its answer becomes a proposal entry, stripped from the message', () => {
  test('a free Session gets the proposal after the message, and the message no marker', async () => {
    const thread = await application(dataFolder)(proposing())(
      Effect.gen(function* () {
        const session = yield* aSession(workingDirectory)
        yield* (yield* AgentRuntime).prompt(session.id, 'the Journal should export')
        return yield* heldInThread(session.id, (entries) =>
          entries.some((entry) => entry.kind === 'turn'),
        )
      }),
    )
    const said = thread.filter((entry) => entry.role !== 'user')
    const message = said.find((entry) => entry.kind === 'message')
    expect(message?.body).toBe(
      'You want the Journal to leave the application.\nShall I write it down?',
    )
    const proposal = said.find((entry) => entry.kind === 'spec_proposal')
    expect(proposal).toMatchObject({ role: 'hemera', body: 'Export the Journal' })
    expect(JSON.parse(proposal?.payload ?? '{}')).toEqual({
      title: 'Export the Journal',
      type: 'feature',
    })
    expect(proposal?.seq).toBe((message?.seq ?? 0) + 1)
  })

  test('a Session that already defines a Spec is proposed nothing', async () => {
    const thread = await application(dataFolder)(proposing())(
      Effect.gen(function* () {
        const session = yield* aSession(workingDirectory)
        const sql = yield* SqliteClient
        yield* sql`UPDATE sessions SET mission = 'define' WHERE id = ${session.id}`
        yield* (yield* AgentRuntime).prompt(session.id, 'the Journal should export')
        return yield* heldInThread(session.id, (entries) =>
          entries.some((entry) => entry.kind === 'turn'),
        )
      }),
    )
    expect(thread.some((entry) => entry.kind === 'spec_proposal')).toBe(false)
  })
})
