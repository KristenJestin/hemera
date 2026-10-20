/**
 * Gesture 2, reordering a step already placed in a repository's recipe. Two ways: its place
 * chosen in its own dialog, When and After, as a new step's is (recommended), or arrows on its
 * line that move it one place, across moments at their edges.
 */
import { cn } from 'cn'
// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, type ReactNode, useState } from 'react'

import { DELIVERY_COMMANDS } from '../../blocks/project-settings/delivery-fixtures.ts'
import {
  PlaceFields,
  StepForm,
  type StepDraft,
} from '../../blocks/project-settings/delivery-forms.tsx'
import { forgeIcon } from '../../blocks/project-settings/delivery-icons.tsx'
import {
  type DeliveryRepository,
  type DeliveryRules,
  MOMENT_WORDS,
  MOMENTS,
  type Moment,
  PRESET_WORDS,
  PRESETS,
  type Preset,
  type RecipeStep,
  STEP_WORDS,
} from '../../blocks/project-settings/delivery-model.ts'
import {
  CliGlyph,
  FRAME_BAND,
  FOLD_CHEVRON,
  ITEM,
  NOTHING,
  OPEN,
  QUIET_BAND,
  ROOM,
  RecipeHead,
  RepositoryRow,
  STEPS_OF,
  StepRow,
  upstreamOf,
} from '../../blocks/project-settings/delivery-rules.tsx'
import { changesOf, changesWords } from '../../blocks/project-settings/delivery-words.ts'
import { FormFoot } from '../../blocks/project-settings/parts.tsx'
import { IconButton } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Select } from '../../components/select/select.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconArrowUp, IconChevronRight, IconGitMerge } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { SameEnd, SamePullRequests } from './frames.tsx'
import { GesturePage } from './gesture-page.tsx'

const nothing = (): void => {}

/** A step of the preset moved is a change of the repository's, which Back to the preset undoes. */
function movedOrigin(recipe: RecipeStep): RecipeStep['origin'] {
  return recipe.origin === 'preset' ? 'changed' : recipe.origin
}

/** The repository's steps with one taken out and put back after `after` (null: first) in `moment`. */
export function placed(
  repository: DeliveryRepository,
  id: string,
  moment: Moment,
  after: string | null,
): DeliveryRepository {
  const one = repository.steps.find((s) => s.step.id === id)
  if (one === undefined) return repository
  const rest = repository.steps.filter((s) => s.step.id !== id)
  const moved: RecipeStep = { ...one, moment, origin: movedOrigin(one) }
  const rank = MOMENTS.indexOf(moment)
  const at =
    after === null
      ? (() => {
          const first = rest.findIndex((s) => MOMENTS.indexOf(s.moment) >= rank)
          return first === -1 ? rest.length : first
        })()
      : rest.findIndex((s) => s.step.id === after) + 1
  return { ...repository, steps: [...rest.slice(0, at), moved, ...rest.slice(at)] }
}

/** One place up or down: within its moment, or to the edge of the moment beside it. */
export function stepped(
  repository: DeliveryRepository,
  id: string,
  by: -1 | 1,
): DeliveryRepository {
  const steps = repository.steps
  const index = steps.findIndex((s) => s.step.id === id)
  const one = steps[index]
  if (one === undefined) return repository
  const neighbour = steps[index + by]
  if (neighbour !== undefined && neighbour.moment === one.moment) {
    const next = [...steps]
    next[index] = neighbour
    next[index + by] = { ...one, origin: movedOrigin(one) }
    return { ...repository, steps: next }
  }
  const moment = MOMENTS[MOMENTS.indexOf(one.moment) + by]
  if (moment === undefined) return repository
  const next = [...steps]
  next[index] = { ...one, moment, origin: movedOrigin(one) }
  return { ...repository, steps: next }
}

function withRepository(rules: DeliveryRules, next: DeliveryRepository): DeliveryRules {
  return {
    ...rules,
    repositories: rules.repositories.map((one) => (one.path === next.path ? next : one)),
  }
}

/** Where a placed step stands: its moment and the step before it there, null for first. */
function placeOf(repository: DeliveryRepository, id: string): Pick<StepDraft, 'moment' | 'after'> {
  const index = repository.steps.findIndex((s) => s.step.id === id)
  const one = repository.steps[index]
  const before = repository.steps[index - 1]
  if (one === undefined) return { moment: 'waves', after: null }
  return {
    moment: one.moment,
    after: before !== undefined && before.moment === one.moment ? before.step.id : null,
  }
}

/**
 * Recommended: a step's dialog says where it stands, When and After, the same two fields a new
 * step is placed with; Save moves it. No gesture to learn, the keyboard path is the dialog's, and
 * a move across moments is as easy as one inside a moment.
 */
