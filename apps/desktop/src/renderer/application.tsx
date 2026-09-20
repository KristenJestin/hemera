/**
 * The window of lot 4: the shell, its pages, and the engine behind them (design D4-06, D4-11).
 *
 * Every surface is composed by a page of `pages/` and filled by a store that asks the engine.
 * Neither the pages nor the shell know where any of it came from — which is what let all of
 * them be drawn, reviewed and accepted on fixtures before a database existed, and what makes
 * this file the only one that changed when the fixtures went.
 *
 * Nothing here decides anything either. What a name may be, whether a version is still current
 * and what a page of the Journal holds are the engine's; this asks, and shows what came back.
 *
 * The witness transition of lot 0 is still here, and it is still the fold of the sidebar: the
 * one dimension of the layout this application animates, and the one the frame counter keeps
 * honest (design D2-09).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { EngineStatus, MotionMeasure, Project, Session } from '@hemera/ipc'
import {
  CommandPalette,
  EMPTY_DRAFT,
  HOME_ENTRY,
  JOURNAL_ENTRY,
  NotificationList,
  PROJECT_SETTINGS_ENTRY,
  ProjectDialog,
  Shell,
  type ArchivedProject,
  type CommandGroup,
  type HomeSession,
  type JournalFilter,
  type ProfileFacts,
  type ProjectDraft,
  type RepositoryLine,
  type ShellProject,
} from '@hemera/ui'
import {
  IconArchive,
  IconFolderPlus,
  IconHome,
  IconLayoutSidebar,
  IconPlus,
  IconSettings,
  IconSun,
  IconTimelineEvent,
} from '@hemera/ui/icons'

import { ArchivedSessionsPage } from './pages/archived-sessions.tsx'
import { FirstLaunchPage } from './pages/first-launch.tsx'
import { HomePage } from './pages/home.tsx'
import { JournalPage } from './pages/journal.tsx'
import { ProjectSettingsPage } from './pages/project-settings.tsx'
import { SessionPage } from './pages/session.tsx'
import { SettingsPage } from './pages/settings.tsx'
import { lineOf, linesOf, whenOf } from './journal-lines.ts'
import {
  archivedSessions,
  archiveSession,
  closeSessions,
  openSession,
  openSessions,
  renameSession,
  restoreSession,
  sessionsSnapshot,
  startSession,
  subscribeToSessions,
  writeMessage,
} from './sessions-store.ts'
import {
  closeJournal,
  filterJournal,
  journalSnapshot,
  loadEarlier,
  openJournal,
  subscribeToJournal,
} from './journal-store.ts'
import {
  loadUnseen,
  markAllSeen,
  notificationsSnapshot,
  subscribeToNotifications,
} from './notifications-store.ts'
import {
  addRepository,
  archiveProject,
  archivedProjects,
  createProject,
  loadProjects,
  moveMainWorkspace,
  projectsSnapshot,
  removeRepository,
  renameProject,
  restoreProject,
  subscribeToProjects,
} from './projects-store.ts'
import {
  keepActiveProject,
  persistWidthOnRelease,
  selectEntry,
  selectProject,
  selectProjectByRank,
  setCollapsed,
  setWidth,
  shellState,
  subscribeToShell,
  toggleCollapsed,
} from './shell-store.ts'
import { type ShortcutAction, keysOf, keysOfRank, useShellShortcuts } from './shortcuts.ts'
import {
  nextThemePreference,
  setThemePreference,
  subscribeToTheme,
  themePreference,
} from './theme.ts'
import { measureFrames } from './witness.ts'

/** How many of the most recent entries the Home shows, which is a glance and not a page. */
const ACTIVITY = 4

/** How many Sessions the Home shows, for the same reason. */
const RECENT = 3

/** How many Sessions the palette lists, for the same reason it is a palette and not a list. */
const PALETTE_SESSIONS = 6

/** What the settings show before the engine has answered: the truth, which is that it has not. */
const UNREAD_PROFILE: ProfileFacts = {
  directory: '…',
  database: '…',
  lastMigration: null,
  writtenByVersion: null,
  backups: null,
}

/** What the engine reported, in the words the settings show it in. */
function factsOf(status: EngineStatus): ProfileFacts {
  return {
    directory: status.directory,
    database: `hemera.sqlite · ${sized(status.databaseSize)}`,
    lastMigration: status.lastMigration,
    writtenByVersion: status.writtenByVersion,
    backups:
      status.backups.count === 0
        ? null
        : `${String(status.backups.count)} · last ${status.backups.latest ?? ''}`,
  }
}

