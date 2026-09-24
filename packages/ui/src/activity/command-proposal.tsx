import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { IconCheck, IconX } from '../icons.ts'
import { COMMAND_TYPE_ICONS, COMMAND_TYPE_LABELS, type CommandType } from './command-type.ts'

/**
 * A command the agent proposes for the catalogue, and what the human decided (D8-11).
 *
 * The agent has no write on the catalogue: `commands_propose` leaves this entry in the thread and
 * nothing else, and the command enters the catalogue only when a human presses Accept. The
 * block says what would be kept — the name, the type with its fixed icon, the line and the folder
 * — and why the agent thinks it is worth keeping, since that is what the human decides on.
 *
 * Once decided it says the outcome in words and offers nothing more: a proposal is answered
 * once, and the thread keeps the answer. A long line wraps where it is rather than folding, so
 * what is accepted is always read whole.
 */

/** Where a proposal stands: waiting for the human, or answered. */
export type CommandProposalState = 'pending' | 'accepted' | 'declined'

export interface CommandProposalProps {
  /** The name it would be kept under, which is what the agent asks for afterwards. */
  name: string
  /** The line it would run, exactly as proposed. */
  line: string
  type: CommandType
  /** The folder it would run in, relative to the Workspace root. */
  folder: string
  /** Why the agent thinks it is worth keeping, in its own words. */
  why: string
  state: CommandProposalState
  /** Writes the command to the catalogue, which is the human's to do. */
  onAccept?: (() => void) | undefined
  onDecline?: (() => void) | undefined
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

const BLOCK = 'flex w-full min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2'

/** The line that is read: what it is, what it is called, where it runs, and the answer. */
const HEAD = 'flex min-w-0 flex-wrap items-center gap-2'

const MARK = 'flex shrink-0 text-muted-foreground'

const NAME = 'min-w-0 truncate text-sm text-foreground'

const FOLDER = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

const LEAD = 'text-xs text-muted-foreground'

/** The line itself, whole: what is accepted is what was read. */
const LINE = 'font-mono text-xs break-all text-foreground'

const WHY = 'text-sm text-muted-foreground'

const ANSWER = 'ml-auto flex shrink-0 items-center gap-2'

export function CommandProposal({
  name,
  line,
  type,
  folder,
  why,
  state,
  onAccept,
  onDecline,
  className,
}: CommandProposalProps): ReactNode {
  const TypeIcon = COMMAND_TYPE_ICONS[type]
  return (
    <section aria-label={`Proposed command ${name}`} className={cn(BLOCK, className)}>
      <p className={LEAD}>The agent proposes a command for the catalogue</p>
      <div className={HEAD}>
        <span className={MARK}>
          <TypeIcon size="sm" aria-hidden="true" />
        </span>
        <span className={NAME}>{name}</span>
        <Badge tone="neutral">{COMMAND_TYPE_LABELS[type]}</Badge>
        <span className={FOLDER}>{folder === '.' ? 'Workspace root' : folder}</span>
        <span className={ANSWER}>
          {state === 'pending' && (
            <>
              <Button variant="ghost" size="sm" onClick={onDecline}>
                <IconX size="sm" aria-hidden="true" />
                Decline
              </Button>
              <Button variant="primary" size="sm" onClick={onAccept}>
                <IconCheck size="sm" aria-hidden="true" />
                Accept
              </Button>
            </>
          )}
          {state === 'accepted' && <Badge tone="success">Added to the catalogue</Badge>}
          {state === 'declined' && <Badge tone="neutral">Declined</Badge>}
        </span>
      </div>
      <p className={LINE}>{line}</p>
      <p className={WHY}>{why}</p>
    </section>
  )
}
