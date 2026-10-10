import type { ReactNode } from 'react'

import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { LiveChip, type LiveState } from '../../components/live-chip/live-chip.tsx'
import { Loading } from '../../components/loading/loading.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { IconTestPipe } from '../../icons.ts'
import type { Probe, ProbeDetail } from './planning-types.ts'

const QUIET = 'text-xs text-muted-foreground'

const PRE =
  'max-w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap'

function liveOf(probe: Probe): LiveState {
  if (probe.stuck) return 'stuck'
  if (probe.state === 'done') return 'finished'
  if (probe.state === 'failed') return 'failed'
  if (probe.state === 'interrupted') return 'stopped'
  return 'running'
}

/** A Probe as its LiveChip: no × and no stop; once it has ended, a press opens its report. */
export function ProbeChip({
  probe,
  onOpen,
}: {
  probe: Probe
  onOpen: (id: string) => void
}): ReactNode {
  const live = liveOf(probe)
  const going = live === 'running' || live === 'stuck'
  return (
    <LiveChip
      name={`Probe ${probe.label} · ${probe.question}`}
      icon={<IconTestPipe size="sm" />}
      state={live}
      startedAt={probe.startedAt}
      endedAt={probe.endedAt}
      onPress={going ? undefined : () => onOpen(probe.id)}
      glance={
        going
          ? { kind: 'probe', type: 'Probe', step: probe.step, onDetails: () => onOpen(probe.id) }
          : undefined
      }
    />
  )
}

/**
 * The Probes of the mission, in the rail: a chip each, the first launched first, and nothing
 * beside them. Not drawn before the first Probe.
 */
export function ProbesCard({
  probes,
  onOpen,
}: {
  probes: readonly Probe[]
  onOpen: (id: string) => void
}): ReactNode {
  if (probes.length === 0) return null
  return (
    <section aria-label="Probes">
      <Frame header={<FrameHeader icon={<IconTestPipe size="md" />} title="Probes" />}>
        <div className="flex flex-wrap gap-1.5 px-3 py-3">
          {probes.map((probe) => (
            <ProbeChip key={probe.id} probe={probe} onOpen={onOpen} />
          ))}
        </div>
      </Frame>
    </section>
  )
}

const OUTCOME_WORDS: Record<NonNullable<Probe['outcome']>, string> = {
  reproduced: 'Reproduced',
  not_reproduced: 'Not reproduced',
  answered: 'Answered',
  inconclusive: 'Inconclusive',
}

const PROBE_POSE: Record<Probe['state'], MarkState> = {
  preparing: 'running',
  running: 'running',
  done: 'done',
  failed: 'failed',
  interrupted: 'skipped',
}

/** What a run printed, its key line in the destructive tone. */
function Output({ text, keyLine }: { text: string; keyLine?: string | undefined }): ReactNode {
  return (
    <pre className={PRE}>
      {text.split('\n').map((line, index) =>
        line === keyLine ? (
          <span key={`${String(index)}${line}`} className="block text-destructive" data-key-line="">
            {line}
          </span>
        ) : (
          <span key={`${String(index)}${line}`} className="block">
            {line}
          </span>
        ),
      )}
    </pre>
  )
}

/** A Probe's report, opened over the page; while it is read, Hemera's face. */
export function ProbeReport({ probe }: { probe: ProbeDetail | null }): ReactNode {
  if (probe === null) {
    return (
      <div className="flex justify-center px-6 py-10">
        <Loading label="Reading the Probe" />
      </div>
    )
  }
  const { report } = probe
  return (
    <div className="flex max-w-measure min-w-0 flex-col gap-4 px-6 py-5 text-sm break-words">
      <p className="flex items-center gap-2">
        <StatusMark state={PROBE_POSE[probe.state]} size="sm" />
        <span className="font-medium">
          {probe.outcome !== null
            ? OUTCOME_WORDS[probe.outcome]
            : probe.state === 'failed'
              ? 'Failed'
              : probe.state === 'interrupted'
                ? 'Interrupted'
                : 'Still running'}
        </span>
        {probe.scenario !== null && (
          <span className="font-mono text-xs text-muted-foreground">for {probe.scenario}</span>
        )}
      </p>
      <p className="font-medium">{probe.question}</p>
      {probe.failure !== null && <p className="text-destructive">{probe.failure}</p>}
      {report !== null && (
        <>
          <p>{report.answer}</p>
          <div className="flex flex-col gap-1">
            <span className={QUIET}>What it did</span>
            <ol className="flex list-decimal flex-col gap-0.5 pl-5">
              {report.actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ol>
          </div>
          {report.command !== undefined && <pre className={PRE}>{report.command}</pre>}
          {report.observed !== undefined && (
            <Output text={report.observed} keyLine={report.keyLine} />
          )}
          {report.evidence.length > 0 && (
            <p className={QUIET}>Evidence kept: {report.evidence.join(', ')}</p>
          )}
        </>
      )}
      {report === null && probe.step !== undefined && <p className={QUIET}>{probe.step}</p>}
    </div>
  )
}
