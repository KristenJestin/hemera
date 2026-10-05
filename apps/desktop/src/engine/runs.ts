/**
 * The runs: a catalogue command or a free line, started in a place (a Workspace, or the Project's
 * main checkout) with the Project's and the place's variables, and supervised as a process tree.
 *
 * A run records who started it, its line as it ran, its folder, its state, its exit, and the last
 * 64 KB of what it printed. A `serve` command already running in the same scope (the Workspace, or
 * the Project's main checkout for a Project-scoped one) is joined rather than started twice; the
 * first address it prints is its URL, polled until it answers (it is then `ready`), and a port
 * another run of the Project already published is reported as a conflict. A stop gives the
 * process its grace, then ends its whole tree through the supervisor.
 *
 * A command marked "ask before running" passes through the `AskBeforeRunning` port first, whoever
 * starts it, and waits for permission meanwhile. A run is never Hemera's agents' gate's to judge:
 * the user starts it, or a rule the user recorded does.
 *
 * The runs going now are held in memory; their rows are written at each change of state, so a
 * list read after a restart shows what ran and how it ended. A run an engine that stopped left
 * going is ended at the next start, if its tree is still there, and marked `interrupted`.
 */

import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import {
  LIVE_RUN_STATES,
  COMMAND_TYPES,
  RUN_STARTERS,
  RUN_STATES,
  type RunStarter,
  type RunState,
  InvalidCommand,
  type Masked,
  ROOT_REPOSITORY,
  addressIn,
  checkedLine,
  checkedTemplate,
  fillTemplate,
  lineFor,
  portOf,
  portlessNameFor,
  repositoryPath,
  runsPortless,
  wordsOf,
} from '@hemera/core/domain'
import { type Command, type PortConflict, type Run, type RunOutput, UnknownRun } from '@hemera/ipc'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  PubSub,
  Result,
  Schema,
  Scope,
  Stream,
} from 'effect'

import type { Log } from '../main/diagnostic.ts'
import { AskBeforeRunning } from './ask-before-running.ts'
import { getCommand } from './catalogue.ts'
import { findOnPath, hostLookup, invocationOf } from './command-line.ts'
import type { DomainEvents } from './domain-events.ts'
import { RecipeRunner, RecipeRunRefused } from './recipe-runner.ts'
import { Secrets } from './secrets.ts'
import { Database, type DatabaseError, refusedWhile } from './storage/database.ts'
import { commandRuns } from './storage/schema.ts'
import { ProcessSupervisor, type Supervised } from './supervisor.ts'
import { defended } from './permissions/defence.ts'
import { mutate } from './transaction.ts'
import { environmentAt } from './variables.ts'
import {
  type Place,
  type Preparations,
  mainCheckoutPlace,
  placeOf,
  templateValuesOf,
} from './workspaces.ts'

/** How much of the end of what a run printed is kept. */
export const OUTPUT_KEPT = 64 * 1024

/**
 * How much more than what is kept is held raw: what is masked is the whole of it, then cut, so a
 * secret or a key block the cut would split is still recognised whole.
 */
const OUTPUT_MARGIN = 16 * 1024

/** How often, and for how long, a service's address is asked whether it answers. */
export const READINESS_EVERY_MS = 500
export const READINESS_FOR_MS = 60_000

/** How long a run is given to end itself once asked to stop. */
export const STOP_GRACE_MS = 5_000

/** How long the pipes of a run that ended are still read before its end is written. */
const DRAIN_MS = 100

/** How long one request of an address is waited for. */
const PROBE_TIMEOUT_MS = 400

/** How many runs of a place a list answers, the newest first. */
const LISTED = 50

/** What a server says when its port is taken. */
const IN_USE = /EADDRINUSE|address already in use/i

export interface RunsSettings {
  readonly readinessEveryMillis: number
  readonly readinessForMillis: number
  readonly graceMillis: number
  /** The empty folder the forge CLIs of an agent's commands read their configuration from. */
  readonly agentConfigFolder: string
}

