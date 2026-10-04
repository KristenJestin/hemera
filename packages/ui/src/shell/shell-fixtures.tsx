import { type ReactNode, useState } from 'react'

import type { Ball } from '../blocks/ball/ball-mark.tsx'
import { BallMark } from '../blocks/ball/ball-mark.tsx'
import { Button } from '../components/button/button.tsx'
import { ACME_LOGO } from '../components/project-mark/project-mark-fixtures.ts'
import { IconButton } from '../components/button/button.tsx'
import {
  IconBook2,
  IconFileText,
  IconGitCompare,
  IconListCheck,
  IconMessages,
  IconMinus,
  IconSquare,
  IconX,
} from '../icons.ts'
import type { HomeRow } from '../surfaces/home/home-page.tsx'
import { HomePage } from '../surfaces/home/home-page.tsx'
import type { MissionView } from '../surfaces/mission/mission-frame.tsx'
import { MissionFrame } from '../surfaces/mission/mission-frame.tsx'
import {
  AT_BASE,
  type MissionFrameState,
  closeView,
  openView,
  showView,
} from '../surfaces/mission/navigation.ts'
import { ReviewStage, type ReviewStageProps } from '../surfaces/mission/review-stage.tsx'
import type { ProjectStageGroup } from '../surfaces/project/project-page.tsx'
import { ProjectPage } from '../surfaces/project/project-page.tsx'
import { ContentHeader, type Crumb } from './content-header.tsx'
import { EngineVeil, type EngineState } from './engine-veil.tsx'
import { type NoticeItem, NoticeStack } from './notice.tsx'
import { Sidebar, type SidebarPlace, type SidebarProject, SidebarRow } from './sidebar.tsx'
import { WindowShell } from './window-shell.tsx'

/**
 * The neutral case every story of the shell is drawn on: a Project "Acme" with the repositories
 * `api`, `web` and `shared`, its mission `ACME-12` in Review, and Hemera itself as a second
 * Project. And a small machine around the shell — where the user is, the sidebar's fold, the
 * views open over a mission, the notifications — so a story can walk the journey a window
 * walks. Nothing here is an engine: a story holds the state the renderer's hooks will hold.
 */
export const ACME = { id: 'acme', name: 'Acme' }
export const HEMERA = { id: 'hemera', name: 'Hemera' }

export const PROJECTS: readonly SidebarProject[] = [ACME, HEMERA]

/** A long name in every field: what a Project of a real team can be called. */
export const LONG_NAME = 'Acme Platform Services and Internal Tooling (monorepo, 2026)'

/** Twelve Projects, most of them long: the sidebar at its densest. */
export const MANY_PROJECTS: readonly SidebarProject[] = [
  ACME,
  HEMERA,
  { id: 'p3', name: LONG_NAME },
  { id: 'p4', name: 'Billing' },
  { id: 'p5', name: 'Customer portal and self-service onboarding' },
  { id: 'p6', name: 'Data pipeline' },
  { id: 'p7', name: 'Design system' },
  { id: 'p8', name: 'Edge workers' },
  { id: 'p9', name: 'Fleet' },
  { id: 'p10', name: 'Gateway and public API documentation site' },
  { id: 'p11', name: 'Helpdesk' },
  { id: 'p12', name: 'Infrastructure as code' },
]

/** Projects marked as their users chose: an icon in a tone, a logo, and letters. */
export const MARKED_PROJECTS: readonly SidebarProject[] = [
  ACME,
  { ...HEMERA, identity: { tone: 'primary', icon: 'rocket' } },
  { id: 'p4', name: 'Billing', identity: { image: ACME_LOGO } },
  { id: 'p6', name: 'Data pipeline', identity: { tone: 'build', icon: 'database' } },
  { id: 'p7', name: 'Design system', identity: { tone: 'warning' } },
]

export const MISSION = {
  key: 'ACME-12',
  title: 'Export invoices as CSV from the billing page',
  branch: 'feat/acme-12-export-invoices',
  spec: 'frozen yesterday at 17:02',
}

export const STAGE = { label: 'Review · round 1', tone: 'warning' } as const

export const LONG_TITLE =
  'Export invoices as CSV from the billing page, with the customer filters kept and a progress for the long ones'

