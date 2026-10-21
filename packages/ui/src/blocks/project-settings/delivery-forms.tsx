import { cn } from 'cn'
// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Input, Textarea } from '../../components/field/field.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { Select } from '../../components/select/select.tsx'
import {
  IconAlertTriangle,
  IconBraces,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconWorld,
  IconX,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import {
  type ForgeKind,
  FORGE_WORDS,
  MERGE_WORDS,
  type MergeMethod,
  MOMENT_WORDS,
  MOMENTS,
  type Moment,
  type PublishedBy,
  type PushPlacement,
  type Reviewer,
  STEP_WORDS,
  type StepConfig,
  type StepKind,
  type StepStart,
  TEMPLATE_VARIABLES,
  writesToNetwork,
} from './delivery-model.ts'
import { START_ITEMS, newStep } from './delivery-form-options.ts'
import { FixCommand } from './provider-forms.tsx'

/**
 * The dialogs of the delivery rules: where the push and the pull requests stand, a template, the
 * reviewers, a repository's remote, base and forge, and a step. Each is the body of
 * the settings' dialog; its foot is the section's `FormFoot`.
 */

const LABEL = 'text-sm font-medium'

/** A select with its visible label above it, as the other forms of the settings have them. */
export function Labelled<Value extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: Value
  items: { value: Value; label: string }[]
  onChange: (value: Value) => void
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={LABEL} aria-hidden="true">
        {label}
      </span>
      <Select<Value>
        label={label}
        className="w-full"
        value={value}
        onValueChange={onChange}
        items={items}
      />
    </div>
  )
}

export interface PushDraft {
  placement: PushPlacement
  start: StepStart
}

/** Where the step that pushes and opens the pull requests stands, and how it starts. */
export function PushForm({
  draft,
  onChange,
}: {
  draft: PushDraft
  onChange: (draft: PushDraft) => void
}): ReactNode {
  return (
    <div className="flex items-start gap-3">
      <Labelled<PushPlacement>
        label="Opens"
        value={draft.placement}
        onChange={(placement) => onChange({ ...draft, placement })}
        items={[
          { value: 'review', label: 'When Review starts' },
          { value: 'waves', label: 'After Ship, in each wave' },
        ]}
      />
      <Labelled<StepStart>
        label="Starts"
        value={draft.start}
        onChange={(start) => onChange({ ...draft, start })}
        items={START_ITEMS}
      />
    </div>
  )
}

export interface TemplateFormProps {
  /** What the template writes: `Commit message`. */
  label: string
  value: string
  /** A body runs over several lines; a commit or a title is one. */
  multiline: boolean
  /** The refusal of what is typed, in the engine's words. */
  refused?: string | undefined
  /** The template as an example mission fills it. */
  example: string
  onChange: (value: string) => void
}

/**
 * A template: its field, the names Hemera fills offered by the braces under it, and what it reads
 * once an example mission fills it. A name Hemera does not fill is refused as it is typed.
 */
export function TemplateForm({
  label,
  value,
  multiline,
  refused,
  example,
  onChange,
}: TemplateFormProps): ReactNode {
  const insert = (name: string): void => onChange(`${value}${name}`)
  return (
    <>
      {multiline ? (
        <Textarea label={label} rows={8} value={value} error={refused} onValueChange={onChange} />
      ) : (
        <Input label={label} value={value} error={refused} onValueChange={onChange} />
      )}
      <div className="flex items-center gap-2">
        <Menu
          label={`Insert a name in ${label}`}
          icon={<IconBraces size="sm" />}
          groups={[
            TEMPLATE_VARIABLES.map((one) => ({
              label: one.name,
              detail: one.filled,
              onSelect: () => insert(one.name),
            })),
          ]}
        />
        <span className="text-xs text-muted-foreground">Insert a name Hemera fills</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">For ACME-12, it reads</span>
        <pre
          aria-label={`${label} for ACME-12`}
          className="max-h-dialog overflow-auto rounded-md border border-border bg-surface-rim px-3 py-2 font-mono text-xs whitespace-pre-wrap"
        >
          {example}
        </pre>
      </div>
    </>
  )
}

