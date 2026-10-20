import { cn } from 'cn'
// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, type ReactNode, useState } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCheck,
  IconChevronRight,
  IconGitMerge,
  IconHandStop,
  IconLock,
  IconPackage,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconWorld,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import {
  type CleanupStep,
  type CliState,
  type Dependency,
  type DeliveryRefusals,
  type DeliveryRepository,
  type DeliveryRules,
  type ForgeView,
  type Moment,
  MOMENT_WORDS,
  PRESET_WORDS,
  PRESETS,
  type Preset,
  type PullRequestRules,
  type RecipeStep,
  STEP_WORDS,
  type StepConfig,
  FORGE_WORDS,
  detailOf,
  writesToNetwork,
} from './delivery-model.ts'
import { forgeIcon, stepIcon } from './delivery-icons.tsx'
import {
  changesOf,
  changesWords,
  cliTroubled,
  cliWords,
  pushWords,
  reviewersWords,
  stepWords,
} from './delivery-words.ts'
import { Section, SectionRefusal } from './parts.tsx'
import { FixCommand } from './provider-forms.tsx'

/**
 * The delivery rules of a Project, in its settings: what happens to the work from the first push
 * to Done, in the three moments it happens in, each its own frame.
 *
 * **Pull requests** — before Ship: when the branch is pushed and the pull requests open (in Review
 * or in the waves, on their own or on a click), the templates of the commits, titles and bodies,
 * the reviewers, and the approvals Ship waits for. One line each, its value beside its name; a
 * line opens its dialog.
 *
 * **Waves** — after Ship: the repositories in the order they deliver, each wave under its band, one
 * line per repository: its preset, what it changes of it, the repository it waits for, where it
 * pushes, and its forge with the state of the forge's command line. A line unfolds into its
 * recipe, moment by moment — after each task, when Review starts, after Ship — the steps each runs,
 * each with where it comes from: the preset, changed here, added here, or left out — and folds
 * back. Committing is a step like the others: Hemera commits, I commit myself, an agent commits.
 * Any step of the catalogue may be added to any moment. Hemera's proposed dependencies stand under
 * the waves, quiet, with Accept.
 *
 * **End** — Closing, always there and never removed, then Cleanup, whose steps are removed or
 * added.
 *
 * A rule the engine refuses is said in words at its own place, never in a list away from it.
 */

/** What a line of the section opens. */
export type DeliveryTarget =
  | { readonly kind: 'push' | 'commit' | 'title' | 'body' | 'reviewers' }
  | { readonly kind: 'repository'; readonly repository: string }
  | { readonly kind: 'step'; readonly repository: string; readonly id: string }
  | { readonly kind: 'add-step'; readonly repository: string }
  | { readonly kind: 'cleanup'; readonly id: string }
  | { readonly kind: 'add-cleanup' }

const CLI_TONE: Record<CliState, string> = {
  ready: 'text-success',
  missing: 'text-warning',
  'signed-out': 'text-warning',
  unreachable: 'text-destructive',
}

/** The state of a forge's command line as one glyph, its words in its legend. */
export function CliGlyph({
  forge,
  plain = false,
}: {
  forge: ForgeView
  /** Inside a control that already says it in words: the glyph alone, no legend of its own. */
  plain?: boolean | undefined
}): ReactNode {
  if (forge.kind === 'none') return null
  if (forge.cli === null) {
    return (
      <Skeleton shape="block">
        <IconCheck size="sm" />
      </Skeleton>
    )
  }
  const tone = CLI_TONE[forge.cli]
  const glyph = forge.cli === 'ready' ? <IconCheck size="sm" /> : <IconAlertTriangle size="sm" />
  return (
    <span className={cn('flex', tone)}>
      {plain ? glyph : <Legend label={cliWords(forge)}>{glyph}</Legend>}
    </span>
  )
}

/** The repositories a repository waits for, accepted dependencies only. */
export function upstreamOf(path: string, dependencies: readonly Dependency[]): string[] {
  return dependencies.filter((one) => !one.proposed && one.repository === path).map((one) => one.on)
}

