/**
 * The three agents, as this machine and their registries answer for them (design D5-18).
 *
 * This is what the Agents section of the settings is drawn from, and it is two different
 * questions rather than one. `list` is local and answers in milliseconds: which commands the
 * machine has, what version each prints, and the tool that put it there. `check` is the same
 * answer with one more field filled in, and it is the only thing in this file that leaves the
 * machine — it reads the registry of each agent's own installer, which is why it is asked for
 * when the section is opened and never on a schedule, and why a registry that says nothing
 * leaves a version unknown rather than making the section fail.
 *
 * `update` is the one thing here that changes the machine, and it happens only because somebody
 * pressed a button. It runs the tool that installed the agent — never a command of Hemera's own,
 * never a download into a directory Hemera owns — and answers with what that tool printed. What
 * it cannot place it refuses, in a sentence that says so, rather than trying an update that
 * would fail for a reason the reader could not act on.
 */

import { Context, Data, Effect, Layer } from 'effect'

import type { AgentAvailability, AgentProvider, AgentUpdate } from '@hemera/ipc'

import type { DiscoveredAgent } from './discovery.ts'
import { ADAPTERS, Discovery } from './discovery.ts'
import { AgentRegistry, AgentUpdater } from './installer.ts'

/**
 * An update that Hemera will not run, in a sentence written for whoever pressed the button.
 *
 * The two ways it happens are both about placement rather than about the agent: the command is
 * not on this machine, or it is and nothing here can say which tool put it there. Neither is a
 * failure of the update, and both are shown as what they are.
 */
export class AgentUpdateRefusedError extends Data.TaggedError('AgentUpdateRefusedError')<{
  readonly reason: string
}> {}

export interface AgentsService {
  /** The three agents as this machine answers for them, with nothing read over the network. */
  readonly list: () => Effect.Effect<readonly AgentAvailability[]>
  /** The same, with the latest published version filled in from each agent's own registry. */
  readonly check: () => Effect.Effect<readonly AgentAvailability[]>
  /** Runs the installer's own update command, once somebody has asked for it. */
  readonly update: (id: AgentProvider) => Effect.Effect<AgentUpdate, AgentUpdateRefusedError>
}

export class Agents extends Context.Service<Agents, AgentsService>()('Agents') {}

/**
 * One discovered agent, as the section reads it.
 *
 * Nothing is decided here: discovery has already said which command was found, where, and the
 * tool that put it there, so this is the same answer with the one field discovery never fills —
 * the version a registry publishes, which is `latest` and is null until somebody asks (D5-18).
 */
export function availabilityOf(agent: DiscoveredAgent, latest: string | null): AgentAvailability {
  return {
    id: agent.id,
    label: agent.label,
    found: agent.found,
    version: agent.version ?? null,
    authenticated: agent.authenticated,
    installHint: agent.installHint,
    installer: agent.installer,
    latest,
  }
}

/**
 * The three agents, over discovery and the two ports an update needs.
 *
 * Discovery is asked again on every call rather than memoized: a machine has an agent installed
 * while the window is open, and the section that says so is the one place where being stale is
 * the whole of what is wrong with it.
 */
export const agentsLayer = Layer.effect(
  Agents,
  Effect.gen(function* () {
    const discovery = yield* Discovery
    const registry = yield* AgentRegistry
    const updater = yield* AgentUpdater

    return {
      list: () =>
        Effect.map(discovery.list(), (found) => found.map((a) => availabilityOf(a, null))),

      // Asked of the three at once: the section waits for the slowest registry, not for the sum
      // of three registries that do not answer.
      check: () =>
        Effect.flatMap(discovery.list(), (found) =>
          Effect.forEach(
            found,
            (agent) =>
              Effect.gen(function* () {
                const asked = agent.found && agent.installer !== 'unknown'
                const latest = asked
                  ? yield* registry.latest(ADAPTERS[agent.id], agent.installer)
                  : null
                return availabilityOf(agent, latest)
              }),
            { concurrency: 'unbounded' },
          ),
        ),

      update: (id) =>
        Effect.gen(function* () {
          const adapter = ADAPTERS[id]
          const found = (yield* discovery.list()).find((agent) => agent.id === id)
          if (found === undefined || !found.found || found.path === undefined) {
            return yield* Effect.fail(
              new AgentUpdateRefusedError({
                reason: `${adapter.label} is not on this machine, so there is nothing to update.`,
              }),
            )
          }
          if (found.installer === 'unknown') {
            return yield* Effect.fail(
              new AgentUpdateRefusedError({
                reason: `Nothing here can say which tool installed ${adapter.label} (${adapter.command}), and Hemera updates an agent with the tool that installed it.`,
              }),
            )
          }
          return yield* updater.run(adapter, found.installer)
        }),
    } satisfies AgentsService
  }),
)
