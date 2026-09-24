/**
 * The Spec tools as a `define` Session's agent reaches them: over MCP, with its token (D7-14).
 *
 * The engine runs whole — the runtime, the tool server on a loopback port, the catalogue and the
 * Specs behind it — with the fake provider as the agent, which lists what it is offered and calls
 * a tool by name. What is read is what the user and the agent each read: the Spec, the thread,
 * the Journal, the window's notices, and the answer the agent was given.
 *
 * Each suite is named after the scenario of `Spec · spec-tools` it plays.
 */

import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'
import { z } from 'zod'

import { type SessionEntry, focusOf, offeredTools } from '@hemera/core'

import { type FakeStep, fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Journal } from '#engine/journal.ts'
import { Sessions } from '#engine/sessions.ts'
import { SpecNotices } from '#engine/specs/notices.ts'
import { Specs } from '#engine/specs/specs.ts'
import { aSessionOn, gated, pause, threadOf, toolApplication } from './application.ts'
import { agentOf, contracted, frozen, shaped, write } from './specs-harness.ts'
import { type OpenWindow, openWindow } from './window.ts'

let dataFolder: string
let workspace: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-spec-tools-'))
  workspace = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-spec-workspace-')))
})

let opened: OpenWindow | null = null

afterEach(async () => {
  await opened?.close()
  opened = null
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

/** What a call of Hemera's writes in the thread, as far as these suites read it. */
const CALL = z.object({ tool: z.string(), state: z.string() })

/** Hemera's entries of its tool calls, with the tool and the state each ended in. */
const callsIn = (entries: readonly SessionEntry[]) =>
  entries
    .filter((entry) => entry.kind === 'hemera_tool_call')
    .map((entry) => {
      const { tool, state } = CALL.parse(JSON.parse(entry.payload ?? '{}'))
      return { tool, state, body: entry.body }
    })

/** A `free` Session of a Project on the suite's Workspace, whose proposal the human accepted. */
const defining = Effect.gen(function* () {
  const session = yield* aSessionOn(workspace, 'claude')
  const { snapshot } = yield* (yield* Specs).create({
    sessionId: session.id,
    type: 'feature',
    title: 'Export the journal',
  })
  return { sessionId: session.id, projectId: session.projectId, specId: snapshot.spec.id }
})

/** One turn of a `define` Session: its agent does what the script says. */
const turn = (sessionId: string) =>
  Effect.gen(function* () {
    yield* (yield* AgentRuntime).prompt(sessionId, 'Go on with the Spec.')
    return yield* threadOf(sessionId)
  })

/** A call the fake agent makes to one of Hemera's tools. */
const uses = (call: string, sent: Record<string, string | number | boolean>): FakeStep => ({
  does: 'uses',
  call,
  arguments: sent,
})

describe('A define Session is offered the Spec tools and no write tool', () => {
  test('the agent lists the read-only code set and the three Spec tools', async () => {
    const agent = fakeAgent({ listsTools: true })
    await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId } = yield* defining
        yield* turn(sessionId)
      }),
    )
    const listed = [...(agent.answers.tools[0] ?? [])].toSorted()
    expect(listed).toEqual([...offeredTools('define')].toSorted())
    for (const tool of ['spec_read', 'spec_write', 'spec_propose']) expect(listed).toContain(tool)
    for (const tool of ['fs_write', 'fs_edit', 'commands_run', 'commands_stop']) {
      expect(listed).not.toContain(tool)
    }
  })
})

describe('The define set excludes writing code', () => {
  test('fs_write and commands_run from a define Session are refused as not offered', async () => {
    const agent = fakeAgent({
      steps: [
        uses('fs_write', { path: 'notes.md', content: 'written', key: 'w-1' }),
        uses('commands_run', { line: 'echo hi', key: 'r-1' }),
      ],
    })
    const entries = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId } = yield* defining
        return yield* turn(sessionId)
      }),
    )
    expect(agent.answers.used.map((answer) => answer.isError)).toEqual([true, true])
    expect(callsIn(entries)).toEqual([
      {
        tool: 'fs_write',
        state: 'refused',
        body: 'the tool fs_write is not offered to this Session',
      },
      {
        tool: 'commands_run',
        state: 'refused',
        body: 'the tool commands_run is not offered to this Session',
      },
    ])
    expect(readdirSync(workspace)).toEqual([])
  })
})

