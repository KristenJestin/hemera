import { SectionHead } from '../../components/section-head/section-head.tsx'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Input, Textarea } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Select } from '../../components/select/select.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconBolt,
  IconBraces,
  IconChecklist,
  IconChevronRight,
  IconDeviceDesktop,
  IconHandStop,
  IconLock,
  IconPencil,
  IconPlus,
  IconWorld,
} from '../../icons.ts'
import { CommandLineField } from './command-line.tsx'
import { type CommandType, typeIcon, TYPE_WORDS, COMMAND_TYPES } from './command-types.tsx'
import { Section } from './parts.tsx'

/**
 * A Project's command catalogue, in its settings: every command on one line, and what it may be
 * used for read down columns.
 *
 * A line is the command's type as its icon, its name, its line in the mono face — with a mark when
 * Windows or Linux run a line of their own — and where it runs. Then its roles, each in a column of
 * its own, so a catalogue of twenty reads as a table: a check, a service, run at each opening, ask
 * before running, and what it may write — nothing, or the files it names. A role a command does not
 * have leaves its column empty. The columns are named once, at their head, by their glyphs, each
 * with its legend; a line says its roles in words to a screen reader.
 *
 * Pressing a line opens its form. There, a line holding shell syntax is refused as it is typed,
 * the token named: Hemera runs a command without a shell.
 */
export { COMMAND_TYPES, TYPE_WORDS, typeIcon }
export type { CommandType }

/** Where a service runs: once per Workspace, or once for the Project in its main checkout. */
export type ServiceScope = 'workspace' | 'project'

export interface SettingsCommand {
  id: string
  name: string
  type: CommandType
  /** The line every system runs, unless it has its own. */
  line: string
  lineLinux: string | null
  lineWindows: string | null
  /** The repository it runs under, by path; `.` for the main checkout's root. */
  place: string
  /** The folder under it; null for the repository itself. */
  folder: string | null
  /** For a service. */
  scope: ServiceScope
  check: boolean
  atOpen: boolean
  askBeforeRunning: boolean
  readOnly: boolean
  /** What it may write, relative to its folder. */
  writeGlobs: readonly string[]
}

/** Where a command runs, as a line says it: `api`, `api/e2e`, `root`. */
export function placeOf(command: Pick<SettingsCommand, 'place' | 'folder'>): string {
  const place = command.place === '.' ? 'root' : command.place
  return command.folder === null ? place : `${place}/${command.folder}`
}

/** The globs a command may write, without the empty lines of a field still being typed in. */
export function globsOf(command: Pick<SettingsCommand, 'writeGlobs'>): string[] {
  return command.writeGlobs.filter((glob) => glob.trim() !== '')
}

/** The roles of a command, in words, in the order of the columns. */
export function rolesOf(command: SettingsCommand): string[] {
  return [
    command.check ? 'a check' : null,
    command.type === 'serve'
      ? command.scope === 'project'
        ? 'a service of the main checkout'
        : 'a service of each Workspace'
      : null,
    command.atOpen ? 'runs at each opening' : null,
    command.askBeforeRunning ? 'asks before running' : null,
    command.readOnly
      ? 'writes nothing'
      : globsOf(command).length > 0
        ? `writes ${globsOf(command).join(', ')}`
        : null,
  ].filter((role) => role !== null)
}

/** The columns of the roles, by what each one's glyph means. */
const COLUMNS = [
  { key: 'check', legend: 'Used as a check', icon: <IconChecklist size="sm" /> },
  { key: 'service', legend: 'Service, with its address', icon: <IconWorld size="sm" /> },
  { key: 'open', legend: 'Runs at each opening', icon: <IconBolt size="sm" /> },
  { key: 'ask', legend: 'Asks before running', icon: <IconHandStop size="sm" /> },
  { key: 'files', legend: 'What it may write', icon: <IconPencil size="sm" /> },
] as const

const RULE = 'border-b border-border last:border-b-0'

const LINE =
  'flex h-control-lg w-full min-w-0 items-center gap-3 rounded-md px-4 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const STILL = 'flex h-control-lg w-full min-w-0 items-center gap-3 px-4 text-sm'

/** The head of the columns: the same line, in the quiet tone, its glyphs named. */
const HEAD = 'flex h-control-sm w-full min-w-0 items-center gap-3 border-b border-border px-4'

const TYPE = 'flex size-icon-md shrink-0 items-center justify-center text-muted-foreground'

const NAME = 'w-settings-name min-w-0 shrink-0 truncate font-medium'

const COMMAND_LINE = 'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'

const PLACE = 'w-24 min-w-0 shrink-0 truncate font-mono text-xs text-muted-foreground'

const HEAD_WORD = 'text-xs text-muted-foreground'

/** One room per role, held whether its glyph is drawn or not, so the columns line up. */
const ROOM = 'flex size-icon-md shrink-0 items-center justify-center'

const ROLES = 'flex shrink-0 items-center gap-2'

const ROLE_ON = 'flex text-foreground'

