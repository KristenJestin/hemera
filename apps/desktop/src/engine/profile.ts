/**
 * The Profile at the engine's start, and the calls on it the engine serves.
 *
 * The start runs in this order: a staged restore is applied, the database is opened, the
 * migrations are applied, the opening is written down (`profile.opened`), a pending
 * reconciliation runs with the automation gate closed until it ends, and only then are the calls
 * served. A database that cannot be opened is not a crash: the engine still serves, its status
 * says why in a sentence the window shows, and every call on the Profile is refused with it.
 */

import { realpathSync } from 'node:fs'
import { homedir, release, tmpdir, type } from 'node:os'
import { join } from 'node:path'

import { ROOT_REPOSITORY } from '@hemera/core/domain'
import {
  type AutomaticBackups,
  DatabaseOpen,
  DatabaseRefused,
  type DatabaseStatus,
  type Preferences,
  type PreferencesChange,
  type Reconciliation,
  RestoreRefused,
  StorageFailed,
} from '@hemera/ipc'
import {
  Cause,
  Context,
  Effect,
  Layer,
  Predicate,
  Result,
  Schedule,
  Stream,
  SubscriptionRef,
} from 'effect'
import type { Duration, Scope } from 'effect'

import type { Log } from '../main/diagnostic.ts'
import { automaticBackups, backupFoldersLayer, writeBackup } from './backup.ts'
import { type BuildingStart, buildingLaunchesLayer, BUILDING_NEEDS } from './building/launch.ts'
import {
  BUILDER_NEEDS,
  type BuilderHold,
  type BuildingEnd,
  type TaskVerdict,
  builderLayer,
  cancelBuildingIn,
} from './building/builder.ts'
import { type TaskChecks, checksVerdict } from './building/checks.ts'
import { proofRunnerLayer } from './building/proof-runner.ts'
import { projectTaskChecks } from './building/run-checks.ts'
import { type BuildDesk, buildDeskLayer, buildingGuards, deskAttribution } from './building/desk.ts'
import { helperDeskLayer } from './building/helper-desk.ts'
import { docsDeskLayer } from './building/docs-desk.ts'
import { reviewDeskLayer } from './building/review-desk.ts'
import { roundDeskLayer } from './review/round-desk.ts'
import { type Rounds, roundsLayer } from './review/rounds.ts'
import { REVIEW_NEEDS } from './building/review-store.ts'
import { HELPER_MAPPERS } from './building/helper-store.ts'
import { type HelpersSettings, cancelHelpersIn, helpersLayer } from './building/helpers.ts'
import { type Documenter, documenterLayer } from './building/documenter.ts'
import { END_NEEDS, type EndHold, buildingEndLayer } from './building/end.ts'
import { autoReviewLayer, cancelReviewIn } from './building/review.ts'
import { BUILDING_MAPPERS } from './building/journal.ts'
import { checkRunsLayer } from './building/runs.ts'
import { DomainEvents, domainEventsLayer } from './domain-events.ts'
import { AutomationGate, automationGateLayer } from './gate.ts'
import { DATABASE_FILE, openProfile } from './migrate.ts'
import { readPreferences, writePreferences } from './preferences.ts'
import { ProfileHome } from './profile-home.ts'
import {
  type LiveMissions,
  type RestoreJournal,
  noLiveMissions,
  pendingRestore,
  reconcile,
  reconciliationStepsLayer,
  recordProfileEvent,
  type ReconciliationStep,
} from './reconciliation.ts'
import { applyStagedRestore, clearStagedRestore, stageRestore } from './restore.ts'
import type { AskBeforeRunning } from './ask-before-running.ts'
import { RUN_CONSENT, hemeraRunConsent, withdrawLeftConsents } from './permissions/consent.ts'
import { Approvals, PERMISSION_REQUESTS, requestsHandler } from './permissions/requests.ts'
import type { Delivery } from './permissions/delivery.ts'
import type { HemeraAuto } from './permissions/hemera-auto.ts'
import { type SessionTurns, sessionTurnsLayer } from './permissions/ports.ts'
import { runAtOpen } from './at-open.ts'
import { GIT_GUARD, engineGitGuard } from './git-guard.ts'
import { type GitBytesSpawn, SYSTEM_GIT, gitLayer, spawnGit, spawnGitBytes } from './git.ts'
import { SWEEP_EVERY, sweepDiagnostics } from './retention.ts'
import { Secrets, type SecretsRegistry, secretsRegistry, registerAllVariables } from './secrets.ts'
import { resumeInterrupted } from './preparation.ts'
import { repositoryStatusesLayer } from './repositories.ts'
import {
  type RunServices,
  type RunsSettings,
  recoverRuns,
  runsEndWithEngine,
  runsLayer,
  runsRecipeRunnerLayer,
} from './runs.ts'
import {
  Database,
  DatabaseError,
  type EngineDatabase,
  databaseLayer,
  refusedWhile,
} from './storage/database.ts'
import { type HostProcesses, supervisorLayer } from './supervisor.ts'
import { type WorkspaceServices, listWorkspaces, preparationsLayer } from './workspaces.ts'
import {
  type MissionParts,
  type MissionServices,
  StopFailed,
  missionsLayer,
  runStops,
} from './missions.ts'
import { deliverAnswers, recheckNeeds } from './needs.ts'
import {
  type ActionRules,
  type EffectfulActions,
  handleIndeterminate,
  settleLeftActions,
} from './tools/actions.ts'
import { type ToolsParts, type ToolAccess, type ToolGate, toolsLayer } from './tools/index.ts'
import { agentJudgesLayer, noAgentJudges } from './permissions/agent-judge.ts'
import {
  type Evidence,
  Memory,
  type MemoryParts,
  type MissionDependencies,
  SlotWaits,
  memoryLayer,
} from './memory/index.ts'
import type { HemeraEndpoint } from './agents/endpoint.ts'
import { assignKeyPrefixes, listProjects } from './projects.ts'
import { LaunchFailed } from '@hemera/ipc'
import { defaultPermissionAnswerLayer } from './agents/client.ts'
import { type Discovery, discoveryLayer, machineLayer } from './agents/discovery.ts'
import { idleAgentsLayer } from './agents/idle.ts'
import { AgentStarter, agentRuntimeLayer } from './agents/runtime.ts'
import { type AcpTraces, acpTracesLayer } from './agents/trace.ts'
import { memoryBriefSources } from './sessions/brief.ts'
import {
  drainQueuedResults,
  runningSessionsLayer,
  sessionEpochsLayer,
  sessionNotesLayer,
  sessionsDelivery,
} from './sessions/bridges.ts'
import { type Chats, chatsLayer, markInterruptedChats } from './chat/service.ts'
import { modelChoiceLayer, seedAppSettings } from './sessions/cascade.ts'
import { type Cap, capLayer } from './sessions/cap.ts'
import { setupDeskLayer } from './setup/desk.ts'
import { Setup, setupLayer } from './setup/service.ts'
import type { TicketSearch } from './start/tickets.ts'
import { type GhCli, type GhSettings, ghCliLayer } from './tickets/gh.ts'
import { FORGE_NEEDS, type ForgePort, forgePort } from './forges/port.ts'
import { screenshotIn, screenshotsFolder } from './screenshots.ts'
import { type ForgeRunner, type ForgeSettings, forgeRunnerLayer } from './forges/runner.ts'
import { deliverReadTickets } from './tickets/deliver.ts'
import { type JiraLink, type JiraSettings, jiraLinkLayer } from './tickets/jira-link.ts'
import { type TicketProviders, ticketProvidersLayer, ticketSearchLayer } from './tickets/search.ts'
import { TICKET_MAPPERS } from './tickets/journal.ts'
import { ticketEventRunsLayer } from './tickets/event-runs.ts'
import {
  TICKET_WRITES,
  type TicketWrites,
  ticketWritesLayer,
  ticketWritesNeeds,
} from './tickets/writes.ts'
import { type TicketSync, ticketSyncLayer } from './tickets/sync.ts'
import { type SpecBoard, specBoardLayer } from './planning/board.ts'
import { PLANNING_MAPPERS } from './planning/journal.ts'
import { projectSpecLanguages } from './planning/store.ts'
import { type PlannerWake, plannerLayer } from './planning/wake.ts'
import { type LivingSpec, livingSpecLayer } from './living-spec/service.ts'
import {
  ProbeDesk,
  type ProbeCleanup,
  noProbeCleanup,
  probeDeskLayer,
} from './planning/probe-desk.ts'
import { type ProbeSteps, probeStepsLayer } from './planning/probe-steps.ts'
import { PROBES_FOLDER, PROBE_MAPPERS } from './planning/probe-store.ts'
import { type ProbesSettings, interruptLeftProbes, probesLayer } from './planning/probes.ts'
import { COLD_READ_MAPPERS } from './planning/cold-read-store.ts'
import { coldReadsLayer } from './planning/cold-reads.ts'
import { agentOffersLayer, agentOffersServed } from './planning/offers.ts'
import { FREEZE_MAPPERS } from './planning/freeze-store.ts'
import { type FreezeLog, freezeLayer } from './planning/freeze.ts'
import { type Checkpoints, checkpointsLayer } from './building/checkpoints.ts'
import { Snapshots, type SnapshotsService, snapshotsLayer } from './building/snapshots.ts'
import { type Diffs, diffsLayer } from './review/diffs.ts'
import { Review, type ReviewHold, reviewLayer } from './review/feedback.ts'
import { DELIVERY_NEEDS, Pushes, type PushesHold, pushesLayer } from './delivery/pushes.ts'
import { DELIVERY_MAPPERS } from './delivery/journal.ts'
import { REVIEW_MAPPERS } from './review/journal.ts'
import {
  type OutsideChanges,
  type OutsideSettings,
  outsideChangesLayer,
} from './building/outside.ts'
import { type SetupValues, setupValuesLayer } from './setup/values.ts'
import { type TesterFindings, testerFindingsLayer } from './tester/findings.ts'
import { testerModeLayer } from './tester/mode.ts'
import { replacementGuardLayer } from './sessions/guard.ts'
import { SESSION_NEEDS } from './sessions/needs.ts'
import { BUDGET_NEEDS, budgetHandler } from './budget.ts'
import type { SpecLanguage, TesterMode } from './sessions/ports.ts'
import { SessionPost, sessionPostLayer } from './sessions/post.ts'
import { refusedLine, replacedLine, sessionInstructionsLayer } from './sessions/provider.ts'
import {
  ROLES_REGISTERED,
  type RoleEntry,
  type RoleRegistry,
  roleRegistryLayer,
} from './sessions/roles.ts'
import {
  type SessionHold,
  type SessionsSettings,
  type SessionTimings,
  Sessions,
  sessionsLayer,
} from './sessions/service.ts'
import {
  ExclusiveResources,
  RESOURCE_EVENTS,
  RESOURCE_NEEDS,
  exclusiveReservations,
  resourceActionRules,
  resourceLine,
} from './resources/reservations.ts'
import { ProcessSupervisor } from './supervisor.ts'

