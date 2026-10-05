import { cn } from 'cn'
import type { ReactNode } from 'react'

import { type IconSize, IconBrandClaude, IconBrandOpenai, IconBrandOpencode } from '../../icons.ts'

/**
 * The mark of an agent, looked up by the id the engine sends: Claude Code, Codex, OpenCode. An
 * agent the catalogue has no mark for is its initials rather than another agent's mark. The
 * vendored marks and what allows them are written in `packages/ui/LICENSES.md`. Nothing is
 * fetched: a window that opens offline opens without holes.
 */
const MONOGRAM =
  'flex shrink-0 items-center justify-center rounded-sm border border-border text-xs font-medium tracking-wide text-muted-foreground uppercase'

const SIZES: Record<IconSize, string> = {
  sm: 'size-icon-sm',
  md: 'size-icon-md',
  lg: 'size-icon-lg',
}

const MARKS = [
  { ids: ['claude', 'claude-code', 'anthropic'], Mark: IconBrandClaude },
  { ids: ['codex', 'openai', 'chatgpt'], Mark: IconBrandOpenai },
  { ids: ['opencode'], Mark: IconBrandOpencode },
] as const

export interface AgentMarkProps {
  /** The id the engine sends: what the mark is looked up by. */
  id: string
  /** The agent's name: what the initials are made of. */
  name: string
  size?: IconSize | undefined
  /** Where the mark sits; never how it looks. */
  className?: string | undefined
}

/** Two letters, from one word or from two. */
function initialsOf(name: string): string {
  const [first, second] = name.trim().split(/[\s_-]+/)
  if (first === undefined || first === '') return '?'
  return second === undefined ? first.slice(0, 2) : `${first.charAt(0)}${second.charAt(0)}`
}

export function AgentMark({ id, name, size = 'md', className }: AgentMarkProps): ReactNode {
  const found = MARKS.find((mark) => mark.ids.some((one) => one === id.toLowerCase()))
  if (found !== undefined)
    return <found.Mark size={size} aria-hidden="true" className={className} />
  return (
    <span aria-hidden="true" className={cn(MONOGRAM, SIZES[size], className)}>
      {initialsOf(name)}
    </span>
  )
}
