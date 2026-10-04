import { SectionHead } from '../../components/section-head/section-head.tsx'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import {
  MARK_ICONS,
  MARK_ICON_WORDS,
  type MarkIcon,
  markIcon,
} from '../../components/project-mark/project-mark.tsx'
import { Select } from '../../components/select/select.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconChevronRight,
  IconCloudDownload,
  IconFolder,
  IconFolderOpen,
  IconGitBranch,
  IconPlus,
  IconStack2,
} from '../../icons.ts'
import { Section } from './parts.tsx'

/**
 * The repositories of a Project, in its settings: each on one line, what Hemera reads of it and
 * what the user chose for it.
 *
 * A line is the box that says whether new Workspaces take the repository, its icon — chosen in
 * its form, a folder until it is — and its path in the main checkout in the mono face, and what its work starts from — the remote and the base branch,
 * `origin/main` — with when that base was last fetched. A base not fetched for a while says so in
 * the warning tone; a repository Git cannot read says Git's own reason where its base would be,
 * in the destructive tone. Pressing the line opens its form, where all of it is written.
 *
 * The box is beside the line and not in it: it is a control of its own, and the line is the other
 * one. Rows on their way are the row's own shape.
 */

/** When the base of a repository was last fetched, as the settings say it. */
export type BaseFreshness =
  /** Fetched, and when: `09:02`, `yesterday`. */
  | { readonly kind: 'fetched'; readonly when: string }
  /** The last fetch failed or is old: since when, and Git's reason when there is one. */
  | { readonly kind: 'old'; readonly since: string; readonly reason?: string | undefined }
  /** Never fetched. */
  | { readonly kind: 'never' }
  /** No remote: the base is a branch of the repository itself. */
  | { readonly kind: 'local' }

export interface SettingsRepository {
  id: string
  /** Its path in the main checkout, `.` for the main checkout itself. */
  path: string
  includedByDefault: boolean
  /** The remote its base comes from; null when it has none. */
  remote: string | null
  baseBranch: string
  freshness: BaseFreshness
  /** Git's own words when the repository cannot be read. */
  unreadable?: string | undefined
  /** The icon it wears before its path, chosen in its form; a folder until one is. */
  icon?: MarkIcon | undefined
}

/** The icon a repository wears: the one chosen, or a folder. */
function iconOf(icon: MarkIcon | undefined): ReactNode {
  return icon === undefined ? <IconFolder size="sm" /> : markIcon(icon)
}

/** How the base's freshness is said, in a few words. */
export function freshnessWords(freshness: BaseFreshness): string {
  switch (freshness.kind) {
    case 'fetched':
      return `fetched ${freshness.when}`
    case 'old':
      return `not fetched since ${freshness.since}`
    case 'never':
      return 'never fetched'
    case 'local':
      return 'no remote'
  }
}

/** The base, as a line says it: `origin/main`, or the branch alone without a remote. */
export function baseOf(repository: Pick<SettingsRepository, 'remote' | 'baseBranch'>): string {
  return repository.remote === null
    ? repository.baseBranch
    : `${repository.remote}/${repository.baseBranch}`
}

const ROW = 'flex min-w-0 items-center gap-3 pl-4'

const RULE = 'border-b border-border last:border-b-0'

/** The line itself, the part that opens the repository's dialog. */
const OPEN =
  'flex min-h-control-lg min-w-0 flex-1 items-center gap-4 rounded-md py-2 pr-3 pl-1 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const STILL = 'flex min-h-control-lg min-w-0 flex-1 items-center gap-4 py-2 pr-3 pl-1 text-sm'

const PATH = 'flex w-settings-name min-w-0 shrink-0 items-center gap-2 font-mono font-medium'

const BASE = 'flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground'

const FRESH = 'ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground'

const STALE = 'ml-auto flex shrink-0 items-center gap-1.5 text-xs text-warning-muted-foreground'

const UNREADABLE =
  'flex min-w-0 flex-1 items-center gap-1.5 text-xs text-destructive-muted-foreground'

const CHEVRON = 'flex shrink-0 text-muted-foreground'

const ICON_ROOM = 'flex size-icon-md shrink-0 items-center justify-center text-muted-foreground'

/** The head of the columns, in the quiet tone; the box's column is named by its glyph. */
const HEAD = 'flex h-control-sm min-w-0 items-center gap-3 border-b border-border pl-4'

const HEAD_LINE = 'flex min-w-0 flex-1 items-center gap-4 pr-3 pl-1 text-xs text-muted-foreground'

function ColumnsHead(): ReactNode {
  return (
    <div className={HEAD}>
      <span className={ICON_ROOM}>
        <Legend label="Included in new Workspaces">
          <IconStack2 size="sm" />
        </Legend>
      </span>
      <span className={HEAD_LINE}>
        <span className="w-settings-name shrink-0">Path</span>
        <span>Base</span>
        <span className="ml-auto">Fetched</span>
        <span className="flex size-icon-sm shrink-0" />
      </span>
    </div>
  )
}

