import { type ReactNode, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { IconMinus, IconSquare, IconX } from '../icons.ts'
import { HomeShellFixture } from '../surfaces/home/home-shell-fixture.tsx'
import {
  MissionBody,
  type MissionMachine,
  useMissionMachine,
} from '../surfaces/mission/mission-shell-fixture.tsx'
import { ProjectShellFixture } from '../surfaces/project/project-shell-fixture.tsx'
import { ChatPage } from '../surfaces/chat/chat-page.tsx'
import { CONVERSATION } from '../surfaces/chat/chat-fixtures.ts'
import { AGENTS } from '../components/model-picker/model-picker-fixtures.ts'
import { MENTIONABLES } from '../components/mention-field/mention-field-fixtures.ts'
import { ContentHeader, type Crumb } from './content-header.tsx'
import { EngineVeil, type EngineState } from './engine-veil.tsx'
import { type NoticeItem, NoticeStack } from './notice.tsx'
import { ACME, CHATS, LONG_TITLE, MISSION, STAGE } from './shell-cast.ts'
import { SidebarMissionsFixture } from './sidebar-shell-fixture.tsx'
import { Sidebar, type SidebarPlace, type SidebarProject } from './sidebar.tsx'
import { WindowShell } from './window-shell.tsx'
import { PROJECTS } from './shell-data.ts'

export { CHATS, LONG_TITLE, MISSION, REPOSITORIES } from './shell-cast.ts'

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

/** A Chat of Acme, with the state its page holds: what is being written. */
function ChatFixture({ title }: { title: string }): ReactNode {
  const [draft, setDraft] = useState('')
  const none = () => {}
  return (
    <ChatPage
      title={title}
      project={ACME}
      checkout="~/code/acme"
      agents={AGENTS}
      model={{ agent: 'claude', model: 'sonnet' }}
      items={CONVERSATION}
      turn="idle"
      mentionables={MENTIONABLES}
      draft={draft}
      onDraft={setDraft}
      onSend={() => setDraft('')}
      onStop={none}
      onModel={none}
      onFavourite={none}
      onHide={none}
      onAnswer={none}
      onOpenMission={none}
      onRename={none}
      onRetry={none}
    />
  )
}

/** Where the window is: which page the sheet shows. */
export type AppPage =
  | { kind: 'home' }
  | { kind: 'project'; id: string }
  | { kind: 'mission'; key: string }
  | { kind: 'chat'; id: string }
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
  /** Whether the sidebar shows Acme's Chats under its missions. */
  withChats?: boolean
  dense?: boolean
}

/** The sidebar's place for the page the sheet shows. */
function placeOf(page: AppPage): SidebarPlace {
  switch (page.kind) {
    case 'project':
      return { kind: 'project', id: page.id }
    case 'mission':
      return { kind: 'mission', key: page.key }
    case 'chat':
      return { kind: 'chat', id: page.id }
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
    case 'chat':
      return [
        { id: 'project', label: ACME.name, onPress: goAcme },
        { id: 'chat', label: CHATS.find((chat) => chat.id === page.id)?.title ?? 'Chat' },
      ]
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
  withChats = false,
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
    (withMissions || withChats) && project.id === ACME.id ? (
      <SidebarMissionsFixture
        current={place}
        dense={dense}
        withChats={withChats}
        onMission={goMission}
        onChat={(id) => setPage({ kind: 'chat', id })}
      />
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
        <HomeShellFixture
          projects={projects}
          loading={loading}
          error={error}
          dense={dense}
          onOpen={() => goMission('ACME-12')}
        />
      )}
      {page.kind === 'project' && (
        <ProjectShellFixture
          name={projectName(page.id)}
          filled={page.id === ACME.id || page.id === 'p3'}
          onOpenMission={goMission}
        />
      )}
      {page.kind === 'mission' && (
        <MissionBody machine={machine} title={dense ? LONG_TITLE : MISSION.title} />
      )}
      {page.kind === 'chat' && (
        <ChatFixture title={CHATS.find((chat) => chat.id === page.id)?.title ?? 'Chat'} />
      )}
      {page.kind === 'settings' && (
        <div className="px-8 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        </div>
      )}
    </WindowShell>
  )
}