export const REPOSITORIES = [{ name: 'api' }, { name: 'web' }, { name: 'shared' }]

export const HOME_ROWS: Record<'needsYou' | 'questions' | 'sinceYouLeft' | 'recent', HomeRow[]> = {
  needsYou: [
    {
      id: 'n1',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: 'Run the migration on the shared database',
      when: '08:56',
      ball: 'you',
    },
    {
      id: 'n2',
      project: 'Hemera',
      missionKey: 'HEM-58',
      title: 'A comment on the pull request waits for an answer',
      when: '08:47',
      ball: 'you',
    },
  ],
  questions: [
    {
      id: 'q1',
      project: 'Acme',
      missionKey: 'ACME-14',
      title: 'Who may read the audit log?',
      when: '08:41',
      ball: 'you',
    },
  ],
  sinceYouLeft: [
    {
      id: 's1',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: 'Checks green after the second round',
      when: '08:58',
      ball: 'agent',
    },
    {
      id: 's2',
      project: 'Acme',
      missionKey: 'ACME-9',
      title: 'Shipped: the export of movements',
      when: 'yesterday',
      ball: 'idle',
    },
  ],
  recent: [
    {
      id: 'r1',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: MISSION.title,
      when: '09:02',
      ball: 'agent',
    },
    {
      id: 'r2',
      project: 'Hemera',
      missionKey: 'HEM-62',
      title: 'Probe worktrees survive a restart',
      when: 'yesterday',
      ball: 'someone',
    },
  ],
}

const BALLS: readonly Ball[] = ['agent', 'you', 'someone', 'blocked', 'idle']

/**
 * A list many rows long, every title long. What waits for the user holds only rows that wait
 * for the user; the other lists hold missions in every state.
 */
export function denseRows(count: number, waiting = false): HomeRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `d${String(index)}`,
    project: index % 3 === 0 ? 'Hemera' : 'Acme',
    missionKey: `ACME-${String(100 + index)}`,
    title: `${LONG_TITLE} (${String(index + 1)})`,
    when: `${String(8 + (index % 10))}:${String(10 + index).padStart(2, '0')}`,
    ball: waiting ? 'you' : (BALLS[index % BALLS.length] ?? 'idle'),
  }))
}

/** The missions done in Acme, folded away at the end of its page. */
export const DONE_GROUP: ProjectStageGroup = {
  stage: 'Done',
  fold: 'folded',
  rows: [
    { missionKey: 'ACME-9', title: 'Export the movements', when: 'yesterday', ball: 'idle' },
    { missionKey: 'ACME-8', title: 'Sort invoices by due date', when: 'Monday', ball: 'idle' },
    { missionKey: 'ACME-7', title: 'A filter on the customer', when: 'Monday', ball: 'idle' },
    { missionKey: 'ACME-5', title: 'Rename the billing tab', when: 'last week', ball: 'idle' },
  ],
}

export const STAGE_GROUPS: readonly ProjectStageGroup[] = [
  {
    stage: 'Review',
    rows: [{ missionKey: 'ACME-12', title: MISSION.title, when: '09:02', ball: 'you' }],
  },
  {
    stage: 'Building',
    rows: [
      {
        missionKey: 'ACME-15',
        title: 'Retry a failed webhook from its row',
        when: '08:40',
        ball: 'agent',
      },
    ],
  },
  {
    stage: 'Planning',
    rows: [
      {
        missionKey: 'ACME-14',
        title: 'An audit log of who read what',
        when: 'yesterday',
        ball: 'someone',
      },
    ],
  },
  {
    stage: 'Ready',
    rows: [
      {
        missionKey: 'ACME-16',
        title: 'Labels in French and English',
        when: 'yesterday',
        ball: 'blocked',
      },
    ],
  },
  DONE_GROUP,
]

/** A minute and a half ago, for the services that run. */
const AGO = Date.now() - 84_000

/** What the Review stage of ACME-12 shows: the data of its page, without its callbacks. */
export const REVIEW: Omit<
  ReviewStageProps,
  'onAddRemark' | 'onFix' | 'onOpenTask' | 'onService' | 'onOpenRound' | 'onOpenDiff' | 'chosenTask'