/** What a row on its way most likely holds, so its skeleton has a row's length. */
const LIKELY: SettingsRepository = {
  id: 'likely',
  path: 'shared',
  includedByDefault: true,
  remote: 'origin',
  baseBranch: 'develop',
  freshness: { kind: 'fetched', when: '09:02' },
}

export interface RepositoryRowProps {
  repository: SettingsRepository
  onInclude: (included: boolean) => void
  onOpen: () => void
}

/** One repository, on one line: the box, then the line that opens its form. */
export function RepositoryRow({ repository, onInclude, onOpen }: RepositoryRowProps): ReactNode {
  const { path, freshness, unreadable } = repository
  return (
    <li className={RULE} data-repository={path}>
      <div className={ROW}>
        <Checkbox
          checked={repository.includedByDefault}
          onCheckedChange={onInclude}
          label={<span className="sr-only">Include {path} in new Workspaces</span>}
        />
        <button type="button" className={OPEN} onClick={onOpen}>
          <span className={PATH}>
            <span className={ICON_ROOM}>{iconOf(repository.icon)}</span>
            <span className="truncate">{path}</span>
          </span>
          {unreadable === undefined ? (
            <>
              <span className={BASE}>
                <IconGitBranch size="sm" aria-hidden="true" />
                <span className="truncate">{baseOf(repository)}</span>
              </span>
              <span className={freshness.kind === 'old' ? STALE : FRESH}>
                {freshness.kind === 'old' && <IconCloudDownload size="sm" aria-hidden="true" />}
                {freshnessWords(freshness)}
              </span>
            </>
          ) : (
            <span className={UNREADABLE} data-unreadable="">
              <span className="flex shrink-0 text-destructive">
                <IconAlertTriangle size="sm" aria-hidden="true" />
              </span>
              <span className="truncate">{unreadable}</span>
            </span>
          )}
          <span className={CHEVRON} aria-hidden="true">
            <IconChevronRight size="sm" />
          </span>
        </button>
      </div>
    </li>
  )
}

/** The row's own shape while the repositories are on their way. */
export function RepositoryRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <div className={ROW}>
        <Skeleton shape="block">
          <span className="flex size-icon-md" />
        </Skeleton>
        <span className={STILL}>
          <span className={PATH}>
            <span className={ICON_ROOM}>
              <Skeleton shape="block">
                <IconFolder size="sm" />
              </Skeleton>
            </span>
            <Skeleton>{LIKELY.path}</Skeleton>
          </span>
          <span className={BASE}>
            <Skeleton>{`  ${baseOf(LIKELY)}`}</Skeleton>
          </span>
          <span className={FRESH}>
            <Skeleton>{freshnessWords(LIKELY.freshness)}</Skeleton>
          </span>
          <span className={cn(CHEVRON, 'size-icon-sm')} />
        </span>
      </div>
    </li>
  )
}

export interface RepositoriesSectionProps {
  repositories: readonly SettingsRepository[]
  loading?: boolean | undefined
  onInclude: (id: string, included: boolean) => void
  onOpen: (id: string) => void
  onAdd: () => void
  /** What stands under the list, in the frame's open band. */
  footer?: ReactNode
}

