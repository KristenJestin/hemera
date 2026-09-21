import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Badge, type BadgeProps } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { IconPlayerStop } from '../icons.ts'
import { Disclosure } from './disclosure.tsx'
import { TerminalOutput } from './terminal-output.tsx'

/**
 * A command Hemera runs for a Session, as the thread reads it (design D6-12).
 *
 * A command is one process owned by Hemera, whoever started it: the agent through its tool, or
 * the reader through the Commands panel. Both watch the same process, so both read the same
 * line here — the command, where it runs, what it exited with, and the URL it published once
 * its output named one. That URL is the point of the block: a server started in a corner and
 * forgotten is what this lot exists to end, so the address is on the line, one press away.
 *
 * The line stays open while the process runs, for the same reason a console does: what the
 * reader is waiting on is the output. Once it is over it folds like the rest of the turn, and
 * its exit code is what is read instead — a check that failed says so without being opened.
 *
 * A one-off command line is marked as one: it runs inside the Workspace root, shows here, and
 * is never promoted to the catalogue by itself. The reader is the one who decides what a
 * Project keeps.
 */

/** How a run is read at a glance: the state is the word, and the exit code is the proof. */
const STATE: Record<CommandState, { word: string; tone: NonNullable<BadgeProps['tone']> }> = {
  running: { word: 'Running', tone: 'info' },
  finished: { word: 'Exited', tone: 'success' },
  failed: { word: 'Exited', tone: 'destructive' },
  stopped: { word: 'Stopped', tone: 'neutral' },
}

/** The row: the fold, and the two controls a run has of its own. */
const ROW = 'flex w-full min-w-0 items-start gap-2'

const FOLDING = 'min-w-0 flex-1'

/** The line that is read: the name, the state, and where it runs. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

const NAME = 'min-w-0 truncate text-foreground'

const FOLDER = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

/** The command line itself, under the name, as it was given to the shell. */
const LINE = 'truncate font-mono text-xs text-muted-foreground'

/** The address the command published, and what it exited with. */
const FACTS = 'flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground'

const URL = 'min-w-0 truncate font-mono text-info-muted-foreground'

/** Where a run stands: a process is running, over, or was stopped under it. */
export type CommandState = 'running' | 'finished' | 'failed' | 'stopped'

/** What a command is for, which is what the catalogue keeps it as. */
export type CommandKind = 'app' | 'check' | 'utility'

export interface CommandRunProps {
  /** The command's name in the catalogue, or what a one-off is called on screen. */
  name: string
  /** The command line, exactly as it was run. */
  command: string
  kind: CommandKind
  state: CommandState
  /** The folder it runs in, relative to the Workspace when it is inside it. */
  folder: string
  /** What the process has written so far, exactly as it arrived. */
  output: string
  /** The first `http://localhost:<port>` its output named, once it named one. */
  url?: string | undefined
  /** What it exited with, once it is over. */
  exitCode?: number | undefined
  /** Whether the line was run without being in the catalogue. */
  oneOff?: boolean | undefined
  /** Whether a reader who has not touched it finds it open. */
  defaultOpen?: boolean | undefined
  /** Opens the address the command published, which this block cannot do. */
  onOpenUrl?: ((url: string) => void) | undefined
  /** Stops the process, which is the reader's one action on a run. */
  onStop?: (() => void) | undefined
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

export function CommandRun({
  name,
  command,
  kind,
  state,
  folder,
  output,
  url,
  exitCode,
  oneOff = false,
  defaultOpen = false,
  onOpenUrl,
  onStop,
  className,
}: CommandRunProps): ReactNode {
  const shown = STATE[state]
  const running = state === 'running'
  // A process the reader is waiting on, and a run that failed: both are read where they are, since
  // the output is the answer rather than a detail to go and open. Everything else folds.
  const staysOpen = running || state === 'failed'
  return (
    <div className={cn(ROW, className)}>
      <Disclosure
        className={FOLDING}
        open={staysOpen ? true : undefined}
        defaultOpen={defaultOpen}
        summary={
          <span className={SUMMARY}>
            <span className={NAME}>{name}</span>
            <Badge tone={shown.tone}>
              {exitCode === undefined || running ? shown.word : `${shown.word} ${exitCode}`}
            </Badge>
            <Badge tone="neutral">{kind}</Badge>
            {oneOff && <Badge tone="neutral">One-off</Badge>}
            <span className={FOLDER}>{folder}</span>
          </span>
        }
      >
        <p className={LINE}>{command}</p>
        {url !== undefined && (
          <p className={FACTS}>
            {onOpenUrl === undefined ? (
              <span className={URL}>{url}</span>
            ) : (
              <Button variant="link" size="sm" className="min-w-0" onClick={() => onOpenUrl(url)}>
                {url}
              </Button>
            )}
          </p>
        )}
        <TerminalOutput terminalId={name} output={output} released={!running} />
      </Disclosure>
      {running && onStop !== undefined && (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={onStop}>
          <IconPlayerStop size="sm" aria-hidden="true" />
          Stop
        </Button>
      )}
    </div>
  )
}
