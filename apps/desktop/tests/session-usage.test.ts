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
  return run(({ profile }) =>
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
        return { before, after: yield* missionUsage(mission.id) }
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
})