export function MoveInTheDialog({
  rules: initial,
  repository: path,
  id,
}: {
  rules: DeliveryRules
  repository: string
  id: string
}): ReactNode {
  const [rules, setRules] = useState(initial)
  const [open, setOpen] = useState<string | null>(id)
  const repository = rules.repositories.find((one) => one.path === path)
  const found = repository?.steps.find((one) => one.step.id === open)
  const [draft, setDraft] = useState<StepDraft>(() => {
    const one = repository?.steps.find((s) => s.step.id === id)
    const place = repository === undefined ? null : placeOf(repository, id)
    return {
      start: one?.step.start ?? 'auto',
      config: one?.step.config ?? { kind: 'ci' },
      moment: place?.moment,
      after: place?.after,
    }
  })
  const close = (): void => setOpen(null)
  const form =
    repository !== undefined && found !== undefined && open !== null
      ? {
          title: `${STEP_WORDS[found.step.config.kind]} · ${path}`,
          icon: <IconGitMerge size="sm" />,
          body: (
            <>
              <PlaceFields
                draft={draft}
                adding={{
                  kinds: [],
                  moments: true,
                  after: repository.steps
                    .filter((one) => one.step.id !== open)
                    .map((one) => ({
                      id: one.step.id,
                      label: STEP_WORDS[one.step.config.kind],
                      moment: one.moment,
                    })),
                }}
                onChange={setDraft}
              />
              <StepForm draft={draft} onChange={setDraft} commands={DELIVERY_COMMANDS} />
            </>
          ),
          footer: (
            <FormFoot
              onSave={() => {
                const after =
                  draft.after === undefined
                    ? (repository.steps
                        .filter(
                          (one) => one.moment === (draft.moment ?? 'waves') && one.step.id !== open,
                        )
                        .at(-1)?.step.id ?? null)
                    : draft.after
                setRules(
                  withRepository(rules, placed(repository, open, draft.moment ?? 'waves', after)),
                )
                close()
              }}
              onCancel={close}
            />
          ),
        }
      : null
  return (
    <GesturePage form={form} onCloseForm={close}>
      <SamePullRequests rules={rules} />
      <MovingWaves rules={rules} open={path} onStep={setOpen} />
      <SameEnd rules={rules} />
    </GesturePage>
  )
}

/** The waves, as the section draws them, one repository's step lines opening the step's dialog. */
function MovingWaves({
  rules,
  open,
  onStep,
  arrows,
}: {
  rules: DeliveryRules
  /** The repository unfolded, by path. */
  open: string
  onStep?: ((id: string) => void) | undefined
  /** With arrows on its lines: what a move does to the rules. */
  arrows?: ((next: DeliveryRepository) => void) | undefined
}): ReactNode {
  const byPath = new Map(rules.repositories.map((one) => [one.path, one]))
  return (
    <Frame>
      <h3 className={FRAME_BAND}>
        Waves <span className={QUIET_BAND}>· after Ship</span>
      </h3>
      {rules.waves.map((paths, index) => {
        const label = `Wave ${String(index + 1)}`
        return (
          <div key={label} className="flex flex-col border-b border-border last:border-b-0">
            <h4 className="flex h-control-sm items-center border-b border-border px-4 text-xs text-muted-foreground">
              {label}
            </h4>
            <ul aria-label={label} className="flex flex-col">
              {paths.map((path) => {
                const repository = byPath.get(path)
                if (repository === undefined) return null
                const after = upstreamOf(path, rules.dependencies)
                if (path === open && arrows !== undefined) {
                  return (
                    <ArrowedRepository
                      key={path}
                      repository={repository}
                      after={after}
                      onMove={arrows}
                    />
                  )
                }
                return (
                  <RepositoryRow
                    key={path}
                    repository={repository}
                    after={after}
                    initiallyOpen={path === open}
                    checking={false}
                    onOpen={(target) => {
                      if (target.kind === 'step' && target.repository === open) onStep?.(target.id)
                    }}
                    onPreset={nothing}
                    onPutBack={nothing}
                    onReset={nothing}
                    onCheckAgain={nothing}
                    onCopy={nothing}
                  />
                )
              })}
            </ul>
          </div>
        )
      })}
    </Frame>
  )
}