const READ_ONLY = 'flex text-muted-foreground'

const CHEVRON = 'flex shrink-0 text-muted-foreground'

/** The glyph a command shows in each column, or null for an empty room. */
function glyphsOf(command: SettingsCommand): readonly (ReactNode | null)[] {
  return [
    command.check ? <IconChecklist key="check" size="sm" /> : null,
    command.type === 'serve' ? <IconWorld key="service" size="sm" /> : null,
    command.atOpen ? <IconBolt key="open" size="sm" /> : null,
    command.askBeforeRunning ? <IconHandStop key="ask" size="sm" /> : null,
    command.readOnly ? (
      <span key="files" className={READ_ONLY}>
        <IconLock size="sm" />
      </span>
    ) : globsOf(command).length > 0 ? (
      <IconPencil key="files" size="sm" />
    ) : null,
  ]
}

export interface CommandRowProps {
  command: SettingsCommand
  onOpen: () => void
}

/** One command on one line. */
export function CommandRow({ command, onOpen }: CommandRowProps): ReactNode {
  const roles = rolesOf(command)
  const ownLines = command.lineLinux !== null || command.lineWindows !== null
  return (
    <li className={RULE} data-command={command.name}>
      <button type="button" className={LINE} onClick={onOpen}>
        <span className={TYPE} aria-hidden="true">
          {typeIcon(command.type)}
        </span>
        <span className={NAME}>{command.name}</span>
        <span className="sr-only">, {TYPE_WORDS[command.type]}</span>
        <span className={COMMAND_LINE}>{command.line}</span>
        <span className={ROOM} aria-hidden="true">
          {ownLines && (
            <span className="flex text-muted-foreground" data-own-lines="">
              <IconDeviceDesktop size="sm" />
            </span>
          )}
        </span>
        <span className={PLACE}>{placeOf(command)}</span>
        <span className={ROLES} aria-hidden="true">
          {glyphsOf(command).map((glyph, at) => (
            <span key={COLUMNS[at]?.key} className={ROOM} data-column={COLUMNS[at]?.key}>
              {glyph !== null && <span className={ROLE_ON}>{glyph}</span>}
            </span>
          ))}
        </span>
        {roles.length > 0 && <span className="sr-only">, {roles.join(', ')}</span>}
        <span className={CHEVRON} aria-hidden="true">
          <IconChevronRight size="sm" />
        </span>
      </button>
    </li>
  )
}

/** What a row on its way most likely holds. */
const LIKELY = { name: 'typecheck', line: 'pnpm --filter api typecheck', place: 'api' }

/** The row's own shape while the catalogue is on its way. */
export function CommandRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <span className={STILL}>
        <span className={TYPE}>
          <Skeleton shape="block">
            <IconBraces size="sm" />
          </Skeleton>
        </span>
        <span className={NAME}>
          <Skeleton>{LIKELY.name}</Skeleton>
        </span>
        <span className={COMMAND_LINE}>
          <Skeleton>{LIKELY.line}</Skeleton>
        </span>
        <span className={ROOM} />
        <span className={PLACE}>
          <Skeleton>{LIKELY.place}</Skeleton>
        </span>
        <span className={ROLES}>
          {COLUMNS.map((column) => (
            <span key={column.key} className={ROOM} />
          ))}
        </span>
        <span className={cn(CHEVRON, 'size-icon-sm')} />
      </span>
    </li>
  )
}

/** The head of the columns: the words of the text columns, the glyphs of the roles, each named. */
function ColumnsHead(): ReactNode {
  return (
    <div className={HEAD}>
      <span className={TYPE} />
      <span className={cn(NAME, HEAD_WORD, 'font-normal')}>Name</span>
      <span className={cn('min-w-0 flex-1', HEAD_WORD)}>Line</span>
      <span className={ROOM}>
        <Legend label="Its own line on Linux or Windows">
          <span className="flex text-muted-foreground">
            <IconDeviceDesktop size="sm" />
          </span>
        </Legend>
      </span>
      <span className={cn(PLACE, 'font-sans')}>Runs in</span>
      <span className={ROLES}>
        {COLUMNS.map((column) => (
          <span key={column.key} className={ROOM}>
            <Legend label={column.legend}>
              <span className="flex text-muted-foreground">{column.icon}</span>
            </Legend>
          </span>
        ))}
      </span>
      <span className={cn(CHEVRON, 'size-icon-sm')} />
    </div>
  )
}

export interface CommandsSectionProps {
  commands: readonly SettingsCommand[]
  loading?: boolean | undefined
  onOpen: (id: string) => void
  onAdd: () => void
}

