/**
 * The mission's services (#148): the runs of the catalogue's `serve` commands in the mission's
 * Workspace (#7's runs, readiness and URL), whoever started them: an agent, a check, or the user.
 *
 * - Each command shows its last run: its state as the mission says it (`starting`, `ready`, `not
 *   answering`, `stopped`, `failed`), its URL, who started it, since when, and the end of its
 *   output. A service started in Building still runs in Review: the same run.
 * - The user starts, stops and restarts them from the mission: their own act, so no permission
 *   question, unless the command is marked "ask before running", which still asks (with Allow for
 *   this mission). The Builder is told, and the Journal says so.
 * - A running service cannot be dismissed (its × stops it); a stopped one can.
 * - After an engine restart, services are not started again: they show stopped, with Start.
 */

import { LIVE_RUN_STATES } from '@hemera/core/domain'
import { type MissionService, ServiceRefused, UnknownMission, UnknownRun } from '@hemera/ipc'
import { and, desc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { getCommand } from '../catalogue.ts'
import { mutate } from '../transaction.ts'
import { READINESS_FOR_MS, getRun, restartRun, runOutput, startRun, stopRun } from '../runs.ts'
import { Sessions } from '../sessions/service.ts'
import { sessionsIn } from '../sessions/store.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { buildingLaunches, commandRuns, dismissedServices, missions } from '../storage/schema.ts'
import { OutsideChanges } from './outside.ts'
import { buildingEvent, latestBuildingIn, now } from './tasks.ts'

/** How many lines of a service's output the mission shows. */
const TAIL_LINES = 20

type RunRow = typeof commandRuns.$inferSelect

/** The mission and the Workspace its services run in. */
const placeOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return yield* new UnknownMission({ id: missionId })
    const building = yield* latestBuildingIn(database, missionId)
    let workspaceId = building?.workspaceId ?? null
    if (workspaceId === null) {
      const [launch] = yield* database
        .select({ workspaceId: buildingLaunches.workspaceId })
        .from(buildingLaunches)
        .where(eq(buildingLaunches.missionId, missionId))
        .orderBy(desc(buildingLaunches.startedAt))
        .limit(1)
        .pipe(Effect.mapError(refusedWhile('reading the launch')))
      workspaceId = launch?.workspaceId ?? null
    }
    return { projectId: mission.projectId, workspaceId }
  })

/** The mission's Workspace, or the refusal of an act on a mission that has none yet. */
const workspaceOf = (missionId: string) =>
  Effect.gen(function* () {
    const { projectId, workspaceId } = yield* placeOf(missionId)
    if (workspaceId === null) {
      return yield* new ServiceRefused({ reason: 'this mission has no Workspace yet' })
    }
    return { projectId, workspaceId }
  })

/** A run's state as the mission says it. */
const stateOf = (state: string, url: string | null, startedAt: string) => {
  switch (state) {
    case 'ready':
      return 'ready' as const
    case 'failed':
      return 'failed' as const
    case 'done':
    case 'stopped':
    case 'interrupted':
      return 'stopped' as const
    default:
      // An address published that never answered within the readiness time.
      return url !== null && Date.now() - Date.parse(startedAt) > READINESS_FOR_MS
        ? ('not answering' as const)
        : ('starting' as const)
  }
}

const serviceOf = (row: RunRow) =>
  Effect.gen(function* () {
    // The row was just read: the run exists.
    const run = yield* getRun(row.id).pipe(Effect.catchTag('UnknownRun', Effect.die))
    const { output } = yield* runOutput(row.id).pipe(Effect.catchTag('UnknownRun', Effect.die))
    const live = LIVE_RUN_STATES.includes(run.state)
    return {
      runId: run.id,
      commandId: run.commandId,
      name: run.name,
      state: stateOf(run.state, run.url, run.startedAt),
      url: run.url,
      startedBy: run.startedBy,
      sessionId: run.sessionId,
      since: run.startedAt,
      endedAt: run.endedAt,
      outputTail: output.replace(/\n$/, '').split('\n').slice(-TAIL_LINES).join('\n'),
      dismissable: !live,
    } satisfies MissionService
  })