describe('The agent writes a section with its provenance', () => {
  test('author agent, the phase and the Session, and the window hears the Spec changed', async () => {
    const changed: string[] = []
    const window = Layer.succeed(SpecNotices, {
      changed: (specId) => {
        changed.push(specId)
      },
      wrote: () => undefined,
    })
    const agent = fakeAgent({
      steps: [
        uses('spec_read', {}),
        uses('spec_write', {
          section: 'problem',
          body: 'The Journal cannot leave the application.',
          baseVersion: 1,
          key: 'problem-1',
        }),
      ],
    })
    const seen = await toolApplication(dataFolder, [], undefined, undefined, window)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId, projectId } = yield* defining
        changed.length = 0
        const entries = yield* turn(sessionId)
        const snapshot = yield* (yield* Specs).read(specId)
        const journal = yield* (yield* Journal).read({ projectId, specId })
        return { sessionId, specId, entries, snapshot, journal: journal.entries }
      }),
    )
    // The agent read the Spec with each section's version, and wrote on the one it read.
    expect(agent.answers.used[0]?.text).toContain('## problem\n<!-- version: 1 -->')
    expect(agent.answers.used[1]).toMatchObject({ isError: false })
    expect(agent.answers.used[1]?.text).toContain('The problem section of')
    expect(seen.snapshot.sections.find((section) => section.name === 'problem')).toMatchObject({
      body: 'The Journal cannot leave the application.',
      version: 2,
      author: 'agent',
      sessionId: seen.sessionId,
    })
    const written = seen.journal.find((line) => line.type === 'spec.section_written')
    expect(written).toMatchObject({ author: 'agent', sessionId: seen.sessionId, phaseId: 'shape' })
    expect(changed).toContain(seen.specId)
    expect(callsIn(seen.entries).map((call) => [call.tool, call.state])).toEqual([
      ['spec_read', 'completed'],
      ['spec_write', 'completed'],
    ])
  })
})

describe('A write on a frozen Spec is refused through the tool', () => {
  test('refused with its reason, recorded like any call, and the Spec stays ready', async () => {
    const agent = fakeAgent({
      steps: [
        uses('spec_write', { section: 'scope', body: 'More.', baseVersion: 2, key: 'late-1' }),
      ],
    })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId, projectId } = yield* defining
        const ready = yield* frozen(specId, sessionId)
        const entries = yield* turn(sessionId)
        const after = yield* (yield* Specs).read(specId)
        const journal = yield* (yield* Journal).read({ projectId })
        return { ready, after, entries, sessionId, journal: journal.entries }
      }),
    )
    const reason = `${seen.ready.spec.key} is ready: only a draft is written`
    expect(agent.answers.used[0]).toMatchObject({ isError: true })
    expect(agent.answers.used[0]?.text).toContain(reason)
    expect(callsIn(seen.entries)).toEqual([{ tool: 'spec_write', state: 'refused', body: reason }])
    const line = seen.journal.find((one) => one.type === 'tool.refused')
    expect(line).toMatchObject({ entityId: seen.sessionId })
    expect(line?.payload).toMatchObject({ tool: 'spec_write' })
    expect(seen.after.spec.status).toBe('ready')
    expect(seen.after.revision.id).toBe(seen.ready.revision.id)
    expect(seen.after.spec.contentVersion).toBe(seen.ready.spec.contentVersion)
  })
})

describe('A phase declared finished that fails its checks stays open', () => {
  test('shape without a scope stays open, the result names the scope, the focus stays', async () => {
    const agent = fakeAgent({
      steps: [
        uses('spec_propose', {
          kind: 'phase_done',
          phase: 'shape',
          summary: 'Shaped.',
          key: 'propose-1',
        }),
      ],
    })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        for (const name of ['problem', 'expected_outcome', 'behaviour'] as const) {
          yield* write(agentOf(sessionId), specId, name, `The ${name} of the export.`)
        }
        const entries = yield* turn(sessionId)
        return { entries, after: yield* (yield* Specs).read(specId) }
      }),
    )
    expect(agent.answers.used[0]).toMatchObject({ isError: true })
    expect(agent.answers.used[0]?.text).toContain('the scope section is missing')
    const shape = seen.after.phases.find((phase) => phase.phase === 'shape')
    expect(shape).toMatchObject({ state: 'open', summary: null })
    expect(seen.after.phases.find((phase) => phase.phase === 'plan')?.state).toBe('pending')
    expect(focusOf(seen.after.phases)).toBe('shape')
    expect(callsIn(seen.entries).map((call) => call.state)).toEqual(['refused'])
  })
})

