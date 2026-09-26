/**
 * The Spec entries of a thread, as their blocks are drawn from them (design D7-01, D7-07, D7-09).
 *
 * `agent-blocks.tsx` draws a `mission_brief` entry as the folded Hemera line, a `spec_question`
 * as the question card — folded to its answer once the `spec_answer` entry written beside it is
 * in the thread — and a `spec_proposal` as the agent's proposal. What each block is handed is
 * read by `spec-entries.ts`, which is what is tested here: the design system is a browser's to
 * load, and its blocks are proved in Storybook.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { SessionEntry } from '@hemera/ipc'
import { briefOf, proposalIdOf, proposalOf, questionEntryOf } from '#renderer/spec-entries.ts'

function entry(kind: SessionEntry['kind'], payload: string, id: string = kind): SessionEntry {
  return {
    id,
    sessionId: 'writer',
    seq: 1,
    role: kind === 'spec_answer' ? 'user' : 'hemera',
    kind,
    body: kind === 'mission_brief' ? '# Mission: define' : 'Which date decides the month?',
    payload,
    correlationId: null,
    turnId: null,
    state: null,
    origin: 'live',
    createdAt: new Date(2026, 8, 23, 10, 44).getTime(),
  }
}

const QUESTION = entry(
  'spec_question',
  JSON.stringify({
    id: 'q-date',
    body: 'Which date decides the month?',
    blocking: true,
    phase: null,
    options: [
      { id: 'issue', label: 'The issue date', recommended: true },
      { id: 'payment', label: 'The payment date' },
    ],
    answer: null,
  }),
)

describe('The brief is part of the turn, never a human message', () => {
  test('a brief is a folded Hemera line titled with its phase, holding what was handed', () => {
    expect(briefOf(entry('mission_brief', JSON.stringify({ phase: 'shape' })))).toEqual({
      title: 'What the agent was told · Shape',
      detail: '10:44',
      brief: '# Mission: define',
    })
    expect(briefOf(entry('mission_brief', JSON.stringify({ phase: null }))).title).toBe(
      'What the agent was told',
    )
  })
})

describe('A question is asked and answered in the chat', () => {
  test('a question with no answer beside it is open, its options as the agent offered them', () => {
    const block = questionEntryOf(QUESTION, [QUESTION], new Set(['q-date']))
    expect(block?.cancelled).toBe(false)
    expect(block?.question).toEqual({
      id: 'q-date',
      body: 'Which date decides the month?',
      blocking: true,
      phase: 'shape',
      options: [
        { id: 'issue', label: 'The issue date', recommended: true },
        { id: 'payment', label: 'The payment date' },
      ],
      answer: null,
    })
  })

  test('the answer written beside it folds it to the option chosen', () => {
    const answer = entry(
      'spec_answer',
      JSON.stringify({ questionId: 'q-date', optionId: 'issue' }),
      'answer',
    )
    expect(questionEntryOf(QUESTION, [QUESTION, answer], null)?.question.answer).toEqual({
      optionId: 'issue',
      text: undefined,
    })
  })

  test('or to the words of the reader’s own; an answer to another question changes nothing', () => {
    const other = entry(
      'spec_answer',
      JSON.stringify({ questionId: 'q-other', optionId: 'x' }),
      'other',
    )
    const own = entry(
      'spec_answer',
      JSON.stringify({ questionId: 'q-date', text: 'The delivery date' }),
      'own',
    )
    expect(questionEntryOf(QUESTION, [QUESTION, other], null)?.question.answer).toBe(null)
    expect(questionEntryOf(QUESTION, [QUESTION, other, own], null)?.question.answer).toEqual({
      optionId: undefined,
      text: 'The delivery date',
    })
  })

  test('an entry this version cannot read is not drawn', () => {
    expect(questionEntryOf(entry('spec_question', JSON.stringify({ id: 'q' })), [], null)).toBe(
      null,
    )
  })
})

describe('A Rework asks the open questions again', () => {
  test('a question the current revision no longer holds is drawn cancelled, not answerable', () => {
    // After the Rework the same question is asked again under `q-date-2`.
    expect(questionEntryOf(QUESTION, [QUESTION], new Set(['q-date-2']))?.cancelled).toBe(true)
  })

  test('one answered before the Rework stays folded to its answer', () => {
    const answer = entry(
      'spec_answer',
      JSON.stringify({ questionId: 'q-date', optionId: 'issue' }),
      'answer',
    )
    const block = questionEntryOf(QUESTION, [QUESTION, answer], new Set(['q-date-2']))
    expect(block?.cancelled).toBe(false)
    expect(block?.question.answer).toEqual({ optionId: 'issue', text: undefined })
  })

  test('nothing is cancelled before the Spec has been read', () => {
    expect(questionEntryOf(QUESTION, [QUESTION], null)?.cancelled).toBe(false)
  })
})

describe('A free Session’s agent proposes a Spec', () => {
  const proposal = entry(
    'spec_proposal',
    JSON.stringify({ title: 'CSV invoice export', type: 'feature' }),
    'proposal',
  )
  const other = entry(
    'spec_proposal',
    JSON.stringify({ title: 'Payments report', type: 'feature' }),
    'other',
  )
  const thread = [proposal, other]
  const created = { key: 'ATL-7', title: 'CSV invoice export', type: 'feature' as const }

  test('proposed while the Session is free, created once it defines the Spec it proposed', () => {
    expect(proposalOf(proposal, thread, null, null)).toEqual({
      title: 'CSV invoice export',
      type: 'feature',
      state: 'proposed',
    })
    expect(proposalOf(proposal, thread, 'spec-7', created)?.state).toBe('created')
  })

  test('of two proposals in one Session, only the one the Spec came from reads created', () => {
    expect(proposalOf(other, thread, 'spec-7', created)?.state).toBe('declined')
    // Created with a title edited in the card, the Spec came from the last proposal.
    const edited = { ...created, title: 'CSV export of a month' }
    expect(proposalOf(proposal, thread, 'spec-7', edited)?.state).toBe('declined')
    expect(proposalOf(other, thread, 'spec-7', edited)?.state).toBe('created')
  })

  test('declined once the engine kept it declined, which the Spec it came from overrides', () => {
    const declined = { ...proposal, state: 'declined' }
    expect(proposalOf(declined, thread, null, null)?.state).toBe('declined')
    expect(proposalOf(declined, [declined, other], 'spec-7', created)?.state).toBe('created')
  })

  test('named to the engine by its correlation, without the prefix', () => {
    expect(proposalIdOf({ ...proposal, correlationId: 'proposal:4f1c' })).toBe('4f1c')
  })

  test('not drawn while the Spec of a define Session is still being read, nor of an unknown type', () => {
    expect(proposalOf(proposal, thread, 'spec-7', null)).toBe(null)
    const epic = entry('spec_proposal', JSON.stringify({ title: 'X', type: 'epic' }))
    expect(proposalOf(epic, [epic], null, null)).toBe(null)
  })
})
