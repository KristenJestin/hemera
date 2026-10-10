import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { LiveChip, type LiveState } from '../../components/live-chip/live-chip.tsx'
import { IconAlertTriangle, IconCheck, IconEye } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { SeverityMark } from './planning-marks.tsx'
import type { ColdReadPass, Finding, Freshness, Severity } from './planning-types.ts'
import { SendButton } from './sending.tsx'

const ROW = 'flex min-w-0 items-start gap-2 border-b border-border px-4 py-2.5 last:border-b-0'

const PASS_LIVE: Record<ColdReadPass['state'], LiveState> = {
  waiting_for_slot: 'running',
  running: 'running',
  done: 'finished',
  failed: 'failed',
}

/** The cold read's pass as its LiveChip, while it waits for a slot or runs. */
function ColdReadChip({ pass }: { pass: ColdReadPass }): ReactNode {
  return (
    <LiveChip
      name={`Cold read ${pass.label}`}
      icon={<IconEye size="sm" />}
      state={pass.stuck ? 'stuck' : PASS_LIVE[pass.state]}
      startedAt={pass.startedAt}
      endedAt={pass.endedAt}
      glance={{
        kind: 'helper',
        type: 'Cold read',
        step:
          pass.state === 'waiting_for_slot'
            ? 'Waits for a free agent'
            : 'A fresh reader goes through the Spec',
      }}
    />
  )
}

function FindingRow({
  finding,
  onDismiss,
}: {
  finding: Finding
  onDismiss: ((id: string) => Promise<void>) | undefined
}): ReactNode {
  // A finding on the tasks is fixed by the Planner without asking; the user may still dismiss it.
  const dismissable = finding.fate === 'open' || (finding.fate === 'fixed' && finding.tasksOnly)
  return (
    <li
      className={cn(ROW, finding.fate === 'dismissed' && 'text-muted-foreground')}
      data-fate={finding.fate}
    >
      <span className="flex pt-0.5">
        <SeverityMark severity={finding.severity} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm break-words">{finding.text}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">{finding.where.join(' · ')}</span>
          {finding.fate === 'asked' && <span>Asked as {finding.questionId}</span>}
          {finding.fate === 'fixed' && (
            <span className="flex min-w-0 items-center gap-1">
              <IconCheck size="sm" />
              <span className="break-words">Fixed by the Planner: {finding.fixedWhat}</span>
            </span>
          )}
          {finding.fate === 'dismissed' && <span>Dismissed</span>}
        </p>
      </div>
      {dismissable && onDismiss !== undefined && (
        <SendButton
          variant="ghost"
          size="sm"
          aria-label={`Dismiss ${finding.id}`}
          onSend={() => onDismiss(finding.id)}
        >
          Dismiss
        </SendButton>
      )}
    </li>
  )
}

/** "The cold read read an earlier text", and what changed since, folded. */
function FreshnessLine({ freshness }: { freshness: Freshness }): ReactNode {
  const folding = useTransition(fold)
  const [open, setOpen] = useState(false)
  if (freshness.current) return null
  return (
    <div className="flex flex-col gap-1 px-4 py-2 text-xs text-muted-foreground">
      <button
        type="button"
        className="flex w-fit items-center gap-1.5 rounded-sm text-left outline-none hover:text-foreground focus-ring hover-motion"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <IconAlertTriangle size="sm" />
        The cold read read an earlier text · {freshness.changes.length} changes since
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            key="changes"
            aria-label="Changed since the cold read"
            className="flex flex-col gap-0.5 overflow-hidden pl-6"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            {freshness.changes.map((change) => (
              <li key={`${change.item}${change.at}`} className="truncate">
                <span className="font-mono">{change.item}</span> · {change.after ?? 'removed'}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

const SEVERITIES: readonly Severity[] = ['blocking', 'warning', 'suggestion']

export interface ColdReadReportProps {
  /** The mission's passes, the first first: the report is the last one's. */
  passes: readonly ColdReadPass[]
  freshness: Freshness
  /** Left out once frozen: nothing is dismissed or run again then. */
  onDismiss?: ((findingId: string) => Promise<void>) | undefined
  onRunAgain?: (() => Promise<void>) | undefined
}

/**
 * The cold read's report: its pass's chip while it runs, the text it read against the Spec now,
 * its findings by severity with what became of each, Dismiss, and "Run another cold read", the
 * user's only way to launch one. Not drawn before the first pass.
 */
export function ColdReadReport({
  passes,
  freshness,
  onDismiss,
  onRunAgain,
}: ColdReadReportProps): ReactNode {
  const pass = passes.at(-1)
  if (pass === undefined) return null
  const busy = pass.state === 'running' || pass.state === 'waiting_for_slot'
  const findings = SEVERITIES.flatMap((severity) =>
    pass.findings.filter((finding) => finding.severity === severity),
  )
  const open = pass.findings.filter((finding) => finding.fate === 'open').length
  return (
    <section aria-label="Cold read">
      <Frame
        header={
          <FrameHeader
            icon={<IconEye size="md" />}
            title="Cold read"
            description={
              busy || pass.state === 'failed' || open === 0
                ? undefined
                : `${String(open)} to settle`
            }
            action={
              busy ? (
                <ColdReadChip pass={pass} />
              ) : onRunAgain === undefined ? undefined : (
                <SendButton variant="link" size="sm" onSend={onRunAgain}>
                  Run another cold read
                </SendButton>
              )
            }
          />
        }
      >
        {pass.state === 'failed' ? (
          <p className="px-4 py-3 text-sm break-words text-destructive">
            The cold read failed: {pass.failure}
          </p>
        ) : busy ? (
          <ul aria-label="Findings" aria-busy="true" className="flex flex-col">
            {[0, 1].map((row) => (
              <li key={row} className={ROW}>
                <span className="h-4 w-full rounded-sm bg-skeleton motion-safe:animate-breathe" />
              </li>
            ))}
          </ul>
        ) : (
          <>
            <FreshnessLine freshness={freshness} />
            {findings.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nothing found.</p>
            ) : (
              <ul aria-label="Findings" className="flex flex-col border-t border-border">
                {findings.map((finding) => (
                  <FindingRow key={finding.id} finding={finding} onDismiss={onDismiss} />
                ))}
              </ul>
            )}
          </>
        )}
      </Frame>
    </section>
  )
}
