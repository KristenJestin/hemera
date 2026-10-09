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
  type BootstrapRun,
  type BaseBranchEdit,
  type ChatChanged,
  type ChatLine,
  type ChatPage,
  type ChatSummary,
  type ExclusiveResource,
  type FreezeReadiness,
  type GithubProviderConfig,
  type JiraDeployment,
  type JiraProviderConfig,
  type JiraTokenStatus,
  type JournalTail,
  type KeyPrefixEdit,
  type LivingDomain,
  type LivingRequirement,
  type LivingRequirementDetail,
  type LivingSeen,
  type LivingSpecState,
  type OpenQuestion,
  type ResourceDraft,
  type ResourceHolding,
  type SincePage,
  type Spec,
  type StartCreate,
  type StartResult,
  type TicketProviderInfo,
  type TicketsSettings,
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
import type {
  AgentProvider,
  ChatMention,
  ModelSettingValue,
  NeverEntry,
  ProviderStatus,
  SpecMode,
} from '@hemera/core/domain'
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
  /** The Project's missions that match the text and the remote tickets, as they answer; the stream ends with the user typing again. */
  readonly searchStart: (
    projectId: string,
    text: string,
    listener: (result: StartResult) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  /** Creates the mission of the user's explicit choice; the same key twice creates one. */
  readonly createStart: (create: StartCreate) => Promise<Mission>
  /** The user keeps the mission the Planner triaged as not new work: it goes on planning. */
  readonly keepAfterTriage: (missionId: string) => Promise<void>
  /** Stops everything the mission runs; rejects with `MoveRefused` when its stage does not allow it. */
  readonly cancelMission: (id: string) => Promise<Mission>
  /** What stands between a mission in Planning and its Freeze. */
  readonly freezeReadiness: (id: string) => Promise<FreezeReadiness>
  /** The readiness, then each change of it. */
  readonly onFreezeReadiness: (
    id: string,
    listener: (readiness: FreezeReadiness) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  /** Freezes the Spec at the version the user saw. */
  readonly freeze: (id: string, specVersion: number) => Promise<Mission>
  /** A mission's Spec as it stands. */
  readonly spec: (missionId: string) => Promise<Spec>
  /** The questions waiting on the user across the Profile. */
  readonly openQuestions: () => Promise<ReadonlyArray<OpenQuestion>>
  /** The open questions, then each change of them. */
  readonly onOpenQuestions: (
    listener: (questions: ReadonlyArray<OpenQuestion>) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  /** A page of what happened since the user last looked at Home; `before` is the cursor of an older one. */
  readonly sinceYouLeft: (before: number | null) => Promise<SincePage>
  /** The first page, then again after each event worth telling. */
  readonly onSinceYouLeft: (
    listener: (page: SincePage) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  /** The user looked at Home: the events up to the sequence `upTo`, the last drawn, are not new any more. */
  readonly lookedAtHome: (upTo: number) => Promise<void>
  /** At most eight missions, the last opened first. */
  readonly recentMissions: () => Promise<ReadonlyArray<Mission>>
  /** The user opened a mission: it leads Recent. */
  readonly missionOpened: (missionId: string) => Promise<void>
  /** The last Journal line of each mission named. */
  readonly journalTail: (missionIds: ReadonlyArray<string>) => Promise<ReadonlyArray<JournalTail>>
  /** The domains of a Project's living spec. */
  readonly livingSpecDomains: (projectId: string) => Promise<ReadonlyArray<LivingDomain>>
  /** A Project's living spec as its page follows it, now and at each change. */
  readonly onLivingSpec: (
    projectId: string,
    listener: (state: LivingSpecState) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  readonly livingSpecRequirements: (
    projectId: string,
    domainId: string,
  ) => Promise<ReadonlyArray<LivingRequirement>>
  /** One requirement with the history of its changes. */
  readonly livingSpecRequirement: (id: string) => Promise<LivingRequirementDetail>
  /** The runs that wrote the living spec, the newest first. */
  readonly livingSpecRuns: (projectId: string) => Promise<ReadonlyArray<BootstrapRun>>
  /** Validates a domain as the user saw it. */
  readonly validateDomain: (domainId: string, seen: ReadonlyArray<LivingSeen>) => Promise<void>
  /** Rejects a domain as the user saw it. */
  readonly rejectDomain: (domainId: string, seen: ReadonlyArray<LivingSeen>) => Promise<void>
  readonly dropRequirement: (requirementId: string) => Promise<void>
  /** Starts writing the living spec, of one domain or of every one. */
  readonly bootstrapLivingSpec: (projectId: string, domainId?: string) => Promise<BootstrapRun>
  /** A Project's ticket providers. */
  readonly ticketProviders: (projectId: string) => Promise<ReadonlyArray<TicketProviderInfo>>
  /** The repositories `gh` can read on a host, to propose when adding GitHub. */
  readonly proposeGithub: (projectId: string, host: string) => Promise<ReadonlyArray<string>>
  readonly addGithub: (
    projectId: string,
    config: GithubProviderConfig,
  ) => Promise<TicketProviderInfo>
  readonly addJira: (projectId: string, config: JiraProviderConfig) => Promise<TicketProviderInfo>
  /** Which Jira deployment a site is, or null when it cannot be told. */
  readonly jiraDeployment: (site: string) => Promise<JiraDeployment | null>
  readonly updateProvider: (
    providerId: string,
    config: GithubProviderConfig,
  ) => Promise<TicketProviderInfo>
  readonly removeProvider: (providerId: string) => Promise<void>
  readonly providerStatus: (providerId: string) => Promise<ProviderStatus>
  /** Reads the provider again now. */
  readonly checkProviderAgain: (providerId: string) => Promise<ProviderStatus>
  readonly specMode: (projectId: string) => Promise<SpecMode>
  readonly setSpecMode: (projectId: string, mode: SpecMode) => Promise<SpecMode>
  /** A Project's providers and Spec mode, now and at each change. */
  readonly onTicketSettings: (
    projectId: string,
    listener: (settings: TicketsSettings) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  /** The token goes to main to be protected by the system; nothing echoes it back. */
  readonly saveJiraToken: (providerId: string, token: string) => Promise<JiraTokenStatus>
  readonly removeJiraToken: (providerId: string) => Promise<JiraTokenStatus>
  readonly jiraTokenStatus: (providerId: string) => Promise<JiraTokenStatus>
  /** How often the Project's linked tickets are checked, in minutes. */
  readonly syncInterval: (projectId: string) => Promise<number>
  /** Rejects with `InvalidSyncInterval` under the engine's minimum; answers the interval kept. */
  readonly setSyncInterval: (projectId: string, minutes: number) => Promise<number>
  /** When the linked tickets were last checked with every provider; null before the first. */
  readonly lastCheck: (projectId: string) => Promise<string | null>
  /** The language the Spec is written in. */
  readonly specLanguage: (projectId: string) => Promise<string>
  readonly setSpecLanguage: (projectId: string, language: string) => Promise<string>
  /** Rejects with `InvalidKeyPrefix`, or `KeyPrefixTaken` when other missions' keys carry it. */
  readonly setKeyPrefix: (edit: KeyPrefixEdit) => Promise<Project>
  /** The exclusive resources of a Project. */
  readonly resources: (projectId: string) => Promise<ReadonlyArray<ExclusiveResource>>
  /** Replaces the Project's resources whole; answers them as saved. */
  readonly saveResources: (
    projectId: string,
    drafts: ReadonlyArray<ResourceDraft>,
  ) => Promise<ReadonlyArray<ExclusiveResource>>
  /** Which mission holds which resource now. */
  readonly resourceHolders: () => Promise<ReadonlyArray<ResourceHolding>>
  readonly onResourceHolders: (
    listener: (holdings: ReadonlyArray<ResourceHolding>) => void,
    onEnd: (error: Error) => void,
  ) => () => void
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
    searchStart: (projectId, text, listener, onEnd) =>
      follow((ready) => ready['start.search']({ projectId, text }), listener, anError, onEnd),
    createStart: (create) => call((ready) => ready['start.create'](create)),
    keepAfterTriage: (missionId) =>
      call((ready) => ready['planning.keepAfterTriage']({ missionId })),
    cancelMission: (id) => call((ready) => ready['missions.cancel']({ id })),
    freezeReadiness: (id) => call((ready) => ready['missions.freezeReadiness']({ id })),
    onFreezeReadiness: (id, listener, onEnd) =>
      follow((ready) => ready['missions.freezeReadinessChanged']({ id }), listener, anError, onEnd),
    freeze: (id, specVersion) => call((ready) => ready['missions.freeze']({ id, specVersion })),
    spec: (missionId) => call((ready) => ready['planning.spec']({ missionId })),
    openQuestions: () => call((ready) => ready['planning.openQuestions']({})),
    onOpenQuestions: (listener, onEnd) =>
      follow((ready) => ready['planning.questionsChanged']({}), listener, anError, onEnd),
    sinceYouLeft: (before) => call((ready) => ready['home.sinceYouLeft']({ before })),
    onSinceYouLeft: (listener, onEnd) =>
      follow((ready) => ready['home.sinceYouLeftChanged'](), listener, anError, onEnd),
    lookedAtHome: (upTo) => call((ready) => ready['home.looked']({ upTo })),
    recentMissions: () => call((ready) => ready['home.recent']()),
    missionOpened: (missionId) => call((ready) => ready['home.opened']({ missionId })),
    journalTail: (missionIds) => call((ready) => ready['memory.journalTail']({ missionIds })),
    livingSpecDomains: (projectId) => call((ready) => ready['livingSpec.domains']({ projectId })),
    onLivingSpec: (projectId, listener, onEnd) =>
      follow((ready) => ready['livingSpec.changed']({ projectId }), listener, anError, onEnd),
    livingSpecRequirements: (projectId, domainId) =>
      call((ready) => ready['livingSpec.requirements']({ projectId, domainId })),
    livingSpecRequirement: (id) => call((ready) => ready['livingSpec.requirement']({ id })),
    livingSpecRuns: (projectId) => call((ready) => ready['livingSpec.runs']({ projectId })),
    validateDomain: (domainId, seen) =>
      call((ready) => ready['livingSpec.validateDomain']({ domainId, seen })),
    rejectDomain: (domainId, seen) =>
      call((ready) => ready['livingSpec.rejectDomain']({ domainId, seen })),
    dropRequirement: (requirementId) =>
      call((ready) => ready['livingSpec.dropRequirement']({ requirementId })),
    bootstrapLivingSpec: (projectId, domainId) =>
      call((ready) =>
        ready['livingSpec.bootstrap'](
          domainId === undefined ? { projectId } : { projectId, domainId },
        ),
      ),
    ticketProviders: (projectId) => call((ready) => ready['tickets.providers']({ projectId })),
    proposeGithub: (projectId, host) =>
      call((ready) => ready['tickets.proposeGithub']({ projectId, host })),
    addGithub: (projectId, config) =>
      call((ready) => ready['tickets.addGithub']({ projectId, config })),
    addJira: (projectId, config) =>
      call((ready) => ready['tickets.addJira']({ projectId, config })),
    jiraDeployment: (site) => call((ready) => ready['tickets.jiraDeployment']({ site })),
    updateProvider: (providerId, config) =>
      call((ready) => ready['tickets.updateProvider']({ providerId, config })),
    removeProvider: (providerId) =>
      call((ready) => ready['tickets.removeProvider']({ providerId })),
    providerStatus: (providerId) => call((ready) => ready['tickets.status']({ providerId })),
    checkProviderAgain: (providerId) =>
      call((ready) => ready['tickets.checkAgain']({ providerId })),
    specMode: (projectId) => call((ready) => ready['tickets.specMode']({ projectId })),
    setSpecMode: (projectId, mode) =>
      call((ready) => ready['tickets.setSpecMode']({ projectId, mode })),
    onTicketSettings: (projectId, listener, onEnd) =>
      follow((ready) => ready['tickets.changed']({ projectId }), listener, anError, onEnd),
    saveJiraToken: (providerId, token) =>
      call((ready) => ready['tickets.saveJiraToken']({ providerId, token })),
    removeJiraToken: (providerId) =>
      call((ready) => ready['tickets.removeJiraToken']({ providerId })),
    jiraTokenStatus: (providerId) =>
      call((ready) => ready['tickets.jiraTokenStatus']({ providerId })),
    syncInterval: (projectId) => call((ready) => ready['tickets.syncInterval']({ projectId })),
    setSyncInterval: (projectId, minutes) =>
      call((ready) => ready['tickets.setSyncInterval']({ projectId, minutes })),
    lastCheck: (projectId) => call((ready) => ready['tickets.lastCheck']({ projectId })),
    specLanguage: (projectId) => call((ready) => ready['planning.specLanguage']({ projectId })),
    setSpecLanguage: (projectId, language) =>
      call((ready) => ready['planning.setSpecLanguage']({ projectId, language })),
    setKeyPrefix: (edit) => call((ready) => ready['projects.setKeyPrefix'](edit)),
    resources: (projectId) => call((ready) => ready['resources.list']({ projectId })),
    saveResources: (projectId, resources) =>
      call((ready) => ready['resources.save']({ projectId, resources })),
    resourceHolders: () => call((ready) => ready['resources.holders']()),
    onResourceHolders: (listener, onEnd) =>
      follow((ready) => ready['resources.changed'](), listener, anError, onEnd),
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

/** A stream ends on any error it fails with: all of them are typed errors. */
const anError = <E extends Error>(error: E): error is E => error instanceof Error

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
