/**
 * A Spec created, opened and written by `define` Sessions (design D7-01 … D7-04, D7-07,
 * D7-11 … D7-13).
 *
 * Each suite is named after the scenario of `Spec · spec`, `Spec · define-mission` and
 * `Spec · spec-panel` it covers. Every one runs on a data folder of its own under the temporary
 * directory, migrated by the migrations the application really ships.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import {
  InvalidAnswerError,
  InvalidSpecTitleError,
  SpecNotWritableError,
  StaleSectionError,
  TaskCycleError,
  contractOf,
} from '@hemera/core'
import { Journal } from '#engine/journal.ts'
import { Sessions } from '#engine/sessions.ts'
import { SpecNotices } from '#engine/specs/notices.ts'
import { SpecAnchorRefusedError } from '#engine/specs/write-right.ts'
import { Specs } from '#engine/specs/specs.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import {
  agentOf,
  draft,
  freeSession,
  frozen,
  humanOf,
  openedOn,
  project,
  write,
} from './specs-harness.ts'

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-specs-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

const opened = () => openedOn(dataFolder)

/** No Session has a turn running. */
const idle = () => false

describe('A Spec exists before any Workspace', () => {
  test('HEM-7 is a draft at revision 1 with no Workspace, and the counter is 8', async () => {
    const created = await opened()(
      Effect.gen(function* () {
        const atlas = yield* project('HEM', 7)
        const free = yield* freeSession(atlas.id)
        const { session, snapshot } = yield* (yield* Specs).create({
          sessionId: free.id,
          type: 'feature',
          title: '  Export the Journal  ',
        })
        const sql = yield* SqliteClient
        const counter = yield* sql<{ next_spec_number: number }>`
          SELECT next_spec_number FROM projects WHERE id = ${atlas.id}`
        const anchored = yield* sql<{ spec_id: string | null }>`
          SELECT spec_id FROM sessions WHERE id = ${session.id}`
        return { snapshot, session, counter, anchored }
      }),
    )

    const { snapshot, session } = created
    expect(snapshot.spec.key).toBe('HEM-7')
    expect(snapshot.spec.slug).toBe('export-the-journal')
    expect(snapshot.spec.status).toBe('draft')
    expect(snapshot.spec.workspaceId).toBeNull()
    expect(snapshot.spec.contentVersion).toBe(0)
    expect(snapshot.spec.writerSessionId).toBe(session.id)
    expect(snapshot.revision).toMatchObject({ number: 1, title: 'Export the Journal' })
    expect(created.counter[0]?.next_spec_number).toBe(8)
    expect(created.anchored[0]?.spec_id).toBe(snapshot.spec.id)
    // The type's contract, empty, and the protocol at its start (D7-06, D7-08).
    expect(
      snapshot.sections.map((section) => [section.name, section.body, section.version]),
    ).toEqual(contractOf('feature').map((name) => [name, '', 1]))
    expect(snapshot.phases.map((phase) => [phase.phase, phase.state])).toEqual([
      ['shape', 'open'],
      ['plan', 'pending'],
      ['decompose', 'pending'],
      ['prototype', 'unavailable'],
    ])
  })

  test('a Session that already defines a Spec creates none', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const atlas = yield* project()
        const specs = yield* Specs
        const free = yield* freeSession(atlas.id)
        yield* specs.create({ sessionId: free.id, type: 'bug', title: 'A bug' })
        const refused = yield* Effect.flip(
          specs.create({ sessionId: free.id, type: 'bug', title: 'Another bug' }),
        )
        return { refused, listed: yield* specs.list(atlas.id) }
      }),
    )
    expect(outcome.refused).toBeInstanceOf(SpecAnchorRefusedError)
    expect(outcome.refused.message).toContain('already defines a Spec')
    expect(outcome.listed.map((spec) => spec.title)).toEqual(['A bug'])
  })
})

