/**
 * Only the current draft is writable; Rework copies it whole (design D7-04, D7-05).
 *
 * Each suite is named after the scenario of `Spec · revisions` it covers, on a data
 * folder of its own under the temporary directory, migrated by the shipped migrations.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'

import { type SpecSnapshot, SpecNotWritableError, writable } from '@hemera/core'
import { ReopenRefusedError } from '#engine/specs/revisions.ts'
import { Sessions } from '#engine/sessions.ts'
import { Specs } from '#engine/specs/specs.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import { agentOf, draft, frozen, openedOn, write } from './specs-harness.ts'

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-specs-revisions-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

const opened = () => openedOn(dataFolder)

/** A `ready` Spec with an open question, at revision 1. */
const ready = Effect.gen(function* () {
  const { specId, session } = yield* draft()
  const specs = yield* Specs
  yield* specs.raiseQuestion(agentOf(session.id), {
    specId,
    body: 'Which encoding?',
    blocking: false,
    phase: 'plan',
    options: [
      { id: 'utf8', label: 'UTF-8', recommended: true },
      { id: 'latin1', label: 'Latin-1' },
    ],
  })
  const snapshot = yield* frozen(specId, session.id)
  return { specId, session, snapshot }
})

/** What a revision holds, without the identifiers a copy renews. */
function content(snapshot: SpecSnapshot) {
  const titleOf = new Map(snapshot.tasks.map((task) => [task.id, task.title]))
  const storyOf = new Map(snapshot.stories.map((story) => [story.id, story.title]))
  return {
    sections: snapshot.sections.map(({ name, body, version, author, sessionId }) => ({
      name,
      body,
      version,
      author,
      sessionId,
    })),
    stories: snapshot.stories.map(({ title, narrative, priority, rank }) => ({
      title,
      narrative,
      priority,
      rank,
    })),
    criteria: snapshot.criteria.map(({ storyId, body, rank }) => [
      storyOf.get(storyId),
      body,
      rank,
    ]),
    tasks: snapshot.tasks.map(({ title, result, type, executor, criteria, rank }) => ({
      title,
      result,
      type,
      executor,
      criteria,
      rank,
    })),
    dependencies: snapshot.dependencies.map(({ taskId, dependsOnId }) => [
      titleOf.get(taskId),
      titleOf.get(dependsOnId),
    ]),
    taskStories: snapshot.taskStories.map(({ taskId, storyId }) => [
      titleOf.get(taskId),
      storyOf.get(storyId),
    ]),
    questions: snapshot.questions.map(({ body, blocking, phase, raisedBy, options, answer }) => ({
      body,
      blocking,
      phase,
      raisedBy,
      options,
      answer,
    })),
  }
}

/** Every identifier a revision's rows carry. */
function identifiers(snapshot: SpecSnapshot): string[] {
  return [
    ...snapshot.sections,
    ...snapshot.stories,
    ...snapshot.criteria,
    ...snapshot.tasks,
    ...snapshot.questions,
    ...snapshot.phases,
  ].map((row) => row.id)
}

describe('A write on a frozen Spec is refused and does not reopen it', () => {
  test('the agent is told why, and the Spec stays ready on the same revision', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session, snapshot } = yield* ready
        const refusal = yield* Effect.flip(
          write(agentOf(session.id), specId, 'problem', 'A late change.'),
        )
        const specs = yield* Specs
        return {
          snapshot,
          refusal,
          after: yield* specs.read(specId),
          revisions: yield* specs.revisions(specId),
        }
      }),
    )
    expect(outcome.refusal).toBeInstanceOf(SpecNotWritableError)
    expect(outcome.refusal.message).toContain('is ready')
    expect(outcome.after.spec.status).toBe('ready')
    expect(outcome.after.spec.currentRevisionId).toBe(outcome.snapshot.revision.id)
    expect(outcome.after).toEqual(outcome.snapshot)
    expect(outcome.revisions).toHaveLength(1)
  })
})