export const FRAME_BAND =
  'flex h-control-sm items-center gap-2 border-b border-border bg-surface-rim px-4 text-xs font-medium'

export const QUIET_BAND = 'font-normal text-muted-foreground'

export const ITEM = 'border-b border-border bg-surface-body last:border-b-0'

export const CELLS =
  'flex min-h-control-lg min-w-0 flex-1 items-center gap-3 py-2 pr-4 pl-4 text-sm'

export const OPEN = cn(
  CELLS,
  'w-full rounded-md text-left outline-none hover:tinted focus-ring hover-motion',
)

const LABEL = 'min-w-0 shrink-0 truncate font-medium md:w-settings-name'

const VALUE = 'min-w-0 flex-1 truncate text-muted-foreground'

export const MONO = 'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'

export const CHEVRON = 'flex shrink-0 text-muted-foreground'

export const FOLD_CHEVRON =
  'flex shrink-0 text-muted-foreground chevron-motion aria-expanded:rotate-90'

export const GLYPH = 'flex size-icon-md shrink-0 items-center justify-center text-muted-foreground'

export const ROOM = 'flex size-icon-md shrink-0 items-center justify-center'

const MARK = 'flex text-foreground'

const REFUSED = 'flex items-start gap-2 pr-4 pb-2 text-sm text-destructive-muted-foreground'

/** The room at the end of a step's line, for its way back to the preset, on every line alike. */
export const TRAILING = 'flex size-control-sm shrink-0 items-center justify-center'

const NOTE = 'max-w-measure text-xs text-muted-foreground'

/** A line that opens a dialog: its name, its value, its chevron. */
export function OpenLine({
  label,
  value,
  mono = false,
  words,
  onOpen,
}: {
  label: string
  value: string
  mono?: boolean | undefined
  /** What the line says to a screen reader, when its value is not enough. */
  words?: string | undefined
  onOpen: () => void
}): ReactNode {
  return (
    <li className={ITEM}>
      <button
        type="button"
        className={OPEN}
        aria-label={words ?? `${label}, ${value}`}
        onClick={onOpen}
      >
        <span className={LABEL}>{label}</span>
        <span className={mono ? MONO : VALUE}>{value}</span>
        <span className={CHEVRON} aria-hidden="true">
          <IconChevronRight size="sm" />
        </span>
      </button>
    </li>
  )
}

/** What a refusal says at its place: its glyph and its words. */
export function Refused({
  words,
  inset = false,
}: {
  words: string | undefined
  /** Under a step of a recipe: in line with the step's glyph. */
  inset?: boolean | undefined
}): ReactNode {
  const folding = useTransition(fold)
  return (
    <AnimatePresence initial={false}>
      {words !== undefined && (
        <motion.p
          key="refused"
          role="alert"
          className="overflow-hidden"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          <span className={cn(REFUSED, inset ? 'pl-10' : 'pl-4')}>
            <span className="flex shrink-0 pt-0.5">
              <IconAlertTriangle size="sm" aria-hidden="true" />
            </span>
            <span className="max-w-measure">{words}</span>
          </span>
        </motion.p>
      )}
    </AnimatePresence>
  )
}

/** The first line of a template, and how many lines follow it. */
function firstLine(template: string): string {
  const lines = template.split('\n')
  const rest = lines.length - 1
  return rest === 0 ? (lines[0] ?? '') : `${lines[0] ?? ''} … ${String(rest)} more lines`
}

