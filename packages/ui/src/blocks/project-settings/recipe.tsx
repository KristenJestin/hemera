import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Reorder, useDragControls } from 'motion/react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Select } from '../../components/select/select.tsx'
import {
  IconAlertTriangle,
  IconChevronRight,
  IconCopy,
  IconGripVertical,
  IconLink,
  IconPlus,
  IconTerminal,
} from '../../icons.ts'
import { arrival, useTransition } from '../../motion.ts'
import { type CatalogueChoice, CommandLineField } from './command-line.tsx'
import { Section, TemplateMenu } from './parts.tsx'

/**
 * The preparation recipe of a Project: what is done in a new Workspace, in order, once its
 * worktrees are made — copy a file or a folder from the main checkout, link one, run a command.
 *
 * The steps are a sequence, so each carries its number. A step is moved by its handle, with the
 * pointer or with the arrows of the keyboard once the handle has the focus, and the steps around it
 * make room on `arrival`. A copy or a link whose source is not in the main checkout says so on its
 * line, in words, in the destructive tone: the preparation would stop there. Pressing a step opens
 * its sheet.
 */
export type StepKind = 'copy' | 'link' | 'run'

export interface SettingsStep {
  id: string
  kind: StepKind
  /** The repository it applies under, by path; `.` for the main checkout's root. */
  place: string
  /** What a copy or a link places, under its repository. */
  path: string | null
  /** The catalogue command a run starts, by id; null for a line of its own. */
  command: string | null
  /** The line a run of its own runs, and the lines of its own for each system. */
  line: string | null
  lineLinux?: string | null | undefined
  lineWindows?: string | null | undefined
  /** What is wrong with the step, in words: a source missing from the main checkout. */
  problem?: string | undefined
}

export const KIND_WORDS: Record<StepKind, string> = { copy: 'Copy', link: 'Link', run: 'Run' }

function kindIcon(kind: StepKind): ReactNode {
  if (kind === 'copy') return <IconCopy size="sm" />
  if (kind === 'link') return <IconLink size="sm" />
  return <IconTerminal size="sm" />
}

/** What a step does to what, as its line says it: `.env.local`, `install`, `pnpm install`. */
export function whatOf(step: Pick<SettingsStep, 'kind' | 'path' | 'command' | 'line'>): string {
  if (step.kind === 'run') return step.command ?? step.line ?? ''
  return step.path ?? ''
}

/** Where a step applies, as its line says it: `api`, `root`. */
export function placeOfStep(step: Pick<SettingsStep, 'place'>): string {
  return step.place === '.' ? 'root' : step.place
}

const ITEM = 'border-b border-border bg-surface-body last:border-b-0'

const ROW = 'flex min-w-0 items-center gap-1 pl-2'

const HANDLE =
  'flex size-control-sm shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:tinted hover:text-foreground focus-ring hover-motion active:cursor-grabbing'

const OPEN =
  'flex min-h-control-lg min-w-0 flex-1 items-center gap-3 rounded-md py-2 pr-4 pl-1 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const STILL = 'flex min-h-control-lg min-w-0 flex-1 items-center gap-3 py-2 pr-4 pl-1 text-sm'

const NUMBER = 'w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums'

const KIND = 'flex w-16 shrink-0 items-center gap-2 text-muted-foreground'

const PLACE = 'w-24 min-w-0 shrink-0 truncate font-mono text-xs text-muted-foreground'

const WHAT = 'min-w-0 truncate font-mono text-xs'

const COMMAND = 'min-w-0 truncate font-medium'

const PROBLEM =
  'ml-auto flex min-w-0 shrink items-center gap-1.5 text-xs text-destructive-muted-foreground'

const CHEVRON = 'ml-auto flex shrink-0 text-muted-foreground'

export interface StepRowProps {
  step: SettingsStep
  position: number
  count: number
  onOpen: () => void
  /** Moves the step one place up (-1) or down (+1). */
  onMove: (by: -1 | 1) => void
}