/** One run going in this engine, and everything known of it. */
interface Live {
  run: Run
  output: string
  dropped: number
  /** Hemera asked it to stop: however the system reports the end, it ends `stopped`. */
  stopping: boolean
  /** The question of "ask before running", while it waits for the answer. */
  waiting: Fiber.Fiber<void> | null
  process: Supervised | null
  /** Done once its end is written. */
  readonly ended: Deferred.Deferred<void>
  /** Done with the first address it printed, or with null once it ended without one. */
  readonly published: Deferred.Deferred<string | null>
  /** Whether it runs through Portless, whose address is the proxy's and holds no port of its own. */
  readonly portless: boolean
}

/**
 * The runs going in this engine, the engine's scope every process and watcher lives in, and the
 * changes told to whoever follows them.
 */
interface RunsState {
  readonly live: Map<string, Live>
  readonly scope: Scope.Scope
  readonly changes: PubSub.PubSub<Run>
  readonly log: Log
  readonly platform: NodeJS.Platform
  readonly settings: RunsSettings
  /** What a run printed, masked as the engine's registry of known secrets masks it. */
  readonly mask: (text: string) => Masked<string>
}

export class Runs extends Context.Service<Runs, RunsState>()('Runs') {}

/** What the calls on runs stand on. */
export type RunServices =
  | Database
  | DomainEvents
  | Preparations
  | Runs
  | ProcessSupervisor
  | AskBeforeRunning
  | Secrets

const readConflict = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ port: Schema.Number, runId: Schema.String, name: Schema.String }),
  ),
)

type RunRow = typeof commandRuns.$inferSelect

const runOf = (row: RunRow): Run => ({
  id: row.id,
  projectId: row.projectId,
  workspaceId: row.workspaceId,
  commandId: row.commandId,
  name: row.name,
  type: COMMAND_TYPES.find((one) => one === row.type) ?? 'script',
  line: row.line,
  folder: row.folder,
  startedBy: RUN_STARTERS.find((one) => one === row.startedBy) ?? 'user',
  sessionId: row.sessionId,
  missionId: row.missionId,
  state: RUN_STATES.find((one) => one === row.state) ?? 'failed',
  exitCode: row.exitCode,
  url: row.url,
  portConflict: row.portConflict === null ? null : Option.getOrNull(readConflict(row.portConflict)),
  startedAt: row.startedAt,
  endedAt: row.endedAt,
})

const said = <E>(cause: E): string =>
  cause instanceof Error && cause.message !== '' ? cause.message : String(cause)

/** The runs going in this engine, in the engine's scope. */
export const runsLayer = (log: Log, settings: Partial<RunsSettings> = {}) =>
  Layer.effect(
    Runs,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const changes = yield* PubSub.unbounded<Run>()
      const secrets = yield* Secrets
      return {
        live: new Map<string, Live>(),
        scope,
        changes,
        log,
        platform: process.platform,
        settings: {
          readinessEveryMillis: settings.readinessEveryMillis ?? READINESS_EVERY_MS,
          readinessForMillis: settings.readinessForMillis ?? READINESS_FOR_MS,
          graceMillis: settings.graceMillis ?? STOP_GRACE_MS,
          agentConfigFolder:
            settings.agentConfigFolder ?? join(tmpdir(), 'hemera-agents-no-forge-login'),
        },
        mask: secrets.mask,
      }
    }),
  )

/**
 * Whether an address answers, whatever its status: a refused connection, a name that does not
 * resolve and a request that takes too long are no answer. An `https` address (what Portless
 * prints, on a certificate of its own) is asked without checking the certificate: the question is
 * whether the server answers, not whether it is to be trusted.
 */