> = {
  remarks: [
    {
      id: 'F1',
      text: 'The date column follows the browser, not the customer.',
      state: 'addressed',
      round: 1,
    },
    {
      id: 'F2',
      text: 'The file name keeps the filters, but not the date range.',
      state: 'resolved',
      round: 1,
    },
    {
      id: 'F3',
      text: 'The empty state of the billing page lost its icon.',
      state: 'resolved',
      round: 1,
    },
    { id: 'F4', text: 'Two exports at once give the same file name.', state: 'inRound', round: 1 },
    { id: 'F5', text: 'A long export shows no progress at all.', state: 'pending' },
  ],
  nextRound: 2,
  requirements: [
    {
      id: 'R1',
      title: 'Export the invoices of the current filters as CSV',
      proven: true,
      tasks: [
        { id: 'T1', title: 'Add the export endpoint', state: 'done', repositories: ['api'] },
        { id: 'T2', title: 'Stream the rows', state: 'done', repositories: ['api'] },
        {
          id: 'T3',
          title: 'The export button on the billing page',
          state: 'done',
          repositories: ['web'],
        },
      ],
    },
    {
      id: 'R2',
      title: 'Name the file after the filters',
      proven: true,
      tasks: [{ id: 'T4', title: 'Build the file name', state: 'done', repositories: ['shared'] }],
    },
    {
      id: 'R3',
      title: 'Show a progress for long exports',
      proven: false,
      tasks: [
        { id: 'T5', title: 'Count the rows first', state: 'running', repositories: ['api'] },
        { id: 'T6', title: 'A progress on the button', state: 'todo', repositories: ['web'] },
      ],
    },
  ],
  proofs: [
    { id: 'S1', test: 'api/tests/invoices-export.test.ts', state: 'green' },
    { id: 'S2', test: 'web/e2e/billing-export.spec.ts', state: 'green' },
    { id: 'S3', test: 'api/tests/invoices-export-progress.test.ts', state: 'red' },
  ],
  services: [
    {
      name: 'api',
      state: 'running',
      startedAt: AGO,
      endedAt: null,
      url: 'http://localhost:3012',
      line: 'pnpm --filter api dev',
    },
    {
      name: 'web',
      state: 'running',
      startedAt: AGO,
      endedAt: null,
      url: 'http://localhost:4212',
      line: 'pnpm --filter web dev',
    },
  ],
  rounds: [{ n: 1, points: 4, state: 'closed' }],
  checks: [
    { repository: 'api', name: 'test', state: 'done', after: 'final' },
    { repository: 'api', name: 'typecheck', state: 'done', after: 'final' },
    { repository: 'web', name: 'test', state: 'done', after: 'final' },
    { repository: 'web', name: 'lint', state: 'failed', after: 'after R3' },
  ],
  changes: [
    { repository: 'api', files: 14, added: 412, deleted: 38 },
    { repository: 'web', files: 3, added: 96, deleted: 12, outside: true },
    { repository: 'shared', files: 1, added: 18, deleted: 0 },
  ],
}

/** A body for a view, with the lines a story needs to scroll. */
function Prose({ title, lines, wide = false }: { title: string; lines: number; wide?: boolean }) {
  return (
    <div
      className={
        wide ? 'flex flex-col gap-3 px-6 py-5' : 'flex max-w-measure flex-col gap-3 px-6 py-5'
      }
    >
      <p className="text-sm text-muted-foreground">{title}</p>
      {Array.from({ length: lines }, (_, index) => (
        <p key={index} className="text-base">
          Line {index + 1} of the view, written by the agent and read here; what it says is a later
          ticket's, its width and its scroll are this one's.
        </p>
      ))}
    </div>
  )
}