/** One step: its handle, its number, what it does, and what is wrong with it. */
export function StepRow({ step, position, count, onOpen, onMove }: StepRowProps): ReactNode {
  const controls = useDragControls()
  const travel = useTransition(arrival)
  const what = whatOf(step)
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowUp' && position > 1) {
      event.preventDefault()
      onMove(-1)
    }
    if (event.key === 'ArrowDown' && position < count) {
      event.preventDefault()
      onMove(1)
    }
  }
  return (
    <Reorder.Item
      value={step.id}
      dragListener={false}
      dragControls={controls}
      layout="position"
      transition={travel}
      className={ITEM}
      data-step={position}
    >
      <div className={ROW}>
        <button
          type="button"
          className={HANDLE}
          aria-label={`Move step ${String(position)}, ${KIND_WORDS[step.kind]} ${what} in ${placeOfStep(step)}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onPointerDown={(event) => controls.start(event)}
          onKeyDown={onKeyDown}
        >
          <IconGripVertical size="sm" />
        </button>
        <button type="button" className={OPEN} onClick={onOpen}>
          <span className={NUMBER}>{position}</span>
          <span className={KIND}>
            <span className="flex" aria-hidden="true">
              {kindIcon(step.kind)}
            </span>
            {KIND_WORDS[step.kind]}
          </span>
          <span className={PLACE}>{placeOfStep(step)}</span>
          {step.kind === 'run' && step.command !== null ? (
            <span className={COMMAND}>{what}</span>
          ) : (
            <span className={WHAT}>{what}</span>
          )}
          {step.problem === undefined ? (
            <span className={CHEVRON} aria-hidden="true">
              <IconChevronRight size="sm" />
            </span>
          ) : (
            <span className={PROBLEM} data-problem="">
              <span className="flex shrink-0 text-destructive">
                <IconAlertTriangle size="sm" aria-hidden="true" />
              </span>
              <span className="truncate">{step.problem}</span>
            </span>
          )}
        </button>
      </div>
    </Reorder.Item>
  )
}

/** The row's own shape while the recipe is on its way. */
export function StepRowSkeleton({ position }: { position: number }): ReactNode {
  return (
    <li aria-hidden="true" className={ITEM} data-row-skeleton="">
      <div className={ROW}>
        <span className={HANDLE}>
          <Skeleton shape="block">
            <IconGripVertical size="sm" />
          </Skeleton>
        </span>
        <span className={STILL}>
          <span className={NUMBER}>{position}</span>
          <span className={KIND}>
            <Skeleton>Copy</Skeleton>
          </span>
          <span className={PLACE}>
            <Skeleton>api</Skeleton>
          </span>
          <span className={WHAT}>
            <Skeleton>.env.local</Skeleton>
          </span>
          <span className={CHEVRON} />
        </span>
      </div>
    </li>
  )
}

export interface RecipeSectionProps {
  steps: readonly SettingsStep[]
  loading?: boolean | undefined
  onOpen: (id: string) => void
  onAdd: () => void
  /** The steps in their new order, by id. */
  onReorder: (ids: string[]) => void
}

export function RecipeSection({
  steps,
  loading = false,
  onOpen,
  onAdd,
  onReorder,
}: RecipeSectionProps): ReactNode {
  const add = (
    <Button size="sm" onClick={onAdd}>
      <IconPlus size="sm" />
      Add a step
    </Button>
  )
  const empty = !loading && steps.length === 0
  const ids = steps.map((step) => step.id)
  const move = (id: string, by: -1 | 1): void => {
    const from = ids.indexOf(id)
    const next = [...ids]
    next.splice(from, 1)
    next.splice(from + by, 0, id)
    onReorder(next)
  }
  return (
    <Section label="Preparation">
      <SectionHead
        title="Preparation"
        count={loading || empty ? undefined : steps.length}
        actions={loading || empty ? undefined : add}
      />
      <Frame>
        {empty ? (
          <Empty face="asleep" title="No step yet" action={add} />
        ) : loading ? (
          <ul aria-label="Steps" aria-busy="true" className="flex flex-col">
            <StepRowSkeleton position={1} />
            <StepRowSkeleton position={2} />
            <StepRowSkeleton position={3} />
          </ul>
        ) : (
          <Reorder.Group
            axis="y"
            values={ids}
            onReorder={onReorder}
            aria-label="Steps"
            className="flex flex-col overflow-hidden rounded-lg"
          >
            {steps.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
                position={index + 1}
                count={steps.length}
                onOpen={() => onOpen(step.id)}
                onMove={(by) => move(step.id, by)}
              />
            ))}
          </Reorder.Group>
        )}
      </Frame>
    </Section>
  )
}

/** What the sheet of a step writes. */
export type StepDraft = Omit<SettingsStep, 'id' | 'problem'>

export const NEW_STEP: StepDraft = { kind: 'copy', place: '.', path: '', command: null, line: null }

export interface StepFormProps {
  draft: StepDraft
  onChange: (draft: StepDraft) => void
  places: readonly string[]
  /** The commands of the catalogue a run may start. */
  commands: readonly CatalogueChoice[]
  /** What is wrong with the source, in words. */
  pathError?: string | undefined
  /** What the engine refuses in a line, in words, the token named; undefined for nothing. */
  refusalOf: (line: string) => string | undefined
}

const LABEL = 'text-sm font-medium'

/** The sheet of a step: what it does, where, and to what. */
export function StepForm({
  draft,
  onChange,
  places,
  commands,
  pathError,
  refusalOf,
}: StepFormProps): ReactNode {
  const set = (part: Partial<StepDraft>): void => onChange({ ...draft, ...part })
  return (
    <>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={LABEL} aria-hidden="true">
            Step
          </span>
          <Select
            label="Step"
            className="w-full"
            value={draft.kind}
            mark={<span className="flex text-muted-foreground">{kindIcon(draft.kind)}</span>}
            onValueChange={(kind) => set({ kind })}
            items={(['copy', 'link', 'run'] as const).map((kind) => ({
              value: kind,
              label: KIND_WORDS[kind],
              icon: <span className="flex text-muted-foreground">{kindIcon(kind)}</span>,
            }))}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={LABEL} aria-hidden="true">
            In
          </span>
          <Select
            label="In"
            className="w-full"
            value={draft.place}
            onValueChange={(place) => set({ place })}
            items={[
              { value: '.', label: 'root' },
              ...places.map((place) => ({ value: place, label: place })),
            ]}
          />
        </div>
      </div>
      {draft.kind === 'run' ? (
        <CommandLineField
          commands={commands}
          value={{
            command: draft.command,
            line: draft.line ?? '',
            lineLinux: draft.lineLinux ?? null,
            lineWindows: draft.lineWindows ?? null,
          }}
          onChange={(value) => set(value)}
          refusalOf={refusalOf}
        />
      ) : (
        <Input
          label="Source in the main checkout"
          value={draft.path ?? ''}
          placeholder=".env.local"
          error={pathError}
          onValueChange={(path) => set({ path })}
          trailing={
            <TemplateMenu
              field="Source in the main checkout"
              onInsert={(name) => set({ path: `${draft.path ?? ''}${name}` })}
            />
          }
        />
      )}
    </>
  )
}
