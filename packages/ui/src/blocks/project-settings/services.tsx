import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { LiveChip, type LiveState } from '../../components/live-chip/live-chip.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { IconPlayerPlay } from '../../icons.ts'
import { type CommandType, typeIcon } from './commands.tsx'
import { Section, SectionHead } from './parts.tsx'

/**
 * What runs in a Project's main checkout: its services and the commands started there.
 *
 * What goes on is its live chip and nothing beside it — its state is the chip's, its address, the
 * last lines it printed, Restart and Stop are in the glance the chip opens. A service starting
 * breathes and has no address yet; ready, its glance holds the address to copy and to open;
 * failed, the chip says so once, and its glance holds what it printed last and Restart. Beside the
 * chip, quietly, where it runs and the line it runs.
 *
 * Two lines are not live, and each carries its one action: a service of the main checkout that is
 * not running, with Start; and a command marked to run at each opening and to ask first, which
 * waits for the user — the waiting mark, Run, and Not now.
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

const ROW = 'flex h-control-lg min-w-0 items-center gap-3 px-4 text-sm'

/** The room of the chip, held by what stands in for it on a line that is not live. */
const LEAD = 'flex w-chip min-w-0 shrink-0 items-center gap-2'

const NAME = 'min-w-0 truncate font-medium'

const TYPE = 'flex size-icon-md shrink-0 items-center justify-center text-muted-foreground'

const LINE = 'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'

const PLACE = 'w-24 min-w-0 shrink-0 truncate font-mono text-xs text-muted-foreground'

const END = 'flex shrink-0 items-center gap-2'

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

export function RunRow({
  run,
  onStart,
  onAllow,
  onDecline,
  onRestart,
  onStop,
  onCopyUrl,
  onOpenUrl,
  onDetails,
}: RunRowProps): ReactNode {
  const service = run.type === 'serve'
  return (
    <li className={RULE} data-run={run.name} data-run-kind={run.kind}>
      <div className={ROW}>
        {run.kind === 'live' ? (
          <span className={LEAD}>
            <LiveChip
              name={run.name}
              icon={typeIcon(run.type)}
              state={run.state}
              startedAt={run.startedAt}
              endedAt={run.endedAt}
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
          </span>
        ) : (
          <span className={LEAD}>
            {run.kind === 'waiting' ? (
              <StatusMark state="waiting" size="sm" legend />
            ) : (
              <span className={TYPE} aria-hidden="true">
                {typeIcon(run.type)}
              </span>
            )}
            <span className={NAME}>{run.name}</span>
          </span>
        )}
        <span className={PLACE}>{run.place === '.' ? 'root' : run.place}</span>
        <span className={LINE}>{run.line}</span>
        {run.kind === 'waiting' && (
          <span className={END}>
            <Button variant="ghost" size="sm" onClick={onDecline}>
              Not now
            </Button>
            <Button variant="primary" size="sm" onClick={onAllow}>
              <IconPlayerPlay size="sm" />
              Run {run.name}
            </Button>
          </span>
        )}
        {run.kind === 'idle' && (
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

/** The row's own shape while the runs are on their way: the chip's room, the line, the place. */
export function RunRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <div className={ROW}>
        <span className={LEAD}>
          <span className="flex h-control-sm w-chip rounded-md bg-skeleton motion-safe:animate-breathe" />
        </span>
        <span className={PLACE}>
          <Skeleton>web</Skeleton>
        </span>
        <span className={LINE}>
          <Skeleton>pnpm --filter web dev</Skeleton>
        </span>
      </div>
    </li>
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
        )}
      </Frame>
    </Section>
  )
}