export const addressAnswers = (address: string) =>
  Effect.tryPromise(async () => {
    if (!address.startsWith('https:')) {
      const response = await fetch(address.replace('://0.0.0.0', '://127.0.0.1'), {
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      await response.body?.cancel()
      return
    }
    await new Promise<void>((resolve, reject) => {
      const asked = httpsRequest(
        address,
        { method: 'GET', rejectUnauthorized: false, timeout: PROBE_TIMEOUT_MS },
        (response) => {
          response.resume()
          resolve()
        },
      )
      asked.on('timeout', () => asked.destroy(new Error('no answer in time')))
      asked.on('error', reject)
      asked.end()
    })
  }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

/** The row of a run and its event, written as one change, then told to whoever follows runs. */
const writeRun = (live: Live, event: string | null) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const { run } = live
    const columns = {
      projectId: run.projectId,
      workspaceId: run.workspaceId,
      commandId: run.commandId,
      name: run.name,
      type: run.type,
      line: run.line,
      folder: run.folder,
      startedBy: run.startedBy,
      sessionId: run.sessionId,
      missionId: run.missionId,
      state: run.state,
      exitCode: run.exitCode,
      url: run.url,
      portConflict: run.portConflict === null ? null : JSON.stringify(run.portConflict),
      ...shownOutput(runs, live),
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    }
    yield* mutate('recording a run', (transaction) =>
      transaction
        .insert(commandRuns)
        .values({ id: run.id, ...columns })
        .onConflictDoUpdate({ target: commandRuns.id, set: columns })
        .pipe(
          Effect.mapError(refusedWhile('recording a run')),
          Effect.as({
            result: undefined,
            events:
              event === null
                ? []
                : [
                    {
                      type: event,
                      entityKind: 'run',
                      entityId: run.id,
                      source: run.startedBy === 'user' ? ('ui' as const) : ('system' as const),
                      author: run.startedBy === 'user' ? ('human' as const) : run.startedBy,
                      payload: {
                        projectId: run.projectId,
                        workspaceId: run.workspaceId,
                        commandId: run.commandId,
                        name: run.name,
                        state: run.state,
                        exitCode: run.exitCode,
                        url: run.url,
                      },
                    },
                  ],
          }),
        ),
    )
    yield* PubSub.publish(runs.changes, run)
  })

/** The same, from a watcher: a refusal of the data folder is written to the diagnostic. */
const writeQuietly = (live: Live, event: string | null) =>
  writeRun(live, event).pipe(
    Effect.catch((failure) =>
      Runs.useSync((runs) =>
        runs.log(`the run ${live.run.id} (${live.run.name}) was not recorded: ${failure.message}`),
      ),
    ),
  )

/** Ends a run: its state, its exit, a last line of its own, written once, then let go of. */
const endRun = (live: Live, state: RunState, exitCode: number | null, note: string | null) =>
  Effect.gen(function* () {
    if (yield* Deferred.isDone(live.ended)) return
    const runs = yield* Runs
    if (note !== null) keep(live, note)
    live.run = { ...live.run, state, exitCode, endedAt: new Date().toISOString() }
    yield* writeQuietly(live, 'run.ended')
    yield* Deferred.succeed(live.published, null)
    yield* Deferred.succeed(live.ended, undefined)
    runs.live.delete(live.run.id)
  })

/** Keeps a line of what a run printed, raw, the oldest dropped past the kept part and its margin. */
const keep = (live: Live, line: string): void => {
  live.output += `${line}\n`
  if (live.output.length > OUTPUT_KEPT + OUTPUT_MARGIN) {
    const dropped = live.output.length - OUTPUT_KEPT - OUTPUT_MARGIN
    live.dropped += dropped
    live.output = live.output.slice(dropped)
  }
}

/** What a run printed as it is shown and kept: masked whole, then its last `OUTPUT_KEPT`. */
const shownOutput = (runs: RunsState, live: Live): RunOutput => {
  const masked = runs.mask(live.output)
  const tail = masked.slice(-OUTPUT_KEPT)
  return { output: runs.mask(tail), dropped: live.dropped + masked.length - tail.length }
}

/** The run of the Project, other than this one, going with an address on `port`. */
const holderOf = (runs: RunsState, live: Live, port: number): PortConflict | null => {
  for (const other of runs.live.values()) {
    if (other === live || other.portless || other.run.projectId !== live.run.projectId) continue
    if (other.run.url !== null && portOf(other.run.url) === port) {
      return { port, runId: other.run.id, name: other.run.name }
    }
  }
  return null
}

/**
 * What a service's first address sets going: the conflict with the run of the Project holding its
 * port, then the address asked every interval until it answers (the run is `ready`) or until the
 * time is up. The asking stops when the run ends.
 */
const watchAddress = (live: Live) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const url = yield* Deferred.await(live.published)
    if (url === null) return
    const port = live.portless ? null : portOf(url)
    const conflict = port === null ? null : holderOf(runs, live, port)
    live.run = { ...live.run, url, portConflict: conflict }
    yield* writeQuietly(live, null)
    const deadline = Date.now() + runs.settings.readinessForMillis
    while (live.run.state === 'running') {
      if (yield* addressAnswers(url)) {
        if (live.run.state !== 'running') return
        live.run = { ...live.run, state: 'ready' }
        return yield* writeQuietly(live, 'run.ready')
      }
      if (Date.now() >= deadline) return
      yield* Effect.sleep(runs.settings.readinessEveryMillis)
    }
  })

