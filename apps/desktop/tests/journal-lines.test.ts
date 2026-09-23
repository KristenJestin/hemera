/**
 * A Spec's steps in the Journal (design D7-13).
 *
 * Each step reads as a sentence of its own, with its phase read from the event's correlation.
 * The Journal of the design system draws three kinds of entity and no Spec kind: until it has
 * one, a Spec's step reads under the Project the Spec belongs to.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { JournalEntry } from '@hemera/ipc'
import { lineOf } from '#renderer/journal-lines.ts'

function step(
  type: string,
  payload: JournalEntry['payload'],
  phaseId: string | null = null,
): JournalEntry {
  return {
    sequence: 1,
    type,
    entityKind: 'spec',
    entityId: 'spec-7',
    source: 'ui',
    author: 'human',
    occurredAt: '2026-09-23T10:00:00.000Z',
    projectId: 'atlas',
    payload,
    seenAt: null,
    sessionId: 'writer',
    specId: 'spec-7',
    revisionId: 'rev-1',
    phaseId,
  }
}

describe('The Journal shows each step', () => {
  test('each step of a Spec reads as what happened, with its phase', () => {
    const labels = [
      step('spec.created', { key: 'ATL-1', title: 'CSV export', type: 'feature' }),
      step('spec.section_written', { name: 'scope', version: 2, author: 'human' }, 'shape'),
      step('spec.phase_opened', { phase: 'shape', state: 'open' }, 'shape'),
      step('spec.question_raised', { body: 'Which date?', blocking: true, options: 2 }),
      step('spec.write_right_transferred', { from: 'writer', to: 'reader' }),
      step('spec.ready', { key: 'ATL-1', contentVersion: 9 }),
      step('spec.reopened', { reason: null, number: 2, previousRevisionId: 'rev-1' }),
      step('spec.reopened', { reason: 'Credit notes.', number: 3, previousRevisionId: 'rev-2' }),
    ].map((entry) => lineOf(entry).label)
    expect(labels).toEqual([
      'Spec ATL-1 “CSV export” created',
      'scope written by human · v2',
      'Phase shape opened',
      'Question asked: Which date?',
      'Write right taken over',
      'Spec ATL-1 marked ready',
      'Reworked into revision 2',
      'Reworked into revision 3: Credit notes.',
    ])
  })

  test('a Spec’s step reads under its Project, the Journal having no Spec kind', () => {
    expect(lineOf(step('spec.created', {})).kind).toBe('project')
  })
})
