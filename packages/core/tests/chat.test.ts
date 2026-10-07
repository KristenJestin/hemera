/**
 * The Chat's words (#43): its title from the first message, and the mentions a message carries,
 * said as references the agent resolves.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  CHAT_INTERRUPTED,
  CHAT_TITLE_MAX,
  UNTITLED_CHAT,
  chatTitleOf,
  draftNotice,
  draftOf,
  mentionsText,
} from '../src/domain/chat.ts'

describe('A Chat’s title', () => {
  test('is the first line of the first message, cut to 60 characters', () => {
    expect(chatTitleOf('Where are the invoices exported?\nAnd how?')).toBe(
      'Where are the invoices exported?',
    )
    const long = chatTitleOf('a'.repeat(80))
    expect(long).toHaveLength(CHAT_TITLE_MAX)
    expect(long.endsWith('…')).toBe(true)
    expect(chatTitleOf('   \n  ')).toBe(UNTITLED_CHAT)
  })
})

describe('The mentions of a message', () => {
  test('are references after the text: a file, a mission, a catalogue command', () => {
    expect(
      mentionsText([
        { kind: 'file', ref: 'api/export.ts' },
        { kind: 'mission', ref: 'ACME-12' },
        { kind: 'command', ref: 'test-api' },
      ]),
    ).toBe(
      [
        'References:',
        '- file `api/export.ts` (in the main checkout)',
        '- mission ACME-12 (read it with memory_read)',
        '- catalogue command `test-api` (run it with commands_run)',
      ].join('\n'),
    )
    expect(mentionsText([])).toBe('')
  })
})

describe('What the transcript says of a mission drafted from the Chat', () => {
  test('is read back as its key and title; any other line is none', () => {
    const said = draftNotice('ACME-16', 'Export the invoices as JSON')
    expect(said).toBe('Mission ACME-16 created: Export the invoices as JSON')
    expect(draftOf(said)).toEqual({ key: 'ACME-16', title: 'Export the invoices as JSON' })
    expect(draftOf(CHAT_INTERRUPTED)).toBeNull()
    expect(draftOf('The Mission ACME-16 created: nothing')).toBeNull()
  })
})