/**
 * A size in the units a person reads.
 *
 * Written here and not by the engine: how big a file is, is a fact; how it is said is a matter
 * of the language the window is in.
 */
function sized(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['kB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'B'}`
}

/**
 * Where a channel nobody is waiting on stops.
 *
 * Every one of these is asked for the page's own sake — a size in the settings, a branch beside
 * a path — and none of them has anyone holding its answer. A channel that refused, timed out or
 * found nobody there still rejects, and a rejection nobody is holding is an unhandled one: the
 * page goes on, and the console says which question was not answered.
 */
function unanswered(channel: string) {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected channel carries whatever the main process threw, and this is where it stops
  return (failed: unknown): void => {
    console.error(`${channel}: the window asked and was not answered`, failed)
  }
}

/** The system's own folder picker, which belongs to the main process. */
async function pickFolder(): Promise<string | null> {
  return await window.hemera.invoke('dialog.pickFolder', {})
}

/**
 * What is wrong with a folder, in the words the field shows, or null when nothing is.
 *
 * Only a process with a disk can tell a folder that is not there from one that is a file from
 * one that cannot be read, and the specification asks for the cause to be named.
 */
async function checkFolder(path: string): Promise<string | null> {
  const found = await window.hemera.invoke('workspace.check', { path })
  return found.ok ? null : found.reason
}

/** Where the window is looking, beyond the entries the sidebar itself lists. */
type Place = 'entry' | 'settings' | 'archived'

export function Application() {
  const shell = useSyncExternalStore(subscribeToShell, shellState, shellState)
  // The preference and not the resolved theme: the one control cycles through what the user
  // chose, and `system` is a choice no colour can be read back from. What the page wears is put
  // on `<html>` by the theme store itself, which is subscribed to here all the same — that is
  // what keeps the page following the desktop while the choice is `system`.
  const preference = useSyncExternalStore(
    subscribeToTheme,
    themePreference,
    () => 'system' as const,
  )

  const held = useSyncExternalStore(subscribeToProjects, projectsSnapshot, projectsSnapshot)
  const bell = useSyncExternalStore(
    subscribeToNotifications,
    notificationsSnapshot,
    notificationsSnapshot,
  )
  const journal = useSyncExternalStore(subscribeToJournal, journalSnapshot, journalSnapshot)
  const sessions = useSyncExternalStore(subscribeToSessions, sessionsSnapshot, sessionsSnapshot)

  const [place, setPlace] = useState<Place>('entry')
  const [commanding, setCommanding] = useState(false)
  const [creating, setCreating] = useState(false)
  const [facts, setFacts] = useState<ProfileFacts | null>(null)
  const [subtitle, setSubtitle] = useState('Hemera')
  // Kept as the engine answered them and not as the page draws them: restoring one is a change
  // like any other and carries the version it was read at, which a name and a date do not have.
  const [archived, setArchived] = useState<Project[]>([])
  const [repositories, setRepositories] = useState<RepositoryLine[]>([])
  const [folders, setFolders] = useState<RepositoryLine[]>([])
  /** Which Session of which Project was open last, as the preferences remembered it. */
  const [remembered, setRemembered] = useState<Record<string, string> | null>(null)
  /** What was put away, which only the archived page asks for and only while it is open. */
  const [putAway, setPutAway] = useState<Session[]>([])
  /** The Session whose title is being typed into, when one is. */
  const [naming, setNaming] = useState<string | null>(null)
  /** Which Project the window has already decided where to look in. */
  const placed = useRef<string | null>(null)
  /** The folder the settings are showing, which is what everything below it is read against. */
  const [shownPath, setShownPath] = useState<string | null>(null)

  const current = held.projects.find((project) => project.id === shell.activeProjectId) ?? null

  /**
   * What the bar draws, which is not what the engine answers.
   *
   * A tab is a name, a tone and how many entries nobody has seen — three things the shell can
   * draw without knowing what a Project is. The count comes from the bell and not from the
   * Project, because it is a fact about the Journal.
   */
  const projects = useMemo(
    (): ShellProject[] =>
      held.projects.map((project) => ({
        id: project.id,
        name: project.name,
        tone: project.tone,
        pending: bell.byProject.get(project.id) ?? 0,
      })),
    [held.projects, bell.byProject],
  )

  const active = projects.find((project) => project.id === shell.activeProjectId) ?? null

  /** What the sidebar lists, which is the Sessions of the Project in front and nothing else. */
  const shellSessions = useMemo(
    (): { id: string; title: string }[] =>
      sessions.sessions.map((one) => ({ id: one.id, title: one.title })),
    [sessions.sessions],
  )

  /** The last Sessions of the Project, as the Home's frame says them. */
  const recent = useMemo(
    (): HomeSession[] =>
      sessions.sessions.slice(0, RECENT).map((one) => ({
        id: one.id,
        title: one.title,
        meta: `last written ${whenOf(one.lastWrittenAt)}`,
      })),
    [sessions.sessions],
  )

  /** The Session the window is on, when it is on one. */
  const open = useMemo(
    () => sessions.sessions.find((one) => one.id === shell.activeEntryId) ?? null,
    [sessions.sessions, shell.activeEntryId],
  )

  // Everything the window shows about the data folder, asked for once it is open.
  useEffect(() => {
    void loadProjects()
    void loadUnseen()
    // Where the window was looking last. Read once, and read before anything can decide which
    // Session to open: the Session an opening lands on is this answer's and no one else's.
    void window.hemera
      .invoke('preferences.read', {})
      .then((worn) => setRemembered(worn.activeSessions))
      .catch(unanswered('preferences.read'))
    void window.hemera
      .invoke('engine.status', {})
      .then((status) => {
        setFacts(factsOf(status))
        setSubtitle(`Hemera ${status.version} · channel ${status.channel}`)
      })
      .catch(unanswered('engine.status'))
  }, [])

  // The Project that is active has to be one that exists: archiving the last one is what takes
  // the window back to its first launch.
  //
  // Not before the list has come back, though. The window starts on the Project it was left on,
  // and the first render has no list to check it against: asked then, this would answer that a
  // Project remembered from the last start is one that no longer exists.
  useEffect(() => {
    if (!held.loaded) return
    keepActiveProject(projects.map((project) => project.id))
  }, [projects, held.loaded])

  // Remembered for the next start, and forgotten the moment there is no Project to remember.
  // Written once the list is there, for the same reason: the null of a window that has not
  // finished opening is not a user who is looking at nothing.
  useEffect(() => {
    if (!held.loaded) return
    void window.hemera
      .invoke('preferences.write', { activeProjectId: shell.activeProjectId })
      .catch(unanswered('preferences.write'))
  }, [shell.activeProjectId, held.loaded])

  // The Journal of whichever Project is in front, read again when that changes.
  useEffect(() => {
    if (shell.activeProjectId === null) {
      closeJournal()
      return
    }
    void openJournal(shell.activeProjectId)
  }, [shell.activeProjectId])

  // The Sessions of whichever Project is in front, read again when that changes.
  useEffect(() => {
    if (shell.activeProjectId === null) {
      closeSessions()
      return
    }
    void openSessions(shell.activeProjectId)
  }, [shell.activeProjectId])

  /**
   * Which Session of a Project the window opens on.
   *
   * Once per Project and once per start, and never again while the user is looking elsewhere:
   * the Session the preferences remember when it is still there, the one written last when it
   * is not, and the Home when the Project has none at all. A remembered Session that was
   * archived since, or that is not there any more, is not an error — it is a Project whose
   * threads have moved on, and the most recent one is the answer to that (design D4b-07).
   */
  useEffect(() => {
    const projectId = shell.activeProjectId
    if (projectId === null || !sessions.loaded || remembered === null) return
    if (placed.current === projectId) return
    placed.current = projectId
    const wanted = sessions.sessions.find((one) => one.id === remembered[projectId])
    const landing = wanted ?? sessions.sessions[0]
    if (landing !== undefined) selectEntry(landing.id)
  }, [shell.activeProjectId, sessions.loaded, sessions.sessions, remembered])

  // The thread of the Session the window is on, read when it becomes the one it is on.
  useEffect(() => {
    const id = shell.activeEntryId
    if (id === sessions.open && sessions.loaded) return
    if (!sessions.sessions.some((one) => one.id === id)) return
    void openSession(id)
  }, [shell.activeEntryId, sessions.sessions, sessions.open, sessions.loaded])

  // Remembered for the next start, which is one Session per Project and not one in all. What
  // was written is kept here too: this is the answer the next opening of a Project is placed
  // on, and a copy left at what the last start read would put back the Session the user has
  // since moved off — on screen, and in the preferences of every other Project written after.
  useEffect(() => {
    if (shell.activeProjectId === null || remembered === null) return
    if (!sessions.sessions.some((one) => one.id === shell.activeEntryId)) return
    if (remembered[shell.activeProjectId] === shell.activeEntryId) return
    const next = { ...remembered, [shell.activeProjectId]: shell.activeEntryId }
    setRemembered(next)
    void window.hemera
      .invoke('preferences.write', { activeSessions: next })
      .catch(unanswered('preferences.write'))
  }, [shell.activeProjectId, shell.activeEntryId, sessions.sessions, remembered])

  // What was put away, read every time the page is opened: a Session archived and restored while
  // it is open is a list that has to be read again, not one this page remembers for itself.
  useEffect(() => {
    if (place !== 'archived' || shell.activeProjectId === null) return
    void archivedSessions(shell.activeProjectId).then(setPutAway).catch(unanswered('sessions.list'))
  }, [place, shell.activeProjectId, sessions.sessions])

  // And once the palette is open, because giving one back is one of the things it offers about
  // Sessions: a list it cannot draw is a question it cannot ask.
  useEffect(() => {
    if (!commanding || shell.activeProjectId === null) return
    void archivedSessions(shell.activeProjectId).then(setPutAway).catch(unanswered('sessions.list'))
  }, [commanding, shell.activeProjectId, sessions.sessions])

  /**
   * What each declared location holds, read every time the settings are opened.
   *
   * Never stored: a branch changes without anyone touching a row, so a page showing a
   * remembered one would be showing something that was true once.
   *
   * Read against the folder the page is showing rather than the one last saved. They are the
   * same folder until the field is typed into, and until this was here the difference was a
   * page that said "not there yet" about two repositories that were plainly there — and said
   * it right up until Save, when they became branches without anyone having touched a disk.
   */
  useEffect(() => {
    if (current === null || shell.activeEntryId !== PROJECT_SETTINGS_ENTRY) return
    const root = shownPath ?? current.mainPath
    if (root.trim() === '') {
      setRepositories([])
      setFolders([])
      return
    }
    // A disk answers when it answers, and the folder it was asked about can have changed by
    // then: what came back about the folder before this one is dropped rather than drawn.
    let asking = true
    void window.hemera
      .invoke('repositories.status', { root, paths: current.repositories })
      .then((found) => {
        if (!asking) return
        setRepositories(
          found.map((one) => ({ path: one.path, branch: one.git, exists: one.exists })),
        )
      })
      .catch(unanswered('repositories.status'))
    // And what the Workspace holds that has not been declared, which is what the page offers
    // instead of asking for a path to be typed twice.
    void window.hemera
      .invoke('workspace.folders', { root })
      .then((found) => {
        if (!asking) return
        setFolders(found.map((one) => ({ path: one.path, branch: one.git, exists: one.exists })))
      })
      .catch(unanswered('workspace.folders'))
    return () => {
      asking = false
    }
  }, [current, shell.activeEntryId, shownPath])

  // What was archived, which only the settings ask for and only while they are open.
  useEffect(() => {
    if (place !== 'settings') return
    void archivedProjects().then(setArchived).catch(unanswered('projects.list'))
  }, [place, held.projects])

  const goTo = useCallback((entryId: string) => {
    setPlace('entry')
    selectEntry(entryId)
  }, [])

  /**
   * A new Session in the Project in front, opened with its title in hand.
   *
   * The Session exists from the moment it is made — that is what lets it be named before
   * anything is written in it, and what makes `New session` a name waiting to be replaced — and
   * the Journal of the Project gains a line about it, so the Journal on screen is read again
   * rather than left saying nothing happened.
   */
  const newSession = useCallback(async () => {
    const projectId = shell.activeProjectId
    if (projectId === null) return
    const made = await startSession(projectId)
    if (made === null) return
    setNaming(made.id)
    goTo(made.id)
    void openJournal(projectId)
  }, [shell.activeProjectId, goTo])

  /** Writes a message into a Session, and reads the Journal again when one was written. */
  const writeInto = useCallback(
    async (sessionId: string, body: string): Promise<string | null> => {
      const said = await writeMessage(sessionId, body)
      const projectId = shell.activeProjectId
      if (said === null && projectId !== null) void openJournal(projectId)
      return said
    },
    [shell.activeProjectId],
  )

  /**
   * Renames a Session, which the head of the page and the row menu both ask for.
   *
   * A refusal leaves the field open: what was typed is still there to be corrected, and a field
   * that closed over a name the engine never took would be a page showing a title nothing holds.
   */
  const renameTo = useCallback(
    async (session: Session, title: string) => {
      const projectId = shell.activeProjectId
      if (!(await renameSession(session, title))) return
      setNaming(null)
      if (projectId !== null) void openJournal(projectId)
    },
    [shell.activeProjectId],
  )

  /** Puts a Session away, which takes the window off it when it was the one on screen. */
  const archive = useCallback(
    async (session: Session) => {
      const projectId = shell.activeProjectId
      if (!(await archiveSession(session))) return
      if (session.id === shell.activeEntryId) goTo(HOME_ENTRY)
      if (projectId !== null) void openJournal(projectId)
    },
    [shell.activeProjectId, shell.activeEntryId, goTo],
  )

  const run = useCallback(
    (action: ShortcutAction) => {
      if (action.kind === 'sidebar') {
        toggleCollapsed()
        return
      }
      if (action.kind === 'command') {
        setCommanding(true)
        return
      }
      if (action.kind === 'settings') {
        setPlace('settings')
        return
      }
      if (action.kind === 'session') {
        void newSession()
        return
      }
      // Back to the Project, wherever the window was: a rank asks for a Project, and answering
      // it while staying on the settings of the application answers something else.
      setPlace('entry')
      selectProjectByRank(
        action.rank,
        projects.map((project) => project.id),
      )
    },
    [projects, newSession],
  )

  useShellShortcuts(run)

  /**
   * The same act the button performs, offered to whatever drives the window from outside: the
   * report run and the end-to-end suite fold the sidebar exactly as a hand does, and count.
   *
   * The counter is started a frame before the fold on purpose. Counted from the same tick as
   * the act, the first frame of *any* animation — a transform exactly as much as a width —
   * lands on two periods of a 165 Hz display, because that frame carries React's commit and
   * the round trip that asked for it. What the lot has to keep honest is the fold, so the
   * fold is what the window counts.
   */
  const play = useCallback(async (): Promise<MotionMeasure> => {
    const counted = measureFrames()
    await new Promise(requestAnimationFrame)
    toggleCollapsed()
    return await counted
  }, [])

  useEffect(() => {
    window.hemeraWitness = { play }
  }, [play])

  // A width is written down when the hand lets go of it, not while it is being dragged.
  useEffect(persistWidthOnRelease, [])

  const groups = useMemo(
    (): CommandGroup[] =>
      commandsFor({
        active,
        projects,
        sessions: sessions.sessions,
        open,
        putAway,
        goTo,
        setPlace,
        setCreating,
        preference,
        onNewSession: () => void newSession(),
        onArchive: (session) => void archive(session),
        onRestore: (session) => void restoreSession(session),
      }),
    [active, projects, sessions.sessions, open, putAway, goTo, preference, newSession, archive],
  )

  return (
    <Shell
      projects={projects}
      activeProjectId={shell.activeProjectId}
      onSelectProject={(id) => {
        setPlace('entry')
        selectProject(id)
      }}
      onAddProject={() => setCreating(true)}
      notifications={
        <NotificationList
          entries={bell.entries.map((entry) => {
            const line = lineOf(entry)
            const of = held.projects.find((project) => project.id === entry.projectId)
            return {
              sequence: line.sequence,
              label: line.label,
              // An entry of the profile belongs to no Project, and says so rather than
              // borrowing the name of whichever one happens to be in front.
              projectName: of?.name ?? 'Profile',
              tone: of?.tone ?? 'neutral',
              when: `${line.day} · ${line.time}`,
              onOpen: () => {
                if (of !== undefined) selectProject(of.id)
                goTo(JOURNAL_ENTRY)
              },
            }
          })}
          onMarkAllRead={() => void markAllSeen()}
        />
      }
      unseen={bell.unseen}
      onOpenSettings={() => setPlace('settings')}
      settingsActive={place === 'settings'}
      sessions={shellSessions}
      onNewSession={() => void newSession()}
      onRenameSession={(id) => {
        setNaming(id)
        goTo(id)
      }}
      onArchiveSession={(id) => {
        const one = sessions.sessions.find((session) => session.id === id)
        if (one !== undefined) void archive(one)
      }}
      // Nothing of the list while the settings of the application are open: they are a place of
      // their own, and the entry the window was on before is not where it is now.
      activeEntryId={place === 'settings' ? null : shell.activeEntryId}
      onSelectEntry={goTo}
      onOpenCommand={() => setCommanding(true)}
      commandShortcut={keysOf('command')}
      collapseShortcut={keysOf('sidebar')}
      collapsed={shell.collapsed}
      onCollapsedChange={setCollapsed}
      width={shell.width}
      onWidthChange={setWidth}
    >
      {page()}
      <CommandPalette
        open={commanding}
        onOpenChange={setCommanding}
        scope={active?.name ?? null}
        groups={groups}
        everywhere={everywhereIn(projects, goTo)}
      />
      <ProjectDialog
        open={creating}
        onOpenChange={setCreating}
        draft={EMPTY_DRAFT}
        onBrowse={pickFolder}
        onCheckFolder={checkFolder}
        onSubmit={async (draft) => {
          const went = await createProject({
            name: draft.name,
            tone: draft.tone,
            mainPath: draft.mainPath,
          })
          if (!went) return projectsSnapshot().refusal
          // The Project that was just made is the one to be looking at, and it is the newest of
          // the list the engine answered with.
          const made = projectsSnapshot().projects.at(-1)
          if (made !== undefined) selectProject(made.id)
          await loadUnseen()
          return null
        }}
      />
    </Shell>
  )

  /** Which page the content area holds, which is where the window is looking. */
  function page() {
    if (place === 'settings') {
      return (
        <SettingsPage
          subtitle={subtitle}
          theme={preference}
          onThemeChange={setThemePreference}
          facts={facts ?? UNREAD_PROFILE}
          onOpenFolder={() => {
            void window.hemera
              .invoke('shell.open', { what: 'folder' })
              .catch(unanswered('shell.open'))
          }}
          onOpenDiagnostic={() => {
            void window.hemera
              .invoke('shell.open', { what: 'diagnostic' })
              .catch(unanswered('shell.open'))
          }}
          archived={archived.map((project): ArchivedProject => ({
            id: project.id,
            name: project.name,
            archivedAt: new Date(project.archivedAt ?? 0).toLocaleDateString(),
          }))}
          onRestore={(id) => {
            // Found among the archived and not among the Projects on screen: the bar lists what
            // is not archived, so a Project that can be restored is never one of them.
            const gone = archived.find((one) => one.id === id)
            if (gone !== undefined) void restoreProject(gone)
          }}
        />
      )
    }
    if (place === 'archived') {
      return (
        <ArchivedSessionsPage
          sessions={putAway}
          now={Date.now()}
          onRestore={(id) => {
            // Found among the archived and not among the Sessions on screen: the sidebar lists
            // what is not archived, so one that can be restored is never one of them.
            const gone = putAway.find((one) => one.id === id)
            if (gone !== undefined) void restoreSession(gone)
          }}
        />
      )
    }
    if (active === null) {
      return (
        <FirstLaunchPage
          onCreateProject={() => setCreating(true)}
          commandShortcut={keysOf('command')}
        />
      )
    }
    if (shell.activeEntryId === JOURNAL_ENTRY) {
      return (
        <JournalPage
          projectName={active.name}
          entries={linesOf(journal.entries)}
          filter={journal.kind === 'all' ? 'all' : journal.kind}
          byYou={journal.byYou}
          onFilterChange={(filter: JournalFilter) => {
            void filterJournal(active.id, { kind: filter })
          }}
          onByYouChange={(byYou) => {
            void filterJournal(active.id, { byYou })
          }}
          hasEarlier={journal.nextBefore !== null}
          onLoadEarlier={() => void loadEarlier(active.id)}
          loading={journal.loading}
        />
      )
    }
    if (shell.activeEntryId === PROJECT_SETTINGS_ENTRY && current !== null) {
      return (
        <ProjectSettingsPage
          project={{ name: current.name, tone: current.tone, mainPath: current.mainPath }}
          repositories={repositories}
          onSave={async (draft: ProjectDraft) => {
            const renamed = await renameProject(current, { name: draft.name, tone: draft.tone })
            if (!renamed) return projectsSnapshot().refusal
            if (draft.mainPath === current.mainPath) return null
            const moved = await moveMainWorkspace(
              projectsSnapshot().projects.find((one) => one.id === current.id) ?? current,
              draft.mainPath,
            )
            return moved ? null : projectsSnapshot().refusal
          }}
          folders={folders}
          onBrowse={pickFolder}
          onCheckFolder={checkFolder}
          onMainPathChange={setShownPath}
          onAddRepository={async (path) => {
            // Read again rather than closed over: declaring two locations in a row is two
            // changes, and the second carries the version the first one left behind.
            const latest =
              projectsSnapshot().projects.find((one) => one.id === current.id) ?? current
            const went = await addRepository(latest, path)
            return went ? null : projectsSnapshot().refusal
          }}
          onRemoveRepository={(path) => void removeRepository(current, path)}
          onArchive={() => void archiveProject(current)}
        />
      )
    }
    if (open !== null) {
      return (
        <SessionPage
          // Keyed on the Session: a draft of a title belongs to the Session it is about, and
          // carrying it to the next one would be renaming something nobody asked about.
          key={open.id}
          projectName={active.name}
          session={open}
          entries={sessions.thread}
          // Read back or not: until the thread has come back, the page says nothing about it
          // rather than saying it is empty, which is a thing it does not know yet.
          loaded={sessions.open === open.id && sessions.loaded}
          now={Date.now()}
          editing={naming === open.id}
          refusal={sessions.refusal}
          onWrite={async (body) => await writeInto(open.id, body)}
          onRename={(title) => void renameTo(open, title)}
          onStartEditing={() => setNaming(open.id)}
          onCancelEditing={() => setNaming(null)}
          onArchive={() => void archive(open)}
          onSearchFiles={async (query: string) =>
            current === null
              ? []
              : await window.hemera.invoke('workspace.files', {
                  root: current.mainPath,
                  query,
                })
          }
          onPickFiles={async () =>
            current === null
              ? []
              : await window.hemera.invoke('dialog.pickFiles', { root: current.mainPath })
          }
        />
      )
    }
    return (
      // Keyed on the Project: what is written in the composer is written about that Project,
      // and carrying it over to the next one is carrying a question to somewhere it was never
      // asked. Changing Project starts a blank one, as opening the window does.
      <HomePage
        key={active.id}
        projectName={active.name}
        sessions={recent}
        entries={linesOf(journal.entries).slice(0, ACTIVITY)}
        onOpenSession={goTo}
        onOpenAllSessions={() => setPlace('archived')}
        onOpenJournal={() => goTo(JOURNAL_ENTRY)}
        onSearchFiles={async (query: string) =>
          current === null
            ? []
            : await window.hemera.invoke('workspace.files', {
                root: current.mainPath,
                query,
              })
        }
        onPickFiles={async () =>
          current === null
            ? []
            : await window.hemera.invoke('dialog.pickFiles', { root: current.mainPath })
        }
        // What the greeting promises: the first message makes the Session. A refusal is the
        // sentence the composer shows, and the Session it could not be written into stays —
        // empty, and named `New session` like any other.
        onSend={async (text) => {
          const made = await startSession(active.id)
          if (made === null) return sessionsSnapshot().refusal
          const said = await writeInto(made.id, text)
          if (said === null) goTo(made.id)
          return said
        }}
      />
    )
  }
}

/** What the palette offers about the Project in front, and about the window itself. */
function commandsFor({
  active,
  projects,
  sessions,
  open,
  putAway,
  goTo,
  setPlace,
  setCreating,
  preference,
  onNewSession,
  onArchive,
  onRestore,
}: {
  active: ShellProject | null
  projects: ShellProject[]
  /** The Sessions of the Project in front, most recently written first. */
  sessions: Session[]
  /** The Session the window is on, when it is on one. */
  open: Session | null
  /** What was put away, which is where giving one back happens. */
  putAway: Session[]
  goTo: (entryId: string) => void
  setPlace: (place: Place) => void
  setCreating: (creating: boolean) => void
  preference: ReturnType<typeof themePreference>
  onNewSession: () => void
  onArchive: (session: Session) => void
  onRestore: (session: Session) => void
}): CommandGroup[] {
  const places: CommandGroup = {
    label: 'Go to',
    entries: [
      ...(active === null
        ? []
        : [
            {
              id: 'home',
              label: 'Home',
              icon: <IconHome size="sm" />,
              onSelect: () => goTo(HOME_ENTRY),
            },
            {
              id: 'journal',
              label: 'Journal',
              icon: <IconTimelineEvent size="sm" />,
              onSelect: () => goTo(JOURNAL_ENTRY),
            },
            {
              id: 'project-settings',
              label: 'Project settings',
              icon: <IconSettings size="sm" />,
              onSelect: () => goTo(PROJECT_SETTINGS_ENTRY),
            },
          ]),
      {
        id: 'settings',
        label: 'Settings',
        keys: keysOf('settings'),
        icon: <IconSettings size="sm" />,
        onSelect: () => setPlace('settings'),
      },
    ],
  }

  /**
   * What can be done to a Session, and the ones that can be opened.
   *
   * A Session is opened by its name here because its name is the only thing that tells two of
   * them apart from the keyboard: the thread is what tells them apart on the screen, and the
   * palette has no screen. The lists stop at a handful for the reason the palette exists — one
   * that ran the length of the Project would be the sidebar, reached the long way round.
   */
  const about: CommandGroup = {
    label: 'Sessions',
    entries: [
      {
        id: 'new-session',
        label: 'New Session',
        keys: keysOf('session'),
        icon: <IconPlus size="sm" />,
        onSelect: onNewSession,
      },
      ...sessions.slice(0, PALETTE_SESSIONS).map((session) => ({
        id: `open-${session.id}`,
        label: session.title,
        hint: 'Open',
        onSelect: () => goTo(session.id),
      })),
      ...(open === null
        ? []
        : [
            {
              id: 'archive-session',
              label: 'Archive this Session',
              hint: open.title,
              icon: <IconArchive size="sm" />,
              onSelect: () => onArchive(open),
            },
          ]),
      ...(putAway.length === 0
        ? []
        : [
            {
              id: 'archived-sessions',
              label: 'Archived Sessions',
              hint: `${String(putAway.length)} to give back`,
              icon: <IconArchive size="sm" />,
              onSelect: () => setPlace('archived'),
            },
            ...putAway.slice(0, PALETTE_SESSIONS).map((session) => ({
              id: `restore-${session.id}`,
              label: session.title,
              hint: 'Restore',
              onSelect: () => onRestore(session),
            })),
          ]),
    ],
  }

  return [
    places,
    ...(active === null ? [] : [about]),
    {
      label: 'Projects',
      entries: [
        // The rank is the Project's place in the bar and never its place in this list: the
        // keystroke goes to the nth tab, and counting the entries left after the active one has
        // been taken out is a palette offering a keystroke that lands on another Project.
        ...projects
          .map((project, index) => ({ project, rank: index + 1 }))
          .filter(({ project }) => project.id !== active?.id)
          .map(({ project, rank }) => ({
            id: `switch-${project.id}`,
            label: `Switch to ${project.name}`,
            keys: keysOfRank(rank),
            tone: project.tone,
            onSelect: () => selectProject(project.id),
          })),
        {
          id: 'new-project',
          label: 'New Project…',
          icon: <IconFolderPlus size="sm" />,
          onSelect: () => setCreating(true),
        },
      ],
    },
    {
      label: 'Appearance',
      entries: [
        {
          id: 'theme',
          label: `Theme: ${preference}`,
          icon: <IconSun size="sm" />,
          onSelect: () => setThemePreference(nextThemePreference(preference)),
        },
        {
          id: 'fold',
          label: 'Fold the sidebar',
          keys: keysOf('sidebar'),
          icon: <IconLayoutSidebar size="sm" />,
          onSelect: toggleCollapsed,
        },
      ],
    },
  ]
}

/** What `>` widens to: the same places, for every Project rather than the one in front. */
function everywhereIn(projects: ShellProject[], goTo: (entryId: string) => void): CommandGroup[] {
  return [
    {
      label: 'Journals',
      entries: projects.map((project) => ({
        id: `journal-${project.id}`,
        label: 'Journal',
        hint: project.name,
        tone: project.tone,
        onSelect: () => {
          selectProject(project.id)
          goTo(JOURNAL_ENTRY)
        },
      })),
    },
  ]
}
