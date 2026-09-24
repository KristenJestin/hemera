import type { ReactNode } from 'react'

import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'
import {
  IconBookmarkPlus,
  IconFilePlus,
  IconFileText,
  IconFolder,
  IconFolders,
  IconListDetails,
  IconMessages,
  IconPencil,
  IconPlayerPlay,
  IconPlayerStop,
  IconSearch,
  IconTerminal2,
} from '../icons.ts'
import { Disclosure } from './disclosure.tsx'
import { MARKS, SubjectOnLine, type ToolSubject, pressable } from './tool-call-card.tsx'

/**
 * One call the agent made to a tool Hemera lent it (design D6-06).
 *
 * Since this lot the agent runs bare and works through Hemera's own tools, so a call in the
 * thread is no longer the agent's business alone: it is Hemera's, and the thread has to say so.
 * That is the whole reason this block is not `ToolCallCard` — the two sit side by side in one
 * turn and a reader must tell them apart. The line reads like a native call's — the mark of the
 * tool, what a reader calls it, what it is about, all in the colour of a caption — and the
 * difference is the tool's own mark. Hemera's own mark left the line (recette 2 of 23
 * September 2026): a brand on every call was louder than the call; the word `Hemera` stays in
 * what the line is announced by. The provenance left the body (recette 4): which Session, which
 * agent and which token is what the entry and the Journal record, where it is looked up, and a
 * foot of identifiers under every open call was read by nobody; how long the call took is the
 * dot's hover and description.
 *
 * Each tool wears a mark of its own and a label of its own (recette 3 of 23 September 2026): a
 * mark per kind of tool drew `fs_list` as `fs_read` and the four commands as one, and a line
 * read by `commands_output` is a line read by its plumbing. The label and the mark are the
 * caller's to hand over — the catalogue is Hemera's, and this block knows nothing of it. The code
 * name left the line (recette 5 of 24 September 2026): a folded call reads "List folder root" and
 * its dot, and `fs_list` heads the arguments in the open body, for whoever reads the thread
 * against the agent's log.
 *
 * Where a call stands is a dot, as it is on a native call, and not a word: the word is what the
 * dot is announced by.
 *
 * A refused call is a call like any other, recorded like any other, so it is not drawn as an
 * error: nothing failed, Hemera said no, and nothing ran — it wears the dot of a call nobody
 * ran. The reason is read on the line it left, and the body opens on it, because a refusal
 * nobody can read is a refusal that will be asked again.
 *
 * What is held open is what is still happening: a call in flight is what the reader is waiting
 * on, and a call waiting for a human decision is the one thing in the thread that is asking for
 * something. A call that ends done folds itself at that moment (recette 5 of 24 September 2026):
 * what it did is on its line, and a turn of twenty calls left open is a turn nobody scrolls past.
 * A call that failed or was refused opens on its reason, since that is when the details matter,
 * and folds under the reader's hand like everything that is over (recette 4).
 */

/** Where a call stands, in the word the dot is announced by and the tone it is drawn in. */
const STATUS: Record<HemeraToolStatus, { word: string; tone: StatusTone }> = {
  pending: { word: 'Waiting for you', tone: 'pending' },
  in_progress: { word: 'Running', tone: 'running' },
  completed: { word: 'Done', tone: 'success' },
  failed: { word: 'Failed', tone: 'failure' },
  refused: { word: 'Refused', tone: 'cancelled' },
}

/** The line that is read: whose call it is, the tool, what it is about and where it stands. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

/**
 * The mark of each tool, one picture per tool (recette 3 of 23 September 2026). The names are
 * the ones Hemera's catalogue gives its tools (`@hemera/core`'s `ToolMark`), which this package
 * cannot import and the application hands over.
 */
export type HemeraToolMark =
  | 'read-file'
  | 'list-folder'
  | 'search'
  | 'write-file'
  | 'edit-file'
  | 'run-command'
  | 'stop-command'
  | 'list-commands'
  | 'command-output'
  | 'propose-command'
  | 'project'
  | 'session'

const HEMERA_MARKS: Record<HemeraToolMark, ReactNode> = {
  'read-file': <IconFileText size="sm" aria-hidden="true" />,
  'list-folder': <IconFolder size="sm" aria-hidden="true" />,
  search: <IconSearch size="sm" aria-hidden="true" />,
  'write-file': <IconFilePlus size="sm" aria-hidden="true" />,
  'edit-file': <IconPencil size="sm" aria-hidden="true" />,
  'run-command': <IconPlayerPlay size="sm" aria-hidden="true" />,
  'stop-command': <IconPlayerStop size="sm" aria-hidden="true" />,
  'list-commands': <IconListDetails size="sm" aria-hidden="true" />,
  'command-output': <IconTerminal2 size="sm" aria-hidden="true" />,
  'propose-command': <IconBookmarkPlus size="sm" aria-hidden="true" />,
  project: <IconFolders size="sm" aria-hidden="true" />,
  session: <IconMessages size="sm" aria-hidden="true" />,
}