/** The calls on the Profile, with the errors a screen is shown. */
export interface ProfileCalls {
  readonly readPreferences: Effect.Effect<Preferences, StorageFailed>
  readonly writePreferences: (change: PreferencesChange) => Effect.Effect<void, StorageFailed>
  readonly backups: Effect.Effect<AutomaticBackups, StorageFailed>
  /** Writes a backup into `folder`; answers the backup folder written. */
  readonly backup: (folder: string) => Effect.Effect<string, StorageFailed>
  /** Stages the restore of the backup folder `folder` for the next start. */
  readonly restore: (folder: string) => Effect.Effect<void, StorageFailed | RestoreRefused>
}

/** What the later tickets plug into the Profile: the folders backed up, the steps, the ports. */
export interface ProfileParts {
  readonly backupFolders: ReadonlyArray<string>
  readonly reconciliationSteps: ReadonlyArray<ReconciliationStep>
  readonly liveMissions?: Layer.Layer<LiveMissions>
  readonly restoreJournal?: Layer.Layer<RestoreJournal>
  /** Who is asked before a command marked so runs; a permission need otherwise. */
  readonly askBeforeRunning?: Layer.Layer<AskBeforeRunning>
  /** How runs wait for an address and give a process its grace; the defaults otherwise. */
  readonly runs?: Partial<RunsSettings>
  /** The guards, stoppers and need owners later tickets register; none otherwise. */
  readonly missions?: Partial<MissionParts>
  /**
   * The registry of known secret values: the engine's own, which its diagnostic log masks with
   * too; a registry of its own otherwise.
   */
  readonly secrets?: SecretsRegistry
  /** The ports of the tools' gate later tickets fill; the defaults otherwise. */
  readonly tools?: ToolsParts
  /** The rules of the actions with an effect outside the database; this version's otherwise. */
  readonly actionRules?: Layer.Layer<ActionRules>
  /** The ports of the Memory later tickets fill, and its mappers; the defaults otherwise. */
  readonly memory?: Omit<MemoryParts, 'restoreJournal'>
  /** The role sessions: the roles later tickets register, and how agents are started. */
  readonly sessions?: SessionsParts
  /** The field's ticket search, for the suites; the Project's own providers otherwise (#95). */
  readonly tickets?: Layer.Layer<TicketSearch>
  /**
   * The trackers a provider's configuration reads, for the suites; `gh` and the Jira sites
   * otherwise (#95, #96).
   */
  readonly ticketProviders?: Layer.Layer<TicketProviders> | undefined
  /** Whether the ticket sync's schedule runs (#97): on unless a suite says. */
  readonly ticketSync?: { readonly schedules?: boolean | undefined } | undefined
  /** The Probes' Cleanup hook (S6 fills it); one that does nothing otherwise. */
  readonly probes?: {
    readonly cleanup?: Layer.Layer<ProbeCleanup>
    /** Where a suite holds a launch (see `ProbesSettings`); never held otherwise. */
    readonly hold?: ProbesSettings['hold']
  }
  /** Where a suite holds a helper's launch (see `HelpersSettings`); never held otherwise. */
  readonly helpers?: { readonly hold?: HelpersSettings['hold'] }
  /** Where a suite holds Review's feedback (#341, see `ReviewHold`); never held otherwise. */
  readonly review?:
    | {
        readonly hold?: ReviewHold | undefined
        /** Where a suite holds a round's Fix once committed, before its Planner opens (#468). */
        readonly fixed?: Effect.Effect<void> | undefined
      }
    | undefined
  /**
   * The pushes' Git as a suite sees it, wrapped around the machine's, and where a suite holds a
   * repository's sequence (R6): the machine's and never held otherwise.
   */
  readonly delivery?:
    | {
        readonly git?: ((real: GitBytesSpawn) => GitBytesSpawn) | undefined
        readonly hold?: PushesHold | undefined
      }
    | undefined
  /** The database as a suite sees it, wrapped around the real one (#341): itself otherwise. */
  readonly database?: (real: EngineDatabase) => EngineDatabase
  /** The snapshot service as a suite sees it, wrapped around the real one (#208): itself otherwise. */
  readonly snapshots?: (real: SnapshotsService) => SnapshotsService
  /** The snapshots' Git as a suite sees it, wrapped around the machine's (#369): itself otherwise. */
  readonly snapshotsGit?: (real: GitBytesSpawn) => GitBytesSpawn
  /** Where `gh` is found and how long a call may run (#95); this machine's otherwise. */
  readonly gh?: GhSettings | undefined
  /** Where the forge CLIs are found, in which environment, and their limits (#253); this machine's otherwise. */
  readonly forge?: ForgeSettings | undefined
  /** How the supervisor asks about and ends the machine's processes; this machine's otherwise. */
  readonly hostProcesses?: Layer.Layer<HostProcesses> | undefined
  /**
   * Where a launched mission's Building starts (#139), how a finished task is judged and where the
   * end of the tasks goes (#141): the Builder, no check and `building.tasks_done` otherwise.
   */
  readonly building?:
    | {
        readonly start?: Layer.Layer<BuildingStart>
        readonly verdict?: Layer.Layer<TaskVerdict>
        /** The checks a finished attempt is judged on (#142's port): the Project's (#143). */
        readonly checks?: Layer.Layer<TaskChecks>
        /** The end of the tasks (#147's sequence otherwise), on the profile's own services. */
        readonly end?: Layer.Layer<BuildingEnd, never, Database | DomainEvents | Secrets>
        /** Where a suite holds the Builder between a check and its transaction. */
        readonly hold?: BuilderHold | undefined
        /** Where a suite holds the end of a Building as it takes in a Builder's turn end. */
        readonly endHold?: EndHold | undefined
        /** The detector of changes outside Hemera's timers, and where a suite holds it (#148). */
        readonly outside?: Partial<OutsideSettings>
        /** How long a proof may run before Hemera ends it (#290): `PROOF_LIMIT` otherwise. */
        readonly proofLimit?: Duration.Duration | undefined
        /** How long a minute of the Project's proof limit lasts (#321): a minute otherwise. */
        readonly proofMinute?: Duration.Duration | undefined
      }
    | undefined
  /**
   * The network a Jira call goes through, its limit, and how a sealed token is opened (#96):
   * Node's `fetch`, 30 seconds and no opener otherwise.
   */
  readonly jira?: JiraSettings | undefined
}

