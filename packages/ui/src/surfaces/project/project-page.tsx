import { type ReactNode, useState } from 'react'

import type { Ball } from '../../blocks/ball/ball-mark.tsx'
import { MissionRow, MissionRowSkeleton } from '../../blocks/mission/mission-row.tsx'
import { IconButton } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Kbd } from '../../components/kbd/kbd.tsx'
import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconInbox, IconSearch, IconSettings } from '../../icons.ts'
import { Page, PageHeader } from '../page.tsx'

/**
 * The Project page: its name, the place to start a mission, and its missions by stage.
 *
 * The header is the Project's letter and its name, and under them its repositories as words —
 * `api · web · shared`, in the mono face a repository's name is written in everywhere. The entry
 * to the Project's settings is the gear at the end of the title's line, named in its tooltip.
 *
 * Under the header, the start field: the design system's input, full width, with its keystroke
 * at its end. Its content — tickets, ideas, what it finds — is a later slice; here it is the field.
 *
 * Then the missions, grouped by stage, each group a heading and its rows, the row a mission is
 * everywhere; `Done` is folded away at the end. A Project with no mission says so once, in the
 * middle of the room the missions will take.
 */
export interface ProjectRepository {
  name: string
}

export interface ProjectMissionRow {
  missionKey: string
  title: string
  /** When it last moved, as the row says it. */
  when: string
  ball: Ball
}

export interface ProjectStageGroup {
  /** The stage's name, in the words of the product: `Planning`, `Building`… */
  stage: string
  rows: readonly ProjectMissionRow[]
}

export interface ProjectPageProps {
  name: string
  repositories: readonly ProjectRepository[]
  groups: readonly ProjectStageGroup[]
  /** How many missions are done or cancelled, folded away at the end. */
  done: number
  loading?: boolean | undefined
  error?: string | undefined
  onStart: (text: string) => void
  onOpenMission: (missionKey: string) => void
  onOpenSettings: () => void
  onRetry: () => void
}

const REPOSITORIES = 'flex min-w-0 items-center gap-1.5 font-mono text-xs'

const DOT = 'text-border'

const GROUP = 'flex flex-col gap-2'

const STAGE =
  'flex h-control-text items-center gap-2 px-1 text-sm font-medium text-muted-foreground'

const COUNT = 'text-xs text-muted-foreground tabular-nums'

export function ProjectPage({
  name,
  repositories,
  groups,
  done,
  loading = false,
  error,
  onStart,
  onOpenMission,
  onOpenSettings,
  onRetry,
}: ProjectPageProps): ReactNode {
  const [text, setText] = useState('')
  const empty = !loading && error === undefined && groups.every((group) => group.rows.length === 0)
  return (
    <Page>
      <PageHeader
        lead={<LetterAvatar name={name} />}
        title={name}
        about={
          <span className={REPOSITORIES}>
            {repositories.map((repository, index) => (
              <span key={repository.name} className="flex items-center gap-1.5">
                {index > 0 && (
                  <span aria-hidden="true" className={DOT}>
                    ·
                  </span>
                )}
                <span className="truncate">{repository.name}</span>
              </span>
            ))}
          </span>
        }
        actions={
          <Tooltip label="Project settings" side="bottom">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconSettings size="md" />}
              aria-label={`Settings of ${name}`}
              onClick={onOpenSettings}
            />
          </Tooltip>
        }
      />
      <Input
        label={`Start a mission in ${name}`}
        icon={<IconSearch size="sm" />}
        placeholder="A ticket, an idea…"
        value={text}
        onValueChange={setText}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || text.trim() === '') return
          event.preventDefault()
          onStart(text.trim())
        }}
        trailing={<Kbd keys="Ctrl+K" />}
      />
      {error !== undefined && (
        <ErrorState title={`Hemera could not read ${name}`} description={error} onRetry={onRetry} />
      )}
      {loading && (
        <div className={GROUP}>
          <h2 className={STAGE}>Missions</h2>
          <Frame>
            <ul aria-label="Missions" aria-busy="true" className="flex flex-col">
              <MissionRowSkeleton />
              <MissionRowSkeleton />
              <MissionRowSkeleton />
            </ul>
          </Frame>
        </div>
      )}
      {empty && (
        <Empty
          icon={<IconInbox size="md" />}
          title="No mission yet"
          description="The field above starts one, from a ticket or an idea."
        />
      )}
      {groups
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <section key={group.stage} className={GROUP}>
            <h2 className={STAGE}>
              {group.stage}
              <span className={COUNT}>{group.rows.length}</span>
            </h2>
            <Frame>
              <ul aria-label={`${group.stage} missions`} className="flex flex-col">
                {group.rows.map((row) => (
                  <MissionRow
                    key={row.missionKey}
                    missionKey={row.missionKey}
                    title={row.title}
                    when={row.when}
                    ball={row.ball}
                    onOpen={() => onOpenMission(row.missionKey)}
                  />
                ))}
              </ul>
            </Frame>
          </section>
        ))}
      {done > 0 && !loading && (
        <p className={STAGE}>
          Done
          <span className={COUNT}>{done}</span>
        </p>
      )}
    </Page>
  )
}