describe('Rework creates a complete new draft', () => {
  test('revision 2 copies every row under new ids in the same order; revision 1 is untouched', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session, snapshot } = yield* ready
        const specs = yield* Specs
        const reworked = yield* specs.reopen({
          specId,
          expectedRevisionId: snapshot.revision.id,
          reason: 'Add a CSV option',
          sessionId: session.id,
        })
        const sql = yield* SqliteClient
        const reopened = yield* sql<{ session_id: string | null }>`
          SELECT session_id FROM domain_events WHERE type = 'spec.reopened'`
        return {
          snapshot,
          reworked,
          first: yield* specs.read(specId, 1),
          reopened: reopened.map((row) => row.session_id),
          sessionId: session.id,
        }
      }),
    )

    const { snapshot, reworked, first } = outcome
    expect(outcome.reopened).toEqual([outcome.sessionId])
    expect(reworked.spec.status).toBe('draft')
    expect(reworked.spec.currentRevisionId).toBe(reworked.revision.id)
    expect(reworked.revision).toMatchObject({
      number: 2,
      changeReason: 'Add a CSV option',
      createdBy: 'human',
      attestedContentVersion: null,
    })
    expect(content(reworked)).toEqual(content(snapshot))
    expect(reworked.dependencies).toHaveLength(1)
    expect(reworked.questions).toHaveLength(1)
    const renewed = new Set(identifiers(snapshot))
    expect(identifiers(reworked).some((id) => renewed.has(id))).toBe(false)
    // The phases keep what they said, and are stale until declared again (Decided 4).
    expect(reworked.phases.map((phase) => [phase.phase, phase.state, phase.summary])).toEqual([
      ['shape', 'stale', 'Shaped.'],
      ['plan', 'stale', 'Planned.'],
      ['decompose', 'stale', 'Decomposed.'],
      ['prototype', 'unavailable', null],
    ])
    // Revision 1 reads exactly as it was frozen, bar the Spec that moved on.
    expect({ ...first, spec: null }).toEqual({ ...snapshot, spec: null })
  })

  test('a Rework without a reason is a Rework all the same', async () => {
    const reworked = await opened()(
      Effect.gen(function* () {
        const { specId, snapshot } = yield* ready
        return yield* (yield* Specs).reopen({ specId, expectedRevisionId: snapshot.revision.id })
      }),
    )
    expect(reworked.spec.status).toBe('draft')
    expect(reworked.revision).toMatchObject({ number: 2, changeReason: null })
  })
})

describe('Rework asks the open questions again in the thread', () => {
  test('the copied question is asked under its new id, and answered there', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session, snapshot } = yield* ready
        const specs = yield* Specs
        const reworked = yield* specs.reopen({ specId, expectedRevisionId: snapshot.revision.id })
        const copied = reworked.questions[0]
        if (copied === undefined) return yield* Effect.die('the open question was not copied')
        const asked = yield* (yield* Sessions).read(session.id)
        yield* specs.answerQuestion({ specId, questionId: copied.id, optionId: 'utf8' })
        const answered = yield* (yield* Sessions).read(session.id)
        return { old: snapshot.questions[0], copied, asked, answered }
      }),
    )
    const questions = outcome.asked.entries.filter((entry) => entry.kind === 'spec_question')
    // The first block names the frozen revision's question; the second the draft's.
    expect(questions.map((entry) => entry.correlationId)).toEqual([
      outcome.old?.id,
      outcome.copied.id,
    ])
    expect(JSON.parse(questions[1]?.payload ?? '{}')).toEqual({
      id: outcome.copied.id,
      body: 'Which encoding?',
      blocking: false,
      phase: 'plan',
      options: outcome.copied.options,
      answer: null,
    })
    const answer = outcome.answered.entries.at(-1)
    expect(answer).toMatchObject({
      kind: 'spec_answer',
      body: 'UTF-8',
      correlationId: outcome.copied.id,
    })
  })
})

describe('A write to an old revision is refused', () => {
  test('revision 1 is not writable while revision 2 is current, and stays unchanged', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session, snapshot } = yield* ready
        const specs = yield* Specs
        yield* specs.reopen({ specId, expectedRevisionId: snapshot.revision.id, reason: 'Rework' })
        const old = yield* specs.read(specId, 1)
        const refusal = writable(old.spec, old.revision, agentOf(session.id), null)
        const written = yield* write(agentOf(session.id), specId, 'problem', 'The new problem.')
        return { snapshot, refusal, written, old: yield* specs.read(specId, 1) }
      }),
    )
    expect(outcome.refusal).toContain('revision 1')
    expect(outcome.written.revision.number).toBe(2)
    expect({ ...outcome.old, spec: null }).toEqual({ ...outcome.snapshot, spec: null })
  })
})

describe('A stale reopening is refused', () => {
  test('two reopenings on the same revision make one draft', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, snapshot } = yield* ready
        const specs = yield* Specs
        const asked = { specId, expectedRevisionId: snapshot.revision.id, reason: 'Rework' }
        const first = yield* specs.reopen(asked)
        const second = yield* Effect.flip(specs.reopen(asked))
        return { first, second, revisions: yield* specs.revisions(specId) }
      }),
    )
    expect(outcome.first.revision.number).toBe(2)
    expect(outcome.second).toBeInstanceOf(ReopenRefusedError)
    expect(outcome.second.message).toContain('A stale reopening is refused')
    expect(outcome.revisions.map((revision) => revision.number)).toEqual([1, 2])
  })
})

describe('The revision suites run on a temporary data folder', () => {
  test('the data folder this suite wrote to is under the temporary directory it made', () => {
    expect(dataFolder.startsWith(tmpdir())).toBe(true)
  })
})
