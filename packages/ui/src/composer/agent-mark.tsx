import type { ReactNode } from 'react'

import { IconBrandOpenai } from '../icons.ts'

/**
 * The mark of the agent a control belongs to (design D17-11).
 *
 * The catalogue carries the mark of exactly one of them, and that is on purpose: Tabler has a
 * handful of brand icons and no invented logo is drawn here. An agent the catalogue does not
 * have is written as its own initials rather than handed another agent's mark or a generic
 * robot, because a mark that means "some agent" says less than two letters that mean "this one".
 *
 * The initials are read off the name the registry gives, never off the id: an id is a wire
 * value, and a reader recognises `Claude Code` where they would not recognise `claude`.
 *
 * Nothing is fetched. A mark that had to leave the machine to be drawn would be a request made
 * to paint a button, and a window that opens offline would open with holes in it.
 */
const MONOGRAM =
  'flex size-icon-md shrink-0 items-center justify-center rounded-sm border border-border text-xs font-medium tracking-wide text-muted-foreground uppercase'

/** The agents whose mark the catalogue has, by the name and the id the registry gives them. */
const CATALOGUED = ['openai', 'codex', 'chatgpt']

export interface AgentMarkProps {
  /** The agent, as the registry names it. */
  agent: string
  /** Where the mark sits; never how it looks. */
  className?: string | undefined
}

export function AgentMark({ agent, className }: AgentMarkProps): ReactNode {
  if (CATALOGUED.includes(agent.trim().toLowerCase())) {
    return <IconBrandOpenai size="md" className={className} />
  }
  return (
    <span className={className === undefined ? MONOGRAM : `${MONOGRAM} ${className}`}>
      {initialsOf(agent)}
    </span>
  )
}

/** Two letters, from one word or from two: whatever tells this agent from the next one. */
function initialsOf(agent: string): string {
  const words = agent
    .trim()
    .split(/[\s_-]+/u)
    .filter((word) => word !== '')
  const [first, second] = words
  if (first === undefined) return '?'
  if (second === undefined) return first.slice(0, 2)
  return `${first.charAt(0)}${second.charAt(0)}`
}
