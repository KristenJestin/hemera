/**
 * A call whose arguments nest far deeper than a call stack reaches: the gate answers it, records
 * it with the depth masked, and never fails; a call nested past `NESTING_LIMIT` is refused, never
 * asked about a copy cut at the limit (#404). The engine is the real one; the question and the
 * verdict are the ports, handed as parts that answer as each test says.
 */

import { realpathSync } from 'node:fs'

import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { MASK, NESTING_LIMIT } from '@hemera/core/domain'

import { Database } from '../src/engine/storage/database.ts'
import { permissionRequests, toolCalls } from '../src/engine/storage/schema.ts'
import { commandsEngine } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import {
  acmeWithMission,
  callTool,
  questionsKept,
  sessionOf,
  verdictsSaying,
} from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('nesting'))
  work = realpathSync.native(temporaryFolder('nesting-work'))
})
afterEach(removeFolders)

/** A value `levels` deep, built from the inside out, so building it takes no recursion. */
const nested = (levels: number): Schema.Json => {
  let value: Schema.Json = 'bottom'
  for (let level = 0; level < levels; level += 1) value = { next: value }
  return value
}

const LEVELS = 100_000

const callsOf = (sessionId: string) =>
  Effect.flatMap(Database, (database) =>
    database.select().from(toolCalls).where(eq(toolCalls.sessionId, sessionId)),
  )

describe('A call whose arguments nest 100,000 levels deep is answered, never failed', () => {
  test('arguments that do not read are refused with an answer, and recorded with the depth masked', async () => {
    const [answer, calls] = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const refused = yield* callTool(builder.grantId, 'fs_read', { path: nested(LEVELS) })
          return [refused, yield* callsOf(builder.sessionId)] as const
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(answer.text).toMatch(/^refused: the arguments of fs_read do not read/)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.outcome).toBe('refused')
    // The record keeps the start of the arguments, cut: the depth never reaches it.
    expect(calls[0]?.arguments).toMatch(/^\{"path":\{"next":\{"next":/)
    expect(calls[0]?.arguments?.length).toBeLessThanOrEqual(2_001)
  })

  test('arguments that are a list 100,000 levels deep, not a record, are refused with an answer and recorded with the depth cut', async () => {
    let list: Schema.Json = 'bottom'
    for (let level = 0; level < LEVELS; level += 1) list = [list]
    const [answer, calls] = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const refused = yield* callTool(builder.grantId, 'fs_read', list)
          return [refused, yield* callsOf(builder.sessionId)] as const
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.outcome).toBe('refused')
    expect(calls[0]?.arguments).toMatch(/^\[\[\[/)
    expect(calls[0]?.arguments).not.toContain('bottom')
  })

  test('a call that would ask, with a deep field beside its arguments, is refused with an answer and asks nothing (#404)', async () => {
    const verdicts = verdictsSaying(() => ({
      verdict: 'ask',
      reason: 'a write in the Workspace',
      by: 'suite',
    }))
    const questions = questionsKept()
    const [answer, calls] = await commandsEngine(data, {
      tools: { verdicts: verdicts.layer, permissionRequests: questions.layer },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const refused = yield* callTool(builder.grantId, 'fs_write', {
            path: 'notes.md',
            content: 'x',
            extra: nested(LEVELS),
          })
          return [refused, yield* callsOf(builder.sessionId)] as const
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(answer.text).toBe(
      `refused: the arguments of fs_write nest deeper than ${String(NESTING_LIMIT)} levels; send them flatter`,
    )
    expect(questions.asked).toHaveLength(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.outcome).toBe('refused')
    expect(calls[0]?.arguments).not.toContain('bottom')
  })

  /** The requests stored after one call of fs_write whose `extra` field nests `levels` deep. */
  const requestsAfter = (levels: number) => {
    const verdicts = verdictsSaying(() => ({
      verdict: 'ask',
      reason: 'a write in the Workspace',
      by: 'suite',
    }))
    return commandsEngine(data, { tools: { verdicts: verdicts.layer } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const asked = yield* callTool(builder.grantId, 'fs_write', {
            path: 'notes.md',
            content: 'x',
            extra: nested(levels),
          })
          const rows = yield* Effect.flatMap(Database, (database) =>
            database.select().from(permissionRequests),
          )
          return [asked, rows] as const
        }),
      ),
    )
  }

  test('a call nested one level past the limit is never stored as a request, so no cut copy can run (#404)', async () => {
    // The arguments are the first container: `extra` holds the rest.
    const [answer, stored] = await requestsAfter(NESTING_LIMIT)
    expect(answer.text).toMatch(/^refused: the arguments of fs_write nest deeper than/)
    expect(stored).toHaveLength(0)
  })

  test('a call nested to the limit exactly asks, and its request holds the call whole (#404)', async () => {
    const [answer, stored] = await requestsAfter(NESTING_LIMIT - 1)
    expect(answer.text).toMatch(/^Waiting for the user's approval, request #1\./)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.call).toContain('"bottom"')
    expect(stored[0]?.call).not.toContain(MASK)
  })
})
