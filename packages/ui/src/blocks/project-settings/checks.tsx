import { cn } from 'cn'
import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconChevronRight,
  IconFileText,
  IconGripVertical,
  IconHandStop,
  IconListCheck,
  IconPlus,
  IconTerminal,
  IconX,
} from '../../icons.ts'
import { arrival, collapse, expand, fold, useTransition } from '../../motion.ts'
import { type CatalogueChoice, CommandLineField } from './command-line.tsx'
import { typeIcon } from './command-types.tsx'
import { FieldSkeleton, Section, SectionRefusal } from './parts.tsx'

/**
 * The checks of a Project, in its settings: what Hemera runs to judge the work, never the agent.
 *
 * A check runs at one moment — after each task, after each requirement, at the end — and the
 * section reads as those moments, in the order they come: under each, its checks in the order they
 * run, one line each. A line is the command's glyph (a free line wears the terminal's), its name,
 * its line in the mono face, where it runs, the number it expects when it expects one, and two
 * marks in columns of their own: it runs only on some of the files the task wrote, it asks before
 * running. The marks are named once, at the head of the columns, by their legends; a line says
 * everything in words to a screen reader. A check is moved within its moment by its handle, with
 * the pointer or the arrows; it changes moment in its dialog.
 *
 * A Project with no check is offered what the catalogue holds, each proposal where it would run,
 * in the quiet tone, with Accept; Accept all stands in the head. Nothing is kept before it is
 * accepted. What arrives or leaves grows and folds on `fold`, pushing what stands under it.
 *
 * Under the checks, how long a proof may run before Hemera ends it, as the Cap and budget fields
 * are: empty until the user writes in it, the default shown in its quiet tone, the × that empties
 * it, and a value refused said under it.
 */
export type CheckWhen = 'task' | 'requirement' | 'end'

/** Where a check runs: each repository the task changed, the root, or one repository. */
export type CheckWhere = 'changed' | 'root' | 'repository'

/** A number read in the output: the first group the pattern captures, at least the minimum. */
export interface CheckExpect {
  pattern: string
  minimum: string
}

export interface SettingsCheck {
  id: string
  name: string
  /** The catalogue command it runs; null for a line of its own. */
  command: CatalogueChoice | null
  /** The line of its own; null for a command of the catalogue. */
  line: string | null
  where: CheckWhere
  /** The repository it runs in, by path, when `where` is one repository. */
  repository: string | null
  when: CheckWhen
  /** Null: exit code 0. */
  expect: CheckExpect | null
  /** The pattern of the files `{files}` stands for; null when the line has none. */
  files: string | null
}

export const MOMENTS: readonly CheckWhen[] = ['task', 'requirement', 'end']

export const MOMENT_WORDS: Record<CheckWhen, string> = {
  task: 'After each task',
  requirement: 'After each requirement',
  end: 'At the end',
}

/** Where a check runs, as its line says it. */
export function whereOf(check: Pick<SettingsCheck, 'where' | 'repository'>): string {
  if (check.where === 'changed') return 'changed repositories'
  if (check.where === 'root') return 'root'
  return check.repository ?? ''
}

/** The line a check runs: its own, or its catalogue command's. */
export function lineOf(check: Pick<SettingsCheck, 'command' | 'line'>): string {
  return check.command?.line ?? check.line ?? ''
}

/** Everything a line shows, in words, for a screen reader. */
export function wordsOf(check: SettingsCheck): string {
  return [
    check.name,
    check.command === null ? null : 'from the catalogue',
    lineOf(check),
    check.where === 'changed' ? 'in each changed repository' : `in ${whereOf(check)}`,
    check.expect === null ? null : `expects a number of at least ${check.expect.minimum}`,
    check.files === null ? null : `only on the files matching ${check.files}`,
    check.command?.askBeforeRunning === true ? 'asks before running' : null,
  ]
    .filter((part) => part !== null)
    .join(', ')
}

const ROW = 'flex min-w-0 items-center gap-1 pl-2'

const HANDLE =
  'flex size-control-sm shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:tinted hover:text-foreground focus-ring hover-motion active:cursor-grabbing'

