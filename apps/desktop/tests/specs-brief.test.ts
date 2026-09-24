/**
 * The mission brief, the human's edits and answers of a `define` Session, and a sub-agent's
 * result, handed to its agent as deliveries at the safe point, on the fake provider (design D7-09,
 * D7-14, onto D6-08).
 *
 * A turn really happens: the runtime starts the fake agent, sends it the prompts and writes the
 * thread, so what is asserted is what the agent received and what the thread holds. Each suite
 * is named after the scenario it covers.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Fiber } from 'effect'

import type { ContentBlock } from '@agentclientprotocol/sdk'
import {
  DEFINE_MISSION_BRIEF,
  DELIVERY_MARKER,
  PHASE_BRIEFS,
  contextUri,
  internalText,
  readerLine,
} from '@hemera/core'
import { type FakeAgent, fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Context as AgentContext } from '#engine/context/service.ts'
import type { SessionEntry } from '#engine/sessions.ts'
import { Sessions } from '#engine/sessions.ts'
import { briefFor } from '#engine/specs/brief.ts'
import { Specs } from '#engine/specs/specs.ts'
import { Database } from '#engine/storage/database.ts'
import { application, aSession, gated, heldInThread, threadOf } from './application.ts'
import { frozen, humanOf, shaped, write } from './specs-harness.ts'

let dataFolder: string
let workingDirectory: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-brief-'))
  workingDirectory = mkdtempSync(join(tmpdir(), 'hemera-workspace-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workingDirectory, { recursive: true, force: true })
})

/** A `free` Session whose proposal was accepted: `define` on a `feature` Spec, `shape` in focus. */
const defining = Effect.gen(function* () {
  const session = yield* aSession(workingDirectory)
  const { snapshot } = yield* (yield* Specs).create({
    sessionId: session.id,
    type: 'feature',
    title: 'Export the journal',
  })
  return { sessionId: session.id, specId: snapshot.spec.id }
})

const HUMAN_EDITS = '# Human edits since your last turn'
const ANSWERS = '# Answers since your last turn'

/** Whether a prompt is a delivery: the marker, then resources, and nothing anyone said. */
function delivery(blocks: readonly ContentBlock[]): boolean {
  const [marker, ...rest] = blocks
  return (
    marker?.type === 'text' &&
    marker.text === DELIVERY_MARKER &&
    rest.length > 0 &&
    rest.every((block) => block.type === 'resource')
  )
}

/** The resources of each delivery the agent was handed, by address, in the order it was. */
const deliveriesTo = (agent: FakeAgent) =>
  agent.answers.blocks.filter(delivery).map((blocks) => {
    const handed = new Map<string, string>()
    for (const block of blocks) {
      if (block.type === 'resource' && 'text' in block.resource) {
        handed.set(block.resource.uri, block.resource.text)
      }
    }
    return handed
  })

/** Whether a thread holds a turn Hemera opened to hand something over while none ran (D6-08). */
const deliveredAlone = (entries: readonly SessionEntry[]) =>
  entries.some((entry) => entry.kind === 'turn' && entry.payload.includes('"kind":"delivery"'))

const usersOf = (entries: readonly SessionEntry[]) =>
  entries.filter((entry) => entry.role === 'user').map((entry) => entry.body)

/** The agent's script for a turn a suite holds open after its first words. */
const SHAPING = [
  { does: 'says', text: 'Shaping the export' },
  { does: 'says', text: ' and carrying on.' },
] as const