describe("A reader Session's agent is refused a write with the writer named", () => {
  test('spec_write and spec_propose from a reader are refused, naming the writer Session', async () => {
    const agent = fakeAgent({
      steps: [
        uses('spec_write', { section: 'scope', body: 'Mine.', baseVersion: 1, key: 'reader-1' }),
        uses('spec_propose', { kind: 'ready', key: 'propose-2' }),
      ],
    })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const specs = yield* Specs
        const { sessionId: writerId, specId } = yield* defining
        const sessions = yield* Sessions
        const { session: writer } = yield* sessions.one(writerId)
        yield* sessions.rename(writerId, writer.version, 'Shaping the export')
        const reader = yield* specs.openSession({ specId, provider: 'claude' })
        const before = yield* specs.read(specId)
        yield* turn(reader.session.id)
        return { before, after: yield* specs.read(specId) }
      }),
    )
    const named = `the write right on ${seen.before.spec.key} belongs to the Session "Shaping the export"`
    expect(agent.answers.used.map((answer) => answer.isError)).toEqual([true, true])
    for (const answer of agent.answers.used) expect(answer.text).toContain(named)
    expect(seen.after.spec.contentVersion).toBe(seen.before.spec.contentVersion)
    expect(seen.after.revision.attestedContentVersion).toBeNull()
  })
})

describe('A stale base version is refused and nothing changes', () => {
  test('a write on an older version of a section is refused with its current text', async () => {
    const agent = fakeAgent({
      steps: [
        uses('spec_write', { section: 'scope', body: 'Mine.', baseVersion: 1, key: 'stale-1' }),
      ],
    })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const before = yield* write(
          { kind: 'human', sessionId },
          specId,
          'scope',
          'Only the current Project.',
        )
        yield* turn(sessionId)
        return { before, after: yield* (yield* Specs).read(specId) }
      }),
    )
    expect(agent.answers.used[0]).toMatchObject({ isError: true })
    const text = agent.answers.used[0]?.text ?? ''
    expect(text).toContain('the scope section changed since version 1: it is at version 2')
    expect(text).toContain('Only the current Project.')
    const scope = (snapshot: typeof seen.after) =>
      snapshot.sections.find((section) => section.name === 'scope')
    expect(scope(seen.after)).toEqual(scope(seen.before))
    expect(seen.after.spec.contentVersion).toBe(seen.before.spec.contentVersion)
    expect(seen.after.phases).toEqual(seen.before.phases)
  })
})

describe('phase_done with a failing exit check changes nothing and names the check', () => {
  test('plan without its plan section: no phase moves, no content changes, no declaration', async () => {
    const agent = fakeAgent({
      steps: [
        uses('spec_propose', {
          kind: 'phase_done',
          phase: 'plan',
          summary: 'Planned.',
          supporting: 'the scope',
          assumptions: '["CSV first"]',
          key: 'propose-3',
        }),
      ],
    })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const specs = yield* Specs
        const { sessionId, specId, projectId } = yield* defining
        for (const name of ['problem', 'expected_outcome', 'scope', 'behaviour'] as const) {
          yield* write(agentOf(sessionId), specId, name, `The ${name} of the export.`)
        }
        const before = yield* specs.declarePhase(specId, sessionId, 'shape', {
          summary: 'Shaped.',
          assumptions: [],
        })
        yield* turn(sessionId)
        const journal = yield* (yield* Journal).read({ projectId, specId })
        return { before, after: yield* specs.read(specId), journal: journal.entries }
      }),
    )
    expect(agent.answers.used[0]).toMatchObject({ isError: true })
    expect(agent.answers.used[0]?.text).toContain(
      'The plan phase cannot finish: the plan section is missing.',
    )
    expect(seen.after.phases).toEqual(seen.before.phases)
    expect(seen.after.spec.contentVersion).toBe(seen.before.spec.contentVersion)
    const declared = seen.journal.filter((line) => line.type === 'spec.phase_declared')
    expect(declared.map((line) => line.phaseId)).toEqual(['shape'])
  })

  test('once it passes, the phase finishes with its summary and assumptions and plan opens', async () => {
    const agent = fakeAgent({
      steps: [
        uses('spec_propose', {
          kind: 'phase_done',
          phase: 'shape',
          summary: 'Shaped.',
          supporting: 'problem, scope',
          assumptions: '["CSV first"]',
          key: 'propose-4',
        }),
      ],
    })
    const after = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        for (const name of ['problem', 'expected_outcome', 'scope', 'behaviour'] as const) {
          yield* write(agentOf(sessionId), specId, name, `The ${name} of the export.`)
        }
        yield* turn(sessionId)
        return yield* (yield* Specs).read(specId)
      }),
    )
    expect(agent.answers.used[0]).toMatchObject({ isError: false })
    expect(agent.answers.used[0]?.text).toContain('the focus is plan')
    expect(after.phases.find((phase) => phase.phase === 'shape')).toMatchObject({
      state: 'finished',
      summary: 'Shaped.',
      assumptions: ['CSV first'],
    })
    expect(after.phases.find((phase) => phase.phase === 'plan')?.state).toBe('open')
  })
})

