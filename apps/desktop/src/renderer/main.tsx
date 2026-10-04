import { TooltipProvider } from '@hemera/ui'
import { MotionConfig } from 'motion/react'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

// oxlint-disable-next-line import/no-unassigned-import
import './window.css'
import { connect } from './link.ts'
import { START, go, show, type Navigation } from './navigation.ts'
import { Shell } from './shell.tsx'
import { DARK_QUERY, wearTheme } from './theme.ts'
import { useEngine } from './use-engine.ts'
import { useProject, useProjects } from './use-projects.ts'

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

/** The keystroke that folds and opens the sidebar, as its button's tooltip says: Ctrl+B. */
const isFoldKey = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === 'b'

function Application() {
  const engine = useEngine(link)
  const ready = engine.kind === 'ready'
  const [navigation, setNavigation] = useState<Navigation>(START)
  const [folded, setFolded] = useState(false)
  const { route } = navigation
  const shownProject =
    route.kind === 'project' || route.kind === 'projectSettings' ? route.id : null
  const [projects, retryProjects] = useProjects(link, ready)
  const [project, retryProject] = useProject(link, ready, shownProject)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isFoldKey(event)) return
      event.preventDefault()
      setFolded((before) => !before)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Shell
      engine={engine}
      projects={projects}
      project={project}
      navigation={navigation}
      folded={folded}
      today={TODAY.format(new Date())}
      actions={{
        go: (to) => setNavigation((before) => go(before, to)),
        show: (view) => setNavigation((before) => show(before, view)),
        fold: setFolded,
        retryProjects,
        retryProject,
        relaunch: () => void link.relaunch(),
        showLog: () => void link.showLog(),
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
