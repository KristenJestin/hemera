/**
 * The agent of the headless end-to-end suite: the fake agent of #32, answering for Claude Code,
 * so that the packaged engine never starts a real agent while the suite runs, and the suite can
 * send a message, see a folded action, answer a held call. The other agents are not installed
 * there, whatever this machine has: the run is the same on every machine.
 *
 * The suite scripts it through its probe (`probe.ts`): every session started from then on does
 * what the script given last says. The engine builds this only when main hands it the probe's
 * port (`suiteFor`), which main does only under the suite in an application that is not packaged
 * (`suiteRuns`), never from the environment alone. The fake itself is loaded only then, so an
 * installed Hemera never runs its code.
 */

import { AGENT_PROVIDERS, type AgentProvider } from '@hemera/core/domain'
import { AgentNotInstalled, Qualified } from '@hemera/ipc'
import { Effect, Layer, Ref } from 'effect'

import type { DiscoveredAgent } from './discovery.ts'
import { Discovery } from './discovery.ts'
import { ADAPTERS } from './adapters/index.ts'
import type { FakeScript } from './fake.ts'
import { AgentRegistry, AgentUpdater } from './installer.ts'
import { AgentStarter } from './runtime.ts'
import { type Agents, agentsLayer } from './service.ts'

/** The agent the fake answers for. */
export const SUITE_AGENT: AgentProvider = 'claude'

/** What it does until the suite says otherwise: a short answer, nothing else. */
const DEFAULT_SCRIPT: FakeScript = { steps: [{ does: 'says', text: 'Done.' }] }

export interface SuiteAgent {
  /** The sessions' parts: where the agents are found, and how they start. */
  readonly sessions: {
    readonly discovery: Layer.Layer<Discovery>
    readonly starter: Layer.Layer<AgentStarter>
  }
  /**
   * The agents the window lists and offers (the setup's offer among them): the same as the
   * sessions find, with no registry asked and nothing updated.
   */
  readonly agents: Layer.Layer<Agents>
  /** What every session started from now on does. */
  readonly script: (script: FakeScript) => Effect.Effect<void>
}

/** The suite's agent, the fake loaded as it is built. */
export const suiteAgent: Effect.Effect<SuiteAgent> = Effect.map(
  Effect.promise(() => import('./fake.ts')),
  ({ fakeAgent }) => {
    const current = Ref.makeUnsafe(DEFAULT_SCRIPT)
    const listed = (id: AgentProvider): DiscoveredAgent => {
      const adapter = ADAPTERS[id]
      const ours = id === SUITE_AGENT
      return {
        id,
        label: adapter.label,
        installed: ours,
        path: ours ? `/suite/${adapter.command}` : null,
        version: ours ? '1.0.0' : null,
        signedIn: ours,
        installer: 'unknown',
        qualification: Qualified.make({}),
        installHint: adapter.installHint,
        loginHint: adapter.loginHint,
      }
    }
    const discovery = Layer.succeed(Discovery, {
      list: Effect.succeed(AGENT_PROVIDERS.map(listed)),
      probe: () => Effect.succeed('1.0.0'),
      resolve: (id) =>
        id === SUITE_AGENT
          ? Effect.succeed({
              adapter: ADAPTERS[id],
              from: 'bundled' as const,
              program: '/suite/fake-agent',
              args: [],
              env: {},
              own: {},
            })
          : Effect.fail(new AgentNotInstalled({ agent: id, label: ADAPTERS[id].label })),
    })
    return {
      sessions: {
        discovery,
        starter: Layer.succeed(AgentStarter, {
          start: () => Effect.map(Ref.get(current), (script) => fakeAgent(script).process),
        }),
      },
      agents: agentsLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            discovery,
            Layer.succeed(AgentRegistry, { latest: () => Effect.succeed(null) }),
            Layer.succeed(AgentUpdater, { run: () => Effect.succeed('') }),
          ),
        ),
      ),
      script: (script) => Ref.set(current, script),
    }
  },
)

/** The suite's agent when main handed the engine the probe's port, and none otherwise. */
export const suiteFor = <Port>(probe: Port | undefined): Effect.Effect<SuiteAgent | null> =>
  probe === undefined ? Effect.succeed(null) : suiteAgent
