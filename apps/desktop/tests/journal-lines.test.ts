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

  test('a Spec’s step is drawn under the Spec kind, told apart from its Project', () => {
    expect(lineOf(step('spec.created', {})).kind).toBe('spec')
  })
})

/** A line of a build, about its Session or one of its tasks (D10-14). */
function built(
  type: string,
  payload: JournalEntry['payload'],
  entityKind: JournalEntry['entityKind'] = 'task',
): JournalEntry {
  return {
    ...step(type, payload),
    entityKind,
    entityId: entityKind === 'task' ? 'build-task-2' : 'build',
    author: 'hemera',
    sessionId: 'build',
  }
}

describe('The Journal shows each step of a build in plain words', () => {
  test('a phase, a task moving, a check run and the user’s acts each read as what happened', () => {
    const labels = [
      built('build.phase_started', { phase: 'prepare' }, 'session'),
      built('build.phase_started', { phase: 'execute' }, 'session'),
      built('build.phase_started', { phase: 'verify' }, 'session'),
      built('spec.in_progress', {}, 'session'),
      built('task.ready', { label: 'T2' }),
      built('task.started', { label: 'T2', attempt: 1 }),
      built('task.finished', { label: 'T2', attempt: 1, summary: 'Exporter written', files: 2 }),
      built('task.checked', { label: 'T2', result: 'red', attempt: 1 }),
      built('task.started', { label: 'T2', attempt: 2 }),
      built('task.checked', { label: 'T2', result: 'green', attempt: 2 }),
      built('task.done', { label: 'T2', result: 'green' }),
      built('task.done', { label: 'T2', result: 'unverified' }),
      built('task.done', { label: 'T3' }),
      built('task.yours', { label: 'T3', reason: 'human' }),
      built('task.yours', { label: 'T4', reason: '3 red attempts' }),
      built('task.blocked', { label: 'T2', reason: 'The Spec asks for two formats.' }),
      built('task.blocked', { label: 'T3', because: 'T2' }),
      built('task.skipped', { label: 'T2', reason: 'Done by hand.', unblocks: true }),
      built('build.paused', {}, 'session'),
      built('build.resumed', {}, 'session'),
      built('build.accepted', {}, 'session'),
      built('build.stopped', { reason: 'Stopped by the user.' }, 'session'),
    ].map((entry) => lineOf(entry).label)
    expect(labels).toEqual([
      'Build getting ready',
      'Building',
      'Final checks',
      'Spec in progress: its first task started',
      'T2 ready',
      'T2 started',
      'T2 finished by the agent',
      'T2 checked: red, try 1 of 3',
      'T2 started again, try 2 of 3',
      'T2 checked',
      'T2 done',
      'T2 done, not verified',
      'T3 done',
      'T3 is yours',
      'T4 is yours after three red tries',
      'T2 blocked: The Spec asks for two formats.',
      'T3 blocked with T2',
      'T2 skipped: Done by hand.',
      'Build paused',
      'Build resumed',
      'Build accepted',
      'Build stopped: Stopped by the user.',
    ])
  })

  test('a check says what it said and where it ran, and a change of the Project’s checks is named', () => {
    const labels = [
      built(
        'check.ran',
        { name: 'lint', place: 'api', verdict: 'green', detail: null, scope: 'task', label: 'T2' },
        'session',
      ),
      built(
        'check.ran',
        {
          name: 'Coverage',
          place: '',
          verdict: 'red',
          detail: '64.2 < 70',
          scope: 'build',
          label: null,
        },
        'session',
      ),
      built(
        'check.ran',
        {
          name: 'e2e',
          place: 'web',
          verdict: 'skipped',
          detail: 'no file matched',
          scope: 'story',
          label: null,
        },
        'session',
      ),
      built('check.created', { name: 'lint', when: 'task' }, 'project'),
      built('check.updated', { name: 'lint', when: 'story' }, 'project'),
      built('check.removed', { name: 'lint', when: 'story' }, 'project'),
    ].map((entry) => lineOf(entry).label)
    expect(labels).toEqual([
      'T2 · Check “lint” green in api',
      'Final checks · Check “Coverage” red at the Workspace root: 64.2 < 70',
      'Story · Check “e2e” skipped in web',
      'Check “lint” added',
      'Check “lint” changed',
      'Check “lint” removed',
    ])
  })

  test('a build task’s line is drawn under the Session it is built in', () => {
    expect(lineOf(built('task.done', { label: 'T1' })).kind).toBe('session')
  })
})
