/**
 * The two rules about the title of a Session, which the header, the sidebar row, the Home
 * frame and the palette all read (design D4b-03).
 *
 * Each suite is named after the scenario of the ticket's « Spec · sessions » it covers.
 */

import { describe, expect, test } from 'vite-plus/test'

import { NEW_SESSION_TITLE, committedTitle, shownTitle } from '../src/session/model.ts'

describe('Session sans message', () => {
  test('a Session no message has named yet is drawn as New session', () => {
    expect(shownTitle('')).toBe(NEW_SESSION_TITLE)
    expect(shownTitle('   ')).toBe(NEW_SESSION_TITLE)
  })

  test('a Session that has a title is drawn as its title', () => {
    expect(shownTitle('CSV invoice export')).toBe('CSV invoice export')
    expect(shownTitle('  Full-text search  ')).toBe('Full-text search')
  })
})

describe('Renommage conservé', () => {
  test('what was typed is what the Session is called', () => {
    expect(committedTitle('Invoices, HT and TTC', 'CSV invoice export')).toBe(
      'Invoices, HT and TTC',
    )
  })

  test('a box emptied leaves the Session called what it was called', () => {
    expect(committedTitle('', 'CSV invoice export')).toBe('CSV invoice export')
    expect(committedTitle('   ', 'CSV invoice export')).toBe('CSV invoice export')
  })

  test('a Session with no title of its own is not renamed to the one shown in its place', () => {
    // The fallback is drawn, never stored: an empty rename of an untitled Session leaves it
    // untitled, so the first message still gets to name it.
    expect(committedTitle('', '')).toBe('')
  })
})
