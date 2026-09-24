/**
 * A Spec snapshot as the Spec panel draws it (design D7-01, D7-05, D7-08, D7-10, D7-11, D7-12).
 *
 * The mapping is pure: a snapshot, its revisions, its buffers and its Journal in, the
 * view of `@hemera/ui` out — one sentence of what is happening, a mark per part, the readiness
 * as seven checks and the things left before ready.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { GateFailure } from '@hemera/core'
import type {
  JournalEntry,
  PhaseId,
  PhaseState,
  SectionName,
  Session,
  SpecQuestion,
  SpecSection,
  SpecSnapshot,
} from '@hemera/ipc'
import {
  dayOf,
  nowOf,
  readerOf,
  readinessOf,
  revisionsOf,
  sectionsOf,
  specViewOf,
  storiesWith,
  tasksOf,
} from '#renderer/spec-views.ts'

function phases(shape: PhaseState, plan: PhaseState, decompose: PhaseState) {
  const states: [PhaseId, PhaseState][] = [
    ['shape', shape],
    ['plan', plan],
    ['decompose', decompose],
    ['prototype', 'unavailable'],
  ]
  return states.map(([phase, state]) => ({
    id: `phase-${phase}`,
    revisionId: 'rev-1',
    phase,
    state,
    summary: null,
    assumptions: [],
    basis: {},
    protocolVersion: 1,
    declaredAt: null,
  }))
}

function section(name: SectionName, body: string, version: number, author: 'agent' | 'human') {
  const written: SpecSection = {
    id: name,
    revisionId: 'rev-1',
    name,
    body,
    version,
    author,
    sessionId: 'writer',
    updatedAt: 0,
  }
  return written
}

function question(id: string, phase: PhaseId | null, answered = false): SpecQuestion {
  return {
    id,
    revisionId: 'rev-1',
    body: 'Which date decides the month?',
    blocking: true,
    phase,
    raisedBy: 'agent',
    options: [
      { id: 'issue', label: 'The issue date', recommended: true },
      { id: 'payment', label: 'The payment date' },
    ],
    answer: answered ? { optionId: 'issue', text: null } : null,
    resolvedAt: answered ? 1 : null,
  }
}

/** `ATL-7`, a feature at revision 1, draft, being shaped: the problem written, the rest empty. */
function snapshot(change: Partial<SpecSnapshot> = {}): SpecSnapshot {
  return {
    spec: {
      id: 'spec-7',
      projectId: 'atlas',
      key: 'ATL-7',
      slug: 'csv-invoice-export',
      status: 'draft',
      priority: null,
      workspaceId: null,
      currentRevisionId: 'rev-1',
      writerSessionId: 'writer',
      contentVersion: 3,
      createdAt: 0,
      updatedAt: Date.UTC(2026, 8, 23, 12),
    },
    revision: {
      id: 'rev-1',
      specId: 'spec-7',
      number: 1,
      title: 'CSV invoice export',
      type: 'feature',
      changeSummary: null,
      changeReason: null,
      createdBy: 'human',
      attestedContentVersion: null,
      createdAt: Date.UTC(2026, 8, 21, 12),
    },
    sections: [
      section('problem', 'Accountants retype a month of invoices.', 1, 'agent'),
      section('expected_outcome', '', 0, 'human'),
      section('scope', 'In: invoices of a month.', 2, 'human'),
      section('verification', '', 0, 'human'),
      section('behaviour', '', 0, 'human'),
    ],
    stories: [],
    criteria: [],
    tasks: [],
    dependencies: [],
    taskStories: [],
    questions: [],
    phases: phases('open', 'pending', 'pending'),
    ...change,
  }
}

function failure(check: GateFailure['check'], target: string, message = 'fails'): GateFailure {
  return { check, target, message }
}

function ready(at: string, revisionId: string): JournalEntry {
  return {
    sequence: 1,
    type: 'spec.ready',
    entityKind: 'spec',
    entityId: 'spec-7',
    source: 'ui',
    author: 'human',
    occurredAt: at,
    projectId: 'atlas',
    payload: {},
    seenAt: null,
    sessionId: null,
    specId: 'spec-7',
    revisionId,
    phaseId: null,
  }
}

