/**
 * The mission brief of a `define` turn, on the fake provider (design D7-09).
 *
 * A turn really happens: the runtime starts the fake agent, sends it the prompt and writes the
 * thread, so what is asserted is what the agent received and what the thread holds. Each suite
 * is named after the scenario of `Spec · define-mission` it covers.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Fiber } from 'effect'

import { DEFINE_MISSION_BRIEF, PHASE_BRIEFS, readerLine } from '@hemera/core'
import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime, NoNotices } from '#engine/agents/runtime.ts'
import { Sessions } from '#engine/sessions.ts'
import { briefFor } from '#engine/specs/brief.ts'
import { Specs } from '#engine/specs/specs.ts'
import {
  application,
  aSession,
  failing,
  gated,
  heldInThread,
  machine,
  threadOf,
} from './application.ts'

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

describe('The brief is part of the turn, never a human message', () => {
  test('the prompt opens with the mission, the shape brief and the Spec; the thread holds one user entry and one folded brief', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const snapshot = yield* (yield* Specs).read(specId)
        yield* (yield* AgentRuntime).prompt(sessionId, 'Let us shape the export.')

        const [sent] = agent.answers.prompts
        expect(agent.answers.prompts).toHaveLength(1)
        expect(sent?.startsWith(`${DEFINE_MISSION_BRIEF}\n\n${PHASE_BRIEFS.shape}`)).toBe(true)
        expect(sent).toContain(`# ${snapshot.spec.key} · Export the journal`)
        for (const section of snapshot.sections) {
          expect(sent).toContain(`## ${section.name}\n<!-- version: ${section.version} -->`)
        }
        expect(sent?.endsWith('\n\nLet us shape the export.')).toBe(true)

        const entries = yield* threadOf(sessionId)
        const users = entries.filter((entry) => entry.role === 'user')
        expect(users.map((entry) => entry.body)).toEqual(['Let us shape the export.'])
        const briefs = entries.filter((entry) => entry.kind === 'mission_brief')
        expect(briefs).toHaveLength(1)
        expect(briefs[0]).toMatchObject({ role: 'hemera' })
        expect(JSON.parse(briefs[0]?.payload ?? '{}')).toEqual({ phase: 'shape' })
        expect(sent?.startsWith(briefs[0]?.body ?? '\u0000')).toBe(true)
      }),
    )
  })
})

describe('A human edit is recorded and reaches the agent', () => {
  test('a section saved while the agent is answering reaches nothing during the turn, and the next brief lists it', async () => {
    const gate = gated(1)
    const agent = fakeAgent({
      steps: [
        { does: 'says', text: 'Shaping the export' },
        { does: 'says', text: ' and carrying on.' },
      ],
      between: gate.between,
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

        // The turn is running, held after the agent's first words: the user saves `scope`.
        const before = yield* specs.read(specId)
        const scope = before.sections.find((section) => section.name === 'scope')
        const written = yield* specs.writeSection(
          { kind: 'human', sessionId },
          { specId, name: 'scope', body: 'CSV only.', baseVersion: scope?.version ?? 0 },
        )
        expect(written.sections.find((section) => section.name === 'scope')).toMatchObject({
          author: 'human',
          sessionId,
        })
        // Nothing was sent to the agent while its turn runs: the one prompt is the turn's own.
        expect(agent.answers.prompts).toHaveLength(1)
        expect(agent.answers.prompts[0]).not.toContain('CSV only.')

        gate.carryOn()
        yield* Fiber.join(running)
        expect(agent.answers.prompts).toHaveLength(1)

        yield* runtime.prompt(sessionId, 'Second turn.')
        const second = agent.answers.prompts[1] ?? ''
        expect(second.slice(second.indexOf(HUMAN_EDITS))).toContain('## scope · version')
        expect(second.slice(second.indexOf(HUMAN_EDITS))).toContain('CSV only.')
      }),
    )
  })

  test('the next turn’s brief lists the human edit with its version, and the one after lists nothing', async () => {
    const agent = fakeAgent()

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const runtime = yield* AgentRuntime
        const specs = yield* Specs
        yield* runtime.prompt(sessionId, 'First turn.')
        expect(agent.answers.prompts[0]).not.toContain(HUMAN_EDITS)

        const before = yield* specs.read(specId)
        const scope = before.sections.find((section) => section.name === 'scope')
        const written = yield* specs.writeSection(
          { kind: 'human', sessionId },
          { specId, name: 'scope', body: 'CSV only.', baseVersion: scope?.version ?? 0 },
        )
        const version = written.sections.find((section) => section.name === 'scope')?.version

        yield* runtime.prompt(sessionId, 'Second turn.')
        const second = agent.answers.prompts[1] ?? ''
        const edits = second.slice(second.indexOf(HUMAN_EDITS))
        expect(second).toContain(HUMAN_EDITS)
        expect(edits).toContain(`## scope · version ${version}\n\nCSV only.`)

        yield* runtime.prompt(sessionId, 'Third turn.')
        expect(agent.answers.prompts[2]).not.toContain(HUMAN_EDITS)
      }),
    )
  })
})

describe('A failed turn keeps the human edits for the next brief', () => {
  test('the brief of a turn the agent never took is composed again, the human edit still in it', async () => {
    const storage = failing()
    const agent = fakeAgent()

    await application(dataFolder, NoNotices, machine, undefined, storage)(agent)(
      Effect.gen(function* () {
        const { sessionId, specId } = yield* defining
        const runtime = yield* AgentRuntime
        const specs = yield* Specs
        yield* runtime.prompt(sessionId, 'First turn.')

        const before = yield* specs.read(specId)
        const scope = before.sections.find((section) => section.name === 'scope')
        yield* specs.writeSection(
          { kind: 'human', sessionId },
          { specId, name: 'scope', body: 'CSV only.', baseVersion: scope?.version ?? 0 },
        )

        // The second turn fails before the agent is given anything: its brief cannot be written.
        storage.nextWrite((entry) => entry.kind === 'mission_brief')
        yield* Effect.flip(runtime.prompt(sessionId, 'Second turn.'))
        expect(agent.answers.prompts).toHaveLength(1)

        yield* runtime.prompt(sessionId, 'Third turn.')
        const third = agent.answers.prompts[1] ?? ''
        expect(third).toContain(HUMAN_EDITS)
        expect(third.slice(third.indexOf(HUMAN_EDITS))).toContain('CSV only.')
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

        // Composed for each Session as its next turn would be: the reader's own agent is another
        // process, which one fake cannot be twice.
        const read = (yield* briefFor(reader.id))?.block
        yield* runtime.prompt(sessionId, 'Carry on.')
        const [written] = agent.answers.prompts
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

const ANSWERS = '# Answers since your last turn'

describe('An answer resolves the question and reaches the agent with the next turn', () => {
  test('the next brief says what the user answered, and the one after says nothing more', async () => {
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
        const thread = yield* threadOf(sessionId)

        yield* runtime.prompt(sessionId, 'Second turn.')
        const second = agent.answers.prompts[1] ?? ''
        expect(second.slice(second.indexOf(ANSWERS))).toContain(
          '- Which format?\n  The user answered: CSV',
        )
        // Never as a message of the user's: their one answer is the entry beside the question.
        expect(thread.filter((entry) => entry.role === 'user').map((entry) => entry.kind)).toEqual([
          'message',
          'spec_answer',
        ])

        yield* runtime.prompt(sessionId, 'Third turn.')
        expect(agent.answers.prompts[2]).not.toContain(ANSWERS)
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