/** The views ACME-12 can open over its Review page, by id; a task's id is `task:T2`. */
export function viewsOf(openSpec: () => void): readonly MissionView[] {
  const tasks = REVIEW.requirements.flatMap((requirement) => requirement.tasks)
  return [
    {
      id: 'spec',
      title: 'Spec',
      icon: <IconFileText size="sm" />,
      width: 'wide',
      actions: (
        <Button variant="ghost" size="sm">
          Copy as Markdown
        </Button>
      ),
      body: <Prose title="Frozen yesterday at 17:02" lines={30} />,
    },
    ...tasks.map((task): MissionView => ({
      id: `task:${task.id}`,
      title: `${task.id} · ${task.title}`,
      icon: <IconListCheck size="sm" />,
      width: 'narrow',
      body: <Prose title={`${task.repositories.join(', ')} · ${task.state}`} lines={12} />,
    })),
    {
      id: 'round:1',
      title: 'Round 1',
      icon: <IconMessages size="sm" />,
      width: 'narrow',
      actions: (
        <Button variant="secondary" size="sm" onClick={openSpec}>
          Open the Spec
        </Button>
      ),
      body: <Prose title="Four points, all addressed" lines={10} />,
    },
    {
      id: 'diff',
      title: 'Diff',
      icon: <IconGitCompare size="sm" />,
      width: 'wide',
      body: <Prose title="14 files in api, 3 in web, 1 in shared" lines={60} wide />,
    },
    {
      id: 'memory',
      title: 'Memory',
      icon: <IconBook2 size="sm" />,
      width: 'wide',
      body: <Prose title="Now, Journal, Notes" lines={20} />,
    },
  ]
}

/** The title a view's crumb or tab carries. */
function titleOf(views: readonly MissionView[], id: string): string {
  return views.find((view) => view.id === id)?.title ?? id
}

/** The system's controls, drawn by the catalogue; out of the tab order, as the window's are. */
export function SystemControls(): ReactNode {
  return (
    <span className="flex items-center no-drag">
      <IconButton
        variant="ghost"
        size="sm"
        icon={<IconMinus size="sm" />}
        aria-label="Minimise"
        tabIndex={-1}
      />
      <IconButton
        variant="ghost"
        size="sm"
        icon={<IconSquare size="sm" />}
        aria-label="Maximise"
        tabIndex={-1}
      />
      <IconButton
        variant="ghost"
        size="sm"
        icon={<IconX size="sm" />}
        aria-label="Close"
        tabIndex={-1}
      />
    </span>
  )
}

export const NOTICES: readonly NoticeItem[] = [
  {
    id: 'n1',
    tone: 'you',
    project: 'Acme',
    missionKey: 'ACME-12',
    title: 'Run the migration on the shared database',
    detail: 'The Builder asks before touching it',
  },
  {
    id: 'n2',
    tone: 'done',
    project: 'Acme',
    missionKey: 'ACME-9',
    title: 'Shipped',
    detail: 'api and web merged, the release is tagged',
  },
  {
    id: 'n3',
    tone: 'failed',
    project: 'Hemera',
    missionKey: 'HEM-58',
    title: 'Checks failed after the merge',
    detail: 'verify on Windows: 2 tests',
  },
  {
    id: 'n4',
    tone: 'outside',
    project: 'Acme',
    title: 'web changed outside Hemera',
    detail: 'main moved by 3 commits',
  },
]

export interface MissionMachine {
  state: MissionFrameState
  views: readonly MissionView[]
  open: (id: string) => void
  show: (id: string | null) => void
  close: (id: string) => void
  /** The crumbs of the window's trail after the stage: the open views. */
  crumbs: readonly Crumb[]
}

/** The state of a mission's views, as the renderer's hook will hold it. */
export function useMissionMachine(initial: MissionFrameState = AT_BASE): MissionMachine {
  const [state, setState] = useState(initial)
  const open = (id: string): void => setState((before) => openView(before, id))
  const views = viewsOf(() => open('spec'))
  const show = (id: string | null): void => setState((before) => showView(before, id))
  const close = (id: string): void => setState((before) => closeView(before, id))
  const crumbs: Crumb[] = state.open.map((id) => ({
    id: `view:${id}`,
    label: titleOf(views, id),
    icon: views.find((view) => view.id === id)?.icon,
    onPress: () => show(id),
  }))
  return { state, views, open, show, close, crumbs }
}

