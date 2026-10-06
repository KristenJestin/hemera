/**
 * What the Chats keep about each session while it runs (#43): the words of a Chat's agent until
 * they are written, never a mission session's; and nothing about a session once it ended.
 */

import { describe, expect, test } from 'vite-plus/test'

import { sessionBook } from '../src/engine/chat/words.ts'

describe('The sessions the Chats follow', () => {
  test('a Chat’s session keeps its words until they are taken; a mission’s session keeps none', () => {
    const book = sessionBook()
    book.knowChat('chat-session', 'chat-1')
    book.hear('chat-session', 'It is in ')
    book.hear('chat-session', 'api/export.ts.')
    book.knowChat('mission-session', null)
    book.hear('mission-session', 'Exporting the invoices.')
    expect(book.take('chat-session')).toBe('It is in api/export.ts.')
    expect(book.take('chat-session')).toBe('')
    expect(book.take('mission-session')).toBe('')
  })

  test('words heard before the session is known are let go once it is known to be no Chat’s', () => {
    const book = sessionBook()
    book.hear('mission-session', 'Exporting the invoices.')
    book.knowChat('mission-session', null)
    expect(book.take('mission-session')).toBe('')
  })

  test('a session that ended is forgotten whole; the others are kept', () => {
    const book = sessionBook()
    book.knowChat('ended', 'chat-1')
    book.hear('ended', 'Done.')
    book.turnBegan('ended')
    book.knowChat('running', 'chat-2')
    book.turnBegan('running')
    book.forget('ended')
    expect(book.followed()).toBe(1)
    expect(book.chatOf('ended')).toBeUndefined()
    expect(book.turnOf('running')).toBe(1)
  })
})