export function PullRequests({
  rules,
  refusals,
  onOpen,
  onToggle,
}: {
  rules: PullRequestRules
  refusals: DeliveryRefusals
  onOpen: (target: DeliveryTarget) => void
  onToggle: (rule: 'requireApproval' | 'reviewDrafts', on: boolean) => void
}): ReactNode {
  return (
    <Frame>
      <h3 className={FRAME_BAND}>
        Pull requests <span className={QUIET_BAND}>· before Ship</span>
      </h3>
      <ul aria-label="Pull requests" className="flex flex-col">
        <OpenLine
          label="Push and open"
          value={pushWords(rules)}
          onOpen={() => onOpen({ kind: 'push' })}
        />
        <OpenLine
          label="Commit message"
          value={rules.commit}
          mono
          onOpen={() => onOpen({ kind: 'commit' })}
        />
        <OpenLine
          label="Pull request title"
          value={rules.title}
          mono
          onOpen={() => onOpen({ kind: 'title' })}
        />
        <OpenLine
          label="Pull request body"
          value={firstLine(rules.body)}
          mono
          words={`Pull request body, ${String(rules.body.split('\n').length)} lines`}
          onOpen={() => onOpen({ kind: 'body' })}
        />
        <OpenLine
          label="Reviewers"
          value={reviewersWords(rules)}
          onOpen={() => onOpen({ kind: 'reviewers' })}
        />
        <li className={cn(ITEM, 'flex flex-col')}>
          <div className={CELLS}>
            <Checkbox
              checked={rules.requireApproval}
              onCheckedChange={(on) => onToggle('requireApproval', on)}
              label="Require team approval before Ship"
            />
          </div>
          <Refused words={refusals.approval} />
        </li>
        <li className={ITEM}>
          <div className={CELLS}>
            <Checkbox
              checked={rules.reviewDrafts}
              onCheckedChange={(on) => onToggle('reviewDrafts', on)}
              label="Review the drafts first"
              description="You read each title and body before its pull request opens."
            />
          </div>
        </li>
      </ul>
    </Frame>
  )
}

export function StepRow({
  recipe,
  repository,
  onOpen,
  onPutBack,
  onReset,
}: {
  recipe: RecipeStep
  repository: DeliveryRepository
  onOpen: () => void
  onPutBack: () => void
  onReset: () => void
}): ReactNode {
  const { step, origin } = recipe
  const out = origin === 'omitted'
  const name = STEP_WORDS[step.config.kind]
  const cells = (
    <>
      <span className={GLYPH} aria-hidden="true">
        {stepIcon(step.config.kind)}
      </span>
      <span
        className={cn(
          'w-settings-name min-w-0 shrink-0 truncate',
          out && 'text-muted-foreground line-through',
        )}
      >
        {name}
      </span>
      <span className={cn(MONO, out && 'line-through')}>{detailOf(step.config, repository)}</span>
      <span className={ROOM} data-column="origin">
        {origin === 'changed' && (
          <span className={MARK}>
            <IconPencil size="sm" />
          </span>
        )}
        {origin === 'added' && (
          <span className={MARK}>
            <IconPlus size="sm" />
          </span>
        )}
      </span>
      <span className={ROOM} data-column="click">
        {step.start === 'click' && !out && (
          <span className={MARK}>
            <IconHandStop size="sm" />
          </span>
        )}
      </span>
      <span className={ROOM} data-column="network">
        {writesToNetwork(step.config) && !out && (
          <span className={MARK}>
            <IconWorld size="sm" />
          </span>
        )}
      </span>
    </>
  )
  return (
    <li className={cn(ITEM, 'flex flex-col')} data-step={step.id}>
      <div className="flex min-w-0 items-center gap-1 pr-2">
        {out ? (
          <div className={cn(CELLS, 'pl-10')}>
            <span className="sr-only">{stepWords(recipe, repository)}</span>
            <span className="contents" aria-hidden="true">
              {cells}
              <span className="size-icon-sm shrink-0" />
            </span>
          </div>
        ) : (
          <button
            type="button"
            className={cn(OPEN, 'pl-10')}
            aria-label={stepWords(recipe, repository)}
            onClick={onOpen}
          >
            {cells}
            <span className={CHEVRON} aria-hidden="true">
              <IconChevronRight size="sm" />
            </span>
          </button>
        )}
        <span className={TRAILING}>
          {out && (
            <Tooltip label="Put back">
              <IconButton
                size="sm"
                variant="ghost"
                icon={<IconArrowBackUp size="sm" />}
                aria-label={`Put back ${name}`}
                onClick={onPutBack}
              />
            </Tooltip>
          )}
          {origin === 'changed' && (
            <Tooltip label="Back to the preset">
              <IconButton
                size="sm"
                variant="ghost"
                icon={<IconArrowBackUp size="sm" />}
                aria-label={`Back to the preset for ${name}`}
                onClick={onReset}
              />
            </Tooltip>
          )}
        </span>
      </div>
      <Refused words={recipe.refused} inset />
    </li>
  )
}

