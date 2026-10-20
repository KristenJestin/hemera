import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Empty } from '../../components/empty/empty.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconGitCompare,
  IconHistory,
  IconLayoutColumns,
  IconLayoutRows,
} from '../../icons.ts'
import { CommentCard, type CommentHandlers, type NewComment } from './diff-comments.tsx'
import { type DiffLayout, DiffStage, type StageTarget } from './diff-stage.tsx'
import { ChangesTree } from './diff-tree.tsx'
import type { DiffComment, DiffRepository, DiffSource } from './diff-types.ts'

/**
 * The diff view of a mission, opened over its base (prototype screen E11): the tree of what
 * changed on the left, every file in one scroll beside it. Its head holds the layout — split or
 * stacked, one toggle — and, while a round writes, the mark that says the diff is live.
 *
 * Once the Workspace is gone (cleaned up, or the mission done), the diff is read from the last
 * checkpoint, said in words above it, and nothing can be written on it.
 */

export interface DiffViewHandlers extends CommentHandlers {
  onAdd: (comment: NewComment) => void
  /** A file chosen in the tree: the diff is sent to it, by its id. */
  onFile: (id: string) => void
  /** A large file's Show pressed: its sides are asked for, by its id. */
  onShow: (id: string) => void
}

export interface DiffViewProps extends DiffViewHandlers {
  repositories: readonly DiffRepository[]
  comments: readonly DiffComment[]
  source: DiffSource
  layout: DiffLayout
  loading?: boolean | undefined
  /** Why the diff could not be read, in words, and the way to read it again. */
  error?: { words: string; onRetry: () => void } | undefined
  /** Why the last gesture on a comment did not go through, in words. */
  notice?: string | undefined
  target?: StageTarget | null | undefined
  lit?: string | null | undefined
}

const TOGGLE =
  'flex size-control-sm items-center justify-center rounded-md text-muted-foreground outline-none focus-ring hover:tinted hover-motion aria-pressed:bg-accent aria-pressed:text-foreground'

/** The head's actions: the live mark while a round writes, then split or stacked. */
export function DiffActions({
  source,
  layout,
  onLayout,
}: {
  source: DiffSource
  layout: DiffLayout
  onLayout: (layout: DiffLayout) => void
}): ReactNode {
  return (
    <>
      {source.kind === 'live' && source.round !== undefined && (
        <Legend label={`Live: round ${String(source.round)} is writing these files`}>
          <StatusMark state="running" size="sm" />
        </Legend>
      )}
      <div role="group" aria-label="Layout of the diff" className="flex gap-0.5">
        {(
          [
            ['split', 'Split', <IconLayoutColumns key="split" size="sm" />],
            ['stacked', 'Stacked', <IconLayoutRows key="stacked" size="sm" />],
          ] as const
        ).map(([value, name, icon]) => (
          <Tooltip key={value} label={name}>
            <button
              type="button"
              aria-pressed={layout === value}
              aria-label={name}
              className={TOGGLE}
              onClick={() => onLayout(value)}
            >
              {icon}
            </button>
          </Tooltip>
        ))}
      </div>
    </>
  )
}

/** Where a diff read from a checkpoint comes from, in words. */
function checkpointWords(source: Extract<DiffSource, { kind: 'checkpoint' }>): string {
  const why =
    source.why === 'cleanup'
      ? 'the Workspace was cleaned up'
      : 'the mission is done and its Workspace removed'
  return `Read from the last checkpoint, ${source.at}: ${why}.`
}

