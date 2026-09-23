import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'
import { IconInfoCircle, IconTerminal } from '../icons.ts'
import { Disclosure } from './disclosure.tsx'
import { MARKS } from './tool-call-card.tsx'

/**
 * One call the agent made to a tool Hemera lent it (design D6-06).
 *
 * Since this lot the agent runs bare and works through Hemera's own tools, so a call in the
 * thread is no longer the agent's business alone: it is Hemera's, and the thread has to say so.
 * That is the whole reason this block is not `ToolCallCard` — the two sit side by side in one
 * turn and a reader must tell them apart. The line reads like a native call's — the mark of the
 * kind of tool, drawn as `ToolCallCard` draws it, then the tool's name in mono — and the
 * difference is the name itself and the provenance under it, which is what makes the call
 * accountable: which Session it was made in, which agent made it, and which token it carried
 * (D6-01). Hemera's own mark left the line (recette 2 of 23 September 2026): a brand on every
 * call was louder than the call; the word `Hemera` stays in what the line is announced by.
 *
 * Where a call stands is a dot, as it is on a native call, and not a word: the word is what the
 * dot is announced by.
 *
 * A refused call is a call like any other, recorded like any other, so it is not drawn as an
 * error: nothing failed, Hemera said no, and nothing ran — it wears the dot of a call nobody
 * ran. The reason is read on the line it left, and the body stays open, because a refusal
 * nobody can read is a refusal that will be asked again.
 *
 * What is open, and what the reader may fold, follows the rule of a native call: a call in
 * flight is what the reader is waiting on, a call that failed is when the details matter, and a
 * call waiting for a human decision is the one thing in the thread that is asking for something.
 * Everything else folds.
 */

/** Where a call stands, in the word the dot is announced by and the tone it is drawn in. */
const STATUS: Record<HemeraToolStatus, { word: string; tone: StatusTone }> = {
  pending: { word: 'Waiting for you', tone: 'pending' },
  in_progress: { word: 'Running', tone: 'running' },
  completed: { word: 'Done', tone: 'success' },
  failed: { word: 'Failed', tone: 'failure' },
  refused: { word: 'Refused', tone: 'cancelled' },
}

/** The line that is read: whose call it is, the tool, and what the call is doing. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

/** How a Hemera tool is read at a glance: what it does to the Workspace, not whose it is. */
type MarkKind = 'read' | 'edit' | 'search' | 'terminal' | 'quiet-terminal' | 'info'

/**
 * The kind of each tool of the catalogue. A command that is only looked at — the catalogue, an
 * output — is the terminal of a command that runs, drawn quieter: nothing started or stopped.
 */
const KINDS: ReadonlyMap<string, MarkKind> = new Map([
  ['fs_read', 'read'],
  ['fs_list', 'read'],
  ['fs_write', 'edit'],
  ['fs_edit', 'edit'],
  ['search', 'search'],
  ['commands_run', 'terminal'],
  ['commands_stop', 'terminal'],
  ['commands_list', 'quiet-terminal'],
  ['commands_output', 'quiet-terminal'],
  ['project_get', 'info'],
  ['session_get', 'info'],
])

/** The marks, the three a native call already has read from its own table. */
const HEMERA_MARKS: Record<MarkKind, ReactNode> = {
  read: MARKS.read,
  edit: MARKS.edit,
  search: MARKS.search,
  terminal: <IconTerminal size="sm" aria-hidden="true" />,
  'quiet-terminal': <IconTerminal size="sm" aria-hidden="true" />,
  info: <IconInfoCircle size="sm" aria-hidden="true" />,
}

/** Where the mark sits on the line, in the tone a native call's mark is drawn in. */
const MARK = 'flex shrink-0 text-muted-foreground'

/** The mark of a command only looked at, a step quieter than one that runs. */
const QUIET_MARK = 'flex shrink-0 text-muted-foreground opacity-60'

/** Who the call is, for whatever reads the page rather than looks at it. */
const WHOSE = 'sr-only'

const TOOL = 'min-w-0 truncate font-mono text-muted-foreground'

/** The path, shortened from its end rather than pushing the line off the block. */
const PATH = 'min-w-0 truncate'

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
  const kind = KINDS.get(tool)
  return (
    <Disclosure
      className={className}
      // Uncontrolled once the call is over: `undefined` hands the fold back to the reader.
      open={forced ? true : undefined}
      defaultOpen={defaultOpen}
      summary={
        <span className={SUMMARY}>
          <span
            className={kind === 'quiet-terminal' ? QUIET_MARK : MARK}
            data-mark={kind ?? 'other'}
          >
            {kind === undefined ? MARKS.other : HEMERA_MARKS[kind]}
          </span>
          <span className={WHOSE}>Hemera</span>
          <span className={TOOL}>{tool}</span>
          <StatusDot status={tone} size="sm" label={word} />
        </span>
      }
      // The first path is on the line that never moves, beside the fold rather than in it: the
      // body opening under it does not carry it along (trial of 23 September 2026).
      aside={
        first !== undefined && onOpenPath !== undefined ? (
          <Button variant="link" size="sm" className="min-w-0" onClick={() => onOpenPath(first)}>
            <span className={PATH}>{first}</span>
          </Button>
        ) : undefined
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
  )
}
