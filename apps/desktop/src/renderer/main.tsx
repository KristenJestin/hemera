import type { ThemePreference } from '@hemera/ipc'
import { NoticeStack, TooltipProvider } from '@hemera/ui'
import { MotionConfig } from 'motion/react'
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

// oxlint-disable-next-line import/no-unassigned-import
import './window.css'
import { AddProjectDialog, type AddingTools } from './add-project.tsx'
import { AgentSection } from './agent-sections.tsx'
import { AppSettingsPage, type AppSettingsTools } from './app-settings.tsx'
import { FirstLaunchRoute } from './first-launch-route.tsx'
import { ChatRoute, ProjectChats } from './chat-route.tsx'
import { HomeRoute } from './home-route.tsx'
import { LivingSpecRoute } from './living-spec-route.tsx'
import { MissionRoute } from './mission-route.tsx'
import { ProjectRoute } from './project-route.tsx'
import { connect } from './link.ts'
import {
  START,
  close as closeView,
  focusOf,
  frameOf,
  go,
  goMissionView,
  landedAfterSetup,
  linkedSettings,
  open as openView,
  placeOf,
  routeOf,
  sectionOf,
  show,
  type Navigation,
  type Route,
} from './navigation.ts'
import { SettingsPage, type SettingsTools } from './settings-page.tsx'
import { SidebarMissions } from './sidebar-missions.tsx'
import { ProjectSetupTask, useSetupLaunches, useSetupOffer } from './setup-task.tsx'
import { Shell } from './shell.tsx'
import { DARK_QUERY, wearTheme } from './theme.ts'
import { useChats } from './use-chats.ts'
import { useEngine } from './use-engine.ts'
import { useMinute, useNeeds } from './use-needs.ts'
import { useNotices } from './use-notices.ts'
import { useProject, useProjects } from './use-projects.ts'
import { TicketSection } from './ticket-sections.tsx'
import { useTicketProblem } from './ticket-providers.tsx'
import { useSettings } from './use-settings.ts'

const root = document.querySelector('#root')
if (root === null) throw new Error('the page has no root to mount on')

// `index.html` wore the theme before the first paint; this keeps it as main changes it.
wearTheme(
  (dark) => document.documentElement.classList.toggle('dark', dark),
  window.matchMedia(DARK_QUERY),
)

/** One link per page: a page that reloads opens a new one. */
const link = connect()

/** Today as Home says it: "Saturday 4 October". */
const TODAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

/** What adding a Project asks of the engine and of main. */
const ADDING: AddingTools = {
  detect: (folder) => link.detectRepositories(folder),
  create: (project) => link.createProject(project),
  chooseFolder: () => link.chooseFolder(),
}

/** What a Project's settings ask of the window besides the engine. */
const settingsTools = (dataFolder: string): SettingsTools => ({
  chooseFolder: () => link.chooseFolder(),
  checkLine: (line) => link.checkLine(line).then(({ problem }) => problem),
  copy: (text) => void navigator.clipboard.writeText(text),
  // Main hands a web address to the user's own browser rather than to this window.
  open: (url) => void window.open(url, '_blank', 'noopener'),
  dataFolder,
})

/** What the application's settings ask of the window besides the engine. */
const SETTINGS_TOOLS: AppSettingsTools = {
  copy: (text) => void navigator.clipboard.writeText(text),
  chooseFolder: () => link.chooseFolder(),
  showLog: () => void link.showLog(),
}

/** The keystroke that folds and opens the sidebar, as its button's tooltip says: Ctrl+B. */
const isFoldKey = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === 'b'

