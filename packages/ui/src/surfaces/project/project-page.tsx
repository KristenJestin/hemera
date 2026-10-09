import { AnimatePresence, motion } from 'motion/react'
import { createContext, type ReactNode, type RefObject, useRef, useState } from 'react'

import {
  MissionRow,
  type MissionRowProps,
  MissionRowSkeleton,
} from '../../blocks/mission/mission-row.tsx'
import {
  FOLDED_STAGES,
  type MissionStage,
  STAGE_DOT,
  STAGE_ORDER,
} from '../../blocks/mission/vocabulary.ts'
import { Button, IconButton } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { type Identity, ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconBook2, IconInbox, IconMessages, IconSettings } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { Page, PageHeader } from '../page.tsx'

/**
 * The Project page: its name, and two columns under it.
 *
 * The header is the Project's letter and its name, and under them its repositories as words —
 * `api · web · shared`, in the mono face a repository's name is written in everywhere. The entry
 * to the Project's settings is the gear at the end of the title's line, named in its tooltip.
 *
 * On the left, the place to start a mission (`start`, drawn by its own part), the Project's tasks,
 * and its missions by stage, each stage a heading with its dot and its count, each mission the
 * two-line row it is everywhere. The stages that are over — Done, Cancelled — are real folds: the
 * heading is a button, and pressing it opens the same framed list on the `fold` kind, and folds it
 * back. A Project with no mission says so once, in the room the missions will take.
 *
 * On the right, a rail for what belongs to the Project without being a mission: the living spec
 * as a card with its domains, and the Chats.
 */
export interface ProjectRepository {
  name: string
}

/** A mission as the page lists it: the row's own props, and what opens it is the page's. */
export type ProjectMissionRow = Omit<MissionRowProps, 'onOpen'>

export interface ProjectStageGroup {
  stage: MissionStage
  rows: readonly ProjectMissionRow[]
}

/** The living spec as the card in the rail says it. */
export interface ProjectLivingSpec {
  domains: readonly { id: string; name: string; waiting: boolean }[]
  /** The card's description: `6 domains · updated yesterday`. */
  about: string
}

export interface ProjectChat {
  id: string
  title: string
  /** When it last moved, as the row says it. */
  when: string
}

export interface ProjectPageProps {
  name: string
  /** What the user chose to mark it with; nothing chosen is its letter. */
  identity?: Identity | undefined
  repositories: readonly ProjectRepository[]
  /** The field that starts a mission and what it finds, under the header. */
  start: ReactNode
  /** The stages that hold missions; the page lists them in the order of the stages. */
  groups: readonly ProjectStageGroup[]
  /** The living spec's card; null: none yet (a skeleton while the page loads). */
  livingSpec: ProjectLivingSpec | null
  chats: readonly ProjectChat[]
  loading?: boolean | undefined
  error?: string | undefined
  onOpenMission: (missionKey: string) => void
  onOpenSettings: () => void
  onOpenLivingSpec: () => void
  onOpenChat: (chatId: string) => void
  onNewChat: () => void
  onRetry: () => void
  /** The Project's tasks, under the field that starts a mission: what Hemera does for it. */
  tasks?: ReactNode
}

/**
 * The field that starts a mission, as the Project's tasks reach it: a task leaving the page while
 * the focus is in it hands the focus there rather than to nothing. The page provides the ref; the
 * field takes it as its `inputRef`.
 */
export const MissionField = createContext<RefObject<HTMLInputElement | null> | null>(null)

const REPOSITORIES = 'flex min-w-0 items-center gap-1.5 font-mono text-xs'

const DOT = 'text-border'

const COLUMNS = 'grid grid-cols-1 items-start gap-8 lg:grid-cols-3'

const MAIN = 'flex min-w-0 flex-col gap-6 lg:col-span-2'

const RAIL = 'flex min-w-0 flex-col gap-6'

const STAGE_HEAD = 'flex items-center gap-2 text-sm font-semibold'

const STAGE_TOGGLE =
  'flex h-control-sm items-center gap-2 rounded-md text-sm font-semibold outline-none hover:tinted focus-ring hover-motion'

const COUNT = 'text-sm font-normal text-muted-foreground tabular-nums'

const SIDE_ROW = 'border-b border-border last:border-b-0'

const SIDE_OPEN =
  'flex h-control-md w-full min-w-0 items-center gap-3 px-4 text-left text-sm outline-none hover:bg-muted focus-ring hover-motion'

const QUIET = 'shrink-0 text-xs text-muted-foreground'

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
          <MissionRow key={row.missionKey} {...row} onOpen={() => onOpenMission(row.missionKey)} />
        ))}
      </ul>
    </Frame>
  )
}

/** A stage's heading: its dot, its name and how many missions it holds. */
function StageWords({ group }: { group: ProjectStageGroup }): ReactNode {
  return (
    <>
      <span aria-hidden="true" className={STAGE_DOT[group.stage]} />
      <span>{group.stage}</span>
      <span className={COUNT}>{group.rows.length}</span>
    </>
  )
}

