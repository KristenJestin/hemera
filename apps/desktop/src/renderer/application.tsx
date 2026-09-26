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

import type {
  AgentAvailability,
  AgentProvider,
  ComposerChoice,
  EngineStatus,
  MotionMeasure,
  Project,
  Session,
} from '@hemera/ipc'
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
  type OfferedAgent,
  type ProfileFacts,
  type ProjectSettingsDraft,
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
import {
  agentOf,
  agentSnapshot,
  checkAgents,
  chooseOption,
  decide,
  listenToAgents,
  loadAgents,
  offerAgent,
  offeringOf,
  optionsOf,
  readOptions,
  say,
  setOffered,
  stopTurn,
  subscribeToAgent,
  updateAgent,
} from './agent-store.ts'
import { bareRowOf, offeredOf } from './bare-mode.ts'
import {
  acceptProposal,
  addToCatalogue,
  declineProposal,
  listenToTools,
  readCatalogue,
  readContext,
  readPortless,
  removeCommand,
  saveCommand,
  readRuns,
  runCommand,
  stopRun,
  subscribeToTools,
  toolsSnapshot,
} from './tools-store.ts'
import { lineOf, linesOf, whenOf } from './journal-lines.ts'
import { repositoryLinesOf } from './project-lines.ts'
import {
  addRecipeStep,
  cleanUp,
  createDedicated,
  createOnFolder,
  listenToWorkspaces,
  moveRecipeStep,
  planDedicated,
  readPlanRepositories,
  readMainStatus,
  readProjectVariables,
  readRecipe,
  readWorkspaces,
  removeRecipeStep,
  removeVariable,
  resumePreparation,
  selectRun,
  setVariable,
  showStepRun,
  showWorkspace,
  stopService,
  subscribeToWorkspaces,
  updateRecipeStep,
  workspacesSnapshot,
} from './workspaces-store.ts'
import {
  archivedSessions,
  archiveSession,
  chooseWorkspace,
  closeSessions,
  endedTurnsOf,
  listenToWorkspaces as listenToOfferedWorkspaces,
  offeredWorkspacesOf,
  workspaceRootOf,
  openSession,
  openSessions,
  readSessions,
  renameSession,
  restoreSession,
  sessionsSnapshot,
  startSession,
  subscribeToSessions,
  writeMessage,
} from './sessions-store.ts'
import { closeSpec, forgetSpecRefusal, listenToSpecs, openSpec } from './spec-store.ts'
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
  setBranchPrefix,
  setWorkspacesRoot,
  subscribeToProjects,
  updateRepository,
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

/**
 * The system's own folder picker, which belongs to the main process.
 *
 * Opened on the folder the caller says the user is working in, when it says one: a command's
 * picker starts where that command runs from. The pages that have nowhere in mind ask for no
 * start, and the system's own last place is what they get.
 */