/** The services of the mission's Workspace: each command's last run, not dismissed. */
export const missionServices = (missionId: string) =>
  Effect.gen(function* () {
    const { workspaceId } = yield* placeOf(missionId)
    if (workspaceId === null) return []
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(commandRuns)
      .where(and(eq(commandRuns.workspaceId, workspaceId), eq(commandRuns.type, 'serve')))
      .orderBy(desc(commandRuns.startedAt))
      .pipe(Effect.mapError(refusedWhile('reading the services')))
    const dismissed = yield* database
      .select({ runId: dismissedServices.runId })
      .from(dismissedServices)
      .where(eq(dismissedServices.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the dismissed services')))
    const seen = new Set<string>()
    const last: RunRow[] = []
    for (const row of rows) {
      const key = row.commandId ?? row.id
      if (seen.has(key)) continue
      seen.add(key)
      if (!dismissed.some((one) => one.runId === row.id)) last.push(row)
    }
    return yield* Effect.forEach(last, serviceOf)
  })

/** A run of the mission's Workspace that is a service, or the refusal. */
const serviceRun = (missionId: string, runId: string) =>
  Effect.gen(function* () {
    const { workspaceId } = yield* workspaceOf(missionId)
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(commandRuns)
      .where(eq(commandRuns.id, runId))
      .pipe(Effect.mapError(refusedWhile('reading a run')))
    if (row === undefined) return yield* new UnknownRun({ id: runId })
    if (row.workspaceId !== workspaceId || row.type !== 'serve') {
      return yield* new ServiceRefused({ reason: 'this run is not a service of this mission' })
    }
    return row
  })

/** The Builder told what the user did, and the Journal. */
const told = (
  missionId: string,
  event: 'service.started' | 'service.stopped' | 'service.restarted',
  service: MissionService,
  said: string,
) =>
  Effect.gen(function* () {
    const database = yield* Database
    const building = yield* latestBuildingIn(database, missionId)
    yield* mutate('saying what the user did with a service', () =>
      Effect.succeed({
        result: undefined,
        events: [
          buildingEvent(missionId, event, {
            command: service.name,
            by: 'user',
            url: service.url,
            runId: service.runId,
          }),
        ],
      }),
    )
    if (building?.state === 'active') {
      const live = yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
        kind: 'mission',
        missionId,
      })
      const builder = live.find((one) => one.role === 'builder')?.lineage ?? null
      yield* Sessions.use((sessions) =>
        sessions.deliver({
          owner: { kind: 'mission', missionId },
          target: builder === null ? { role: 'builder' } : { lineage: builder },
          kind: 'service',
          body: said,
        }),
      ).pipe(Effect.ignore)
    }
    yield* OutsideChanges.use((outside) => outside.touched(missionId))
  })

/** Starts a `serve` command of the catalogue in the mission's Workspace, as the user. */
export const startService = (missionId: string, commandId: string) =>
  Effect.gen(function* () {
    const { projectId, workspaceId } = yield* workspaceOf(missionId)
    const command = yield* getCommand(projectId, commandId)
    if (command.type !== 'serve') {
      return yield* new ServiceRefused({ reason: `${command.name} is not a service` })
    }
    const run = yield* startRun({
      projectId,
      workspaceId,
      commandId,
      line: null,
      folder: null,
      startedBy: 'user',
      sessionId: null,
      missionId,
    })
    const service = yield* serviceOf(yield* runRowOf(run.id).pipe(Effect.orDie))
    yield* told(
      missionId,
      'service.started',
      service,
      `The user started the service \`${service.name}\` (run ${service.runId}): read its address with commands_output once it is ready.`,
    )
    return service
  })

const runRowOf = (runId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(commandRuns)
      .where(eq(commandRuns.id, runId))
      .pipe(Effect.mapError(refusedWhile('reading a run')))
    if (row === undefined) return yield* new UnknownRun({ id: runId })
    return row
  })

/** Stops a service of the mission: its grace, then its whole tree. */
export const stopService = (missionId: string, runId: string) =>
  Effect.gen(function* () {
    yield* serviceRun(missionId, runId)
    yield* stopRun(runId)
    const service = yield* serviceOf(yield* runRowOf(runId))
    yield* told(
      missionId,
      'service.stopped',
      service,
      `The user stopped the service \`${service.name}\`.`,
    )
    return service
  })

/** Stops a service of the mission, then starts the same command again. */
export const restartService = (missionId: string, runId: string) =>
  Effect.gen(function* () {
    yield* serviceRun(missionId, runId)
    const run = yield* restartRun(runId)
    const service = yield* serviceOf(yield* runRowOf(run.id).pipe(Effect.orDie))
    yield* told(
      missionId,
      'service.restarted',
      service,
      `The user restarted the service \`${service.name}\`: it is starting again.`,
    )
    return service
  })

/** Takes a stopped service off the mission's list; a running one is stopped, never dismissed. */
export const dismissService = (missionId: string, runId: string) =>
  Effect.gen(function* () {
    const row = yield* serviceRun(missionId, runId)
    const run = yield* getRun(row.id)
    if (LIVE_RUN_STATES.includes(run.state)) {
      return yield* new ServiceRefused({
        reason: `${run.name} is running: stop it first, its × stops it`,
      })
    }
    yield* mutate('dismissing a service', (transaction) =>
      transaction
        .insert(dismissedServices)
        .values({ missionId, runId, at: now() })
        .onConflictDoNothing()
        .pipe(
          Effect.mapError(refusedWhile('dismissing a service')),
          Effect.as({ result: undefined, events: [] }),
        ),
    )
    yield* OutsideChanges.use((outside) => outside.touched(missionId))
  })
