import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { BALL_LEGENDS, BallMark } from '../../blocks/ball/ball-mark.tsx'
import { Button, IconButton } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconBook2,
  IconFileText,
  IconGitBranch,
  IconInbox,
  IconMessages,
  IconSettings,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { Page, PageHeader } from '../../surfaces/page.tsx'
import {
  ACTIONS,
  CancelMission,
  ChatRow,
  type ExploredMission,
  FrozenGlyph,
  type HomeProps,
  LIFE,
  type Mark,
  MarkGlyph,
  type MissionProps,
  MissionNeeds,
  NightMark,
  type ProjectProps,
  STAGE_DOT,
  STAGE_ORDER,
  type Stage,
  StageBase,
  StartField,
  TicketLink,
  stageLabel,
} from './parts.tsx'

/**
 * Two lines and a rail.
 *
 * A mission takes two lines: its key and title, then who has the ball and what happened last,
 * and the marks that carry a cause — blocked, waiting — written out after their glyph, since a
 * cause is read, not pointed at. What belongs to the Project but is not a mission (the living
 * spec, its Chats) stands in a rail on the right. The mission's header draws the stage as a track
 * of the six stages, the current one lit. Home leads with Since you left, the story of the night
 * grouped by mission; what calls (Needs you, Questions) stands in the rail beside it. Since you
 * left has no read state: it is what happened since Home was last looked at.
 */
const ROW = 'flex min-w-0 flex-col gap-0.5 border-b border-border px-4 py-2 last:border-b-0'

const LINE_ONE = 'flex min-w-0 items-center gap-3'

const LINE_TWO = 'flex min-w-0 items-center gap-3 text-xs text-muted-foreground'

const OPEN =
  'flex h-control-text min-w-0 flex-1 items-center gap-3 rounded-sm text-left text-sm outline-none focus-ring hover:text-primary hover-motion'

const KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const TITLE = 'min-w-0 flex-1 truncate font-medium'

const WHEN = 'shrink-0 text-xs text-muted-foreground tabular-nums'

/** The marks whose cause is read: written out. The others: their glyph. */
const SPELLED: ReadonlySet<Mark['kind']> = new Set(['blocked', 'waiting'])

function Marks({ marks }: { marks: readonly Mark[] }): ReactNode {
  if (marks.length === 0) return null
  return (
    <span className="flex min-w-0 shrink items-center gap-2">
      {marks.map((mark) => (
        <MarkGlyph key={mark.kind} mark={mark} spelled={SPELLED.has(mark.kind)} />
      ))}
    </span>
  )
}

function RowB({
  mission,
  project,
  onOpen,
}: {
  mission: ExploredMission
  project?: string | undefined
  onOpen: (key: string) => void
}): ReactNode {
  return (
    <li className={ROW}>
      <div className={LINE_ONE}>
        {project !== undefined && <LetterAvatar name={project} />}
        <button type="button" className={OPEN} onClick={() => onOpen(mission.key)}>
          <span className={KEY}>{mission.key}</span>
          <span className={TITLE}>{mission.title}</span>
        </button>
        {mission.percent !== undefined && <span className={WHEN}>{String(mission.percent)}%</span>}
        <span className={WHEN}>{mission.event.when}</span>
      </div>
      <div className={LINE_TWO}>
        <BallMark ball={mission.ball} legend />
        <span className="min-w-0 flex-1 truncate">{mission.event.text}</span>
        <Marks marks={mission.marks} />
      </div>
    </li>
  )
}

const STAGE_HEAD = 'flex items-center gap-2 text-sm font-semibold'

const STAGE_TOGGLE =
  'flex h-control-sm items-center gap-2 rounded-md text-sm font-semibold outline-none hover:tinted focus-ring hover-motion'

const COUNT = 'text-sm font-normal text-muted-foreground tabular-nums'