describe('ready attests and does not freeze', () => {
  test('the attestation is recorded on the content it was made on, and the Spec stays a draft', async () => {
    const agent = fakeAgent({ steps: [uses('spec_propose', { kind: 'ready', key: 'propose-5' })] })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const specs = yield* Specs
        const { sessionId, specId } = yield* defining
        yield* contracted(specId, sessionId)
        yield* turn(sessionId)
        return { after: yield* specs.read(specId), gate: yield* specs.gate(specId) }
      }),
    )
    expect(agent.answers.used[0]).toMatchObject({ isError: false })
    expect(agent.answers.used[0]?.text).toContain('only the user')
    expect(agent.answers.used[0]?.text).toContain('The ready gate lists nothing')
    expect(seen.after.revision.attestedContentVersion).toBe(seen.after.spec.contentVersion)
    expect(seen.after.spec.status).toBe('draft')
    expect(seen.gate.failures).toEqual([])
  })
})

describe('An older revision is read and never written', () => {
  test('spec_read names revision 1 read-only, and a write naming it is refused', async () => {
    const agent = fakeAgent({
      steps: [
        uses('spec_read', { revision: 1 }),
        uses('spec_write', {
          section: 'scope',
          body: 'Rewritten.',
          baseVersion: 2,
          revision: 1,
          key: 'old-1',
        }),
      ],
    })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const specs = yield* Specs
        const { sessionId, specId } = yield* defining
        const ready = yield* frozen(specId, sessionId)
        yield* specs.reopen({ specId, expectedRevisionId: ready.revision.id, sessionId })
        const before = yield* specs.read(specId, 1)
        yield* turn(sessionId)
        return { key: ready.spec.key, before, after: yield* specs.read(specId, 1) }
      }),
    )
    expect(agent.answers.used[0]).toMatchObject({ isError: false })
    expect(agent.answers.used[0]?.text).toContain(
      `revision 1 of ${seen.key} is not its current revision: it is read-only`,
    )
    expect(agent.answers.used[1]).toMatchObject({ isError: true })
    expect(agent.answers.used[1]?.text).toContain(
      `revision 1 of ${seen.key} is not its current revision`,
    )
    expect(seen.after.sections).toEqual(seen.before.sections)
  })
})

describe('Stories, tasks and a question are written through the tool', () => {
  test('the lists are read from their JSON, and the question is asked in the chat', async () => {
    const stories = [
      {
        title: 'Export',
        narrative: 'As a user, I export the Journal.',
        criteria: ['A file is written', 'It opens in a spreadsheet'],
      },
    ]
    const tasks = [
      {
        title: 'Write the exporter',
        result: 'An exporter',
        type: 'code',
        executor: 'agent',
        criteria: 'Its tests pass',
        stories: ['Export'],
      },
      {
        title: 'Document it',
        result: 'A page',
        type: 'docs',
        executor: 'human',
        criteria: 'The page is published',
        dependsOn: ['Write the exporter'],
      },
    ]
    const options = [
      { id: 'csv', label: 'CSV', recommended: true },
      { id: 'json', label: 'JSON' },
    ]
    const agent = fakeAgent({
      steps: [
        uses('spec_write', { stories: JSON.stringify(stories), key: 'stories-1' }),
        uses('spec_write', { tasks: JSON.stringify(tasks), key: 'tasks-1' }),
        uses('spec_write', {
          question: 'Which format first?',
          blocking: true,
          phase: 'shape',
          options: JSON.stringify(options),
          key: 'question-1',
        }),
        uses('spec_write', { stories: '[{"title": 3}]', key: 'stories-2' }),
      ],
    })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const entries = yield* turn(sessionId)
        return { entries, after: yield* (yield* Specs).read(specId) }
      }),
    )
    expect(agent.answers.used.map((answer) => answer.isError)).toEqual([false, false, false, true])
    expect(agent.answers.used[3]?.text).toContain('stories.0.title')
    expect(seen.after.stories.map((story) => story.title)).toEqual(['Export'])
    expect(seen.after.criteria.map((criterion) => criterion.body)).toEqual([
      'A file is written',
      'It opens in a spreadsheet',
    ])
    expect(seen.after.tasks.map((task) => task.title)).toEqual([
      'Write the exporter',
      'Document it',
    ])
    expect(seen.after.dependencies).toHaveLength(1)
    expect(seen.after.questions).toEqual([
      expect.objectContaining({
        body: 'Which format first?',
        blocking: true,
        phase: 'shape',
        raisedBy: 'agent',
        options,
      }),
    ])
    const asked = seen.entries.find((entry) => entry.kind === 'spec_question')
    expect(asked).toMatchObject({ role: 'hemera', body: 'Which format first?' })
  })
})