describe('The brief is part of the turn, never a human message', () => {
  test('a delivery with the marker hands the mission, the shape brief and the Spec over before the user’s text; one folded brief, no other human entry', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const snapshot = yield* (yield* Specs).read(specId)
        yield* (yield* AgentRuntime).prompt(sessionId, 'Let us shape the export.')

        // Two prompts: the delivery, then the user's text alone.
        expect(agent.answers.prompts).toEqual([DELIVERY_MARKER, 'Let us shape the export.'])
        const brief = deliveriesTo(agent)[0]?.get(contextUri('brief')) ?? ''
        expect(agent.answers.blocks[0]).toEqual([
          { type: 'text', text: DELIVERY_MARKER },
          {
            type: 'resource',
            resource: { uri: contextUri('brief'), mimeType: 'text/markdown', text: brief },
          },
        ])
        expect(brief.startsWith(`${DEFINE_MISSION_BRIEF}\n\n${PHASE_BRIEFS.shape}`)).toBe(true)
        expect(brief).toContain(`# ${snapshot.spec.key} · Export the journal`)
        for (const section of snapshot.sections) {
          expect(brief).toContain(`## ${section.name}\n<!-- version: ${section.version} -->`)
        }

        const entries = yield* threadOf(sessionId)
        expect(usersOf(entries)).toEqual(['Let us shape the export.'])
        const briefs = entries.filter((entry) => entry.kind === 'mission_brief')
        expect(briefs).toHaveLength(1)
        // Folded in the turn the user started, which it went out inside of.
        expect(briefs[0]).toMatchObject({ role: 'hemera', body: brief, turnId: null })
        expect(JSON.parse(briefs[0]?.payload ?? '{}')).toEqual({ phase: 'shape' })

        const provided = yield* (yield* AgentContext).provided(sessionId)
        expect(provided.filter((one) => one.kind === 'brief')).toEqual([
          expect.objectContaining({
            path: 'shape · revision 1 · writer',
            reached: 'delivery_prompt',
          }),
        ])
      }),
    )
  })
})

describe('The brief goes once per phase change', () => {
  test('a turn in the same phase is the user’s text alone; a phase finished during a turn is briefed once it is over, in a turn of its own', async () => {
    const gate = gated(1)
    const agent = fakeAgent({ turns: [[], [], SHAPING], between: gate.between })

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const runtime = yield* AgentRuntime
        yield* runtime.prompt(sessionId, 'First turn.')
        yield* runtime.prompt(sessionId, 'Second turn.')
        expect(agent.answers.prompts).toEqual([DELIVERY_MARKER, 'First turn.', 'Second turn.'])

        // The agent shapes the Spec and finishes `shape` while its turn runs, as its Spec tools
        // do: `plan` opens, and its brief waits for the end of the turn.
        const running = yield* Effect.forkScoped(runtime.prompt(sessionId, 'Third turn.'))
        yield* heldInThread(sessionId, (entries) =>
          entries.some((entry) => entry.role === 'agent' && entry.body.startsWith('Shaping')),
        )
        yield* shaped(specId, sessionId)
        yield* (yield* Specs).declarePhase(specId, sessionId, 'shape', {
          summary: 'Shaped.',
          assumptions: [],
        })
        expect(agent.answers.prompts).toHaveLength(4)
        gate.carryOn()
        yield* Fiber.join(running)

        const entries = yield* heldInThread(sessionId, deliveredAlone)
        expect(agent.answers.prompts.slice(3)).toEqual(['Third turn.', DELIVERY_MARKER])
        const plan = deliveriesTo(agent)[1]?.get(contextUri('brief')) ?? ''
        expect(plan.startsWith(`${DEFINE_MISSION_BRIEF}\n\n${PHASE_BRIEFS.plan}`)).toBe(true)
        const briefs = entries.filter((entry) => entry.kind === 'mission_brief')
        expect(briefs.map((entry) => JSON.parse(entry.payload))).toEqual([
          { phase: 'shape' },
          { phase: 'plan' },
        ])
        // Handed over while no turn ran: a turn of its own, and the brief is folded in it.
        const closing = entries.findLast((entry) => entry.kind === 'turn')
        expect(briefs[1]?.turnId).toBe(closing?.turnId)
        expect(usersOf(entries)).toEqual(['First turn.', 'Second turn.', 'Third turn.'])

        yield* runtime.prompt(sessionId, 'Fourth turn.')
        expect(agent.answers.prompts.slice(5)).toEqual(['Fourth turn.'])
      }),
    )
  })
})