describe('The panel says what is happening in one sentence', () => {
  test('shape open: the agent is writing the first empty section of the type', () => {
    expect(nowOf(snapshot())).toBe('Shape · the agent is writing the expected outcome')
  })

  test('a blocking question of the phase in focus: the answer is yours', () => {
    const waiting = snapshot({ questions: [question('q', 'shape')] })
    expect(nowOf(waiting)).toBe('Shape · waiting for your answer')
    // Answered, or of another phase, it waits on nobody.
    expect(nowOf(snapshot({ questions: [question('q', 'shape', true)] }))).not.toContain('waiting')
    expect(nowOf(snapshot({ questions: [question('q', 'plan')] }))).not.toContain('waiting')
  })

  test('plan open: the agent is writing the plan', () => {
    expect(nowOf(snapshot({ phases: phases('finished', 'open', 'pending') }))).toBe(
      'Plan · the agent is writing the plan',
    )
  })

  test('every phase finished and attested: the agent attests the contract is complete', () => {
    const done = snapshot({ phases: phases('finished', 'finished', 'finished') })
    expect(nowOf({ ...done, revision: { ...done.revision, attestedContentVersion: 3 } })).toBe(
      'Decompose · finished, the agent attests the contract is complete',
    )
    expect(nowOf(done)).toBe('Decompose · finished, waiting for the agent to attest the contract')
  })

  test('ready: frozen at its revision, a build can start from it', () => {
    const frozen = snapshot()
    expect(nowOf({ ...frozen, spec: { ...frozen.spec, status: 'ready' } })).toBe(
      'Ready · frozen at revision 1, a build can start from it',
    )
  })

  test('after a Rework every phase is stale, and the agent re-declares each', () => {
    const reworked = snapshot({ phases: phases('stale', 'stale', 'stale') })
    expect(nowOf({ ...reworked, revision: { ...reworked.revision, number: 2 } })).toBe(
      'Rework · the agent re-declares each phase',
    )
    // A stale phase among finished ones is a new shaping's doing, not a Rework's.
    expect(nowOf(snapshot({ phases: phases('finished', 'stale', 'pending') }))).toBe(
      'Plan · stale after a new shaping, the agent re-declares it',
    )
  })

  test('on revision 2, once shape is declared again, a stale plan is a new shaping', () => {
    const redeclared = snapshot({ phases: phases('finished', 'stale', 'stale') })
    expect(nowOf({ ...redeclared, revision: { ...redeclared.revision, number: 2 } })).toBe(
      'Plan · stale after a new shaping, the agent re-declares it',
    )
  })
})

describe('Each section wears its mark', () => {
  test('empty, written by the agent, edited by you', () => {
    const marks = sectionsOf(snapshot(), []).map((one) => [one.name, one.mark, one.author])
    expect(marks).toEqual([
      ['problem', 'agent', 'agent'],
      ['expected_outcome', 'empty', null],
      ['scope', 'human', 'human'],
      ['verification', 'empty', null],
      ['behaviour', 'empty', null],
    ])
  })

  test('stale while the phase that owns it is stale', () => {
    const stale = snapshot({
      phases: phases('finished', 'stale', 'pending'),
      sections: [
        section('plan', 'Stream the rows.', 2, 'agent'),
        section('scope', 'In.', 1, 'agent'),
      ],
    })
    expect(sectionsOf(stale, []).map((one) => one.mark)).toEqual(['stale', 'agent'])
  })
})

describe('A conflict keeps the human’s text', () => {
  test('a text kept on an older version is the conflict of its section', () => {
    const kept = {
      specId: 'spec-7',
      name: 'scope' as const,
      body: 'Mine.',
      baseVersion: 1,
      updatedAt: 0,
    }
    const scope = sectionsOf(snapshot(), [kept]).find((one) => one.name === 'scope')
    expect(scope?.mark).toBe('conflict')
    expect(scope?.conflict).toEqual({
      base: 1,
      current: 2,
      mine: 'Mine.',
      theirs: 'In: invoices of a month.',
    })
  })

  test('a text kept on the version the section is at is no conflict', () => {
    const kept = {
      specId: 'spec-7',
      name: 'scope' as const,
      body: 'Mine.',
      baseVersion: 2,
      updatedAt: 0,
    }
    expect(sectionsOf(snapshot(), [kept]).find((one) => one.name === 'scope')?.conflict).toBe(
      undefined,
    )
  })
})

