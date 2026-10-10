import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Frame } from '../../components/frame/frame.tsx'
import { Loading } from '../../components/loading/loading.tsx'
import { IconCheck, IconListNumbers, IconTestPipe } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { ChangedMark, DeltaMark, SectionMark } from './planning-marks.tsx'
import type {
  Proof,
  Requirement,
  SectionState,
  SpecChange,
  SpecSection,
  Task,
} from './planning-types.ts'
import { Prose } from './prose.tsx'

const ID = 'shrink-0 font-mono text-xs leading-5 text-muted-foreground'

const QUIET = 'text-xs text-muted-foreground'

/** What changed since the last read wears a line in the info tone at its start. */
const CHANGED = 'border-l-2 border-info pl-3'

const PRE =
  'max-w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap'

/** The Spec's sections as its rail lists them: the seven prose ones, Requirements fourth. */
export interface RailEntry {
  name: string
  title: string
  state: SectionState
}

/** The eight sections of the rail, Requirements fourth, in the Spec's order. */
export function railOf(
  sections: readonly SpecSection[],
  requirementsState: SectionState,
): RailEntry[] {
  const prose = sections.map(({ name, title, state }) => ({ name, title, state }))
  return [
    ...prose.slice(0, 3),
    { name: 'requirements', title: 'Requirements', state: requirementsState },
    ...prose.slice(3),
  ]
}

/** The items changed since the last read: a section's name, `R2`, `T3` — a scenario counts for its requirement. */
export function changedSet(changes: readonly SpecChange[]): ReadonlySet<string> {
  return new Set(changes.map((change) => change.item.split('.')[0] ?? change.item))
}

/** The id an element of a section of the Spec carries, for the rail to scroll to it. */
export const sectionAnchor = (name: string): string => `spec-${name}`

function ProofBlock({ proof }: { proof: Proof }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        {proof.mode === 'automated' ? <IconTestPipe size="sm" /> : <IconCheck size="sm" />}
        <span className="font-medium text-foreground">
          {proof.mode === 'automated' ? 'Proof' : 'Verified by hand'}
        </span>
        {proof.test !== undefined && <span className="truncate font-mono">{proof.test}</span>}
        {proof.command !== undefined && <span className="truncate font-mono">{proof.command}</span>}
        {proof.fromProbe !== undefined && (
          <span className="ml-auto shrink-0">From Probe {proof.fromProbe}</span>
        )}
      </div>
      <ol className="flex list-decimal flex-col gap-0.5 pl-5 break-words">
        {proof.actions.map((action) => (
          <li key={action}>{action}</li>
        ))}
      </ol>
      <p className="break-words">
        <span className="text-muted-foreground">Starting from </span>
        {proof.startingData}
      </p>
      <p className="break-words">
        <span className="text-muted-foreground">Expected </span>
        {proof.expected}
      </p>
      {proof.seenToday && proof.observed !== undefined && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-muted-foreground">Seen today</span>
          <pre className={PRE}>
            {proof.observed.split('\n').map((line, index) =>
              line === proof.keyLine ? (
                <span
                  key={`${String(index)}${line}`}
                  className="block text-destructive"
                  data-key-line=""
                >
                  {line}
                </span>
              ) : (
                <span key={`${String(index)}${line}`} className="block">
                  {line}
                </span>
              ),
            )}
          </pre>
        </div>
      )}
    </div>
  )
}

