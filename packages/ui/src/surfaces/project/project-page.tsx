import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import type { Ball } from '../../blocks/ball/ball-mark.tsx'
import { MissionRow, MissionRowSkeleton } from '../../blocks/mission/mission-row.tsx'
import { IconButton } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Kbd } from '../../components/kbd/kbd.tsx'
import { type Identity, ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconInbox, IconSearch, IconSettings } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
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
 * everywhere. A group that starts folded — `Done`, at the end — is a real fold: its header is a
 * button with a chevron, and pressing it opens the same framed list on the `fold` kind, and folds
 * it back. A Project with no mission says so once, in the
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
  /**
   * Whether the group folds, and how it starts: `folded` or `open`. A group without it is always
   * open and has no chevron.
   */
  fold?: 'folded' | 'open' | undefined
}

export interface ProjectPageProps {
  name: string
  /** What the user chose to mark it with; nothing chosen is its letter. */
  identity?: Identity | undefined
  repositories: readonly ProjectRepository[]
  groups: readonly ProjectStageGroup[]
  loading?: boolean | undefined
  error?: string | undefined
  onStart: (text: string) => void
  onOpenMission: (missionKey: string) => void
  onOpenSettings: () => void
  onRetry: () => void
}

const REPOSITORIES = 'flex min-w-0 items-center gap-1.5 font-mono text-xs'

const DOT = 'text-border'

const GROUP = 'flex flex-col gap-3'

/** The body of a group that folds: clipped while it grows, its room above it held inside. */
const FOLDING = 'overflow-hidden'

function StageRows({
  group,
  onOpenMission,
}: {
  group: ProjectStageGroup
  onOpenMission: (missionKey: string) => void
}): ReactNode {
  return (
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
  )
}

/** A group whose rows fold away under its header, and come back on the `fold` kind. */
function FoldingGroup({
  group,
  onOpenMission,
}: {
  group: ProjectStageGroup
  onOpenMission: (missionKey: string) => void
}): ReactNode {
  const folding = useTransition(fold)
  const [open, setOpen] = useState(group.fold === 'open')
  return (
    <section className="flex flex-col">
      <SectionHead
        title={group.stage}
        count={group.rows.length}
        fold={{ open, onToggle: () => setOpen(!open) }}
      />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rows"
            className={FOLDING}
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <div className="pt-3">
              <StageRows group={group} onOpenMission={onOpenMission} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

export function ProjectPage({
  name,
  identity,
  repositories,
  groups,
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
        lead={<ProjectMark name={name} identity={identity} />}
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
          <SectionHead title="Missions" />
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
        .map((group) =>
          group.fold === undefined ? (
            <section key={group.stage} className={GROUP}>
              <SectionHead title={group.stage} count={group.rows.length} />
              <StageRows group={group} onOpenMission={onOpenMission} />
            </section>
          ) : (
            <FoldingGroup key={group.stage} group={group} onOpenMission={onOpenMission} />
          ),
        )}
    </Page>
  )
}