describe('The readiness bar says what is left', () => {
  test('each engine check is drawn under the bar’s name, failing with what fails', () => {
    const readiness = readinessOf(snapshot(), [
      failure('type_contract', 'expected_outcome', 'the expected_outcome section is missing'),
      failure('blocking_question', 'q', 'a blocking question is open: Which date?'),
      failure('phase', 'shape', 'the shape phase is open, not finished'),
      failure('attestation', 'rev-1', 'the agent has not attested the contract'),
    ])
    expect(readiness.checks.map((one) => [one.check, one.passed])).toEqual([
      ['contract', false],
      ['references', true],
      ['coverage', true],
      ['cycle', true],
      ['questions', false],
      ['phases', false],
      ['attestation', false],
    ])
    expect(readiness.checks[0]?.detail).toBe('contract · the expected_outcome section is missing')
  })

  test('the things left are links to where each is fixed, the attestation without one', () => {
    const readiness = readinessOf(snapshot(), [
      failure('type_contract', 'expected_outcome'),
      failure('type_contract', 'title'),
      failure('coverage', 'tasks'),
      failure('blocking_question', 'q1'),
      failure('blocking_question', 'q2'),
      failure('phase', 'plan'),
      failure('phase', 'decompose'),
      failure('attestation', 'rev-1'),
    ])
    expect(readiness.todo).toEqual([
      { label: 'the expected outcome', target: 'expected_outcome' },
      { label: 'the title' },
      { label: 'the tasks', target: 'tasks' },
      { label: '2 blocking questions', target: 'questions' },
      { label: 'plan and decompose', target: 'plan' },
      { label: 'the attestation' },
    ])
  })

  test('a story left uncovered is named by its key', () => {
    const covered = snapshot({
      stories: [
        {
          id: 'story-1',
          revisionId: 'rev-1',
          title: 'Export',
          narrative: '',
          priority: null,
          rank: 'a',
        },
      ],
    })
    const readiness = readinessOf(covered, [
      failure('coverage', 'story-1'),
      failure('coverage', 'story-1'),
    ])
    expect(readiness.todo).toEqual([
      { label: 'criteria for S1', target: 'stories' },
      { label: 'a task for S1', target: 'tasks' },
    ])
  })

  test('the readiness is the ready gate of the very snapshot on screen', () => {
    // Shaping has just begun: sections of the contract empty, no task, `shape` open, nothing
    // attested — and no question, no link, no cycle to fail.
    expect(readinessOf(snapshot()).checks.map((one) => [one.check, one.passed])).toEqual([
      ['contract', false],
      ['references', true],
      ['coverage', false],
      ['cycle', true],
      ['questions', true],
      ['phases', false],
      ['attestation', false],
    ])
  })

  test('a frozen revision passed its gate, and is drawn with every check passing', () => {
    const frozen = snapshot()
    const readiness = readinessOf({ ...frozen, spec: { ...frozen.spec, status: 'ready' } }, [
      failure('attestation', 'rev-1'),
    ])
    expect(readiness.checks.every((one) => one.passed)).toBe(true)
    expect(readiness.todo).toEqual([])
  })

  test('an obsolete request refused is said by the bar, and nothing is said otherwise', () => {
    const reading = {
      snapshot: snapshot(),
      revisions: [snapshot().revision],
      buffers: [],
      journal: [],
    }
    const said = 'ATL-7 changed since its gate was shown: read the gate again.'
    expect(specViewOf({ ...reading, readyRefused: said }).readiness.refused).toBe(said)
    expect(specViewOf({ ...reading, readyRefused: null }).readiness.refused).toBe(undefined)
  })
})

