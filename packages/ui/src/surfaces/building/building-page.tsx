import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

import { StageCard, type StageCardProps } from '../../blocks/mission/stage-card.tsx'
import { Button, IconButton } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { LiveChip } from '../../components/live-chip/live-chip.tsx'
import { Popover } from '../../components/popover/popover.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import {
  MARK_LEGENDS,
  type MarkState,
  StatusMark,
} from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconChecklist,
  IconChevronRight,
  IconCopy,
  IconGitCompare,
  IconHistory,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTerminal,
  IconX,
} from '../../icons.ts'
import {
  CHEVRON,
  CODE,
  Fold,
  ID,
  LINE,
  MissionFolds,
  QUIET,
  ROW,
  Unfolding,
} from './building-parts.tsx'
import type {
  BuildingMoment,
  Check,
  ProofState,
  Requirement,
  RoundPoint,
  Scenario,
  Task,
  TaskState,
} from './building-types.ts'

/**
 * The Building page as #149 proposes it, in the language of the Planning page's rail (#193): the
 * work in the middle — the spine of requirements, each with its tasks and its proofs — and a rail
 * that says, top to bottom, what happens (the Building card, with the chips of what runs), then
 * what no one needs to watch, one quiet line each: the services, the checks, the changes, the
 * journal, and the mission's own things. The needs stand above it all, in the mission's frame.
 *
 * Nothing is open that does not call: a requirement opens by itself only while one of its tasks
 * runs or waits, the checks only when one failed or the final ones run, the changes only when a
 * repository was changed outside Hemera.
 */

/** What a service's row can do with it, by its id. */
export type ServiceAction = 'start' | 'stop' | 'restart' | 'copy' | 'open' | 'dismiss'

export interface BuildingHandlers {
  onOpenTask: (id: string) => void
  /** Opens the diff of a repository; left out while there is no diff to open it in. */
  onOpenDiff?: ((repository: string) => void) | undefined
  onService: (id: string, action: ServiceAction) => void
  onRevoke: (id: string) => void
  /** Reads the journal further back. */
  onJournalMore?: (() => void) | undefined
}

export interface BuildingPageProps extends BuildingHandlers {
  moment: BuildingMoment
  /** The task last opened, which the base keeps. */
  chosenTask?: string | undefined
  /** Whether the page waits for its first read: its rows are skeletons. */
  loading?: boolean | undefined
}

const COLUMNS = 'flex min-w-0 flex-col gap-8 px-8 pt-2 pb-10 lg:flex-row-reverse lg:items-start'

const MAIN = 'flex min-w-0 flex-1 flex-col gap-6'

const RAIL = 'flex w-full min-w-0 shrink-0 flex-col gap-6 lg:w-view-narrow'

