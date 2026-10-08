import type { ReactNode } from 'react'

import { NeedCard } from '../../blocks/need/need-card.tsx'
import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { IconFolderOpen, IconPlus } from '../../icons.ts'
import { Page } from '../page.tsx'

/**
 * The window the first time Hemera opens: no Project yet. Home's empty state, Hemera asleep, and
 * the two ways in: add a Project from a folder, the primary, or create a new one. The settings —
 * the agents, Hemera Auto — have nothing to do here: they live in the application's settings.
 *
 * What stops everything is an app need, the same card as anywhere a need is answered, above the
 * empty state: Git missing, or no agent installed. Without Git there is no Project to add, so the
 * two ways in are not drawn until it answers.
 */
export interface FirstLaunchProps {
  /** Whether Git answers on this machine. */
  git: boolean
  onCheckGit: () => void
  /** Whether Hemera found no agent installed on this machine. */
  noAgent: boolean
  onCheck: () => void
  /** Opens the system's folder picker, then the new Project's setup. */
  onAddFolder: () => void
  onCreate: () => void
}

const NEEDS = 'mx-auto flex w-full max-w-view-wide flex-col gap-3'

const WAYS_IN = 'flex flex-wrap items-center justify-center gap-2'

export function FirstLaunch({
  git,
  onCheckGit,
  noAgent,
  onCheck,
  onAddFolder,
  onCreate,
}: FirstLaunchProps): ReactNode {
  return (
    <Page className="flex-1 justify-center">
      {(!git || noAgent) && (
        <div className={NEEDS}>
          {!git && (
            <NeedCard
              ask={{ kind: 'environment', action: 'Check again' }}
              title="Git is not installed"
              text="Hemera reads and writes every Project through Git."
              when="now"
              onRetry={onCheckGit}
            />
          )}
          {noAgent && (
            <NeedCard
              ask={{ kind: 'environment', action: 'Check again' }}
              title="No agent is installed"
              text="Install Claude Code, Codex or OpenCode, then check again."
              when="now"
              onRetry={onCheck}
            />
          )}
        </div>
      )}
      <Empty
        face="asleep"
        title="No Project yet"
        description="A Project is a folder with one or more repositories."
        action={
          git && (
            <div className={WAYS_IN}>
              <Button variant="primary" onClick={onAddFolder}>
                <IconFolderOpen size="sm" aria-hidden="true" />
                Add a Project folder…
              </Button>
              <Button onClick={onCreate}>
                <IconPlus size="sm" aria-hidden="true" />
                Create a new Project
              </Button>
            </div>
          )
        }
      />
    </Page>
  )
}
