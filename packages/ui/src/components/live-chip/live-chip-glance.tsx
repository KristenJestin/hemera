import type { ReactNode } from 'react'

import {
  IconClockPause,
  IconCopy,
  IconExternalLink,
  IconInfoCircle,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
} from '../../icons.ts'
import { Button, IconButton } from '../button/button.tsx'
import { type MarkState, StatusMark } from '../status-mark/status-mark.tsx'
import type { LiveState } from './tint.tsx'

/**
 * The glance of a live chip: what pressing the chip opens, for a run, a service, a helper and a
 * Probe alike — everything about what goes on, and everything that can be done about it. A page
 * shows the chip and nothing beside it: no Restart or Stop on the line, they are here.
 *
 * - Its state with its mark, and how long, in words: "Running for 84s", "Failed after 12s".
 * - Its whole name, never cut, and its type: "Command · pnpm test".
 * - A service's address, with copy and open.
 * - The last lines it printed — a short tail of five at most, the newest at the bottom, one line
 *   each and never wrapped — or, for a helper, the step it is on.
 * - Its actions, by kind and state: Restart and Stop while a run or a service works; Run again
 *   once a run or a Probe has ended, Restart once a service has; nothing to stop on a helper or a
 *   Probe — nobody stops them by hand. ⓘ opens its details, always.
 *
 * Plain React: values in, callbacks out. An action whose callback is not given is not offered.
 */

/** What goes on, which decides what can be done about it. */
export type LiveKind = 'run' | 'service' | 'helper' | 'probe'

export interface LiveGlance {
  kind: LiveKind
  /** What it is, in words: "Command · pnpm test", "Service · pnpm dev", "Helper". */
  type: string
  /** A service's address. */
  url?: string | undefined
  /** The step it is on, in words. */
  step?: string | undefined
  /** The last lines it printed or said, oldest first. */
  output?: readonly string[] | undefined
  onRestart?: (() => void) | undefined
  onStop?: (() => void) | undefined
  onRunAgain?: (() => void) | undefined
  onDetails?: (() => void) | undefined
  onCopyUrl?: (() => void) | undefined
  onOpenUrl?: (() => void) | undefined
}

/** The mark each state is shown with, from the status mark's family. */
const MARKS: Record<Exclude<LiveState, 'stuck'>, MarkState> = {
  running: 'running',
  finished: 'done',
  failed: 'failed',
  stopped: 'skipped',
}

/** The state and how long, in words. */
export function glanceWordsOf(state: LiveState, time: string): string {
  if (state === 'running') return `Running for ${time}`
  if (state === 'stuck') return `No activity for 5 minutes · ${time}`
  if (state === 'finished') return `Done in ${time}`
  if (state === 'failed') return `Failed after ${time}`
  return `Stopped after ${time}`
}

const PANEL = 'flex w-glance max-w-full flex-col gap-3'

const HEAD = 'flex items-center gap-2 text-sm text-muted-foreground'

const NAME = 'text-base font-semibold break-all text-foreground'

const TYPE = 'text-sm text-muted-foreground'

const ADDRESS =
  'flex items-center gap-1 rounded-md border border-border bg-muted py-0.5 pr-0.5 pl-2 font-mono text-sm'

/** How many of the last lines a glance shows: a short tail, the newest at the bottom. */
const TAIL = 5

/** The tail: one line each, never wrapped, cut at the panel's edge, muted, in the code face. */
const OUTPUT =
  'flex flex-col rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground'

const LINE = 'truncate whitespace-pre'

const ACTIONS = 'flex items-center gap-2 border-t border-border pt-3'

/** Whether something is at work. */
function working(state: LiveState): boolean {
  return state === 'running' || state === 'stuck'
}

export interface LiveChipGlanceProps {
  name: string
  state: LiveState
  /** How long it has run, as the chip shows it. */
  time: string
  glance: LiveGlance
}

export function LiveChipGlance({ name, state, time, glance }: LiveChipGlanceProps): ReactNode {
  const { kind, onRestart, onStop, onRunAgain, onDetails } = glance
  const stoppable = kind === 'run' || kind === 'service'
  const restart = stoppable && (working(state) || kind === 'service') ? onRestart : undefined
  const stop = stoppable && working(state) ? onStop : undefined
  const again = (kind === 'run' || kind === 'probe') && !working(state) ? onRunAgain : undefined
  return (
    <div className={PANEL} data-glance={kind}>
      <div className={HEAD}>
        {state === 'stuck' ? (
          <span className="flex text-warning">
            <IconClockPause size="sm" aria-hidden="true" />
          </span>
        ) : (
          <StatusMark state={MARKS[state]} size="sm" />
        )}
        <span>{glanceWordsOf(state, time)}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className={NAME}>{name}</span>
        <span className={TYPE}>{glance.type}</span>
      </div>
      {glance.url !== undefined && (
        <div className={ADDRESS}>
          <span className="min-w-0 flex-1 truncate">{glance.url}</span>
          {glance.onCopyUrl !== undefined && (
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconCopy size="sm" />}
              aria-label="Copy the address"
              onClick={glance.onCopyUrl}
            />
          )}
          {glance.onOpenUrl !== undefined && (
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconExternalLink size="sm" />}
              aria-label="Open the address"
              onClick={glance.onOpenUrl}
            />
          )}
        </div>
      )}
      {glance.step !== undefined && <p className="text-sm text-foreground">{glance.step}</p>}
      {glance.output !== undefined && glance.output.length > 0 && (
        <div className={OUTPUT} data-output="">
          {glance.output.slice(-TAIL).map((line, at) => (
            // Lines of output repeat; where they stand is what tells them apart.
            // oxlint-disable-next-line react/no-array-index-key -- the order is the identity
            <span key={at} className={LINE}>
              {line}
            </span>
          ))}
        </div>
      )}
      {(restart ?? stop ?? again ?? onDetails) !== undefined && (
        <div className={ACTIONS}>
          {restart !== undefined && (
            <Button size="sm" onClick={restart}>
              <IconRefresh size="sm" />
              Restart
            </Button>
          )}
          {stop !== undefined && (
            <Button size="sm" onClick={stop}>
              <IconPlayerStop size="sm" />
              Stop
            </Button>
          )}
          {again !== undefined && (
            <Button size="sm" onClick={again}>
              <IconPlayerPlay size="sm" />
              Run again
            </Button>
          )}
          {onDetails !== undefined && (
            <span className="ml-auto flex">
              <IconButton
                variant="ghost"
                size="sm"
                icon={<IconInfoCircle size="sm" />}
                aria-label="Details"
                onClick={onDetails}
              />
            </span>
          )}
        </div>
      )}
    </div>
  )
}