async function pickFolder(start?: string): Promise<string | null> {
  return await window.hemera.invoke('dialog.pickFolder', start === undefined ? {} : { start })
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

/**
 * The agent a Session runs, as its composer's menu lists it (design D5-06, D17-11).
 *
 * One, already chosen and never changed: a Session keeps the agent it was made with, and the
 * menu lists it because the model and the effort under it belong to that agent. A Session made
 * before the agents existed has none, and the menu then says so where the name would be.
 */
function runsOn(session: Session, known: readonly AgentAvailability[]): OfferedAgent[] {
  const provider = session.provider
  if (provider === null) return []
  const found = known.find((one) => one.id === provider)
  return [{ id: provider, name: found?.label ?? provider, available: true, signedIn: true }]
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
  // What the agents are doing, per Session: a turn is not a fact about the window, and a window
  // that heard only about the Session on screen would lose the one behind it (design D5-12).
  const agents = useSyncExternalStore(subscribeToAgent, agentSnapshot, agentSnapshot)
  // The runs of the Sessions, as they were last pushed: the thread's blocks and the Commands
  // panel read the same run from here (design D6-12).
  const tools = useSyncExternalStore(subscribeToTools, toolsSnapshot, toolsSnapshot)
  // The Workspaces of the Project whose settings are open, and the one shown under them (D8-02).
  const places = useSyncExternalStore(subscribeToWorkspaces, workspacesSnapshot, workspacesSnapshot)
  // What a page holds is a name, and what the channels take is one of the agents the engine
  // knows: resolved among them here rather than asserted at each call, so a name that answers to
  // none of them asks for nothing at all.
  const providerOf = (id: string): AgentProvider | null =>
    agents.agents.find((one) => one.id === id)?.id ?? null

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
  /**
   * What each Project's composer was left on, as the data folder remembers it (design D5-17).
   *
   * Read at the start and read again after every choice made in a Home: the engine writes this
   * preference itself when it is told what an agent offers, so what the window holds is what the
   * engine wrote rather than a copy this page keeps in parallel. It is what a Home opens on when
   * the reader comes back to a Project they already chose an agent in.
   */
  const [composers, setComposers] = useState<Record<string, ComposerChoice>>({})
  /**
   * Which agent is being updated, and what its own tool last said about it (design D5-18).
   *
   * The output is kept per agent and never overwritten by the next one: an update is a command
   * whose words are the reason it refused, and losing them would leave the reader with a button
   * that has nothing to show for itself.
   */
  const [updating, setUpdating] = useState<string | null>(null)
  const [updateOutput, setUpdateOutput] = useState<Readonly<Record<string, string>>>({})
  /** What was put away, which only the archived page asks for and only while it is open. */
  const [putAway, setPutAway] = useState<Session[]>([])
  /** The Session whose title is being typed into, when one is. */
  const [naming, setNaming] = useState<string | null>(null)
  /** Which Project the window has already decided where to look in. */
  const placed = useRef<string | null>(null)
  /**
   * The Sessions the window has already sent back to the list, once their first entry arrived.
   *
   * A Session is named by the first message written in it, and the engine writes that message
   * itself: nothing else tells the sidebar that the Session it lists stopped being "New
   * session", so the first entry of one is what sends it to the list again.
   */
  const named = useRef(new Set<string>())
  /** The ended turns that already sent the list to be read again for a Session's Workspace. */
  const turnsRead = useRef(new Set<string>())
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
  /** The two halves of `open` that effects may depend on, which are not the same every render. */
  const openId = open?.id ?? null
  const provider = open?.provider ?? null
  const openSpecId = open?.specId ?? null

  // Everything the window shows about the data folder, asked for once it is open.
  useEffect(() => {
    void loadProjects()
    void loadUnseen()
    // Where the window was looking last. Read once, and read before anything can decide which
    // Session to open: the Session an opening lands on is this answer's and no one else's.
    void window.hemera
      .invoke('preferences.read', {})
      .then((worn) => {
        setRemembered(worn.activeSessions)
        // Nothing where an older data folder, or an engine that predates the preference, answers
        // without it: what a window does then is open on no choice at all, not fall over.
        setComposers(worn.composers ?? {})
      })
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

  // The engine, listened to for as long as the window is open: an entry an agent writes is a fact
  // about a Session and not about the page on screen, so one subscription holds them all and each
  // page reads the Session it draws (design D5-12).
  useEffect(() => listenToAgents(), [])
  // And the runs, heard on the same channel: a command a Session started while another was on
  // screen has moved on by the time the reader comes back to it (D6-12).
  useEffect(() => listenToTools(), [])
  // And the Workspaces of the Project in front, which the composer's pill offers: one becomes
  // `ready`, or is cleaned up, while a Home or a Session is on screen (D8-08).
  useEffect(() => listenToOfferedWorkspaces(), [])
  // And the Workspaces the settings show, heard on it too: a preparation moves on whatever page
  // is on screen (D8-05).
  useEffect(() => listenToWorkspaces(), [])

  // A Spec is written by whoever holds its right and read live by every Session on it (D7-11).
  // A Spec step can change a Session too — accepting a proposal makes it `define`, a Session is
  // opened on a Spec — so the Sessions of the Project in front are read again with it.
  useEffect(
    () =>
      listenToSpecs((projectId) => {
        if (projectId === shellState().activeProjectId) void readSessions(projectId)
      }),
    [],
  )

  // What a Spec act was refused with belongs to the Session it was made in: accepting a proposal
  // refused in one Session is not a sentence to show under the composer of the next.
  useEffect(() => {
    forgetSpecRefusal()
  }, [openId])

  // The Spec of the Session on screen, opened when that Session defines one (D7-07).
  useEffect(() => {
    if (openSpecId === null) {
      closeSpec()
      return
    }
    void openSpec(openSpecId)
  }, [openSpecId])

  // The list the sidebar draws is read again when a Session gets its first entry: the engine
  // writes the user's own message as part of the prompt (design D5-11), and that message is what
  // proposes the title the Session is listed under (design D4b-05). Once per Session and once per
  // first entry — every later entry of a turn changes nothing about how the Session is listed.
  useEffect(() => {
    const projectId = shell.activeProjectId
    if (projectId === null) return
    let stale = false
    for (const [sessionId, pushed] of agents.sessions) {
      if (named.current.has(sessionId)) continue
      if (!pushed.entries.some((one) => one.seq === 1)) continue
      named.current.add(sessionId)
      stale = true
    }
    if (stale) void readSessions(projectId)
  }, [agents.sessions, shell.activeProjectId])

  // And when a turn ends in a Session the list still says is free to change Workspace: its agent
  // started during that turn, after the read above, and the pill is fixed from then on (D8-08).
  useEffect(() => {
    const projectId = shell.activeProjectId
    if (projectId === null) return
    const unread = endedTurnsOf(sessions.sessions, agents.sessions).filter(
      (id) => !turnsRead.current.has(id),
    )
    for (const id of unread) turnsRead.current.add(id)
    if (unread.length > 0) void readSessions(projectId)
  }, [agents.sessions, sessions.sessions, shell.activeProjectId])

  // What the agent of the Session on screen offers, asked when that Session becomes the one the
  // window is on: an agent announces its models and its modes when it starts, and what it is on
  // now is its own answer rather than a value this window remembers (design D5-13).
  useEffect(() => {
    if (openId === null || provider === null) return
    void readOptions(openId)
  }, [openId, provider])

  // The runs of the Session on screen, read when it becomes the one the window is on: a run it
  // started before this window was opened is a row, and the pushes only tell what changes.
  useEffect(() => {
    if (openId === null) return
    void readRuns(openId)
  }, [openId])

  // The catalogue of the Project whose settings are open, read when they are opened: the agent
  // may have been told of a command the page has not heard of, and the list is the engine's.
  const settingsOf = shell.activeEntryId === PROJECT_SETTINGS_ENTRY ? (current?.id ?? null) : null
  useEffect(() => {
    if (settingsOf === null) return
    void readCatalogue(settingsOf)
    // And whether this machine has Portless, which the engine looks up once (D8-10).
    void readPortless()
    // And its Workspaces, which the engine's `workspace` event keeps current from then on (D8-02),
    // then what Git says of `main`, which its row sums up (D8-15); and its own variables, which a
    // Workspace shown lists under its own (D8-06).
    void readWorkspaces(settingsOf).then(async () => await readMainStatus(settingsOf))
    void readProjectVariables(settingsOf)
    // And the recipe each dedicated Workspace is prepared with (D8-05).
    void readRecipe(settingsOf)
    // The Workspace shown is the page's: leaving it puts the Workspace away.
    return () => void showWorkspace(null)
  }, [settingsOf])

  // And what Git says of `main` again whenever the Project changes while its settings are open: a
  // repository declared, moved or removed is another first repository for its row to sum up, or
  // the first one at all (D8-15). Before its Workspaces were ever listed, this asks nothing.
  const settingsVersion = settingsOf === null ? null : (current?.version ?? null)
  useEffect(() => {
    if (settingsOf === null) return
    void readMainStatus(settingsOf)
  }, [settingsOf, settingsVersion])

  // And what it was provided, for its Context tab: read when it is opened, and again by the store
  // whenever a turn ends or a change of the Workspace's instructions is delivered (D6-10).
  useEffect(() => {
    if (openId === null || provider === null) return
    void readContext(openId)
  }, [openId, provider])

  // What this machine has, read when the window opens. The Home's composer picks the agent a
  // Session is made with, and a list that arrived only once the Settings had been opened would
  // make the Home claim there is none. This question stays on the machine — a command and the
  // version it prints — where the one below it leaves (design D5-18).
  useEffect(() => {
    void loadAgents()
  }, [])

  // What each registry published, asked when the Agents section is opened and only then: the
  // question leaves the machine, and a list read on every start would be a list asked on the
  // reader's behalf (design D5-18).
  useEffect(() => {
    if (place !== 'settings') return
    void checkAgents()
  }, [place])

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
        // What the Project says of each — whether a dedicated Workspace takes it (D8-04), the
        // icon it wears — beside what the disk says.
        setRepositories(repositoryLinesOf(found, current))
      })
      .catch(unanswered('repositories.status'))
    // And what the Workspace holds that has not been declared, which is what the page offers
    // instead of asking for a path to be typed twice.
    void window.hemera
      .invoke('workspace.folders', { root })
      .then((found) => {
        if (!asking) return
        setFolders(
          found.map((one) => ({
            path: one.path,
            branch: one.git,
            exists: one.exists,
            includedByDefault: true,
            icon: null,
          })),
        )
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
   * A new Session in the Project in front.
   *
   * A Session is made with the agent it will run and keeps it, so the agent is chosen where the
   * Session is started — the composer of the Home, which is where this goes (design D5-17). The
   * Session exists from the moment that first message is sent, and the message names it (D4b-01):
   * a Session made before there is an agent to answer it would be a thread nothing can be said
   * to, which is exactly what the Home used to make.
   */
  const newSession = useCallback(() => {
    if (shell.activeProjectId === null) return
    goTo(HOME_ENTRY)
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
   * Reads back what the engine wrote of the composers, after a choice was made in one.
   *
   * The engine writes the preference itself when it is asked what an agent offers a Project
   * (D5-17): this reads that answer rather than keeping a copy of the choice here, so what the
   * Home opens on when the reader comes back to a Project is what was actually written down.
   */
  const readComposers = useCallback(() => {
    void window.hemera
      .invoke('preferences.read', {})
      .then((worn) => setComposers(worn.composers ?? {}))
      .catch(unanswered('preferences.read'))
  }, [])

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

  /**
   * The files of a Workspace of the Project in front, searched and picked where a composer is
   * writing about it (D8-08): nothing while its folder is not known yet.
   */
  async function searchIn(workspaceId: string | null, query: string): Promise<string[]> {
    const root =
      current === null ? null : workspaceRootOf(workspaceId, sessions.workspaces, current.mainPath)
    return root === null ? [] : await window.hemera.invoke('workspace.files', { root, query })
  }

  async function pickIn(workspaceId: string | null): Promise<string[]> {
    const root =
      current === null ? null : workspaceRootOf(workspaceId, sessions.workspaces, current.mainPath)
    return root === null ? [] : await window.hemera.invoke('dialog.pickFiles', { root })
  }

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
          agents={{
            agents: agents.agents.map((one) => ({
              id: one.id,
              name: one.label,
              found: one.found,
              version: one.version,
              authenticated: one.authenticated,
              installHint: one.installHint,
              loginHint: one.loginHint,
              installer: one.installer,
              latest: one.latest,
              // What its adapter declares about running it bare here (D6-02): what it keeps that
              // Hemera does not control, or the adapter's own reason when it cannot run here.
              bare: bareRowOf(one),
            })),
            checked: agents.checked,
            updating,
            output: updateOutput,
            onUpdate: (id) => {
              // Resolved among the agents the engine knows: what the page holds is a string, and
              // the one the channel takes is the agent's own name.
              const chosen = agents.agents.find((one) => one.id === id)
              if (chosen === undefined) return
              setUpdating(id)
              void updateAgent(chosen.id)
                .then((answered) => {
                  if (answered !== null) {
                    setUpdateOutput((said) => ({ ...said, [id]: answered.output }))
                  }
                })
                .finally(() => setUpdating(null))
            },
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
          filter={journal.kind}
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
          project={{
            name: current.name,
            tone: current.tone,
            mainPath: current.mainPath,
            specPrefix: current.specPrefix,
            workspacesRoot: current.workspacesRoot,
            branchPrefix: current.branchPrefix,
          }}
          repositories={repositories}
          onSave={async (draft: ProjectSettingsDraft) => {
            // One change after the other, each carrying the version the one before it left: sent
            // together, the second would be refused as stale.
            const latest = () =>
              projectsSnapshot().projects.find((one) => one.id === current.id) ?? current
            // The prefix goes with the identity: only the keys minted from now on take it (D7-02).
            const renamed = await renameProject(current, {
              name: draft.name,
              tone: draft.tone,
              specPrefix: draft.specPrefix,
            })
            if (!renamed) return projectsSnapshot().refusal
            const changes = [
              draft.mainPath === current.mainPath
                ? null
                : async () => await moveMainWorkspace(latest(), draft.mainPath),
              // A blank is the default, which the channel carries as null (Decided 17).
              draft.workspacesRoot === current.workspacesRoot
                ? null
                : async () => await setWorkspacesRoot(latest(), draft.workspacesRoot),
              draft.branchPrefix === current.branchPrefix
                ? null
                : async () => await setBranchPrefix(latest(), draft.branchPrefix),
            ]
            for (const change of changes) {
              // oxlint-disable-next-line no-await-in-loop -- one version at a time; see above
              if (change !== null && !(await change())) return projectsSnapshot().refusal
            }
            return null
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
          onUpdateRepository={async (path, next) => {
            // Read again rather than closed over, as a declaration is: see above.
            const latest =
              projectsSnapshot().projects.find((one) => one.id === current.id) ?? current
            const went = await updateRepository(latest, path, {
              path: next.path,
              icon: next.icon,
              included: next.includedByDefault,
            })
            return went ? null : projectsSnapshot().refusal
          }}
          onRemoveRepository={(path) => void removeRepository(current, path)}
          commands={tools.catalogues.get(current.id) ?? []}
          portlessInstalled={tools.portlessInstalled}
          onSaveCommand={async (command, existing) =>
            await saveCommand({ projectId: current.id, ...command }, existing)
          }
          onRemoveCommand={(name) => void removeCommand(current.id, name)}
          onArchive={() => void archiveProject(current)}
          workspaces={places.workspaces.get(current.id) ?? []}
          mainStatus={places.mainStatus.get(current.id) ?? null}
          shown={places.shown?.projectId === current.id ? places.shown : null}
          projectVariables={places.variables.get(current.id) ?? []}
          workspaceActions={{
            onShow: (id) => {
              const chosen = places.workspaces.get(current.id)?.find((one) => one.id === id)
              void showWorkspace(chosen ?? null)
            },
            onResume: (id) => void resumePreparation(id),
            onSetVariable: async (workspaceId, key, value) =>
              await setVariable(current.id, workspaceId, key, value),
            onRemoveVariable: (workspaceId, key) =>
              void removeVariable(current.id, workspaceId, key),
            onSelectRun: selectRun,
            onShowStepRun: (runId) => void showStepRun(runId),
            onStopService: (runId) => void stopService(runId),
          }}
          onPlanWorkspace={async () => await planDedicated(current.id)}
          onReadPlanWorkspace={async (relativePaths, reading, onRead) =>
            await readPlanRepositories(current.id, null, '', relativePaths, reading, onRead)
          }
          onCreateDedicated={async (name, worktrees) =>
            await createDedicated(current.id, name, worktrees)
          }
          onCreateWorkspace={async (path, name) => await createOnFolder(current.id, path, name)}
          onCleanupWorkspace={async (id) => await cleanUp(current.id, id)}
          recipe={places.recipes.get(current.id) ?? []}
          onAddRecipeStep={async (step) => await addRecipeStep(current.id, step)}
          onUpdateRecipeStep={async (id, step) => await updateRecipeStep(current.id, id, step)}
          onRemoveRecipeStep={(id) => void removeRecipeStep(current.id, id)}
          onMoveRecipeStep={(id, direction) => void moveRecipeStep(current.id, id, direction)}
          onSetProjectVariable={async (key, value) =>
            await setVariable(current.id, null, key, value)
          }
          onRemoveProjectVariable={(key) => void removeVariable(current.id, null, key)}
          workspacesRefusal={places.refusal}
        />
      )
    }
    if (open !== null) {
      // The folder the Session works in, which its runs are said relative to: its Workspace's,
      // `main`'s when it has none, and none until the list has named it (D8-08).
      const root =
        current === null
          ? null
          : workspaceRootOf(open.workspaceId, sessions.workspaces, current.mainPath)
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
          // A prompt, a Stop or a decision the engine refused is said here too: the composer does
          // not wait for a turn, and a refusal nobody draws is a message that just goes unanswered.
          refusal={sessions.refusal ?? agents.refusal}
          agent={agentOf(open.id)}
          sessions={sessions.sessions}
          running={(sessionId) => agentOf(sessionId).running}
          agents={runsOn(open, agents.agents)}
          options={optionsOf(open.id)}
          onWrite={async (body) => await writeInto(open.id, body)}
          onSay={(text) => void say(open.id, text)}
          onStop={() => void stopTurn(open.id)}
          onDecide={(toolCallId, option) => void decide(open.id, toolCallId, option.optionId)}
          onChooseOption={(optionId, value) => void chooseOption(open.id, optionId, value)}
          onRename={(title) => void renameTo(open, title)}
          onStartEditing={() => setNaming(open.id)}
          onCancelEditing={() => setNaming(null)}
          onArchive={() => void archive(open)}
          onSearchFiles={async (query: string) => await searchIn(open.workspaceId, query)}
          onPickFiles={async () => await pickIn(open.workspaceId)}
          commandRuns={tools.runs.get(open.id) ?? []}
          // An address a run published is opened by the browser: the window hands every web
          // address to the platform and never navigates away itself.
          onOpenUrl={(url) => {
            window.open(url, '_blank', 'noopener')
          }}
          onStopRun={(runId) => void stopRun(open.id, runId)}
          root={root}
          context={tools.contexts.get(open.id) ?? null}
          // A line that names a command of the catalogue runs that command, in its folder; any
          // other line is a one-off, run in the Workspace root and not added to the catalogue.
          onRunCommand={(line) => {
            const known = tools.contexts.get(open.id)?.commands.some((one) => one.name === line)
            void runCommand(open.id, known === true ? { name: line } : { line })
          }}
          workspaces={offeredWorkspacesOf(sessions.workspaces, open.workspaceId)}
          onChooseWorkspace={(workspaceId) => void chooseWorkspace(open, workspaceId)}
          onAcceptProposal={async (proposalId) => await acceptProposal(open.id, proposalId)}
          onDeclineProposal={async (proposalId) => await declineProposal(open.id, proposalId)}
          onAddToCatalogue={addToCatalogue}
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
        agents={agents.agents.map(offeredOf)}
        // What this Project's composer was left on, which is what the Home opens on.
        choice={composers[active.id] ?? null}
        offeringOf={(chosen) => offeringOf(active.id, providerOf(chosen))}
        onChooseAgent={(chosen) => {
          const asked = providerOf(chosen)
          if (asked !== null) void offerAgent(active.id, asked).then(readComposers)
        }}
        // A choice made before there is a Session is made on the agent the engine kept running
        // for this composer, and what comes back is what it announces then: the effort of a
        // reasoning model is published by that answer and by nothing else (D5-13, D5-17).
        onChooseOption={(chosen, optionId, value) => {
          const asked = providerOf(chosen)
          if (asked !== null) void setOffered(active.id, asked, optionId, value).then(readComposers)
        }}
        onOpenSession={goTo}
        onOpenAllSessions={() => setPlace('archived')}
        onOpenJournal={() => goTo(JOURNAL_ENTRY)}
        // The files of the Workspace the pill chose, which is `main` until another is (D8-08).
        onSearchFiles={searchIn}
        onPickFiles={pickIn}
        // What the greeting promises: the first message makes the Session, and the Session is
        // made with the agent chosen at the end of the box. What was chosen with it is not handed
        // over again — the engine kept those choices against this Project and this agent, and the
        // Session it opens is opened on them (D5-17). An agent the engine does not know is
        // refused by the engine rather than by a sentence written here.
        workspaces={offeredWorkspacesOf(sessions.workspaces)}
        onSend={async (text, chosen, workspaceId, intent) => {
          const asked = providerOf(chosen)
          const made = await startSession(active.id, asked, workspaceId)
          if (made === null) return sessionsSnapshot().refusal
          goTo(made.id)
          // The thread is read before the agent is spoken to: the message the engine writes as
          // part of the prompt then lands on a thread that is already on screen (D5-11).
          await openSession(made.id)
          // The turn is watched in the Session, which is where the window just went, and the Home
          // does not wait for it: a first answer can take a minute.
          // With what it was sent for: New Spec asks the agent for a Spec proposal (issue #128).
          void say(made.id, text, intent)
          return null
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