/** What a run is started from, once its place, line and folder are known. */
interface Launch {
  readonly words: ReadonlyArray<string>
  readonly folder: string
  readonly environment: Readonly<Record<string, string>>
  /** The Portless name a service runs under, when it runs through Portless. */
  readonly portless: string | null
}

/** Starts the process of a run, and watches it until it ends. */
const launch = (live: Live, asked: Launch) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const supervisor = yield* ProcessSupervisor
    const lookup = hostLookup(asked.folder, asked.environment)
    let words = asked.words
    if (asked.portless !== null) {
      const found = findOnPath('portless', lookup, runs.platform)
      if (found === null) {
        return yield* endRun(
          live,
          'failed',
          null,
          'portless was not found on the PATH: nothing was started',
        )
      }
      words = [found, asked.portless, ...words]
    }
    const invocation = invocationOf(words, runs.platform, lookup)
    if (invocation === null) return yield* endRun(live, 'failed', null, 'its line is empty')

    const scope = yield* Scope.fork(runs.scope)
    const started = yield* supervisor
      .start(invocation.program, invocation.args, {
        cwd: asked.folder,
        env: asked.environment,
        verbatim: invocation.verbatim,
        graceMillis: runs.settings.graceMillis,
        owner: { kind: 'run', id: live.run.id },
      })
      .pipe(Scope.provide(scope), Effect.result)
    if (Result.isFailure(started)) {
      yield* Scope.close(scope, Exit.void)
      return yield* endRun(live, 'failed', null, started.failure.message)
    }
    const child = started.success
    live.process = child
    const heard = (line: string) => {
      keep(live, line)
      if (!Deferred.isDoneUnsafe(live.published)) {
        const url = addressIn(line)
        if (url !== null) Deferred.doneUnsafe(live.published, Effect.succeed(url))
      }
    }
    child.onStdout(heard)
    child.onStderr(heard)
    live.run = { ...live.run, state: 'running' }
    yield* writeRun(live, 'run.started')

    if (live.run.type === 'serve') {
      yield* watchAddress(live).pipe(Effect.forkIn(runs.scope))
    }
    yield* child.exited.pipe(
      Effect.flatMap((observation) =>
        Effect.gen(function* () {
          yield* Effect.sleep(DRAIN_MS)
          let state: RunState = live.stopping
            ? 'stopped'
            : observation.code === 0
              ? 'done'
              : 'failed'
          let conflict = live.run.portConflict
          // A server whose port is taken failed, whatever its exit code, and names the holder.
          if (live.run.type === 'serve' && !live.stopping && IN_USE.test(live.output)) {
            state = 'failed'
            const port = /:(\d{2,5})\b/.exec(
              live.output.split('\n').find((line) => IN_USE.test(line)) ?? '',
            )
            const holder = port === null ? null : holderOf(runs, live, Number(port[1]))
            conflict = holder ?? conflict
          }
          live.run = { ...live.run, portConflict: conflict }
          yield* endRun(live, state, observation.code, null)
          yield* Scope.close(scope, Exit.void)
        }),
      ),
      Effect.forkIn(runs.scope),
    )
    // Asked to stop while it was starting: it ends now.
    if (live.stopping) yield* child.stop
  })

/** What a run is asked with: a catalogue command, or a free line in a folder under the place. */
export interface RunAsked {
  readonly projectId: string
  /** The Workspace, or null for the main checkout. */
  readonly workspaceId: string | null
  readonly commandId: string | null
  readonly line: string | null
  /** For a free line: its folder under the place, or null for the place's root. */
  readonly folder: string | null
  readonly startedBy: RunStarter
  readonly sessionId: string | null
  /** The mission it is started for: a cancel of that mission stops it. */
  readonly missionId?: string | null
  /** Run at opening: a permission it needs is asked at Project level. */
  readonly atOpen?: boolean
}