/** What the role sessions are built with; this version's defaults otherwise. */
export interface SessionsParts {
  /** The roles later tickets register, beside this version's `test` role. */
  readonly roles?: ReadonlyArray<RoleEntry>
  /** How an agent's process starts; none here, so no agent is started outside the engine. */
  readonly starter?: Layer.Layer<AgentStarter, never, ProcessSupervisor>
  /** Where the agents are found; this machine's otherwise. */
  readonly discovery?: Layer.Layer<Discovery>
  readonly specLanguage?: Layer.Layer<SpecLanguage>
  readonly testerMode?: Layer.Layer<TesterMode>
  /** Shorter bounds for the suites; the ticket's otherwise. */
  readonly timings?: Partial<SessionTimings>
  /** Where a suite holds the start's rebuild of the sessions a stopped engine left. */
  readonly rebuildHold?: Effect.Effect<void>
  /** Where a suite holds a session as it starts or fails, or fails its start. */
  readonly sessionHold?: SessionHold
  /** Where a suite holds a session's opening, before it is written. */
  readonly openHold?: SessionsSettings['openHold']
  /** Where a suite holds the health sweep, as each look begins (CT-12). */
  readonly sweepHold?: Effect.Effect<void>
  /** Whether a new mission starts its Planner on its own (#85); off unless said. */
  readonly plannerStarts?: boolean
  /** Whether adding a Project starts the bootstrap of its living spec (#93); off unless said. */
  readonly livingSpecStarts?: boolean
}

/** No way to start an agent: a Profile started without the engine's link to main. */
const noStarter = Layer.succeed(AgentStarter, {
  start: () => Effect.fail(new LaunchFailed({ reason: 'agents cannot be started here' })),
})

/**
 * The empty folder, in the data folder, the forge CLIs of agents' commands read their
 * configuration from: none of them is signed in there.
 */
const AGENT_CONFIG_FOLDER = join('permissions', 'no-forge-login')

/** How often the pending environment needs are checked again while they wait. */
const RECHECK_EVERY = '5 minutes'

/**
 * What the calls on the Profile stand on: the Projects, their Workspaces, their runs and their
 * missions.
 */
export type EngineServices =
  | Documenter
  | WorkspaceServices
  | RunServices
  | MissionServices
  | Secrets
  | ActionRules
  | EffectfulActions
  | ToolGate
  | ToolAccess
  | HemeraEndpoint
  | HemeraAuto
  | SessionTurns
  | Memory
  | Evidence
  | MissionDependencies
  | Sessions
  | Delivery
  | RoleRegistry
  | Cap
  | Chats
  | Setup
  | SetupValues
  | AcpTraces
  | TesterFindings
  | TicketSearch
  | GhCli
  | ForgeRunner
  | ForgePort
  | JiraLink
  | PlannerWake
  | SpecBoard
  | ExclusiveResources
  | LivingSpec
  | BuildDesk
  | ProbeDesk
  | ProbeSteps
  | Snapshots
  | BuildingStart
  | OutsideChanges
  | Checkpoints
  | Diffs
  | Review
  | Pushes
  | Rounds
  | FreezeLog
  | TicketProviders
  | TicketSync
  | TicketWrites
  | SessionPost