/** The room of a handle on a line that has none: a proposal, the head. */
const NO_HANDLE = 'flex size-control-sm shrink-0'

const CELLS = 'flex min-h-control-lg min-w-0 flex-1 items-center gap-3 py-2 pr-4 pl-1 text-sm'

const OPEN = cn(CELLS, 'rounded-md text-left outline-none hover:tinted focus-ring hover-motion')

const HEAD = 'flex h-control-sm min-w-0 items-center gap-1 border-b border-border pl-2'

const HEAD_CELLS = 'flex min-w-0 flex-1 items-center gap-3 pr-4 pl-1 text-xs text-muted-foreground'

/** A moment's head: on the frame's own darker ground, so it stands apart from the lines under it. */
const MOMENT =
  'flex h-control-sm items-center border-b border-border bg-surface-rim px-4 text-xs font-medium'

const ITEM = 'overflow-hidden border-b border-border bg-surface-body last:border-b-0'

const GLYPH = 'flex size-icon-md shrink-0 items-center justify-center text-muted-foreground'

/** On a phone the name takes the line's room; wider, it keeps its column. */
const NAME = 'min-w-0 flex-1 truncate font-medium md:w-settings-name md:flex-none'

const LINE = 'hidden min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground md:block'

const WHERE =
  'hidden w-settings-name min-w-0 shrink-0 truncate text-xs text-muted-foreground md:block'

const EXPECT = 'hidden w-16 shrink-0 text-xs text-muted-foreground tabular-nums md:block'

const ROOM = 'flex size-icon-md shrink-0 items-center justify-center'

const MARK = 'flex text-foreground'

/** The chevron's room, or Accept's: as wide as Accept, so both kinds of line keep their columns. */
const AFTER = 'flex shrink-0 items-center justify-end md:w-16'

const CHEVRON = 'flex text-muted-foreground'

const QUIET = 'text-muted-foreground'

const NOTE = 'max-w-measure text-xs text-muted-foreground'

/** The glyph of a check's source: its catalogue command's type, or the terminal for a line. */
function sourceIcon(check: Pick<SettingsCheck, 'command'>): ReactNode {
  return check.command === null ? <IconTerminal size="sm" /> : typeIcon(check.command.type)
}

/** The cells of a line after its handle, the same for a check and a proposal. */
function Cells({ check }: { check: SettingsCheck }): ReactNode {
  return (
    <>
      <span className={GLYPH} aria-hidden="true">
        {sourceIcon(check)}
      </span>
      <span className={NAME}>{check.name}</span>
      <span className={LINE}>{lineOf(check)}</span>
      <span className={cn(WHERE, check.where === 'repository' && 'font-mono')}>
        {whereOf(check)}
      </span>
      <span className={EXPECT}>{check.expect === null ? '' : `≥ ${check.expect.minimum}`}</span>
      <span className={ROOM} data-column="files">
        {check.files !== null && (
          <span className={MARK}>
            <IconFileText size="sm" />
          </span>
        )}
      </span>
      <span className={ROOM} data-column="ask">
        {check.command?.askBeforeRunning === true && (
          <span className={MARK}>
            <IconHandStop size="sm" />
          </span>
        )}
      </span>
    </>
  )
}

export interface CheckRowProps {
  check: SettingsCheck
  /** Whether it is the first or the last of the checks it moves among. */
  first: boolean
  last: boolean
  onOpen: () => void
  /** Moves the check one place up (-1) or down (+1). */
  onMove: (by: -1 | 1) => void
}

