import type { ReactNode } from 'react'

import { IconBrandClaude, IconBrandOpenai, IconBrandOpencode } from '../icons.ts'

/**
 * The mark of the agent a control belongs to (design D17-11).
 *
 * The mark is looked up by the id the engine sends and not by the name the registry shows: an id
 * is the one stable word for an agent — `opencode` is `opencode` whatever a release decides to
 * call it on screen — while a name is a label. The name is still what the monogram is built
 * from, because a reader recognises `Claude Code` where they would not recognise `claude`.
 *
 * An agent the catalogue has no mark for is written as its own initials rather than handed
 * another agent's mark or a generic robot: a mark that means "some agent" says less than two
 * letters that mean "this one". Where a mark came from and what allows it to be drawn here is
 * written in `packages/ui/LICENSES.md`, one section per mark: the marks vendored in `icons.ts`
 * are redistributable artwork used to name the agent a control chooses, and nothing more.
 *
 * Nothing is fetched. A mark that had to leave the machine to be drawn would be a request made
 * to paint a button, and a window that opens offline would open with holes in it.
 */
const MONOGRAM =
  'flex size-icon-md shrink-0 items-center justify-center rounded-sm border border-border text-xs font-medium tracking-wide text-muted-foreground uppercase'

/**
 * The marks the catalogue has, by the id the engine sends.
 *
 * Several ids to one mark where an agent is reached by more than one name: Codex answers to
 * `codex` on one machine and to `openai` on the next, and both are the same company's mark.
 */
const MARKS = [
  {
    ids: ['openai', 'codex', 'chatgpt'],
    draw: (className: string | undefined) => <IconBrandOpenai size="md" className={className} />,
  },
  {
    ids: ['opencode'],
    draw: (className: string | undefined) => <IconBrandOpencode size="md" className={className} />,
  },
  {
    ids: ['claude', 'claude-code', 'anthropic'],
    draw: (className: string | undefined) => <IconBrandClaude size="md" className={className} />,
  },
] as const

export interface AgentMarkProps {
  /** The agent, as the registry names it; what the monogram is built from. */
  agent: string
  /** The id the engine sends, which is what the mark is looked up by. */
  agentId?: string | undefined
  /** Where the mark sits; never how it looks. */
  className?: string | undefined
}

export function AgentMark({ agent, agentId, className }: AgentMarkProps): ReactNode {
  // The id where there is one, the name where the caller only has that: a control handed a name
  // alone still draws the mark it can.
  const asked = (agentId ?? agent).trim().toLowerCase()
  const found = MARKS.find((mark) => mark.ids.some((id) => id === asked))
  if (found !== undefined) return found.draw(className)
  return (
    // A mark and not a word: beside a label that already names the thing, initials are read as
    // part of that name — "CC Haiku 4.5" — and two letters that stand for an agent are not its
    // name.
    <span
      aria-hidden="true"
      className={className === undefined ? MONOGRAM : `${MONOGRAM} ${className}`}
    >
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