export function CommandsSection({
  commands,
  loading = false,
  onOpen,
  onAdd,
}: CommandsSectionProps): ReactNode {
  const add = (
    <Button size="sm" onClick={onAdd}>
      <IconPlus size="sm" />
      Add a command
    </Button>
  )
  const empty = !loading && commands.length === 0
  return (
    <Section label="Commands">
      <SectionHead
        title="Commands"
        count={loading || empty ? undefined : commands.length}
        actions={loading || empty ? undefined : add}
      />
      <Frame>
        {empty ? (
          <Empty face="asleep" title="No command yet" action={add} />
        ) : (
          <>
            <ColumnsHead />
            <ul aria-label="Commands" aria-busy={loading} className="flex flex-col">
              {loading ? (
                <>
                  <CommandRowSkeleton />
                  <CommandRowSkeleton />
                  <CommandRowSkeleton />
                  <CommandRowSkeleton />
                </>
              ) : (
                commands.map((command) => (
                  <CommandRow
                    key={command.id}
                    command={command}
                    onOpen={() => onOpen(command.id)}
                  />
                ))
              )}
            </ul>
          </>
        )}
      </Frame>
    </Section>
  )
}

/** What the form of a command writes. */
export type CommandDraft = Omit<SettingsCommand, 'id'>

/** A command not written yet: a script, at the root, with no role. */
export const NEW_COMMAND: CommandDraft = {
  name: '',
  type: 'script',
  line: '',
  lineLinux: null,
  lineWindows: null,
  place: '.',
  folder: null,
  scope: 'workspace',
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
}

export interface CommandFormProps {
  draft: CommandDraft
  onChange: (draft: CommandDraft) => void
  /** The repositories it may run under, by path. */
  places: readonly string[]
  /** What the engine refuses in a line, in words, the token named; undefined for nothing. */
  refusalOf: (line: string) => string | undefined
  nameError?: string | undefined
  globsError?: string | undefined
}

const GROUP = 'flex flex-col gap-3'

const GROUP_TITLE = 'text-sm font-medium'

/** The form of a command: everything it is and may do. */
export function CommandForm({
  draft,
  onChange,
  places,
  refusalOf,
  nameError,
  globsError,
}: CommandFormProps): ReactNode {
  const set = (part: Partial<CommandDraft>): void => onChange({ ...draft, ...part })
  return (
    <>
      <Input
        label="Name"
        value={draft.name}
        error={nameError}
        onValueChange={(name) => set({ name })}
      />
      <div className="flex flex-col gap-1">
        <span className={GROUP_TITLE} aria-hidden="true">
          Type
        </span>
        <Select
          label="Type"
          className="w-full"
          value={draft.type}
          mark={<span className="flex text-muted-foreground">{typeIcon(draft.type)}</span>}
          onValueChange={(type) => set({ type })}
          items={COMMAND_TYPES.map((type) => ({
            value: type,
            label: TYPE_WORDS[type],
            icon: <span className="flex text-muted-foreground">{typeIcon(type)}</span>,
          }))}
        />
      </div>
      <CommandLineField
        value={{
          command: null,
          line: draft.line,
          lineLinux: draft.lineLinux,
          lineWindows: draft.lineWindows,
        }}
        onChange={({ line, lineLinux, lineWindows }) => set({ line, lineLinux, lineWindows })}
        refusalOf={refusalOf}
      />
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={GROUP_TITLE} aria-hidden="true">
            Runs in
          </span>
          <Select
            label="Runs in"
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
          label="Folder"
          className="min-w-0 flex-1"
          value={draft.folder ?? ''}
          placeholder="."
          onValueChange={(folder) => set({ folder: folder === '' ? null : folder })}
        />
      </div>
      {draft.type === 'serve' && (
        <div className="flex flex-col gap-1">
          <span className={GROUP_TITLE} aria-hidden="true">
            Runs
          </span>
          <Select
            label="Runs"
            className="w-full"
            value={draft.scope}
            onValueChange={(scope) => set({ scope })}
            items={[
              { value: 'workspace', label: 'Once per Workspace' },
              { value: 'project', label: 'Once, in the main checkout' },
            ]}
          />
        </div>
      )}
      <fieldset className={GROUP}>
        <legend className={cn(GROUP_TITLE, 'pb-3')}>Roles</legend>
        <Checkbox
          checked={draft.check}
          onCheckedChange={(check) => set({ check })}
          label="Used as a check"
        />
        <Checkbox
          checked={draft.atOpen}
          onCheckedChange={(atOpen) => set({ atOpen })}
          label="Runs at each opening"
        />
        <Checkbox
          checked={draft.askBeforeRunning}
          onCheckedChange={(askBeforeRunning) => set({ askBeforeRunning })}
          label="Asks before running"
        />
      </fieldset>
      <fieldset className={GROUP}>
        <legend className={cn(GROUP_TITLE, 'pb-3')}>Files</legend>
        <Checkbox
          checked={draft.readOnly}
          onCheckedChange={(readOnly) => set({ readOnly })}
          label="Writes nothing"
        />
        {!draft.readOnly && (
          <Textarea
            label="Files it may write"
            rows={2}
            placeholder="dist/**"
            value={draft.writeGlobs.join('\n')}
            error={globsError}
            onValueChange={(globs) => set({ writeGlobs: globs.split('\n') })}
          />
        )}
      </fieldset>
    </>
  )
}
