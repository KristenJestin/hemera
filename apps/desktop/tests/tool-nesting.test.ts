/**
 * A call whose arguments nest far deeper than a call stack reaches: the gate answers it, records
 * it with the depth masked, and never fails. The engine is the real one; the question and the
 * verdict are the ports, handed as parts that answer as each test says.
 */

import { realpathSync } from 'node:fs'

import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

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

  test('a call that reads, with a deep field beside its arguments, asks its one question and is recorded', async () => {
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
          const asked = yield* callTool(builder.grantId, 'fs_write', {
            path: 'notes.md',
            content: 'x',
            extra: nested(LEVELS),
          })
          return [asked, yield* callsOf(builder.sessionId)] as const
        }),
      ),
    )
    expect(answer.text).toBe('refused: approvals are not available yet')
    expect(questions.asked).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.arguments).not.toContain('bottom')
  })

  test('a call that asks, with a deep field beside its arguments, is stored as a request with the depth cut', async () => {
    const verdicts = verdictsSaying(() => ({
      verdict: 'ask',
      reason: 'a write in the Workspace',
      by: 'suite',
    }))
    const [answer, stored] = await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
            const asked = yield* callTool(builder.grantId, 'fs_write', {
              path: 'notes.md',
              content: 'x',
              extra: nested(LEVELS),
            })
            const rows = yield* Effect.flatMap(Database, (database) =>
              database.select().from(permissionRequests),
            )
            return [asked, rows] as const
          }),
        ),
    )
    expect(answer.text).toMatch(/^Waiting for the user's approval, request #1\./)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.call).not.toContain('bottom')
    expect(() => JSON.parse(stored[0]?.call ?? '')).not.toThrow()
    expect(stored[0]?.call).toContain('"path":"notes.md"')
  })
})