describe('A human edit is recorded and reaches the agent', () => {
  test('a section saved while the agent is answering reaches nothing during the turn, and goes as an edit delivery at the next safe point', async () => {
    const gate = gated(1)
    const agent = fakeAgent({ steps: SHAPING, between: gate.between })

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const runtime = yield* AgentRuntime
        const specs = yield* Specs
        const running = yield* Effect.forkScoped(runtime.prompt(sessionId, 'First turn.'))
        yield* heldInThread(sessionId, (entries) =>
          entries.some((entry) => entry.role === 'agent' && entry.body.startsWith('Shaping')),
        )

        // The turn is running, held after the agent's first words: the user saves `scope`.
        const written = yield* write(humanOf(sessionId), specId, 'scope', 'CSV only.')
        const scope = written.sections.find((section) => section.name === 'scope')
        expect(scope).toMatchObject({ author: 'human', sessionId })
        // Nothing was sent to the agent while its turn runs: the brief, then the turn's prompt.
        expect(agent.answers.prompts).toEqual([DELIVERY_MARKER, 'First turn.'])
        expect(JSON.stringify(agent.answers.blocks)).not.toContain('CSV only.')

        gate.carryOn()
        yield* Fiber.join(running)
        const entries = yield* heldInThread(sessionId, deliveredAlone)

        // Once the turn is over, a delivery of its own: the edit with its version, never a
        // message of the user's.
        expect(agent.answers.prompts).toEqual([DELIVERY_MARKER, 'First turn.', DELIVERY_MARKER])
        const edit = deliveriesTo(agent)[1]
        expect([...(edit?.keys() ?? [])]).toEqual([contextUri('edit')])
        expect(edit?.get(contextUri('edit'))).toBe(
          `${HUMAN_EDITS}\n\n## scope · version ${scope?.version}\n\nCSV only.`,
        )
        const line = entries.find((entry) => entry.kind === 'context_delivery')
        expect(line).toMatchObject({
          role: 'hemera',
          body: 'Hemera handed the agent the human edits of scope.',
          state: null,
        })
        expect(JSON.parse(line?.payload ?? '{}')).toMatchObject({
          kind: 'edit',
          reached: 'delivery_prompt',
        })
        expect(usersOf(entries)).toEqual(['First turn.'])
        const provided = yield* (yield* AgentContext).provided(sessionId)
        expect(provided.map((one) => one.kind)).toContain('edit')
        expect((yield* specs.read(specId)).briefedAt).toBeGreaterThanOrEqual(scope?.updatedAt ?? 0)
      }),
    )
  })

  test('several edits made during a turn go as one edit delivery, each section once as it now reads', async () => {
    const gate = gated(1)
    const agent = fakeAgent({ steps: SHAPING, between: gate.between })

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const runtime = yield* AgentRuntime
        const running = yield* Effect.forkScoped(runtime.prompt(sessionId, 'First turn.'))
        yield* heldInThread(sessionId, (entries) =>
          entries.some((entry) => entry.role === 'agent' && entry.body.startsWith('Shaping')),
        )
        yield* write(humanOf(sessionId), specId, 'scope', 'CSV only.')
        yield* write(humanOf(sessionId), specId, 'problem', 'The Journal cannot leave Hemera.')
        const last = yield* write(humanOf(sessionId), specId, 'scope', 'CSV and JSON.')
        const version = (name: string) =>
          last.sections.find((section) => section.name === name)?.version

        gate.carryOn()
        yield* Fiber.join(running)
        yield* heldInThread(sessionId, deliveredAlone)

        expect(deliveriesTo(agent)).toHaveLength(2)
        expect(deliveriesTo(agent)[1]?.get(contextUri('edit'))).toBe(
          `${HUMAN_EDITS}\n\n## problem · version ${version('problem')}\n\nThe Journal cannot leave Hemera.\n\n## scope · version ${version('scope')}\n\nCSV and JSON.`,
        )
      }),
    )
  })

  test('an edit made between two turns goes before the next prompt, and the one after carries nothing', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const runtime = yield* AgentRuntime
        yield* runtime.prompt(sessionId, 'First turn.')
        const written = yield* write(humanOf(sessionId), specId, 'scope', 'CSV only.')
        const version = written.sections.find((section) => section.name === 'scope')?.version

        yield* runtime.prompt(sessionId, 'Second turn.')
        expect(agent.answers.prompts).toEqual([
          DELIVERY_MARKER,
          'First turn.',
          DELIVERY_MARKER,
          'Second turn.',
        ])
        expect(deliveriesTo(agent)[1]?.get(contextUri('edit'))).toContain(
          `## scope · version ${version}\n\nCSV only.`,
        )

        yield* runtime.prompt(sessionId, 'Third turn.')
        expect(agent.answers.prompts.slice(4)).toEqual(['Third turn.'])
      }),
    )
  })
})

