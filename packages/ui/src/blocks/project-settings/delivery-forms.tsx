import { cn } from 'cn'
// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'

import { IconButton } from '../../components/button/button.tsx'
import { Input, Textarea } from '../../components/field/field.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { Select } from '../../components/select/select.tsx'
import { IconBraces, IconPlus, IconSearch, IconWorld, IconX } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import {
  type ForgeKind,
  FORGE_WORDS,
  MERGE_WORDS,
  type MergeMethod,
  type PublishedBy,
  type PushPlacement,
  type Reviewer,
  STEP_WORDS,
  type StepConfig,
  type StepKind,
  type StepStart,
  TEMPLATE_VARIABLES,
  type WhoCommits,
  writesToNetwork,
} from './delivery-model.ts'
import { COMMITS, START_ITEMS, newStep } from './delivery-form-options.ts'

/**
 * The dialogs of the delivery rules: where the push and the pull requests stand, a template, the
 * reviewers, who commits, a repository's remote, base and forge, and a step. Each is the body of
 * the settings' dialog; its foot is the section's `FormFoot`.
 */

const LABEL = 'text-sm font-medium'

/** A select with its visible label above it, as the other forms of the settings have them. */
function Labelled<Value extends string>({
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
 * The reviewers asked on each pull request: those chosen, each with its ×, then a search over
 * everyone the forge offers — a long list is found by its name, never scrolled through.
 */
export function ReviewersForm({
  chosen,
  candidates,
  onChange,
}: {
  chosen: readonly Reviewer[]
  candidates: readonly Reviewer[]
  onChange: (chosen: Reviewer[]) => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const taken = new Set(chosen.map((one) => one.handle))
  const words = query.trim().toLowerCase()
  const found = candidates.filter(
    (one) =>
      !taken.has(one.handle) &&
      words !== '' &&
      `${one.handle} ${one.name ?? ''}`.toLowerCase().includes(words),
  )
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
      <Input
        label="Add a reviewer"
        icon={<IconSearch size="sm" />}
        placeholder="A name, a handle or a team"
        value={query}
        onValueChange={setQuery}
      />
      {words !== '' && (
        <ul
          aria-label="Reviewers found"
          className="flex flex-col overflow-hidden rounded-md border border-border"
        >
          {found.length === 0 && (
            <li className={cn(PERSON, 'text-muted-foreground')}>
              Nobody on the forge matches “{query.trim()}”.
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
                onClick={() => {
                  onChange([...chosen, one])
                  setQuery('')
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

const CHOICE =
  'flex w-full min-w-0 items-start gap-3 rounded-md border border-border px-3 py-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion aria-checked:border-primary aria-checked:bg-primary-muted'

const RADIO =
  'mt-0.5 flex size-icon-sm shrink-0 items-center justify-center rounded-full border border-input'

const DOT = 'size-1.5 rounded-full bg-primary'

/**
 * Who commits during Building, as three choices, each with what it does, and under them what the
 * history of a repository reads after an example mission: the visible effect of the choice.
 * Whatever is chosen, every attempt is kept by Hemera, and the commits carry the user's own Git
 * identity.
 */
export function CommitsForm({
  value,
  histories,
  onChange,
}: {
  value: WhoCommits
  /** What the history reads after ACME-12, for each value. */
  histories: Readonly<Record<WhoCommits, readonly string[]>>
  onChange: (value: WhoCommits) => void
}): ReactNode {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const choose = (index: number): void => {
    const next = COMMITS[(index + COMMITS.length) % COMMITS.length]
    if (next === undefined) return
    onChange(next.value)
    refs.current[COMMITS.indexOf(next)]?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      choose(index + 1)
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      choose(index - 1)
    }
  }
  const history = histories[value]
  return (
    <>
      <div role="radiogroup" aria-label="Who commits" className="flex flex-col gap-2">
        {COMMITS.map((one, index) => {
          const chosen = one.value === value
          return (
            <button
              key={one.value}
              ref={(element) => {
                refs.current[index] = element
              }}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen ? 0 : -1}
              className={CHOICE}
              onClick={() => onChange(one.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span className={RADIO} aria-hidden="true">
                {chosen && <span className={DOT} />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{one.label}</span>
                <span className="text-xs text-muted-foreground">{one.effect}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          After ACME-12, the history of api reads
        </span>
        <ol
          aria-label="History of api after ACME-12"
          className="flex flex-col rounded-md border border-border bg-surface-rim px-3 py-2 font-mono text-xs"
        >
          {history.map((line) => (
            <li key={line} className="truncate">
              {line}
            </li>
          ))}
        </ol>
      </div>
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
  /** For a new step: the step it comes after, by id. */
  after?: string | undefined
}

export interface StepFormProps {
  draft: StepDraft
  onChange: (draft: StepDraft) => void
  /** For a new step: the kinds offered, and the steps it may come after. */
  adding?:
    | { kinds: readonly StepKind[]; after: readonly { id: string; label: string }[] }
    | undefined
  /** The catalogue commands a Bump or a Command may run. */
  commands: readonly string[]
  /** What the engine refuses of the step, at the field it concerns. */
  refused?: string | undefined
}

/** A step: its kind when it is new, where it goes, how it starts, and the fields of its kind. */
export function StepForm({ draft, onChange, adding, commands, refused }: StepFormProps): ReactNode {
  const { config } = draft
  const set = (next: StepConfig): void => onChange({ ...draft, config: next })
  const commandItems = commands.map((one) => ({ value: one, label: one }))
  return (
    <>
      {adding !== undefined && (
        <div className="flex items-start gap-3">
          <Labelled<StepKind>
            label="Kind"
            value={config.kind}
            onChange={(kind) => set(newStep(kind))}
            items={adding.kinds.map((kind) => ({ value: kind, label: STEP_WORDS[kind] }))}
          />
          {adding.after.length > 0 && (
            <Labelled<string>
              label="After"
              value={draft.after ?? adding.after.at(-1)?.id ?? ''}
              onChange={(after) => onChange({ ...draft, after })}
              items={adding.after.map((one) => ({ value: one.id, label: one.label }))}
            />
          )}
        </div>
      )}
      {config.kind === 'bump' && (
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
      )}
      {config.kind === 'merge' && (
        <Labelled<MergeMethod>
          label="Method"
          value={config.method}
          onChange={(method) => set({ ...config, method })}
          items={(['squash', 'merge', 'rebase'] as const).map((method) => ({
            value: method,
            label: MERGE_WORDS[method],
          }))}
        />
      )}
      {config.kind === 'remote-action' && (
        <Input
          label="Workflow or pipeline"
          placeholder="release.yml"
          value={config.action}
          error={refused}
          onValueChange={(action) => set({ ...config, action })}
        />
      )}
      {config.kind === 'published' && (
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
      )}
      {config.kind === 'command' && (
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
      )}
      {config.kind === 'agent' && (
        <Textarea
          label="Task"
          rows={3}
          value={config.task}
          error={refused}
          onValueChange={(task) => set({ ...config, task })}
        />
      )}
      {config.kind === 'confirm' && (
        <Input
          label="What you confirm"
          placeholder="The release is announced"
          value={config.what}
          error={refused}
          onValueChange={(what) => set({ ...config, what })}
        />
      )}
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