const TASK_MARK: Record<TaskState, MarkState> = {
  todo: 'todo',
  running: 'running',
  verified: 'done',
  unverified: 'unverified',
  waiting: 'waiting',
  blocked: 'blocked',
  skipped: 'skipped',
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

/** Whether a requirement is proven: every scenario green, none to run again. */
export function provenOf(requirement: Requirement): boolean {
  return requirement.scenarios.every((scenario) => scenario.proof === 'green')
}

export interface Measures {
  /** Tasks done and verified, of the tasks not skipped: the percentage. */
  percent: number
  verified: number
  /** Done, verified or not. */
  done: number
  tasks: number
  proven: number
  requirements: number
}

/**
 * The two measures and the percentage. The percentage counts only the tasks done and verified:
 * a task done but not verified may still go back, and a figure that falls back reads as a lie.
 * Skipped tasks are not counted, and the special tasks `RV…` are counted apart.
 */
export function measuresOf(moment: BuildingMoment): Measures {
  const all = [
    ...moment.requirements.flatMap((requirement) => requirement.tasks),
    ...(moment.points ?? []).flatMap((point) => point.tasks),
  ].filter((one) => one.state !== 'skipped')
  const verified = all.filter((one) => one.state === 'verified').length
  const done = all.filter((one) => one.state === 'verified' || one.state === 'unverified').length
  return {
    percent: all.length === 0 ? 0 : Math.floor((verified / all.length) * 100),
    verified,
    done,
    tasks: all.length,
    proven: moment.requirements.filter(provenOf).length,
    requirements: moment.requirements.length,
  }
}

const HELPER_TYPE: Record<BuildingMoment['helpers'][number]['kind'], string> = {
  helper: 'Helper',
  documenter: 'Documenter',
  reviewer: 'Reviewer',
}

/** The progress line: the phase under way, and how far it is. */
export function progressOf(moment: BuildingMoment): StageCardProps['progress'] {
  const measures = measuresOf(moment)
  if (moment.points !== undefined && moment.points.length > 0) {
    const done = moment.points.filter((point) =>
      point.tasks.every((one) => one.state === 'verified'),
    ).length
    return {
      step: `Round ${String(moment.round)}`,
      detail: `${String(done)} of ${plural(moment.points.length, 'point', 'points')} done`,
    }
  }
  const phase = moment.phases.find((one) => one.state === 'running' && one.id !== 'tasks')
  if (phase !== undefined) {
    return { step: phase.title, detail: phase.detail ?? 'under way' }
  }
  const scenarios = moment.requirements.flatMap((requirement) => requirement.scenarios)
  if (measures.done === 0 && scenarios.some((scenario) => scenario.proof === 'none')) {
    const recorded = scenarios.filter((scenario) => scenario.proof !== 'none').length
    return {
      step: 'Proofs',
      detail: `${String(recorded)} of ${String(scenarios.length)} reds recorded`,
    }
  }
  return {
    step: 'Building',
    detail: `${String(measures.verified)} of ${String(measures.tasks)} tasks done · ${String(measures.proven)} of ${String(measures.requirements)} requirements proven`,
  }
}

/**
 * What happens, at the top of the rail: the common stage card — the face, the line of what
 * happens or what waits, the progress line — with a chip for each agent at work beside the
 * Builder. A service or a check is not an agent: they are in their folds.
 */
export function BuildingCard({
  moment,
  loading = false,
}: {
  moment: BuildingMoment
  loading?: boolean | undefined
}): ReactNode {
  const names = moment.helpers.map((helper) => helper.name)
  return (
    <StageCard
      stage="Building"
      face={loading ? 'loading' : (moment.face ?? 'writing')}
      line={loading ? 'Reading where Building stands' : moment.now}
      progress={loading ? { step: 'Building', detail: 'counting the tasks' } : progressOf(moment)}
      running={
        moment.helpers.length > 0 ? (
          <>
            {moment.helpers.map((helper) => (
              <LiveChip
                key={helper.id}
                name={helper.name}
                icon={<LetterAvatar name={helper.name} others={names} />}
                state={helper.state}
                startedAt={helper.startedAt}
                endedAt={helper.endedAt}
                glance={{ kind: 'helper', type: HELPER_TYPE[helper.kind], step: helper.step }}
              />
            ))}
          </>
        ) : undefined
      }
    />
  )
}

/**
 * What the catalogue offers beyond the mission's services, behind one quiet action: a picker the
 * search narrows, each service with its command. Choosing one starts it for this mission only.
 * It hangs under its action, as wide as the fold and against its edge, and turns upward only when
 * there is no room below.
 */
function CataloguePicker({
  catalogue,
  onService,
}: {
  catalogue: BuildingMoment['catalogue']
  onService: BuildingHandlers['onService']
}): ReactNode {
  const id = useId()
  const search = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  if (catalogue.length === 0) return null
  const wanted = query.trim().toLowerCase()
  const found = catalogue.filter(
    (service) =>
      service.name.toLowerCase().includes(wanted) || service.line.toLowerCase().includes(wanted),
  )
  const current = Math.min(active, Math.max(0, found.length - 1))
  const start = (service: BuildingMoment['catalogue'][number] | undefined): void => {
    if (service === undefined) return
    onService(service.id, 'start')
    setOpen(false)
  }
  const walk = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive(Math.min(Math.max(current + delta, 0), Math.max(0, found.length - 1)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      start(found[current])
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setQuery('')
        setActive(0)
      }}
      align="start"
      fit="row"
      className="flex w-full"
      label="Start a service from the catalogue"
      initialFocus={search}
      trigger={
        <Button variant="ghost" size="sm">
          <IconPlus size="sm" />
          Start a service from the catalogue…
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-2">
        <label className="flex h-control-md min-w-0 items-center gap-2 rounded-md border border-input bg-input-fill px-2.5 focus-ring">
          <IconSearch size="sm" aria-hidden="true" className="text-muted-foreground" />
          <input
            ref={search}
            role="combobox"
            aria-label="Search the catalogue"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={
              found[current] === undefined ? undefined : `${id}-${found[current].id}`
            }
            aria-autocomplete="list"
            placeholder="Search the catalogue"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={walk}
          />
        </label>
        {found.length === 0 ? (
          <p id={`${id}-list`} className="h-picker-list px-2 py-3 text-sm text-muted-foreground">
            {`No service matches “${query.trim()}”`}
          </p>
        ) : (
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label="The catalogue"
            className="flex h-picker-list flex-col gap-0.5 overflow-y-auto scrollbar-stable rounded-md outline-none"
          >
            {found.map((service, index) => (
              <div
                key={service.id}
                id={`${id}-${service.id}`}
                role="option"
                aria-selected={index === current}
                data-active={index === current}
                className="flex min-w-0 shrink-0 flex-col rounded-md px-2 py-1.5 select-none hover-motion hover:tinted data-[active=true]:tinted"
                onPointerMove={() => setActive(index)}
                onClick={() => start(service)}
              >
                <span className="truncate text-sm font-medium">{service.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {service.line}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="px-2 text-xs text-muted-foreground">
          Started for this mission only: the Project keeps its own list.
        </p>
      </div>
    </Popover>
  )
}

/** The services' line: what runs by name, and how many wait to be started. */
function servicesWords(moment: BuildingMoment): string {
  const running = moment.services.map((service) => service.name)
  const parts = [
    ...(running.length > 0 ? [`${running.join(', ')} running`] : []),
    ...(moment.idle.length > 0 ? [`${String(moment.idle.length)} to start`] : []),
  ]
  return parts.length > 0 ? parts.join(' · ') : 'None'
}

/**
 * The services, one folded line among the rail's folds: "api running · 2 to start". Unfolded,
 * every service the mission declares, one row each — its mark, its address while it runs or its
 * command while it does not, Stop or Start — then the catalogue's picker, quiet, last.
 */
function Services({
  moment,
  onService,
}: {
  moment: BuildingMoment
  onService: BuildingHandlers['onService']
}): ReactNode {
  return (
    <Fold glyph={<IconTerminal size="sm" />} title="Services" detail={servicesWords(moment)}>
      <div className="flex flex-col pb-1 pl-6">
        <ul aria-label="Services" className="flex flex-col">
          {moment.services.map((service) => (
            <li key={service.id} className={ROW}>
              <StatusMark state={service.state} size="sm" legend />
              <span className="shrink-0 font-medium">{service.name}</span>
              {service.url === undefined ? (
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {service.line}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label={`Open ${service.name} at ${service.url}`}
                    className="min-w-0 flex-1 truncate rounded-sm text-left font-mono text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-ring hover-motion"
                    onClick={() => onService(service.id, 'open')}
                  >
                    {service.url}
                  </button>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Copy the address of ${service.name}`}
                    icon={<IconCopy size="sm" />}
                    onClick={() => onService(service.id, 'copy')}
                  />
                </>
              )}
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={`Restart ${service.name}`}
                icon={<IconRefresh size="sm" />}
                onClick={() => onService(service.id, 'restart')}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Stop ${service.name}`}
                onClick={() => onService(service.id, 'stop')}
              >
                <IconPlayerStop size="sm" />
                Stop
              </Button>
            </li>
          ))}
          {moment.idle.map((service) => (
            <li key={service.id} className={ROW}>
              <StatusMark state={service.state ?? 'idle'} size="sm" legend />
              <span className="shrink-0 font-medium">{service.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {service.line}
              </span>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Start ${service.name}`}
                onClick={() => onService(service.id, 'start')}
              >
                <IconPlayerPlay size="sm" />
                Start
              </Button>
              {service.dismissable === true && (
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${service.name} from the list`}
                  icon={<IconX size="sm" />}
                  onClick={() => onService(service.id, 'dismiss')}
                />
              )}
            </li>
          ))}
        </ul>
        <div className="flex pt-1 pr-4 pl-2">
          <CataloguePicker catalogue={moment.catalogue} onService={onService} />
        </div>
      </div>
    </Fold>
  )
}

/** A check on one line; intermediate ones quiet and grey, a failed one with the end of its output. */
function CheckLine({ check }: { check: Check }): ReactNode {
  const failed = check.state === 'failed'
  return (
    <li className="flex flex-col">
      <div
        className={cn(
          ROW,
          'min-h-control-sm py-0.5',
          !check.final && !failed && 'text-muted-foreground',
        )}
      >
        <StatusMark state={check.state} size="sm" legend />
        <span className="min-w-0 flex-1 truncate">{`${check.repository} · ${check.name}`}</span>
        <span className={QUIET}>{check.after}</span>
      </div>
      {check.tail !== undefined && (
        <pre className={cn(CODE, 'mx-4 mb-2 ml-10')}>
          <code>{check.tail.join('\n')}</code>
        </pre>
      )}
    </li>
  )
}

/**
 * The checks, folded: quiet while they pass, open on a failure, in full once the final ones run.
 * A check under way is said on the line and marked in the list: it is not an agent, so it has no
 * chip on the card.
 */
function Checks({ checks }: { checks: readonly Check[] }): ReactNode {
  if (checks.length === 0) return null
  const failed = checks.filter((check) => check.state === 'failed')
  const final = checks.some((check) => check.final)
  const done = checks.filter((check) => check.state === 'done').length
  const running = checks
    .filter((check) => check.state === 'running')
    .map((check) => `${check.repository} · ${check.name} running`)
  const detail =
    failed.length > 0
      ? failed
          .map((check) => `${check.repository} · ${check.name} failed ${check.after}`)
          .join(', ')
      : final
        ? [`final · ${String(done)} of ${String(checks.length)}`, ...running].join(' · ')
        : [...running, `quiet · ${checks[0]?.after ?? ''}`].join(' · ')
  return (
    <Fold
      glyph={<IconChecklist size="sm" />}
      title="Checks"
      detail={detail}
      calls={failed.length > 0}
      initiallyOpen={failed.length > 0 || final}
    >
      <ul aria-label="Checks" className="flex flex-col pb-1 pl-6">
        {checks.map((check) => (
          <CheckLine key={`${check.repository}-${check.name}`} check={check} />
        ))}
      </ul>
    </Fold>
  )
}

/** The changes per repository, folded; a repository changed outside Hemera opens them and says so. */
function Changes({
  changes,
  onOpenDiff,
}: {
  changes: BuildingMoment['changes']
  onOpenDiff: BuildingHandlers['onOpenDiff']
}): ReactNode {
  if (changes.length === 0) return null
  const added = changes.reduce((sum, change) => sum + change.added, 0)
  const deleted = changes.reduce((sum, change) => sum + change.deleted, 0)
  const outside = changes.filter((change) => change.outside === true)
  return (
    <Fold
      glyph={<IconGitCompare size="sm" />}
      title="Changes"
      detail={
        outside.length > 0
          ? `${outside.map((change) => change.repository).join(', ')} changed outside Hemera`
          : `${plural(changes.length, 'repository', 'repositories')} · +${String(added)} −${String(deleted)}`
      }
      calls={outside.length > 0}
      initiallyOpen={outside.length > 0}
    >
      <ul aria-label="Changes" className="flex flex-col pb-1 pl-6">
        {changes.map((change) => (
          <li key={change.repository} className={ROW}>
            <span className="w-0 min-w-0 flex-1 truncate font-mono text-xs">
              {change.repository}
            </span>
            {change.outside === true && (
              <Legend label="Changed outside Hemera">
                <span className="flex text-warning">
                  <IconAlertTriangle size="sm" />
                </span>
              </Legend>
            )}
            <span className={QUIET}>{plural(change.files, 'file', 'files')}</span>
            <span className="shrink-0 text-xs text-success-muted-foreground tabular-nums">{`+${String(change.added)}`}</span>
            <span className="shrink-0 text-xs text-destructive-muted-foreground tabular-nums">{`−${String(change.deleted)}`}</span>
            {onOpenDiff !== undefined && (
              <Button
                variant="link"
                size="sm"
                aria-label={`Diff of ${change.repository}`}
                onClick={() => onOpenDiff(change.repository)}
              >
                Diff
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Fold>
  )
}

/** The journal, folded: its meaningful events only, the newest first. */
function Journal({
  journal,
  more,
  onMore,
}: {
  journal: BuildingMoment['journal']
  more: boolean
  onMore: BuildingHandlers['onJournalMore']
}): ReactNode {
  if (journal.length === 0) return null
  return (
    <Fold
      glyph={<IconHistory size="sm" />}
      title="Journal"
      detail={`${plural(journal.length, 'event', 'events')} · ${journal[0]?.at ?? ''}`}
    >
      <ol aria-label="Journal" className="flex flex-col pb-1 pl-6">
        {journal.map((event) => (
          <li
            key={`${event.at}-${event.text}`}
            className="flex min-w-0 items-start gap-3 px-4 py-1 text-sm"
          >
            <span className={cn(QUIET, 'pt-0.5 font-mono')}>{event.at}</span>
            <span className="min-w-0 break-words">{event.text}</span>
          </li>
        ))}
      </ol>
      {more && onMore !== undefined && (
        <span className="flex pb-1 pl-10">
          <Button variant="link" size="sm" onClick={onMore}>
            Earlier events
          </Button>
        </span>
      )}
    </Fold>
  )
}

/** A task's row: its mark, its id, its title, how many times it failed, where it works. */
function TaskRow({
  task,
  chosen,
  onOpen,
}: {
  task: Task
  chosen: boolean
  onOpen: (id: string) => void
}): ReactNode {
  return (
    <li>
      <button
        type="button"
        data-task={task.id}
        aria-current={chosen ? 'true' : undefined}
        className={cn(LINE, 'pl-10', chosen && 'tinted')}
        onClick={() => onOpen(task.id)}
      >
        {task.cause === undefined ? (
          <StatusMark state={TASK_MARK[task.state]} size="sm" legend />
        ) : (
          <Legend label={`${MARK_LEGENDS[TASK_MARK[task.state]]}: ${task.cause}`}>
            <StatusMark state={TASK_MARK[task.state]} size="sm" />
          </Legend>
        )}
        <span className={ID}>{task.id}</span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            task.state === 'skipped' && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </span>
        {task.failures !== undefined && task.failures > 0 && (
          <Legend label={`Failed ${plural(task.failures, 'time', 'times')}`}>
            <span className="flex shrink-0 items-center text-xs text-destructive-muted-foreground tabular-nums">
              <IconX size="sm" />
              {task.failures}
            </span>
          </Legend>
        )}
        <span className={cn(QUIET, 'font-mono')}>{task.repositories.join(' · ')}</span>
      </button>
    </li>
  )
}

/** Where a scenario's proof ends after its red: green, to run again, or not green yet. */
function ProofEnd({ proof }: { proof: Exclude<ProofState, 'none' | 'manual'> }): ReactNode {
  switch (proof) {
    case 'green':
      return (
        <Legend label="Green">
          <StatusMark state="done" size="sm" />
        </Legend>
      )
    case 'rerun':
      return (
        <Legend label="To re-run">
          <span className="flex text-warning">
            <IconRefresh size="sm" />
          </span>
        </Legend>
      )
    case 'red':
      return (
        <Legend label="Not green yet">
          <StatusMark state="todo" size="sm" />
        </Legend>
      )
  }
}

/** A scenario's proof as marks: its red recorded, then its green, or to run again. */
function ProofMarks({ scenario }: { scenario: Scenario }): ReactNode {
  if (scenario.proof === 'manual') {
    return (
      <Legend label="To verify by hand">
        <StatusMark state="waiting" size="sm" />
      </Legend>
    )
  }
  if (scenario.proof === 'none') {
    return (
      <Legend label="Red not recorded yet">
        <StatusMark state="todo" size="sm" />
      </Legend>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Legend label={`Red recorded at ${scenario.redAt ?? ''}`}>
        <StatusMark state="failed" size="sm" />
      </Legend>
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        →
      </span>
      <ProofEnd proof={scenario.proof} />
    </span>
  )
}

/** A requirement's own mark: proven, to re-run, or not yet. */
function RequirementMark({ requirement }: { requirement: Requirement }): ReactNode {
  if (provenOf(requirement)) return <StatusMark state="done" size="sm" legend />
  if (requirement.scenarios.some((scenario) => scenario.proof === 'rerun')) {
    return (
      <Legend label="A proof to re-run">
        <span className="flex text-warning">
          <IconRefresh size="sm" />
        </span>
      </Legend>
    )
  }
  return (
    <Legend label="Not proven yet">
      <StatusMark state="todo" size="sm" />
    </Legend>
  )
}

/** Whether a group opens by itself: one of its tasks runs, waits or is blocked. */
const calling = (tasks: readonly Task[]): boolean =>
  tasks.some((one) => one.state === 'running' || one.state === 'waiting' || one.state === 'blocked')

/** A requirement on one line; unfolded, its tasks, then its scenarios with their proofs. */
function RequirementGroup({
  requirement,
  chosenTask,
  onOpenTask,
}: {
  requirement: Requirement
  chosenTask: string | undefined
  onOpenTask: (id: string) => void
}): ReactNode {
  const [open, setOpen] = useState(
    () => calling(requirement.tasks) || requirement.tasks.some((one) => one.id === chosenTask),
  )
  const counted = requirement.tasks.filter((one) => one.state !== 'skipped')
  const verified = counted.filter((one) => one.state === 'verified').length
  return (
    <li className="flex flex-col border-b border-border last:border-b-0">
      <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
        <span className={CHEVRON} data-open={open ? '' : undefined}>
          <IconChevronRight size="sm" />
        </span>
        <RequirementMark requirement={requirement} />
        <span className={ID}>{requirement.id}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{requirement.title}</span>
        <span className={QUIET}>{`${String(verified)}/${String(counted.length)}`}</span>
      </button>
      <Unfolding open={open}>
        <ul aria-label={`Tasks of ${requirement.id}`} className="flex flex-col">
          {requirement.tasks.map((one) => (
            <TaskRow key={one.id} task={one} chosen={one.id === chosenTask} onOpen={onOpenTask} />
          ))}
        </ul>
        <ul aria-label={`Scenarios of ${requirement.id}`} className="flex flex-col pb-1.5">
          {requirement.scenarios.map((scenario) => (
            <li key={scenario.id} className={cn(ROW, 'min-h-control-sm py-0.5 pl-10')}>
              <ProofMarks scenario={scenario} />
              <span className={ID}>{scenario.id}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {scenario.title}
              </span>
            </li>
          ))}
        </ul>
      </Unfolding>
    </li>
  )
}

/** A point of a round on one line; unfolded, the tasks it became. */
function PointGroup({
  point,
  chosenTask,
  onOpenTask,
}: {
  point: RoundPoint
  chosenTask: string | undefined
  onOpenTask: (id: string) => void
}): ReactNode {
  const [open, setOpen] = useState(() => calling(point.tasks))
  const verified = point.tasks.filter((one) => one.state === 'verified').length
  return (
    <li className="flex flex-col border-b border-border last:border-b-0">
      <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
        <span className={CHEVRON} data-open={open ? '' : undefined}>
          <IconChevronRight size="sm" />
        </span>
        <StatusMark
          state={
            verified === point.tasks.length ? 'done' : calling(point.tasks) ? 'running' : 'todo'
          }
          size="sm"
          legend
        />
        <span className={ID}>{point.id}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{point.title}</span>
        <span className={QUIET}>{`${String(verified)}/${String(point.tasks.length)}`}</span>
      </button>
      <Unfolding open={open}>
        <ul aria-label={`Tasks of ${point.id}`} className="flex flex-col pb-1">
          {point.tasks.map((one) => (
            <TaskRow key={one.id} task={one} chosen={one.id === chosenTask} onOpen={onOpenTask} />
          ))}
        </ul>
      </Unfolding>
    </li>
  )
}

/** Rows of a known shape while the page waits: a requirement's line each. */
function SkeletonRows(): ReactNode {
  return (
    <ul aria-label="Requirements" aria-busy="true" className="flex flex-col">
      {[
        'Export the invoices of the current filters',
        'Name the file after the filters',
        'Dates in the customer’s own zone',
        'Show a progress for long exports',
        'Amounts in their own currency',
      ].map((title, at) => (
        <li key={title} className={cn(ROW, 'border-b border-border last:border-b-0')}>
          <Skeleton>{`R${String(at + 1)}`}</Skeleton>
          <Skeleton>{title}</Skeleton>
        </li>
      ))}
    </ul>
  )
}

/** The spine: the round's points first on a round, the requirements, then the special tasks apart. */
function Spine({
  moment,
  chosenTask,
  onOpenTask,
  loading,
}: {
  moment: BuildingMoment
  chosenTask: string | undefined
  onOpenTask: (id: string) => void
  loading: boolean
}): ReactNode {
  const measures = measuresOf(moment)
  const round = moment.points !== undefined && moment.points.length > 0
  const [requirementsOpen, setRequirementsOpen] = useState(!round)
  const requirements = loading ? (
    <Frame>
      <SkeletonRows />
    </Frame>
  ) : (
    <Frame>
      <ul aria-label="Requirements" className="flex flex-col">
        {moment.requirements.map((requirement) => (
          <RequirementGroup
            key={requirement.id}
            requirement={requirement}
            chosenTask={chosenTask}
            onOpenTask={onOpenTask}
          />
        ))}
      </ul>
    </Frame>
  )
  return (
    <>
      {round && moment.points !== undefined && (
        <section aria-label={`Round ${String(moment.round)}`} className="flex flex-col gap-3">
          <SectionHead
            title={`Round ${String(moment.round)}`}
            actions={
              <span className={QUIET}>
                {`${String(moment.points.filter((point) => point.tasks.every((one) => one.state === 'verified')).length)} of ${plural(moment.points.length, 'point', 'points')}`}
              </span>
            }
          />
          <Frame>
            <ul aria-label="Points" className="flex flex-col">
              {moment.points.map((point) => (
                <PointGroup
                  key={point.id}
                  point={point}
                  chosenTask={chosenTask}
                  onOpenTask={onOpenTask}
                />
              ))}
            </ul>
          </Frame>
        </section>
      )}
      <section aria-label="Requirements" className="flex flex-col gap-3">
        <SectionHead
          title="Requirements"
          fold={
            round
              ? { open: requirementsOpen, onToggle: () => setRequirementsOpen(!requirementsOpen) }
              : undefined
          }
          actions={
            loading ? undefined : (
              <span className={QUIET}>
                {`${String(measures.proven)} of ${String(measures.requirements)} proven`}
              </span>
            )
          }
        />
        {round ? <Unfolding open={requirementsOpen}>{requirements}</Unfolding> : requirements}
      </section>
      {moment.special.length > 0 && (
        <section aria-label="Special tasks" className="flex flex-col gap-3">
          <SectionHead
            title="Special tasks"
            count={moment.special.length}
            actions={<span className={QUIET}>asked by the automatic review · counted apart</span>}
          />
          <Frame>
            <ul aria-label="Special tasks" className="flex flex-col py-1">
              {moment.special.map((one) => (
                <TaskRow
                  key={one.id}
                  task={one}
                  chosen={one.id === chosenTask}
                  onOpen={onOpenTask}
                />
              ))}
            </ul>
          </Frame>
        </section>
      )}
    </>
  )
}

/** The Building page: the rail first in reading order, drawn on the right from a laptop's width up. */
export function BuildingPage({
  moment,
  chosenTask,
  loading = false,
  onOpenTask,
  onOpenDiff,
  onService,
  onRevoke,
  onJournalMore,
}: BuildingPageProps): ReactNode {
  return (
    <div className={COLUMNS} data-stage="building">
      <aside aria-label="What happens" className={RAIL}>
        <BuildingCard moment={moment} loading={loading} />
        {!loading && (
          <div className="flex flex-col">
            <Services moment={moment} onService={onService} />
            <Checks checks={moment.checks} />
            <Changes changes={moment.changes} onOpenDiff={onOpenDiff} />
            <Journal
              journal={moment.journal}
              more={moment.journalMore === true}
              onMore={onJournalMore}
            />
          </div>
        )}
        <MissionFolds mission={moment.mission} workspace={moment.workspace} onRevoke={onRevoke} />
      </aside>
      <div className={MAIN}>
        <Spine moment={moment} chosenTask={chosenTask} onOpenTask={onOpenTask} loading={loading} />
      </div>
    </div>
  )
}