/** One check: its handle, and the line that opens it. */
export function CheckRow({ check, first, last, onOpen, onMove }: CheckRowProps): ReactNode {
  const controls = useDragControls()
  const travel = useTransition(arrival)
  const folding = useTransition(fold)
  // A check grows in and folds out on `fold`, and makes room for another on `arrival`.
  const moving = { ...folding, layout: travel }
  const among = MOMENT_WORDS[check.when].toLowerCase()
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowUp' && !first) {
      event.preventDefault()
      onMove(-1)
    }
    if (event.key === 'ArrowDown' && !last) {
      event.preventDefault()
      onMove(1)
    }
  }
  return (
    <Reorder.Item
      value={check.id}
      dragListener={false}
      dragControls={controls}
      layout="position"
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={moving}
      className={ITEM}
      data-check={check.id}
    >
      <div className={ROW}>
        <button
          type="button"
          className={HANDLE}
          aria-label={`Move ${check.name}, ${among}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onPointerDown={(event) => controls.start(event)}
          onKeyDown={onKeyDown}
        >
          <IconGripVertical size="sm" />
        </button>
        <button type="button" className={OPEN} aria-label={wordsOf(check)} onClick={onOpen}>
          <Cells check={check} />
          <span className={AFTER} aria-hidden="true">
            <span className={CHEVRON}>
              <IconChevronRight size="sm" />
            </span>
          </span>
        </button>
      </div>
    </Reorder.Item>
  )
}

/** A check Hemera proposes: the same line, quiet, not kept, and Accept at its end. */
export function ProposedCheckRow({
  check,
  onAccept,
}: {
  check: SettingsCheck
  onAccept: () => void
}): ReactNode {
  const folding = useTransition(fold)
  return (
    <motion.li
      className={ITEM}
      data-proposal={check.id}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      <div className={ROW}>
        <span className={NO_HANDLE} />
        <div className={cn(CELLS, QUIET)}>
          <span className="sr-only">Proposed: {wordsOf(check)}</span>
          <span className="contents" aria-hidden="true">
            <Cells check={check} />
          </span>
          <span className={AFTER}>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Accept ${check.name}`}
              onClick={onAccept}
            >
              Accept
            </Button>
          </span>
        </div>
      </div>
    </motion.li>
  )
}

/** What a row on its way most likely holds. */
const LIKELY = { name: 'typecheck', line: 'pnpm -r typecheck', where: 'changed repositories' }

/** The row's own shape while the checks are on their way. */
export function CheckRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={ITEM} data-row-skeleton="">
      <div className={ROW}>
        <span className={NO_HANDLE} />
        <span className={CELLS}>
          <span className={GLYPH}>
            <Skeleton shape="block">
              <IconListCheck size="sm" />
            </Skeleton>
          </span>
          <span className={NAME}>
            <Skeleton>{LIKELY.name}</Skeleton>
          </span>
          <span className={LINE}>
            <Skeleton>{LIKELY.line}</Skeleton>
          </span>
          <span className={WHERE}>
            <Skeleton>{LIKELY.where}</Skeleton>
          </span>
          <span className={EXPECT} />
          <span className={ROOM} />
          <span className={ROOM} />
          <span className={AFTER} />
        </span>
      </div>
    </li>
  )
}

/** The head of the columns: the words of the text columns, the marks named by their legends. */
function ColumnsHead(): ReactNode {
  return (
    <div className={HEAD}>
      <span className={NO_HANDLE} />
      <div className={HEAD_CELLS}>
        <span className={GLYPH} />
        <span className={NAME}>Name</span>
        <span className={LINE}>Line</span>
        <span className={WHERE}>Runs in</span>
        <span className={EXPECT}>Expects</span>
        <span className={ROOM}>
          <Legend label="Runs only on the files the task wrote that match a pattern">
            <span className="flex">
              <IconFileText size="sm" />
            </span>
          </Legend>
        </span>
        <span className={ROOM}>
          <Legend label="Asks before running">
            <span className="flex">
              <IconHandStop size="sm" />
            </span>
          </Legend>
        </span>
        <span className={AFTER} />
      </div>
    </div>
  )
}

