import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Input } from '../components/field/field.tsx'
import { CommandRun, type CommandRunProps } from '../activity/command-run.tsx'

/**
 * The commands of a Session, in one place (design D6-12).
 *
 * Every command Hemera runs for a Session is watched from here, whoever started it: the agent
 * through `commands_run`, or the reader on the last line of the panel. That is the point of the
 * panel — a server the agent started is a process the reader can see, read and stop without
 * asking the agent anything, and the address it published is one press away.
 *
 * A one-off line is run here and shows here as a run like any other, and it does not enter the
 * catalogue by itself: what a Project keeps is the reader's decision, taken in the Project's
 * settings, not a side effect of typing in this box.
 *
 * The panel draws no run of its own: each line is the same block the thread shows, so what the
 * reader learns here is what they will read there.
 */

/** One run, as the panel lists it: the block's own props, and the id that names it. */
export type CommandPanelRun = Omit<
  CommandRunProps,
  'onOpenUrl' | 'onStop' | 'defaultOpen' | 'className'
> & {
  /** What stops it and what the panel keys it by. */
  id: string
}

export interface CommandsPanelProps {
  /** The runs of this Session, the oldest first, as the engine keeps them. */
  runs: readonly CommandPanelRun[]
  /** Stops one of them, which is the reader's one action on a run. */
  onStop?: ((id: string) => void) | undefined
  /** Opens the address a run published, which this block cannot do. */
  onOpenUrl?: ((url: string) => void) | undefined
  /** Runs a line that is not in the catalogue, inside the Workspace root. */
  onRun?: ((line: string) => void) | undefined
  /** Where the panel sits; never how it looks. */
  className?: string | undefined
}

const PANEL = 'flex w-full flex-col gap-2'

const HEAD = 'flex items-center gap-2'

const TITLE = 'text-sm text-foreground'

const LIST = 'flex flex-col gap-2'

/** What a Session that has run nothing says, rather than an empty box. */
const NOTHING = 'text-sm text-muted-foreground'

/** The line a reader types a command on, and what it is worth knowing before they do. */
const ONCE = 'text-xs text-muted-foreground'

export function CommandsPanel({
  runs,
  onStop,
  onOpenUrl,
  onRun,
  className,
}: CommandsPanelProps): ReactNode {
  const [line, setLine] = useState('')
  const running = runs.filter((run) => run.state === 'running').length
  const empty = line.trim() === ''
  return (
    <section className={cn(PANEL, className)} aria-label="Commands">
      <div className={HEAD}>
        <span className={TITLE}>Commands</span>
        <Badge tone={running > 0 ? 'info' : 'neutral'}>
          {running > 0 ? `${running} running` : `${runs.length}`}
        </Badge>
      </div>
      {runs.length === 0 ? (
        <p className={NOTHING}>No command has run in this Session.</p>
      ) : (
        <ul className={LIST}>
          {runs.map((run) => (
            <li key={run.id}>
              <CommandRun
                {...run}
                onOpenUrl={onOpenUrl}
                onStop={onStop === undefined ? undefined : () => onStop(run.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <Input
        label="Run a line"
        placeholder="pnpm test --watch"
        value={line}
        onValueChange={setLine}
        action={
          <Button
            variant="secondary"
            size="sm"
            disabled={empty || onRun === undefined}
            onClick={() => {
              if (onRun === undefined || empty) return
              onRun(line.trim())
              setLine('')
            }}
          >
            Run
          </Button>
        }
      />
      <p className={ONCE}>
        A one-off line runs inside the Workspace root and does not enter the catalogue.
      </p>
    </section>
  )
}
