import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Badge, type BadgeProps } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Disclosure } from './disclosure.tsx'

/**
 * One call the agent made to a tool Hemera lent it (design D6-06).
 *
 * Since this lot the agent runs bare and works through Hemera's own tools, so a call in the
 * thread is no longer the agent's business alone: it is Hemera's, and the thread has to say so.
 * That is the whole reason this block is not `ToolCallCard` — the two sit side by side in one
 * turn and a reader must tell them apart at a glance. The word `Hemera` on the line is that
 * difference, and the provenance under it is what makes the call accountable: which Session it
 * was made in, which agent made it, and which token it carried (D6-01).
 *
 * A refused call is a call like any other, recorded like any other, so it wears a state of its
 * own rather than an error: nothing failed, Hemera said no. The reason is read on the line it
 * left, and the body stays open, because a refusal nobody can read is a refusal that will be
 * asked again.
 *
 * What is open, and what the reader may fold, follows the rule of a native call: a call in
 * flight is what the reader is waiting on, a call that failed is when the details matter, and a
 * call waiting for a human decision is the one thing in the thread that is asking for something.
 * Everything else folds.
 */

/** What a call is doing, which is the word on its line. */
const STATUS: Record<HemeraToolStatus, { word: string; tone: NonNullable<BadgeProps['tone']> }> = {
  pending: { word: 'Waiting for you', tone: 'warning' },
  in_progress: { word: 'Running', tone: 'info' },
  completed: { word: 'Done', tone: 'success' },
  failed: { word: 'Failed', tone: 'destructive' },
  refused: { word: 'Refused', tone: 'warning' },
}

/** The row: the fold, and the first path the call touched at its end. */
const ROW = 'flex w-full min-w-0 items-center gap-2'

/** The fold takes the room that is left, so a long tool name shortens rather than runs on. */
const FOLDING = 'min-w-0 flex-1'

/** The line that is read: whose call it is, the tool, and what the call is doing. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

const TOOL = 'min-w-0 truncate font-mono text-foreground'

/** What the call answered, quieter than the line above it. */
const ANSWER = 'text-sm text-muted-foreground'

/** A refusal keeps the colour of a warning, in the body it opened for it. */
const REFUSAL = 'mb-1 text-sm text-warning-muted-foreground'

const FAILURE = 'mb-1 text-sm text-destructive-muted-foreground'

/** The arguments as they were bounded, one pair per line. */
const ARGUMENTS = 'flex flex-col gap-0.5'

const PAIR = 'flex items-baseline gap-2'

const LABEL = 'shrink-0 font-mono text-xs text-muted-foreground'

const VALUE = 'min-w-0 truncate font-mono text-xs text-foreground'

/** The paths touched and the provenance, which is what makes the call accountable. */
const FOOT = 'flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground'

/** Where a call stands in its life, which is what says whether the reader may fold it. */
export type HemeraToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'refused'

/** One argument of the call, already bounded and shortened by the engine. */
export interface HemeraToolArgument {
  label: string
  value: string
}

/** Who made the call, and with what: what the entry is recorded with (D6-06). */
export interface HemeraToolProvenance {
  /** The Session the call belongs to. */
  session: string
  /** The agent that made it, as the protocol names it. */
  agent: string
  /** The identifier of the token it carried, never the token itself. */
  token: string
}

export interface HemeraToolCallProps {
  /** The tool, as the catalogue names it: `fs_read`, `search`, `commands_run`. */
  tool: string
  status: HemeraToolStatus
  /** What the call returned, in one line. */
  summary: string
  /** The arguments as they were bounded, in the order the tool declares them. */
  arguments?: readonly HemeraToolArgument[] | undefined
  /** The paths the call touched, in the order it named them. */
  paths?: readonly string[] | undefined
  /** How long the call took, once it is over. */
  ms?: number | undefined
  /** Where the call was made from: the Session, the agent and the token identifier. */
  provenance: HemeraToolProvenance
  /** Why the call failed, or why it was refused. */
  error?: string | undefined
  /** Whether a reader who has not touched it finds it open. */
  defaultOpen?: boolean | undefined
  /** What a press on a path does: the reader goes there, which this block cannot do. */
  onOpenPath?: ((path: string) => void) | undefined
  /** What the call returned, handed over already drawn. */
  children?: ReactNode
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

export function HemeraToolCall({
  tool,
  status,
  summary,
  arguments: args,
  paths,
  ms,
  provenance,
  error,
  defaultOpen = false,
  onOpenPath,
  children,
  className,
}: HemeraToolCallProps): ReactNode {
  const { word, tone } = STATUS[status]
  // The four states in which the body is the answer to the reader's question rather than a
  // detail they may go and look for: running, failed, waiting on a decision, and refused — the
  // reason a call was turned down is the whole of what a reader has to act on.
  const forced =
    status === 'in_progress' || status === 'failed' || status === 'pending' || status === 'refused'
  const first = paths?.[0]
  return (
    <div className={cn(ROW, className)}>
      <Disclosure
        className={FOLDING}
        // Uncontrolled once the call is over: `undefined` hands the fold back to the reader.
        open={forced ? true : undefined}
        defaultOpen={defaultOpen}
        summary={
          <span className={SUMMARY}>
            <Badge tone="primary">Hemera</Badge>
            <span className={TOOL}>{tool}</span>
            <Badge tone={tone}>{word}</Badge>
          </span>
        }
      >
        {error !== undefined && <p className={status === 'refused' ? REFUSAL : FAILURE}>{error}</p>}
        <p className={ANSWER}>{summary}</p>
        {args !== undefined && args.length > 0 && (
          <dl className={ARGUMENTS}>
            {args.map((argument) => (
              <div key={argument.label} className={PAIR}>
                <dt className={LABEL}>{argument.label}</dt>
                <dd className={VALUE}>{argument.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className={FOOT}>
          <span>{provenance.session}</span>
          <span>{provenance.agent}</span>
          <span>{`token ${provenance.token}`}</span>
          {ms !== undefined && <span>{`${ms} ms`}</span>}
        </div>
        {children}
      </Disclosure>
      {first !== undefined && onOpenPath !== undefined && (
        <Button variant="link" size="sm" className="shrink-0" onClick={() => onOpenPath(first)}>
          {first}
        </Button>
      )}
    </div>
  )
}
