import type { AgentAvailability } from '@hemera/ipc'
import type { BareMode, OfferedAgent } from '@hemera/ui'

/**
 * An agent's bare mode, in the words the window says it with (design D6-02).
 *
 * What the adapter declared for this platform crosses as four facts — the means, whether it is
 * qualified, the reason it is not, and what the means does not reach — and the Agents section
 * reads them as one folded line per agent: for a qualified agent, the sources it still keeps out
 * of Hemera's sight (D6-09); for one whose means leaves a tool behind, the adapter's own sentence
 * for why no Session opens on it. Nothing here is decided: a qualification is the adapter's, and
 * a reason is never rewritten.
 *
 * Kept apart from the pages, which import the design system's components, so a test can read it
 * without a theme or a DOM.
 */

/** The bare-mode line of the Agents section, for one agent of this machine. */
export function bareRowOf(agent: AgentAvailability): BareMode {
  const { means, qualified, reason } = agent.bareMode
  if (qualified) return { qualified, private: agent.bareMode.private }
  // The adapter's sentence as it wrote it, and the means it was about after it.
  const said = reason ?? 'Its adapter says it cannot run bare here.'
  return { qualified, reason: `${said} Means tried: ${means}.` }
}

/**
 * An agent of this machine, as the Home's composer offers it (design D5-21, D6-02).
 *
 * An agent is offered when a Session could be made on it: it is installed, signed in, and its
 * combination is qualified here. One that is not is drawn and cannot be picked, and the hint is
 * the way out of it in the engine's own words — the command that installs it, the command that
 * signs it in — which is the one thing the reader can act on.
 *
 * An agent that cannot run bare has nothing the reader can type, so its hint is one line and not
 * the adapter's reason: that reason is a paragraph, and a menu entry that carried it was an entry
 * nobody could read the list past. It stays whole in Settings › Agents, under the agent, and in
 * the refusal `sessions.create` answers with.
 */
export function offeredOf(agent: AgentAvailability): OfferedAgent {
  const { qualified } = agent.bareMode
  const offered: OfferedAgent = {
    id: agent.id,
    name: agent.label,
    // Not qualified is not "not installed", and the hint says which it is: the menu reads an
    // agent it cannot offer from this flag, and the sentence under it from the hint.
    available: agent.found && qualified,
    signedIn: agent.authenticated,
  }
  if (!agent.found) offered.hint = agent.installHint
  else if (!qualified) offered.hint = 'Not available here'
  else if (!agent.authenticated) offered.hint = agent.loginHint
  return offered
}