/** The room of the arrows at the end of a step's line: up, down, or nothing where it cannot go. */
function Arrows({
  recipe,
  up,
  down,
  onMove,
}: {
  recipe: RecipeStep
  up: boolean
  down: boolean
  onMove: (by: -1 | 1) => void
}): ReactNode {
  const name = STEP_WORDS[recipe.step.config.kind]
  return (
    <span className="flex shrink-0 items-center pr-2">
      <span className="flex size-control-sm items-center justify-center">
        {up && (
          <Tooltip label="Move up">
            <IconButton
              size="sm"
              variant="ghost"
              icon={<IconArrowUp size="sm" />}
              aria-label={`Move ${name} up`}
              onClick={() => onMove(-1)}
            />
          </Tooltip>
        )}
      </span>
      <span className="flex size-control-sm items-center justify-center">
        {down && (
          <Tooltip label="Move down">
            <IconButton
              size="sm"
              variant="ghost"
              icon={
                <span className="flex rotate-180">
                  <IconArrowUp size="sm" />
                </span>
              }
              aria-label={`Move ${name} down`}
              onClick={() => onMove(1)}
            />
          </Tooltip>
        )}
      </span>
    </span>
  )
}

/**
 * The alternative: each placed step's line ends with its arrows, Move up and Move down; at the
 * edge of a moment, a step moves into the moment beside it. A left-out step keeps its place, with
 * no arrows. The lines swap at once: rows are never slid into place (no position projection on
 * list rows), so a long move is many clicks.
 */
export function ArrowedRepository({
  repository,
  after,
  onMove,
}: {
  repository: DeliveryRepository
  after: readonly string[]
  onMove: (next: DeliveryRepository) => void
}): ReactNode {
  const [open, setOpen] = useState(true)
  const folding = useTransition(fold)
  const { path, forge } = repository
  // Up stops at the top of After each task, down at the bottom of After Ship.
  const ids = repository.steps.map((one) => one.step.id)
  const first = repository.steps[0]?.moment === 'tasks' ? ids[0] : undefined
  const last = repository.steps.at(-1)?.moment === 'waves' ? ids.at(-1) : undefined
  return (
    <li className={ITEM} data-repository={path}>
      <button
        type="button"
        className={cn(OPEN, 'pl-3')}
        aria-expanded={open}
        aria-label={`${path}, ${PRESET_WORDS[repository.preset]}, ${changesWords(changesOf(repository))}`}
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
          {changesWords(changesOf(repository))}
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block">
          {after.length === 0 ? '' : `after ${after.join(', ')}`}
        </span>
        <span className="ml-auto hidden min-w-0 shrink truncate font-mono text-xs text-muted-foreground lg:block">
          {`${repository.remote}/${repository.base}`}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          {forgeIcon(forge)}
        </span>
        <span className={ROOM}>
          <CliGlyph forge={forge} plain />
        </span>
        <span className={ROOM} />
      </button>
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
            <div className="flex min-w-0 items-center gap-3 border-b border-border py-2 pr-4 pl-10">
              <Select<Preset>
                label={`Preset of ${path}`}
                className="w-settings-name"
                value={repository.preset}
                onValueChange={nothing}
                items={PRESETS.map((preset) => ({ value: preset, label: PRESET_WORDS[preset] }))}
              />
            </div>
            {MOMENTS.map((moment) => {
              const steps = repository.steps.filter((one) => one.moment === moment)
              return (
                <Fragment key={moment}>
                  <RecipeHead label={MOMENT_WORDS[moment]} />
                  <ul aria-label={`Steps of ${path}${STEPS_OF[moment]}`} className="flex flex-col">
                    {steps.map((one) => {
                      const out = one.origin === 'omitted'
                      return (
                        <li key={one.step.id} className={cn(ITEM, 'flex min-w-0 items-center')}>
                          <ul className="min-w-0 flex-1">
                            <StepRow
                              recipe={one}
                              repository={repository}
                              onOpen={nothing}
                              onPutBack={nothing}
                              onReset={nothing}
                            />
                          </ul>
                          {out ? (
                            <span className="flex shrink-0 pr-2">
                              <span className="size-control-sm" />
                              <span className="size-control-sm" />
                            </span>
                          ) : (
                            <Arrows
                              recipe={one}
                              up={one.step.id !== first}
                              down={one.step.id !== last}
                              onMove={(by) => onMove(stepped(repository, one.step.id, by))}
                            />
                          )}
                        </li>
                      )
                    })}
                    {steps.length === 0 && (
                      <li className="py-2 pr-4 pl-10 text-sm text-muted-foreground">
                        {NOTHING[moment]}
                      </li>
                    )}
                  </ul>
                </Fragment>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

/** The page of the alternative: web unfolded, its lines with their arrows. */
export function MoveWithArrows({
  rules: initial,
  repository,
}: {
  rules: DeliveryRules
  repository: string
}): ReactNode {
  const [rules, setRules] = useState(initial)
  return (
    <GesturePage>
      <SamePullRequests rules={rules} />
      <MovingWaves
        rules={rules}
        open={repository}
        arrows={(next) => setRules(withRepository(rules, next))}
      />
      <SameEnd rules={rules} />
    </GesturePage>
  )
}
