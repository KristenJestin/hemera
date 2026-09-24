import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Badge, type BadgeProps } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { IconBookmarkPlus, IconPlayerStop } from '../icons.ts'
import { COMMAND_TYPE_ICONS, COMMAND_TYPE_LABELS, type CommandType } from './command-type.ts'
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
 * reader is waiting on is the output. Once it exits 0 it folds itself, like the rest of the turn,
 * and its exit code is what is read instead; a check that failed stays open on its output.
 *
 * A one-off command line is marked as one: it runs inside the Workspace root, shows here, and
 * is never promoted to the catalogue by itself. The reader is the one who decides what a
 * Project keeps, which is why a one-off offers `Add to catalogue` beside its command line, the
 * first line of its body, and the run itself writes nothing (D8-11).
 *
 * The type is drawn with the icon the design system fixes for it (D8-07), beside the name, so a
 * `test` reads as a test here as it does in the settings. A run in another Workspace than the
 * Session's says which, beside its folder (D8-08).
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

const TYPE_ICON = 'flex shrink-0 text-muted-foreground'

const FOLDER = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

/**
 * The first line of the body: the command line, and a one-off's offer to be kept beside it, which
 * is the line it is about.
 */
const COMMAND = 'flex min-w-0 items-center gap-2'

/** The command line itself, under the name, as it was given to the shell. */
const LINE = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

/** The address the command published, and what it exited with. */
const FACTS = 'flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground'

const URL = 'min-w-0 truncate font-mono text-info-muted-foreground'

/** Where a run stands: a process is running, over, or was stopped under it. */
export type CommandState = 'running' | 'finished' | 'failed' | 'stopped'

export interface CommandRunProps {
  /** The command's name in the catalogue, or what a one-off is called on screen. */
  name: string
  /** The command line, exactly as it was run. */
  command: string
  /** What the command is for, drawn with its fixed icon and its word (D8-07). */
  type: CommandType
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
  /**
   * The Workspace it runs in, named only when it is not the Session's own: a Project-scoped
   * service runs in `main` whichever Workspace asked for it (D8-07, D8-08).
   */
  workspace?: string | undefined
  /** Whether a reader who has not touched it finds it open. */
  defaultOpen?: boolean | undefined
  /** Opens the address the command published, which this block cannot do. */
  onOpenUrl?: ((url: string) => void) | undefined
  /** Stops the process, which is the reader's one action on a run. */
  onStop?: (() => void) | undefined
  /**
   * Asks for a one-off line to be kept in the catalogue (D8-11): the human adds, and the run
   * itself promotes nothing. Offered on a one-off only.
   */
  onAddToCatalogue?: (() => void) | undefined
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

export function CommandRun({
  name,
  command,
  type,
  state,
  folder,
  output,
  url,
  exitCode,
  oneOff = false,
  workspace,
  defaultOpen = false,
  onOpenUrl,
  onStop,
  onAddToCatalogue,
  className,
}: CommandRunProps): ReactNode {
  const shown = STATE[state]
  const TypeIcon = COMMAND_TYPE_ICONS[type]
  const running = state === 'running'
  // A process the reader is waiting on is held open: the output is the answer rather than a
  // detail to go and open. A run that exits 0 folds itself the moment it does (recette 5 of 24
  // September 2026): its exit code on the line is the answer. A run that failed opens on its
  // output, and stays open when it ends failing, and is the reader's to fold once it is over
  // (recette 4 of 23 September 2026): an ended block that cannot be folded is a block that stays
  // in the way of the whole thread. A run the reader stopped folds, as one that ended well.
  return (
    <div className={cn(ROW, className)}>
      <Disclosure
        className={FOLDING}
        open={running ? true : undefined}
        defaultOpen={defaultOpen || state === 'failed'}
        summary={
          <span className={SUMMARY}>
            <span className={TYPE_ICON}>
              <TypeIcon size="sm" aria-hidden="true" />
            </span>
            <span className={NAME}>{name}</span>
            <Badge tone={shown.tone}>
              {exitCode === undefined || running ? shown.word : `${shown.word} ${exitCode}`}
            </Badge>
            <Badge tone="neutral">{COMMAND_TYPE_LABELS[type]}</Badge>
            {oneOff && <Badge tone="neutral">One-off</Badge>}
            {workspace !== undefined && <Badge tone="neutral">{`in ${workspace}`}</Badge>}
            <span className={FOLDER}>{folder}</span>
          </span>
        }
      >
        <div className={COMMAND}>
          <p className={LINE}>{command}</p>
          {oneOff && onAddToCatalogue !== undefined && (
            <Button variant="secondary" size="sm" className="shrink-0" onClick={onAddToCatalogue}>
              <IconBookmarkPlus size="sm" aria-hidden="true" />
              Add to catalogue
            </Button>
          )}
        </div>
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
        <TerminalOutput
          plain
          className="pt-1"
          terminalId={name}
          output={output}
          released={!running}
        />
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