describe('Accepting a proposal creates the Spec and switches the Session in one transaction', () => {
  test('the free Session becomes define and the writer, its thread unchanged', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const atlas = yield* project()
        const sessions = yield* Sessions
        const free = yield* freeSession(atlas.id)
        yield* sessions.append(free.id, 'The Journal should export to a file.')
        const before = yield* sessions.read(free.id)
        const created = yield* (yield* Specs).create({
          sessionId: free.id,
          type: 'feature',
          title: 'Export the Journal',
        })
        const sql = yield* SqliteClient
        const events = yield* sql<{ type: string; session_id: string }>`
          SELECT type, session_id FROM domain_events
          WHERE type IN ('spec.created', 'session.mission_set') ORDER BY sequence`
        return {
          free,
          created,
          before,
          after: yield* sessions.read(free.id),
          listed: yield* sessions.list(atlas.id),
          events,
        }
      }),
    )
    const { free, created } = outcome
    expect(created.session).toMatchObject({
      id: free.id,
      mission: 'define',
      specId: created.snapshot.spec.id,
      version: free.version + 1,
    })
    expect(created.snapshot.spec.writerSessionId).toBe(free.id)
    expect(outcome.listed[0]).toEqual(created.session)
    // The thread is the one it was: nothing is added, nothing rewritten (D7-07).
    expect(outcome.after.entries).toEqual(outcome.before.entries)
    expect(outcome.events).toEqual([
      { type: 'spec.created', session_id: free.id },
      { type: 'session.mission_set', session_id: free.id },
    ])
  })

  test('a refused creation leaves the Session free and mints no key', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const atlas = yield* project('HEM', 7)
        const free = yield* freeSession(atlas.id)
        const refused = yield* Effect.flip(
          (yield* Specs).create({ sessionId: free.id, type: 'feature', title: '   ' }),
        )
        const sql = yield* SqliteClient
        const counter = yield* sql<{ next_spec_number: number }>`
          SELECT next_spec_number FROM projects WHERE id = ${atlas.id}`
        const specs = yield* sql<{ id: string }>`SELECT id FROM specs`
        return { refused, session: (yield* (yield* Sessions).one(free.id)).session, counter, specs }
      }),
    )
    expect(outcome.refused).toBeInstanceOf(InvalidSpecTitleError)
    expect(outcome.session).toMatchObject({ mission: 'free', specId: null, version: 1 })
    expect(outcome.counter[0]?.next_spec_number).toBe(7)
    expect(outcome.specs).toEqual([])
  })
})

describe('Each type requires its own section', () => {
  test.each([
    ['bug', 'reproduction'],
    ['maintenance', 'invariants'],
    ['feature', 'behaviour'],
  ] as const)('a %s without %s fails on that section only', async (type, own) => {
    const failing = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* draft(type)
        for (const name of ['problem', 'expected_outcome', 'scope', 'verification'] as const) {
          yield* write(agentOf(session.id), specId, name, `The ${name}.`)
        }
        const gate = yield* (yield* Specs).gate(specId)
        return gate.failures
          .filter((failure) => failure.check === 'type_contract')
          .map((failure) => failure.target)
      }),
    )
    expect(failing).toEqual([own])
  })
})

describe('A cyclic dependency is refused', () => {
  test('nothing is written and the refusal names A → B → C → A', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* draft()
        const specs = yield* Specs
        const task = (title: string, dependsOn: string) => ({
          title,
          result: `${title} done`,
          type: 'code',
          executor: 'agent' as const,
          criteria: 'It works',
          dependsOn: [dependsOn],
          stories: [],
        })
        const refusal = yield* Effect.flip(
          specs.writeTasks(agentOf(session.id), {
            specId,
            tasks: [task('A', 'B'), task('B', 'C'), task('C', 'A')],
          }),
        )
        return { refusal, after: yield* specs.read(specId) }
      }),
    )
    expect(outcome.refusal).toBeInstanceOf(TaskCycleError)
    expect(outcome.refusal.message).toContain('A → B → C → A')
    expect(outcome.after.tasks).toEqual([])
    expect(outcome.after.dependencies).toEqual([])
    expect(outcome.after.spec.contentVersion).toBe(0)
  })
})