function Application() {
  const engine = useEngine(link)
  const ready = engine.kind === 'ready'
  const [navigation, setNavigation] = useState<Navigation>(START)
  const [folded, setFolded] = useState(false)
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const { route } = navigation
  const shownProject =
    route.kind === 'project' || route.kind === 'projectSettings'
      ? route.id
      : route.kind === 'chat' || route.kind === 'livingSpec'
        ? route.projectId
        : null
  const [projects, retryProjects] = useProjects(link, ready)
  const [project, retryProject] = useProject(link, ready, shownProject)
  const [needs, answering] = useNeeds(link, ready)
  const now = useMinute()
  const routeChats = useChats(link, ready, route.kind === 'chat' ? route.projectId : null)
  const [adding, setAdding] = useState(false)
  const [theme, setTheme] = useState<ThemePreference | null>(null)
  useEffect(() => {
    if (!ready) return
    link.preferences().then(
      (preferences) => setTheme(preferences.theme),
      () => undefined,
    )
  }, [ready])
  const settingsOf = route.kind === 'projectSettings' ? route.id : null
  const ticketProblem = useTicketProblem(link, ready, settingsOf)
  const [settingsData, settings] = useSettings(link, ready, settingsOf)
  /** How many times the Project's models by role were changed in its settings. */
  const [roleChanges, setRoleChanges] = useState(0)
  // Read each time the add dialog opens, or the settings show, change Project or models by role.
  const setupOffer = useSetupOffer(link, ready && adding, null)
  const settingsOffer = useSetupOffer(
    link,
    ready && settingsOf !== null,
    settingsOf,
    `${settingsOf ?? ''} ${String(roleChanges)}`,
  )
  const launches = useSetupLaunches(link)
  const settingsLaunch = settingsOf === null ? null : launches.of(settingsOf)
  const dataFolder = engine.kind === 'ready' ? engine.status.dataFolder : ''
  const tools = useMemo(() => settingsTools(dataFolder), [dataFolder])
  const { notices, open, dismiss } = useNotices(link, (target) =>
    setNavigation((before) => go(before, routeOf(target))),
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isFoldKey(event)) return
      event.preventDefault()
      setFolded((before) => !before)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const goTo = (to: Route): void => setNavigation((before) => go(before, to))
  const openChat = (projectId: string, id: string): void => {
    setOpened((before) => new Set([...before, projectId]))
    goTo({ kind: 'chat', projectId, id })
  }
  const listed = projects.kind === 'ready' ? projects.projects : []
  const nameOf = (id: string): string =>
    (project.kind === 'ready' && project.project.id === id ? project.project.name : undefined) ??
    listed.find((one) => one.id === id)?.name ??
    ''
  return (
    <Shell
      engine={engine}
      projects={projects}
      project={project}
      needs={needs}
      navigation={navigation}
      folded={folded}
      opened={opened}
      chatTitle={(id) =>
        routeChats.kind === 'ready'
          ? routeChats.chats.find((chat) => chat.id === id)?.title
          : undefined
      }
      under={(projectId) => (
        <>
          <SidebarMissions
            link={link}
            engineReady={ready}
            projectId={projectId}
            current={placeOf(route)}
            onOpenMission={(key) => goTo({ kind: 'mission', projectId, key })}
          />
          <ProjectChats
            link={link}
            engineReady={ready}
            projectId={projectId}
            current={route.kind === 'chat' ? route.id : null}
            onOpen={(id) => openChat(projectId, id)}
          />
        </>
      )}
      home={
        <HomeRoute
          link={link}
          engineReady={ready}
          today={TODAY.format(now)}
          now={now}
          projects={projects}
          needs={needs}
          focus={route.kind === 'home' ? { projectId: route.projectId, need: route.need } : {}}
          firstLaunch={
            <FirstLaunchRoute
              link={link}
              engineReady={ready}
              onAddProject={() => setAdding(true)}
            />
          }
          actions={{
            answer: answering.answer,
            recheck: answering.recheck,
            openSettings: (section) => goTo(linkedSettings(section)),
            addProject: () => setAdding(true),
            retry: () => {
              retryProjects()
              answering.retry()
            },
            openMission: (projectId, key) => goTo({ kind: 'mission', projectId, key }),
          }}
        />
      }
      projectPage={
        route.kind === 'project' ? (
          <ProjectRoute
            key={route.id}
            link={link}
            engineReady={ready}
            id={route.id}
            state={project}
            fallback={nameOf(route.id)}
            now={now}
            tasks={
              project.kind === 'ready' ? (
                <ProjectSetupTask
                  key={route.id}
                  link={link}
                  engineReady={ready}
                  project={project.project}
                  launch={launches.of(route.id)}
                  onLaunch={() => launches.start(route.id)}
                />
              ) : null
            }
            actions={{
              openSettings: () => goTo({ kind: 'projectSettings', id: route.id }),
              retry: retryProject,
              openMission: (key) => goTo({ kind: 'mission', projectId: route.id, key }),
              openChat: (chatId) => openChat(route.id, chatId),
              openLivingSpec: () => goTo({ kind: 'livingSpec', projectId: route.id }),
            }}
          />
        ) : null
      }
      mission={
        route.kind === 'mission' ? (
          <MissionRoute
            key={route.key}
            link={link}
            engineReady={ready}
            projectId={route.projectId}
            missionKey={route.key}
            now={now}
            frame={frameOf(navigation, route.key)}
            actions={{
              open: (view) => setNavigation((before) => openView(before, view)),
              show: (view) => setNavigation((before) => show(before, view)),
              close: (view) => setNavigation((before) => closeView(before, view)),
              goProject: () => goTo({ kind: 'project', id: route.projectId }),
              answer: answering.answer,
              recheck: answering.recheck,
              openSettings: (section) => goTo(linkedSettings(section)),
            }}
          />
        ) : null
      }
      livingSpec={
        route.kind === 'livingSpec' ? (
          <LivingSpecRoute
            key={route.projectId}
            link={link}
            engineReady={ready}
            projectId={route.projectId}
            projectName={nameOf(route.projectId)}
            actions={{
              openOrigin: (key) =>
                setNavigation((before) => goMissionView(before, route.projectId, key, 'spec')),
              openModels: () =>
                goTo({ kind: 'projectSettings', id: route.projectId, section: 'models' }),
            }}
          />
        ) : null
      }
      chat={
        route.kind === 'chat' && project.kind === 'ready' ? (
          <ChatRoute
            key={route.id}
            link={link}
            engineReady={ready}
            project={project.project}
            chatId={route.id}
            onOpenMission={(key) => goTo({ kind: 'mission', projectId: route.projectId, key })}
          />
        ) : null
      }
      projectSettings={
        settingsOf === null ? null : (
          <SettingsPage
            key={settingsOf}
            data={settingsData}
            settings={settings}
            tools={tools}
            section={route.kind === 'projectSettings' ? route.section : undefined}
            problems={
              ticketProblem === undefined ? undefined : new Map([['tickets', ticketProblem]])
            }
            onOpenLivingSpec={() => goTo({ kind: 'livingSpec', projectId: settingsOf })}
            ticketSection={(section, showForm) => (
              <TicketSection
                section={section}
                link={link}
                engineReady={ready}
                projectId={settingsOf}
                project={
                  settingsData.project.kind === 'ready' ? settingsData.project.project : null
                }
                catalogue={
                  settingsData.catalogue.kind === 'ready' ? settingsData.catalogue.value : []
                }
                show={showForm}
                copy={tools.copy}
              />
            )}
            setUp={{
              // Launched, the setup is a task on the Project's page: the window goes there.
              onStart: () => {
                void launches.start(settingsOf).then((started) => {
                  if (started) setNavigation((before) => landedAfterSetup(before, settingsOf))
                })
              },
              starting: settingsLaunch?.starting ?? false,
              unavailable: settingsOffer?.unavailable !== undefined,
              refused: settingsOffer?.unavailable ?? settingsLaunch?.refused,
            }}
            agentSection={(section, showForm) => (
              <AgentSection
                section={section}
                link={link}
                engineReady={ready}
                projectId={settingsOf}
                catalogue={
                  settingsData.catalogue.kind === 'ready' ? settingsData.catalogue.value : []
                }
                show={showForm}
                onRolesChanged={() => setRoleChanges((before) => before + 1)}
              />
            )}
          />
        )
      }
      appSettings={
        <AppSettingsPage
          link={link}
          engineReady={ready}
          section={sectionOf(route)}
          focus={focusOf(route)}
          onSection={(section) => goTo({ kind: 'settings', section })}
          theme={theme}
          onTheme={(chosen) => {
            setTheme(chosen)
            void link.writePreferences({ theme: chosen }).catch(() => undefined)
          }}
          dataFolder={dataFolder}
          tools={SETTINGS_TOOLS}
        />
      }
      notices={<NoticeStack notices={notices} onOpen={open} onDismiss={dismiss} />}
      addProject={
        <AddProjectDialog
          open={adding}
          onOpenChange={setAdding}
          tools={ADDING}
          setupOffer={setupOffer}
          onCreated={(created, setUp) => {
            // The setup is the user's choice: asked for only when they ticked it. A refusal is
            // said on the Project's page, where the window goes.
            if (setUp) void launches.start(created.id)
            goTo({ kind: 'project', id: created.id })
          }}
        />
      }
      actions={{
        go: goTo,
        open: (id, shown) =>
          setOpened((before) => {
            const after = new Set(before)
            if (shown) after.add(id)
            else after.delete(id)
            return after
          }),
        show: (view) => setNavigation((before) => show(before, view)),
        fold: setFolded,
        retryProjects: () => {
          retryProjects()
          answering.retry()
        },
        retryProject,
        relaunch: () => void link.relaunch(),
        showLog: () => void link.showLog(),
        addProject: () => setAdding(true),
        answer: answering.answer,
        recheck: answering.recheck,
      }}
    />
  )
}

createRoot(root).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <Application />
      </TooltipProvider>
    </MotionConfig>
  </StrictMode>,
)