/** The head of a recipe's columns: the marks named by their legends. */
export function RecipeHead({ label }: { label: string }): ReactNode {
  return (
    <div className="flex h-control-sm min-w-0 items-center gap-1 border-b border-border bg-surface-rim pr-2 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-1 items-center gap-3 pr-4 pl-10">
        <span className="size-icon-md shrink-0" />
        <span className="min-w-0 flex-1 font-medium text-foreground">{label}</span>
        <span className={ROOM}>
          <Legend label="Changed or added here">
            <span className="flex">
              <IconPencil size="sm" />
            </span>
          </Legend>
        </span>
        <span className={ROOM}>
          <Legend label="Waits for your click">
            <span className="flex">
              <IconHandStop size="sm" />
            </span>
          </Legend>
        </span>
        <span className={ROOM}>
          <Legend label="May write to the network">
            <span className="flex">
              <IconWorld size="sm" />
            </span>
          </Legend>
        </span>
        <span className="size-icon-sm shrink-0" />
      </div>
      <span className={TRAILING} />
    </div>
  )
}

/** What stands wrong with a forge's command line, the command that fixes it, and Check again. */
function CliTrouble({
  forge,
  checking,
  onCheckAgain,
  onCopy,
}: {
  forge: ForgeView
  checking: boolean
  onCheckAgain: () => void
  onCopy: (line: string) => void
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 border-b border-border bg-surface-body py-3 pr-4 pl-10">
      <p className="flex items-start gap-2 text-sm">
        <CliGlyph forge={forge} />
        <span className="max-w-measure min-w-0">
          {forge.sentence ?? cliWords(forge)}. The pushes go on; the forge’s steps wait.
        </span>
      </p>
      {forge.fix !== undefined && (
        <div className="max-w-measure">
          <FixCommand line={forge.fix} onCopy={onCopy} />
        </div>
      )}
      <div>
        <Button size="sm" state={checking ? 'loading' : 'idle'} onClick={onCheckAgain}>
          <IconRefresh size="sm" />
          Check again
        </Button>
      </div>
    </div>
  )
}

export interface RepositoryRowProps {
  repository: DeliveryRepository
  /** The repositories it waits for. */
  after: readonly string[]
  initiallyOpen?: boolean | undefined
  checking: boolean
  onOpen: (target: DeliveryTarget) => void
  onPreset: (preset: Preset) => void
  onPutBack: (id: string) => void
  onReset: (id: string) => void
  onCheckAgain: () => void
  onCopy: (line: string) => void
}

export const MOMENTS_SHOWN: readonly Moment[] = ['tasks', 'review', 'waves']

/** How each moment's list is named after the repository's: its waves are its steps. */
export const STEPS_OF: Record<Moment, string> = {
  tasks: ' after each task',
  review: ' in Review',
  waves: '',
}

/** What an empty moment says: nothing runs there, and what follows. */
export const NOTHING: Record<Moment, string> = {
  tasks: 'Nothing after each task: the work waits in the Workspace until Review.',
  review: 'Nothing when Review starts: the work waits in the Workspace until Ship.',
  waves: 'Nothing after Ship: Ship records the delivery, then the End runs.',
}

