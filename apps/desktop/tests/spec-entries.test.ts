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
import { briefOf, proposalOf, questionEntryOf } from '#renderer/spec-entries.ts'

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
      title: 'Mission brief · shape',
      detail: '10:44',
      brief: '# Mission: define',
    })
    expect(briefOf(entry('mission_brief', JSON.stringify({ phase: null }))).title).toBe(
      'Mission brief',
    )
  })
})

describe('A question is asked and answered in the chat', () => {
  test('a question with no answer beside it is open, its options as the agent offered them', () => {
    const question = questionEntryOf(QUESTION, [QUESTION])
    expect(question).toEqual({
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
    expect(questionEntryOf(QUESTION, [QUESTION, answer])?.answer).toEqual({
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
    expect(questionEntryOf(QUESTION, [QUESTION, other])?.answer).toBe(null)
    expect(questionEntryOf(QUESTION, [QUESTION, other, own])?.answer).toEqual({
      optionId: undefined,
      text: 'The delivery date',
    })
  })

  test('an entry this version cannot read is not drawn', () => {
    expect(questionEntryOf(entry('spec_question', JSON.stringify({ id: 'q' })), [])).toBe(null)
  })
})

describe('A free Session’s agent proposes a Spec', () => {
  const proposal = entry(
    'spec_proposal',
    JSON.stringify({ title: 'CSV invoice export', type: 'feature' }),
  )

  test('proposed while the Session is free, created once it defines a Spec', () => {
    expect(proposalOf(proposal, null, false)).toEqual({
      title: 'CSV invoice export',
      type: 'feature',
      state: 'proposed',
    })
    expect(proposalOf(proposal, 'spec-7', false)?.state).toBe('created')
  })

  test('declined when Not now was pressed, which a created Spec overrides', () => {
    expect(proposalOf(proposal, null, true)?.state).toBe('declined')
    expect(proposalOf(proposal, 'spec-7', true)?.state).toBe('created')
  })

  test('a proposal of an unknown type is not drawn', () => {
    expect(
      proposalOf(entry('spec_proposal', JSON.stringify({ title: 'X', type: 'epic' })), null, false),
    ).toBe(null)
  })
})