/** A line checked for a run: no shell syntax, only template names Hemera fills. */
const runnable = (line: string) =>
  Effect.gen(function* () {
    yield* Effect.fromResult(checkedLine(line))
    return yield* Effect.fromResult(checkedTemplate(line))
  })

/** Where a command runs in a place: its repository's folder, then its own folder. */
const commandFolder = (place: Place, command: Command): string => {
  const repository = place.project.repositories.find((one) => one.id === command.repositoryId)
  const values = templateValuesOf(place)
  return join(
    place.folder,
    repository === undefined || repository.path === ROOT_REPOSITORY ? '' : repository.path,
    fillTemplate(command.folder ?? '', values),
  )
}

/** The `serve` run of a command going in the same scope, if there is one. */
const runningService = (runs: RunsState, command: Command, workspaceId: string | null) => {
  for (const live of runs.live.values()) {
    if (
      live.run.commandId === command.id &&
      live.run.workspaceId === workspaceId &&
      !live.stopping &&
      LIVE_RUN_STATES.includes(live.run.state)
    ) {
      return live
    }
  }
  return null
}

/**
 * Starts a run, and answers it as it then stands: running, or failed when its program could not
 * be started, or waiting for permission. A `serve` already going in its scope is answered instead.
 */
export const startRun = (asked: RunAsked) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    let place = yield* placeOf(asked.projectId, asked.workspaceId)
    const command =
      asked.commandId === null ? null : yield* getCommand(asked.projectId, asked.commandId)
    if (command === null && (asked.line === null || asked.line.trim() === '')) {
      return yield* new InvalidCommand({
        reason: 'name a command of the catalogue or write a line',
      })
    }
    // A Project-scoped service is one instance for the Project, in its main checkout.
    if (command?.type === 'serve' && command.scope === 'project') {
      place = mainCheckoutPlace(place.project)
    }
    const workspaceId = place.workspace?.id ?? null
    if (command?.type === 'serve') {
      const joined = runningService(runs, command, workspaceId)
      if (joined !== null) return joined.run
    }

    const line = command === null ? (asked.line ?? '').trim() : lineFor(command, runs.platform)
    yield* runnable(line)
    const values = templateValuesOf(place)
    const relativeFolder =
      command === null && asked.folder !== null && asked.folder.trim() !== ''
        ? yield* Effect.fromResult(repositoryPath(asked.folder))
        : null
    const folder =
      command === null
        ? join(
            place.folder,
            relativeFolder === null || relativeFolder === ROOT_REPOSITORY
              ? ''
              : fillTemplate(relativeFolder, values),
          )
        : commandFolder(place, command)
    const words = wordsOf(line).map((word) => fillTemplate(word, values))
    if (words.length === 0) return yield* new InvalidCommand({ reason: 'its line is empty' })
    const portless =
      command !== null && command.type === 'serve' && command.portless && !runsPortless(line)
        ? portlessNameFor(command.portlessName, place.project.name)
        : null

    // An agent's call was decided by the gate, which asks for a command marked so: never twice.
    const ask = command !== null && command.askBeforeRunning && asked.startedBy !== 'agent'
    const live: Live = {
      run: {
        id: crypto.randomUUID(),
        projectId: place.project.id,
        workspaceId,
        commandId: command?.id ?? null,
        name: command?.name ?? words[0] ?? line,
        type: command?.type ?? 'script',
        line: fillTemplate(line, values),
        folder,
        startedBy: asked.startedBy,
        sessionId: asked.sessionId,
        missionId: asked.missionId ?? null,
        state: ask ? 'waiting_for_permission' : 'starting',
        exitCode: null,
        url: null,
        portConflict: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      },
      output: '',
      dropped: 0,
      stopping: false,
      waiting: null,
      process: null,
      ended: yield* Deferred.make<void>(),
      published: yield* Deferred.make<string | null>(),
      portless: portless !== null,
    }
    // An agent's command in a mission gets the defence in depth: no forge login, no push.
    const environment =
      asked.startedBy === 'agent' && (asked.missionId ?? null) !== null
        ? defended(yield* environmentAt(place), runs.settings.agentConfigFolder)
        : yield* environmentAt(place)
    yield* mutate('recording a run', (transaction) =>
      transaction
        .insert(commandRuns)
        .values({
          id: live.run.id,
          projectId: live.run.projectId,
          workspaceId,
          commandId: live.run.commandId,
          name: live.run.name,
          type: live.run.type,
          line: live.run.line,
          folder,
          askedLine: command === null ? line : null,
          askedFolder: command === null ? relativeFolder : null,
          startedBy: asked.startedBy,
          sessionId: asked.sessionId,
          missionId: live.run.missionId,
          state: live.run.state,
          exitCode: null,
          url: null,
          portConflict: null,
          output: runs.mask(''),
          dropped: 0,
          startedAt: live.run.startedAt,
          endedAt: null,
        })
        .pipe(
          Effect.mapError(refusedWhile('recording a run')),
          Effect.as({ result: undefined, events: [] }),
        ),
    )
    runs.live.set(live.run.id, live)
    const launching = launch(live, { words, folder, environment, portless })

    if (command === null || !ask) {
      yield* launching
      return live.run
    }

    yield* writeRun(live, 'run.waiting_for_permission')
    live.waiting = yield* (yield* AskBeforeRunning)
      .decide({
        runId: live.run.id,
        projectId: live.run.projectId,
        workspaceId,
        commandId: command.id,
        name: command.name,
        line: live.run.line,
        startedBy: asked.startedBy,
        missionId: live.run.missionId,
        level: asked.atOpen === true ? 'project' : 'place',
      })
      .pipe(
        Effect.flatMap((answer) =>
          Effect.gen(function* () {
            live.waiting = null
            if (answer === 'denied') {
              return yield* endRun(live, 'failed', null, 'The user did not allow it to run.')
            }
            live.run = { ...live.run, state: 'starting' }
            yield* launching
          }),
        ),
        Effect.catch((failure) =>
          Effect.andThen(
            Effect.sync(() => runs.log(`the run ${live.run.id} was not started: ${said(failure)}`)),
            endRun(live, 'failed', null, said(failure)),
          ),
        ),
        Effect.forkIn(runs.scope),
      )
    return live.run
  })