function StageGroupB({
  stage,
  missions,
  onOpen,
}: {
  stage: Stage
  missions: readonly ExploredMission[]
  onOpen: (key: string) => void
}): ReactNode {
  const folding = useTransition(fold)
  const folds = stage === 'Done'
  const [open, setOpen] = useState(!folds)
  const head = (
    <>
      <span aria-hidden="true" className={STAGE_DOT[stage]} />
      <span>{stage}</span>
      <span className={COUNT}>{missions.length}</span>
    </>
  )
  const rows = (
    <Frame>
      <ul aria-label={`${stage} missions`} className="flex flex-col">
        {missions.map((mission) => (
          <RowB key={mission.key} mission={mission} onOpen={onOpen} />
        ))}
      </ul>
    </Frame>
  )
  return (
    <section className="flex flex-col gap-2">
      {folds ? (
        <button
          type="button"
          className={STAGE_TOGGLE}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {head}
        </button>
      ) : (
        <h2 className={STAGE_HEAD}>{head}</h2>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rows"
            className="overflow-hidden"
            initial={folds ? collapse : false}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            {rows}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

const COLUMNS = 'grid grid-cols-1 items-start gap-8 lg:grid-cols-3'

const MAIN = 'flex min-w-0 flex-col gap-6 lg:col-span-2'

const RAIL = 'flex min-w-0 flex-col gap-6'

export function ProjectB({
  missions,
  done,
  chats,
  results,
  typed,
  triage,
  onOpenMission,
  onCreate,
  onOpenChat,
  onOpenSpec,
  onOpenSettings,
}: ProjectProps): ReactNode {
  const all = [...missions, ...done]
  return (
    <Page>
      <PageHeader
        lead={<ProjectMark name="Acme" />}
        title="Acme"
        about={<span className="font-mono text-xs">api · web · shared</span>}
        actions={
          <Tooltip label="Project settings" side="bottom">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconSettings size="md" />}
              aria-label="Settings of Acme"
              onClick={onOpenSettings}
            />
          </Tooltip>
        }
      />
      <div className={COLUMNS}>
        <div className={MAIN}>
          <StartField
            project="Acme"
            initial={typed}
            results={results}
            triage={triage}
            onCreate={onCreate}
            onOpen={onOpenMission}
          />
          {all.length === 0 && (
            <Empty
              icon={<IconInbox size="md" />}
              title="No mission yet"
              description="The field above starts one, from a ticket or an idea."
            />
          )}
          {STAGE_ORDER.map((stage) => {
            const inStage = all.filter((mission) => mission.stage === stage)
            if (inStage.length === 0) return null
            return (
              <StageGroupB key={stage} stage={stage} missions={inStage} onOpen={onOpenMission} />
            )
          })}
        </div>
        <aside aria-label="About Acme" className={RAIL}>
          <Frame
            header={
              <FrameHeader
                icon={<IconBook2 size="md" />}
                title="Living spec"
                description="6 domains · updated yesterday"
                action={
                  <Button variant="link" size="sm" onClick={onOpenSpec}>
                    Open
                  </Button>
                }
              />
            }
          >
            <ul aria-label="Domains" className="flex flex-col py-1 text-sm">
              {['Billing', 'Customers', 'Exports'].map((domain) => (
                <li key={domain} className="px-4 py-1.5">
                  {domain}
                </li>
              ))}
            </ul>
          </Frame>
          <Frame
            header={
              <FrameHeader
                icon={<IconMessages size="md" />}
                title="Chats"
                action={
                  <Button variant="link" size="sm">
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
                  <ChatRow
                    key={chat.id}
                    title={chat.title}
                    when={chat.when}
                    onOpen={() => onOpenChat(chat.id)}
                  />
                ))}
              </ul>
            )}
          </Frame>
        </aside>
      </div>
    </Page>
  )
}

const HEADER = 'flex shrink-0 flex-col gap-2 px-8 pt-5 pb-3'

const LINE = 'flex min-h-control-md min-w-0 items-center gap-3'

const MISSION_KEY = 'shrink-0 font-mono text-sm text-muted-foreground'

const MISSION_TITLE = 'min-w-0 truncate text-xl font-semibold tracking-tight'

const END = 'ml-auto flex shrink-0 items-center gap-2'

const TRACK = 'flex min-w-0 items-center gap-1 text-sm'

const STEP = 'flex items-center gap-1.5 rounded-md px-2 py-0.5'

const STEP_PAST = 'text-muted-foreground'

const STEP_NOW = 'border border-border bg-card font-medium text-foreground'

const STEP_NEXT = 'text-muted-foreground'

const STEP_DOT_OFF = 'size-2 shrink-0 rounded-full border border-border'

const META = 'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'

const META_LINK =
  'flex min-w-0 items-center gap-1 rounded-sm outline-none hover:text-foreground focus-ring'