describe('Criteria keep their order', () => {
  test('a criterion moved between two others takes a new rank, and no other does', async () => {
    const { before, after } = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* draft()
        const specs = yield* Specs
        const agent = agentOf(session.id)
        const story = {
          title: 'Export',
          narrative: 'As a user, I export the Journal.',
          priority: null,
        }
        const written = yield* specs.writeStories(agent, {
          specId,
          stories: [{ ...story, criteria: ['one', 'two', 'three', 'four'] }],
        })
        const id = written.stories[0]?.id
        const moved = yield* specs.writeStories(agent, {
          specId,
          stories: [{ ...story, id, criteria: ['one', 'four', 'two', 'three'] }],
        })
        return { before: written.criteria, after: moved.criteria }
      }),
    )

    expect(after.map((criterion) => criterion.body)).toEqual(['one', 'four', 'two', 'three'])
    const rankOf = (list: typeof before, body: string) =>
      list.find((criterion) => criterion.body === body)
    for (const body of ['one', 'two', 'three']) {
      expect(rankOf(after, body)).toEqual(rankOf(before, body))
    }
    expect(rankOf(after, 'four')?.id).toBe(rankOf(before, 'four')?.id)
    expect(rankOf(after, 'four')?.rank).not.toBe(rankOf(before, 'four')?.rank)
  })
})

describe('A second Session reads but does not write', () => {
  test('its agent is refused until it takes the write right, then the first is refused', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session: drafted } = yield* draft()
        const specs = yield* Specs
        const sessions = yield* Sessions
        const first = yield* sessions.rename(drafted.id, drafted.version, 'Shape the export')
        const opening = yield* specs.openSession({ specId, provider: 'codex' })
        const second = yield* sessions.rename(
          opening.session.id,
          opening.session.version,
          'Read the export',
        )
        const joined = opening.snapshot
        const read = yield* specs.read(specId)
        const refusedSecond = yield* Effect.flip(
          write(agentOf(second.id), specId, 'problem', 'From the second Session.'),
        )
        yield* specs.transferWrite({ specId, sessionId: second.id }, idle)
        const passed = yield* write(agentOf(second.id), specId, 'problem', 'Now it writes.')
        const refusedFirst = yield* Effect.flip(
          write(agentOf(first.id), specId, 'scope', 'From the first Session.'),
        )
        return { first, second, joined, read, refusedSecond, passed, refusedFirst }
      }),
    )

    expect(outcome.second).toMatchObject({
      mission: 'define',
      specId: outcome.joined.spec.id,
      provider: 'codex',
      projectId: outcome.first.projectId,
    })
    expect(outcome.joined.spec.writerSessionId).toBe(outcome.first.id)
    expect(outcome.read.spec.writerSessionId).toBe(outcome.first.id)
    expect(outcome.refusedSecond).toBeInstanceOf(SpecNotWritableError)
    // The writer is named as the user knows it, by its title (D7-11).
    expect(outcome.refusedSecond.message).toContain('belongs to the Session "Shape the export"')
    expect(outcome.passed.spec.writerSessionId).toBe(outcome.second.id)
    expect(outcome.passed.sections.find((section) => section.name === 'problem')).toMatchObject({
      body: 'Now it writes.',
      author: 'agent',
      sessionId: outcome.second.id,
    })
    expect(outcome.refusedFirst).toBeInstanceOf(SpecNotWritableError)
    expect(outcome.refusedFirst.message).toContain('belongs to the Session "Read the export"')
  })
})