/** The mission frame of ACME-12 on its Review page, driven by a machine. */
export function MissionBody({
  machine,
  title = MISSION.title,
}: {
  machine: MissionMachine
  title?: string | undefined
}): ReactNode {
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  return (
    <MissionFrame
      missionKey={MISSION.key}
      title={title}
      stage={STAGE}
      ball="you"
      branch={MISSION.branch}
      spec={MISSION.spec}
      onOpenSpec={() => machine.open('spec')}
      action={<Button variant="primary">Ship</Button>}
      more={[
        { label: 'Memory', icon: <IconBook2 size="sm" />, onSelect: () => machine.open('memory') },
        { label: 'Diff', icon: <IconGitCompare size="sm" />, onSelect: () => machine.open('diff') },
      ]}
      onCancel={() => {}}
      base={
        <ReviewStage
          {...REVIEW}
          chosenTask={chosen}
          onAddRemark={() => {}}
          onFix={() => {}}
          onOpenTask={(id) => {
            setChosen(id)
            machine.open(`task:${id}`)
          }}
          onService={() => {}}
          onOpenRound={(n) => machine.open(`round:${String(n)}`)}
          onOpenDiff={() => machine.open('diff')}
        />
      }
      views={machine.views}
      open={machine.state.open}
      shown={machine.state.shown}
      onShow={machine.show}
      onClose={machine.close}
    />
  )
}

/** The mission frame alone, under the header that carries its trail: for the mission's stories. */
export function MissionFixture({
  title,
  initial,
}: {
  title?: string | undefined
  initial?: MissionFrameState | undefined
}): ReactNode {
  const machine = useMissionMachine(initial)
  const crumbs: Crumb[] = [
    { id: 'project', label: ACME.name, onPress: () => {} },
    { id: 'mission', label: MISSION.key, mono: true, onPress: () => machine.show(null) },
    { id: 'stage', label: STAGE.label, onPress: () => machine.show(null) },
    ...machine.crumbs,
  ]
  return (
    <div className="flex h-screen flex-col bg-surface-content">
      <ContentHeader folded={false} onFold={() => {}} crumbs={crumbs} />
      <MissionBody machine={machine} title={title} />
    </div>
  )
}

/** Where the window is: which page the sheet shows. */
export type AppPage =
  | { kind: 'home' }
  | { kind: 'project'; id: string }
  | { kind: 'mission'; key: string }
  | { kind: 'settings' }

export interface AppFixtureProps {
  page?: AppPage
  folded?: boolean
  projects?: readonly SidebarProject[]
  waiting?: number
  /** Whether the Projects are on their way. */
  loading?: boolean
  error?: string
  engine?: EngineState
  notices?: readonly NoticeItem[]
  /** Whether the sidebar shows missions under Acme, the room a later ticket fills. */
  withMissions?: boolean
  dense?: boolean
}

/** The sidebar's place for the page the sheet shows. */
function placeOf(page: AppPage): SidebarPlace {
  switch (page.kind) {
    case 'project':
      return { kind: 'project', id: page.id }
    case 'mission':
      return { kind: 'mission', key: page.key }
    case 'settings':
      return { kind: 'settings' }
    case 'home':
      return { kind: 'home' }
  }
}

/** The window's trail for the page the sheet shows. */
function crumbsOf(
  page: AppPage,
  projectName: (id: string) => string,
  machine: MissionMachine,
  goAcme: () => void,
): Crumb[] {
  switch (page.kind) {
    case 'home':
      return [{ id: 'home', label: 'Home' }]
    case 'settings':
      return [{ id: 'settings', label: 'Settings' }]
    case 'project':
      return [{ id: 'project', label: projectName(page.id) }]
    case 'mission':
      return [
        { id: 'project', label: ACME.name, onPress: goAcme },
        { id: 'mission', label: page.key, mono: true, onPress: () => machine.show(null) },
        { id: 'stage', label: STAGE.label, onPress: () => machine.show(null) },
        ...machine.crumbs,
      ]
  }
}