/** A repository of a wave: one line, which unfolds into its recipe. */
export function RepositoryRow({
  repository,
  after,
  initiallyOpen = false,
  checking,
  onOpen,
  onPreset,
  onPutBack,
  onReset,
  onCheckAgain,
  onCopy,
}: RepositoryRowProps): ReactNode {
  const [open, setOpen] = useState(initiallyOpen)
  const folding = useTransition(fold)
  const { forge, path } = repository
  const refused = repository.steps.filter((one) => one.refused !== undefined).length
  const changes = changesOf(repository)
  const row = (one: RecipeStep): ReactNode => (
    <StepRow
      key={one.step.id}
      recipe={one}
      repository={repository}
      onOpen={() => onOpen({ kind: 'step', repository: path, id: one.step.id })}
      onPutBack={() => onPutBack(one.step.id)}
      onReset={() => onReset(one.step.id)}
    />
  )
  const words = [
    path,
    PRESET_WORDS[repository.preset],
    changesWords(changes),
    after.length === 0 ? null : `after ${after.join(', ')}`,
    forge.kind === 'none' ? null : `${repository.remote}/${repository.base}`,
    `${FORGE_WORDS[forge.kind]}, ${cliWords(forge)}`,
    refused === 0 ? null : `${String(refused)} refused`,
  ]
    .filter((part) => part !== null)
    .join(', ')
  return (
    <li className={ITEM} data-repository={path}>
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          className={cn(OPEN, 'pl-3')}
          aria-expanded={open}
          aria-label={words}
          onClick={() => setOpen(!open)}
        >
          <span className={FOLD_CHEVRON} aria-expanded={open} aria-hidden="true">
            <IconChevronRight size="sm" />
          </span>
          <span className="min-w-0 shrink-0 truncate font-mono font-medium md:w-settings-name">
            {path}
          </span>
          <span className="w-24 shrink-0 truncate">{PRESET_WORDS[repository.preset]}</span>
          <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground md:block">
            {changesWords(changes)}
          </span>
          <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block">
            {after.length === 0 ? '' : `after ${after.join(', ')}`}
          </span>
          <span className="ml-auto hidden min-w-0 shrink truncate font-mono text-xs text-muted-foreground lg:block">
            {forge.kind === 'none' ? 'this machine' : `${repository.remote}/${repository.base}`}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
            {forgeIcon(forge)}
          </span>
          <span className={ROOM}>
            <CliGlyph forge={forge} plain />
          </span>
          <span className={cn(ROOM, 'text-destructive')} data-column="refused">
            {refused > 0 && <IconAlertTriangle size="sm" />}
          </span>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="recipe"
            className="overflow-hidden border-t border-border"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border py-2 pr-4 pl-10">
              <Select<Preset>
                label={`Preset of ${path}`}
                className="w-settings-name"
                value={repository.preset}
                onValueChange={onPreset}
                items={PRESETS.map((preset) => ({ value: preset, label: PRESET_WORDS[preset] }))}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remote, base and forge of ${path}`}
                onClick={() => onOpen({ kind: 'repository', repository: path })}
              >
                {forgeIcon(forge)}
                <span className="font-mono text-xs">
                  {forge.kind === 'none'
                    ? `${repository.base}, on this machine`
                    : `${repository.remote}/${repository.base}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {FORGE_WORDS[forge.kind]}
                  {forge.forced ? ', forced' : ''}
                </span>
              </Button>
            </div>
            {cliTroubled(forge) && (
              <CliTrouble
                forge={forge}
                checking={checking}
                onCheckAgain={onCheckAgain}
                onCopy={onCopy}
              />
            )}
            {MOMENTS_SHOWN.map((moment) => {
              const steps = repository.steps.filter((one) => one.moment === moment)
              return (
                <Fragment key={moment}>
                  <RecipeHead label={MOMENT_WORDS[moment]} />
                  <ul aria-label={`Steps of ${path}${STEPS_OF[moment]}`} className="flex flex-col">
                    {steps.map(row)}
                    {steps.length === 0 && (
                      <li className="py-2 pr-4 pl-10 text-sm text-muted-foreground">
                        {NOTHING[moment]}
                      </li>
                    )}
                  </ul>
                </Fragment>
              )
            })}
            <div className="flex border-t border-border py-1.5 pl-8">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpen({ kind: 'add-step', repository: path })}
              >
                <IconPlus size="sm" />
                Add a step to {path}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

/** The row's own shape while the rules are on their way. */
function RepositoryRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={ITEM} data-row-skeleton="">
      <span className={cn(CELLS, 'pl-3')}>
        <span className="size-icon-md shrink-0" />
        <span className="w-settings-name shrink-0">
          <Skeleton>shared</Skeleton>
        </span>
        <span className="w-24 shrink-0">
          <Skeleton>Application</Skeleton>
        </span>
        <span className="hidden w-24 shrink-0 text-xs md:block">
          <Skeleton>as the preset</Skeleton>
        </span>
      </span>
    </li>
  )
}

