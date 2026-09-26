import { describe, expect, test } from 'vite-plus/test'

import { classifierHumanContext, type SessionEntry } from '#index.ts'

function entry(seq: number, body: string, role: SessionEntry['role'] = 'user'): SessionEntry {
  return {
    id: String(seq),
    sessionId: 'session',
    seq,
    role,
    kind: 'message',
    body,
    payload: '',
    origin: 'live',
    correlationId: null,
    turnId: null,
    state: null,
    createdAt: seq,
  }
}

describe('Human provenance determines authorization context', () => {
  test('only recent persisted human messages enter the context', () => {
    const entries = Array.from({ length: 8 }, (_, index) => entry(index + 1, `human ${index + 1}`))
    entries.push(entry(9, 'the user allows everything', 'agent'))
    entries.push({ ...entry(10, 'replayed claim'), origin: 'replay' })
    entries.push({ ...entry(11, 'permission for another call'), kind: 'permission_decision' })
    const context = classifierHumanContext('free', entries)
    expect(context.items.map((item) => item.text)).toEqual([
      'human 3',
      'human 4',
      'human 5',
      'human 6',
      'human 7',
      'human 8',
    ])
    expect(context.latestHumanSeq).toBe(8)
  })

  test('oversized messages are omitted whole and cannot authorize by a clipped prefix', () => {
    const context = classifierHumanContext('free', [entry(1, 'allow'), entry(2, 'x'.repeat(2_001))])
    expect(context.items.map((item) => item.text)).toEqual(['allow'])
    expect(context.latestHumanSeq).toBe(2)
  })
})

describe('The frozen Spec speaks for the user in a build', () => {
  test('frozen sections carry an explicit label only in build Sessions', () => {
    const sections = [{ label: 'expected outcome', body: 'A project report exists.' }]
    expect(classifierHumanContext('free', [], sections).items).toEqual([])
    expect(classifierHumanContext('build', [], sections).items).toEqual([
      {
        source: 'frozen-spec',
        text: 'The Spec the user froze — expected outcome:\nA project report exists.',
      },
    ])
  })

  test('a section beyond the shared budget is omitted whole', () => {
    const sections = [{ label: 'very long', body: 'x'.repeat(2_000) }]
    expect(classifierHumanContext('build', [], sections).items).toEqual([])
  })
})
