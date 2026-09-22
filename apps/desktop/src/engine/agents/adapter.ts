/**
 * What an agent is, from Hemera's side (design D5-02, D5-21).
 *
 * Three agents are supported — Claude Code, Codex and OpenCode — and each of them is described
 * by one file under `adapters/`: the command a reader installs and signs into, the sentence
 * that says how to get it, the command that signs it in, where it keeps that login, how to read
 * its version out of what it prints, and what its own answer to `initialize` says about being
 * signed in. This file holds the shape those three agree on, so that a fourth agent becomes a
 * compile error everywhere it has to be mentioned rather than a place someone forgets.
 *
 * The list of them is the domain's and not this file's (`AGENT_PROVIDERS` in `@hemera/core`):
 * a check on `sessions.provider` admits exactly it, so an agent added here alone would be a
 * value the database has never heard of, which is a migration.
 *
 * The agent is the subject of every field below, and the adapter that may expose it is not. Two
 * of the three speak no ACP themselves, and what exposes them is a package of Hemera's — named
 * in `acp`, spawned by the supervisor, never shown and never asked of the reader (D5-21). The
 * Agents page speaks of Claude Code, Codex and OpenCode, and of nothing else.
 *
 * The agent itself is never embedded: it is the command the reader installed and signed in, and
 * it is looked for on the `PATH` they already have (issue decision 93). The **adapter** is the
 * opposite — it is a dependency of this application, resolved out of Hemera's own
 * `node_modules`, because asking a reader to install `claude-agent-acp` is asking them to
 * install Hemera's plumbing (D5-21). An agent that is not installed is not installed, and no
 * other one takes its place (D5-17).
 */

import { AGENT_PROVIDERS, type AgentProvider } from '@hemera/core'

import type { BareMode } from './bare.ts'

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
  /** The agent's own command on the `PATH`: never `npx`, never a path Hemera ships. */
  readonly command: string
  /** What to tell someone who does not have the agent yet. */
  readonly installHint: string
  /**
   * The command that signs this agent in, which is the agent's own and not Hemera's (D5-21).
   *
   * Hemera types none of it: the three sign-ins open a browser or ask a question, and they
   * belong to the tool the reader installed. The line is what the Agents page offers the reader
   * when the machine is not signed in.
   */
  readonly loginHint: string
  /**
   * Where this agent keeps the login its own command wrote, and never what it holds.
   *
   * Read as a presence: discovery needs one bit of it — signed in or not — and the file is the
   * reader's, so it is looked for and never opened (D5-21). The paths are built from the home
   * and the environment of the machine they are looked for on, because each agent decides its
   * own directory and reads its own override: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_DATA_HOME`.
   *
   * A machine that keeps its credentials somewhere no file answers for — the Keychain on macOS,
   * a keyring — is read as signed out here. The word that counts is the one the agent gives at
   * `initialize`, and this is only what can be said before a Session starts.
   */
  readonly loginFiles: (home: string, env: Environment) => readonly string[]
  /**
   * The published package the agent's own command comes from, as the registry names it (design
   * D5-18).
   *
   * It is what an update installs a newer version of, and it is not the command: the command is
   * what the machine runs, the package is what the machine fetches. The two differ for exactly
   * one of the three agents — the command is `opencode`, the package is `opencode-ai` — which is
   * why it is written down rather than read off the command's name. It is the agent's package
   * and never the adapter's: an update moves the agent the reader has (D5-21).
   */
  readonly package: string
  /**
   * How Hemera starts this agent as an agent, which is its own business and never the reader's.
   *
   * Two of the three speak no ACP themselves, and what exposes them is a package Hemera depends
   * on: resolved from its own `node_modules`, spawned by the supervisor, shown to nobody, asked
   * of the reader never (D5-21). The third is the agent's own command with a subcommand, and
   * `from` is which of the two this is. What this is not is something the Agents page may name.
   */
  readonly acp: AcpProcess
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
  /**
   * What running this agent bare means here, and whether it removes everything it ships.
   *
   * The platform is asked rather than read: the answer is declared per platform (D6-02), and a
   * machine cannot try the other one's answer.
   */
  readonly bareMode: (platform: NodeJS.Platform) => BareMode
}

/**
 * What speaks ACP for this agent, and where that command comes from (D5-21).
 *
 * The two cases are the two kinds of agent Hemera supports, and they are written apart because
 * they are found in different places. `bundled` is an adapter that is a dependency of this
 * application: the package is carried with it, its entry module is resolved from what the
 * installation carries, it is forked as a Node script of its own, and the reader never installs
 * it, never sees it and is never asked for it. `agent` is an agent that speaks the protocol
 * itself: the command is the reader's own, on the `PATH` they already have, with the subcommand
 * that starts it as an agent.
 */
export type AcpProcess =
  | {
      readonly from: 'bundled'
      /** The published package of the adapter, as Hemera depends on it. */
      readonly package: string
      /** What starts it as an ACP agent, after the entry module of that package. */
      readonly args: readonly string[]
      /**
       * The environment variable that tells the adapter which agent to run (D5-21).
       *
       * An adapter left to itself runs the agent it carries in an optional dependency of its own
       * — a native binary of a few hundred megabytes per platform — and Hemera ships none of
       * them: the agent is the one the reader installed and signed in, and this is the variable
       * the adapter reads to be told where it is. `CLAUDE_CODE_EXECUTABLE` for Claude Code,
       * `CODEX_PATH` for Codex; each is the adapter's own, read at its start, and each makes the
       * platform binary unnecessary rather than merely unused.
       */
      readonly agentVariable: string
    }
  | {
      readonly from: 'agent'
      /** The agent's own command, looked for on the `PATH` the reader has. */
      readonly command: string
      /** What starts it as an ACP agent, over standard input and standard output. */
      readonly args: readonly string[]
    }

/** The home and the environment an agent's own paths are read against. */
export type Environment = Readonly<Record<string, string | undefined>>

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