export interface ProfileStart {
  readonly dataFolder: string
  readonly version: string
  readonly migrations: string
  /** The channel this build is on, as a finding of the tester mode records it; `dev` otherwise. */
  readonly channel?: string | undefined
}

export interface StartedProfile {
  readonly calls: ProfileCalls
  readonly database: SubscriptionRef.SubscriptionRef<DatabaseStatus>
  /** The gate every automation passes; closed for good when the database was refused. */
  readonly gate: Effect.Effect<void>
  /**
   * Runs a call on the Projects, their repositories and their Workspaces, the data folder's
   * refusal said as a sentence; refused at once when the database was.
   */
  readonly use: <A, E>(
    effect: Effect.Effect<A, E, EngineServices>,
  ) => Effect.Effect<A, Exclude<E, DatabaseError> | StorageFailed>
  /** The same, for what is followed for as long as the caller listens. */
  readonly follow: <A, E>(
    stream: Stream.Stream<A, E, EngineServices>,
  ) => Stream.Stream<A, Exclude<E, DatabaseError> | StorageFailed>
  /**
   * The window is shown: the commands marked "at open" run, once per engine, in the background,
   * once automations may run. Answers at once.
   */
  readonly windowShown: Effect.Effect<void>
}

const said = <E>(failure: E): string =>
  failure instanceof Error && failure.message !== '' ? failure.message : String(failure)

const refusedProfile = (sentence: string): Effect.Effect<StartedProfile, never, Scope.Scope> =>
  Effect.gen(function* () {
    const failed = Effect.fail(new StorageFailed({ sentence }))
    return {
      calls: {
        readPreferences: failed,
        writePreferences: () => failed,
        backups: failed,
        backup: () => failed,
        restore: () => failed,
      },
      database: yield* SubscriptionRef.make<DatabaseStatus>(DatabaseRefused.make({ sentence })),
      gate: Effect.never,
      use: () => failed,
      follow: () => Stream.fail(new StorageFailed({ sentence })),
      windowShown: Effect.void,
    }
  })

/** The events after which the Git guard sees the places Hemera knows again (#457). */
const SIGHTED_ON: ReadonlySet<string> = new Set([
  'project.created',
  'project.updated',
  'repository.added',
  'repository.updated',
  'workspace.created',
])

