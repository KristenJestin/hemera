import { cn } from 'cn'
import { type ReactNode, useEffect, useId, useRef } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconBan,
  IconBolt,
  IconChecklist,
  IconCopy,
  IconFolder,
  IconGitBranch,
  IconHandStop,
  IconLink,
  IconListNumbers,
  IconPlus,
  IconSearch,
  IconTerminal,
  IconVariable,
  IconWorld,
  IconX,
} from '../../icons.ts'
import { type CommandType, typeIcon } from '../project-settings/command-types.tsx'
import { KIND_WORDS, type StepKind } from '../project-settings/recipe.tsx'
import { MASK } from '../project-settings/variables.tsx'

/**
 * What the setup agent proposes for a new Project, one kind per card: the repositories, the
 * commands with their roles, the preparation recipe, the variables, and the commands never to
 * run. Each kind is drawn here twice — in short, as the card shows it, and as the lines of its
 * inline editor — and once more as its skeleton while the agent is still reading.
 *
 * In short means one line per thing, in the faces the settings use for it: a path or a line in
 * the mono face, a value always masked, a role as its glyph. A repository the agent found deeper
 * in the folder than Hemera looked carries the search glyph, with its legend.
 */
export type SetupKind = 'repositories' | 'commands' | 'preparation' | 'variables' | 'never'

export const SETUP_KINDS: readonly SetupKind[] = [
  'repositories',
  'commands',
  'preparation',
  'variables',
  'never',
]

export const SETUP_TITLES: Record<SetupKind, string> = {
  repositories: 'Repositories',
  commands: 'Commands',
  preparation: 'Preparation',
  variables: 'Variables',
  never: 'Never run',
}

export function setupIcon(kind: SetupKind): ReactNode {
  switch (kind) {
    case 'repositories':
      return <IconGitBranch size="sm" />
    case 'commands':
      return <IconTerminal size="sm" />
    case 'preparation':
      return <IconListNumbers size="sm" />
    case 'variables':
      return <IconVariable size="sm" />
    case 'never':
      return <IconBan size="sm" />
  }
}

export interface ProposedRepository {
  id: string
  /** Its path in the folder; `.` for the folder itself. */
  path: string
  /** What its work starts from: `origin/main`. */
  base: string
  /** Found by the agent deeper than Hemera looked when the folder was chosen. */
  found?: boolean | undefined
}

export interface ProposedCommand {
  id: string
  name: string
  type: CommandType
  line: string
  check: boolean
  service: boolean
  atOpen: boolean
  ask: boolean
}

export interface ProposedStep {
  id: string
  kind: StepKind
  /** The repository it applies under; `.` for the root. */
  place: string
  /** What a copy or a link places, or the line a run runs. */
  what: string
}

export interface ProposedVariable {
  id: string
  key: string
  /** The value, which the card never shows; the editor writes over it. */
  value: string
}

export interface ProposedNever {
  id: string
  line: string
}

export type Proposal =
  | { readonly kind: 'repositories'; readonly items: readonly ProposedRepository[] }
  | { readonly kind: 'commands'; readonly items: readonly ProposedCommand[] }
  | { readonly kind: 'preparation'; readonly items: readonly ProposedStep[] }
  | { readonly kind: 'variables'; readonly items: readonly ProposedVariable[] }
  | { readonly kind: 'never'; readonly items: readonly ProposedNever[] }

const LIST = 'flex flex-col'

const RULE = 'border-b border-border last:border-b-0'

const ROW = 'flex min-h-control-md min-w-0 items-center gap-3 px-3 py-1.5 text-sm'

const GLYPH = 'flex shrink-0 text-muted-foreground'

const MONO = 'min-w-0 truncate font-mono text-xs'

const QUIET_MONO = 'ml-auto min-w-0 shrink truncate font-mono text-xs text-muted-foreground'

const NAME = 'w-24 min-w-0 shrink-0 truncate font-medium'

const NUMBER = 'w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums'

const ROLES = 'ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground'

function stepIcon(kind: StepKind): ReactNode {
  if (kind === 'copy') return <IconCopy size="sm" />
  if (kind === 'link') return <IconLink size="sm" />
  return <IconTerminal size="sm" />
}