export function DiffView({
  repositories,
  comments,
  source,
  layout,
  loading = false,
  error,
  notice,
  target = null,
  lit = null,
  onFile,
  ...handlers
}: DiffViewProps): ReactNode {
  if (error !== undefined) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <ErrorState
          title="The diff cannot be read"
          description={error.words}
          onRetry={error.onRetry}
        />
      </div>
    )
  }
  const unreadable = repositories.filter((one) => one.unreadable !== undefined)
  const empty =
    !loading && unreadable.length === 0 && repositories.every((one) => one.files.length === 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {source.kind === 'checkpoint' && (
        <p className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-sm text-muted-foreground">
          <span className="flex shrink-0">
            <IconHistory size="sm" />
          </span>
          {checkpointWords(source)}
        </p>
      )}
      {notice !== undefined && (
        <p
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-sm"
        >
          <span className="flex shrink-0 text-warning">
            <IconAlertTriangle size="sm" />
          </span>
          <span className="min-w-0 break-words">{notice}</span>
        </p>
      )}
      {unreadable.map((one) => (
        <p
          key={one.name}
          className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-sm text-muted-foreground"
        >
          <span className="flex shrink-0 text-destructive">
            <IconAlertTriangle size="sm" />
          </span>
          <span className="min-w-0 break-words">{`Git cannot read ${one.name}: ${one.unreadable ?? ''}`}</span>
        </p>
      ))}
      {empty ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <Empty
            icon={<IconGitCompare />}
            title="Nothing changed yet"
            description="The diff fills as the tasks write."
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className={cn('flex w-diff-tree shrink-0 flex-col border-r border-border')}>
            <ChangesTree repositories={repositories} loading={loading} onFile={onFile} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <DiffStage
              repositories={repositories}
              comments={comments}
              layout={layout}
              writable={source.kind === 'live'}
              loading={loading}
              target={target}
              lit={lit}
              {...handlers}
            />
          </div>
        </div>
      )}
    </div>
  )
}

const NOTHING = (): void => {}

/**
 * The commented version of an outdated comment: the file as it was, the comment on its lines. A
 * version whose content cannot be shown (a binary, a file that may hold secrets) says why.
 */
export function CommentedVersion({
  comment,
  contents,
  why,
  onOpenForge,
}: {
  comment: DiffComment
  /** The file as it was, or null when it cannot be shown. */
  contents: string | null
  /** Why it cannot be shown, in words. */
  why?: string | undefined
  onOpenForge: (url: string) => void
}): ReactNode {
  if (contents === null) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">{why}</p>
        <CommentCard
          comment={{ ...comment, outdated: undefined }}
          writable={false}
          onAction={NOTHING}
          onEdit={NOTHING}
          onFollowUp={NOTHING}
          onOpenVersion={NOTHING}
          onOpenForge={onOpenForge}
        />
      </div>
    )
  }
  const lines = contents.trimEnd().split('\n')
  // The lines it was written on, as this version numbers them: where its excerpt stands.
  const excerpt = (comment.outdated?.excerpt ?? '').trimEnd().split('\n')
  const first = lines.findIndex((line) => line === excerpt[0])
  const written = first === -1 ? null : { start: first + 1, end: first + excerpt.length }
  const marked = (at: number): boolean =>
    written !== null && at + 1 >= written.start && at + 1 <= written.end
  return (
    <div className="flex flex-col gap-3 p-4">
      <pre className="overflow-auto rounded-md border border-border bg-card py-2 font-mono text-xs">
        {lines.map((line, at) => (
          <span
            key={`${String(at)}-${line}`}
            className={cn('flex gap-3 px-3', marked(at) && 'bg-selection')}
          >
            <span className="w-6 shrink-0 text-right text-muted-foreground tabular-nums">
              {String(at + 1)}
            </span>
            <span className="whitespace-pre-wrap">{line}</span>
          </span>
        ))}
      </pre>
      <CommentCard
        comment={{
          ...comment,
          outdated: undefined,
          place: { ...comment.place, lines: written },
        }}
        writable={false}
        onAction={NOTHING}
        onEdit={NOTHING}
        onFollowUp={NOTHING}
        onOpenVersion={NOTHING}
        onOpenForge={onOpenForge}
      />
    </div>
  )
}