export const startProfile = (
  start: ProfileStart,
  parts: ProfileParts,
  log: Log,
): Effect.Effect<StartedProfile, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { dataFolder, version } = start
    const file = join(dataFolder, DATABASE_FILE)

    let restored
    try {
      restored = applyStagedRestore(dataFolder)
    } catch (cause) {
      log(`the staged restore could not be applied: ${said(cause)}`)
      return yield* refusedProfile(
        `The backup could not be restored into the data folder: ${said(cause)}`,
      )
    }
    if (restored !== null) log(`restored the backup taken at ${restored.takenAt}`)

    const secrets = parts.secrets ?? secretsRegistry()
    // The guard on the engine's own Git (#457), which every Git spawn below asks first; the home
    // it reads is the gate's, a suite's own folder when it hands one.
    const guardHome = parts.tools?.home
    const guard = yield* engineGitGuard(
      guardHome === undefined
        ? {
            home: homedir(),
            configHome: process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'),
          }
        : { home: guardHome, configHome: join(guardHome, '.config') },
      log,
      secrets.mask,
      // The engine's scratch repositories, never a scope of the guard. Its snapshot stores are
      // watched as any repository; of its data, only the Probes' worktrees' bookkeeping is its own.
      [
        join(realpathSync.native(tmpdir()), 'hemera-scratch-'),
        join(realpathSync.native(tmpdir()), 'hemera-patch-'),
      ],
      join(realpathSync.native(dataFolder), PROBES_FOLDER),
    )
    // Where the gate and a cancel reach the Probes, which stand on the sessions above them (#89).
    const deskContext = yield* Layer.build(probeDeskLayer)
    const desk = Context.get(deskContext, ProbeDesk)
    // What each running Probe is doing (#206), written by the Probes and read by their chips.
    const stepsContext = yield* Layer.build(probeStepsLayer)
    // Where the gate reads what an agent offers, served by the agents' runtime above it (#90).
    const offersContext = yield* Layer.build(agentOffersLayer)
    // Where the gate reaches the Builder's tools and the claims, served by the Builder (#141).
    const buildContext = yield* Layer.build(buildDeskLayer)
    // Where the gate reaches the helpers' tools, served by the helpers' service (#145).
    const helperContext = yield* Layer.build(helperDeskLayer)
    // Where the gate reaches the documenter's report and its write guard (#146).
    const docsContext = yield* Layer.build(docsDeskLayer)
    // Where the gate reaches the reviewers' tools, served by the automatic review (#147).
    const reviewContext = yield* Layer.build(reviewDeskLayer)
    // Where the gate reaches a Review round's tools, served by the rounds (#468).
    const roundContext = yield* Layer.build(roundDeskLayer)
    // The database as a suite sees it, wrapped around the real one (#341): one connection either way.
    const realDatabase = databaseLayer(file)
    const wrapDatabase = parts.database
    const databases =
      wrapDatabase === undefined
        ? realDatabase
        : Layer.merge(
            realDatabase,
            Layer.effect(
              Database,
              Database.use((real) => Effect.succeed(wrapDatabase(real))),
            ).pipe(Layer.provide(realDatabase)),
          )
    const profileLayers = Layer.mergeAll(
      Layer.succeed(Secrets, secrets),
      databases,
      domainEventsLayer,
      automationGateLayer,
      backupFoldersLayer(parts.backupFolders),
      reconciliationStepsLayer(parts.reconciliationSteps),
      parts.liveMissions ?? noLiveMissions,
      parts.probes?.cleanup ?? noProbeCleanup,
      Layer.succeedContext(deskContext),
      Layer.succeedContext(stepsContext),
      Layer.succeedContext(offersContext),
      Layer.succeedContext(buildContext),
      Layer.succeedContext(helperContext),
      Layer.succeedContext(docsContext),
      Layer.succeedContext(reviewContext),
      Layer.succeedContext(roundContext),
      specBoardLayer(log),
      Layer.succeed(ProfileHome, start),
      gitLayer(spawnGit(SYSTEM_GIT, secrets.mask, guard.spawn)),
      guard.layer,
      sessionTurnsLayer,
      repositoryStatusesLayer,
      preparationsLayer(log),
      setupValuesLayer.pipe(Layer.provide(Layer.succeed(Secrets, secrets))),
      testerFindingsLayer({
        dataFolder,
        version: start.version,
        channel: start.channel ?? 'dev',
        os: `${type()} ${release()} (${process.platform}-${process.arch})`,
      }).pipe(Layer.provide(Layer.succeed(Secrets, secrets))),
    )
    // The commands: the supervisor (its registry in the database, its children's standard error
    // in the diagnostic), the runs, the "ask before running" port, and the recipe's runner on them.
    // Hemera's own runs of a command marked "ask before running" ask through a permission need.
    const consent = hemeraRunConsent(log)
    // The post the role sessions share with the parts below them: a mission's cancel stops its
    // tree through it, its activity reads it, the gate takes the urgent notes from it.
    const postContext = yield* Layer.build(sessionPostLayer)
    const post = Context.get(postContext, SessionPost)
    const postLayer = Layer.succeedContext(postContext)
    // The reservations of the exclusive resources, and where their needs' answers go (#88).
    const resources = exclusiveReservations(log)
    // The forge port, and where its needs' Retry goes (#253).
    const forge = forgePort(parts.forge)
    // The launches, and where their failed preparations' Retry goes (#139).
    const launches = buildingLaunchesLayer(log)
    // The Builder, and where its needs' answers go (#141).
    const builder = builderLayer(log, parts.building?.hold)
    // The end of a Building, and where the answers to the review's findings go (#147).
    const ending = buildingEndLayer(log, parts.building?.endHold)
    // One store of the snapshots, for the checkpoints, the Builder and the Freeze alike (#140).
    const snapshotsGit = spawnGitBytes(SYSTEM_GIT, secrets.mask, guard.spawn)
    const machineSnapshots = snapshotsLayer(parts.snapshotsGit?.(snapshotsGit) ?? snapshotsGit)
    const wrapped = parts.snapshots
    const snapshots =
      wrapped === undefined
        ? machineSnapshots
        : Layer.effect(
            Snapshots,
            Snapshots.use((real) => Effect.succeed(wrapped(real))),
          ).pipe(Layer.provide(machineSnapshots))
    // One documenter, for its desk and the end of a Building alike (#146, #147).
    const documenter = documenterLayer({ log }).pipe(Layer.provide(snapshots))
    // One detector of the changes outside Hemera, for the Builder and the calls alike (#148).
    const outside = outsideChangesLayer(log, parts.building?.outside).pipe(Layer.provide(snapshots))
    // One store of the checkpoints: the review at the end of a Building, the live diff, the calls.
    const checkpoints = checkpointsLayer(spawnGitBytes(SYSTEM_GIT, secrets.mask, guard.spawn)).pipe(
      Layer.provideMerge(snapshots),
    )
    // One live diff: the calls and Review's anchors (#341) read the same repositories' turns.
    const diffs = diffsLayer(spawnGitBytes(SYSTEM_GIT, secrets.mask, guard.spawn), log).pipe(
      Layer.provide(Layer.mergeAll(checkpoints, outside)),
    )
    // The pushes and pull requests, and where their needs' answers go (R6).
    const deliveryGit = spawnGitBytes(SYSTEM_GIT, secrets.mask, guard.spawn)
    const pushes = pushesLayer({
      log,
      git: parts.delivery?.git?.(deliveryGit) ?? deliveryGit,
      hold: parts.delivery?.hold,
    })
    const missionParts: Partial<MissionParts> = {
      ...parts.missions,
      owners: new Map([
        [RUN_CONSENT, consent.handler],
        [GIT_GUARD, guard.handler],
        [SESSION_NEEDS, post.needs],
        [BUDGET_NEEDS, budgetHandler],
        [PERMISSION_REQUESTS, requestsHandler],
        [RESOURCE_NEEDS, resources.handler],
        [TICKET_WRITES, ticketWritesNeeds],
        [FORGE_NEEDS, forge.handler],
        [BUILDING_NEEDS, launches.handler],
        [BUILDER_NEEDS, builder.handler],
        [REVIEW_NEEDS, ending.handler],
        [END_NEEDS, ending.retry],
        [DELIVERY_NEEDS, pushes.handler],
        ...(parts.missions?.owners ?? []),
      ]),
      // The session tree's stopper, unless a part brings its own under that name.
      stoppers: [
        ...(parts.missions?.stoppers?.some((one) => one.name === 'sessions')
          ? []
          : [
              {
                name: 'sessions',
                stop: (missionId: string) => post.stopTree({ kind: 'mission', missionId }),
              },
            ]),
        // The Probes' wipe (#89), unless a part brings its own under that name.
        ...(parts.missions?.stoppers?.some((one) => one.name === 'probes')
          ? []
          : [
              {
                name: 'probes',
                stop: (missionId: string) =>
                  desk
                    .wipeAll(missionId)
                    .pipe(
                      Effect.mapError((failure) => new StopFailed({ reason: failure.message })),
                    ),
              },
            ]),
        ...(parts.missions?.stoppers ?? []),
      ],
      // Ended with the stage, in the cancel's transaction: nothing of the Building starts again.
      cancels: [cancelBuildingIn, cancelHelpersIn, cancelReviewIn],
      activity:
        parts.missions?.activity ??
        ((missionId) =>
          Effect.map(post.working(missionId), (sessionWorking) => ({
            sessionWorking,
            questionWaiting: false,
          }))),
    }
    const memoryParts: MemoryParts = {
      ...parts.memory,
      restoreJournal: parts.restoreJournal,
      epochs: parts.memory?.epochs ?? sessionEpochsLayer,
      running: parts.memory?.running ?? runningSessionsLayer,
      slotWaits: Layer.succeed(SlotWaits, post.slotWaitOf),
      mappers: new Map([
        ['session.replaced', replacedLine],
        ['session.refused', refusedLine],
        ['budget.refused', refusedLine],
        ...PLANNING_MAPPERS,
        ...RESOURCE_EVENTS.map((event) => [event, resourceLine] as const),
        ...PROBE_MAPPERS,
        ...COLD_READ_MAPPERS,
        ...FREEZE_MAPPERS,
        ...TICKET_MAPPERS,
        ...BUILDING_MAPPERS,
        ...HELPER_MAPPERS,
        ...REVIEW_MAPPERS,
        ...DELIVERY_MAPPERS,
        ...(parts.memory?.mappers ?? []),
      ]),
    }
    const toolsParts: ToolsParts = {
      // An engine that can start agents has their own judges (#197); one that cannot asks.
      agentJudges:
        parts.sessions?.starter === undefined
          ? noAgentJudges
          : agentJudgesLayer({ dataFolder, log }),
      ...parts.tools,
      notes: sessionNotesLayer.pipe(Layer.provide(postLayer)),
      delivery: parts.tools?.delivery ?? sessionsDelivery.pipe(Layer.provide(postLayer)),
      setup: setupDeskLayer,
      guards:
        parts.tools?.guards ??
        buildingGuards.pipe(
          Layer.provide(Layer.succeedContext(Context.merge(buildContext, docsContext))),
        ),
      attribution:
        parts.tools?.attribution ??
        deskAttribution.pipe(Layer.provide(Layer.succeedContext(buildContext))),
    }
    // A suite's role stands in for a registered role of the same id, in its place.
    const suiteRoles = parts.sessions?.roles ?? []
    const roles = roleRegistryLayer([
      ...ROLES_REGISTERED.map((role) => suiteRoles.find((one) => one.id === role.id) ?? role),
      ...suiteRoles.filter((one) => !ROLES_REGISTERED.some((role) => role.id === one.id)),
    ])
    // The Chats and the setup's runs over the role sessions, over the agents' runtime, over the tools.
    const sessionsLayers = Layer.mergeAll(
      chatsLayer,
      setupLayer,
      Layer.mergeAll(
        probesLayer({ log, hold: parts.probes?.hold }),
        coldReadsLayer({ log }),
        freezeLayer({ log }),
        ticketSyncLayer({ log, schedules: parts.ticketSync?.schedules }),
        ticketEventRunsLayer({ log }),
        ticketWritesLayer({ log }),
        checkRunsLayer({ log }),
        helpersLayer({ log, hold: parts.helpers?.hold }),
        documenter,
        launches.layer.pipe(
          Layer.provideMerge(
            parts.building?.start ??
              builder.layer.pipe(
                Layer.provide(
                  Layer.mergeAll(
                    parts.building?.verdict ?? checksVerdict,
                    parts.building?.end ??
                      ending.layer.pipe(
                        Layer.provide(
                          Layer.mergeAll(
                            documenter,
                            autoReviewLayer({ log }).pipe(Layer.provide(checkpoints)),
                            checkpoints,
                          ),
                        ),
                      ),
                    snapshots,
                    outside,
                  ).pipe(
                    Layer.provideMerge(
                      Layer.mergeAll(
                        parts.building?.checks ?? projectTaskChecks.pipe(Layer.provide(snapshots)),
                        proofRunnerLayer(parts.building?.proofLimit, parts.building?.proofMinute),
                      ),
                    ),
                  ),
                ),
              ),
          ),
        ),
      ).pipe(
        Layer.provideMerge(plannerLayer({ log, starts: parts.sessions?.plannerStarts ?? false })),
      ),
      livingSpecLayer({ log, starts: parts.sessions?.livingSpecStarts ?? false }),
      agentOffersServed,
      outside,
      checkpoints,
      diffs,
      // The rounds over Review's feedback (#468), which the window reaches too.
      roundsLayer({ log, fixed: parts.review?.fixed }).pipe(
        Layer.provideMerge(
          reviewLayer({ log, hold: parts.review?.hold }).pipe(
            Layer.provide(Layer.mergeAll(diffs, checkpoints, outside)),
          ),
        ),
      ),
      pushes.layer.pipe(Layer.provide(Layer.mergeAll(diffs, checkpoints))),
    ).pipe(
      Layer.provideMerge(
        sessionsLayer({
          log,
          timings: parts.sessions?.timings,
          rebuildHold: parts.sessions?.rebuildHold,
          sessionHold: parts.sessions?.sessionHold,
          openHold: parts.sessions?.openHold,
          sweepHold: parts.sessions?.sweepHold,
        }),
      ),
      Layer.provideMerge(agentRuntimeLayer({ dataFolder, log })),
      Layer.provideMerge(
        Layer.mergeAll(
          sessionInstructionsLayer(process.platform),
          memoryBriefSources,
          idleAgentsLayer,
          acpTracesLayer(dataFolder),
          defaultPermissionAnswerLayer,
        ),
      ),
      Layer.provideMerge(
        Layer.mergeAll(
          roles,
          replacementGuardLayer.pipe(Layer.provide(roles)),
          capLayer.pipe(Layer.provide(postLayer)),
          modelChoiceLayer.pipe(Layer.provide(roles)),
          parts.sessions?.specLanguage ?? projectSpecLanguages,
          parts.sessions?.testerMode ?? testerModeLayer,
          postLayer,
        ),
      ),
    )
    // The Memory stands on the missions, and the tools on the Memory.
    const layers = sessionsLayers.pipe(
      Layer.provideMerge(toolsLayer(log, version, toolsParts)),
      // How agents are found and started: for the role sessions, and for the agents' own judges.
      Layer.provideMerge(
        Layer.mergeAll(
          parts.sessions?.starter ?? noStarter,
          parts.sessions?.discovery ?? discoveryLayer.pipe(Layer.provide(machineLayer())),
        ),
      ),
      Layer.provideMerge(memoryLayer(memoryParts, log)),
      Layer.provideMerge(resources.layer),
      Layer.provideMerge(forge.layer),
      Layer.provideMerge(missionsLayer(missionParts)),
      Layer.provideMerge(parts.tickets ?? ticketSearchLayer),
      Layer.provideMerge(parts.ticketProviders ?? ticketProvidersLayer),
      // Images are attached from Hemera's own screenshot folder only (#253).
      Layer.provideMerge(
        forgeRunnerLayer({
          attachable: screenshotIn(screenshotsFolder(dataFolder)),
          ...parts.forge,
        }),
      ),
      Layer.provideMerge(ghCliLayer(parts.gh)),
      Layer.provideMerge(jiraLinkLayer(parts.jira)),
      Layer.provideMerge(runsRecipeRunnerLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          supervisorLayer(log, parts.hostProcesses),
          runsLayer(log, {
            agentConfigFolder: join(dataFolder, AGENT_CONFIG_FOLDER),
            ...parts.runs,
          }),
          parts.askBeforeRunning ?? consent.layer,
        ),
      ),
      Layer.provideMerge(
        (parts.actionRules ?? resourceActionRules(log, builder.cut)).pipe(
          Layer.provideMerge(profileLayers),
        ),
      ),
    )
    const opened = yield* Layer.build(layers).pipe(
      Effect.flatMap((context) =>
        openProfile(dataFolder, start.migrations, version).pipe(
          Effect.provide(context),
          Effect.map((standing) => ({ context, standing })),
        ),
      ),
      // Whatever the database or the driver throws is a data folder that was not opened, said as
      // such, rather than an engine that dies before it serves anything.
      Effect.catchDefect((defect) => Effect.fail(refusedWhile('opening it')(defect))),
      Effect.result,
    )
    if (Result.isFailure(opened)) {
      log(`the database ${file} was not opened: ${said(opened.failure)}`)
      return yield* refusedProfile(opened.failure.message)
    }
    const { context, standing } = opened.success
    log(`opened the database ${file} at ${standing.lastMigration ?? 'no migration'}`)
    if (standing.backedUp !== null) log(`backed the database up into ${standing.backedUp}`)
    if (standing.behind.length > 0) log(`migrated it with ${standing.behind.join(', ')}`)

    const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layers>>) =>
      Effect.provide(effect, context)
    const gate = Context.get(context, AutomationGate)

    // The known secrets the variables hold are registered before anything else runs: the restore,
    // the reconciliation, Git, the runs a stopped engine left.
    yield* run(registerAllVariables).pipe(
      Effect.catch((refusal) =>
        Effect.sync(() => log(`the variables were not registered as secrets: ${said(refusal)}`)),
      ),
    )

    // The Journal catches up with the event log before anything reads the Memory, then follows it.
    yield* Context.get(context, Memory).start.pipe(Effect.forkScoped)
    // The Git guard's holds a stopped engine left are read back, before any Git of the engine
    // runs; its questions are written as its holds need them (#457).
    yield* run(guard.restore)
    // Added before the writer is forked, so it runs once the writer is stopped: what is left is
    // written before the database closes.
    yield* Effect.addFinalizer(() => run(guard.flush))
    yield* run(guard.questions).pipe(Effect.forkScoped)
    // Every place Hemera knows is seen by the guard, at the start and as one is added (#457): no
    // repository waits for an agent's action to be given its baseline.
    const placesKnown = Effect.gen(function* () {
      const places: Array<{ readonly projectId: string; readonly checkouts: string[] }> = []
      for (const project of yield* listProjects) {
        const of = (root: string) => [
          root,
          ...project.repositories
            .filter((one) => one.path !== ROOT_REPOSITORY)
            .map((one) => join(root, one.path)),
        ]
        places.push({ projectId: project.id, checkouts: of(project.mainCheckout) })
        for (const workspace of yield* listWorkspaces(project.id)) {
          places.push({ projectId: project.id, checkouts: of(workspace.folder) })
        }
      }
      return places
    })
    const sightKnown = run(Effect.flatMap(placesKnown, guard.sight)).pipe(
      Effect.catch((refusal) =>
        Effect.sync(() => log(`the Git guard did not see the places: ${said(refusal)}`)),
      ),
    )
    // Off the start: a scope an action or an engine call reaches first is sighted there.
    const placesAdded = yield* Context.get(context, DomainEvents).subscribe
    yield* sightKnown.pipe(
      Effect.andThen(
        placesAdded.pipe(
          Stream.filter((event) => SIGHTED_ON.has(event.type)),
          Stream.runForEach(() => sightKnown),
        ),
      ),
      Effect.forkScoped,
    )

    let reconciliation: Reconciliation = 'none'
    const databaseNow = (): DatabaseStatus =>
      DatabaseOpen.make({
        lastMigration: standing.lastMigration,
        writtenByVersion: version,
        backups: automaticBackups(dataFolder),
        reconciliation,
      })
    const database = yield* SubscriptionRef.make(databaseNow())
    /** Says where the Profile stands now, the backups counted again. */
    const publish = (now: Reconciliation = reconciliation) =>
      Effect.suspend(() => {
        reconciliation = now
        return SubscriptionRef.set(database, databaseNow())
      })

    if (restored !== null) {
      yield* run(
        recordProfileEvent('profile.restored', {
          takenAt: restored.takenAt,
          version: restored.hemeraVersion,
        }),
      ).pipe(Effect.orDie)
      clearStagedRestore(dataFolder)
    }

    // An action a stopped engine left without an outcome is perhaps done: it becomes indeterminate,
    // and what its post-condition finds is written, before anything acts:
    // before the automation gate opens, so a Building's resume finds it settled (#142).
    yield* run(settleLeftActions).pipe(
      Effect.tap((left) =>
        left.length === 0
          ? Effect.void
          : Effect.sync(() =>
              log(
                `left ${String(left.length)} action(s) indeterminate: ${left.map((one) => one.kind).join(', ')}`,
              ),
            ),
      ),
      Effect.catch((refusal) =>
        Effect.sync(() =>
          log(`the actions a stopped engine left were not settled: ${said(refusal)}`),
        ),
      ),
    )

    const pending = yield* run(pendingRestore).pipe(Effect.orDie)
    if (pending === null) {
      yield* gate.open
    } else {
      yield* publish('running')
      log('reconciling the restored Profile; automations wait until it ends')
      yield* run(reconcile(pending, log)).pipe(
        Effect.matchEffect({
          onFailure: () => publish('failed'),
          onSuccess: () => Effect.andThen(gate.open, publish('none')),
        }),
        Effect.forkScoped,
      )
    }

    // What a stopped engine left running is ended and marked interrupted before anything starts;
    // what is still going when this engine ends is written stopped.
    yield* run(recoverRuns).pipe(
      Effect.tap((interrupted) =>
        interrupted.length === 0
          ? Effect.void
          : Effect.sync(() => log(`interrupted the runs ${interrupted.join(', ')}`)),
      ),
      Effect.catch((refusal) =>
        Effect.sync(() => log(`the runs a stopped engine left were not ended: ${said(refusal)}`)),
      ),
    )
    yield* Effect.addFinalizer(() => run(runsEndWithEngine))
    // A `gh` call a stopped engine left (#95) is ended: none outlives the call that started it.
    yield* run(ProcessSupervisor.use((supervisor) => supervisor.endOrphans('tickets')))
    // So is a forge CLI's call (#253).
    yield* run(ProcessSupervisor.use((supervisor) => supervisor.endOrphans('forge')))
    // The reservations a stop left: those whose mission is no longer in Building are released.
    yield* run(ExclusiveResources.use((reservations) => reservations.atStart)).pipe(
      Effect.tap((released) =>
        released === 0
          ? Effect.void
          : Effect.sync(() => log(`released ${String(released)} reservation(s) at start`)),
      ),
      Effect.catch((refusal) =>
        Effect.sync(() => log(`the reservations a stop left were not released: ${said(refusal)}`)),
      ),
    )
    // The Probes a stop left preparing or running are interrupted, their sessions ended, before
    // the sessions are rebuilt: their relaunch is theirs, once automations may run (#89).
    yield* run(interruptLeftProbes).pipe(
      Effect.tap((interrupted) =>
        interrupted === 0
          ? Effect.void
          : Effect.sync(() => log(`interrupted ${String(interrupted)} Probe(s) a stop left`)),
      ),
      Effect.catch((refusal) =>
        Effect.sync(() => log(`the Probes a stop left were not interrupted: ${said(refusal)}`)),
      ),
    )
    // No run waits across a restart: the questions of "ask before running" it left are withdrawn.
    yield* run(withdrawLeftConsents).pipe(
      Effect.catch((refusal) =>
        Effect.sync(() => log(`the consent needs left were not withdrawn: ${said(refusal)}`)),
      ),
    )

    // A Project made before missions existed is given its key prefix before anything reads it.
    yield* run(assignKeyPrefixes).pipe(
      Effect.tap((given) =>
        given === 0
          ? Effect.void
          : Effect.sync(() => log(`gave ${String(given)} Project(s) a key prefix`)),
      ),
      Effect.catch((refusal) =>
        Effect.sync(() => log(`the Projects were not given their key prefix: ${said(refusal)}`)),
      ),
    )

    // Every registered role has an app setting before any session opens (#41, open point 62).
    yield* run(seedAppSettings).pipe(
      Effect.tap((given) =>
        given === 0
          ? Effect.void
          : Effect.sync(() => log(`gave ${String(given)} role(s) an agent at the app level`)),
      ),
      Effect.catch((refusal) =>
        Effect.sync(() => log(`the roles were not given an agent: ${said(refusal)}`)),
      ),
    )

    // Once automations may run: what a cancel could not stop yet is tried again, the answers an
    // engine that stopped did not hand over are handed over, and the pending environment needs are
    // checked again, then every few minutes. No pending need is ever answered here.
    /** One step of the start: its failure or its defect is written down and the rest goes on. */
    const step = <A, E>(doing: string, effect: Effect.Effect<A, E, Layer.Success<typeof layers>>) =>
      run(effect).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => log(`${doing} failed: ${Cause.pretty(cause).split('\n')[0] ?? ''}`)),
        ),
      )
    yield* gate.pass.pipe(
      Effect.andThen(step('stopping what cancelled missions left', runStops(null))),
      Effect.andThen(step('handing over the answers left', deliverAnswers)),
      // What a stop cut: its writes attributed, then its actions handed over, and only then do
      // the Buildings resume (#142).
      Effect.andThen(step('attributing the writes a stop left', builder.restarted)),
      Effect.andThen(step('handing the indeterminate actions over', handleIndeterminate)),
      Effect.andThen(builder.handed),
      // What #71 queued before the sessions existed becomes their deliveries; then the sessions a
      // stopped engine left are rebuilt, by this supervisor alone (CT-11).
      Effect.andThen(step('handing the queued results to the sessions', drainQueuedResults)),
      // A Chat whose turn a stop interrupted says so before its session is ended (#43).
      Effect.andThen(step('marking the Chats a stop interrupted', markInterruptedChats)),
      Effect.andThen(
        step(
          'ending the setup proposals a restart interrupted',
          Setup.use((setup) => setup.endInterrupted),
        ),
      ),
      Effect.andThen(
        step(
          'rebuilding the sessions',
          Sessions.use((sessions) => sessions.rebuild),
        ),
      ),
      Effect.andThen(
        step('checking the environment needs again', recheckNeeds).pipe(
          Effect.repeat(Schedule.spaced(RECHECK_EVERY)),
        ),
      ),
      Effect.forkScoped,
    )
    // Once automations may run: the requests the user answered are acted on, now and after each
    // answer, and their results handed over; what a stopped engine left is finished first.
    yield* gate.pass.pipe(
      Effect.andThen(run(Effect.scoped(Approvals.use((approvals) => approvals.watch)))),
      Effect.forkScoped,
    )
    // A ticket read after its mission was created goes to the mission's Planner (#95): followed
    // from now, delivered once automations may run.
    const ticketsRead = yield* Context.get(context, DomainEvents).subscribe
    yield* gate.pass.pipe(
      Effect.andThen(run(deliverReadTickets(ticketsRead, log))),
      Effect.forkScoped,
    )
    // Review's checkpoints and refused proofs (#341): followed from now, what a stop left caught up
    // once automations may run.
    const reviewEvents = yield* Context.get(context, DomainEvents).subscribe
    yield* gate.pass.pipe(
      Effect.andThen(run(Review.use((review) => review.follow(reviewEvents)))),
      Effect.forkScoped,
    )
    // The pushes and pull requests (R6): followed from now, what a stop cut resumed once
    // automations may run.
    const pushEvents = yield* Context.get(context, DomainEvents).subscribe
    yield* gate.pass.pipe(
      Effect.andThen(run(Pushes.use((one) => one.follow(pushEvents)))),
      Effect.forkScoped,
    )
    // Once automations may run: the reservations are settled, then again at each change (#88).
    yield* gate.pass.pipe(
      Effect.andThen(
        run(Effect.scoped(ExclusiveResources.use((reservations) => reservations.watch))),
      ),
      Effect.forkScoped,
    )
    // The diagnostic class rotates at the start, then every hour.
    yield* step('rotating the diagnostics', sweepDiagnostics(dataFolder)).pipe(
      Effect.repeat(Schedule.spaced(SWEEP_EVERY)),
      Effect.forkScoped,
    )

    // A preparation a stopped engine interrupted carries on once automations may run.
    yield* gate.pass.pipe(
      Effect.andThen(run(resumeInterrupted)),
      Effect.tap((resumed) =>
        resumed.length === 0
          ? Effect.void
          : Effect.sync(() => log(`resumed the preparation of ${resumed.join(', ')}`)),
      ),
      Effect.catch((refusal) =>
        Effect.sync(() => log(`interrupted preparations were not resumed: ${said(refusal)}`)),
      ),
      Effect.forkScoped,
    )

    const storageFailed = <E>(failure: E) => new StorageFailed({ sentence: said(failure) })

    const calls: ProfileCalls = {
      readPreferences: run(readPreferences).pipe(Effect.mapError(storageFailed)),
      writePreferences: (change) =>
        run(writePreferences(change)).pipe(Effect.mapError(storageFailed)),
      backups: Effect.sync(() => automaticBackups(dataFolder)),
      backup: (folder) =>
        run(writeBackup(folder, 'hemera-backup')).pipe(Effect.mapError(storageFailed)),
      restore: (folder) =>
        run(stageRestore(folder)).pipe(
          Effect.mapError((failure) =>
            Predicate.isTagged(failure, 'RestoreRefusal')
              ? new RestoreRefused({ sentence: failure.message })
              : storageFailed(failure),
          ),
          Effect.ensuring(publish()),
        ),
    }

    /** The data folder's refusal as a sentence; any other refusal as itself. */
    const sentenced = <E>(failure: E): Exclude<E, DatabaseError> | StorageFailed => {
      if (failure instanceof DatabaseError) return storageFailed(failure)
      // SAFETY: the line above took every DatabaseError; what is left is the rest of E.
      return failure as Exclude<E, DatabaseError>
    }
    const scope = yield* Effect.scope
    let shown = false
    const windowShown = Effect.suspend(() => {
      if (shown) return Effect.void
      shown = true
      return gate.pass.pipe(
        Effect.andThen(run(runAtOpen)),
        Effect.tap((started) =>
          Effect.sync(() => log(`ran ${String(started.length)} command(s) at open`)),
        ),
        Effect.catch((refusal) =>
          Effect.sync(() => log(`the commands at open were not run: ${said(refusal)}`)),
        ),
        Effect.forkIn(scope),
        Effect.asVoid,
      )
    })
    return {
      calls,
      database,
      gate: gate.pass,
      use: (effect) => Effect.mapError(run(effect), sentenced),
      follow: (stream) => Stream.mapError(Stream.provideContext(stream, context), sentenced),
      windowShown,
    }
  })