describe('The Spec read says when its writer was last briefed', () => {
  test('briefedAt is null before the first turn, and set once the agent took one', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const specs = yield* Specs
        expect((yield* specs.read(specId)).briefedAt).toBe(null)

        yield* (yield* AgentRuntime).prompt(sessionId, 'First turn.')
        expect((yield* specs.read(specId)).briefedAt).toEqual(expect.any(Number))
      }),
    )
  })
})

describe('A delivery the agent did not take keeps the human edits for the next safe point', () => {
  test('a refused edit delivery says so, briefedAt stays, and the next prompt hands the edit over again', async () => {
    const gate = gated(1)
    let deliveries = 0
    const agent = fakeAgent({
      steps: SHAPING,
      between: gate.between,
      // The brief is taken; the delivery after it is refused, as a provider may refuse one.
      onPrompt: (text) => {
        if (text !== DELIVERY_MARKER) return
        deliveries += 1
        if (deliveries === 2) throw new Error('the provider refused the prompt')
      },
    })

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const runtime = yield* AgentRuntime
        const specs = yield* Specs
        const running = yield* Effect.forkScoped(runtime.prompt(sessionId, 'First turn.'))
        yield* heldInThread(sessionId, (entries) =>
          entries.some((entry) => entry.role === 'agent' && entry.body.startsWith('Shaping')),
        )
        yield* write(humanOf(sessionId), specId, 'scope', 'CSV only.')
        const briefedAt = (yield* specs.read(specId)).briefedAt
        gate.carryOn()
        yield* Fiber.join(running)

        const entries = yield* heldInThread(sessionId, (thread) =>
          thread.some((entry) => entry.kind === 'context_delivery' && entry.state === 'failed'),
        )
        expect(deliveries).toBe(2)
        expect(entries.find((entry) => entry.kind === 'context_delivery')?.body).toBe(
          'Not handed over, waiting for the next safe point: the human edits of scope.',
        )
        expect((yield* specs.read(specId)).briefedAt).toBe(briefedAt)

        yield* runtime.prompt(sessionId, 'Second turn.')
        expect(agent.answers.prompts.slice(-2)).toEqual([DELIVERY_MARKER, 'Second turn.'])
        expect(deliveriesTo(agent).at(-1)?.get(contextUri('edit'))).toContain('CSV only.')
        expect((yield* specs.read(specId)).briefedAt).not.toBe(briefedAt)
      }),
    )
  })
})

describe("A reader's brief says who writes", () => {
  test('a reading Session’s brief opens with the line naming the writer; the writer’s does not', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const specs = yield* Specs
        const runtime = yield* AgentRuntime
        const created = yield* specs.create({
          sessionId: (yield* aSession(workingDirectory)).id,
          type: 'feature',
          title: 'Export the journal',
        })
        const sessionId = created.session.id
        const specId = created.snapshot.spec.id
        yield* (yield* Sessions).rename(sessionId, created.session.version, 'Shape the export')
        const reader = (yield* specs.openSession({ specId, provider: 'claude' })).session
        const { spec } = yield* specs.read(specId)

        // Composed for each Session as its first delivery would be: the reader's own agent is
        // another process, which one fake cannot be twice.
        const read = (yield* briefFor(reader.id))?.brief?.block
        yield* runtime.prompt(sessionId, 'Carry on.')
        const written = deliveriesTo(agent)[0]?.get(contextUri('brief'))
        expect(readerLine(spec.key, 'Shape the export')).toBe(
          `You read ${spec.key}: the Session "Shape the export" writes it, and your writes to it are refused.`,
        )
        const opening = `${readerLine(spec.key, 'Shape the export')}\n\n${DEFINE_MISSION_BRIEF}`
        expect(read?.startsWith(opening)).toBe(true)
        expect(written?.startsWith(DEFINE_MISSION_BRIEF)).toBe(true)
      }),
    )
  })
})

