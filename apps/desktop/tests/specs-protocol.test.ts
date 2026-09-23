/**
 * The `define` protocol persisted per revision, and the ready gate (design D7-08, D7-10).
 *
 * Each suite is named after the scenario of `Spec · define-mission` and `Spec · ready-gate` it
 * covers, on a data folder of its own under the temporary directory, migrated by the shipped
 * migrations. A second `opened()` on the same folder is a restart.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'

import { focusOf } from '@hemera/core'
import { ReadyRefusedError } from '#engine/specs/gate.ts'
import { Specs } from '#engine/specs/specs.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import { agentOf, complete, draft, openedOn, shaped, write } from './specs-harness.ts'

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-specs-protocol-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

const opened = () => openedOn(dataFolder)

/** A draft whose writer's agent wrote and attested the whole contract. */
const attested = Effect.gen(function* () {
  const { specId, session } = yield* draft()
  const snapshot = yield* complete(specId, session.id)
  return { specId, session, snapshot }
})

describe('Phases survive a restart', () => {
  test('with shape finished and plan open, a relaunch finds the same phases, focus and draft', async () => {
    const before = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* draft()
        yield* shaped(specId, session.id)
        return yield* (yield* Specs).declarePhase(specId, session.id, 'shape', {
          summary: 'A feature exporting the Journal.',
          assumptions: ['CSV first'],
        })
      }),
    )
    expect(before.phases.map((phase) => [phase.phase, phase.state])).toEqual([
      ['shape', 'finished'],
      ['plan', 'open'],
      ['decompose', 'pending'],
      ['prototype', 'unavailable'],
    ])
    expect(focusOf(before.phases)).toBe('plan')

    const after = await opened()(
      Effect.gen(function* () {
        return yield* (yield* Specs).read(before.spec.id)
      }),
    )
    expect(after).toEqual(before)
    expect(focusOf(after.phases)).toBe('plan')
    expect(after.phases.find((phase) => phase.phase === 'shape')).toMatchObject({
      summary: 'A feature exporting the Journal.',
      assumptions: ['CSV first'],
    })
  })
})

describe('A new shaping makes the plan stale', () => {
  test('problem written after shape, plan and decompose finished: all three stale, and gated', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* attested
        const written = yield* write(agentOf(session.id), specId, 'problem', 'A sharper problem.')
        const gate = yield* (yield* Specs).gate(specId)
        const sql = yield* SqliteClient
        const stale = yield* sql<{ phase_id: string }>`
          SELECT phase_id FROM domain_events
          WHERE type = 'spec.phase_stale' AND spec_id = ${specId} ORDER BY sequence`
        return { written, gate, stale }
      }),
    )
    expect(outcome.written.phases.map((phase) => [phase.phase, phase.state])).toEqual([
      ['shape', 'stale'],
      ['plan', 'stale'],
      ['decompose', 'stale'],
      ['prototype', 'unavailable'],
    ])
    const phases = outcome.gate.failures.filter((failure) => failure.check === 'phase')
    expect(phases.map((failure) => failure.target)).toEqual(['shape', 'plan', 'decompose'])
    expect(outcome.stale.map((row) => row.phase_id)).toEqual(['shape', 'plan', 'decompose'])
  })
})

describe('The button is offered only when the checks pass', () => {
  test('a complete, declared and attested draft has an empty gate, and is frozen by the click', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session, snapshot } = yield* attested
        const specs = yield* Specs
        const gate = yield* specs.gate(specId)
        const readied = yield* specs.markReady({
          specId,
          expectedRevisionId: snapshot.revision.id,
          expectedContentVersion: gate.contentVersion,
          sessionId: session.id,
        })
        return { gate, readied }
      }),
    )
    expect(outcome.gate.failures).toEqual([])
    expect(outcome.readied.spec.status).toBe('ready')
  })

  test('a change lists the check it breaks', async () => {
    const failures = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* attested
        const specs = yield* Specs
        yield* specs.writeStories(agentOf(session.id), {
          specId,
          stories: [
            ...(yield* specs.read(specId)).stories.map((story) => ({
              id: story.id,
              title: story.title,
              narrative: story.narrative,
              priority: story.priority,
              criteria: ['A file is written', 'It opens in a spreadsheet'],
            })),
            { title: 'Import', narrative: 'As a user, I import.', priority: null, criteria: [] },
          ],
        })
        yield* specs.attest(specId, session.id)
        return (yield* specs.gate(specId)).failures
      }),
    )
    expect(failures.map((failure) => [failure.check, failure.message])).toEqual([
      ['coverage', 'the story "Import" has no acceptance criterion'],
      ['coverage', 'no task covers the story "Import"'],
    ])
  })
})

describe('An obsolete request is refused', () => {
  test('a click made on an older content version leaves the Spec in draft', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session, snapshot } = yield* attested
        const specs = yield* Specs
        const shown = yield* specs.gate(specId)
        yield* specs.raiseQuestion(agentOf(session.id), {
          specId,
          body: 'Which encoding?',
          blocking: false,
          phase: null,
          options: [],
        })
        const refusal = yield* Effect.flip(
          specs.markReady({
            specId,
            expectedRevisionId: snapshot.revision.id,
            expectedContentVersion: shown.contentVersion,
            sessionId: session.id,
          }),
        )
        return { refusal, after: yield* specs.read(specId) }
      }),
    )
    expect(outcome.refusal).toBeInstanceOf(ReadyRefusedError)
    expect(outcome.refusal.message).toContain('changed since its gate was shown')
    expect(outcome.after.spec.status).toBe('draft')
  })
})

describe('An attestation alone does not freeze', () => {
  test('attested with a blocking question open, the gate lists it and the Spec stays draft', async () => {
    const outcome = await opened()(
      Effect.gen(function* () {
        const { specId, session } = yield* attested
        const specs = yield* Specs
        yield* specs.raiseQuestion(agentOf(session.id), {
          specId,
          body: 'Is the export signed?',
          blocking: true,
          phase: 'plan',
          options: [],
        })
        const reattested = yield* specs.attest(specId, session.id)
        const gate = yield* specs.gate(specId)
        const refusal = yield* Effect.flip(
          specs.markReady({
            specId,
            expectedRevisionId: reattested.revision.id,
            expectedContentVersion: gate.contentVersion,
            sessionId: session.id,
          }),
        )
        return { gate, refusal, after: yield* specs.read(specId) }
      }),
    )
    expect(outcome.gate.failures.map((failure) => failure.check)).toEqual(['blocking_question'])
    expect(outcome.refusal).toBeInstanceOf(ReadyRefusedError)
    expect(outcome.refusal.message).toContain('Is the export signed?')
    expect(outcome.after.spec.status).toBe('draft')
  })
})

describe('The unavailable prototype does not block', () => {
  test('prototype stays unavailable and the gate never lists it', async () => {
    const { reached, gate } = await opened()(
      Effect.gen(function* () {
        const { specId, snapshot } = yield* attested
        return { reached: snapshot, gate: yield* (yield* Specs).gate(specId) }
      }),
    )
    expect(reached.phases.find((phase) => phase.phase === 'prototype')?.state).toBe('unavailable')
    expect(gate.failures).toEqual([])
  })
})

describe('The protocol suites run on a temporary data folder', () => {
  test('the data folder this suite wrote to is under the temporary directory it made', () => {
    expect(dataFolder.startsWith(tmpdir())).toBe(true)
  })
})
