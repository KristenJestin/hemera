import type { ReactNode } from 'react'

import { NeedCard } from '../../blocks/need/need-card.tsx'
import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { LiveChip, type LiveState } from '../../components/live-chip/live-chip.tsx'
import { ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { IconBook2, IconClockPause, IconHistory } from '../../icons.ts'
import { ContentHeader } from '../../shell/content-header.tsx'
import { SystemControls } from '../../shell/shell-fixtures.tsx'
import { Page, PageHeader } from '../../surfaces/page.tsx'
import {
  type BootstrapRun,
  type LivingChange,
  type LivingScenario,
  type LivingSpecData,
  originWords,
  waitingOf,
} from './living-spec-fixtures.ts'

/**
 * What the two proposals of the living spec share: the window around the page, the reading of the
 * code as a chip, the page before any domain exists, a requirement's scenarios and its history.
 */

/** What the user can do on the living spec; the proposals offer the same gestures. */
export interface LivingSpecActions {
  onValidate: (domainId: string) => void
  onReject: (domainId: string) => void
  onDrop: (requirementId: string) => void
  onReread: (domainId: string) => void
  /** Reads the whole Project again, or for the first time. */
  onRead: () => void
  /** Opens the mission an origin names, on its archived Spec. */
  onOrigin: (missionId: string) => void
  /** Opens Models by role in the Project settings. */
  onModels: () => void
}

export interface LivingSpecViewProps extends LivingSpecActions {
  data: LivingSpecData
  /** The domain shown open first, by id. */
  opened?: string | undefined
  /** The requirement whose history is shown first, by id. */
  history?: string | undefined
}

/** The window's header over the page: `Acme › Living spec`. */
export function LivingSpecWindow({
  actions,
  about,
  children,
}: {
  actions?: ReactNode
  about?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={() => {}}
        crumbs={[
          { id: 'project', label: 'Acme', onPress: () => {} },
          { id: 'living', label: 'Living spec', icon: <IconBook2 size="sm" /> },
        ]}
        controls={<SystemControls />}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto" data-living-spec="">
        <Page>
          <PageHeader
            lead={<ProjectMark name="Acme" />}
            title="Living spec"
            about={about}
            actions={actions}
          />
          {children}
        </Page>
      </div>
    </main>
  )
}

const LIVE: Record<Exclude<BootstrapRun['state'], 'waiting_for_slot'>, LiveState> = {
  running: 'running',
  done: 'finished',
  failed: 'failed',
  stopped: 'stopped',
}

/**
 * The newest reading as a chip, while it runs and once it ended; a reading waiting for a slot has
 * no chip: what it waits for is said where the content would be, or beside the chip's room.
 */
export function ReadingChip({
  data,
  names,
}: {
  data: LivingSpecData
  names: Readonly<Record<string, string>>
}): ReactNode {
  const run = data.runs[0]
  if (run === undefined) return null
  if (run.state === 'waiting_for_slot') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <IconClockPause size="sm" aria-hidden="true" />
        Waits for a free slot
      </span>
    )
  }
  const waits = Object.values(data.requirements).some((list) => waitingOf(list).length > 0)
  const name = run.domainId === null ? 'Reading Acme' : `Re-reading ${names[run.domainId] ?? ''}`
  return (
    <LiveChip
      name={name}
      icon={<IconBook2 size="sm" />}
      state={LIVE[run.state]}
      startedAt={run.startedAt}
      endedAt={run.endedAt}
      calls={run.state === 'done' && waits}
    />
  )
}

/**
 * The page before any domain exists: nothing read, a reading waiting or running, failed, or no
 * model to run it on. Returns null once there are domains.
 */
export function BeforeDomains({
  data,
  onRead,
  onModels,
}: {
  data: LivingSpecData
  onRead: () => void
  onModels: () => void
}): ReactNode {
  if (data.domains.length > 0) return null
  if (data.noModel === true) {
    return (
      <div className="flex max-w-measure flex-col gap-3">
        <NeedCard
          ask={{ kind: 'environment', settings: 'Models by role' }}
          title="The living spec has no model to read Acme"
          text="Choose a model for the Reader role, and Hemera reads the Project."
          when="now"
          onSettings={onModels}
        />
      </div>
    )
  }
  const run = data.runs[0]
  if (run === undefined) {
    return (
      <Empty
        icon={<IconBook2 />}
        title="No living spec yet"
        description="Hemera reads the code of api, web and shared and proposes what Acme does today, domain by domain."
        action={
          <Button variant="primary" onClick={onRead}>
            Read the Project
          </Button>
        }
      />
    )
  }
  if (run.state === 'failed' || run.state === 'stopped') {
    return (
      <ErrorState
        title="The reading of Acme stopped"
        description={run.sentence ?? 'The agent stopped before it proposed anything.'}
        onRetry={onRead}
      />
    )
  }
  if (run.state === 'waiting_for_slot') {
    return (
      <Empty
        icon={<IconClockPause />}
        title="The reading waits for a free slot"
        description={run.sentence ?? undefined}
      />
    )
  }
  return (
    <Empty
      face="reading"
      title="Hemera is reading Acme"
      description="Its domains appear here as they are proposed. You can leave this page."
    />
  )
}

const WHEN = 'font-medium text-muted-foreground'

/** A requirement's scenarios, When and Then. */
export function Scenarios({ scenarios }: { scenarios: readonly LivingScenario[] }): ReactNode {
  if (scenarios.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5 text-sm" aria-label="Scenarios">
      {scenarios.map((scenario) => (
        <li key={scenario.when} className="flex flex-col gap-0.5 border-l border-border pl-3">
          <span>
            <span className={WHEN}>When </span>
            {scenario.when}
          </span>
          <span>
            <span className={WHEN}>Then </span>
            {scenario.then}
          </span>
        </li>
      ))}
    </ul>
  )
}

const CHANGE_WORDS: Record<LivingChange['what'], string> = {
  proposed: 'Proposed',
  validated: 'Validated',
  rejected: 'Rejected',
  dropped: 'Dropped',
  added: 'Added',
  modified: 'Changed',
  removed: 'Removed',
}

/** Who made a change, as the history says it. */
function byWords(change: LivingChange): string {
  if (change.by === 'user') return 'by you'
  if (change.by === 'bootstrap') return 'by the reading of the code'
  return `by ${originWords(change.byMission)}`
}

/** A requirement's history, the oldest first: each change, by whom, when, and its text. */
export function History({
  changes,
  onOrigin,
}: {
  changes: readonly LivingChange[]
  onOrigin: (missionId: string) => void
}): ReactNode {
  return (
    <ol className="flex flex-col gap-3 text-sm" aria-label="History">
      {changes.map((change) => (
        <li key={`${change.what}-${change.at}`} className="flex gap-2">
          <span className="flex pt-0.5 text-muted-foreground">
            <IconHistory size="sm" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-1.5">
              <span className="font-medium">{CHANGE_WORDS[change.what]}</span>
              {change.byMission === null ? (
                <span className="text-muted-foreground">{byWords(change)}</span>
              ) : (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    if (change.byMission !== null) onOrigin(change.byMission.missionId)
                  }}
                >
                  {byWords(change)}
                </Button>
              )}
              <span className="text-muted-foreground">· {change.at}</span>
            </span>
            {change.textBefore !== null && (
              <del className="text-muted-foreground">{change.textBefore}</del>
            )}
            {change.textAfter !== null && change.what !== 'proposed' && (
              <ins className="no-underline">{change.textAfter}</ins>
            )}
            {change.what === 'proposed' && change.textAfter !== null && (
              <span className="text-muted-foreground">{change.textAfter}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
