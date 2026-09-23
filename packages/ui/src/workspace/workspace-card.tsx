import type { ReactNode } from 'react'

import { Badge, type BadgeProps } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { IconFolderOpen, IconGitFork, IconLoader, IconPlayerPlay, IconTrash } from '../icons.ts'
import type { GitState, WorkspaceRepositoryLine, WorkspaceState } from './model.ts'

/**
 * One Workspace, and what Git says about each of its repositories right now (D8-01, D8-15).
 *
 * The branch a repository is on is observed, never stored: the card is handed what Git answered
 * when it was drawn, and a repository Git could not read says Git's own message on its own row
 * while the others still say theirs. A Workspace is one folder whatever made it — `main`, one
 * made for a Spec, one on a folder the user picked — so the card is the same for all three, and
 * only the actions differ: only the one made for a Spec is cleaned up (D8-14), and a cleaned
 * Workspace has nothing left to act on.
 */
const BODY = 'flex flex-col gap-3'

const FACTS = 'flex flex-wrap items-center gap-2'

const PATH = 'min-w-0 truncate font-mono text-sm text-muted-foreground'

const NOTE = 'text-sm text-muted-foreground'

const REPOSITORIES = 'flex flex-col gap-2'

const LINE = 'flex min-w-0 flex-1 flex-col gap-0.5'

const REPOSITORY = 'min-w-0 truncate font-mono text-sm'

const GIT = 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'

const MONO = 'font-mono text-foreground'

/** Git's message, as it is: kept whole on as many lines as it needs. */
const GIT_ERROR =
  'min-w-0 font-mono text-xs break-words whitespace-pre-wrap text-destructive-muted-foreground'

/** How a Workspace's state is read: a word, in the tone of what it says. */
const STATE: Record<WorkspaceState, { word: string; tone: NonNullable<BadgeProps['tone']> }> = {
  preparing: { word: 'Preparing', tone: 'info' },
  ready: { word: 'Ready', tone: 'success' },
  failed: { word: 'Failed', tone: 'destructive' },
  cleaned: { word: 'Cleaned up', tone: 'neutral' },
}

/** The state of a Workspace, and `main` beside it as a badge of its own. */
export function WorkspaceBadges({
  state,
  main,
}: {
  state: WorkspaceState
  main: boolean
}): ReactNode {
  const shown = STATE[state]
  return (
    <>
      <Badge tone={shown.tone}>{shown.word}</Badge>
      {main && <Badge tone="primary">main</Badge>}
    </>
  )
}

export interface WorkspaceCardProps {
  name: string
  /** The folder of the Workspace, as the system writes it. */
  path: string
  state: WorkspaceState
  /** Whether it is the Project's own folder, which is never cleaned up. */
  main: boolean
  /** Whether Hemera made it for a Spec, with its worktrees: the only kind cleaned up (D8-14). */
  dedicated: boolean
  /** The key of the Spec it was made for, when it was made for one. */
  specKey?: string | undefined
  /** Each repository of the Workspace, with what Git answered when the card was drawn. */
  repositories: readonly WorkspaceRepositoryLine[]
  /** When it was cleaned up, already said as a sentence by the caller. */
  cleanedAt?: string | undefined
  /** Opens the folder in the system's file manager. */
  onOpenFolder?: (() => void) | undefined
  /** Asks to clean it up; offered on a dedicated Workspace that is not cleaned up yet. */
  onCleanup?: (() => void) | undefined
  /** Resumes a preparation that failed; offered on a `failed` Workspace only. */
  onResume?: (() => void) | undefined
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

export function WorkspaceCard({
  name,
  path,
  state,
  main,
  dedicated,
  specKey,
  repositories,
  cleanedAt,
  onOpenFolder,
  onCleanup,
  onResume,
  className,
}: WorkspaceCardProps): ReactNode {
  const cleaned = state === 'cleaned'
  // A cleaned Workspace has no folder left to open and nothing left to resume or clean (D8-14).
  const openable = !cleaned && onOpenFolder !== undefined
  const resumable = state === 'failed' && onResume !== undefined
  const cleanable = dedicated && !cleaned && onCleanup !== undefined
  const actions =
    openable || resumable || cleanable ? (
      <>
        {resumable && (
          <Button variant="primary" size="sm" onClick={onResume}>
            <IconPlayerPlay size="sm" aria-hidden="true" />
            Resume
          </Button>
        )}
        {openable && (
          <Button variant="secondary" size="sm" onClick={onOpenFolder}>
            <IconFolderOpen size="sm" aria-hidden="true" />
            Open folder
          </Button>
        )}
        {cleanable && (
          <Button variant="ghost" size="sm" onClick={onCleanup}>
            <IconTrash size="sm" aria-hidden="true" />
            Clean up
          </Button>
        )}
      </>
    ) : undefined
  return (
    <Card title={name} footer={actions} className={className}>
      <div className={BODY}>
        <div className={FACTS}>
          <WorkspaceBadges state={state} main={main} />
          {specKey !== undefined && <Badge tone="neutral">{specKey}</Badge>}
          <span className={PATH}>{path}</span>
        </div>
        {cleaned && cleanedAt !== undefined && <p className={NOTE}>{cleanedAt}</p>}
        {repositories.length > 0 && (
          <ul className={REPOSITORIES} aria-label={`Repositories of ${name}`}>
            {repositories.map((repository) => (
              <li key={repository.path}>
                <CardRow>
                  <span className="flex shrink-0 text-muted-foreground">
                    <IconGitFork size="sm" aria-hidden="true" />
                  </span>
                  <span className={LINE}>
                    <span className={REPOSITORY}>{repository.path}</span>
                    <GitLine git={repository.git} />
                  </span>
                </CardRow>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

/** What Git answered for one repository: its branch, commit and changes, or its own message. */
function GitLine({ git }: { git: GitState | null }): ReactNode {
  if (git === null) {
    return (
      <span className={GIT}>
        <span className="flex items-center gap-1">
          <IconLoader size="sm" aria-hidden="true" />
          Reading Git…
        </span>
      </span>
    )
  }
  if (!git.ok) {
    return (
      <span className={GIT}>
        <Badge tone="destructive">Git error</Badge>
        <span className={GIT_ERROR}>{git.error}</span>
      </span>
    )
  }
  return (
    <span className={GIT}>
      <span className={MONO}>{git.branch}</span>
      <span className={MONO}>{git.commit.slice(0, 7)}</span>
      <span>{changesOf(git)}</span>
    </span>
  )
}

/** `1 staged, 1 unstaged, 1 untracked`, the counts that are not zero, or `clean` when all are. */
function changesOf({ staged, unstaged, untracked }: Extract<GitState, { ok: true }>): string {
  const counts = [
    { count: staged, word: 'staged' },
    { count: unstaged, word: 'unstaged' },
    { count: untracked, word: 'untracked' },
  ].filter((one) => one.count > 0)
  if (counts.length === 0) return 'clean'
  return counts.map((one) => `${String(one.count)} ${one.word}`).join(', ')
}