const PERSON =
  'flex min-h-control-md min-w-0 items-center gap-2 border-b border-border px-3 text-sm last:border-b-0'

function who(reviewer: Reviewer): ReactNode {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="truncate">{reviewer.name ?? reviewer.handle}</span>
      {reviewer.name !== undefined && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{reviewer.handle}</span>
      )}
    </span>
  )
}

/**
 * Where the forge's list of who reviews stands while the dialog is open: read, being read, or
 * not to be read, with the trouble in words, the command that fixes it and Check again.
 */
export type ReviewersListing =
  | { readonly state: 'ready' }
  | { readonly state: 'reading' }
  | {
      readonly state: 'cannot'
      readonly sentence: string
      readonly fix?: string | undefined
      readonly onCheckAgain: () => void
      readonly onCopy: (line: string) => void
    }

/** The forge's list cannot be read: its trouble, its command, Check again. */
function CannotList({
  listing,
}: {
  listing: Extract<ReviewersListing, { state: 'cannot' }>
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-rim p-3">
      <p className="flex items-start gap-2 text-sm">
        <span className="flex shrink-0 pt-0.5 text-warning">
          <IconAlertTriangle size="sm" aria-hidden="true" />
        </span>
        <span className="max-w-measure">{listing.sentence}</span>
      </p>
      {listing.fix !== undefined && <FixCommand line={listing.fix} onCopy={listing.onCopy} />}
      <div>
        <Button size="sm" onClick={listing.onCheckAgain}>
          <IconRefresh size="sm" />
          Check again
        </Button>
      </div>
    </div>
  )
}

/**
 * The reviewers asked on each pull request: those chosen, each with its ×, then a search over
 * everyone the forge offers — a long list is found by its name, never scrolled through. The list
 * is the forge's, read as the dialog opens: while it is read, what is typed waits under rows of
 * the shape to come; when it cannot be read, a handle typed is added as it is.
 */