describe('The agent proposes a Spec through spec_propose in a free Session', () => {
  test('the proposal entry is written, and nothing else: no Spec, the Session stays free', async () => {
    const agent = fakeAgent({
      steps: [
        { does: 'says', text: 'You want the Journal to leave the application.' },
        uses('spec_propose', {
          kind: 'spec',
          title: 'Export the Journal',
          type: 'feature',
          key: 'propose-6',
        }),
      ],
    })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const session = yield* aSessionOn(workspace, 'claude')
        const entries = yield* turn(session.id)
        return {
          entries,
          specs: yield* (yield* Specs).list(session.projectId),
          after: (yield* (yield* Sessions).one(session.id)).session,
        }
      }),
    )
    expect(agent.answers.tools[0]).toContain('spec_propose')
    expect(agent.answers.used[0]).toMatchObject({ isError: false })
    const proposals = seen.entries.filter((entry) => entry.kind === 'spec_proposal')
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({ role: 'hemera', body: 'Export the Journal' })
    expect(JSON.parse(proposals[0]?.payload ?? '{}')).toEqual({
      title: 'Export the Journal',
      type: 'feature',
    })
    // What the agent said before it proposed is before the proposal in the thread.
    const said = seen.entries.find((entry) => entry.kind === 'message' && entry.role === 'agent')
    expect(said?.body).toBe('You want the Journal to leave the application.')
    expect(said?.seq).toBeLessThan(proposals[0]?.seq ?? 0)
    expect(seen.specs).toEqual([])
    expect(seen.after).toMatchObject({ mission: 'free', specId: null })
  })

  test('a define Session is refused a proposal', async () => {
    const proposing = fakeAgent({
      steps: [
        uses('spec_propose', { kind: 'spec', title: 'Another', type: 'bug', key: 'propose-7' }),
      ],
    })
    const defined = await toolApplication(dataFolder)(proposing)(
      Effect.gen(function* () {
        const { sessionId } = yield* defining
        return yield* turn(sessionId)
      }),
    )
    expect(proposing.answers.used[0]).toMatchObject({ isError: true })
    expect(proposing.answers.used[0]?.text).toContain('only a free Session proposes a Spec')
    expect(defined.some((entry) => entry.kind === 'spec_proposal')).toBe(false)
  })

  test('a free Session is refused the kinds that need a Spec', async () => {
    const attesting = fakeAgent({
      steps: [uses('spec_propose', { kind: 'ready', key: 'propose-8' })],
    })
    await toolApplication(dataFolder)(attesting)(
      Effect.gen(function* () {
        const session = yield* aSessionOn(workspace, 'claude')
        yield* turn(session.id)
      }),
    )
    expect(attesting.answers.used[0]).toMatchObject({ isError: true })
    expect(attesting.answers.used[0]?.text).toContain('it defines none')
  })
})

describe('A Session whose proposal is accepted is offered the define set at its next turn', () => {
  test('its agent is started again, its conversation resumed, with the Spec tools', async () => {
    const proposing = fakeAgent({
      steps: [
        uses('spec_propose', {
          kind: 'spec',
          title: 'Export the Journal',
          type: 'feature',
          key: 'propose-9',
        }),
      ],
    })
    const restarted = fakeAgent({ listsTools: true })
    opened = await openWindow(dataFolder, proposing, restarted)
    const { bridge } = opened
    const project = await bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: workspace,
    })
    const session = await bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'claude',
    })
    await bridge.invoke('agents.prompt', { sessionId: session.id, text: 'Export the Journal.' })
    await bridge.invoke('specs.create', {
      sessionId: session.id,
      type: 'feature',
      title: 'Export the Journal',
    })
    await bridge.invoke('agents.prompt', { sessionId: session.id, text: 'Shape it.' })

    expect(proposing.answers.tools).toEqual([[...offeredTools('free')]])
    expect(restarted.answers.resumes).toBe(1)
    expect([...(restarted.answers.tools[0] ?? [])].toSorted()).toEqual(
      [...offeredTools('define')].toSorted(),
    )
  })
})