/** The checks a list holds, kept and proposed, moved among themselves. */
function Checks({
  label,
  checks,
  proposals,
  onOpen,
  onMove,
  onReorder,
  onAccept,
}: {
  label: string
  checks: readonly SettingsCheck[]
  proposals: readonly SettingsCheck[]
  onOpen: (id: string) => void
  onMove: (id: string, by: -1 | 1) => void
  onReorder: (ids: string[]) => void
  onAccept: (id: string) => void
}): ReactNode {
  const folding = useTransition(fold)
  const ids = checks.map((check) => check.id)
  return (
    <AnimatePresence initial={false} propagate>
      {checks.length > 0 && (
        <motion.div
          key="kept"
          className="overflow-hidden"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          <Reorder.Group
            axis="y"
            values={ids}
            onReorder={onReorder}
            aria-label={label}
            className="flex flex-col"
          >
            <AnimatePresence initial={false} propagate>
              {checks.map((check, index) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  first={index === 0}
                  last={index === checks.length - 1}
                  onOpen={() => onOpen(check.id)}
                  onMove={(by) => onMove(check.id, by)}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        </motion.div>
      )}
      {proposals.length > 0 && (
        <motion.ul
          key="proposed"
          aria-label={`Proposed ${label.toLowerCase()}`}
          className="flex flex-col overflow-hidden border-t border-border first:border-t-0"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          <AnimatePresence initial={false} propagate>
            {proposals.map((proposal) => (
              <ProposedCheckRow
                key={proposal.id}
                check={proposal}
                onAccept={() => onAccept(proposal.id)}
              />
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </AnimatePresence>
  )
}

/** How long a proof may run, in minutes, as its field holds it. */
export interface ProofLimitField {
  /** What the user wrote, or null for the default. */
  value: string | null
  /** The minutes that apply while the field is empty. */
  fallback: number
  /** Why the value is refused, in words. */
  error?: string | undefined
  /** Null: the limit is on its way. */
  loading?: boolean | undefined
  /** What the field now holds; null once it is emptied. */
  onChange: (value: string | null) => void
}

const LIMIT_LABEL = 'How long a proof may run'

const LIMIT_GROUP = 'grid grid-cols-1 items-start gap-4 p-4 sm:grid-cols-3'

/** The proof's time limit, in a frame of its own under the checks. */
function ProofLimit({ field }: { field: ProofLimitField }): ReactNode {
  return (
    <Frame>
      <div className={LIMIT_GROUP} aria-busy={field.loading === true}>
        {field.loading === true ? (
          <FieldSkeleton label={LIMIT_LABEL} />
        ) : (
          <Input
            label={LIMIT_LABEL}
            description="In minutes. Hemera ends a proof that runs longer."
            placeholder={String(field.fallback)}
            value={field.value ?? ''}
            error={field.error}
            onValueChange={(value) => field.onChange(value.trim() === '' ? null : value)}
            trailing={
              field.value === null ? undefined : (
                <Tooltip label="Back to the default">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconX size="sm" />}
                    aria-label="Back to the default time limit of a proof"
                    onClick={() => field.onChange(null)}
                  />
                </Tooltip>
              )
            }
          />
        )}
      </div>
    </Frame>
  )
}

export interface ChecksSectionProps {
  /** Null: the checks are on their way. */
  checks: readonly SettingsCheck[] | null
  /** What Hemera proposes from the catalogue, not kept yet. */
  proposals?: readonly SettingsCheck[] | undefined
  /** Why the checks could not be read, in words. */
  error?: string | undefined
  onOpen: (id: string) => void
  onAdd: () => void
  /** Every check, by id, in its new order. */
  onReorder: (ids: string[]) => void
  onAccept: (id: string) => void
  onAcceptAll: () => void
  /** How long a proof may run (#321), under the checks; not shown without it. */
  proofLimit?: ProofLimitField | undefined
}

export function ChecksSection({
  checks,
  proposals = [],
  error,
  proofLimit,
  onOpen,
  onAdd,
  onReorder,
  onAccept,
  onAcceptAll,
}: ChecksSectionProps): ReactNode {
  const folding = useTransition(fold)
  const loading = checks === null
  const kept = checks ?? []
  const empty = !loading && kept.length === 0 && proposals.length === 0
  const add = (
    <Button size="sm" onClick={onAdd}>
      <IconPlus size="sm" />
      Add a check
    </Button>
  )
  const ids = kept.map((check) => check.id)
  /** The whole order once one check moves by one place among those of its list. */
  const move = (among: readonly string[], id: string, by: -1 | 1): void => {
    const from = among.indexOf(id)
    const next = [...among]
    next.splice(from, 1)
    next.splice(from + by, 0, id)
    onReorder(merge(among, next))
  }
  /** The whole order, the checks of one moment put back in their new order where they stood. */
  const merge = (among: readonly string[], next: readonly string[]): string[] => {
    const moving = new Set(among)
    let at = 0
    return ids.map((id) => (moving.has(id) ? (next[at++] ?? id) : id))
  }
  const lists = MOMENTS.map((moment) => ({
    label: MOMENT_WORDS[moment],
    checks: kept.filter((check) => check.when === moment),
    proposals: proposals.filter((check) => check.when === moment),
  }))
  return (
    <Section label="Checks">
      <SectionHead
        title="Checks"
        count={kept.length === 0 ? undefined : kept.length}
        actions={
          loading || empty ? undefined : (
            <>
              {proposals.length > 0 && (
                <Button size="sm" variant="primary" onClick={onAcceptAll}>
                  Accept all {proposals.length}
                </Button>
              )}
              {add}
            </>
          )
        }
      />
      <SectionRefusal error={error} />
      {/* Presences that outlive what they hold: the last line folds out with its list while the
          empty state grows in, and a refusal with nothing to show folds the frame away. */}
      <AnimatePresence initial={false}>
        {(error === undefined || !empty) && (
          <motion.div
            key="frame"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <Frame>
              <AnimatePresence initial={false} propagate>
                {empty ? (
                  <motion.div
                    key="empty"
                    className="overflow-hidden"
                    initial={collapse}
                    animate={expand}
                    exit={collapse}
                    transition={folding}
                  >
                    <Empty
                      face="asleep"
                      title="No check yet"
                      description="Until a check runs after it, a task is done, not verified."
                      action={add}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="list"
                    className="overflow-hidden"
                    initial={collapse}
                    animate={expand}
                    exit={collapse}
                    transition={folding}
                  >
                    <ColumnsHead />
                    {loading ? (
                      <ul aria-label="Checks" aria-busy="true" className="flex flex-col">
                        <CheckRowSkeleton />
                        <CheckRowSkeleton />
                        <CheckRowSkeleton />
                        <CheckRowSkeleton />
                      </ul>
                    ) : (
                      <AnimatePresence initial={false} propagate>
                        {lists
                          .filter((list) => list.checks.length + list.proposals.length > 0)
                          .map((list) => {
                            const among = list.checks.map((check) => check.id)
                            return (
                              <motion.div
                                key={list.label}
                                className="overflow-hidden border-b border-border last:border-b-0"
                                initial={collapse}
                                animate={expand}
                                exit={collapse}
                                transition={folding}
                              >
                                <h3 className={MOMENT}>{list.label}</h3>
                                <Checks
                                  label={list.label}
                                  checks={list.checks}
                                  proposals={list.proposals}
                                  onOpen={onOpen}
                                  onMove={(id, by) => move(among, id, by)}
                                  onReorder={(next) => onReorder(merge(among, next))}
                                  onAccept={onAccept}
                                />
                              </motion.div>
                            )
                          })}
                      </AnimatePresence>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </Frame>
          </motion.div>
        )}
      </AnimatePresence>
      <p className={NOTE}>
        {proposals.length > 0 &&
          'Hemera proposes these from the catalogue. Nothing is kept until you accept it. '}
        Missions already running keep the checks they were launched with.
      </p>
      {proofLimit !== undefined && <ProofLimit field={proofLimit} />}
    </Section>
  )
}

/** What the dialog of a check writes: its catalogue command by id. */
export type CheckDraft = Omit<SettingsCheck, 'id' | 'command'> & { command: string | null }

/** A check not written yet: a line of its own, after each task, on the changed repositories. */
export const NEW_CHECK: CheckDraft = {
  name: '',
  command: null,
  line: '',
  where: 'changed',
  repository: null,
  when: 'task',
  expect: null,
  files: null,
}

/** What the engine refuses of a draft, in its words, at the field each concerns. */
export interface CheckRefusals {
  name?: string | undefined
  line?: string | undefined
  pattern?: string | undefined
  minimum?: string | undefined
  files?: string | undefined
}

export interface CheckFormProps {
  draft: CheckDraft
  onChange: (draft: CheckDraft) => void
  /** The catalogue commands that may be used as a check. */
  commands: readonly CatalogueChoice[]
  /** The repositories it may run in, by path. */
  places: readonly string[]
  refusals: CheckRefusals
}

const LABEL = 'text-sm font-medium'

/** The value of the "Runs in" select: `changed`, `.` for the root, or a repository's path. */
function placeValue(draft: Pick<CheckDraft, 'where' | 'repository'>): string {
  if (draft.where === 'repository') return draft.repository ?? '.'
  return draft.where === 'root' ? '.' : 'changed'
}

/** Where a check runs, from the value of the "Runs in" select. */
function placeOf(value: string): Pick<CheckDraft, 'where' | 'repository'> {
  if (value === 'changed') return { where: 'changed', repository: null }
  if (value === '.') return { where: 'root', repository: null }
  return { where: 'repository', repository: value }
}

/** The form of a check: what runs, where, when, what it expects and on which files. */
export function CheckForm({
  draft,
  onChange,
  commands,
  places,
  refusals,
}: CheckFormProps): ReactNode {
  const folding = useTransition(fold)
  const set = (part: Partial<CheckDraft>): void => onChange({ ...draft, ...part })
  return (
    <>
      <Input
        label="Name"
        value={draft.name}
        error={refusals.name}
        onValueChange={(name) => set({ name })}
      />
      <CommandLineField
        commands={commands}
        systems={false}
        value={{
          command: draft.command,
          line: draft.line ?? '',
          lineLinux: null,
          lineWindows: null,
        }}
        onChange={(value) =>
          set({ command: value.command, line: value.command === null ? value.line : draft.line })
        }
        refusalOf={() => refusals.line}
      />
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={LABEL} aria-hidden="true">
            Runs in
          </span>
          <Select
            label="Runs in"
            className="w-full"
            value={placeValue(draft)}
            onValueChange={(place) => set(placeOf(place))}
            items={[
              { value: 'changed', label: 'Changed repositories' },
              { value: '.', label: 'root' },
              ...places.map((place) => ({ value: place, label: place })),
            ]}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={LABEL} aria-hidden="true">
            When
          </span>
          <Select
            label="When"
            className="w-full"
            value={draft.when}
            onValueChange={(when) => set({ when })}
            items={MOMENTS.map((moment) => ({ value: moment, label: MOMENT_WORDS[moment] }))}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className={LABEL} aria-hidden="true">
          Expects
        </span>
        <Select<'exit' | 'number'>
          label="Expects"
          className="w-full"
          value={draft.expect === null ? 'exit' : 'number'}
          onValueChange={(kind) =>
            set({
              expect: kind === 'exit' ? null : (draft.expect ?? { pattern: '', minimum: '' }),
            })
          }
          items={[
            { value: 'exit', label: 'Exit code 0' },
            { value: 'number', label: 'A number in its output' },
          ]}
        />
        <AnimatePresence initial={false}>
          {draft.expect !== null && (
            <motion.div
              key="number"
              className="overflow-hidden"
              initial={collapse}
              animate={expand}
              exit={collapse}
              transition={folding}
            >
              <div className="flex items-start gap-3 pt-2">
                <Input
                  label="Pattern"
                  className="min-w-0 flex-1"
                  value={draft.expect.pattern}
                  placeholder="Coverage: ([0-9.]+)%"
                  error={refusals.pattern}
                  onValueChange={(pattern) =>
                    set({ expect: { minimum: draft.expect?.minimum ?? '', pattern } })
                  }
                />
                <Input
                  label="At least"
                  className="w-24 shrink-0"
                  value={draft.expect.minimum}
                  placeholder="70"
                  error={refusals.minimum}
                  onValueChange={(minimum) =>
                    set({ expect: { pattern: draft.expect?.pattern ?? '', minimum } })
                  }
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Input
        label="Only files matching"
        value={draft.files ?? ''}
        placeholder="**/*.test.ts"
        description="{files} in the line stands for the files the task wrote that match. None match: the check is skipped."
        error={refusals.files}
        onValueChange={(files) => set({ files: files === '' ? null : files })}
      />
    </>
  )
}