describe('An old revision is readable and not editable', () => {
  const current = snapshot({
    revision: {
      ...snapshot().revision,
      id: 'rev-2',
      number: 2,
      createdAt: Date.UTC(2026, 8, 24, 9),
    },
  })
  const second = { ...current, spec: { ...current.spec, currentRevisionId: 'rev-2' } }
  const revisions = [snapshot().revision, second.revision]

  test('the picker lists the revisions newest first, the older ones read only', () => {
    expect(revisionsOf(second, revisions, [ready('2026-09-22T10:00:00.000Z', 'rev-1')])).toEqual([
      { number: 2, detail: 'current, draft' },
      { number: 1, detail: 'read only · frozen 22 Sep' },
    ])
  })

  test('revision 1 shown is frozen: no editing, no conflict, and the day it froze', () => {
    const old = { ...snapshot(), spec: second.spec }
    const kept = {
      specId: 'spec-7',
      name: 'scope' as const,
      body: 'Mine.',
      baseVersion: 1,
      updatedAt: 0,
    }
    const view = specViewOf({
      snapshot: old,
      revisions,
      buffers: [kept],
      journal: [ready('2026-09-22T10:00:00.000Z', 'rev-1')],
    })
    expect(view.status).toBe('ready')
    expect(view.frozenOn).toBe('22 Sep')
    expect(view.now).toBe('Revision 1 · read only, as it was frozen')
    expect(view.sections.some((one) => one.conflict !== undefined)).toBe(false)
    expect(view.readiness.todo).toEqual([])
    expect(view.replacedBy).toBe(2)
  })

  test('the current revision is replaced by none, and a ready one offers its Rework', () => {
    const frozen = snapshot()
    const view = specViewOf({
      snapshot: { ...frozen, spec: { ...frozen.spec, status: 'ready' } },
      revisions: [frozen.revision],
      buffers: [],
      journal: [],
    })
    expect(view.status).toBe('ready')
    expect(view.replacedBy).toBe(undefined)
  })

  test('a ready Spec whose line the Journal page did not hold froze when it last changed', () => {
    const frozen = snapshot()
    const view = specViewOf({
      snapshot: { ...frozen, spec: { ...frozen.spec, status: 'ready' } },
      revisions: [frozen.revision],
      buffers: [],
      journal: [],
    })
    expect(view.frozenOn).toBe(dayOf(Date.UTC(2026, 8, 23, 12)))
    expect(view.revisions).toEqual([{ number: 1, detail: 'current, frozen' }])
  })
})

/** The credit-note story, `S2`, with its narrative and criteria edited in place. */
const CREDIT_EDITED = {
  id: 'credit',
  key: 'S2',
  title: 'Credit notes',
  narrative: 'Kept with their invoice number.',
  criteria: ['Negative rows.', 'Same number.'],
}

describe('Stories, tasks and questions are named the way the document reads them', () => {
  const decomposed = snapshot({
    stories: [
      {
        id: 'export',
        revisionId: 'rev-1',
        title: 'Export a month',
        narrative: 'As an accountant…',
        priority: null,
        rank: 'a',
      },
      {
        id: 'credit',
        revisionId: 'rev-1',
        title: 'Credit notes',
        narrative: 'As an accountant…',
        priority: 'high',
        rank: 'b',
      },
    ],
    criteria: [
      { id: 'c1', storyId: 'export', body: 'One row per line.', rank: 'a' },
      { id: 'c2', storyId: 'export', body: 'Empty month, header only.', rank: 'b' },
      { id: 'c3', storyId: 'credit', body: 'Negative rows.', rank: 'a' },
    ],
    tasks: [
      {
        id: 'read',
        taskSetId: 'set',
        title: 'Stream the lines',
        result: 'Lines stream.',
        type: 'code',
        executor: 'agent',
        criteria: '',
        rank: 'a',
      },
      {
        id: 'check',
        taskSetId: 'set',
        title: 'Import in the ledger',
        result: 'It imports.',
        type: 'check',
        executor: 'human',
        criteria: '',
        rank: 'b',
      },
    ],
    dependencies: [{ taskId: 'check', dependsOnId: 'read' }],
    taskStories: [
      { taskId: 'read', storyId: 'export' },
      { taskId: 'check', storyId: 'export' },
      { taskId: 'check', storyId: 'credit' },
    ],
    questions: [question('q', null, true)],
  })

  test('stories are S1, S2 and tasks T1, T2, by their order, with what they wait on and cover', () => {
    const view = specViewOf({
      snapshot: decomposed,
      revisions: [decomposed.revision],
      buffers: [],
      journal: [],
    })
    expect(view.stories.map((one) => [one.key, one.criteria.length])).toEqual([
      ['S1', 2],
      ['S2', 1],
    ])
    expect(tasksOf(decomposed)).toEqual([
      {
        key: 'T1',
        title: 'Stream the lines',
        result: 'Lines stream.',
        after: [],
        covers: ['S1'],
        executor: 'agent',
      },
      {
        key: 'T2',
        title: 'Import in the ledger',
        result: 'It imports.',
        after: ['T1'],
        covers: ['S1', 'S2'],
        executor: 'human',
      },
    ])
    expect(view.storiesMark).toBe('agent')
    expect(view.tasksMark).toBe('agent')
  })

  test('a question keeps its options and its answer, and one of no phase reads under shape', () => {
    const view = specViewOf({
      snapshot: decomposed,
      revisions: [decomposed.revision],
      buffers: [],
      journal: [],
    })
    expect(view.questions[0]).toEqual({
      id: 'q',
      body: 'Which date decides the month?',
      blocking: true,
      phase: 'shape',
      options: [
        { id: 'issue', label: 'The issue date', recommended: true },
        { id: 'payment', label: 'The payment date' },
      ],
      answer: { optionId: 'issue', text: undefined },
    })
  })

  test('a story edited in place is written back with every other story as it was', () => {
    const edited = storiesWith(decomposed, CREDIT_EDITED)
    expect(edited).toEqual([
      {
        id: 'export',
        title: 'Export a month',
        narrative: 'As an accountant…',
        priority: null,
        criteria: ['One row per line.', 'Empty month, header only.'],
      },
      {
        id: 'credit',
        title: 'Credit notes',
        narrative: 'Kept with their invoice number.',
        priority: 'high',
        criteria: ['Negative rows.', 'Same number.'],
      },
    ])
  })

  test('a story edited while the list moved is written onto its own story', () => {
    // `S2` was the credit notes when the edit began; a story put in front of them since has
    // made the credit notes `S3`, and `S2` another story, which keeps its own text.
    const moved = {
      ...decomposed,
      stories: [
        decomposed.stories[0]!,
        {
          id: 'refund',
          revisionId: 'rev-1',
          title: 'Refunds',
          narrative: '',
          priority: null,
          rank: 'ab',
        },
        decomposed.stories[1]!,
      ],
    }
    const written = storiesWith(moved, CREDIT_EDITED)
    expect(written?.map((one) => [one.id, one.narrative])).toEqual([
      ['export', 'As an accountant…'],
      ['refund', ''],
      ['credit', 'Kept with their invoice number.'],
    ])
  })

  test('a story taken away while it was edited is not written at all', () => {
    const gone = { ...decomposed, stories: [decomposed.stories[0]!] }
    expect(storiesWith(gone, CREDIT_EDITED)).toBe(null)
  })
})

