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
  sessionCommands,
  type ArchivedProject,
  type ArchivedSession,
  type CommandGroup,
  type JournalFilter,
  type ProfileFacts,
  type ProjectDraft,
  type RepositoryLine,
  type ShellProject,
  type ShellSession,
} from '@hemera/ui'
import {
  IconFolderPlus,
  IconHome,
  IconLayoutSidebar,
  IconSettings,
  IconSun,
  IconTimelineEvent,
} from '@hemera/ui/icons'

import { ArchivedPage } from './pages/archived.tsx'
import { FirstLaunchPage } from './pages/first-launch.tsx'
import { HomePage } from './pages/home.tsx'
import { JournalPage } from './pages/journal.tsx'
import { ProjectSettingsPage } from './pages/project-settings.tsx'
import { SessionPage } from './pages/session.tsx'
import { SettingsPage } from './pages/settings.tsx'
import { lineOf, linesOf } from './journal-lines.ts'
import { dayOf } from './when.ts'
import {
  archiveSession,
  closeSessions,
  createSession,
  loadSessions,
  openSession,
  renameSession,
  restoreSession,
  retryMessage,
  sendMessage,
  sessionsSnapshot,
  subscribeToSessions,
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
  rememberSession,
  rememberedSession,
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

/** The entries of the sidebar that are places and not Sessions, so an id can be told apart. */
const PLACES: string[] = [HOME_ENTRY, JOURNAL_ENTRY, PROJECT_SETTINGS_ENTRY]

/** How many of the most recent entries the Home shows, which is a glance and not a page. */
const ACTIVITY = 4

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
  const threads = useSyncExternalStore(subscribeToSessions, sessionsSnapshot, sessionsSnapshot)

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

  /**
   * Which Session the window is in, read off the entry it is on (design D4b-04).
   *
   * The sidebar lists its places and its Sessions in one list and answers with one identifier,
   * so what is not one of the three places is a Session — and the thread below follows that,
   * wherever the entry came from: a row, the palette, a line of the Journal or the preference
   * the window started on.
   */
  const openId = PLACES.includes(shell.activeEntryId) ? null : shell.activeEntryId
  const open =
    threads.sessions.find((one) => one.id === openId) ??
    threads.archived.find((one) => one.id === openId) ??
    null

  /** The Sessions of the active Project, as the sidebar, the Home and the palette draw them. */
  const sessions = useMemo(
    (): ShellSession[] =>
      threads.sessions.map((session) => ({
        id: session.id,
        title: session.title,
        writtenAt: dayOf(new Date(session.lastWrittenAt), new Date()),
      })),
    [threads.sessions],
  )

  /** The archived ones, as the palette offers to restore them. */
  const archivedSessions = useMemo(
    (): ArchivedSession[] =>
      threads.archived.map((session) => ({
        id: session.id,
        title: session.title,
        archivedAt: dayOf(new Date(session.archivedAt ?? session.lastWrittenAt), new Date()),
      })),
    [threads.archived],
  )

  // Everything the window shows about the data folder, asked for once it is open.
  useEffect(() => {
    void loadProjects()
    void loadUnseen()
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

  /**
   * The Journal of whichever Project is in front, read again when that changes and every time
   * the window lands on one of the two pages that show it.
   *
   * Asked again rather than followed: the engine writes a line for everything that happens —
   * a Session made, a message kept — and a page holding the answer it was given when the
   * Project was opened would be a Journal that stops at whatever had happened by then.
   */
  useEffect(() => {
    if (shell.activeProjectId === null) {
      closeJournal()
      return
    }
    if (place !== 'entry') return
    if (shell.activeEntryId !== JOURNAL_ENTRY && shell.activeEntryId !== HOME_ENTRY) return
    void openJournal(shell.activeProjectId)
  }, [shell.activeProjectId, shell.activeEntryId, place])

  // The Sessions of that Project, open and archived, read again when the Project changes.
  useEffect(() => {
    if (shell.activeProjectId === null) {
      closeSessions()
      return
    }
    void loadSessions(shell.activeProjectId)
  }, [shell.activeProjectId])

  // The thread of whichever Session the window is on, and nothing at all when it is elsewhere.
  useEffect(() => {
    void openSession(openId)
  }, [openId])

  /**
   * Where a Project opens, once its Sessions have arrived (design D4b-07).
   *
   * The Session it was left on, if it is still there and not archived; the one written in most
   * recently otherwise; and the Home when the Project has none — never the archives, because
   * work that was put away is not work to come back to.
   *
   * Once per Project and per run of the window, which is what the set is for: this answers
   * "where does this Project open", and a window that answered it again every time a list came
   * back would take the user out of the Home they had just gone to.
   */
  const opened = useRef(new Set<string>())
  useEffect(() => {
    const projectId = shell.activeProjectId
    if (projectId === null || !threads.loaded || threads.projectId !== projectId) return
    if (opened.current.has(projectId)) return
    opened.current.add(projectId)
    const remembered = threads.sessions.find((one) => one.id === rememberedSession(projectId))
    const wanted = remembered ?? threads.sessions[0]
    if (wanted !== undefined) selectEntry(wanted.id)
  }, [shell.activeProjectId, threads.loaded, threads.projectId, threads.sessions])

  // And written down as it changes, so the next start opens where this one was left.
  useEffect(() => {
    if (shell.activeProjectId === null || openId === null) return
    rememberSession(shell.activeProjectId, openId)
  }, [shell.activeProjectId, openId])

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
   * A Session made in the Project in front, and the window taken into it.
   *
   * With no Project there is nothing to make it in: the store refuses it in words and creates
   * nothing, which is the scenario « Aucun Projet actif ».
   */
  const newSession = useCallback(async (): Promise<void> => {
    const made = await createSession(shell.activeProjectId)
    if (made !== null) goTo(made.id)
  }, [shell.activeProjectId, goTo])

  /** Archived, and the window taken to the Home when what it was reading has just left it. */
  const archiveOne = useCallback(
    async (id: string): Promise<void> => {
      const went = await archiveSession(id)
      if (went && openId === id) goTo(HOME_ENTRY)
    },
    [openId, goTo],
  )

  /** Restored, and opened: bringing a Session back is going back to work in it. */
  const restoreOne = useCallback(
    async (id: string): Promise<void> => {
      if (await restoreSession(id)) goTo(id)
    },
    [goTo],
  )

  const run = useCallback(
    (action: ShortcutAction) => {
      if (action.kind === 'sidebar') {
        toggleCollapsed()
        return
      }
      if (action.kind === 'new-session') {
        void newSession()
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

  /**
   * What the palette offers about the Sessions, written by the design system and not here.
   *
   * The wording of a Session — what `New session` is called, what restoring one says — belongs
   * beside the sidebar row and the header that use the same words; this hands over the lists
   * and what each entry does.
   */
  const sessionGroups = useMemo(
    (): CommandGroup[] =>
      active === null
        ? []
        : sessionCommands({
            sessions,
            archived: archivedSessions,
            current: sessions.find((one) => one.id === openId) ?? null,
            newSessionKeys: keysOf('new-session'),
            onNewSession: () => void newSession(),
            onOpenSession: goTo,
            onArchiveSession: (id) => void archiveOne(id),
            onRestoreSession: (id) => void restoreOne(id),
          }),
    [active, sessions, archivedSessions, openId, goTo, newSession, archiveOne, restoreOne],
  )

  const groups = useMemo(
    (): CommandGroup[] =>
      commandsFor(active, projects, goTo, setPlace, setCreating, preference, sessionGroups),
    [active, projects, goTo, preference, sessionGroups],
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
      sessions={sessions}
      // Nothing of the list while the settings or the archives are open: they are places of
      // their own, and the entry the window was on before is not where it is now.
      activeEntryId={place === 'entry' ? shell.activeEntryId : null}
      onSelectEntry={goTo}
      archivedCount={archivedSessions.length}
      onNewSession={() => void newSession()}
      onRenameSession={(id, title) => void renameSession(id, title)}
      onArchiveSession={(id) => void archiveOne(id)}
      onOpenArchived={() => setPlace('archived')}
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
    if (active === null) {
      return (
        <FirstLaunchPage
          onCreateProject={() => setCreating(true)}
          commandShortcut={keysOf('command')}
        />
      )
    }
    if (place === 'archived') {
      return <ArchivedPage sessions={threads.archived} onRestore={(id) => void restoreOne(id)} />
    }
    if (open !== null) {
      return sessionPage(open)
    }
    if (shell.activeEntryId === JOURNAL_ENTRY) {
      return (
        <JournalPage
          projectName={active.name}
          entries={linesOf(journal.entries, new Date(), { onOpenSession: goTo })}
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
    return (
      // Keyed on the Project: what is written in the composer is written about that Project,
      // and carrying it over to the next one is carrying a question to somewhere it was never
      // asked. Changing Project starts a blank one, as opening the window does.
      <HomePage
        key={active.id}
        projectName={active.name}
        entries={linesOf(journal.entries, new Date(), { onOpenSession: goTo }).slice(0, ACTIVITY)}
        sessions={sessions}
        onOpenJournal={() => goTo(JOURNAL_ENTRY)}
        onOpenSession={goTo}
        // `Resume` is the last Session that is not archived, which is the first of the list
        // the engine answered with (design D4b-07).
        onResume={() => {
          const latest = threads.sessions[0]
          if (latest !== undefined) goTo(latest.id)
        }}
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
        // A Session with what was written as its first message, in one transaction, and the
        // window goes into it: the composer of the Home is where a Session begins (D4b-03).
        onSend={async (text: string) => {
          const made = await createSession(shell.activeProjectId, text)
          if (made === null) return sessionsSnapshot().refusal
          goTo(made.id)
          return null
        }}
      />
    )
  }

  /** The thread of the Session the window is on, with what can be done to it. */
  function sessionPage(session: Session) {
    return (
      <SessionPage
        // Keyed on the Session: what is half written in one thread is not a draft of the next.
        key={session.id}
        session={session}
        projectName={active?.name ?? ''}
        entries={threads.entries}
        pending={threads.pending.filter((one) => one.sessionId === session.id)}
        onSend={sendMessage}
        onRename={(title) => void renameSession(session.id, title)}
        onArchive={() => void archiveOne(session.id)}
        onRestore={() => void restoreOne(session.id)}
        onRetry={retryMessage}
      />
    )
  }
}

/** What the palette offers about the Project in front, and about the window itself. */
function commandsFor(
  active: ShellProject | null,
  projects: ShellProject[],
  goTo: (entryId: string) => void,
  setPlace: (place: Place) => void,
  setCreating: (creating: boolean) => void,
  preference: ReturnType<typeof themePreference>,
  /** What the Sessions offer, written by the design system and placed right after the places. */
  sessionGroups: CommandGroup[],
): CommandGroup[] {
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

  return [
    places,
    ...sessionGroups,
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
