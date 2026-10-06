/**
 * Nobody chats with a mission's agents, by design (#40): no group of the engine takes text meant
 * for a session, and the sessions' own group only reads.
 */

import { Predicate } from 'effect'
import type { Rpc } from 'effect/rpc'
import { describe, expect, test } from 'vite-plus/test'

import { EngineMainRpcs, SessionsRpcs } from '../src/index.ts'

/** The fields of an RPC's payload, by name: a struct's, none for a payload of another shape. */
const fieldsOf = (rpc: Rpc.AnyWithProps): ReadonlyArray<string> => {
  const payload = rpc.payloadSchema
  if (!('fields' in payload)) return []
  return Predicate.isObject(payload.fields) ? Object.keys(payload.fields) : []
}

/** What a payload would carry text to an agent in. */
const TEXT = ['text', 'message', 'body', 'prompt', 'content', 'words']
/** What a payload would name a session or a running agent by. */
const SESSION = ['sessionId', 'lineage', 'session']

describe('No RPC sends text from the user to a session', () => {
  test('no group of the engine takes a session and a text together', () => {
    const offending = [...EngineMainRpcs.requests.entries()].filter(([, rpc]) => {
      const fields = fieldsOf(rpc)
      return (
        fields.some((name) => SESSION.includes(name)) && fields.some((name) => TEXT.includes(name))
      )
    })
    expect(offending.map(([name]) => name)).toEqual([])
  })

  test('the sessions’ group reads: a list, a thread, the instruction files, nothing that writes', () => {
    expect([...SessionsRpcs.requests.keys()].sort()).toEqual([
      'sessions.instructionFiles',
      'sessions.list',
      'sessions.thread',
    ])
  })
})
