/**
 * What the Journal of the window says about an event, and where a line goes (design D4-05).
 *
 * The engine writes a type and a payload; the sentence a reader gets is written in the window,
 * and so is the day it is filed under. Both are tested here rather than through a page: what
 * is claimed is the wording and the correlation, and neither of them needs a browser.
 *
 * Each suite is named after the scenario it covers.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { JournalEntry } from '@hemera/ipc'
import { lineOf, linesOf } from '#renderer/journal-lines.ts'

/** One event of a Session, as the engine wrote it down. */
function event(type: string, payload: JournalEntry['payload'] = {}): JournalEntry {
  return {
    sequence: 12,
    type,
    entityKind: 'session',
    entityId: 'first',
    source: 'ui',
    author: 'human',
    occurredAt: '2026-09-20T10:00:00.000Z',
    projectId: 'atlas',
    payload,
    seenAt: null,
  }
}

const NOW = new Date('2026-09-20T18:00:00.000Z')

describe('Les événements de Session sont des lignes du Journal', () => {
  test.each([
    ['session.created', { title: 'Draw the owl' }, 'Session created · Draw the owl'],
    ['session.renamed', { title: 'The one I named' }, 'Session renamed to “The one I named”'],
    ['session.message_recorded', { seq: 3 }, 'Message recorded'],
    ['session.archived', {}, 'Session archived'],
    ['session.restored', {}, 'Session restored'],
  ])('%s reads as a sentence', (type, payload, said) => {
    expect(lineOf(event(type, payload), NOW).label).toBe(said)
  })

  test('a line about a Session is a way into it, and a line about anything else is not', () => {
    const opened: string[] = []
    const line = lineOf(event('session.archived'), NOW, { onOpenSession: (id) => opened.push(id) })

    line.target?.onOpen()
    expect(opened).toEqual(['first'])

    const profile: JournalEntry = {
      ...event('profile.opened', { version: '0.1.0' }),
      entityKind: 'profile',
    }
    expect(lineOf(profile, NOW, { onOpenSession: (id) => opened.push(id) }).target).toBeUndefined()
  })

  test('a window that cannot open one draws a plain line', () => {
    expect(lineOf(event('session.created', { title: 'Draw the owl' }), NOW).target).toBeUndefined()
  })
})

describe('Un jour est nommé une fois', () => {
  test('every line of a page is written for the same clock', () => {
    const lines = linesOf([event('session.created'), event('session.archived')], NOW)
    expect(lines.map((line) => line.day)).toEqual(['Today', 'Today'])
    expect(lines[0]?.time).toBe(lines[1]?.time)
  })
})
