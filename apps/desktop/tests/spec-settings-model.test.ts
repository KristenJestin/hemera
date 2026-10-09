/**
 * What the Spec settings show of the engine's answers and what they write back: the words of a
 * refused key prefix, the modes offered, the prefix as the engine takes it, and a write answered
 * after a later one, which is dropped.
 */

import { InvalidKeyPrefix, InvalidSyncInterval, KeyPrefixTaken, StaleVersion } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  OFFERED_MODES,
  answerGate,
  lastCheckWords,
  prefixEditOf,
  prefixWords,
  settingWords,
  syncWords,
} from '../src/renderer/spec-settings-model.ts'

describe('The modes the Spec settings offer', () => {
  test('are Local and Linked, never Remote', () => {
    expect(OFFERED_MODES).toEqual(['local', 'linked'])
  })
})

describe('The words of a refused key prefix', () => {
  test('an invalid prefix says what a prefix is', () => {
    const failure = new InvalidKeyPrefix({
      prefix: 'a',
      reason: '2 to 6 capitals and digits, starting with a letter',
    })
    expect(prefixWords(failure)).toBe(
      '“a” cannot be a key prefix: 2 to 6 capitals and digits, starting with a letter.',
    )
  })

  test('a prefix other missions carry says whose it is', () => {
    expect(prefixWords(new KeyPrefixTaken({ prefix: 'SHOP' }))).toBe(
      'SHOP is already the key prefix of another Project’s missions.',
    )
  })

  test('a Project changed elsewhere says to reopen it', () => {
    const failure = new StaleVersion({ entity: 'Project', id: 'acme', expected: 3 })
    expect(prefixWords(failure)).toBe(
      'The key prefix could not be saved: This Project changed elsewhere; reopen it and try again.',
    )
  })

  test('any other failure is named as the engine says it', () => {
    expect(prefixWords(new Error('the engine did not answer'))).toBe(
      'The key prefix could not be saved: the engine did not answer',
    )
  })
})

describe('The words of a refused Spec setting', () => {
  test('name the setting and the engine’s reason', () => {
    expect(settingWords('Spec mode', new Error('no'))).toBe('The Spec mode could not be saved: no')
    expect(settingWords('Spec language', new Error('no'))).toBe(
      'The Spec language could not be saved: no',
    )
  })
})

describe('The last check of the linked tickets, in words', () => {
  const now = new Date('2026-10-09T14:00:00.000Z')

  test('is its time today', () => {
    expect(lastCheckWords('2026-10-09T08:12:00.000Z', now, 'UTC')).toBe('08:12')
  })

  test('is its day and time another day', () => {
    expect(lastCheckWords('2026-10-07T08:12:00.000Z', now, 'UTC')).toBe('7 Oct, 08:12')
  })

  test('is absent before the first check, or when its date cannot be read', () => {
    expect(lastCheckWords(null, now, 'UTC')).toBeNull()
    expect(lastCheckWords('not a date', now, 'UTC')).toBeNull()
  })
})

describe('The words of a refused sync interval', () => {
  test('an interval the engine cannot keep says why', () => {
    const failure = new InvalidSyncInterval({
      reason: 'the interval is at least 5 minutes, for the trackers’ rate limits',
    })
    expect(syncWords(failure)).toBe(
      'This interval cannot be kept: the interval is at least 5 minutes, for the trackers’ rate limits.',
    )
  })

  test('any other failure is named as the engine says it', () => {
    expect(syncWords(new Error('no'))).toBe('The sync interval could not be saved: no')
  })
})

describe('The key prefix as the engine takes it', () => {
  test('is written at the version of the Project it was read from', () => {
    expect(prefixEditOf({ id: 'acme', version: 4 }, 'shop')).toEqual({
      id: 'acme',
      version: 4,
      prefix: 'shop',
    })
  })
})

describe('A write answered after a later one', () => {
  test('is dropped: only the latest write is answered to', () => {
    const gate = answerGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(gate.isLatest(first)).toBe(false)
    expect(gate.isLatest(second)).toBe(true)
  })

  test('is kept when no later write began', () => {
    const gate = answerGate()
    const only = gate.begin()
    expect(gate.isLatest(only)).toBe(true)
  })

  test('is dropped once the gate is closed, as when the section is left', () => {
    const gate = answerGate()
    const write = gate.begin()
    gate.close()
    expect(gate.isLatest(write)).toBe(false)
  })
})
