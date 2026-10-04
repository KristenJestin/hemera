import { SectionHead } from '../../components/section-head/section-head.tsx'
import { type ReactNode, useEffect, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { LIVE_WORDS, type LiveState, durationOf } from '../../components/live-chip/live-chip.tsx'
import { LiveChipGlance } from '../../components/live-chip/live-chip-glance.tsx'
import { Popover } from '../../components/popover/popover.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { IconPlayerPlay } from '../../icons.ts'
import { type CommandType, typeIcon } from './command-types.tsx'
import { Section } from './parts.tsx'

/**
 * What runs in a Project's main checkout, as a table: its services and the commands started there.
 *
 * In a table, the line is the thing that runs: its state as a mark, its name, where it runs, the
 * line it runs and how long it has run, in fixed-width digits at the end. Pressing the line opens
 * its glance — the same as a live chip's: its state in words, its address to copy and to open, the
 * last lines it printed, Restart and Stop, Run again — so nothing to press stands beside it. The
 * live chip is for what runs inline, in a header or a line of a page; a table is not one.
 *
 * Two lines are not live, and each carries its one action: a service of the main checkout that is
 * not running, with Start; and a command marked to run at each opening and to ask first, which
 * waits for the user — the waiting mark, Not now, and Run.
 */
export type SettingsRun =
  | {
      readonly kind: 'live'
      readonly id: string
      readonly name: string
      readonly type: CommandType
      readonly line: string
      readonly place: string
      readonly state: LiveState
      readonly startedAt: number
      readonly endedAt: number | null
      /** A service's address, once it published one. */
      readonly url?: string | undefined
      /** The last lines it printed, oldest first. */
      readonly output?: readonly string[] | undefined
    }
  | {
      /** Run at each opening, and asks first: it waits for the user. */
      readonly kind: 'waiting'
      readonly id: string
      readonly name: string
      readonly type: CommandType
      readonly line: string
      readonly place: string
    }
  | {
      /** A service of the main checkout, not running. */
      readonly kind: 'idle'
      readonly id: string
      readonly name: string
      readonly type: CommandType
      readonly line: string
      readonly place: string
    }

/** A command of the catalogue that can be run in the main checkout, from the section's head. */
export interface RunnableCommand {
  id: string
  name: string
  type: CommandType
}

const RULE = 'border-b border-border last:border-b-0'

/** A line of the table that opens its glance: the whole line is the control. */
const OPEN =
  'flex h-control-lg w-full min-w-0 items-center gap-3 rounded-md px-4 text-left text-sm outline-none hover:tinted focus-ring hover-motion data-popup-open:tinted'

const ROW = 'flex h-control-lg min-w-0 items-center gap-3 px-4 text-sm'

const HEAD =
  'flex h-control-sm min-w-0 items-center gap-3 border-b border-border px-4 text-xs text-muted-foreground'

/** The state's room, held whether a mark is drawn in it or not. */
const MARK = 'flex size-icon-md shrink-0 items-center justify-center'

const NAME = 'w-settings-name min-w-0 shrink-0 truncate font-medium'

const PLACE = 'w-24 min-w-0 shrink-0 truncate font-mono text-xs text-muted-foreground'

const LINE = 'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'

/** Four digits and the unit, against the end: the column does not move as a digit arrives. */
const TIME = 'w-12 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums'

const END = 'flex shrink-0 items-center gap-2'

/** The mark each state is shown with in the table, from the status mark's family. */
const MARKS: Record<LiveState, MarkState> = {
  running: 'running',
  stuck: 'waiting',
  finished: 'done',
  failed: 'failed',
  stopped: 'skipped',
}

/** The time now, read again every second while something runs. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return undefined
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [ticking])
  return now
}

export interface RunRowProps {
  run: SettingsRun
  onStart: () => void
  onAllow: () => void
  onDecline: () => void
  onRestart: () => void
  onStop: () => void
  onCopyUrl: () => void
  onOpenUrl: () => void
  onDetails: () => void
}

/** A live line: the whole line opens its glance. */
function LiveRow({
  run,
  onRestart,
  onStop,
  onCopyUrl,
  onOpenUrl,
  onDetails,
}: Omit<RunRowProps, 'run' | 'onStart' | 'onAllow' | 'onDecline'> & {
  run: Extract<SettingsRun, { kind: 'live' }>
}): ReactNode {
  const now = useNow(run.endedAt === null)
  const time = durationOf((run.endedAt ?? now) - run.startedAt)
  const service = run.type === 'serve'
  return (
    <li className={RULE} data-run={run.name} data-run-kind="live" data-state={run.state}>
      <Popover
        label={run.name}
        align="start"
        className="flex w-full"
        trigger={
          <button
            type="button"
            className={OPEN}
            aria-label={`${run.name}, ${LIVE_WORDS[run.state]}, ${time}`}
          >
            <span className={MARK}>
              <StatusMark state={MARKS[run.state]} size="sm" />
            </span>
            <span className={NAME}>{run.name}</span>
            <span className={PLACE}>{placeWord(run.place)}</span>
            <span className={LINE}>{run.line}</span>
            <span className={TIME}>{time}</span>
          </button>
        }
      >
        <LiveChipGlance
          name={run.name}
          state={run.state}
          time={time}
          glance={{
            kind: service ? 'service' : 'run',
            type: `${service ? 'Service' : 'Command'} · ${run.line}`,
            url: run.url,
            output: run.output,
            onRestart,
            onStop,
            onRunAgain: onRestart,
            onDetails,
            onCopyUrl: run.url === undefined ? undefined : onCopyUrl,
            onOpenUrl: run.url === undefined ? undefined : onOpenUrl,
          }}
        />
      </Popover>
    </li>
  )
}

/** Where a line runs, as the table says it. */
function placeWord(place: string): string {
  return place === '.' ? 'root' : place
}

export function RunRow({ run, onStart, onAllow, onDecline, ...live }: RunRowProps): ReactNode {
  if (run.kind === 'live') return <LiveRow run={run} {...live} />
  return (
    <li className={RULE} data-run={run.name} data-run-kind={run.kind}>
      <div className={ROW}>
        <span className={MARK}>
          <StatusMark
            state={run.kind === 'waiting' ? 'waiting' : 'idle'}
            size="sm"
            legend={run.kind === 'waiting'}
          />
        </span>
        <span className={NAME}>{run.name}</span>
        <span className={PLACE}>{placeWord(run.place)}</span>
        <span className={LINE}>{run.line}</span>
        {run.kind === 'waiting' ? (
          <span className={END}>
            <Button variant="ghost" size="sm" onClick={onDecline}>
              Not now
            </Button>
            <Button variant="primary" size="sm" onClick={onAllow}>
              <IconPlayerPlay size="sm" />
              Run {run.name}
            </Button>
          </span>
        ) : (
          <span className={END}>
            <Button size="sm" onClick={onStart}>
              <IconPlayerPlay size="sm" />
              Start {run.name}
            </Button>
          </span>
        )}
      </div>
    </li>
  )
}

/** The row's own shape while the runs are on their way. */
export function RunRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <div className={ROW}>
        <span className={MARK}>
          <Skeleton shape="block">
            <span className="flex size-icon-sm" />
          </Skeleton>
        </span>
        <span className={NAME}>
          <Skeleton>web-dev</Skeleton>
        </span>
        <span className={PLACE}>
          <Skeleton>web</Skeleton>
        </span>
        <span className={LINE}>
          <Skeleton>pnpm --filter web dev</Skeleton>
        </span>
        <span className={TIME}>
          <Skeleton>84s</Skeleton>
        </span>
      </div>
    </li>
  )
}

