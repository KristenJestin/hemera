import { cn } from 'cn'
import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Input, Textarea } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { IconChevronRight, IconFileText, IconGripVertical, IconPlus } from '../../icons.ts'
import { arrival, collapse, expand, fold, useTransition } from '../../motion.ts'
import { Section, SectionRefusal } from './parts.tsx'

/**
 * The documentation recipes of a Project, in its settings: the files the documenter keeps in line
 * with the code at the end of every Building, and what each is for.
 *
 * One line per recipe, in its order: where it is (a repository or the root), which files (a path
 * or a pattern, in the mono face), what they are for, and whether it always applies or only when
 * the Spec's Impact names one of its words — an interface contract is rewritten only when the
 * Spec touches it. A recipe is moved by its handle, with the pointer or the arrows; a line opens
 * its dialog.
 *
 * A Project with no recipe is offered what Hemera found in its main checkout — the readmes, a
 * docs folder, a contract — in the quiet tone, each with Accept; Accept all stands in the head.
 * Nothing is kept before it is accepted. What arrives or leaves grows and folds on `fold`.
 */
export interface SettingsDocRecipe {
  id: string
  /** The repository it names files in, by path; `.` for the main checkout's root. */
  place: string
  /** A path or a pattern, inside its repository. */
  path: string
  /** What the files are for, in one sentence: the documenter reads it. */
  purpose: string
  /** Null: it always applies. Otherwise the words the Spec's Impact must name for it to apply. */
  words: readonly string[] | null
}

/** Where a recipe is, as its line says it: `api`, `root`. */
export function placeOfRecipe(recipe: Pick<SettingsDocRecipe, 'place'>): string {
  return recipe.place === '.' ? 'root' : recipe.place
}

/** What names a recipe in a title or a button: `README.md in api`. */
export function recipeName(recipe: Pick<SettingsDocRecipe, 'place' | 'path'>): string {
  return `${recipe.path} in ${placeOfRecipe(recipe)}`
}

function wordsIn(recipe: Pick<SettingsDocRecipe, 'words'>): string[] {
  return (recipe.words ?? []).map((word) => word.trim()).filter((word) => word !== '')
}

/** When a recipe applies, in words. */
export function appliesOf(recipe: Pick<SettingsDocRecipe, 'words'>): string {
  const words = wordsIn(recipe)
  if (recipe.words === null) return 'always'
  const listed =
    words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words.at(-1) ?? ''}`
  return `when the Spec’s Impact names ${listed}`
}

const ROW = 'flex min-w-0 items-center gap-1 pl-2'

const HANDLE =
  'flex size-control-sm shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:tinted hover:text-foreground focus-ring hover-motion active:cursor-grabbing'

const NO_HANDLE = 'flex size-control-sm shrink-0'

const CELLS = 'flex min-h-control-lg min-w-0 flex-1 items-center gap-3 py-2 pr-4 pl-1 text-sm'

const OPEN = cn(CELLS, 'rounded-md text-left outline-none hover:tinted focus-ring hover-motion')

const HEAD = 'flex h-control-sm min-w-0 items-center gap-1 border-b border-border pl-2'

const HEAD_CELLS = 'flex min-w-0 flex-1 items-center gap-3 pr-4 pl-1 text-xs text-muted-foreground'

const ITEM = 'overflow-hidden border-b border-border bg-surface-body last:border-b-0'

const GLYPH = 'flex size-icon-md shrink-0 items-center justify-center text-muted-foreground'

const PLACE = 'w-16 min-w-0 shrink-0 truncate font-mono text-xs text-muted-foreground md:w-24'

/** On a phone the files take the line's room; wider, they keep their column. */
const FILES = 'min-w-0 flex-1 truncate font-mono text-xs md:w-settings-name md:flex-none'

const PURPOSE = 'hidden min-w-0 flex-1 truncate text-muted-foreground md:block'

const APPLIES =
  'hidden w-settings-name min-w-0 shrink-0 truncate text-xs text-muted-foreground lg:block'

const AFTER = 'flex shrink-0 items-center justify-end md:w-16'

const QUIET = 'text-muted-foreground'

const NOTE = 'max-w-measure text-xs text-muted-foreground'

/** The cells of a line after its handle, the same for a recipe and a proposal. */
function Cells({ recipe }: { recipe: SettingsDocRecipe }): ReactNode {
  const words = wordsIn(recipe)
  return (
    <>
      <span className={GLYPH}>
        <IconFileText size="sm" />
      </span>
      <span className={PLACE}>{placeOfRecipe(recipe)}</span>
      <span className={FILES}>{recipe.path}</span>
      <span className={PURPOSE}>{recipe.purpose}</span>
      <span className={APPLIES}>
        {recipe.words === null ? 'always' : `Impact names ${words.join(', ')}`}
      </span>
    </>
  )
}

/** Everything a line shows, in words, for a screen reader. */
function wordsOf(recipe: SettingsDocRecipe): string {
  return `${recipeName(recipe)}, ${recipe.purpose}, ${appliesOf(recipe)}`
}

export interface DocRecipeRowProps {
  recipe: SettingsDocRecipe
  first: boolean
  last: boolean
  onOpen: () => void
  onMove: (by: -1 | 1) => void
}

/** One recipe: its handle, and the line that opens it. */
export function DocRecipeRow({
  recipe,
  first,
  last,
  onOpen,
  onMove,
}: DocRecipeRowProps): ReactNode {
  const controls = useDragControls()
  const travel = useTransition(arrival)
  const folding = useTransition(fold)
  // A recipe grows in and folds out on `fold`, and makes room for another on `arrival`.
  const moving = { ...folding, layout: travel }
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
      value={recipe.id}
      dragListener={false}
      dragControls={controls}
      layout="position"
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={moving}
      className={ITEM}
      data-recipe={recipe.id}
    >
      <div className={ROW}>
        <button
          type="button"
          className={HANDLE}
          aria-label={`Move ${recipeName(recipe)}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onPointerDown={(event) => controls.start(event)}
          onKeyDown={onKeyDown}
        >
          <IconGripVertical size="sm" />
        </button>
        <button type="button" className={OPEN} aria-label={wordsOf(recipe)} onClick={onOpen}>
          <Cells recipe={recipe} />
          <span className={AFTER} aria-hidden="true">
            <span className="flex text-muted-foreground">
              <IconChevronRight size="sm" />
            </span>
          </span>
        </button>
      </div>
    </Reorder.Item>
  )
}

