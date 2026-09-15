/**
 * State of the session screen.
 *
 * Every change goes to the profile first, and the screen is refreshed from it: the window
 * never keeps a second version of the business truth. Its own state is navigation, the panel
 * sizes and the last refusal, nothing else. A write that fails is reported as failed, so the
 * caller keeps what the user typed instead of presenting it as recorded.
 */

import { archivedSessions, currentSessions } from '@hemera/core'
import type { Project, Session, SessionEntry } from '@hemera/core'
import {
  createProject,
  createSession,
  listProjects,
  listSessions,
  loadPreferences,
  mainWorkspace,
  readConfiguration,
  readMessages,
  recordMessage,
  renameSession,
  savePreferences,
  setSessionArchived,
  writeConfiguration,
} from '@hemera/runtime'
import type { DisplayPreferences, ProjectConfiguration, StoreContext } from '@hemera/runtime'
import type { ThemeName } from '@hemera/ui'
import { useCallback, useMemo, useState } from 'react'

export interface SessionsModel {
  projects: Project[]
  activeProjectId: string | null
  activeProject: Project | null
  /** Path carried by the `main` workspace of the active project. */
  activeProjectPath: string | null
  /** Why the folder of the active project cannot be read, or null when it can. */
  unavailableFolder: string | null
  configuration: ProjectConfiguration | null

  /** Sessions the sidebar lists, current or archived depending on the view. */
  sessions: Session[]
  /** How many sessions the archived view holds, so the way in is only offered when useful. */
  archivedCount: number
  showingArchived: boolean
  activeSessionId: string | null
  activeSession: Session | null
  messages: SessionEntry[]
  /** Clock the thread reads its relative times against. */
  now: number

  sidebarWidth: number
  sidebarCollapsed: boolean
  theme: ThemeName
  /** The refusal the screen has to show, or null when the last action went through. */
  failure: string | null

  selectProject: (projectId: string) => void
  addProject: (input: { name: string; path: string }) => boolean
  configureProject: (input: { name: string; repositories: string[] }) => boolean
  showArchived: (showing: boolean) => void
  selectSession: (sessionId: string) => void
  startSession: () => boolean
  sendMessage: (body: string) => boolean
  renameSession: (title: string) => boolean
  setArchived: (sessionId: string, archived: boolean) => boolean
  setSidebarWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setTheme: (theme: ThemeName) => void
}

export interface UseSessionsOptions {
  /** Profile opened by this instance; its clock is replaced at every write. */
  context: StoreContext
  /** Reports why a folder cannot be read, or null when it can. */
  inspectFolder: (path: string) => string | null
  now: () => number
}

interface Snapshot {
  projects: Project[]
  activeProjectId: string | null
  activeProjectPath: string | null
  unavailableFolder: string | null
  configuration: ProjectConfiguration | null
  sessions: Session[]
  archivedCount: number
  activeSessionId: string | null
  messages: SessionEntry[]
}

