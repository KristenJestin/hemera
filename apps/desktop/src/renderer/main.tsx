import type { ThemePreference } from '@hemera/ipc'
import { NoticeStack, TooltipProvider } from '@hemera/ui'
import { MotionConfig } from 'motion/react'
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

// oxlint-disable-next-line import/no-unassigned-import
import './window.css'
import { AddProjectDialog, type AddingTools } from './add-project.tsx'
import { AppSettings } from './app-settings.tsx'
import { ChatRoute, ProjectChats } from './chat-route.tsx'
import { connect } from './link.ts'
import { START, go, routeOf, show, type Navigation, type Route } from './navigation.ts'
import { SettingsPage, type SettingsTools } from './settings-page.tsx'
import { Shell } from './shell.tsx'
import { DARK_QUERY, wearTheme } from './theme.ts'
import { useChats } from './use-chats.ts'
import { useEngine } from './use-engine.ts'
import { useMinute, useNeeds } from './use-needs.ts'
import { useNotices } from './use-notices.ts'
import { useProject, useProjects } from './use-projects.ts'
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
      : route.kind === 'chat'
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
  const [settingsData, settings] = useSettings(link, ready, settingsOf)
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
        <ProjectChats
          link={link}
          engineReady={ready}
          projectId={projectId}
          current={route.kind === 'chat' ? route.id : null}
          onOpen={(id) => openChat(projectId, id)}
        />
      )}
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
      today={TODAY.format(now)}
      now={now}
      projectSettings={
        settingsOf === null ? null : (
          <SettingsPage key={settingsOf} data={settingsData} settings={settings} tools={tools} />
        )
      }
      appSettings={
        <AppSettings
          theme={theme}
          onTheme={(chosen) => {
            setTheme(chosen)
            void link.writePreferences({ theme: chosen }).catch(() => undefined)
          }}
        />
      }
      notices={<NoticeStack notices={notices} onOpen={open} onDismiss={dismiss} />}
      addProject={
        <AddProjectDialog
          open={adding}
          onOpenChange={setAdding}
          tools={ADDING}
          onCreated={(created) =>
            setNavigation((before) => go(before, { kind: 'project', id: created.id }))
          }
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