/** Where the mark sits on the line, in the tone a native call's mark is drawn in. */
const MARK = 'flex shrink-0 text-muted-foreground'

/** Who the call is, for whatever reads the page rather than looks at it. */
const WHOSE = 'sr-only'

/**
 * What a reader calls the tool, in the colour of the whole line: a caption's, not the thread's
 * (recette 5 of 24 September 2026). A column of calls in the colour of what the agent said is a
 * column where the answer and the plumbing weigh the same.
 */
const NAMED = 'shrink-0 text-muted-foreground'

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

/** Where a call stands in its life, which is what says whether the reader may fold it. */
export type HemeraToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'refused'

/** One argument of the call, already bounded and shortened by the engine. */
export interface HemeraToolArgument {
  label: string
  value: string
}

export interface HemeraToolCallProps {
  /** The tool, as the catalogue names it: `fs_read`, `search`, `commands_run`. */
  tool: string
  /** What a reader calls the tool: `Read file`, `Search`, `Run command`. */
  label: string
  /** The tool's own mark; a tool the catalogue does not know wears the mark of any call. */
  mark?: HemeraToolMark | undefined
  /** What the call is about, read from its arguments: the file, the query, the command. */
  subject?: ToolSubject | undefined
  status: HemeraToolStatus
  /** What the call returned, in one line. */
  summary: string
  /** The arguments as they were bounded, in the order the tool declares them. */
  arguments?: readonly HemeraToolArgument[] | undefined
  /** How long the call took, once it is over: the dot's hover and description, not the line. */
  ms?: number | undefined
  /** Why the call failed, or why it was refused. */
  error?: string | undefined
  /** Whether a reader who has not touched it finds it open. */
  defaultOpen?: boolean | undefined
  /** What a press on a subject that is a path does: the reader goes there. */
  onOpenPath?: ((path: string) => void) | undefined
  /** What the call returned, handed over already drawn. */
  children?: ReactNode
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

/** Whether the summary only says the error again: the same sentence, or one opening with it. */
function repeats(summary: string, error: string | undefined): boolean {
  if (error === undefined) return false
  const said = error.trim()
  return said !== '' && summary.trim().startsWith(said)
}

export function HemeraToolCall({
  tool,
  label,
  mark,
  subject,
  status,
  summary,
  arguments: args,
  ms,
  error,
  defaultOpen = false,
  onOpenPath,
  children,
  className,
}: HemeraToolCallProps): ReactNode {
  const { word, tone } = STATUS[status]
  // Held open while something is still happening or waits for the reader: a call in flight and a
  // call waiting on a decision. A call that failed or was refused opens on its reason, and once
  // it is over the fold is the reader's (recette 4 of 23 September 2026): an ended block that
  // cannot be folded stays in the way of the whole thread.
  const forced = status === 'in_progress' || status === 'pending'
  const ended = status === 'failed' || status === 'refused'
  return (
    <Disclosure
      className={className}
      // Uncontrolled once the call is over: `undefined` hands the fold back to the reader, at
      // where it starts — folded for a call that ended done, open on the reason of one that did
      // not — and the fold plays rather than snaps.
      open={forced ? true : undefined}
      defaultOpen={defaultOpen || ended}
      // A subject that is a path is the press that goes there, where it is read: on the line that
      // never moves, so the body opening under it does not carry it along (trials of 23 September
      // 2026), and once rather than a second time at the end of the line.
      holdsPress={pressable(subject, onOpenPath)}
      summary={
        <span className={SUMMARY}>
          <span className={MARK} data-mark={mark ?? 'other'}>
            {mark === undefined ? MARKS.other : HEMERA_MARKS[mark]}
          </span>
          <span className={WHOSE}>Hemera</span>
          <span className={NAMED}>{label}</span>
          {subject !== undefined && <SubjectOnLine subject={subject} onOpen={onOpenPath} />}
          <StatusDot
            status={tone}
            size="sm"
            label={word}
            title={ms === undefined ? undefined : `${ms} ms`}
          />
        </span>
      }
    >
      {error !== undefined && <p className={status === 'refused' ? REFUSAL : FAILURE}>{error}</p>}
      {/* Said once (recette 4 of 23 September 2026): a summary that is the error again, or opens
          with it, is the red line a second time in grey. */}
      {!repeats(summary, error) && <p className={ANSWER}>{summary}</p>}
      {/* The catalogue's name heads the arguments (recette 5 of 24 September 2026): it is for
          the eye that reads the thread against a log, and that eye opens the call first. */}
      <dl className={ARGUMENTS}>
        {[{ label: 'tool', value: tool }, ...(args ?? [])].map((argument) => (
          <div key={argument.label} className={PAIR}>
            <dt className={LABEL}>{argument.label}</dt>
            <dd className={VALUE}>{argument.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </Disclosure>
  )
}