export function ReviewersForm({
  chosen,
  candidates,
  listing = { state: 'ready' },
  onChange,
}: {
  chosen: readonly Reviewer[]
  candidates: readonly Reviewer[]
  listing?: ReviewersListing | undefined
  onChange: (chosen: Reviewer[]) => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const taken = new Set(chosen.map((one) => one.handle))
  const typed = query.trim()
  const words = typed.toLowerCase()
  const found = candidates.filter(
    (one) =>
      !taken.has(one.handle) &&
      words !== '' &&
      `${one.handle} ${one.name ?? ''}`.toLowerCase().includes(words),
  )
  const add = (one: Reviewer): void => {
    onChange([...chosen, one])
    setQuery('')
  }
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className={LABEL}>
          Chosen <span className="font-normal text-muted-foreground">{chosen.length}</span>
        </span>
        <ul
          aria-label="Chosen reviewers"
          className="flex max-h-dialog flex-col overflow-auto rounded-md border border-border"
        >
          {chosen.length === 0 && (
            <li className={cn(PERSON, 'text-muted-foreground')}>Nobody: no review is asked.</li>
          )}
          {chosen.map((one) => (
            <li key={one.handle} className={PERSON}>
              {who(one)}
              <IconButton
                size="sm"
                variant="ghost"
                icon={<IconX size="sm" />}
                aria-label={`Remove ${one.name ?? one.handle}`}
                onClick={() => onChange(chosen.filter((other) => other.handle !== one.handle))}
              />
            </li>
          ))}
        </ul>
      </div>
      {listing.state === 'cannot' && <CannotList listing={listing} />}
      <Input
        label="Add a reviewer"
        icon={<IconSearch size="sm" />}
        placeholder={
          listing.state === 'cannot' ? 'A handle or a team' : 'A name, a handle or a team'
        }
        value={query}
        onValueChange={setQuery}
      />
      {words !== '' && listing.state === 'reading' && (
        <ul
          aria-label="Reviewers found"
          aria-busy="true"
          className="flex flex-col overflow-hidden rounded-md border border-border"
        >
          {['Mira Okafor', 'Tomas Lindqvist', '@acme/platform'].map((one) => (
            <li key={one} aria-hidden="true" className={PERSON}>
              <Skeleton>{one}</Skeleton>
            </li>
          ))}
        </ul>
      )}
      {words !== '' && listing.state === 'cannot' && (
        <ul
          aria-label="Reviewers found"
          className="flex flex-col overflow-hidden rounded-md border border-border"
        >
          <li className={PERSON}>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{typed}</span>
            <span className="text-xs text-muted-foreground">as typed</span>
            <IconButton
              size="sm"
              variant="ghost"
              icon={<IconPlus size="sm" />}
              aria-label={`Add ${typed} as typed`}
              disabled={taken.has(typed)}
              onClick={() => add({ handle: typed })}
            />
          </li>
        </ul>
      )}
      {words !== '' && listing.state === 'ready' && (
        <ul
          aria-label="Reviewers found"
          className="flex flex-col overflow-hidden rounded-md border border-border"
        >
          {found.length === 0 && (
            <li className={cn(PERSON, 'text-muted-foreground')}>
              Nobody on the forge matches “{typed}”.
            </li>
          )}
          {found.slice(0, 6).map((one) => (
            <li key={one.handle} className={PERSON}>
              {who(one)}
              <IconButton
                size="sm"
                variant="ghost"
                icon={<IconPlus size="sm" />}
                aria-label={`Add ${one.name ?? one.handle}`}
                onClick={() => add(one)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export interface RepositoryDraft {
  remote: string
  base: string
  /** Null: the forge Hemera reads from the remote. */
  forced: Exclude<ForgeKind, 'none'> | null
  host: string
}

/** A repository's remote, base branch and forge: read from the remote, or forced. */
export function RepositoryForm({
  draft,
  remotes,
  detected,
  refusals,
  onChange,
}: {
  draft: RepositoryDraft
  remotes: readonly string[]
  /** The forge Hemera reads from the remote's address. */
  detected: ForgeKind
  refusals: { base?: string | undefined; host?: string | undefined }
  onChange: (draft: RepositoryDraft) => void
}): ReactNode {
  const folding = useTransition(fold)
  return (
    <>
      <div className="flex items-start gap-3">
        <Labelled<string>
          label="Remote"
          value={draft.remote}
          onChange={(remote) => onChange({ ...draft, remote })}
          items={remotes.map((one) => ({ value: one, label: one }))}
        />
        <Input
          label="Base branch"
          className="min-w-0 flex-1"
          value={draft.base}
          error={refusals.base}
          onValueChange={(base) => onChange({ ...draft, base })}
        />
      </div>
      <Labelled<'detected' | Exclude<ForgeKind, 'none'>>
        label="Forge"
        value={draft.forced ?? 'detected'}
        onChange={(forge) => onChange({ ...draft, forced: forge === 'detected' ? null : forge })}
        items={[
          { value: 'detected', label: `${FORGE_WORDS[detected]}, read from the remote` },
          { value: 'github', label: FORGE_WORDS.github },
          { value: 'bitbucket-cloud', label: FORGE_WORDS['bitbucket-cloud'] },
          { value: 'bitbucket-dc', label: FORGE_WORDS['bitbucket-dc'] },
        ]}
      />
      <AnimatePresence initial={false}>
        {draft.forced === 'bitbucket-dc' && (
          <motion.div
            key="host"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <Input
              label="Host"
              placeholder="bitbucket.example.test"
              value={draft.host}
              error={refusals.host}
              onValueChange={(host) => onChange({ ...draft, host })}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export interface StepDraft {
  start: StepStart
  config: StepConfig
  /** For a new step of a recipe: the moment it runs in. */
  moment?: Moment | undefined
  /** For a new step: the step it comes after, by id; null for first in its moment. */
  after?: string | null | undefined
}

/** A step a new one may come after, and the moment it stands in. */
export interface StepAnchor {
  id: string
  label: string
  moment?: Moment | undefined
}

export interface StepFormProps {
  draft: StepDraft
  onChange: (draft: StepDraft) => void
  /**
   * For a new step: the kinds offered, the steps it may come after, and whether it chooses its
   * moment (a recipe's step does; the cleanup has one moment).
   */
  adding?:
    | { kinds: readonly StepKind[]; after: readonly StepAnchor[]; moments?: boolean | undefined }
    | undefined
  /**
   * For a step already placed: the steps it may come after, each in its moment. Its dialog then
   * says where it stands, When and After, as a new step's does, and Save moves it there.
   */
  placing?: readonly StepAnchor[] | undefined
  /** The catalogue commands a Bump or a Command may run. */
  commands: readonly string[]
  /** What the engine refuses of the step, at the field it concerns. */
  refused?: string | undefined
}

/** The fields of a bump: how the version is moved, and the catalogue command when it is one. */
function BumpFields({
  config,
  set,
  commandItems,
}: {
  config: Extract<StepConfig, { kind: 'bump' }>
  set: (next: StepConfig) => void
  commandItems: { value: string; label: string }[]
}): ReactNode {
  return (
    <div className="flex items-start gap-3">
      <Labelled<'command' | 'agent'>
        label="Moved by"
        value={config.how}
        onChange={(how) => set({ ...config, how })}
        items={[
          { value: 'command', label: 'A catalogue command' },
          { value: 'agent', label: 'The agent' },
        ]}
      />
      {config.how === 'command' && (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={LABEL} aria-hidden="true">
            Command
          </span>
          <Select<string>
            label="Command"
            className="w-full"
            value={config.command}
            placeholder="Choose a command"
            onValueChange={(command) => set({ ...config, command })}
            items={commandItems}
          />
        </div>
      )}
    </div>
  )
}

/** The fields of a published step: how the version is found, and the tag or package it looks for. */
function PublishedFields({
  config,
  set,
  refused,
}: {
  config: Extract<StepConfig, { kind: 'published' }>
  set: (next: StepConfig) => void
  refused: string | undefined
}): ReactNode {
  return (
    <div className="flex items-start gap-3">
      <Labelled<PublishedBy>
        label="Found by"
        value={config.by}
        onChange={(by) => set({ ...config, by })}
        items={[
          { value: 'tag', label: 'A tag' },
          { value: 'registry', label: 'The version on a registry' },
          { value: 'confirm', label: 'Your confirmation' },
        ]}
      />
      {config.by !== 'confirm' && (
        <Input
          label={config.by === 'tag' ? 'Tag pattern' : 'Package'}
          className="min-w-0 flex-1"
          placeholder={config.by === 'tag' ? 'v*' : '@acme/shared'}
          value={config.pattern}
          error={refused}
          onValueChange={(pattern) => set({ ...config, pattern })}
        />
      )}
    </div>
  )
}

/** The fields of a step's own kind, whichever it is. */
function KindFields({
  config,
  set,
  commandItems,
  refused,
}: {
  config: StepConfig
  set: (next: StepConfig) => void
  commandItems: { value: string; label: string }[]
  refused: string | undefined
}): ReactNode {
  switch (config.kind) {
    case 'bump':
      return <BumpFields config={config} set={set} commandItems={commandItems} />
    case 'merge':
      return (
        <Labelled<MergeMethod>
          label="Method"
          value={config.method}
          onChange={(method) => set({ ...config, method })}
          items={(['squash', 'merge', 'rebase'] as const).map((method) => ({
            value: method,
            label: MERGE_WORDS[method],
          }))}
        />
      )
    case 'remote-action':
      return (
        <>
          <Input
            label="Workflow or pipeline"
            placeholder="release.yml"
            value={config.action}
            error={refused}
            onValueChange={(action) => set({ ...config, action })}
          />
          <Textarea
            label="Inputs"
            rows={2}
            description="A workflow's inputs, one name=value a line."
            value={config.inputs ?? ''}
            onValueChange={(inputs) => set({ ...config, inputs })}
          />
        </>
      )
    case 'approve-deployment':
      return (
        <Input
          label="Environment"
          placeholder="production"
          description="Hemera approves the deployment waiting on it, as you: your account must be one of its reviewers on the forge."
          value={config.environment}
          error={refused}
          onValueChange={(environment) => set({ ...config, environment })}
        />
      )
    case 'published':
      return <PublishedFields config={config} set={set} refused={refused} />
    case 'command':
      return (
        <div className="flex flex-col gap-1">
          <span className={LABEL} aria-hidden="true">
            Command
          </span>
          <Select<string>
            label="Command"
            className="w-full"
            value={config.command === '' ? null : config.command}
            placeholder="Choose a command"
            onValueChange={(command) => set({ ...config, command })}
            items={commandItems}
          />
        </div>
      )
    case 'agent':
      return (
        <Textarea
          label="Task"
          rows={3}
          value={config.task}
          error={refused}
          onValueChange={(task) => set({ ...config, task })}
        />
      )
    case 'confirm':
      return (
        <Input
          label="What you confirm"
          placeholder="The release is announced"
          value={config.what}
          error={refused}
          onValueChange={(what) => set({ ...config, what })}
        />
      )
    // The commits, the push, the pull request, CI, the local merge and the cleanup's own steps
    // have nothing to write but how they start.
    default:
      return null
  }
}

/** The value of First in the After select: no step id holds a colon. */
const FIRST = ':first'

/** Where a new step goes: its moment when it has one to choose, and the step it follows there. */
export function PlaceFields({
  draft,
  adding,
  onChange,
}: {
  draft: StepDraft
  adding: NonNullable<StepFormProps['adding']>
  onChange: (draft: StepDraft) => void
}): ReactNode {
  const moment = draft.moment ?? 'waves'
  const anchors =
    adding.moments === true
      ? adding.after.filter((one) => (one.moment ?? 'waves') === moment)
      : adding.after
  const after = draft.after === undefined ? (anchors.at(-1)?.id ?? FIRST) : (draft.after ?? FIRST)
  return (
    <div className="flex items-start gap-3">
      {adding.moments === true && (
        <Labelled<Moment>
          label="When"
          value={moment}
          onChange={(next) => onChange({ ...draft, moment: next, after: undefined })}
          items={MOMENTS.map((one) => ({ value: one, label: MOMENT_WORDS[one] }))}
        />
      )}
      {(adding.moments === true || anchors.length > 0) && (
        <Labelled<string>
          label="After"
          value={after}
          onChange={(next) => onChange({ ...draft, after: next === FIRST ? null : next })}
          items={[
            ...(adding.moments === true ? [{ value: FIRST, label: 'First' }] : []),
            ...anchors.map((one) => ({ value: one.id, label: one.label })),
          ]}
        />
      )}
    </div>
  )
}

/** A step: its kind when it is new, where it goes, how it starts, and the fields of its kind. */
export function StepForm({
  draft,
  onChange,
  adding,
  placing,
  commands,
  refused,
}: StepFormProps): ReactNode {
  const { config } = draft
  const set = (next: StepConfig): void => onChange({ ...draft, config: next })
  const commandItems = commands.map((one) => ({ value: one, label: one }))
  return (
    <>
      {adding !== undefined && (
        <>
          <Labelled<StepKind>
            label="Kind"
            value={config.kind}
            onChange={(kind) => set(newStep(kind))}
            items={adding.kinds.map((kind) => ({ value: kind, label: STEP_WORDS[kind] }))}
          />
          <PlaceFields draft={draft} adding={adding} onChange={onChange} />
        </>
      )}
      {adding === undefined && placing !== undefined && (
        <PlaceFields
          draft={draft}
          adding={{ kinds: [], moments: true, after: placing }}
          onChange={onChange}
        />
      )}
      <KindFields config={config} set={set} commandItems={commandItems} refused={refused} />
      {writesToNetwork(config) && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconWorld size="sm" aria-hidden="true" />
          May write to the network: Hemera runs it as the Project wrote it.
        </p>
      )}
      <Labelled<StepStart>
        label="Starts"
        value={draft.start}
        onChange={(start) => onChange({ ...draft, start })}
        items={START_ITEMS}
      />
    </>
  )
}
