import type { AgentAvailability } from '@hemera/ipc'
import type { BareMode } from '@hemera/ui'

/**
 * An agent's bare mode, in the words the window says it with (design D6-02).
 *
 * What the adapter declared for this platform crosses as three facts — the means, whether it is
 * qualified, the reason it is not — and the Agents section reads them as one line per agent: the
 * means that takes the agent's own tools away, and, for an agent whose means leaves one behind,
 * the adapter's own sentence for why no Session opens on it. Nothing here is decided: a
 * qualification is the adapter's, and a reason is never rewritten.
 *
 * Kept apart from the pages, which import the design system's components, so a test can read it
 * without a theme or a DOM.
 */

/** The bare-mode row of the Agents section, for one agent of this machine. */
export function bareRowOf(agent: AgentAvailability): BareMode {
  const { means, qualified, reason } = agent.bareMode
  if (qualified) return { qualified, reason: `Runs with Hemera's tools only: ${means}.` }
  // The adapter's sentence as it wrote it, and the means it was about after it.
  const said = reason ?? 'Its adapter says it cannot run bare here.'
  return { qualified, reason: `${said} Means tried: ${means}.` }
}