export function RepositoriesSection({
  repositories,
  loading = false,
  onInclude,
  onOpen,
  onAdd,
  footer,
}: RepositoriesSectionProps): ReactNode {
  const add = (
    <Button size="sm" onClick={onAdd}>
      <IconPlus size="sm" />
      Add a repository
    </Button>
  )
  // A folder that is not a repository and holds none is a Project all the same: it starts empty.
  const empty = !loading && repositories.length === 0
  return (
    <Section label="Repositories">
      <SectionHead
        title="Repositories"
        count={loading || empty ? undefined : repositories.length}
        actions={loading || empty ? undefined : add}
      />
      <Frame footer={footer}>
        {empty ? (
          <Empty face="asleep" title="No repository yet" action={add} />
        ) : (
          <>
            <ColumnsHead />
            <ul aria-label="Repositories" aria-busy={loading} className="flex flex-col">
              {loading ? (
                <>
                  <RepositoryRowSkeleton />
                  <RepositoryRowSkeleton />
                  <RepositoryRowSkeleton />
                </>
              ) : (
                repositories.map((repository) => (
                  <RepositoryRow
                    key={repository.id}
                    repository={repository}
                    onInclude={(included) => onInclude(repository.id, included)}
                    onOpen={() => onOpen(repository.id)}
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

/** A remote of a repository, as its form offers it. */
export interface RemoteChoice {
  name: string
  /** Where it is fetched from. */
  url: string
}

/** What the form of a repository writes. */
export interface RepositoryDraft {
  path: string
  icon?: MarkIcon | undefined
  includedByDefault: boolean
  /** The remote chosen; null for none. */
  remote: string | null
  baseBranch: string
}

export interface RepositoryFormProps {
  draft: RepositoryDraft
  onChange: (draft: RepositoryDraft) => void
  /**
   * The remotes the repository has. Left out for a repository being added: what Git knows of it
   * is read once it is.
   */
  remotes?: readonly RemoteChoice[] | undefined
  freshness?: BaseFreshness | undefined
  /** Git's own words when the repository cannot be read. */
  unreadable?: string | undefined
  /** What is wrong with the path, in words. */
  pathError?: string | undefined
  /** What is wrong with the base branch, in Git's rules. */
  branchError?: string | undefined
  onChooseFolder: () => void
  /** Whether an icon may be chosen; false hides the field where it cannot be kept yet. */
  icons?: boolean | undefined
}

/** The value the icon select holds for the folder every repository wears until one is chosen. */
const FOLDER = 'folder'

/** The value the remote select holds for "no remote": a space, which no remote's name holds. */
const NO_REMOTE = 'no remote'

const GIT_SAYS =
  'flex items-start gap-2 rounded-md border border-border bg-destructive-muted px-3 py-2 text-sm text-destructive-muted-foreground'

const QUIET = 'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'

/** The form of a repository: where its path, its inclusion, its remote and its base are written. */
export function RepositoryForm({
  draft,
  onChange,
  remotes,
  freshness,
  unreadable,
  pathError,
  branchError,
  onChooseFolder,
  icons = true,
}: RepositoryFormProps): ReactNode {
  const chosen = remotes?.find((remote) => remote.name === draft.remote)
  return (
    <>
      {unreadable !== undefined && (
        <div role="alert" className={GIT_SAYS}>
          <span className="flex shrink-0 pt-0.5 text-destructive">
            <IconAlertTriangle size="sm" aria-hidden="true" />
          </span>
          <span className="min-w-0 font-mono text-xs break-words">{unreadable}</span>
        </div>
      )}
      <Input
        label="Path in the main checkout"
        icon={<IconFolderOpen size="sm" />}
        value={draft.path}
        onValueChange={(path) => onChange({ ...draft, path })}
        error={pathError}
        action={
          <Button size="md" onClick={onChooseFolder}>
            Choose…
          </Button>
        }
      />
      {icons && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium" aria-hidden="true">
            Icon
          </span>
          <Select<MarkIcon | typeof FOLDER>
            label="Icon"
            className="w-full"
            value={draft.icon ?? FOLDER}
            mark={<span className="flex text-muted-foreground">{iconOf(draft.icon)}</span>}
            onValueChange={(value) =>
              onChange({ ...draft, icon: value === FOLDER ? undefined : value })
            }
            items={[
              {
                value: FOLDER,
                label: 'Folder',
                icon: <span className="flex text-muted-foreground">{iconOf(undefined)}</span>,
              },
              ...MARK_ICONS.map((icon) => ({
                value: icon,
                label: MARK_ICON_WORDS[icon],
                icon: <span className="flex text-muted-foreground">{markIcon(icon)}</span>,
              })),
            ]}
          />
        </div>
      )}
      <Checkbox
        checked={draft.includedByDefault}
        onCheckedChange={(includedByDefault) => onChange({ ...draft, includedByDefault })}
        label="Included in new Workspaces"
      />
      {remotes !== undefined && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium" aria-hidden="true">
            Remote
          </span>
          <Select
            label="Remote"
            className="w-full"
            value={draft.remote ?? NO_REMOTE}
            onValueChange={(value) =>
              onChange({ ...draft, remote: value === NO_REMOTE ? null : value })
            }
            items={[
              ...remotes.map((remote) => ({ value: remote.name, label: remote.name })),
              { value: NO_REMOTE, label: 'No remote' },
            ]}
          />
          {chosen !== undefined && (
            <span className={QUIET}>
              <span className="truncate font-mono">{chosen.url}</span>
            </span>
          )}
        </div>
      )}
      {remotes !== undefined && (
        <div className="flex flex-col gap-1">
          <Input
            label="Base branch"
            icon={<IconGitBranch size="sm" />}
            value={draft.baseBranch}
            onValueChange={(baseBranch) => onChange({ ...draft, baseBranch })}
            error={branchError}
          />
          {freshness !== undefined && branchError === undefined && (
            <span
              className={cn(QUIET, freshness.kind === 'old' && 'text-warning-muted-foreground')}
            >
              {freshness.kind === 'old' && <IconCloudDownload size="sm" aria-hidden="true" />}
              <span className="min-w-0">
                {freshnessWords(freshness)}
                {freshness.kind === 'old' && freshness.reason !== undefined
                  ? `: ${freshness.reason}`
                  : ''}
              </span>
            </span>
          )}
        </div>
      )}
    </>
  )
}