/** A run, going or ended, by its identifier. */
export const getRun = (id: string) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const live = runs.live.get(id)
    if (live !== undefined) return live.run
    return runOf(yield* runRow(id))
  })

const runRow = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(commandRuns)
      .where(eq(commandRuns.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a run')))
    if (row === undefined) return yield* new UnknownRun({ id })
    return row
  })

/** The last of what a run printed. */
export const runOutput = (id: string) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const live = runs.live.get(id)
    if (live !== undefined) return shownOutput(runs, live)
    const row = yield* runRow(id)
    return { output: row.output, dropped: row.dropped } satisfies RunOutput
  })

/** Waits until a run has ended, and answers it as it ended. */
export const awaitRun = (id: string) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const live = runs.live.get(id)
    if (live !== undefined) yield* Deferred.await(live.ended)
    return yield* getRun(id)
  })

/**
 * Stops a run: one waiting for permission no longer waits; a process is given its grace, then its
 * tree is ended. Answers once its end is written; a run that has ended is answered as it ended.
 */
export const stopRun = (id: string) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const live = runs.live.get(id)
    if (live === undefined) return yield* getRun(id)
    live.stopping = true
    const waiting = live.waiting
    if (waiting !== null) {
      yield* Fiber.interrupt(waiting)
      yield* endRun(live, 'stopped', null, null)
    } else if (live.process !== null) {
      yield* live.process.stop
    }
    yield* Deferred.await(live.ended)
    return live.run
  })

/** Stops a run, then starts the same command, or the same line, in the same place. */
export const restartRun = (id: string) =>
  Effect.gen(function* () {
    const row = yield* runRow(id)
    yield* stopRun(id)
    return yield* startRun({
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      commandId: row.commandId,
      line: row.commandId === null ? (row.askedLine ?? row.line) : null,
      folder: row.commandId === null ? row.askedFolder : null,
      startedBy: 'user',
      sessionId: null,
      missionId: row.missionId,
    })
  })

/**
 * Stops every run going for a mission, its services included: what a cancel of the mission asks.
 * A service it joined that another mission started is that mission's, and keeps going.
 */
export const stopMissionRuns = (missionId: string) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const going = [...runs.live.values()].filter((live) => live.run.missionId === missionId)
    yield* Effect.forEach(going, (live) => stopRun(live.run.id), {
      concurrency: 'unbounded',
      discard: true,
    })
  })