/** The window, with the state a renderer will hold: enough to walk from Home to a view. */
export function AppFixture({
  page: first = { kind: 'home' },
  folded: foldedAtFirst = false,
  projects = PROJECTS,
  waiting = 2,
  loading = false,
  error,
  engine,
  notices: noticesAtFirst = [],
  withMissions = false,
  dense = false,
}: AppFixtureProps): ReactNode {
  const [page, setPage] = useState<AppPage>(first)
  const [folded, setFolded] = useState(foldedAtFirst)
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set([ACME.id]))
  const [notices, setNotices] = useState(noticesAtFirst)
  const machine = useMissionMachine()
  const place = placeOf(page)
  const dismiss = (id: string): void =>
    setNotices((before) => before.filter((notice) => notice.id !== id))
  const goMission = (key: string): void => {
    machine.show(null)
    setPage({ kind: 'mission', key })
  }
  const under = (project: SidebarProject): ReactNode =>
    withMissions && project.id === ACME.id ? (
      <>
        <SidebarRow
          missionKey="ACME-12"
          title={dense ? LONG_TITLE : MISSION.title}
          trailing={<BallMark ball="you" />}
          current={page.kind === 'mission' && page.key === 'ACME-12'}
          onPress={() => goMission('ACME-12')}
        />
        <SidebarRow
          missionKey="ACME-15"
          title="Retry a failed webhook from its row"
          trailing={<BallMark ball="agent" />}
          current={page.kind === 'mission' && page.key === 'ACME-15'}
          onPress={() => goMission('ACME-15')}
        />
      </>
    ) : undefined
  const projectName = (id: string): string =>
    projects.find((project) => project.id === id)?.name ?? id
  const crumbs = crumbsOf(page, projectName, machine, () =>
    setPage({ kind: 'project', id: ACME.id }),
  )
  return (
    <WindowShell
      sidebar={
        <Sidebar
          folded={folded}
          waiting={waiting}
          projects={projects.map((project) => ({ ...project, under: under(project) }))}
          opened={opened}
          onOpen={(id, open) =>
            setOpened((before) => {
              const next = new Set(before)
              if (open) next.add(id)
              else next.delete(id)
              return next
            })
          }
          loading={loading}
          error={error}
          current={place}
          onHome={() => setPage({ kind: 'home' })}
          onProject={(id) => setPage({ kind: 'project', id })}
          onAddProject={() => {}}
          onSettings={() => setPage({ kind: 'settings' })}
        />
      }
      header={
        <ContentHeader
          folded={folded}
          onFold={setFolded}
          crumbs={crumbs}
          controls={<SystemControls />}
        />
      }
      overlay={
        <>
          {engine !== undefined && (
            <EngineVeil
              state={engine}
              maxDelay={10}
              reason={engine === 'stopped' ? 'The engine process exited with code 1.' : undefined}
              onRestart={() => {}}
              onShowLog={() => {}}
            />
          )}
          <NoticeStack
            notices={notices}
            onOpen={(id) => {
              const notice = notices.find((one) => one.id === id)
              if (notice?.missionKey !== undefined) goMission(notice.missionKey)
              dismiss(id)
            }}
            onDismiss={dismiss}
          />
        </>
      }
    >
      {page.kind === 'home' && (
        <HomePage
          today="Saturday 4 October"
          hasProjects={projects.length > 0 || loading}
          needsYou={{
            rows: dense ? denseRows(9, true) : projects.length > 0 ? HOME_ROWS.needsYou : [],
          }}
          questions={{
            rows: dense ? denseRows(6, true) : projects.length > 0 ? HOME_ROWS.questions : [],
          }}
          sinceYouLeft={{
            rows: dense ? denseRows(14) : projects.length > 0 ? HOME_ROWS.sinceYouLeft : [],
          }}
          recent={{ rows: dense ? denseRows(8) : projects.length > 0 ? HOME_ROWS.recent : [] }}
          loading={loading}
          error={error}
          onOpen={() => goMission('ACME-12')}
          onAddProject={() => {}}
          onRetry={() => {}}
        />
      )}
      {page.kind === 'project' && (
        <ProjectPage
          name={projectName(page.id)}
          repositories={REPOSITORIES}
          groups={page.id === ACME.id || page.id === 'p3' ? STAGE_GROUPS : []}
          onStart={() => {}}
          onOpenMission={goMission}
          onOpenSettings={() => {}}
          onRetry={() => {}}
        />
      )}
      {page.kind === 'mission' && (
        <MissionBody machine={machine} title={dense ? LONG_TITLE : MISSION.title} />
      )}
      {page.kind === 'settings' && (
        <div className="px-8 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        </div>
      )}
    </WindowShell>
  )
}
