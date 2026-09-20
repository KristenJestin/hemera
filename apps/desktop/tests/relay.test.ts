/**
 * What the main process passes on to the process that holds the database (design D3-02).
 *
 * A relay is a name and nothing else, so what can be wrong with one is a name missing from the
 * list: a use case the engine declares, and the main process never wired, is a channel the page
 * may call and nothing answers — which compiles and fails in front of the user. The list is
 * read from `relayed.ts` rather than from `channels.ts`, which cannot be imported without
 * Electron; the wiring itself is one line per name, and the end-to-end suite is what runs it.
 */

import { describe, expect, test } from 'vite-plus/test'

import { CHANNELS, ENGINE_REQUESTS } from '@hemera/ipc'
import { RELAYED } from '#main/relayed.ts'

/**
 * Every use case the main process answers itself rather than passing on.
 *
 * The two preferences, because the answer is put on the window and written to the hint beside
 * the data folder before it reaches the page.
 */
const ANSWERED_HERE = ['preferences.read', 'preferences.write']

describe('Cas d’usage nommés du process dédié', () => {
  test('every use case the engine declares is either relayed or answered by the main process', () => {
    const declared = Object.keys(ENGINE_REQUESTS).toSorted()
    expect([...RELAYED, ...ANSWERED_HERE].toSorted()).toEqual(declared)
  })

  test('every relayed name is a channel the page may call, with the engine’s own schema', () => {
    for (const name of RELAYED) {
      expect(Object.hasOwn(CHANNELS, name)).toBe(true)
      expect(CHANNELS[name]).toBe(ENGINE_REQUESTS[name])
    }
  })

  test('the Sessions of lot 4b are among them, one channel per use case', () => {
    expect(RELAYED.filter((name) => name.startsWith('sessions.'))).toEqual([
      'sessions.list',
      'sessions.create',
      'sessions.rename',
      'sessions.archive',
      'sessions.restore',
      'sessions.append',
      'sessions.read',
    ])
  })
})
