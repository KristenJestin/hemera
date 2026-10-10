/**
 * Usage (#41): what each session's agent reports it used, tokens in and out and the cost when it
 * gives one, summed per mission and marked measured; an estimate when it reports nothing, marked
 * as such; nothing at all when no session ran. On the engine as it starts, with the fake agent.
 */

import { realpathSync } from 'node:fs'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { missionUsage } from '../src/engine/sessions/usage.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeIn, sessionsEngine, until, within } from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('session-usage'))
  work = realpathSync.native(temporaryFolder('session-usage-work'))
})
afterEach(removeFolders)

const acme = Effect.suspend(() => acmeIn(work))

/**
 * The mission's usage before and after `sessions` sessions ran their first turn; with `cost`, once
 * the agents' reports of it arrived, which come beside their turns.
 */
const usageAfterOneTurn = (script: FakeScript, sessions = 1, cost: number | null = null) => {
  const { run } = sessionsEngine(data, () => script)
  return run(({ profile, lines }) =>
    within(
      profile,
      Effect.gen(function* () {
        const { owner, main, mission } = yield* acme
        const before = yield* missionUsage(mission.id)
        for (let opened = 0; opened < sessions; opened += 1) {
          const session = yield* Sessions.use((all) =>
            all.open({ owner, role: 'helper', provider: 'claude', folder: main }),
          )
          yield* Sessions.use((all) => all.settled(session.id))
        }
        if (cost !== null) {
          yield* until(
            Effect.map(missionUsage(mission.id), (usage) => usage?.cost?.amount === cost),
          )
        }
        return { before, after: yield* missionUsage(mission.id), lines }
      }),
    ),
  )
}

describe('Usage', () => {
  test('what the agent reports is summed per mission, with its cost, and marked measured', async () => {
    const usage = await usageAfterOneTurn(
      {
        steps: [
          { does: 'says', text: 'done' },
          { does: 'spends', used: 1200, size: 200_000, cost: { amount: 0.25, currency: 'USD' } },
        ],
        usage: { totalTokens: 1300, inputTokens: 1000, outputTokens: 300 },
      },
      2,
      0.5,
    )
    expect(usage.before).toBeNull()
    expect(usage.after).toEqual({
      inputTokens: 2000,
      outputTokens: 600,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      cost: { amount: 0.5, currency: 'USD' },
      measured: true,
    })
  })

  test('usage without a measure is an estimate, flagged as such', async () => {
    const usage = await usageAfterOneTurn({ steps: [{ does: 'says', text: 'done' }] })
    expect(usage.after?.measured).toBe(false)
    expect(usage.after?.inputTokens).toBeGreaterThan(0)
    expect(usage.after?.outputTokens).toBe(1)
    expect(usage.after?.cost).toBeNull()
  })

  test('the cache tokens of a turn are kept, summed per mission', async () => {
    // Both adapters report the input that was neither read nor written as `inputTokens`.
    const usage = await usageAfterOneTurn(
      {
        steps: [{ does: 'says', text: 'done' }],
        usage: {
          totalTokens: 7800,
          inputTokens: 300,
          outputTokens: 100,
          cachedReadTokens: 6000,
          cachedWriteTokens: 1400,
        },
      },
      2,
    )
    expect(usage.after).toMatchObject({
      inputTokens: 600,
      outputTokens: 200,
      cachedReadTokens: 12_000,
      cachedWriteTokens: 2800,
      measured: true,
    })
  })

  test('an agent that reports no cache tokens counts none', async () => {
    const usage = await usageAfterOneTurn({
      steps: [{ does: 'says', text: 'done' }],
      usage: { totalTokens: 1300, inputTokens: 1000, outputTokens: 300 },
    })
    expect(usage.after).toMatchObject({ cachedReadTokens: 0, cachedWriteTokens: 0 })
  })

  test('the diagnostic log says what a turn used, cache tokens included', async () => {
    const usage = await usageAfterOneTurn({
      steps: [{ does: 'says', text: 'done' }],
      usage: {
        totalTokens: 7800,
        inputTokens: 300,
        outputTokens: 100,
        cachedReadTokens: 6000,
        cachedWriteTokens: 1400,
      },
    })
    const line = usage.lines.find((entry) => entry.includes('used'))
    expect(line).toMatch(/input 300, output 100, cache read 6000, cache write 1400/)
  })
})