describe('A Rework is briefed even when the focus is the phase last briefed', () => {
  test('a Spec finished, frozen and reworked between two turns is briefed on its new revision, back on shape', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const runtime = yield* AgentRuntime
        const specs = yield* Specs
        yield* runtime.prompt(sessionId, 'First turn.')

        // Everything happens before the next safe point: the three phases, the attestation, the
        // click and the Rework. The focus is back on shape, the phase the last brief was for.
        const ready = yield* frozen(specId, sessionId)
        yield* specs.reopen({
          specId,
          expectedRevisionId: ready.revision.id,
          reason: 'The export needs a second format.',
          sessionId,
        })
        yield* runtime.prompt(sessionId, 'Second turn.')

        expect(agent.answers.prompts).toEqual([
          DELIVERY_MARKER,
          'First turn.',
          DELIVERY_MARKER,
          'Second turn.',
        ])
        const reworked = deliveriesTo(agent)[1]?.get(contextUri('brief')) ?? ''
        expect(reworked.startsWith(`${DEFINE_MISSION_BRIEF}\n\n${PHASE_BRIEFS.shape}`)).toBe(true)
        expect(reworked).toContain('Status: draft · Revision: 2')
        const provided = yield* (yield* AgentContext).provided(sessionId)
        expect(provided.filter((one) => one.kind === 'brief').map((one) => one.path)).toEqual([
          'shape · revision 1 · writer',
          'shape · revision 2 · writer',
        ])
      }),
    )
  })
})

describe('An answer resolves the question and reaches the agent at the next safe point', () => {
  test('an answer delivery says what the user answered, never as a message of theirs, and the next prompt carries nothing more', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const runtime = yield* AgentRuntime
        const specs = yield* Specs
        yield* runtime.prompt(sessionId, 'First turn.')
        const raised = yield* specs.raiseQuestion(
          { kind: 'agent', sessionId },
          {
            specId,
            body: 'Which format?',
            blocking: true,
            phase: 'shape',
            options: [
              { id: 'csv', label: 'CSV', recommended: true },
              { id: 'json', label: 'JSON' },
            ],
          },
        )
        const questionId = raised.questions[0]?.id ?? ''
        yield* specs.answerQuestion({ specId, questionId, optionId: 'csv' })

        yield* runtime.prompt(sessionId, 'Second turn.')
        expect(agent.answers.prompts.slice(2)).toEqual([DELIVERY_MARKER, 'Second turn.'])
        const answer = deliveriesTo(agent)[1]
        expect([...(answer?.keys() ?? [])]).toEqual([contextUri('answer')])
        expect(answer?.get(contextUri('answer'))).toBe(
          `${ANSWERS}\n\n- Which format?\n  The user answered: CSV`,
        )
        // Never as a message of the user's: their one answer is the entry beside the question,
        // and the delivery is Hemera's line.
        const thread = yield* threadOf(sessionId)
        expect(thread.filter((entry) => entry.role === 'user').map((entry) => entry.kind)).toEqual([
          'message',
          'spec_answer',
          'message',
        ])
        expect(thread.find((entry) => entry.kind === 'context_delivery')).toMatchObject({
          role: 'hemera',
          body: 'Hemera handed the agent the answer to “Which format?”.',
        })

        yield* runtime.prompt(sessionId, 'Third turn.')
        expect(agent.answers.prompts.slice(4)).toEqual(['Third turn.'])
      }),
    )
  })
})

describe('A define Session whose agent lost its session is briefed again', () => {
  test('an agent that took its session back is not briefed again; one that lost it is', async () => {
    const opened = application(dataFolder)
    let sessionId = ''
    await opened(fakeAgent())(
      Effect.gen(function* () {
        sessionId = (yield* defining).sessionId
        yield* (yield* AgentRuntime).prompt(sessionId, 'First turn.')
      }),
    )

    // A relaunch whose agent carries its session on: it still holds its brief.
    const resumed = fakeAgent()
    await opened(resumed)(
      Effect.gen(function* () {
        yield* (yield* AgentRuntime).prompt(sessionId, 'Second turn.')
      }),
    )
    expect(resumed.answers.prompts).toEqual(['Second turn.'])

    // A relaunch whose agent can neither resume nor load: the conversation is rebuilt without
    // the brief, which is handed over again before the prompt.
    const lost = fakeAgent({ refusesResume: true, refusesLoad: true, continues: true })
    await opened(lost)(
      Effect.gen(function* () {
        yield* (yield* AgentRuntime).prompt(sessionId, 'Third turn.')
      }),
    )
    expect(lost.answers.prompts[0]).toBe(DELIVERY_MARKER)
    expect(deliveriesTo(lost)[0]?.get(contextUri('brief'))?.startsWith(DEFINE_MISSION_BRIEF)).toBe(
      true,
    )
    expect(lost.answers.prompts[1]?.endsWith('Third turn.')).toBe(true)
  })
})