export function useSessions({ context, inspectFolder, now }: UseSessionsOptions): SessionsModel {
  const opened = useMemo(() => loadPreferences(context.database, now()), [context, now])
  const [preferences, setPreferences] = useState<DisplayPreferences>(opened.preferences)
  const [failure, setFailure] = useState<string | null>(null)
  const [showingArchived, setShowingArchived] = useState(false)
  const [clock, setClock] = useState(() => now())
  const [snapshot, setSnapshot] = useState<Snapshot>(() =>
    readSnapshot(context, inspectFolder, {
      projectId: opened.preferences.activeProject,
      sessionId: null,
      archived: false,
    }),
  )

  /** A write never reuses the clock the profile was opened with. */
  const writing = useCallback((): StoreContext => ({ ...context, now: now() }), [context, now])

  const refresh = useCallback(
    (projectId: string | null, sessionId: string | null, archived: boolean) => {
      setSnapshot(readSnapshot(context, inspectFolder, { projectId, sessionId, archived }))
      setClock(now())
    },
    [context, inspectFolder, now],
  )

  const persist = useCallback(
    (next: DisplayPreferences) => {
      setPreferences(next)
      savePreferences(context.database, next, now())
    },
    [context, now],
  )

  /**
   * Runs an action that touches the profile.
   *
   * A refusal is named and reported as a failure; the caller decides what to keep.
   */
  const attempt = useCallback((action: () => void): boolean => {
    try {
      action()
      setFailure(null)
      return true
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [])

  const activeProject =
    snapshot.projects.find((project) => project.id === snapshot.activeProjectId) ?? null
  const activeSession =
    snapshot.sessions.find((session) => session.id === snapshot.activeSessionId) ?? null

  return {
    ...snapshot,
    activeProject,
    activeSession,
    showingArchived,
    now: clock,
    sidebarWidth: preferences.sidebarWidth,
    sidebarCollapsed: preferences.sidebarCollapsed,
    theme: preferences.theme,
    failure,

    selectProject: useCallback(
      (projectId: string) => {
        persist({ ...preferences, activeProject: projectId })
        setShowingArchived(false)
        refresh(projectId, null, false)
      },
      [persist, preferences, refresh],
    ),

    addProject: useCallback(
      (input: { name: string; path: string }) =>
        attempt(() => {
          const cause = inspectFolder(input.path)
          if (cause !== null) throw new Error(cause)
          const created = createProject(writing(), input)
          persist({ ...preferences, activeProject: created.project.id })
          setShowingArchived(false)
          refresh(created.project.id, null, false)
        }),
      [attempt, inspectFolder, writing, persist, preferences, refresh],
    ),

    configureProject: useCallback(
      (input: { name: string; repositories: string[] }) =>
        attempt(() => {
          if (activeProject === null) throw new Error('no project is selected')
          writeConfiguration(writing(), activeProject.id, activeProject.version, input)
          refresh(activeProject.id, snapshot.activeSessionId, showingArchived)
        }),
      [attempt, activeProject, writing, refresh, snapshot.activeSessionId, showingArchived],
    ),

    showArchived: useCallback(
      (showing: boolean) => {
        setShowingArchived(showing)
        refresh(snapshot.activeProjectId, null, showing)
      },
      [refresh, snapshot.activeProjectId],
    ),

    selectSession: useCallback(
      (sessionId: string) => {
        refresh(snapshot.activeProjectId, sessionId, showingArchived)
      },
      [refresh, snapshot.activeProjectId, showingArchived],
    ),

    startSession: useCallback(
      () =>
        attempt(() => {
          const session = createSession(writing(), snapshot.activeProjectId)
          setShowingArchived(false)
          refresh(snapshot.activeProjectId, session.id, false)
        }),
      [attempt, writing, snapshot.activeProjectId, refresh],
    ),

    sendMessage: useCallback(
      (body: string) =>
        attempt(() => {
          if (snapshot.activeSessionId === null) throw new Error('no session is open')
          recordMessage(writing(), snapshot.activeSessionId, body)
          refresh(snapshot.activeProjectId, snapshot.activeSessionId, showingArchived)
        }),
      [
        attempt,
        writing,
        snapshot.activeSessionId,
        snapshot.activeProjectId,
        refresh,
        showingArchived,
      ],
    ),

    renameSession: useCallback(
      (title: string) =>
        attempt(() => {
          if (snapshot.activeSessionId === null) throw new Error('no session is open')
          renameSession(writing(), snapshot.activeSessionId, title)
          refresh(snapshot.activeProjectId, snapshot.activeSessionId, showingArchived)
        }),
      [
        attempt,
        writing,
        snapshot.activeSessionId,
        snapshot.activeProjectId,
        refresh,
        showingArchived,
      ],
    ),

    setArchived: useCallback(
      (sessionId: string, archived: boolean) =>
        attempt(() => {
          setSessionArchived(writing(), sessionId, archived)
          refresh(snapshot.activeProjectId, null, showingArchived)
        }),
      [attempt, writing, refresh, snapshot.activeProjectId, showingArchived],
    ),

    setSidebarWidth: useCallback(
      (sidebarWidth: number) => {
        persist({ ...preferences, sidebarWidth })
      },
      [persist, preferences],
    ),

    setSidebarCollapsed: useCallback(
      (sidebarCollapsed: boolean) => {
        persist({ ...preferences, sidebarCollapsed })
      },
      [persist, preferences],
    ),

    // The theme applies on the spot; nothing is remounted, so the open session, the unsent
    // draft and the panel sizes are untouched.
    setTheme: useCallback(
      (theme: ThemeName) => {
        persist({ ...preferences, theme })
      },
      [persist, preferences],
    ),
  }
}

interface SnapshotQuery {
  projectId: string | null
  sessionId: string | null
  archived: boolean
}

/**
 * Reads everything the screen shows, from the profile.
 *
 * A project whose folder cannot be read is still listed with its data: the cause is named and
 * nothing is removed.
 */
function readSnapshot(
  context: StoreContext,
  inspectFolder: (path: string) => string | null,
  query: SnapshotQuery,
): Snapshot {
  const projects = listProjects(context.database)
  const active = projects.find((project) => project.id === query.projectId) ?? projects[0] ?? null
  if (active === null) {
    return {
      projects,
      activeProjectId: null,
      activeProjectPath: null,
      unavailableFolder: null,
      configuration: null,
      sessions: [],
      archivedCount: 0,
      activeSessionId: null,
      messages: [],
    }
  }

  const path = mainWorkspace(context.database, active.id)?.path ?? null
  const all = listSessions(context.database, active.id)
  const listed = query.archived ? archivedSessions(all) : currentSessions(all)
  const selected = listed.find((session) => session.id === query.sessionId) ?? listed[0] ?? null

  return {
    projects,
    activeProjectId: active.id,
    activeProjectPath: path,
    unavailableFolder: path === null ? null : inspectFolder(path),
    configuration: readConfiguration(context.database, active.id),
    sessions: listed,
    archivedCount: archivedSessions(all).length,
    activeSessionId: selected?.id ?? null,
    messages: selected === null ? [] : readMessages(context.database, selected.id),
  }
}