describe('Take over is refused while the writer runs a turn, and on a Spec that is not a draft', () => {
  test('a writer with a turn running keeps the right, and the refusal names it', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session: drafted } = yield* draft()
        const specs = yield* Specs
        const sessions = yield* Sessions
        yield* sessions.rename(drafted.id, drafted.version, 'Shape the export')
        const reader = (yield* specs.openSession({ specId, provider: 'codex' })).session
        const refused = yield* Effect.flip(
          specs.transferWrite(
            { specId, sessionId: reader.id },
            (sessionId) => sessionId === drafted.id,
          ),
        )
        return { drafted, refused, after: yield* specs.read(specId) }
      }),
    )
    expect(outcome.refused).toBeInstanceOf(SpecAnchorRefusedError)
    expect(outcome.refused.message).toBe(
      'The Session "Shape the export" is running a turn on HEM-1: take over once it ends.',
    )
    expect(outcome.after.spec.writerSessionId).toBe(outcome.drafted.id)
  })

  test('a ready Spec keeps its writer, and the refusal says only a draft moves', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session: drafted } = yield* draft()
        const specs = yield* Specs
        const reader = (yield* specs.openSession({ specId, provider: 'codex' })).session
        yield* frozen(specId, drafted.id)
        const refused = yield* Effect.flip(
          specs.transferWrite({ specId, sessionId: reader.id }, idle),
        )
        return { drafted, refused, after: yield* specs.read(specId) }
      }),
    )
    expect(outcome.refused).toBeInstanceOf(SpecAnchorRefusedError)
    expect(outcome.refused.message).toBe(
      "HEM-1 is ready: only a draft's write right is taken over.",
    )
    expect(outcome.after.spec.writerSessionId).toBe(outcome.drafted.id)
  })
})

describe('A human edit is recorded and reaches the agent', () => {
  test('the section carries author human and its Session, and the Journal says so', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* draft()
        const written = yield* (yield* Specs).writeSection(humanOf(session.id), {
          specId,
          name: 'scope',
          body: 'Only the current Project.',
          baseVersion: 1,
        })
        const sql = yield* SqliteClient
        const events = yield* sql<{ author: string; session_id: string; phase_id: string }>`
          SELECT author, session_id, phase_id FROM domain_events
          WHERE type = 'spec.section_written' AND spec_id = ${specId}`
        return { session, written, events }
      }),
    )
    expect(outcome.written.sections.find((section) => section.name === 'scope')).toMatchObject({
      body: 'Only the current Project.',
      version: 2,
      author: 'human',
      sessionId: outcome.session.id,
    })
    expect(outcome.written.spec.contentVersion).toBe(1)
    expect(outcome.events).toEqual([
      { author: 'human', session_id: outcome.session.id, phase_id: 'shape' },
    ])
  })
})

describe("A conflict keeps the human's text", () => {
  test('the stale save is refused, the buffer survives a restart, and applying it clears it', async () => {
    const conflict = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* draft()
        const specs = yield* Specs
        yield* specs.buffers.save({ specId, name: 'scope', body: 'Mine.', baseVersion: 1 })
        yield* specs.writeSection(agentOf(session.id), {
          specId,
          name: 'scope',
          body: "The agent's.",
          baseVersion: 1,
        })
        const refusal = yield* Effect.flip(
          specs.writeSection(humanOf(session.id), {
            specId,
            name: 'scope',
            body: 'Mine.',
            baseVersion: 1,
          }),
        )
        return { specId, session, refusal }
      }),
    )
    expect(conflict.refusal).toBeInstanceOf(StaleSectionError)
    const { specId, session } = conflict

    const afterRestart = await opened()(
      Effect.gen(function* () {
        const specs = yield* Specs
        const kept = yield* specs.buffers.read(specId)
        const applied = yield* specs.writeSection(humanOf(session.id), {
          specId,
          name: 'scope',
          body: 'Mine.',
          baseVersion: 2,
        })
        return { kept, applied, left: yield* specs.buffers.read(specId) }
      }),
    )
    expect(afterRestart.kept).toMatchObject([{ name: 'scope', body: 'Mine.', baseVersion: 1 }])
    expect(afterRestart.applied.sections.find((section) => section.name === 'scope')).toMatchObject(
      { body: 'Mine.', version: 3, author: 'human' },
    )
    expect(afterRestart.left).toEqual([])
  })
})

