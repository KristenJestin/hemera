import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Badge, type BadgeProps } from '../components/badge/badge.tsx'
import { ServiceUrl } from '../workspace/service-list.tsx'
import type { Readiness } from '../workspace/services-model.ts'
import { COMMAND_TYPE_ICONS, COMMAND_TYPE_LABELS, type CommandType } from './command-type.ts'
import { TerminalOutput } from './terminal-output.tsx'

/**
 * What a run shows of itself (D8-06, D8-07).
 *
 * Everything the run was given and everything it gave back, read off the run and not off the
 * catalogue: the line as it ran — the Windows line on Windows, since the machine runs its own
 * variant — the folder it ran in inside its Workspace, the variables Hemera handed it, its output
 * and how it ended. A catalogue entry edited since is not what ran, so none of it is looked up.
 *
 * The variables are sorted by key: they are read to find one, and a list in the order the
 * environment was merged in is a list the eye has to search.
 */
const DETAILS = 'flex w-full min-w-0 flex-col gap-3'

const HEAD = 'flex min-w-0 items-center gap-2'

const ICON = 'flex shrink-0 text-muted-foreground'

const NAME = 'min-w-0 truncate text-base font-medium text-foreground'

/** The facts of the run, one term above its value, laid out in two columns. */
const FACTS = 'grid grid-cols-2 gap-x-4 gap-y-2'

const FACT = 'flex min-w-0 flex-col gap-0.5'

const WIDE = 'col-span-2'

const TERM = 'text-xs text-muted-foreground'

const VALUE = 'min-w-0 truncate text-sm text-foreground'

const MONO = 'min-w-0 font-mono text-sm break-all text-foreground'

const SECTION = 'flex flex-col gap-1'

const HEADING = 'text-xs text-muted-foreground'

const VARIABLES = 'flex flex-col gap-0.5 rounded-md border border-border bg-muted px-2 py-1.5'

const VARIABLE = 'flex min-w-0 gap-2 font-mono text-xs'

const KEY = 'shrink-0 text-foreground'

const SETTING = 'min-w-0 truncate text-muted-foreground'

const NOTE = 'text-sm text-muted-foreground'

/** Where a run stands, as a word: the exit code, once there is one, is the proof beside it. */
export type RunState = 'running' | 'exited' | 'failed' | 'stopped'

const STATE: Record<RunState, { word: string; tone: NonNullable<BadgeProps['tone']> }> = {
  running: { word: 'Running', tone: 'info' },
  exited: { word: 'Exited', tone: 'success' },
  failed: { word: 'Failed', tone: 'destructive' },
  stopped: { word: 'Stopped', tone: 'neutral' },
}

const STARTED_BY: Record<RunDetailsProps['startedBy'], string> = {
  agent: 'The agent',
  user: 'You',
}

export interface RunDetailsProps {
  /** The command's name in the catalogue, or what a one-off is called on screen. */
  name: string
  type: CommandType
  /** The Workspace the run is in. */
  workspace: string
  /** The folder it ran in, as the system writes it. */
  folder: string
  /** The line as it was run: the machine's own variant when the command has one (D8-07). */
  line: string
  /** The variables Hemera gave the run, on top of the machine's environment (D8-06). */
  environment: Readonly<Record<string, string>>
  /** Everything it wrote, exactly as it arrived. */
  output: string
  state: RunState
  /** What it exited with, once it is over. */
  exitCode?: number | undefined
  /** The address its output published, once it published one. */
  url?: string | undefined
  readiness?: Readiness | undefined
  startedBy: 'agent' | 'user'
  /** Where the details sit; never how they look. */
  className?: string | undefined
}

export function RunDetails({
  name,
  type,
  workspace,
  folder,
  line,
  environment,
  output,
  state,
  exitCode,
  url,
  readiness,
  startedBy,
  className,
}: RunDetailsProps): ReactNode {
  const Icon = COMMAND_TYPE_ICONS[type]
  const shown = STATE[state]
  const running = state === 'running'
  // A process stopped under it exits too, but "Stopped" is what happened; the code says nothing.
  const word =
    exitCode === undefined || running || state === 'stopped'
      ? shown.word
      : `Exited ${String(exitCode)}`
  // By code point, as the environment itself is keyed: the same order on every machine and
  // locale, where `localeCompare` would follow the reader's language.
  const variables = Object.entries(environment).toSorted(([one], [other]) =>
    one < other ? -1 : one > other ? 1 : 0,
  )
  return (
    <section className={cn(DETAILS, className)} aria-label={`Run of ${name}`}>
      <div className={HEAD}>
        <span className={ICON}>
          <Icon size="sm" aria-hidden="true" />
        </span>
        <span className={NAME}>{name}</span>
        <Badge tone="neutral">{COMMAND_TYPE_LABELS[type]}</Badge>
        <Badge tone={shown.tone}>{word}</Badge>
      </div>

      <dl className={FACTS}>
        <div className={FACT}>
          <dt className={TERM}>Workspace</dt>
          <dd className={VALUE}>{workspace}</dd>
        </div>
        <div className={FACT}>
          <dt className={TERM}>Started by</dt>
          <dd className={VALUE}>{STARTED_BY[startedBy]}</dd>
        </div>
        <div className={cn(FACT, WIDE)}>
          <dt className={TERM}>Folder</dt>
          <dd className={MONO}>{folder}</dd>
        </div>
        <div className={cn(FACT, WIDE)}>
          <dt className={TERM}>Line</dt>
          <dd className={MONO}>{line}</dd>
        </div>
        {url !== undefined && (
          <div className={cn(FACT, WIDE)}>
            <dt className={TERM}>Address</dt>
            <dd>
              <ServiceUrl url={url} readiness={readiness} />
            </dd>
          </div>
        )}
      </dl>

      <div className={SECTION}>
        <span className={HEADING}>Variables given</span>
        {variables.length === 0 ? (
          <p className={NOTE}>None beyond the machine's environment.</p>
        ) : (
          <ul className={VARIABLES} aria-label="Variables given">
            {variables.map(([key, value]) => (
              <li key={key} className={VARIABLE}>
                <span className={KEY}>{key}</span>
                <span className={SETTING}>{value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TerminalOutput plain terminalId={name} output={output} released={!running} />
    </section>
  )
}
