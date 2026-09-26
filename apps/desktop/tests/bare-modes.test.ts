/**
 * An OpenCode Session in bare mode has no mode to choose (issue #128).
 *
 * Hemera runs OpenCode with `build` and `plan` disabled and an agent of its own, `hemera`, as the
 * only one. The Home's composer asks an OpenCode opened without that configuration, which
 * announces `build` and `plan`; the Session's agent announces `hemera`. Neither is a choice the
 * user has: no mode is offered before the start or after it, and none is ever sent — a `build`
 * sent to a bare OpenCode is refused (`mode not found: build`).
 *
 * The suites run on the fake agent, standing in for OpenCode under its adapter, qualified on every
 * platform so the Linux runner reads the same thing as Windows.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'

import { fakeAgent, fakeSupervisorOf, type FakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Preferences } from '#engine/preferences.ts'
import { Projects } from '#engine/projects.ts'
import { Sessions } from '#engine/sessions.ts'
import { application, machine } from './application.ts'
import { withQualifiedOpenCode } from './unqualified.ts'

let dataFolder: string
let workingDirectory: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-bare-modes-'))
  workingDirectory = mkdtempSync(join(tmpdir(), 'hemera-workspace-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workingDirectory, { recursive: true, force: true })
})

withQualifiedOpenCode()

const MODEL = {
  id: 'model',
  type: 'select' as const,
  name: 'Model',
  category: 'model' as const,
  currentValue: 'opencode/deepseek',
  options: [
    { value: 'opencode/deepseek', name: 'OpenCode Zen/DeepSeek' },
    { value: 'opencode/grok', name: 'OpenCode Zen/Grok' },
  ],
}

/** The modes of an OpenCode, as it announces them with and without Hemera's configuration. */
const modesOf = (values: readonly string[]) => ({
  id: 'mode',
  type: 'select' as const,
  name: 'Mode',
  category: 'mode' as const,
  currentValue: values[0] ?? '',
  options: values.map((value) => ({ value, name: value })),
})

/** An OpenCode that announces these modes, and refuses to be put on any other. */
const openCode = (modes: readonly string[]): FakeAgent =>
  fakeAgent({
    configOptions: [MODEL, modesOf(modes)],
    onChoice: (choice) => {
      if (choice.id === 'mode' && !modes.includes(choice.value)) {
        throw new Error(`Invalid params: mode not found: ${choice.value}`)
      }
      return [MODEL, modesOf(modes)]
    },
  })

/** The Home's probe, opened without Hemera's configuration, then the Session's bare agent. */
const probeThenSession = () => {
  const probe = openCode(['build', 'plan'])
  const session = openCode(['hemera'])
  const queue = [probe, session]
  const run = application(
    dataFolder,
    undefined,
    machine,
    fakeSupervisorOf(() => queue.shift() ?? session),
  )(probe)
  return { probe, session, run }
}

/** What an option list holds, by id. */
const ids = (options: readonly { readonly id: string }[]) => options.map((option) => option.id)

describe('An OpenCode Session in bare mode has no mode', () => {
  test("the Home's composer offers no mode for OpenCode, and sends none", async () => {
    const { probe, run } = probeThenSession()

    await run(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const project = yield* projects.create({
          name: 'Atlas',
          tone: 'primary',
          mainPath: workingDirectory,
        })

        // `build` and `plan` are what an OpenCode without Hemera's configuration announces: not
        // what the Session will run, so not offered.
        const offered = yield* runtime.offer(project.id, 'opencode')
        expect(offered.refusal).toBeNull()
        expect(ids(offered.options)).toEqual(['model'])

        // A mode asked for anyway is refused here, and never reaches the agent.
        const asked = yield* runtime.offerSet(project.id, 'opencode', 'mode', 'build')
        expect(asked.refusal).not.toBeNull()
        const model = yield* runtime.offerSet(project.id, 'opencode', 'model', 'opencode/grok')
        expect(ids(model.options)).toEqual(['model'])
        expect(probe.answers.choices).toEqual(['model=opencode/grok'])
      }),
    )
  })

  test('a bare OpenCode start sends no set_config_option for mode', async () => {
    // No Home probe here: the one process started is the Session's, bare.
    const agent = openCode(['hemera'])

    await application(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const sessions = yield* Sessions
        const preferences = yield* Preferences
        const project = yield* projects.create({
          name: 'Atlas',
          tone: 'primary',
          mainPath: workingDirectory,
        })
        // A composer left on `build` by a version that offered it: what the Session inherits.
        yield* preferences.write({
          composers: {
            [project.id]: {
              provider: 'opencode',
              options: { mode: 'build', model: 'opencode/grok' },
            },
          },
        })

        const session = yield* sessions.create(project.id, 'opencode')
        const turn = yield* runtime.prompt(session.id, 'Look at the export')
        expect(turn.stopReason).toBe('end_turn')

        // The model is put back; no mode is sent at all, `build` or any other.
        expect(agent.answers.choices).toEqual(['model=opencode/grok'])
        // And `hemera`, Hemera's own agent, is never offered as a mode of the Session.
        expect(ids(yield* runtime.options(session.id))).toEqual(['model'])
        // Asked for directly, it is refused before anything is sent.
        const refused = yield* Effect.flip(runtime.setOption(session.id, 'mode', 'hemera'))
        expect(refused.message).toContain('no mode')
        expect(agent.answers.choices).toEqual(['model=opencode/grok'])
      }),
    )
  })
})