/** The head of the columns, in the quiet tone. */
function ColumnsHead(): ReactNode {
  return (
    <div className={HEAD}>
      <span className={MARK} />
      <span className="w-settings-name shrink-0">Name</span>
      <span className="w-24 shrink-0">Runs in</span>
      <span className="min-w-0 flex-1">Line</span>
      <span className="w-12 shrink-0 text-right">Time</span>
    </div>
  )
}

export interface ServicesSectionProps {
  runs: readonly SettingsRun[]
  /** What can be started from the head of the section. */
  commands: readonly RunnableCommand[]
  loading?: boolean | undefined
  onRun: (commandId: string) => void
  onStart: (id: string) => void
  onAllow: (id: string) => void
  onDecline: (id: string) => void
  onRestart: (id: string) => void
  onStop: (id: string) => void
  onCopyUrl: (id: string) => void
  onOpenUrl: (id: string) => void
  onDetails: (id: string) => void
}

export function ServicesSection({
  runs,
  commands,
  loading = false,
  onRun,
  onStart,
  onAllow,
  onDecline,
  onRestart,
  onStop,
  onCopyUrl,
  onOpenUrl,
  onDetails,
}: ServicesSectionProps): ReactNode {
  const run =
    commands.length === 0 ? undefined : (
      <Menu
        label="Run a command"
        size="sm"
        groups={[
          commands.map((command) => ({
            label: command.name,
            icon: <span className="flex text-muted-foreground">{typeIcon(command.type)}</span>,
            onSelect: () => onRun(command.id),
          })),
        ]}
      />
    )
  const empty = !loading && runs.length === 0
  return (
    <Section label="Services">
      <SectionHead title="Services" actions={loading || empty ? undefined : run} />
      <Frame>
        {empty ? (
          <Empty face="asleep" title="Nothing runs" action={run} />
        ) : (
          <>
            <ColumnsHead />
            <ul
              aria-label="Running in the main checkout"
              aria-busy={loading}
              className="flex flex-col"
            >
              {loading ? (
                <>
                  <RunRowSkeleton />
                  <RunRowSkeleton />
                </>
              ) : (
                runs.map((one) => (
                  <RunRow
                    key={one.id}
                    run={one}
                    onStart={() => onStart(one.id)}
                    onAllow={() => onAllow(one.id)}
                    onDecline={() => onDecline(one.id)}
                    onRestart={() => onRestart(one.id)}
                    onStop={() => onStop(one.id)}
                    onCopyUrl={() => onCopyUrl(one.id)}
                    onOpenUrl={() => onOpenUrl(one.id)}
                    onDetails={() => onDetails(one.id)}
                  />
                ))
              )}
            </ul>
          </>
        )}
      </Frame>
    </Section>
  )
}
