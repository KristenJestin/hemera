/**
 * A Session's model and effort survive every restart of its agent (issue #133).
 *
 * The user chooses a model and an effort in a Session; the agent that holds it is then let go of
 * and started again — by the pool's idle timer, by a define Session's brief (D7-14), by its own
 * death, by a resume the agent refuses, by the application starting again. Each start answers
 * with an agent on its own defaults, as Claude Code does, and each suite checks what the engine
 * told that agent and what the Session reads back: the choice the user made, and nothing else.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'
import * as TestClock from 'effect/testing/TestClock'

import {
  fakeAgent,
  fakeSupervisorOf,
  type FakeAgent,
  type FakeScript,
} from '#engine/agents/fake.ts'
import { IDLE_AFTER_MS } from '#engine/agents/pool.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Specs } from '#engine/specs/specs.ts'
import { application, aSession, machine, pause } from './application.ts'

let dataFolder: string
let workingDirectory: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-choices-'))
  workingDirectory = mkdtempSync(join(tmpdir(), 'hemera-workspace-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workingDirectory, { recursive: true, force: true })
})

/**
 * An agent that starts on Fable at a high effort, as Claude Code does, and moves when told.
 *
 * Each one is a process of its own: what one was put on, the next knows nothing of.
 */
const onDefaults = (script: Partial<FakeScript> = {}): FakeAgent => {
  let model = 'fable'
  let effort = 'high'
  const now = () => [
    {
      id: 'model',
      type: 'select' as const,
      name: 'Model',
      category: 'model' as const,
      currentValue: model,
      options: [
        { value: 'fable', name: 'Fable 5.1' },
        { value: 'sonnet', name: 'Sonnet 5' },
      ],
    },
    {
      id: 'effort',
      type: 'select' as const,
      name: 'Effort',
      category: 'thought_level' as const,
      currentValue: effort,
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    },
  ]
  return fakeAgent({
    continues: true,
    ...script,
    configOptions: now(),
    onChoice: (choice) => {
      if (choice.id === 'model') model = choice.value
      if (choice.id === 'effort') effort = choice.value
      return now()
    },
  })
}

/** The model and the effort a Session reads, as the composer at its foot draws them. */
const standing = (sessionId: string) =>
  Effect.gen(function* () {
    const runtime = yield* AgentRuntime
    const options = yield* runtime.options(sessionId)
    return Object.fromEntries(options.map((option) => [option.id, option.value]))
  })

/** Waits, moving the engine's clock, until an agent has ended. */
const endedBy = (agent: FakeAgent, move: boolean) =>
  Effect.gen(function* () {
    let ended = false
    void agent.exited.then(() => {
      ended = true
    })
    for (let look = 0; look < 20; look++) {
      if (ended) break
      yield* pause(10)
      if (move) yield* TestClock.adjust(IDLE_AFTER_MS)
    }
    expect(ended).toBe(true)
  })

/** One run of the application whose agent's starts answer `first`, then `second`. */
const twoStarts = (first: FakeAgent, second: FakeAgent) => {
  const queue = [first, second]
  return application(
    dataFolder,
    undefined,
    machine,
    fakeSupervisorOf(() => queue.shift() ?? second),
  )(first)
}

/** A Session put on Sonnet at a low effort by its user, and the turn that follows. */
const chosen = Effect.gen(function* () {
  const runtime = yield* AgentRuntime
  const session = yield* aSession(workingDirectory)
  yield* runtime.setOption(session.id, 'model', 'sonnet')
  yield* runtime.setOption(session.id, 'effort', 'low')
  yield* runtime.prompt(session.id, 'start on the reader')
  expect(yield* standing(session.id)).toEqual({ model: 'sonnet', effort: 'low' })
  return session.id
})

describe("A Session's model and effort survive a restart of its agent", () => {
  test('an agent let go of after its idle time is started again on them', async () => {
    const first = onDefaults()
    const second = onDefaults()

    await twoStarts(
      first,
      second,
    )(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessionId = yield* chosen
        yield* endedBy(first, true)

        yield* runtime.prompt(sessionId, 'carry on')

        expect(second.answers.resumes).toBe(1)
        expect(second.answers.choices).toEqual(['model=sonnet', 'effort=low'])
        expect(yield* standing(sessionId)).toEqual({ model: 'sonnet', effort: 'low' })
      }),
    )
  })

  test('an agent let go of for its define brief is started again on them', async () => {
    const first = onDefaults()
    const second = onDefaults()

    await twoStarts(
      first,
      second,
    )(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const specs = yield* Specs
        const sessionId = yield* chosen

        // What `specs.create` does over the wire: the Session becomes a define one, and its agent
        // is let go of so the next turn starts it with the tools of that mission (D7-14).
        yield* specs.create({ sessionId, type: 'feature', title: 'Export the journal' })
        yield* runtime.releaseWhenIdle(sessionId)
        yield* endedBy(first, false)

        yield* runtime.prompt(sessionId, 'shape it')

        expect(second.answers.choices).toEqual(['model=sonnet', 'effort=low'])
        expect(yield* standing(sessionId)).toEqual({ model: 'sonnet', effort: 'low' })
      }),
    )
  })

  test('an agent that died is started again on them', async () => {
    const first = onDefaults()
    const second = onDefaults()

    await twoStarts(
      first,
      second,
    )(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessionId = yield* chosen
        first.die()
        yield* endedBy(first, false)

        yield* runtime.prompt(sessionId, 'carry on')

        expect(second.answers.choices).toEqual(['model=sonnet', 'effort=low'])
        expect(yield* standing(sessionId)).toEqual({ model: 'sonnet', effort: 'low' })
      }),
    )
  })

  test('an agent that cannot take its session back opens a new one on them', async () => {
    const first = onDefaults()
    const second = onDefaults({ refusesResume: true, refusesLoad: true })

    await twoStarts(
      first,
      second,
    )(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessionId = yield* chosen
        yield* endedBy(first, true)

        const report = yield* runtime.resume(sessionId)

        expect(report.state).toBe('fallback')
        expect(second.answers.choices).toEqual(['model=sonnet', 'effort=low'])
        expect(yield* standing(sessionId)).toEqual({ model: 'sonnet', effort: 'low' })
      }),
    )
  })

  test('the application started again takes the Session back on them', async () => {
    const first = onDefaults()
    const sessionId = await application(dataFolder)(first)(chosen)

    const second = onDefaults()
    await application(dataFolder)(second)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        yield* runtime.prompt(sessionId, 'carry on')

        expect(second.answers.resumes).toBe(1)
        expect(second.answers.choices).toEqual(['model=sonnet', 'effort=low'])
        expect(yield* standing(sessionId)).toEqual({ model: 'sonnet', effort: 'low' })
      }),
    )
  })
})