describe('A second Session reads but does not write', () => {
  const session = (id: string, title: string): Session => ({
    id,
    projectId: 'atlas',
    title,
    titleSource: 'user',
    provider: 'opencode',
    model: null,
    nativeState: 'none',
    mission: 'define',
    specId: 'spec-7',
    archivedAt: null,
    createdAt: 0,
    lastWrittenAt: 0,
    version: 1,
  })
  const listed = [session('writer', 'Spec CSV'), session('reader', 'Billing review')]

  /** No Session has a turn running. */
  const idle = () => false

  test('a Session that is not the writer reads, told which Session writes', () => {
    expect(readerOf(snapshot(), 'reader', listed, idle)).toEqual({
      writer: 'Spec CSV',
      takeOverRefused: null,
    })
  })

  test('the writer does not read, and nobody reads a frozen Spec', () => {
    expect(readerOf(snapshot(), 'writer', listed, idle)).toBe(undefined)
    const frozen = snapshot()
    expect(
      readerOf({ ...frozen, spec: { ...frozen.spec, status: 'ready' } }, 'reader', listed, idle),
    ).toBe(undefined)
  })
})

describe('Take over is refused while the writer runs a turn, and on a Spec that is not a draft', () => {
  const session = (id: string, title: string): Session => ({
    id,
    projectId: 'atlas',
    title,
    titleSource: 'user',
    provider: 'opencode',
    model: null,
    nativeState: 'none',
    mission: 'define',
    specId: 'spec-7',
    archivedAt: null,
    createdAt: 0,
    lastWrittenAt: 0,
    version: 1,
  })
  const listed = [session('writer', 'Spec CSV'), session('reader', 'Billing review')]

  test('the writer running a turn disables Take over, with the reason the engine refuses with', () => {
    expect(readerOf(snapshot(), 'reader', listed, (id) => id === 'writer')).toEqual({
      writer: 'Spec CSV',
      takeOverRefused: 'The Session "Spec CSV" is running a turn on ATL-7: take over once it ends.',
    })
  })

  test('a turn running in another Session than the writer refuses nothing', () => {
    expect(readerOf(snapshot(), 'reader', listed, (id) => id === 'reader')).toMatchObject({
      takeOverRefused: null,
    })
  })
})
