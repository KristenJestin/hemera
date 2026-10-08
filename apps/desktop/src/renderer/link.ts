/**
 * The window's link to main, as components and hooks use it: a call is a promise that rejects
 * with the decoded typed error, a stream is a subscription whose unsubscribe interrupts it. Effect
 * stays in this file; nothing in a component or a hook sees it.
 *
 * The page opens its own port: it creates the channel, keeps one end, and posts the other to the
 * preload with `window.postMessage`, which hands it to main (`contextBridge` cannot carry a port).
 * A page that reloads opens a new one; main interrupts what the old one had in flight.
 */

import {
  fromMessagePort,
  makeClientProtocol,
  EngineGone,
  StorageFailed,
  WindowRpcs,
  type AgentState,
  type AgentUpdate,
  type AutomaticBackups,
  type BaseBranchEdit,
  type ChatChanged,
  type ChatLine,
  type ChatPage,
  type ChatSummary,
  type DiagnosticsRetention,
  type HemeraAutoStatus,
  type BranchPrefixEdit,
  type Command,
  type CommandSave,
  type EngineStatus,
  type EnvironmentReport,
  type LineCheck,
  type MaskedVariable,
  type Mission,
  type MissionsChange,
  type ModelMark,
  type ProjectLimits,
  type RepositoryInstructions,
  type Need,
  type NeedAnswerAsked,
  type NeedGroup,
  type NotificationSettings,
  type PermissionDecision,
  type NewProject,
  type Preferences,
  type PreferencesChange,
  type NewRepository,
  type Port,
  type Project,
  type RecipeCheck,
  type RecipeEdit,
  type RecipeStep,
  type RecipeStepDraft,
  type Remote,
  type RemoteEdit,
  type RepositoryEdit,
  type RepositoryRemoval,
  type RepositoryStatus,
  type RepositoryStatusChange,
  type RoleModels,
  type SessionSummary,
  type Run,
  type ThreadLine,
  type RunOutput,
  type RunStart,
  type SetupCard,
  type SetupStanding,
  type Sound,
  type SoundPreview,
  type SoundStyle,
  type TesterFinding,
  type UpToDateBase,
  type VariableEdit,
  type VariableKey,
  type WindowNotice,
  type WorkspacesRootEdit,
} from '@hemera/ipc'
import type { AgentProvider, ChatMention, ModelSettingValue, NeverEntry } from '@hemera/core/domain'
import { Cause, Effect, Exit, Option, Predicate, Scope, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

export interface Link {
  /** Rejects with `EngineGone` when the engine is not there. */
  readonly engineStatus: () => Promise<EngineStatus>
  /** The engine's status, then each change of it; `onEnd` hears why it stopped. */
  readonly onEngineStatus: (
    listener: (status: EngineStatus) => void,
    onEnd: (error: EngineGone) => void,
  ) => () => void
  readonly environmentReport: () => Promise<EnvironmentReport>
  /** Starts Hemera again, from scratch. */
  readonly relaunch: () => Promise<void>
  /** Shows the diagnostic log in the system's file manager. */
  readonly showLog: () => Promise<void>
  /** The system's own folder picker: the folder chosen, or null when none was. */
  readonly chooseFolder: () => Promise<string | null>
  readonly preferences: () => Promise<Preferences>
  /** Writes the preferences the change names; main wears a theme written at once. */
  readonly writePreferences: (change: PreferencesChange) => Promise<void>
  /** The Projects, in the order they were added. */
  readonly projects: () => Promise<ReadonlyArray<Project>>
  /** Rejects with `UnknownProject` when it no longer exists. */
  readonly project: (id: string) => Promise<Project>
  /** Each Project as a change left it, for as long as the listener listens. */
  readonly onProjectChanges: (
    listener: (project: Project) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  /** The repositories at a folder and in its direct subfolders, relative to it. */
  readonly detectRepositories: (folder: string) => Promise<ReadonlyArray<string>>
  readonly createProject: (project: NewProject) => Promise<Project>
  readonly setWorkspacesRoot: (edit: WorkspacesRootEdit) => Promise<Project>
  readonly setBranchPrefix: (edit: BranchPrefixEdit) => Promise<Project>
  readonly addRepository: (repository: NewRepository) => Promise<Project>
  readonly removeRepository: (removal: RepositoryRemoval) => Promise<Project>
  readonly updateRepository: (edit: RepositoryEdit) => Promise<Project>
  /** Readable, or Git's reason it is not. */
  readonly repositoryStatus: (id: string) => Promise<RepositoryStatus>
  readonly remotes: (id: string) => Promise<ReadonlyArray<Remote>>
  readonly setRemote: (edit: RemoteEdit) => Promise<Project>
  readonly setBaseBranch: (edit: BaseBranchEdit) => Promise<Project>
  /** Fetches the base now, and answers the commit it gives and how fresh it is. */
  readonly upToDateBase: (id: string) => Promise<UpToDateBase>
  /** Each change of a repository's readability, for as long as the listener listens. */
  readonly onRepositoryChanges: (
    listener: (change: RepositoryStatusChange) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  readonly recipe: (projectId: string) => Promise<ReadonlyArray<RecipeStep>>
  readonly saveRecipe: (edit: RecipeEdit) => Promise<ReadonlyArray<RecipeStep>>
  /** What saving each step would refuse, without writing anything. */
  readonly checkRecipe: (
    projectId: string,
    steps: ReadonlyArray<RecipeStepDraft>,
  ) => Promise<ReadonlyArray<RecipeCheck>>
  /** The Project's variables, each value masked. */
  readonly variables: (projectId: string) => Promise<ReadonlyArray<MaskedVariable>>
  readonly setVariable: (edit: VariableEdit) => Promise<MaskedVariable>
  readonly removeVariable: (key: VariableKey) => Promise<void>
  /** One value, on the user's explicit request. */
  readonly revealVariable: (key: VariableKey) => Promise<string>
  readonly catalogue: (projectId: string) => Promise<ReadonlyArray<Command>>
  readonly saveCommand: (save: CommandSave) => Promise<Command>
  readonly removeCommand: (projectId: string, id: string) => Promise<void>
  /** What saving a line would refuse, as it is typed. */
  readonly checkLine: (line: string) => Promise<LineCheck>
  /** The runs of the Project's main checkout, the newest first. */
  readonly runs: (projectId: string) => Promise<ReadonlyArray<Run>>
  readonly startRun: (start: RunStart) => Promise<Run>
  readonly stopRun: (id: string) => Promise<Run>
  readonly restartRun: (id: string) => Promise<Run>
  readonly runOutput: (id: string) => Promise<RunOutput>
  /** Each run as it changes, for as long as the listener listens. */
  readonly onRunChanges: (listener: (run: Run) => void, onEnd: (error: Error) => void) => () => void
  /** Every pending need of the Profile, by owner: the application's first, then each Project's. */
  readonly needs: () => Promise<ReadonlyArray<NeedGroup>>
  /** Answers a need once, under the answer's key; a need no longer pending answers as it ended. */
  readonly answerNeed: (asked: NeedAnswerAsked) => Promise<Need>
  /** Checks a need of something missing again: withdrawn when it is there now. */
  readonly retryNeed: (id: string) => Promise<Need>
  readonly mission: (id: string) => Promise<Mission>
  /** Each mission and each need as a change left it, for as long as the listener listens. */
  readonly onMissionChanges: (
    listener: (change: MissionsChange) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  /** What main tells the window of notifications, for as long as the listener listens. */
  readonly onNotices: (listener: (notice: WindowNotice) => void) => () => void
  /** A Project's Chats, the latest active first as the engine lists them. */
  readonly chats: (projectId: string) => Promise<ReadonlyArray<ChatSummary>>
  readonly createChat: (projectId: string) => Promise<ChatSummary>
  readonly renameChat: (chatId: string, title: string) => Promise<void>
  /** Rejects with `ChatRefused` when the message could not be handed to the agent. */
  readonly sendToChat: (
    chatId: string,
    text: string,
    mentions: ReadonlyArray<ChatMention>,
  ) => Promise<ChatLine>
  readonly stopChat: (chatId: string) => Promise<void>
  readonly setChatModel: (chatId: string, setting: ModelSettingValue) => Promise<void>
  /** A page of a Chat's transcript, oldest first; the newest page without `before`. */
  readonly transcript: (chatId: string, before: number | null) => Promise<ChatPage>
  /** Each change of a Chat: its title, its model, its transcript, its turns. */
  readonly onChatChanges: (
    listener: (change: ChatChanged) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  readonly missions: (projectId: string) => Promise<ReadonlyArray<Mission>>
  /** The agents this machine knows, installed or not. */
  readonly agents: () => Promise<ReadonlyArray<AgentState>>
  /** The models the user marked, favourite or hidden. */
  readonly modelMarks: () => Promise<ReadonlyArray<ModelMark>>
  readonly markModel: (mark: ModelMark) => Promise<void>
  /** Each role's model at every level, for a Project, or the app's alone with null. */
  readonly roleModels: (projectId: string | null) => Promise<ReadonlyArray<RoleModels>>
  readonly setAppRoleModel: (role: string, setting: ModelSettingValue) => Promise<void>
  /** A role's model in a Project; null takes it back to the application's. */
  readonly setProjectRoleModel: (
    projectId: string,
    role: string,
    setting: ModelSettingValue | null,
  ) => Promise<void>
  /** The commands never run in a Project. */
  readonly neverList: (projectId: string) => Promise<ReadonlyArray<NeverEntry>>
  /** Replaces the list whole; answers it as written. */
  readonly setNeverList: (
    projectId: string,
    entries: ReadonlyArray<NeverEntry>,
  ) => Promise<ReadonlyArray<NeverEntry>>
  /** A Project's cap of sub-agents and the budget its new missions start with. */
  readonly projectLimits: (projectId: string) => Promise<ProjectLimits>
  readonly setProjectLimits: (projectId: string, limits: ProjectLimits) => Promise<ProjectLimits>
  /** The instruction files of a Project's repositories, and how each agent gets them. */
  readonly instructionFiles: (projectId: string) => Promise<ReadonlyArray<RepositoryInstructions>>
  /** Asks every installed agent's registry for its latest version, now. */
  readonly checkAgentUpdates: () => Promise<ReadonlyArray<AgentState>>
  readonly updateAgent: (agent: AgentProvider) => Promise<AgentUpdate>
  readonly hemeraAuto: () => Promise<HemeraAutoStatus>
  readonly setConsent: (consent: boolean) => Promise<void>
  /** The key goes to main to be protected by the system; nothing echoes it back. */
  readonly saveJevKey: (key: string) => Promise<HemeraAutoStatus>
  readonly removeJevKey: () => Promise<HemeraAutoStatus>
  readonly notificationSettings: () => Promise<NotificationSettings>
  readonly setNotificationKind: (id: string, on: boolean) => Promise<NotificationSettings>
  readonly setNotificationSound: (sound: Sound, on: boolean) => Promise<NotificationSettings>
  readonly setSoundStyle: (style: SoundStyle) => Promise<NotificationSettings>
  readonly previewSound: (style: SoundStyle, sound: Sound) => Promise<SoundPreview>
  readonly backups: () => Promise<AutomaticBackups>
  /** Backs the profile up into a folder; answers where. */
  readonly backUp: (folder: string) => Promise<string>
  /** Restores the backup in `folder`: Hemera starts again on it. */
  readonly restoreProfile: (folder: string) => Promise<void>
  readonly retention: () => Promise<DiagnosticsRetention>
  readonly testerFindings: () => Promise<ReadonlyArray<TesterFinding>>
  /** A Project's setup cards, the pending first. */
  readonly setupCards: (projectId: string) => Promise<ReadonlyArray<SetupCard>>
  /** A click the use case refuses answers the card still pending, with the use case's reason. */
  readonly acceptSetupCard: (cardId: string) => Promise<SetupCard>
  readonly declineSetupCard: (cardId: string) => Promise<SetupCard>
  /** Accepts the pending cards in their order, stopping at the first refusal. */
  readonly acceptAllSetupCards: (projectId: string) => Promise<ReadonlyArray<SetupCard>>
  /** Starts a setup proposal; rejects with `SetupRefused` while one is being made. */
  readonly proposeSetup: (projectId: string) => Promise<void>
  /** A Project's sessions, every state, parents before their children. */
  readonly projectSessions: (projectId: string) => Promise<ReadonlyArray<SessionSummary>>
  /** A session's hidden thread, oldest first. */
  readonly sessionThread: (id: string) => Promise<ReadonlyArray<ThreadLine>>
  readonly setupStanding: (projectId: string) => Promise<SetupStanding>
  /**
   * The Projects whose cards or setup session changed, as they change. `onOpen` once the stream is
   * asked of main: a read made then misses no change made before it.
   */
  readonly onSetupChanges: (
    listener: (change: { readonly projectId: string }) => void,
    onEnd: (error: Error) => void,
    onOpen?: () => void,
  ) => () => void
  /** Every decision on a call from now on, as it is recorded. */
  readonly onDecisions: (
    listener: (decision: PermissionDecision) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  readonly close: () => void
}

/** What the preload looks for on a message the page posts to itself. */
export const CONNECT = { hemera: 'connect' } as const

type Client = Effect.Success<ReturnType<typeof clientOver>>

const clientOver = (port: Port) =>
  RpcClient.make(WindowRpcs).pipe(
    Effect.provideServiceEffect(RpcClient.Protocol, makeClientProtocol(port, 'main')),
  )

/** The link over a port, whoever opened it. */
export function linkOver(port: Port): Link {
  const scope = Scope.makeUnsafe()
  const client = Effect.runPromise(Scope.provide(clientOver(port), scope))

  /** Runs a call, settling with its value or with its typed error itself. */
  const call = <A, E>(ask: (client: Client) => Effect.Effect<A, E>): Promise<A> =>
    client
      .then((ready) => Effect.runPromiseExit(ask(ready)))
      .then((exit) => (Exit.isSuccess(exit) ? exit.value : Promise.reject(failureOf(exit.cause))))

  /**
   * Follows a stream until the listener stops: each value to `listener`, and the typed error it
   * failed with, if `ends` recognises it, to `onEnd`. An interruption is not an end anyone hears.
   */
  const follow = <A, E, F extends E>(
    open: (client: Client) => Stream.Stream<A, E>,
    listener: (value: A) => void,
    ends: (error: E) => error is F,
    onEnd: (error: F) => void,
    onOpen?: () => void,
  ): (() => void) => {
    let stopped = false
    let stop = (): void => {
      stopped = true
    }
    void client.then((ready) => {
      if (stopped) return
      const fiber = Effect.runFork(
        Stream.runForEach(open(ready), (value) => Effect.sync(() => listener(value))),
      )
      fiber.addObserver((exit) => {
        if (Exit.isSuccess(exit)) return
        const failure = Cause.findErrorOption(exit.cause)
        if (Option.isSome(failure) && ends(failure.value)) onEnd(failure.value)
      })
      stop = () => fiber.interruptUnsafe()
      onOpen?.()
    })
    return () => stop()
  }

  return {
    engineStatus: () => call((ready) => ready['engine.status']()),
    onEngineStatus: (listener, onEnd) =>
      follow(
        (ready) => ready['engine.statusChanges'](),
        listener,
        (error) => error instanceof EngineGone,
        onEnd,
      ),
    environmentReport: () => call((ready) => ready['environment.report']()),
    relaunch: () => call((ready) => ready['application.relaunch']()),
    showLog: () => call((ready) => ready['application.showLog']()),
    chooseFolder: () => call((ready) => ready['application.chooseFolder']()),
    preferences: () => call((ready) => ready['preferences.read']()),
    writePreferences: (change) => call((ready) => ready['preferences.write'](change)),
    projects: () => call((ready) => ready['projects.list']()),
    project: (id) => call((ready) => ready['projects.get']({ id })),
    onProjectChanges: (listener, onEnd) =>
      follow(
        (ready) => ready['projects.changes'](),
        listener,
        (error) => error instanceof StorageFailed || error instanceof EngineGone,
        onEnd,
      ),
    detectRepositories: (folder) =>
      call((ready) => ready['projects.detectRepositories']({ folder })),
    createProject: (project) => call((ready) => ready['projects.create'](project)),
    setWorkspacesRoot: (edit) => call((ready) => ready['projects.setWorkspacesRoot'](edit)),
    setBranchPrefix: (edit) => call((ready) => ready['projects.setBranchPrefix'](edit)),
    addRepository: (repository) => call((ready) => ready['repositories.add'](repository)),
    removeRepository: (removal) => call((ready) => ready['repositories.remove'](removal)),
    updateRepository: (edit) => call((ready) => ready['repositories.update'](edit)),
    repositoryStatus: (id) => call((ready) => ready['repositories.status']({ id })),
    remotes: (id) => call((ready) => ready['repositories.remotes']({ id })),
    setRemote: (edit) => call((ready) => ready['repositories.setRemote'](edit)),
    setBaseBranch: (edit) => call((ready) => ready['repositories.setBaseBranch'](edit)),
    upToDateBase: (id) => call((ready) => ready['repositories.upToDateBase']({ id })),
    onRepositoryChanges: (listener, onEnd) =>
      follow(
        (ready) => ready['repositories.changes'](),
        listener,
        (error) => error instanceof StorageFailed || error instanceof EngineGone,
        onEnd,
      ),
    recipe: (projectId) => call((ready) => ready['recipe.get']({ projectId })),
    saveRecipe: (edit) => call((ready) => ready['recipe.save'](edit)),
    checkRecipe: (projectId, steps) => call((ready) => ready['recipe.check']({ projectId, steps })),
    variables: (projectId) =>
      call((ready) => ready['variables.list']({ projectId, workspaceId: null })),
    setVariable: (edit) => call((ready) => ready['variables.set'](edit)),
    removeVariable: (key) => call((ready) => ready['variables.remove'](key)),
    revealVariable: (key) => call((ready) => ready['variables.reveal'](key)),
    catalogue: (projectId) => call((ready) => ready['catalogue.list']({ projectId })),
    saveCommand: (save) => call((ready) => ready['catalogue.save'](save)),
    removeCommand: (projectId, id) => call((ready) => ready['catalogue.remove']({ projectId, id })),
    checkLine: (line) => call((ready) => ready['catalogue.checkLine']({ line })),
    runs: (projectId) => call((ready) => ready['runs.list']({ projectId, workspaceId: null })),
    startRun: (start) => call((ready) => ready['runs.start'](start)),
    stopRun: (id) => call((ready) => ready['runs.stop']({ id })),
    restartRun: (id) => call((ready) => ready['runs.restart']({ id })),
    runOutput: (id) => call((ready) => ready['runs.output']({ id })),
    onRunChanges: (listener, onEnd) =>
      follow(
        (ready) => ready['runs.changes'](),
        listener,
        (error) => error instanceof StorageFailed || error instanceof EngineGone,
        onEnd,
      ),
    needs: () => call((ready) => ready['needs.list']()),
    answerNeed: (asked) => call((ready) => ready['needs.answer'](asked)),
    retryNeed: (id) => call((ready) => ready['needs.retry']({ id })),
    mission: (id) => call((ready) => ready['missions.get']({ id })),
    onMissionChanges: (listener, onEnd) =>
      follow(
        (ready) => ready['missions.changes'](),
        listener,
        (error) => error instanceof StorageFailed || error instanceof EngineGone,
        onEnd,
      ),
    chats: (projectId) => call((ready) => ready['chats.list']({ projectId })),
    createChat: (projectId) => call((ready) => ready['chats.create']({ projectId })),
    renameChat: (chatId, title) => call((ready) => ready['chats.rename']({ chatId, title })),
    sendToChat: (chatId, text, mentions) =>
      call((ready) => ready['chats.send']({ chatId, text, mentions })),
    stopChat: (chatId) => call((ready) => ready['chats.stop']({ chatId })),
    setChatModel: (chatId, setting) =>
      call((ready) => ready['chats.setModel']({ chatId, setting })),
    transcript: (chatId, before) => call((ready) => ready['chats.transcript']({ chatId, before })),
    onChatChanges: (listener, onEnd) =>
      follow(
        (ready) => ready['chats.changes'](),
        listener,
        (error) => error instanceof StorageFailed || error instanceof EngineGone,
        onEnd,
      ),
    missions: (projectId) => call((ready) => ready['missions.list']({ projectId })),
    agents: () => call((ready) => ready['agents.list']()),
    modelMarks: () => call((ready) => ready['models.marks']()),
    markModel: (mark) => call((ready) => ready['models.mark'](mark)),
    roleModels: (projectId) =>
      call((ready) => ready['models.roles']({ projectId, missionId: null })),
    setAppRoleModel: (role, setting) =>
      call((ready) => ready['models.setRole']({ level: 'app', scopeId: null, role, setting })),
    setProjectRoleModel: (projectId, role, setting) =>
      call((ready) =>
        ready['models.setRole']({ level: 'project', scopeId: projectId, role, setting }),
      ),
    neverList: (projectId) => call((ready) => ready['permissions.neverList']({ projectId })),
    setNeverList: (projectId, entries) =>
      call((ready) => ready['permissions.setNeverList']({ projectId, entries })),
    projectLimits: (projectId) => call((ready) => ready['limits.project']({ projectId })),
    setProjectLimits: (projectId, limits) =>
      call((ready) => ready['limits.setProject']({ projectId, limits })),
    instructionFiles: (projectId) =>
      call((ready) => ready['sessions.instructionFiles']({ projectId })),
    checkAgentUpdates: () => call((ready) => ready['agents.checkUpdates']()),
    updateAgent: (agent) => call((ready) => ready['agents.update']({ agent })),
    hemeraAuto: () => call((ready) => ready['hemeraAuto.status']()),
    setConsent: (consent) => call((ready) => ready['hemeraAuto.setConsent']({ consent })),
    saveJevKey: (key) => call((ready) => ready['hemeraAuto.saveKey']({ key })),
    removeJevKey: () => call((ready) => ready['hemeraAuto.removeKey']()),
    notificationSettings: () => call((ready) => ready['notifications.settings']()),
    setNotificationKind: (id, on) => call((ready) => ready['notifications.setKind']({ id, on })),
    setNotificationSound: (sound, on) =>
      call((ready) => ready['notifications.setSound']({ sound, on })),
    setSoundStyle: (style) => call((ready) => ready['notifications.setStyle']({ style })),
    previewSound: (style, sound) =>
      call((ready) => ready['notifications.preview']({ style, sound })),
    backups: () => call((ready) => ready['profile.backups']()),
    backUp: (folder) => call((ready) => ready['profile.backup']({ folder })),
    restoreProfile: (folder) => call((ready) => ready['profile.restore']({ folder })),
    retention: () => call((ready) => ready['diagnostics.retention']()),
    testerFindings: () => call((ready) => ready['tester.findings']()),
    setupCards: (projectId) => call((ready) => ready['setup.cards']({ projectId })),
    acceptSetupCard: (cardId) => call((ready) => ready['setup.accept']({ cardId })),
    declineSetupCard: (cardId) => call((ready) => ready['setup.decline']({ cardId })),
    acceptAllSetupCards: (projectId) => call((ready) => ready['setup.acceptAll']({ projectId })),
    proposeSetup: (projectId) => call((ready) => ready['setup.propose']({ projectId })),
    projectSessions: (projectId) =>
      call((ready) => ready['sessions.list']({ ownerKind: 'project', ownerId: projectId })),
    sessionThread: (id) => call((ready) => ready['sessions.thread']({ id })),
    setupStanding: (projectId) => call((ready) => ready['setup.standing']({ projectId })),
    onSetupChanges: (listener, onEnd, onOpen) =>
      follow(
        (ready) => ready['setup.changes'](),
        listener,
        (error) => error instanceof StorageFailed || error instanceof EngineGone,
        onEnd,
        onOpen,
      ),
    onDecisions: (listener, onEnd) =>
      follow(
        (ready) => ready['permissions.decisions'](),
        listener,
        (error) => error instanceof StorageFailed || error instanceof EngineGone,
        onEnd,
      ),
    onNotices: (listener) =>
      follow(
        (ready) => ready['notifications.window'](),
        listener,
        // A stream main serves itself: it does not fail.
        Predicate.isNever,
        () => undefined,
      ),
    close: () => {
      Effect.runFork(Scope.close(scope, Exit.void))
    },
  }
}

const failureOf = <E>(cause: Cause.Cause<E>) => {
  const failure = Cause.findErrorOption(cause)
  return Option.isSome(failure) ? failure.value : Cause.squash(cause)
}

/** Opens the page's link to main. */
export function connect(): Link {
  const { port1, port2 } = new MessageChannel()
  window.postMessage(CONNECT, '*', [port2])
  return linkOver(fromMessagePort(port1))
}
