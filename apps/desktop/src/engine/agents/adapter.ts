/**
 * What an agent is, from Hemera's side (design D5-02).
 *
 * Three agents are supported — Claude Code, Codex and OpenCode — and each of them is described
 * by one file under `adapters/`: the command to look for on the machine, the arguments that
 * start it as an ACP agent, how to read its version out of what it prints, and what its own
 * answer to `initialize` says about being signed in. This file holds the shape those three
 * agree on, so that a fourth agent becomes a compile error everywhere it has to be mentioned
 * rather than a place someone forgets.
 *
 * The list of them is the domain's and not this file's (`AGENT_PROVIDERS` in `@hemera/core`):
 * a check on `sessions.provider` admits exactly it, so an agent added here alone would be a
 * value the database has never heard of, which is a migration.
 *
 * Nothing about an agent is embedded here. None of the three is a dependency of this
 * application, and every command is looked for on the `PATH` the user already has (issue
 * decision 93). An agent that is not installed is not installed, and no other one takes its
 * place (D5-17).
 */

import { AGENT_PROVIDERS, type AgentProvider } from '@hemera/core'

export { AGENT_PROVIDERS, type AgentProvider }

/**
 * An agent, as Hemera describes it to itself.
 *
 * An adapter is a description and nothing else: it starts no process and resolves no path —
 * discovery asks the machine, and the supervisor starts what discovery resolved. What an
 * adapter does hold is the two readings that belong to its own agent, because the three agents
 * do not print the same things.
 */
export interface AgentAdapter {
  readonly id: AgentProvider
  /** What the Agents page calls it, as its own documentation does. */
  readonly label: string
  /** The command to look for on the `PATH`: never `npx`, never a path Hemera ships. */
  readonly command: string
  /** What starts it as an ACP agent, over standard input and standard output. */
  readonly args: readonly string[]
  /** What to tell someone who does not have the agent yet. */
  readonly installHint: string
  /**
   * The published package the command comes from, as the registry names it (design D5-18).
   *
   * It is what an update installs a newer version of, and it is not the command: the command is
   * what the machine runs, the package is what the machine fetches. The two differ for exactly
   * one of the three agents — the command is `opencode`, the package is `opencode-ai` — which is
   * why it is written down rather than read off the command's name.
   */
  readonly package: string
  /** The version this agent printed, or `undefined` when the line carries none. */
  readonly readVersion: (output: string) => string | undefined
  /**
   * Whether what the agent announced at `initialize` leaves it usable.
   *
   * ACP publishes in that answer the methods the user still has to go through, and each of the
   * three agents publishes its own: an adapter reads the list against its own agent's methods,
   * because a login that means "sign in on this machine" and a key that is offered whether the
   * machine is signed in or not do not say the same thing. An agent read as not signed in is
   * not started, and is not replaced by another one (D5-17).
   */
  readonly isAuthenticated: (
    methods: readonly { readonly id: string; readonly name?: string }[],
  ) => boolean
}

/**
 * The version inside a line an agent printed, wherever in the line it sits.
 *
 * The three agents answer `--version` with their version and disagree about everything else on
 * the line, so what is read is the shape they share: the version itself. An agent that printed
 * none answers `undefined`, which the Agents page shows as a version it does not know rather
 * than as an agent it did not find.
 */
export function versionIn(output: string): string | undefined {
  return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(output)?.[0]
}