/** A stage that is over: its rows fold away under its heading, and come back on the `fold` kind. */
function FoldingStage({
  group,
  onOpenMission,
}: {
  group: ProjectStageGroup
  onOpenMission: (missionKey: string) => void
}): ReactNode {
  const folding = useTransition(fold)
  const [open, setOpen] = useState(false)
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        className={STAGE_TOGGLE}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <StageWords group={group} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rows"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <StageRows group={group} onOpenMission={onOpenMission} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** The domains the card lists while the living spec is read: the shape of the rows to come. */
const DOMAINS_LIKELY = ['Billing', 'Customers', 'Exports']

function LivingSpecCard({
  livingSpec,
  loading,
  onOpen,
}: {
  livingSpec: ProjectLivingSpec | null
  loading: boolean
  onOpen: () => void
}): ReactNode {
  return (
    <Frame
      header={
        <FrameHeader
          icon={<IconBook2 size="md" />}
          title="Living spec"
          description={livingSpec?.about}
          action={
            <Button variant="link" size="sm" onClick={onOpen}>
              Open
            </Button>
          }
        />
      }
    >
      {livingSpec === null ? (
        loading ? (
          <div
            aria-hidden="true"
            className="flex flex-col py-1 text-sm"
            data-living-spec-skeleton=""
          >
            {DOMAINS_LIKELY.map((domain) => (
              <span key={domain} className="px-4 py-1.5">
                <Skeleton>{domain}</Skeleton>
              </span>
            ))}
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">Not written yet.</p>
        )
      ) : (
        <ul aria-label="Domains" className="flex flex-col py-1 text-sm">
          {livingSpec.domains.map((domain) => (
            <li key={domain.id} className="flex min-w-0 items-center gap-2 px-4 py-1.5">
              <span className="min-w-0 flex-1 truncate">{domain.name}</span>
              {domain.waiting && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <StatusMark state="waiting" size="sm" />
                  Waits for you
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  )
}

function ChatsCard({
  chats,
  onOpenChat,
  onNewChat,
}: {
  chats: readonly ProjectChat[]
  onOpenChat: (chatId: string) => void
  onNewChat: () => void
}): ReactNode {
  return (
    <Frame
      header={
        <FrameHeader
          icon={<IconMessages size="md" />}
          title="Chats"
          action={
            <Button variant="link" size="sm" onClick={onNewChat}>
              New Chat
            </Button>
          }
        />
      }
    >
      {chats.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No Chat yet.</p>
      ) : (
        <ul aria-label="Chats" className="flex flex-col">
          {chats.map((chat) => (
            <li key={chat.id} className={SIDE_ROW}>
              <button type="button" className={SIDE_OPEN} onClick={() => onOpenChat(chat.id)}>
                <span aria-hidden="true" className="flex text-muted-foreground">
                  <IconMessages size="sm" />
                </span>
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                <span className={QUIET}>{chat.when}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  )
}

export function ProjectPage({
  name,
  identity,
  repositories,
  start,
  groups,
  livingSpec,
  chats,
  loading = false,
  error,
  onOpenMission,
  onOpenSettings,
  onOpenLivingSpec,
  onOpenChat,
  onNewChat,
  onRetry,
  tasks,
}: ProjectPageProps): ReactNode {
  const field = useRef<HTMLInputElement>(null)
  const listed = STAGE_ORDER.flatMap((stage) =>
    groups.filter((group) => group.stage === stage && group.rows.length > 0),
  )
  const empty = !loading && error === undefined && listed.length === 0
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
      <div className={COLUMNS}>
        <div className={MAIN}>
          <MissionField value={field}>
            {start}
            {tasks}
          </MissionField>
          {error !== undefined && (
            <ErrorState
              title={`Hemera could not read ${name}`}
              description={error}
              onRetry={onRetry}
            />
          )}
          {loading && (
            <Frame>
              <ul aria-label="Missions" aria-busy="true" className="flex flex-col">
                <MissionRowSkeleton twoLines />
                <MissionRowSkeleton twoLines />
                <MissionRowSkeleton twoLines />
              </ul>
            </Frame>
          )}
          {empty && (
            <Empty
              icon={<IconInbox size="md" />}
              title="No mission yet"
              description="The field above starts one, from a ticket or an idea."
            />
          )}
          {listed.map((group) =>
            FOLDED_STAGES.has(group.stage) ? (
              <FoldingStage key={group.stage} group={group} onOpenMission={onOpenMission} />
            ) : (
              <section key={group.stage} className="flex flex-col gap-2">
                <h2 className={STAGE_HEAD}>
                  <StageWords group={group} />
                </h2>
                <StageRows group={group} onOpenMission={onOpenMission} />
              </section>
            ),
          )}
        </div>
        <aside aria-label={`About ${name}`} className={RAIL}>
          <LivingSpecCard livingSpec={livingSpec} loading={loading} onOpen={onOpenLivingSpec} />
          <ChatsCard chats={chats} onOpenChat={onOpenChat} onNewChat={onNewChat} />
        </aside>
      </div>
    </Page>
  )
}