/** The runs of a place, the newest first: the Workspace's, or the main checkout's for null. */
export const listRuns = (projectId: string, workspaceId: string | null) =>
  Effect.gen(function* () {
    yield* placeOf(projectId, workspaceId)
    const runs = yield* Runs
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(commandRuns)
      .where(
        and(
          eq(commandRuns.projectId, projectId),
          workspaceId === null
            ? isNull(commandRuns.workspaceId)
            : eq(commandRuns.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(commandRuns.startedAt))
      .limit(LISTED)
      .pipe(Effect.mapError(refusedWhile('reading the runs')))
    return rows.map((row) => runs.live.get(row.id)?.run ?? runOf(row))
  })

/** Each run as it changes, for as long as the caller listens. */
export const runChanges: Stream.Stream<Run, never, Runs> = Stream.unwrap(
  Runs.useSync((runs) => Stream.fromPubSub(runs.changes)),
)

/**
 * At the engine's start: every run a previous engine left going is ended, its tree first when it
 * is still there and still the program that was started, and marked `interrupted`. What to start
 * again afterwards belongs to whoever owns each run. Answers the runs it marked.
 */
export const recoverRuns = Effect.gen(function* () {
  const supervisor = yield* ProcessSupervisor
  yield* supervisor.endOrphans('run')
  const runs = yield* Runs
  const database = yield* Database
  const left = yield* database
    .select()
    .from(commandRuns)
    .where(inArray(commandRuns.state, [...LIVE_RUN_STATES]))
    .pipe(Effect.mapError(refusedWhile('reading the runs')))
  const endedAt = new Date().toISOString()
  const interrupted = left.filter((row) => !runs.live.has(row.id))
  if (interrupted.length === 0) return []
  yield* mutate('interrupting the runs a previous engine left', (transaction) =>
    transaction
      .update(commandRuns)
      .set({ state: 'interrupted', endedAt })
      .where(
        inArray(
          commandRuns.id,
          interrupted.map((row) => row.id),
        ),
      )
      .pipe(
        Effect.mapError(refusedWhile('interrupting the runs')),
        Effect.as({
          result: undefined,
          events: interrupted.map((row) => ({
            type: 'run.interrupted',
            entityKind: 'run',
            entityId: row.id,
            source: 'system' as const,
            author: 'hemera' as const,
            payload: { projectId: row.projectId, name: row.name, state: row.state },
          })),
        }),
      ),
  )
  return interrupted.map((row) => row.id)
})

/** At the engine's end: what is still going is written `stopped`, its process ended with it. */
export const runsEndWithEngine = Effect.gen(function* () {
  const runs = yield* Runs
  for (const live of runs.live.values()) {
    live.stopping = true
    live.run = { ...live.run, state: 'stopped', endedAt: new Date().toISOString() }
    yield* writeQuietly(live, 'run.ended')
  }
  runs.live.clear()
})

/**
 * The preparation recipe's `run` steps, as runs: a catalogue command in its own place of the
 * Workspace, a free line in the step's folder. The step waits for the run's end, which is its
 * outcome; a run that cannot be started is a refusal with its reason.
 */
export const runsRecipeRunnerLayer: Layer.Layer<RecipeRunner, never, RunServices> = Layer.effect(
  RecipeRunner,
  Effect.gen(function* () {
    const services = yield* Effect.context<RunServices>()
    return {
      run: (step) =>
        Effect.gen(function* () {
          const place = yield* placeOf(step.projectId, step.workspaceId)
          const started = yield* startRun({
            projectId: step.projectId,
            workspaceId: step.workspaceId,
            commandId: step.commandId,
            line: step.line,
            folder: step.commandId === null ? relative(place.folder, step.folder) || null : null,
            startedBy: 'hemera',
            sessionId: null,
          })
          const ended = yield* awaitRun(started.id)
          const { output } = yield* runOutput(started.id)
          return { exitCode: ended.state === 'done' ? 0 : ended.exitCode, output }
        }).pipe(
          Effect.catch((refusal: { readonly message: string } | DatabaseError) =>
            Effect.fail(new RecipeRunRefused({ reason: refusal.message })),
          ),
          Effect.provide(services),
        ),
    }
  }),
)
