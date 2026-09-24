import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { IconGitFork, IconLoader } from '../icons.ts'
import type { GitState, WorkspaceRepositoryLine } from './model.ts'

/**
 * What Git says about each repository of a Workspace right now (D8-01, D8-15): the first thing a
 * Workspace shows once its row is opened in the list of a Project's settings.
 *
 * The branch a repository is on is observed, never stored: the card is handed what Git answered
 * when it was drawn, and a repository Git could not read says Git's own message on its own row
 * while the others still say theirs. The Workspace itself — its name, its state, its folder and
 * what can be done with it — is said by the row it opens under, and is not said again here.
 */
const REPOSITORIES = 'flex flex-col gap-2'

const NOTE = 'text-sm text-muted-foreground'

const LINE = 'flex min-w-0 flex-1 flex-col gap-0.5'

const REPOSITORY = 'min-w-0 truncate font-mono text-sm'

const GIT = 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'

const MONO = 'font-mono text-foreground'

/** Git's message, as it is: kept whole on as many lines as it needs. */
const GIT_ERROR =
  'min-w-0 font-mono text-xs break-words whitespace-pre-wrap text-destructive-muted-foreground'

export interface WorkspaceRepositoriesProps {
  /** The Workspace's name, which names the list to whatever reads the page. */
  name: string
  /** Each repository of the Workspace, with what Git answered when the card was drawn. */
  repositories: readonly WorkspaceRepositoryLine[]
  /** When it was cleaned up, already said as a sentence by the caller. */
  cleanedAt?: string | undefined
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

export function WorkspaceRepositories({
  name,
  repositories,
  cleanedAt,
  className,
}: WorkspaceRepositoriesProps): ReactNode {
  return (
    <Card
      title="Repositories"
      description="What Git says of each, read when shown."
      className={className}
    >
      {cleanedAt !== undefined && <p className={NOTE}>{cleanedAt}</p>}
      {repositories.length === 0 ? (
        cleanedAt === undefined && (
          <p className={NOTE}>No repository is declared: the Workspace is its folder.</p>
        )
      ) : (
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