/** A recipe Hemera found: the same line, quiet, not kept, and Accept at its end. */
export function ProposedDocRecipeRow({
  recipe,
  onAccept,
}: {
  recipe: SettingsDocRecipe
  onAccept: () => void
}): ReactNode {
  const folding = useTransition(fold)
  return (
    <motion.li
      className={ITEM}
      data-proposal={recipe.id}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      <div className={ROW}>
        <span className={NO_HANDLE} />
        <div className={cn(CELLS, QUIET)}>
          <span className="sr-only">Proposed: {wordsOf(recipe)}</span>
          <span className="contents" aria-hidden="true">
            <Cells recipe={recipe} />
          </span>
          <span className={AFTER}>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Accept ${recipeName(recipe)}`}
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

/** The row's own shape while the recipes are on their way. */
export function DocRecipeRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={ITEM} data-row-skeleton="">
      <div className={ROW}>
        <span className={NO_HANDLE} />
        <span className={CELLS}>
          <span className={GLYPH}>
            <Skeleton shape="block">
              <IconFileText size="sm" />
            </Skeleton>
          </span>
          <span className={PLACE}>
            <Skeleton>root</Skeleton>
          </span>
          <span className={FILES}>
            <Skeleton>README.md</Skeleton>
          </span>
          <span className={PURPOSE}>
            <Skeleton>How to install and run</Skeleton>
          </span>
          <span className={APPLIES}>
            <Skeleton>always</Skeleton>
          </span>
          <span className={AFTER} />
        </span>
      </div>
    </li>
  )
}

function ColumnsHead(): ReactNode {
  return (
    <div className={HEAD}>
      <span className={NO_HANDLE} />
      <div className={HEAD_CELLS}>
        <span className={GLYPH} />
        <span className={cn(PLACE, 'font-sans')}>In</span>
        <span className={cn(FILES, 'font-sans')}>Files</span>
        <span className={PURPOSE}>Purpose</span>
        <span className={APPLIES}>Applies</span>
        <span className={AFTER} />
      </div>
    </div>
  )
}

export interface DocRecipesSectionProps {
  /** Null: the recipes are on their way. */
  recipes: readonly SettingsDocRecipe[] | null
  /** What Hemera found in the main checkout, not kept yet. */
  proposals?: readonly SettingsDocRecipe[] | undefined
  /** Why the recipes could not be read, in words. */
  error?: string | undefined
  onOpen: (id: string) => void
  onAdd: () => void
  /** Every recipe, by id, in its new order. */
  onReorder: (ids: string[]) => void
  onAccept: (id: string) => void
  onAcceptAll: () => void
}

export function DocRecipesSection({
  recipes,
  proposals = [],
  error,
  onOpen,
  onAdd,
  onReorder,
  onAccept,
  onAcceptAll,
}: DocRecipesSectionProps): ReactNode {
  const folding = useTransition(fold)
  const loading = recipes === null
  const kept = recipes ?? []
  const empty = !loading && kept.length === 0 && proposals.length === 0
  const ids = kept.map((recipe) => recipe.id)
  const move = (id: string, by: -1 | 1): void => {
    const from = ids.indexOf(id)
    const next = [...ids]
    next.splice(from, 1)
    next.splice(from + by, 0, id)
    onReorder(next)
  }
  const add = (
    <Button size="sm" onClick={onAdd}>
      <IconPlus size="sm" />
      Add a recipe
    </Button>
  )
  return (
    <Section label="Documentation">
      <SectionHead
        title="Documentation"
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
      {(error === undefined || !empty) && (
        <Frame>
          {empty ? (
            <Empty
              face="asleep"
              title="No recipe yet"
              description="The documenter keeps in line only the files a recipe names."
              action={add}
            />
          ) : (
            <>
              <ColumnsHead />
              {loading ? (
                <ul aria-label="Recipes" aria-busy="true" className="flex flex-col">
                  <DocRecipeRowSkeleton />
                  <DocRecipeRowSkeleton />
                  <DocRecipeRowSkeleton />
                </ul>
              ) : (
                <AnimatePresence initial={false}>
                  {kept.length > 0 && (
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
                        aria-label="Recipes"
                        className="flex flex-col"
                      >
                        <AnimatePresence initial={false}>
                          {kept.map((recipe, index) => (
                            <DocRecipeRow
                              key={recipe.id}
                              recipe={recipe}
                              first={index === 0}
                              last={index === kept.length - 1}
                              onOpen={() => onOpen(recipe.id)}
                              onMove={(by) => move(recipe.id, by)}
                            />
                          ))}
                        </AnimatePresence>
                      </Reorder.Group>
                    </motion.div>
                  )}
                  {proposals.length > 0 && (
                    <motion.ul
                      key="proposed"
                      aria-label="Proposed recipes"
                      className="flex flex-col overflow-hidden border-t border-border first:border-t-0"
                      initial={collapse}
                      animate={expand}
                      exit={collapse}
                      transition={folding}
                    >
                      <AnimatePresence initial={false}>
                        {proposals.map((proposal) => (
                          <ProposedDocRecipeRow
                            key={proposal.id}
                            recipe={proposal}
                            onAccept={() => onAccept(proposal.id)}
                          />
                        ))}
                      </AnimatePresence>
                    </motion.ul>
                  )}
                </AnimatePresence>
              )}
            </>
          )}
        </Frame>
      )}
      <p className={NOTE}>
        {proposals.length > 0 &&
          'Hemera found these in the main checkout. Nothing is kept until you accept it. '}
        Missions already running keep the recipes they were launched with.
      </p>
    </Section>
  )
}

/** What the dialog of a recipe writes. */
export type DocRecipeDraft = Omit<SettingsDocRecipe, 'id'>

/** A recipe not written yet: at the root, always. */
export const NEW_DOC_RECIPE: DocRecipeDraft = { place: '.', path: '', purpose: '', words: null }

/** What the engine refuses of a draft, in its words, at the field each concerns. */
export interface DocRecipeRefusals {
  path?: string | undefined
  purpose?: string | undefined
  words?: string | undefined
}

export interface DocRecipeFormProps {
  draft: DocRecipeDraft
  onChange: (draft: DocRecipeDraft) => void
  /** The repositories it may name files in, by path. */
  places: readonly string[]
  refusals: DocRecipeRefusals
}

const LABEL = 'text-sm font-medium'

/** The form of a recipe: where, which files, what for, and when it applies. */
export function DocRecipeForm({
  draft,
  onChange,
  places,
  refusals,
}: DocRecipeFormProps): ReactNode {
  const folding = useTransition(fold)
  const set = (part: Partial<DocRecipeDraft>): void => onChange({ ...draft, ...part })
  return (
    <>
      <div className="flex items-start gap-3">
        <div className="flex w-settings-name shrink-0 flex-col gap-1">
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
        <Input
          label="Files"
          className="min-w-0 flex-1"
          value={draft.path}
          placeholder="docs/**/*.md"
          error={refusals.path}
          onValueChange={(path) => set({ path })}
        />
      </div>
      <Textarea
        label="Purpose"
        rows={2}
        value={draft.purpose}
        placeholder="How to install and run"
        error={refusals.purpose}
        onValueChange={(purpose) => set({ purpose })}
      />
      <div className="flex flex-col gap-1">
        <span className={LABEL} aria-hidden="true">
          Applies
        </span>
        <Select<'always' | 'named'>
          label="Applies"
          className="w-full"
          value={draft.words === null ? 'always' : 'named'}
          onValueChange={(applies) => set({ words: applies === 'always' ? null : [] })}
          items={[
            { value: 'always', label: 'Always' },
            { value: 'named', label: 'When the Spec’s Impact names a word' },
          ]}
        />
        <AnimatePresence initial={false}>
          {draft.words !== null && (
            <motion.div
              key="words"
              className="overflow-hidden"
              initial={collapse}
              animate={expand}
              exit={collapse}
              transition={folding}
            >
              <div className="pt-2">
                <Input
                  label="Words"
                  value={draft.words.map((word) => word.trim()).join(', ')}
                  placeholder="API, contract, schema"
                  error={refusals.words}
                  onValueChange={(words) => set({ words: words.split(',') })}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