/** A question with two options, raised by the writer's agent. */
const asked = Effect.gen(function* () {
  const { specId, session } = yield* draft()
  const raised = yield* (yield* Specs).raiseQuestion(agentOf(session.id), {
    specId,
    body: 'Which format?',
    blocking: true,
    phase: 'shape',
    options: [
      { id: 'csv', label: 'CSV', recommended: true },
      { id: 'json', label: 'JSON' },
    ],
  })
  const question = raised.questions[0]
  if (question === undefined) return yield* Effect.die('a question raised and not kept')
  return { specId, session, question }
})

describe('A question raised during a turn is asked in the chat', () => {
  test('the question is kept in the Spec and written as a Hemera entry of its Session', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { session, question } = yield* asked
        return { question, thread: yield* (yield* Sessions).read(session.id) }
      }),
    )
    const { question } = outcome
    expect(question).toMatchObject({
      body: 'Which format?',
      blocking: true,
      phase: 'shape',
      raisedBy: 'agent',
      options: [
        { id: 'csv', label: 'CSV', recommended: true },
        { id: 'json', label: 'JSON' },
      ],
      answer: null,
      resolvedAt: null,
    })
    const entry = outcome.thread.entries.at(-1)
    expect(entry).toMatchObject({
      role: 'hemera',
      kind: 'spec_question',
      body: 'Which format?',
      correlationId: question.id,
    })
    expect(JSON.parse(entry?.payload ?? '{}')).toEqual({
      id: question.id,
      body: 'Which format?',
      blocking: true,
      phase: 'shape',
      options: question.options,
      answer: null,
    })
  })

  test('the window hears of the entry and of the Spec once it is written', async () => {
    const heard: string[] = []
    const listening = Layer.succeed(SpecNotices, {
      changed: (specId) => heard.push(`changed ${specId}`),
      wrote: (sessionId, entry) => heard.push(`wrote ${entry.kind} in ${sessionId}`),
    })
    const { specId, session } = await openedOn(dataFolder, listening)(asked)
    expect(heard.slice(-2)).toEqual([`changed ${specId}`, `wrote spec_question in ${session.id}`])
  })

  test('a question raised with no Session is kept in the Spec only', async () => {
    const thread = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* draft()
        yield* (yield* Specs).raiseQuestion(
          { kind: 'human', sessionId: null },
          { specId, body: 'Which size?', blocking: false, phase: null, options: [] },
        )
        return yield* (yield* Sessions).read(session.id)
      }),
    )
    expect(thread.entries).toEqual([])
  })
})