function RequirementItem({
  requirement,
  changed,
}: {
  requirement: Requirement
  changed: boolean
}): ReactNode {
  const { living } = requirement
  return (
    <li
      aria-label={`${requirement.id} · ${requirement.text}`}
      className={cn('flex min-w-0 flex-col gap-3 px-4 py-3', changed && CHANGED)}
      data-changed={changed ? '' : undefined}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className={ID}>{requirement.id}</span>
        <DeltaMark delta={requirement.delta} />
        <p
          className={cn(
            'max-w-measure min-w-0 flex-1 text-sm break-words',
            requirement.delta === 'removed' && 'text-muted-foreground line-through',
          )}
        >
          {requirement.text}
        </p>
        {changed && <ChangedMark />}
        <span className="shrink-0 text-xs text-muted-foreground">{requirement.domain}</span>
      </div>
      {living !== undefined && (
        <p className="max-w-measure pl-8 text-xs break-words text-muted-foreground">
          {requirement.delta === 'removed' ? 'Removes ' : 'Changes '}
          <span className="font-mono">{living.ref}</span>
          {living.proposed ? ', itself still proposed' : ''}
          {living.text === null ? '' : `: “${living.text}”`}
        </p>
      )}
      {requirement.scenarios.length > 0 && (
        <ul aria-label={`Scenarios of ${requirement.id}`} className="flex flex-col gap-3 pl-8">
          {requirement.scenarios.map((scenario) => (
            <li key={scenario.id} className="flex min-w-0 flex-col gap-2">
              <p className="max-w-measure text-sm break-words">
                <span className="mr-2 font-mono text-xs text-muted-foreground">{scenario.id}</span>
                <span className="font-medium">WHEN</span> {scenario.when}{' '}
                <span className="font-medium">THEN</span> {scenario.then}
              </p>
              {scenario.proof !== null && <ProofBlock proof={scenario.proof} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

const TASK = 'flex min-w-0 flex-col gap-1 border-b border-border px-4 py-2 last:border-b-0'

/** The tasks, folded by default: the Planner's translation for the Builder, read-only. */
function TasksFold({
  tasks,
  changed,
}: {
  tasks: readonly Task[]
  changed: ReadonlySet<string>
}): ReactNode {
  const folding = useTransition(fold)
  const [open, setOpen] = useState(false)
  if (tasks.length === 0) return null
  return (
    <section aria-label="Tasks" id={sectionAnchor('tasks')} className="flex flex-col gap-2">
      <button
        type="button"
        className="flex h-control-sm w-fit items-center gap-2 rounded-md px-1 text-sm font-semibold outline-none hover:tinted focus-ring hover-motion"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <IconListNumbers size="sm" />
        Tasks
        <span className="font-normal text-muted-foreground tabular-nums">{tasks.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="tasks"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <Frame>
              <ul aria-label="Task list" className="flex flex-col">
                {tasks.map((task) => (
                  <li key={task.id} className={cn(TASK, changed.has(task.id) && CHANGED)}>
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <span className={ID}>{task.id}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                      {task.dependsOn.length > 0 && (
                        <span className={QUIET}>after {task.dependsOn.join(', ')}</span>
                      )}
                    </div>
                    <p className="pl-8 text-xs break-words text-muted-foreground">{task.result}</p>
                    <ul className="flex flex-col pl-8 font-mono text-xs text-muted-foreground">
                      {task.targets.map((target) => (
                        <li key={`${target.repository}/${target.path}`} className="truncate">
                          {target.intent === 'create' ? '+' : '~'} {target.repository}/{target.path}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Frame>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function SectionBody({ section }: { section: SpecSection }): ReactNode {
  if (section.state === 'being_written') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loading size="sm" label={`Hemera writes ${section.title}`} />
        Hemera writes it…
      </div>
    )
  }
  if (section.state === 'empty' || section.body.trim() === '') {
    return <p className="text-sm text-muted-foreground">Not written yet.</p>
  }
  return <Prose body={section.body} />
}

export interface SpecReadProps {
  /** The seven prose sections, in order. */
  sections: readonly SpecSection[]
  requirementsState: SectionState
  requirements: readonly Requirement[]
  tasks: readonly Task[]
  /** What changed since the last read: marked where it changed. */
  changes: readonly SpecChange[]
}

/**
 * The Spec as it is read: the seven prose sections and the requirements, in order, each with its
 * state; what changed since the last read wears a line in the info tone and a dot; the tasks
 * folded at the end. Nothing to edit: the Planner writes, the user reads and answers.
 */
export function SpecRead({
  sections,
  requirementsState,
  requirements,
  tasks,
  changes,
}: SpecReadProps): ReactNode {
  const changed = changedSet(changes)
  const byName = new Map(sections.map((section) => [section.name, section]))
  return (
    <div className="flex min-w-0 flex-col gap-8">
      {railOf(sections, requirementsState).map((entry) => {
        const section = byName.get(entry.name)
        const marked = changed.has(entry.name)
        return (
          <section
            key={entry.name}
            id={sectionAnchor(entry.name)}
            aria-label={entry.title}
            className={cn('flex min-w-0 scroll-mt-2 flex-col gap-3', marked && CHANGED)}
            data-changed={marked ? '' : undefined}
          >
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <SectionMark state={entry.state} />
              {entry.title}
              {marked && <ChangedMark />}
            </h2>
            {section !== undefined ? (
              <SectionBody section={section} />
            ) : requirements.length === 0 ? (
              <SectionBody
                section={{ name: entry.name, title: entry.title, body: '', state: entry.state }}
              />
            ) : (
              <Frame>
                <ul aria-label="Requirement list" className="flex flex-col divide-y divide-border">
                  {requirements.map((requirement) => (
                    <RequirementItem
                      key={requirement.id}
                      requirement={requirement}
                      changed={changed.has(requirement.id)}
                    />
                  ))}
                </ul>
              </Frame>
            )}
          </section>
        )
      })}
      <TasksFold tasks={tasks} changed={changed} />
    </div>
  )
}

/** The Spec's sections down the left of the page, each with its state, scrolling to it. */
export function SectionsNav({
  sections,
  requirementsState,
  changes,
  tasks,
}: Pick<SpecReadProps, 'sections' | 'requirementsState' | 'changes' | 'tasks'>): ReactNode {
  const changed = changedSet(changes)
  const go = (name: string): void => {
    document.getElementById(sectionAnchor(name))?.scrollIntoView({ block: 'start' })
  }
  return (
    <nav aria-label="Spec sections" className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {railOf(sections, requirementsState).map((entry) => (
          <li key={entry.name}>
            <button
              type="button"
              className="flex h-control-md w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion"
              onClick={() => go(entry.name)}
            >
              <SectionMark state={entry.state} />
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
              {changed.has(entry.name) && <ChangedMark />}
            </button>
          </li>
        ))}
      </ul>
      {tasks.length > 0 && (
        <button
          type="button"
          className="flex h-control-md w-full items-center gap-2 rounded-md border-t border-border px-2 text-left text-sm text-muted-foreground outline-none hover:tinted focus-ring hover-motion"
          onClick={() => go('tasks')}
        >
          <IconListNumbers size="sm" />
          <span className="flex-1">Tasks</span>
          <span className="tabular-nums">{tasks.length}</span>
        </button>
      )}
    </nav>
  )
}
