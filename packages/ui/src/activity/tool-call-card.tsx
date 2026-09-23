import { type ReactNode, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'
import {
  IconActivity,
  IconArrowUp,
  IconFileText,
  IconPencil,
  IconPlayerPlay,
  IconPlugConnected,
  IconSearch,
  IconSparkles,
  IconTrash,
} from '../icons.ts'
import { Disclosure } from './disclosure.tsx'

/**
 * One tool call of a turn: what the agent asked for, and what came back (design D17-04).
 *
 * A turn is mostly tool calls — reads, edits, commands — and the thread has to say what the
 * agent did without becoming a log. So a call is one line while it runs, one line when it is
 * done, and the body only when somebody asks: the parameters of a read are noise after the read
 * succeeded, and they are the whole story when it failed.
 *
 * Every card starts folded, whatever its state (trial of 22 September 2026, evening). A card
 * that opened itself for a call in flight or a call that failed was a Session reopened on the
 * body of a command that had failed an hour ago, and a thread whose shape depended on how its
 * calls had ended. The state is the dot on the row; the body is the reader's to open. A caller
 * may still ask for a card to start open, and nothing in the application does.
 *
 * What the reader chose is held here rather than inside the fold, so that it survives the entry
 * being written again on every update of the turn, and the row losing and regaining its chevron
 * with it — and it is not asked again when the status moves on: a card the reader opened on a
 * running call is still open when the call is done.
 *
 * What the call is called is drawn in the reading colour of a caption and not of the thread: a
 * column of forty call titles in the colour of what the agent *said* is a column where the
 * answer and the plumbing weigh the same. A command keeps the mono face, because a command is
 * read character by character and not as words.
 *
 * Where it stands is a dot, and no longer a word. `Done` under `Done` under `Done` said nothing
 * the reader did not already know and stole the eye from the one line that had gone wrong; the
 * colour says the same five things in the width of a dot, and the word is kept for whatever
 * reads the page.
 *
 * A call with nothing behind it — no input, no output, no body of its own and no error — does
 * not fold at all: no chevron, no press, nothing to open. A control that opens onto nothing is
 * a control that lied about having something there.
 *
 * The line reads the way a Hemera call's does (recette 3 of 23 September 2026): the mark of the
 * kind, what a reader calls it, what it is about, and the agent's own name for the tool, quieter,
 * when the adapter gives one. The kind is the label — `Read file`, `Run command` — and a call of
 * no kind is read by the title the agent gave it. What it is about is the subject: the file, the
 * query, the command line.
 *
 * When the subject is the file a call touched and the reader can go there, the subject itself is
 * the press, where it is read: a press at the end of the row was a second copy of the same path.
 * The row still folds anywhere else the pointer lands on it, and the press is on the fold's own
 * line, so the body opening under it does not carry it along (trial of 23 September 2026).
 */

/**
 * How a call is read at a glance: the kind is the mark, the status is the colour of the dot.
 * Shared with `HemeraToolCall`, so a read is the same mark whoever lent the tool.
 */
export const MARKS: Record<ToolKind, ReactNode> = {
  read: <IconFileText size="sm" aria-hidden="true" />,
  edit: <IconPencil size="sm" aria-hidden="true" />,
  delete: <IconTrash size="sm" aria-hidden="true" />,
  // A move is a displacement, and the catalogue has one arrow: what matters about a move is that
  // the file went somewhere, which is what an arrow says.
  move: <IconArrowUp size="sm" aria-hidden="true" />,
  search: <IconSearch size="sm" aria-hidden="true" />,
  execute: <IconPlayerPlay size="sm" aria-hidden="true" />,
  think: <IconSparkles size="sm" aria-hidden="true" />,
  fetch: <IconPlugConnected size="sm" aria-hidden="true" />,
  other: <IconActivity size="sm" aria-hidden="true" />,
}

/** Where a call stands, in the word the dot is announced by and the tone it is drawn in. */
const STATUS: Record<ToolStatus, { word: string; tone: StatusTone }> = {
  pending: { word: 'Queued', tone: 'pending' },
  in_progress: { word: 'Running', tone: 'running' },
  completed: { word: 'Done', tone: 'success' },
  failed: { word: 'Failed', tone: 'failure' },
  cancelled: { word: 'Cancelled', tone: 'cancelled' },
}

/** The line that is read: the mark of the kind, the label, the subject and where the call stands. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

/** What the reader calls the call, in the colour of the thread; it gives way to nothing. */
const LABEL = 'shrink-0 text-foreground'

/** A title standing in for a label, which is the agent's sentence and may be long. */
const TITLE = 'min-w-0 truncate text-foreground'

/**
 * What the call is about, in the face a path, a query and a command are written in, shortened
 * from its end rather than pushing the line off the card.
 */
const SUBJECT = 'min-w-0 truncate font-mono text-foreground'

/** The press a subject becomes: it takes the pointer back from the summary it is drawn in. */
const PRESS = 'pointer-events-auto flex min-w-0'

/** The tool's own name, as the agent or the catalogue calls it: quieter, and smaller. */
const NAME = 'shrink-0 font-mono text-xs text-muted-foreground'

/** What a reader calls each kind of call; a call of no kind is read by its title. */
const KIND_LABELS: Record<ToolKind, string | null> = {
  read: 'Read file',
  edit: 'Edit file',
  delete: 'Delete file',
  move: 'Move file',
  search: 'Search',
  execute: 'Run command',
  think: 'Thinking',
  fetch: 'Fetch',
  other: null,
}

/** The label a call of this kind is read by, the title standing in for a call of no kind. */
export function toolKindLabel(kind: ToolKind, title: string): string {
  return KIND_LABELS[kind] ?? title
}

/** What the call returned, quieter than the line above it. */
const BODY = 'flex flex-col gap-2 text-sm text-muted-foreground'

/** A failure keeps the colour of a failure, in the body it opened for it. */
const ERROR = 'text-sm text-destructive-muted-foreground'

/** What a labelled half of the body is called: the quietest line the card has. */
const SECTION_HEAD = 'text-xs font-medium tracking-wide text-muted-foreground uppercase'

/**
 * What was sent, and what came back: the agent's own text, in the agent's own shape.
 *
 * Mono, because both of them are values rather than prose, and scrolling rather than growing: a
 * command that answered two thousand lines is a thread nobody can scroll past otherwise.
 */
const SECTION_BODY =
  'scroll-quiet max-h-40 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap'

/** What is drawn where an answer would be, when there was none. */
const NOTHING = 'italic'

/** The kind ACP names for a tool call, which is what says how it is read. */
export type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'other'

/**
 * Where a call is in its life, which is what says whether it folds.
 *
 * `cancelled` is a call that never finished because the turn it belonged to was stopped. It is
 * not a failure — nothing went wrong — and it is not done either, so it is neither of the two
 * the thread used to make it choose between.
 */
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

/** What a call is about, as its line shows it: a file, a folder, a query, a command line. */
export interface ToolSubject {
  /** What the line shows, already shortened. */
  text: string
  /** The whole of it, for the pointer that rests on it; `text` when left out. */
  full?: string | undefined
  /** The path it is, when it is one: the press a reader goes there with. */
  path?: string | undefined
}

/**
 * The subject on a call's line: plain text, or the press that goes to the file it names.
 *
 * The press is wrapped so that it takes the pointer back from the summary it is drawn over
 * (`Disclosure`'s `holdsPress`); `pressable` is what the caller hands the fold as well.
 */
export function SubjectOnLine({
  subject,
  onOpen,
}: {
  subject: ToolSubject
  onOpen?: ((path: string) => void) | undefined
}): ReactNode {
  const { text, full = text, path } = subject
  if (path === undefined || onOpen === undefined) {
    return (
      <span className={SUBJECT} title={full}>
        {text}
      </span>
    )
  }
  return (
    <span className={PRESS}>
      <Button
        variant="link"
        size="sm"
        className="min-w-0"
        title={full}
        onClick={() => onOpen(path)}
      >
        <span className={SUBJECT}>{text}</span>
      </Button>
    </span>
  )
}

/** Whether a subject is drawn as a press, which the fold has to know to lay its line out. */
export function pressable(
  subject: ToolSubject | undefined,
  onOpen: ((path: string) => void) | undefined,
): boolean {
  return subject?.path !== undefined && onOpen !== undefined
}

/** A file the call touched, and where in it the call landed. */
export interface ToolLocation {
  /** The absolute path, as the agent reported it. */
  path: string
  /** The line, when the agent named one. */
  line?: number | undefined
}

export interface ToolCallCardProps {
  /** What the call is called, as the agent wrote it: the label of a call of no kind. */
  title: string
  /** The kind, which decides the mark and the label. */
  kind: ToolKind
  /**
   * What the call is about. Left out, the first file it touched is, when it touched one.
   */
  subject?: ToolSubject | undefined
  /** The tool's own name, when the adapter gives one: drawn quieter, after the subject. */
  name?: string | undefined
  /**
   * Where the call is in its life.
   *
   * It is the caller's, and the caller is the only one who knows. It is drawn as the dot on the
   * row and decides nothing about the fold: every card starts folded.
   */
  status: ToolStatus
  /** The files the call touched, in the order the agent named them. */
  locations?: readonly ToolLocation[] | undefined
  /** What went wrong, when it did: the first thing the body says once it is opened. */
  error?: string | undefined
  /** What the agent sent: the parameters of the call, in its own words. */
  input?: ReactNode
  /** What came back. Absent beside an input, the section says so rather than vanishing. */
  output?: ReactNode
  /**
   * Whether a reader who has not touched it finds it open.
   *
   * Where the card starts, and nothing more: the first press is the reader's, whatever this
   * said. Folded unless a caller asks, whatever the status.
   */
  defaultOpen?: boolean | undefined
  /** What a press on the file does: the reader goes there, which the card itself cannot do. */
  onOpenLocation?: ((location: ToolLocation) => void) | undefined
  /** What the call returned in a shape of its own: a diff, a console, handed over already drawn. */
  children?: ReactNode
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

/** The file a call touched, written as the reader would look it up. */
function at(location: ToolLocation): string {
  return location.line === undefined ? location.path : `${location.path}:${location.line}`
}

export function ToolCallCard({
  title,
  kind,
  subject,
  name,
  status,
  locations,
  error,
  input,
  output,
  defaultOpen = false,
  onOpenLocation,
  children,
  className,
}: ToolCallCardProps): ReactNode {
  const { word, tone } = STATUS[status]
  // Where the fold stands: where the caller asked it to start, and then what the reader last
  // said. The status plays no part in it.
  const [shown, setShown] = useState(defaultOpen)
  const first = locations?.[0]
  const about = subject ?? (first === undefined ? undefined : { text: at(first), path: first.path })
  // A press on the subject goes to the file as the agent reported it, with the line it named.
  const open =
    onOpenLocation === undefined
      ? undefined
      : (path: string) => onOpenLocation(locations?.find((one) => one.path === path) ?? { path })
  const sectioned = input !== undefined || output !== undefined
  const opens = sectioned || children !== undefined || error !== undefined
  const summary = (
    <span className={SUMMARY}>
      <span className="flex shrink-0 text-muted-foreground" data-mark={kind}>
        {MARKS[kind]}
      </span>
      <span className={KIND_LABELS[kind] === null ? TITLE : LABEL}>
        {toolKindLabel(kind, title)}
      </span>
      {about !== undefined && <SubjectOnLine subject={about} onOpen={open} />}
      {name !== undefined && <span className={NAME}>{name}</span>}
      <StatusDot status={tone} size="sm" label={word} />
    </span>
  )
  return (
    <Disclosure
      className={className}
      // Controlled from here, always: the fold is a state of the *call*, and a state held
      // inside the fold is a state lost the moment the row goes from having nothing to open
      // to having a body — which is what every call does on its first answer.
      open={shown}
      onOpenChange={setShown}
      summary={summary}
      holdsPress={pressable(about, open)}
    >
      {opens ? (
        <div className={BODY}>
          {error !== undefined && <p className={ERROR}>{error}</p>}
          {sectioned && (
            <>
              <Section head="Input" body={input} />
              <Section head="Output" body={output} />
            </>
          )}
          {children}
        </div>
      ) : undefined}
    </Disclosure>
  )
}

/**
 * One labelled half of the body: what was sent, or what came back.
 *
 * An empty half is drawn and says so rather than being left out: a card showing an `Input` and
 * no `Output` reads as a call still running, and the one thing a finished call has to be able to
 * say is that it answered nothing at all.
 */
function Section({ head, body }: { head: string; body: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <p className={SECTION_HEAD}>{head}</p>
      <div className={SECTION_BODY}>
        {body === undefined ? <span className={NOTHING}>Nothing was returned.</span> : body}
      </div>
    </div>
  )
}