/** The roles of a proposed command, in words, for a screen reader. */
function rolesOf(command: ProposedCommand): string[] {
  return [
    command.check ? 'a check' : null,
    command.service ? 'a service' : null,
    command.atOpen ? 'runs at each opening' : null,
    command.ask ? 'asks before running' : null,
  ].filter((role) => role !== null)
}

/** A command's roles as glyphs, in the order of the catalogue's columns. */
function RoleGlyphs({ command }: { command: ProposedCommand }): ReactNode {
  const roles = rolesOf(command)
  return (
    <>
      <span className={ROLES} aria-hidden="true">
        {command.check && <IconChecklist size="sm" />}
        {command.service && <IconWorld size="sm" />}
        {command.atOpen && <IconBolt size="sm" />}
        {command.ask && <IconHandStop size="sm" />}
      </span>
      {roles.length > 0 && <span className="sr-only">, {roles.join(', ')}</span>}
    </>
  )
}

/** The proposal in short: one line per thing. */
export function ProposalSummary({ proposal }: { proposal: Proposal }): ReactNode {
  const label = SETUP_TITLES[proposal.kind]
  switch (proposal.kind) {
    case 'repositories':
      return (
        <ul aria-label={`Proposed ${label.toLowerCase()}`} className={LIST}>
          {proposal.items.map((repository) => (
            <li key={repository.id} className={RULE} data-proposed={repository.path}>
              <span className={ROW}>
                <span className={GLYPH} aria-hidden="true">
                  <IconFolder size="sm" />
                </span>
                <span className={MONO}>{repository.path}</span>
                {repository.found === true && (
                  <Legend label="Found by the setup agent, deeper than Hemera looked">
                    <span className="inline-flex text-primary-muted-foreground" aria-hidden="true">
                      <IconSearch size="sm" />
                    </span>
                  </Legend>
                )}
                <span className={QUIET_MONO}>{repository.base}</span>
              </span>
            </li>
          ))}
        </ul>
      )
    case 'commands':
      return (
        <ul aria-label={`Proposed ${label.toLowerCase()}`} className={LIST}>
          {proposal.items.map((command) => (
            <li key={command.id} className={RULE} data-proposed={command.name}>
              <span className={ROW}>
                <span className={GLYPH} aria-hidden="true">
                  {typeIcon(command.type)}
                </span>
                <span className={NAME}>{command.name}</span>
                <span className={cn(MONO, 'flex-1 text-muted-foreground')}>{command.line}</span>
                <RoleGlyphs command={command} />
              </span>
            </li>
          ))}
        </ul>
      )
    case 'preparation':
      return (
        <ol aria-label={`Proposed ${label.toLowerCase()}`} className={LIST}>
          {proposal.items.map((step, at) => (
            <li key={step.id} className={RULE} data-proposed={step.what}>
              <span className={ROW}>
                <span className={NUMBER}>{at + 1}</span>
                <span className="flex w-16 shrink-0 items-center gap-2 text-muted-foreground">
                  <span className="flex" aria-hidden="true">
                    {stepIcon(step.kind)}
                  </span>
                  {KIND_WORDS[step.kind]}
                </span>
                <span className={MONO}>{step.what}</span>
                <span className={QUIET_MONO}>{step.place === '.' ? 'root' : step.place}</span>
              </span>
            </li>
          ))}
        </ol>
      )
    case 'variables':
      return (
        <ul aria-label={`Proposed ${label.toLowerCase()}`} className={LIST}>
          {proposal.items.map((variable) => (
            <li key={variable.id} className={RULE} data-proposed={variable.key}>
              <span className={ROW}>
                <span className={cn(MONO, 'w-settings-name shrink-0 font-medium')}>
                  {variable.key}
                </span>
                <span className="min-w-0 truncate font-mono text-xs tracking-widest text-muted-foreground">
                  <span aria-hidden="true">{MASK}</span>
                  <span className="sr-only">masked</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )
    case 'never':
      return (
        <ul aria-label={`Proposed ${label.toLowerCase()}`} className={LIST}>
          {proposal.items.map((never) => (
            <li key={never.id} className={RULE} data-proposed={never.line}>
              <span className={ROW}>
                <span className={GLYPH} aria-hidden="true">
                  <IconBan size="sm" />
                </span>
                <span className={MONO}>{never.line}</span>
              </span>
            </li>
          ))}
        </ul>
      )
  }
}

/** What a line of each kind most likely holds, so its skeleton has a line's length. */
const LIKELY: Record<SetupKind, string> = {
  repositories: 'services/billing',
  commands: 'pnpm --filter api test',
  preparation: 'pnpm install --frozen-lockfile',
  variables: 'DATABASE_URL',
  never: 'git push --force',
}

/** The proposal's own shape while the agent is still reading: three lines of its kind. */
export function ProposalSkeleton({ kind }: { kind: SetupKind }): ReactNode {
  return (
    <ul aria-hidden="true" className={LIST}>
      {[0, 1, 2].map((at) => (
        <li key={at} className={RULE} data-row-skeleton="">
          <span className={ROW}>
            <span className={GLYPH}>
              <Skeleton shape="block">{setupIcon(kind)}</Skeleton>
            </span>
            <span className={MONO}>
              <Skeleton>{LIKELY[kind]}</Skeleton>
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// --- The inline editor --------------------------------------------------------------------------

const FIELD =
  'h-control-sm w-full min-w-0 rounded-md border border-input bg-input-fill px-2 text-sm outline-none focus-ring'

/** A field of a line: its label for a screen reader, the column header naming it for the eye. */
function LineField({
  label,
  value,
  onChange,
  mono = false,
  secret = false,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  mono?: boolean | undefined
  secret?: boolean | undefined
  placeholder?: string | undefined
}): ReactNode {
  const id = useId()
  return (
    <span className="flex min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type={secret ? 'password' : 'text'}
        className={cn(FIELD, mono && 'font-mono text-xs')}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  )
}

interface EditorField {
  label: string
  value: string
  mono?: boolean | undefined
  secret?: boolean | undefined
  placeholder?: string | undefined
}

interface EditorLine {
  id: string
  /** What the line is called, for its × and its fields: `api`, `DATABASE_URL`. */
  name: string
  fields: readonly EditorField[]
}

const EDIT_ROW = 'flex min-w-0 items-center gap-2 px-3 py-1.5'

/** The lines of a proposal as fields, each line with its ×, and a line added at the foot. */
function EditLines({
  lines,
  onField,
  onRemove,
  onAdd,
  add,
}: {
  lines: readonly EditorLine[]
  onField: (line: number, field: number, value: string) => void
  onRemove: (line: number) => void
  onAdd: () => void
  /** What the button at the foot says: `Add a command`. */
  add: string
}): ReactNode {
  // Edit was pressed to write: the caret goes to the first field, once, as the editor opens.
  const editor = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    editor.current?.querySelector('input')?.focus()
  }, [])
  return (
    <div ref={editor} className="flex flex-col py-1.5" data-editor="">
      <ul className={LIST}>
        {lines.map((line, at) => (
          <li key={line.id} className={EDIT_ROW}>
            {line.fields.map((field, index) => (
              <LineField
                key={field.label}
                label={`${field.label} of ${line.name === '' ? `line ${String(at + 1)}` : line.name}`}
                value={field.value}
                mono={field.mono}
                secret={field.secret}
                placeholder={field.placeholder}
                onChange={(value) => onField(at, index, value)}
              />
            ))}
            <Tooltip label="Remove">
              <IconButton
                variant="ghost"
                size="sm"
                icon={<IconX size="sm" />}
                aria-label={`Remove ${line.name === '' ? `line ${String(at + 1)}` : line.name}`}
                onClick={() => onRemove(at)}
              />
            </Tooltip>
          </li>
        ))}
      </ul>
      <span className="flex px-3 pt-1">
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <IconPlus size="sm" />
          {add}
        </Button>
      </span>
    </div>
  )
}

/** A fresh id for a line added in the editor. */
function freshId(): string {
  return `added-${crypto.randomUUID()}`
}

export interface ProposalEditorProps {
  draft: Proposal
  onChange: (draft: Proposal) => void
}

/**
 * The proposal as lines of fields, in the card: what each line says is written in place, a line
 * removed by its ×, a line added at the foot. A variable's value is written over, never shown.
 */
export function ProposalEditor({ draft, onChange }: ProposalEditorProps): ReactNode {
  switch (draft.kind) {
    case 'repositories': {
      const items = draft.items
      const set = (next: readonly ProposedRepository[]): void =>
        onChange({ kind: draft.kind, items: next })
      return (
        <EditLines
          add="Add a repository"
          lines={items.map((one) => ({
            id: one.id,
            name: one.path,
            fields: [
              { label: 'Path', value: one.path, mono: true, placeholder: 'services/billing' },
              { label: 'Base', value: one.base, mono: true, placeholder: 'origin/main' },
            ],
          }))}
          onField={(line, field, value) =>
            set(
              items.map((one, at) =>
                at !== line ? one : field === 0 ? { ...one, path: value } : { ...one, base: value },
              ),
            )
          }
          onRemove={(line) => set(items.filter((_, at) => at !== line))}
          onAdd={() => set([...items, { id: freshId(), path: '', base: 'origin/main' }])}
        />
      )
    }
    case 'commands': {
      const items = draft.items
      const set = (next: readonly ProposedCommand[]): void =>
        onChange({ kind: draft.kind, items: next })
      return (
        <EditLines
          add="Add a command"
          lines={items.map((one) => ({
            id: one.id,
            name: one.name,
            fields: [
              { label: 'Name', value: one.name, placeholder: 'test' },
              { label: 'Line', value: one.line, mono: true, placeholder: 'pnpm test' },
            ],
          }))}
          onField={(line, field, value) =>
            set(
              items.map((one, at) =>
                at !== line ? one : field === 0 ? { ...one, name: value } : { ...one, line: value },
              ),
            )
          }
          onRemove={(line) => set(items.filter((_, at) => at !== line))}
          onAdd={() =>
            set([
              ...items,
              {
                id: freshId(),
                name: '',
                type: 'script',
                line: '',
                check: false,
                service: false,
                atOpen: false,
                ask: false,
              },
            ])
          }
        />
      )
    }
    case 'preparation': {
      const items = draft.items
      const set = (next: readonly ProposedStep[]): void =>
        onChange({ kind: draft.kind, items: next })
      return (
        <EditLines
          add="Add a step"
          lines={items.map((one, at) => ({
            id: one.id,
            name: `step ${String(at + 1)}`,
            fields: [{ label: KIND_WORDS[one.kind], value: one.what, mono: true }],
          }))}
          onField={(line, _field, value) =>
            set(items.map((one, at) => (at === line ? { ...one, what: value } : one)))
          }
          onRemove={(line) => set(items.filter((_, at) => at !== line))}
          onAdd={() => set([...items, { id: freshId(), kind: 'run', place: '.', what: '' }])}
        />
      )
    }
    case 'variables': {
      const items = draft.items
      const set = (next: readonly ProposedVariable[]): void =>
        onChange({ kind: draft.kind, items: next })
      return (
        <EditLines
          add="Add a variable"
          lines={items.map((one) => ({
            id: one.id,
            name: one.key,
            fields: [
              { label: 'Name', value: one.key, mono: true, placeholder: 'DATABASE_URL' },
              { label: 'Value', value: one.value, mono: true, secret: true },
            ],
          }))}
          onField={(line, field, value) =>
            set(
              items.map((one, at) =>
                at !== line ? one : field === 0 ? { ...one, key: value } : { ...one, value },
              ),
            )
          }
          onRemove={(line) => set(items.filter((_, at) => at !== line))}
          onAdd={() => set([...items, { id: freshId(), key: '', value: '' }])}
        />
      )
    }
    case 'never': {
      const items = draft.items
      const set = (next: readonly ProposedNever[]): void =>
        onChange({ kind: draft.kind, items: next })
      return (
        <EditLines
          add="Add a command"
          lines={items.map((one) => ({
            id: one.id,
            name: one.line,
            fields: [
              { label: 'Command', value: one.line, mono: true, placeholder: 'git push --force' },
            ],
          }))}
          onField={(line, _field, value) =>
            set(items.map((one, at) => (at === line ? { ...one, line: value } : one)))
          }
          onRemove={(line) => set(items.filter((_, at) => at !== line))}
          onAdd={() => set([...items, { id: freshId(), line: '' }])}
        />
      )
    }
  }
}