describe('A proposal accepted during a turn takes the write tools away at once and lends the Spec tools at the next turn', () => {
  test('the running agent is refused fs_write once the Session is define, and is started again with the define set', async () => {
    const gate = gated(1)
    const proposing = fakeAgent({
      steps: [
        uses('spec_propose', {
          kind: 'spec',
          title: 'Export the Journal',
          type: 'feature',
          key: 'propose-10',
        }),
        uses('fs_write', { path: 'notes.md', content: 'Written anyway.', key: 'write-1' }),
        { does: 'says', text: 'Carrying on.' },
      ],
      between: gate.between,
    })
    const restarted = fakeAgent({ listsTools: true })
    opened = await openWindow(dataFolder, proposing, restarted)
    const { bridge } = opened
    const project = await bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: workspace,
    })
    const session = await bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'claude',
    })
    // The agent proposes, and its turn is held there, still running.
    const running = bridge.invoke('agents.prompt', { sessionId: session.id, text: 'Export it.' })
    for (let look = 0; look < 200; look += 1) {
      // oxlint-disable-next-line no-await-in-loop -- a poll: each look waits for the one before it
      const read = await bridge.invoke('sessions.read', { sessionId: session.id })
      if (read.entries.some((entry) => entry.kind === 'spec_proposal')) break
      // oxlint-disable-next-line no-await-in-loop -- the same poll, after its pause
      await Effect.runPromise(pause(25))
    }
    // The user creates the Spec while the turn runs: the Session is define from now on.
    await bridge.invoke('specs.create', {
      sessionId: session.id,
      type: 'feature',
      title: 'Export the Journal',
    })
    gate.carryOn()
    await running
    await bridge.invoke('agents.prompt', { sessionId: session.id, text: 'Shape it.' })

    // Lent with the free set, the running agent is refused a write tool as not offered.
    expect(proposing.answers.used[1]).toMatchObject({ tool: 'fs_write', isError: true })
    expect(proposing.answers.used[1]?.text).toContain('the tool fs_write is not offered')
    expect(readdirSync(workspace)).not.toContain('notes.md')
    // Its next turn starts the agent again, its conversation resumed, with the define set.
    expect(restarted.answers.resumes).toBe(1)
    expect([...(restarted.answers.tools[0] ?? [])].toSorted()).toEqual(
      [...offeredTools('define')].toSorted(),
    )
  })
})

describe('A retried spec_propose is answered once', () => {
  test('a proposal sent twice under one key writes one proposal, and answers the retry the same', async () => {
    const proposal = { kind: 'spec', title: 'Export the Journal', type: 'feature', key: 'once' }
    const agent = fakeAgent({
      steps: [uses('spec_propose', proposal), uses('spec_propose', proposal)],
    })
    const entries = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const session = yield* aSessionOn(workspace, 'claude')
        return yield* turn(session.id)
      }),
    )
    expect(agent.answers.used.map((answer) => answer.isError)).toEqual([false, false])
    expect(agent.answers.used[1]?.text).toBe(agent.answers.used[0]?.text)
    expect(entries.filter((entry) => entry.kind === 'spec_proposal')).toHaveLength(1)
  })

  test('a phase declared twice under one key is finished once, and the retry is not refused', async () => {
    const declared = { kind: 'phase_done', phase: 'shape', summary: 'Shaped.', key: 'shape-once' }
    const agent = fakeAgent({
      steps: [uses('spec_propose', declared), uses('spec_propose', declared)],
    })
    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId, projectId } = yield* defining
        yield* shaped(specId, sessionId)
        yield* turn(sessionId)
        return (yield* (yield* Journal).read({ projectId, specId })).entries
      }),
    )
    expect(agent.answers.used.map((answer) => answer.isError)).toEqual([false, false])
    expect(agent.answers.used[1]?.text).toBe(agent.answers.used[0]?.text)
    expect(seen.filter((line) => line.type === 'spec.phase_finished')).toHaveLength(1)
  })
})
