/**
 * The Profile at the engine's start, and the calls on it the engine serves.
 *
 * The start runs in this order: a staged restore is applied, the database is opened, the
 * migrations are applied, the opening is written down (`profile.opened`), a pending
 * reconciliation runs with the automation gate closed until it ends, and only then are the calls
 * served. A database that cannot be opened is not a crash: the engine still serves, its status
 * says why in a sentence the window shows, and every call on the Profile is refused with it.
 */

import { release, type } from 'node:os'
import { join } from 'node:path'

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
import type { Scope } from 'effect'

import type { Log } from '../main/diagnostic.ts'
import { automaticBackups, backupFoldersLayer, writeBackup } from './backup.ts'
import {
  type BuildingStart,
  buildingLaunchesLayer,
  buildingStartUnfilled,
  BUILDING_NEEDS,
} from './building/launch.ts'
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
import { SYSTEM_GIT, gitLayer, spawnGit, spawnGitBytes } from './git.ts'
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
import { DatabaseError, databaseLayer, refusedWhile } from './storage/database.ts'
import { supervisorLayer } from './supervisor.ts'
import { type WorkspaceServices, preparationsLayer } from './workspaces.ts'
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
import {
  type Evidence,
  Memory,
  type MemoryParts,
  type MissionDependencies,
  SlotWaits,
  memoryLayer,
} from './memory/index.ts'
import type { HemeraEndpoint } from './agents/endpoint.ts'
import { assignKeyPrefixes } from './projects.ts'
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
import { PROBE_MAPPERS } from './planning/probe-store.ts'
import { type ProbesSettings, interruptLeftProbes, probesLayer } from './planning/probes.ts'
import { COLD_READ_MAPPERS } from './planning/cold-read-store.ts'
import { coldReadsLayer } from './planning/cold-reads.ts'
import { agentOffersLayer, agentOffersServed } from './planning/offers.ts'
import { FREEZE_MAPPERS } from './planning/freeze-store.ts'
import { type FreezeLog, freezeLayer } from './planning/freeze.ts'
import { type FileSnapshots, databaseSnapshots } from './planning/snapshots.ts'
import { type Checkpoints, checkpointsLayer } from './building/checkpoints.ts'
import { type Snapshots, snapshotsLayer } from './building/snapshots.ts'
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
import { type SessionTimings, Sessions, sessionsLayer } from './sessions/service.ts'
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
  /** What the Freeze keeps of the dirty files (#92); the database's stand-in otherwise. */
  readonly snapshots?: Layer.Layer<FileSnapshots, never, Secrets>
  /** Where `gh` is found and how long a call may run (#95); this machine's otherwise. */
  readonly gh?: GhSettings | undefined
  /** Where a launched mission's Building starts (#139): #141's port, one doing nothing otherwise. */
  readonly building?: { readonly start?: Layer.Layer<BuildingStart> } | undefined
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
  | JiraLink
  | PlannerWake
  | SpecBoard
  | ExclusiveResources
  | LivingSpec
  | ProbeDesk
  | FileSnapshots
  | Snapshots
  | Checkpoints
  | FreezeLog
  | TicketProviders
  | TicketSync
  | TicketWrites

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
    // Where the gate and a cancel reach the Probes, which stand on the sessions above them (#89).
    const deskContext = yield* Layer.build(probeDeskLayer)
    const desk = Context.get(deskContext, ProbeDesk)
    // Where the gate reads what an agent offers, served by the agents' runtime above it (#90).
    const offersContext = yield* Layer.build(agentOffersLayer)
    const profileLayers = Layer.mergeAll(
      Layer.succeed(Secrets, secrets),
      databaseLayer(file),
      domainEventsLayer,
      automationGateLayer,
      backupFoldersLayer(parts.backupFolders),
      reconciliationStepsLayer(parts.reconciliationSteps),
      parts.liveMissions ?? noLiveMissions,
      parts.probes?.cleanup ?? noProbeCleanup,
      Layer.succeedContext(deskContext),
      Layer.succeedContext(offersContext),
      specBoardLayer(log),
      Layer.succeed(ProfileHome, start),
      gitLayer(spawnGit(SYSTEM_GIT, secrets.mask)),
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
    // The launches, and where their failed preparations' Retry goes (#139).
    const launches = buildingLaunchesLayer(log)
    const missionParts: Partial<MissionParts> = {
      ...parts.missions,
      owners: new Map([
        [RUN_CONSENT, consent.handler],
        [SESSION_NEEDS, post.needs],
        [BUDGET_NEEDS, budgetHandler],
        [PERMISSION_REQUESTS, requestsHandler],
        [RESOURCE_NEEDS, resources.handler],
        [TICKET_WRITES, ticketWritesNeeds],
        [BUILDING_NEEDS, launches.handler],
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
        ...(parts.memory?.mappers ?? []),
      ]),
    }
    const toolsParts: ToolsParts = {
      ...parts.tools,
      notes: sessionNotesLayer.pipe(Layer.provide(postLayer)),
      delivery: parts.tools?.delivery ?? sessionsDelivery.pipe(Layer.provide(postLayer)),
      setup: setupDeskLayer,
    }
    const roles = roleRegistryLayer([...ROLES_REGISTERED, ...(parts.sessions?.roles ?? [])])
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
        launches.layer.pipe(Layer.provide(parts.building?.start ?? buildingStartUnfilled)),
      ).pipe(
        Layer.provideMerge(plannerLayer({ log, starts: parts.sessions?.plannerStarts ?? false })),
      ),
      livingSpecLayer({ log, starts: parts.sessions?.livingSpecStarts ?? false }),
      agentOffersServed,
      parts.snapshots ?? databaseSnapshots,
      checkpointsLayer(spawnGitBytes(SYSTEM_GIT, secrets.mask)).pipe(
        Layer.provideMerge(snapshotsLayer(spawnGitBytes(SYSTEM_GIT, secrets.mask))),
      ),
    ).pipe(
      Layer.provideMerge(sessionsLayer({ log, timings: parts.sessions?.timings })),
      Layer.provideMerge(agentRuntimeLayer({ dataFolder, log })),
      Layer.provideMerge(
        Layer.mergeAll(
          sessionInstructionsLayer(process.platform),
          memoryBriefSources,
          parts.sessions?.starter ?? noStarter,
          parts.sessions?.discovery ?? discoveryLayer.pipe(Layer.provide(machineLayer())),
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
          modelChoiceLayer,
          parts.sessions?.specLanguage ?? projectSpecLanguages,
          parts.sessions?.testerMode ?? testerModeLayer,
          postLayer,
        ),
      ),
    )
    // The Memory stands on the missions, and the tools on the Memory.
    const layers = sessionsLayers.pipe(
      Layer.provideMerge(toolsLayer(log, version, toolsParts)),
      Layer.provideMerge(memoryLayer(memoryParts, log)),
      Layer.provideMerge(resources.layer),
      Layer.provideMerge(missionsLayer(missionParts)),
      Layer.provideMerge(parts.tickets ?? ticketSearchLayer),
      Layer.provideMerge(parts.ticketProviders ?? ticketProvidersLayer),
      Layer.provideMerge(ghCliLayer(parts.gh)),
      Layer.provideMerge(jiraLinkLayer(parts.jira)),
      Layer.provideMerge(runsRecipeRunnerLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          supervisorLayer(log),
          runsLayer(log, {
            agentConfigFolder: join(dataFolder, AGENT_CONFIG_FOLDER),
            ...parts.runs,
          }),
          parts.askBeforeRunning ?? consent.layer,
        ),
      ),
      Layer.provideMerge(
        (parts.actionRules ?? resourceActionRules(log)).pipe(Layer.provideMerge(profileLayers)),
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

    // An action a stopped engine left without an outcome is perhaps done: it becomes indeterminate,
    // and what its post-condition finds is written, before anything acts.
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
      Effect.andThen(step('handing the indeterminate actions over', handleIndeterminate)),
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