/** The six stages of a mission's life, the current one lit; the Spec's lock after Planning. */
function StageTrack({ mission }: { mission: ExploredMission }): ReactNode {
  const now = LIFE.indexOf(mission.stage)
  return (
    <ol aria-label="Stage" className={TRACK}>
      {LIFE.map((stage, index) => (
        <li
          key={stage}
          className="flex items-center gap-1"
          aria-current={index === now ? 'step' : undefined}
        >
          {index > 0 && (
            <span aria-hidden="true" className="text-border">
              ─
            </span>
          )}
          <span
            className={cn(STEP, index < now ? STEP_PAST : index === now ? STEP_NOW : STEP_NEXT)}
          >
            <span aria-hidden="true" className={index <= now ? STAGE_DOT[stage] : STEP_DOT_OFF} />
            {index === now ? stageLabel(mission) : stage}
            {stage === 'Planning' && mission.frozen && <FrozenGlyph />}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function MissionB({
  mission,
  needs,
  onCancel,
  onAction,
  onOpenSpec,
}: MissionProps): ReactNode {
  const action = ACTIONS[mission.stage]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={HEADER}>
        <div className={LINE}>
          <span className={MISSION_KEY}>{mission.key}</span>
          <h1 className={MISSION_TITLE}>{mission.title}</h1>
          <div className={END}>
            {action !== undefined && (
              <Button variant="primary" size="sm" onClick={onAction}>
                {action}
              </Button>
            )}
            {mission.stage !== 'Done' && (
              <CancelMission missionKey={mission.key} onCancel={onCancel} />
            )}
          </div>
        </div>
        <StageTrack mission={mission} />
        <div className={META}>
          <span className="flex items-center gap-1.5">
            <BallMark ball={mission.ball} legend face />
            <span>{BALL_LEGENDS[mission.ball]}</span>
          </span>
          <Marks marks={mission.marks} />
          <span className="capitalize">{mission.type}</span>
          {mission.ticket !== undefined && <TicketLink ticket={mission.ticket} />}
          {mission.branch !== undefined && (
            <span className="flex min-w-0 items-center gap-1">
              <IconGitBranch size="sm" />
              <span className="truncate font-mono">{mission.branch}</span>
            </span>
          )}
          <button type="button" className={META_LINK} onClick={onOpenSpec}>
            <IconFileText size="sm" />
            <span className="truncate">Spec</span>
          </button>
        </div>
      </div>
      <MissionNeeds needs={needs} />
      <StageBase stage={mission.stage} />
    </div>
  )
}

const CALLING = 'flex min-h-control-md min-w-0 items-start gap-2 px-3 py-2 text-sm'

const CALLING_OPEN =
  'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm text-left outline-none focus-ring hover:text-primary hover-motion'

function CallingList({
  label,
  rows,
  onOpen,
}: {
  label: string
  rows: HomeProps['needs']
  onOpen: (key: string) => void
}): ReactNode {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <SectionHead title={label} count={rows.length || undefined} calls />
      <Frame>
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">Nothing waits for you.</p>
        ) : (
          <ul aria-label={label} className="flex flex-col">
            {rows.map((row) => (
              <li
                key={`${row.key} ${row.title}`}
                className={cn(CALLING, 'border-b border-border last:border-b-0')}
              >
                <span className="flex pt-0.5">
                  <StatusMark state="waiting" size="sm" />
                </span>
                <button type="button" className={CALLING_OPEN} onClick={() => onOpen(row.key)}>
                  <span className="line-clamp-2">{row.title}</span>
                  <span className={KEY}>
                    {row.key} · {row.when}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Frame>
    </section>
  )
}

export function HomeB({ today, needs, questions, night, recent, onOpen }: HomeProps): ReactNode {
  const quiet = needs.length === 0 && questions.length === 0 && night.length === 0
  return (
    <Page>
      <PageHeader title="Home" about={<span>{today}</span>} />
      <div className={COLUMNS}>
        <div className={MAIN}>
          <section aria-label="Since you left" className="flex flex-col gap-3">
            <SectionHead title="Since you left" count={night.length || undefined} />
            {quiet ? (
              <Empty
                face="asleep"
                title="All quiet"
                description="Nothing ran while you were away."
              />
            ) : night.length === 0 ? (
              <Frame>
                <p className="px-4 py-3 text-sm text-muted-foreground">Nothing happened.</p>
              </Frame>
            ) : (
              <ul aria-label="Since you left" className="flex flex-col gap-3">
                {night.map((group) => (
                  <li key={group.key}>
                    <Frame
                      header={
                        <div className="flex min-w-0 items-center gap-3 px-2.5 pt-1.5 pb-2">
                          <BallMark ball={group.ball} legend />
                          <LetterAvatar name={group.project} />
                          <button type="button" className={OPEN} onClick={() => onOpen(group.key)}>
                            <span className={KEY}>{group.key}</span>
                            <span className={TITLE}>{group.title}</span>
                          </button>
                        </div>
                      }
                    >
                      <ul aria-label={`What happened to ${group.key}`} className="flex flex-col">
                        {group.events.map((event) => (
                          <li
                            key={event.text}
                            className="flex min-h-control-md min-w-0 items-center gap-3 border-b border-border px-4 text-sm last:border-b-0"
                          >
                            <NightMark tone={event.tone} />
                            <span className="min-w-0 flex-1 truncate">{event.text}</span>
                            <span className={WHEN}>{event.when}</span>
                          </li>
                        ))}
                      </ul>
                    </Frame>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Recent" className="flex flex-col gap-3">
            <SectionHead title="Recent" />
            <Frame>
              {recent.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">No mission yet.</p>
              ) : (
                <ul aria-label="Recent" className="flex flex-col">
                  {recent.map((mission) => (
                    <RowB key={mission.key} mission={mission} project="Acme" onOpen={onOpen} />
                  ))}
                </ul>
              )}
            </Frame>
          </section>
        </div>
        <aside aria-label="What calls" className={RAIL}>
          <CallingList label="Needs you" rows={needs} onOpen={onOpen} />
          {questions.length > 0 && (
            <CallingList label="Questions" rows={questions} onOpen={onOpen} />
          )}
        </aside>
      </div>
    </Page>
  )
}