function LineSkeleton({ label }: { label: string }): ReactNode {
  return (
    <li aria-hidden="true" className={ITEM} data-row-skeleton="">
      <span className={CELLS}>
        <span className={LABEL}>{label}</span>
        <span className={VALUE}>
          <Skeleton>When Review starts · on its own</Skeleton>
        </span>
      </span>
    </li>
  )
}

export function ProposedDependency({
  dependency,
  onAccept,
}: {
  dependency: Dependency
  onAccept: () => void
}): ReactNode {
  const folding = useTransition(fold)
  const words = `${dependency.repository} delivers after ${dependency.on}`
  return (
    <motion.li
      className={ITEM}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      <div className={cn(CELLS, 'text-muted-foreground')}>
        <span className={GLYPH} aria-hidden="true">
          <IconPackage size="sm" />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-mono text-foreground">{dependency.repository}</span> uses{' '}
          <span className="font-mono text-foreground">{dependency.on}</span>: it delivers after it
        </span>
        <Button size="sm" variant="ghost" aria-label={`Accept: ${words}`} onClick={onAccept}>
          Accept
        </Button>
      </div>
    </motion.li>
  )
}

export function Waves({
  rules,
  refusals,
  checking,
  initiallyOpen,
  onOpen,
  onPreset,
  onPutBack,
  onReset,
  onCheckAgain,
  onCopy,
  onAcceptDependency,
}: {
  rules: DeliveryRules
  refusals: DeliveryRefusals
  checking: readonly string[]
  initiallyOpen: readonly string[]
  onOpen: (target: DeliveryTarget) => void
  onPreset: (repository: string, preset: Preset) => void
  onPutBack: (repository: string, id: string) => void
  onReset: (repository: string, id: string) => void
  onCheckAgain: (repository: string) => void
  onCopy: (line: string) => void
  onAcceptDependency: (dependency: Dependency) => void
}): ReactNode {
  const folding = useTransition(fold)
  const byPath = new Map(rules.repositories.map((one) => [one.path, one]))
  const opened = new Set(initiallyOpen)
  const busy = new Set(checking)
  // A cycle leaves no order: the repositories stand in one list, under the refusal that says why.
  const waves = refusals.dependencies === undefined ? rules.waves : null
  const groups =
    waves === null
      ? [{ label: 'No order', paths: rules.repositories.map((one) => one.path) }]
      : waves.map((paths, index) => ({ label: `Wave ${String(index + 1)}`, paths }))
  const proposed = rules.dependencies.filter((one) => one.proposed)
  return (
    <Frame>
      <h3 className={FRAME_BAND}>
        Waves <span className={QUIET_BAND}>· after Ship</span>
      </h3>
      {refusals.dependencies !== undefined && (
        <div className="border-b border-border bg-surface-body pt-2">
          <Refused words={refusals.dependencies} />
        </div>
      )}
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col border-b border-border last:border-b-0">
          <h4 className="flex h-control-sm items-center border-b border-border px-4 text-xs text-muted-foreground">
            {group.label}
          </h4>
          <ul aria-label={group.label} className="flex flex-col">
            {group.paths.map((path) => {
              const repository = byPath.get(path)
              if (repository === undefined) return null
              return (
                <RepositoryRow
                  key={path}
                  repository={repository}
                  after={upstreamOf(path, rules.dependencies)}
                  initiallyOpen={opened.has(path)}
                  checking={busy.has(path)}
                  onOpen={onOpen}
                  onPreset={(preset) => onPreset(path, preset)}
                  onPutBack={(id) => onPutBack(path, id)}
                  onReset={(id) => onReset(path, id)}
                  onCheckAgain={() => onCheckAgain(path)}
                  onCopy={onCopy}
                />
              )
            })}
          </ul>
        </div>
      ))}
      <AnimatePresence initial={false}>
        {proposed.length > 0 && (
          <motion.div
            key="proposed"
            className="overflow-hidden border-t border-border"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <h4 className="flex h-control-sm items-center border-b border-border px-4 text-xs text-muted-foreground">
              Hemera read these in the manifests
            </h4>
            <ul aria-label="Proposed dependencies" className="flex flex-col">
              <AnimatePresence initial={false}>
                {proposed.map((one) => (
                  <ProposedDependency
                    key={`${one.repository}>${one.on}`}
                    dependency={one}
                    onAccept={() => onAcceptDependency(one)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </Frame>
  )
}

export function CleanupRow({
  step,
  onOpen,
  onRemove,
}: {
  step: CleanupStep
  onOpen: () => void
  onRemove: () => void
}): ReactNode {
  const folding = useTransition(fold)
  const config: StepConfig | undefined = step.config
  return (
    <motion.li
      className={cn(ITEM, 'overflow-hidden')}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
      data-cleanup={step.id}
    >
      <div className="flex min-w-0 items-center gap-1 pr-2">
        {config === undefined ? (
          <div className={CELLS}>
            <span className={GLYPH} aria-hidden="true">
              <IconCheck size="sm" />
            </span>
            <span className="min-w-0 flex-1 truncate">{step.label}</span>
          </div>
        ) : (
          <button
            type="button"
            className={OPEN}
            aria-label={`${step.label}, ${STEP_WORDS[config.kind]}: ${detailOf(config)}`}
            onClick={onOpen}
          >
            <span className={GLYPH} aria-hidden="true">
              {stepIcon(config.kind)}
            </span>
            <span className="w-settings-name min-w-0 shrink-0 truncate">{step.label}</span>
            <span className={MONO}>{detailOf(config)}</span>
            <span className={ROOM}>
              {writesToNetwork(config) && (
                <span className={MARK}>
                  <IconWorld size="sm" />
                </span>
              )}
            </span>
            <span className={CHEVRON} aria-hidden="true">
              <IconChevronRight size="sm" />
            </span>
          </button>
        )}
        <Tooltip label="Remove from the cleanup">
          <IconButton
            size="sm"
            variant="ghost"
            icon={<IconTrash size="sm" />}
            aria-label={`Remove ${step.label}`}
            onClick={onRemove}
          />
        </Tooltip>
      </div>
    </motion.li>
  )
}

export function End({
  cleanup,
  onOpen,
  onRemoveCleanup,
}: {
  cleanup: readonly CleanupStep[]
  onOpen: (target: DeliveryTarget) => void
  onRemoveCleanup: (id: string) => void
}): ReactNode {
  return (
    <Frame>
      <h3 className={FRAME_BAND}>
        End <span className={QUIET_BAND}>· once everything is delivered</span>
      </h3>
      <h4 className="flex h-control-sm items-center border-b border-border px-4 text-xs text-muted-foreground">
        Closing
      </h4>
      <ul aria-label="Closing" className="flex flex-col border-b border-border">
        <li className={ITEM}>
          <div className={CELLS}>
            <span className={GLYPH} aria-hidden="true">
              <IconGitMerge size="sm" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              Merge the Spec and its rounds into the living spec
            </span>
            <span className="flex text-muted-foreground">
              <Legend label="Always runs: Done comes after it">
                <IconLock size="sm" />
              </Legend>
            </span>
          </div>
        </li>
      </ul>
      <h4 className="flex h-control-sm items-center border-b border-border px-4 text-xs text-muted-foreground">
        Cleanup
      </h4>
      <ul aria-label="Cleanup" className="flex flex-col">
        <AnimatePresence initial={false}>
          {cleanup.map((step) => (
            <CleanupRow
              key={step.id}
              step={step}
              onOpen={() => onOpen({ kind: 'cleanup', id: step.id })}
              onRemove={() => onRemoveCleanup(step.id)}
            />
          ))}
        </AnimatePresence>
      </ul>
      {cleanup.length === 0 && (
        <p className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
          Nothing is cleaned up: the Workspace stays on disk.
        </p>
      )}
      <div className="flex py-1.5 pl-3">
        <Button size="sm" variant="ghost" onClick={() => onOpen({ kind: 'add-cleanup' })}>
          <IconPlus size="sm" />
          Add a cleanup step
        </Button>
      </div>
    </Frame>
  )
}

export interface DeliveryRulesSectionProps {
  /** Null: the rules are on their way. */
  rules: DeliveryRules | null
  /** What the engine refuses away from a step, each said at its place. */
  refusals?: DeliveryRefusals | undefined
  /** Why the rules could not be read, in words. */
  error?: string | undefined
  /** The repositories unfolded when the section opens, by path. */
  initiallyOpen?: readonly string[] | undefined
  /** The repositories whose forge's command line is being checked again. */
  checking?: readonly string[] | undefined
  onOpen: (target: DeliveryTarget) => void
  onToggle: (rule: 'requireApproval' | 'reviewDrafts', on: boolean) => void
  onPreset: (repository: string, preset: Preset) => void
  onPutBack: (repository: string, id: string) => void
  onReset: (repository: string, id: string) => void
  onAcceptDependency: (dependency: Dependency) => void
  onRemoveCleanup: (id: string) => void
  onCheckAgain: (repository: string) => void
  onCopy: (line: string) => void
}

export function DeliveryRulesSection({
  rules,
  refusals = {},
  error,
  initiallyOpen = [],
  checking = [],
  onOpen,
  onToggle,
  onPreset,
  onPutBack,
  onReset,
  onAcceptDependency,
  onRemoveCleanup,
  onCheckAgain,
  onCopy,
}: DeliveryRulesSectionProps): ReactNode {
  return (
    <Section label="Delivery rules">
      <SectionHead title="Delivery rules" />
      <SectionRefusal error={error} />
      {rules === null && error === undefined && (
        <>
          <Frame>
            <h3 className={FRAME_BAND}>Pull requests</h3>
            <ul aria-label="Pull requests" aria-busy="true" className="flex flex-col">
              <LineSkeleton label="Push and open" />
              <LineSkeleton label="Commit message" />
              <LineSkeleton label="Reviewers" />
            </ul>
          </Frame>
          <Frame>
            <h3 className={FRAME_BAND}>Waves</h3>
            <ul aria-label="Repositories" aria-busy="true" className="flex flex-col">
              <RepositoryRowSkeleton />
              <RepositoryRowSkeleton />
              <RepositoryRowSkeleton />
            </ul>
          </Frame>
        </>
      )}
      {rules !== null && (
        <>
          <PullRequests
            rules={rules.pullRequests}
            refusals={refusals}
            onOpen={onOpen}
            onToggle={onToggle}
          />
          <Waves
            rules={rules}
            refusals={refusals}
            checking={checking}
            initiallyOpen={initiallyOpen}
            onOpen={onOpen}
            onPreset={onPreset}
            onPutBack={onPutBack}
            onReset={onReset}
            onCheckAgain={onCheckAgain}
            onCopy={onCopy}
            onAcceptDependency={onAcceptDependency}
          />
          <End cleanup={rules.cleanup} onOpen={onOpen} onRemoveCleanup={onRemoveCleanup} />
          <p className={NOTE}>
            Missions already under way keep the rules they started with: what runs after each task
            is copied at the first task done, the pull requests’ part at the first push, the waves
            and the End at Ship.
          </p>
        </>
      )}
    </Section>
  )
}