describe('A sub-agent result arrives as internal', () => {
  test('a result queued during a turn is handed over once the turn is over, as an internal delivery and never as a human entry', async () => {
    const gate = gated(1)
    const agent = fakeAgent({ steps: SHAPING, between: gate.between })
    const result = 'Three call sites read the Journal: export.ts, feed.ts and search.ts.'

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId } = yield* defining
        const runtime = yield* AgentRuntime
        const running = yield* Effect.forkScoped(runtime.prompt(sessionId, 'First turn.'))
        yield* heldInThread(sessionId, (entries) =>
          entries.some((entry) => entry.role === 'agent' && entry.body.startsWith('Shaping')),
        )

        // A sub-agent of the Session's finishes while its turn runs: nothing goes out then.
        yield* runtime.deliverInternal(sessionId, result)
        expect(agent.answers.prompts).toEqual([DELIVERY_MARKER, 'First turn.'])

        gate.carryOn()
        yield* Fiber.join(running)
        const entries = yield* heldInThread(sessionId, deliveredAlone)

        // Between the two turns, a delivery of its own: the marker and the result, said internal.
        expect(agent.answers.prompts).toEqual([DELIVERY_MARKER, 'First turn.', DELIVERY_MARKER])
        expect(agent.answers.blocks[2]).toEqual([
          { type: 'text', text: DELIVERY_MARKER },
          {
            type: 'resource',
            resource: {
              uri: contextUri('internal'),
              mimeType: 'text/markdown',
              text: internalText(result),
            },
          },
        ])
        const line = entries.find((entry) => entry.kind === 'context_delivery')
        expect(line).toMatchObject({
          role: 'hemera',
          body: 'Hemera handed the agent the result of a sub-agent.',
          turnId: expect.any(String),
        })
        expect(JSON.parse(line?.payload ?? '{}')).toMatchObject({ kind: 'internal' })
        expect(usersOf(entries)).toEqual(['First turn.'])
        expect(entries.some((entry) => entry.body.includes(result))).toBe(false)
        const provided = yield* (yield* AgentContext).provided(sessionId)
        expect(provided.filter((one) => one.kind === 'internal')).toEqual([
          expect.objectContaining({ reached: 'delivery_prompt' }),
        ])

        // Handed over once: the next turn is the user's text alone.
        yield* runtime.prompt(sessionId, 'Second turn.')
        expect(agent.answers.prompts.slice(3)).toEqual(['Second turn.'])
      }),
    )
  })
})

describe('A free turn opens no Spec transaction', () => {
  test('the brief of a free Session is null before any transaction; a define one opens one', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const free = yield* aSession(workingDirectory)
        const { sessionId } = yield* defining
        const database = yield* Database
        let opened = 0
        // The database as the brief sees it, counting the transactions it is asked for.
        const counted = new Proxy(database, {
          get: (target, key) => {
            if (key === 'transaction') opened += 1
            return Reflect.get(target, key, target)
          },
        })
        const brief = (id: string) => briefFor(id).pipe(Effect.provideService(Database, counted))

        expect(yield* brief(free.id)).toBe(null)
        expect(opened).toBe(0)
        expect(yield* brief(sessionId)).not.toBe(null)
        expect(opened).toBe(1)
      }),
    )
  })
})

describe('A free Session gets no brief', () => {
  test('the prompt is the user’s text alone and the thread holds no mission_brief', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const session = yield* aSession(workingDirectory)
        yield* (yield* AgentRuntime).prompt(session.id, 'Just a question.')

        expect(agent.answers.prompts).toEqual(['Just a question.'])
        const entries = yield* threadOf(session.id)
        expect(entries.some((entry) => entry.kind === 'mission_brief')).toBe(false)
      }),
    )
  })
})