describe('An answer resolves the question and is written beside it in the chat', () => {
  test('an option chosen resolves the question and writes the answer after it', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session, question } = yield* asked
        const answered = yield* (yield* Specs).answerQuestion({
          specId,
          questionId: question.id,
          optionId: 'json',
        })
        return { question, answered, thread: yield* (yield* Sessions).read(session.id) }
      }),
    )
    const resolved = outcome.answered.questions[0]
    expect(resolved?.answer).toEqual({ optionId: 'json', text: null })
    expect(resolved?.resolvedAt).not.toBeNull()
    expect(outcome.answered.spec.contentVersion).toBe(2)
    const [asking, answer] = outcome.thread.entries
    expect(asking?.kind).toBe('spec_question')
    expect(answer).toMatchObject({
      role: 'user',
      kind: 'spec_answer',
      body: 'JSON',
      correlationId: outcome.question.id,
    })
    expect(JSON.parse(answer?.payload ?? '{}')).toEqual({
      questionId: outcome.question.id,
      optionId: 'json',
    })
  })

  test('a text of the human’s own is an answer too', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session, question } = yield* asked
        const answered = yield* (yield* Specs).answerQuestion({
          specId,
          questionId: question.id,
          text: 'Both, CSV first',
        })
        return { answered, thread: yield* (yield* Sessions).read(session.id) }
      }),
    )
    expect(outcome.answered.questions[0]?.answer).toEqual({
      optionId: null,
      text: 'Both, CSV first',
    })
    const answer = outcome.thread.entries.at(-1)
    expect(answer?.body).toBe('Both, CSV first')
    expect(JSON.parse(answer?.payload ?? '{}')).toMatchObject({ text: 'Both, CSV first' })
  })

  test('neither, both, an option not offered and a second answer are refused', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, question } = yield* asked
        const specs = yield* Specs
        const questionId = question.id
        const neither = yield* Effect.flip(specs.answerQuestion({ specId, questionId }))
        const both = yield* Effect.flip(
          specs.answerQuestion({ specId, questionId, optionId: 'csv', text: 'CSV' }),
        )
        const unknown = yield* Effect.flip(
          specs.answerQuestion({ specId, questionId, optionId: 'xml' }),
        )
        const untouched = yield* specs.read(specId)
        yield* specs.answerQuestion({ specId, questionId, optionId: 'csv' })
        const twice = yield* Effect.flip(
          specs.answerQuestion({ specId, questionId, optionId: 'json' }),
        )
        return { neither, both, unknown, twice, untouched }
      }),
    )
    for (const refusal of [outcome.neither, outcome.both, outcome.unknown, outcome.twice]) {
      expect(refusal).toBeInstanceOf(InvalidAnswerError)
    }
    expect(outcome.twice.message).toContain('already answered')
    expect(outcome.untouched.questions[0]?.resolvedAt).toBeNull()
  })
})

describe('The Journal shows each step', () => {
  test("a Spec's Journal lists its steps with their Session and phase, and no other Spec's", async () => {
    const journal = await opened()(
      Effect.gen(function* () {
        const { specId, session, project: atlas } = yield* draft()
        yield* write(humanOf(session.id), specId, 'scope', 'Only the current Project.')
        yield* frozen(specId, session.id)
        const other = yield* freeSession(atlas.id)
        yield* (yield* Specs).create({ sessionId: other.id, type: 'bug', title: 'Another' })
        const page = yield* (yield* Journal).read({ projectId: atlas.id, specId, limit: 200 })
        return { entries: page.entries.toReversed(), session, specId }
      }),
    )
    const { entries } = journal

    expect(
      entries.every((entry) => entry.specId === journal.specId && entry.entityKind === 'spec'),
    ).toBe(true)
    const types = entries.map((entry) => entry.type)
    for (const step of [
      'spec.created',
      'spec.phase_opened',
      'spec.section_written',
      'spec.phase_declared',
      'spec.phase_finished',
      'spec.stories_written',
      'spec.tasks_written',
      'spec.ready',
    ]) {
      expect(types).toContain(step)
    }
    expect(types.at(0)).toBe('spec.created')
    expect(types.at(-1)).toBe('spec.ready')
    expect(entries.at(-1)).toMatchObject({ author: 'human', sessionId: journal.session.id })
    const human = entries.find(
      (entry) => entry.type === 'spec.section_written' && entry.author === 'human',
    )
    expect(human).toMatchObject({ sessionId: journal.session.id, phaseId: 'shape' })
    const decomposed = entries.find(
      (entry) => entry.type === 'spec.phase_finished' && entry.phaseId === 'decompose',
    )
    expect(decomposed).toMatchObject({ author: 'agent', sessionId: journal.session.id })
    expect(entries.every((entry) => entry.revisionId !== null)).toBe(true)
  })
})

describe('The Spec suites run on a temporary data folder', () => {
  test('the data folder this suite wrote to is under the temporary directory it made', () => {
    expect(dataFolder.startsWith(tmpdir())).toBe(true)
  })
})
