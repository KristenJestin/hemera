import type { ReactNode } from 'react'

import {
  type AgentRow,
  AgentsSection,
  type JevKey,
  Mark,
  Row,
} from '../../blocks/app-settings/app-sections.tsx'
import { NeedCard } from '../../blocks/need/need-card.tsx'
import { Button } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { IconFolderOpen, IconPlus } from '../../icons.ts'
import { Page, PageHeader } from '../page.tsx'

/**
 * The window the first time Hemera opens: no Project yet, and what this machine has to drive one.
 *
 * Under "Welcome to Hemera", the agents on this machine, the same rows as the application's
 * settings: each with its version and the tool that installed it, signed in or the command to sign
 * in, or not installed and the command to install it. Under them Hemera Auto, as it stands: without
 * a key, everything not plainly safe asks the user; Add a key opens that setting. Then the two ways
 * in: add a Project from a folder, the primary, or create a new one.
 *
 * What stops everything is an app need, the same card as anywhere a need is answered, above the
 * rest: Git missing, or no agent installed. Without Git there is no Project to add, so the two ways
 * in are not drawn until it answers.
 */
export interface FirstLaunchProps {
  agents: readonly AgentRow[]
  /** Whether Hemera is still looking for the agents of this machine. */
  discovering?: boolean | undefined
  checking?: boolean | undefined
  onCheck: () => void
  onUpdate: (agent: string) => void
  onCopy: (line: string) => void
  /** Whether Git answers on this machine. */
  git: boolean
  onCheckGit: () => void
  jevKey: JevKey
  /** Opens the Hemera Auto section of the application's settings. */
  onAddKey: () => void
  /** Opens the system's folder picker, then the new Project's setup. */
  onAddFolder: () => void
  onCreate: () => void
}

const COLUMN = 'mx-auto flex w-full max-w-view-wide flex-col gap-8'

const NEEDS = 'flex flex-col gap-3'

const WAYS_IN = 'flex flex-wrap items-center gap-2'

const KEYS: Record<JevKey, { mark: 'todo' | 'done' | 'failed' | 'blocked'; label: string }> = {
  missing: { mark: 'todo', label: 'No key' },
  saved: { mark: 'done', label: 'Key stored by the system' },
  invalid: { mark: 'failed', label: 'Key refused by Jev' },
  unavailable: { mark: 'blocked', label: 'The system’s key storage is not available' },
}

export function FirstLaunch({
  agents,
  discovering = false,
  checking,
  onCheck,
  onUpdate,
  onCopy,
  git,
  onCheckGit,
  jevKey,
  onAddKey,
  onAddFolder,
  onCreate,
}: FirstLaunchProps): ReactNode {
  const noAgent = !discovering && agents.every((agent) => !agent.state.installed)
  const key = KEYS[jevKey]
  return (
    <Page>
      <div className={COLUMN}>
        <PageHeader title="Welcome to Hemera" />
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
                text="Install one of the agents below, then check again."
                when="now"
                onRetry={onCheck}
              />
            )}
          </div>
        )}
        <AgentsSection
          title="Agents on this machine"
          agents={agents}
          loading={discovering}
          checking={checking}
          onCheck={onCheck}
          onUpdate={onUpdate}
          onCopy={onCopy}
        />
        <section aria-label="Hemera Auto" className="flex flex-col gap-3">
          <SectionHead title="Hemera Auto" />
          <Frame>
            <Row
              name="Who judges the agents’ calls"
              detail={
                jevKey === 'saved' ? 'Jev, then you' : 'You: everything not plainly safe asks you'
              }
            >
              <Mark state={key.mark} label={key.label} />
              {jevKey !== 'saved' && jevKey !== 'unavailable' && (
                <Button size="sm" onClick={onAddKey}>
                  {jevKey === 'missing' ? 'Add a key' : 'Replace the key'}
                </Button>
              )}
            </Row>
          </Frame>
        </section>
        {git && (
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
        )}
      </div>
    </Page>
  )
}
