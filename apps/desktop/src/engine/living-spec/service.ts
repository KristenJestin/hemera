/**
 * The bootstrap of a Project's living spec (#93): Hemera starts a session of the `living-spec`
 * role when a Project is added and when the user asks, for the whole living spec or one domain;
 * one run at a time per Project.
 *
 * - **The cap.** It is a fixed Hemera phase: its session waits for a free slot of the Project's
 *   cap instead of being refused, and its run says `waiting_for_slot` while the cap says it waits.
 *   It belongs to no mission and spends no mission budget.
 * - **The model.** From the cascade, role `living-spec`. A model or an agent that cannot be had
 *   stops its session with the Project's need (#41): nothing is proposed, nothing is substituted,
 *   and the run says it failed until a Retry starts its lineage again.
 * - **Interruption.** A session that dies, stalls or is replaced is replaced by the role sessions
 *   (#40), and a restart rebuilds a running one: the new session's brief lists what the run already
 *   proposed. A run whose lineage had sessions and has no live one any more reads as failed; a
 *   run whose first session is still being opened reads as running.
 * - **The end.** `living_spec_done` ends the run; once its turn has settled its session ends and
 *   frees its slot. A session that ends its turn without it is reminded once; ending a turn
 *   without it again ends its run, failed, its proposals kept. Removing a Project would stop its
 *   run: Hemera 1.0 has no removal of a Project yet.
 *
 * Hemera does not detect behaviour changed outside Hemera in 1.0.
 */

import { join } from 'node:path'

import {
  type BootstrapRun,
  LivingSpecRefused,
  type LivingSpecState,
  RunCommit,
  type UnknownProject,
} from '@hemera/ipc'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Schema, Semaphore, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { Git } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { expireNeedIn } from '../needs.ts'
import { getProject } from '../projects.ts'
import type { Secrets } from '../secrets.ts'
import { Cap } from '../sessions/cap.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { getSession, sessionsOfLineage } from '../sessions/store.ts'
import { waitsOnUser } from '../setup/service.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import {
  agentSessions,
  livingDomains,
  livingRuns,
  sessionDeliveries,
  sessionNeeds,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { type RunRow, domainsIn, failRun, runOfLineage } from './store.ts'

export class LivingSpec extends Context.Service<
  LivingSpec,
  {
    /**
     * Starts a run for a Project, of one domain or of all; refused while one waits or runs, with
     * the sentence the user reads.
     */
    readonly bootstrap: (
      projectId: string,
      domainId: string | null,
    ) => Effect.Effect<BootstrapRun, LivingSpecRefused | UnknownProject | DatabaseError>
    /** The Project's runs, the newest first, each as it stands now. */
    readonly runs: (
      projectId: string,
    ) => Effect.Effect<ReadonlyArray<BootstrapRun>, UnknownProject | DatabaseError>
    /** The Project's living spec now, then again after each change of it or of its runs. */
    readonly changes: (
      projectId: string,
    ) => Stream.Stream<LivingSpecState, UnknownProject | DatabaseError>
  }
>()('LivingSpec') {}

export interface LivingSpecSettings {
  readonly log: Log
  /** Whether adding a Project starts its bootstrap; a suite or a headless run says no. */
  readonly starts: boolean
}

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

/** Why a run whose lineage stopped without a successor reads as failed. */
const STOPPED = 'its session stopped'

/** Why the needs of a run read again from the start expire. */
const SUPERSEDED = 'the living spec is being read again: this reading is over'

/** Why a session whose run is over ends as soon as its turn starts. */
const ENDED = 'its reading has ended'

/** What Hemera says, once, to a session whose turn ended without `living_spec_done`. */
export const REMINDER =
  'Your reading of the living spec is not over: if you are done, call `living_spec_done` with your summary; otherwise go on proposing. A turn that ends again without it ends the reading.'

/** Why a run ends when its session ended its turn without `living_spec_done`. */
export const NOT_DONE = 'it stopped without living_spec_done: its proposals are kept'

/** How soon a session whose turn is being closed is looked at again. */
const ENDING_LOOK = '10 millis'

const readCommits = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(RunCommit)))

const STATES = ['done', 'failed', 'stopped'] as const

type Needs = Database | DomainEvents | Secrets | Sessions | Cap | Git | SessionPost

export const livingSpecLayer = (settings: LivingSpecSettings) =>
  Layer.effect(
    LivingSpec,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const sessions = yield* Sessions
      const cap = yield* Cap
      const scope = yield* Effect.scope
      const lock = yield* Semaphore.make(1)
      const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const said = (line: string) => Effect.sync(() => settings.log(`living spec: ${line}`))

      /** A run as it stands: written, or as its lineage and the cap say while it runs. */
      const standingOf = (row: RunRow) =>
        Effect.gen(function* () {
          const commits = Option.getOrElse(readCommits(row.commits), () => [])
          const base = {
            id: row.id,
            projectId: row.projectId,
            domainId: row.domainId,
            commits,
            summary: row.summary,
            startedAt: row.startedAt,
            endedAt: row.endedAt,
          }
          if (row.state !== 'running') {
            const state = STATES.find((one) => one === row.state) ?? 'failed'
            return { ...base, state, sentence: row.stateReason } satisfies BootstrapRun
          }
          const lineage = yield* sessionsOfLineage(row.lineage)
          const live = lineage.filter((one) => LIVE.some((state) => state === one.state))
          // No session yet: the run was just written and its session is being opened.
          if (lineage.length > 0 && live.length === 0) {
            const last = lineage.at(-1)
            return {
              ...base,
              state: 'failed',
              sentence: last?.stateReason ?? STOPPED,
            } satisfies BootstrapRun
          }
          const waits = yield* cap.waiting(row.lineage)
          return {
            ...base,
            state: waits === null ? 'running' : 'waiting_for_slot',
            sentence: waits,
          } satisfies BootstrapRun
        })

      const runs = (projectId: string) =>
        Effect.gen(function* () {
          yield* getProject(projectId)
          const database = yield* Database
          const rows = yield* database
            .select()
            .from(livingRuns)
            .where(eq(livingRuns.projectId, projectId))
            .orderBy(desc(livingRuns.startedAt))
            .pipe(Effect.mapError(refusedWhile('reading the bootstrap runs')))
          return yield* Effect.forEach(rows, standingOf)
        }).pipe(run)

      /** The commit each repository's main checkout is at now; null when Git cannot say. */
      const commitsAt = (mainCheckout: string, paths: ReadonlyArray<string>) =>
        Effect.forEach(paths, (path) =>
          Git.use((git) => git.status(join(mainCheckout, path))).pipe(
            Effect.map((status) => ({ repository: path, commit: status.commit })),
            Effect.orElseSucceed(() => ({ repository: path, commit: null })),
          ),
        )

      const bootstrap = (projectId: string, domainId: string | null) =>
        Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const project = yield* getProject(projectId)
            const commits = yield* commitsAt(
              project.mainCheckout,
              project.repositories.map((one) => one.path),
            )
            const lineage = crypto.randomUUID()
            const row = yield* mutate('starting a reading of the living spec', (transaction) =>
              Effect.gen(function* () {
                const expired: NewEvent[] = []
                let domain: string | null = null
                if (domainId !== null) {
                  const [found] = yield* transaction
                    .select()
                    .from(livingDomains)
                    .where(
                      and(eq(livingDomains.id, domainId), eq(livingDomains.projectId, projectId)),
                    )
                    .pipe(Effect.mapError(refusedWhile('reading the living spec')))
                  if (found === undefined || found.removedAt !== null) {
                    return yield* new LivingSpecRefused({
                      reason: `This domain is not in the living spec of ${project.name}.`,
                    })
                  }
                  domain = found.name
                }
                const open = yield* transaction
                  .select()
                  .from(livingRuns)
                  .where(and(eq(livingRuns.projectId, projectId), eq(livingRuns.state, 'running')))
                  .pipe(Effect.mapError(refusedWhile('reading the bootstrap runs')))
                for (const one of open) {
                  const live = yield* transaction
                    .select({ id: agentSessions.id })
                    .from(agentSessions)
                    .where(
                      and(
                        eq(agentSessions.lineage, one.lineage),
                        inArray(agentSessions.state, [...LIVE]),
                      ),
                    )
                    .pipe(Effect.mapError(refusedWhile('reading the sessions')))
                  if (live.length > 0) {
                    return yield* new LivingSpecRefused({
                      reason: `The living spec of ${project.name} is already being read.`,
                    })
                  }
                  // Its lineage stopped and nothing took it up: it ends here, failed, for good,
                  // and what its sessions still ask goes with it, so no Retry starts it again.
                  const asked = yield* transaction
                    .select({ id: sessionNeeds.needId })
                    .from(sessionNeeds)
                    .innerJoin(agentSessions, eq(agentSessions.id, sessionNeeds.sessionId))
                    .where(eq(agentSessions.lineage, one.lineage))
                    .pipe(Effect.mapError(refusedWhile('reading the needs of a run')))
                  for (const need of asked) {
                    expired.push(...(yield* expireNeedIn(transaction, need.id, SUPERSEDED)))
                  }
                  yield* transaction
                    .update(livingRuns)
                    .set({
                      state: 'failed',
                      stateReason: STOPPED,
                      endedAt: new Date().toISOString(),
                    })
                    .where(eq(livingRuns.id, one.id))
                    .pipe(Effect.mapError(refusedWhile('ending a bootstrap run')))
                }
                const [made] = yield* transaction
                  .insert(livingRuns)
                  .values({
                    id: crypto.randomUUID(),
                    projectId,
                    domainId,
                    lineage,
                    state: 'running',
                    commits: JSON.stringify(commits),
                    startedAt: new Date().toISOString(),
                  })
                  .returning()
                  .pipe(Effect.mapError(refusedWhile('starting a bootstrap run')))
                if (made === undefined) return yield* Effect.die(new Error('no run was written'))
                return {
                  result: made,
                  events: [
                    ...expired,
                    {
                      type: 'livingSpec.bootstrap_started',
                      entityKind: 'project',
                      entityId: projectId,
                      source: 'system',
                      author: 'hemera',
                      payload: { run: made.id, domain },
                    } as const,
                  ],
                }
              }),
            )
            // Its lineage is known before its session opens: its turns find their run.
            yield* sessions
              .reopen(
                lineage,
                {
                  owner: { kind: 'project', projectId },
                  role: 'living-spec',
                  folder: project.mainCheckout,
                },
                'a reading of the living spec',
              )
              .pipe(
                Effect.catchTag('SessionRefused', (refusal) =>
                  Effect.andThen(
                    failRun(row.id, refusal.reason),
                    Effect.fail(new LivingSpecRefused({ reason: refusal.message })),
                  ),
                ),
              )
            return yield* standingOf(row)
          }),
        ).pipe(run)

      /**
       * Once a session's turn has settled and nothing of it waits on the user: done, its session
       * ends; not done, it is reminded once, and the next time its run ends failed, its
       * proposals kept.
       */
      const settledTurn = (sessionId: string) =>
        Effect.gen(function* () {
          const first = yield* getSession(sessionId)
          if (first.role !== 'living-spec') return
          let session = first
          for (;;) {
            yield* sessions.settled(sessionId)
            session = yield* getSession(sessionId)
            // Its turn closed but its state not written yet: look again.
            if (session.state !== 'working' && session.state !== 'starting') break
            yield* Effect.sleep(ENDING_LOOK)
          }
          if (session.state !== 'idle') return
          if (yield* waitsOnUser(sessionId)) return
          const row = yield* runOfLineage(session.lineage)
          if (row === null) return
          if (row.state === 'running') {
            // Once per run, Hemera reminds it before its run fails (report Q9).
            const reminder = `living-spec-reminder-${row.id}`
            const database = yield* Database
            const [sent] = yield* database
              .select({ id: sessionDeliveries.id })
              .from(sessionDeliveries)
              .where(eq(sessionDeliveries.id, reminder))
              .pipe(Effect.mapError(refusedWhile('reading the deliveries')))
            if (sent === undefined) {
              yield* sessions
                .deliver({
                  id: reminder,
                  owner: session.owner,
                  target: { lineage: session.lineage },
                  kind: 'reminder',
                  body: REMINDER,
                })
                .pipe(Effect.catchTag('DeliveryKindRefused', Effect.die))
              return
            }
            yield* failRun(row.id, NOT_DONE)
          }
          yield* sessions.end(
            session.lineage,
            row.state === 'done' ? 'its reading is done' : 'its reading ended',
          )
        }).pipe(
          run,
          Effect.catchCause((cause) => said(`a turn's end was not followed: ${String(cause)}`)),
        )

      /**
       * A session whose turn starts while its run is no longer running (a Retry or a change of
       * model started its lineage again after the run ended) ends at once: it reads for nothing.
       */
      const startedTurn = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* getSession(sessionId)
          if (session.role !== 'living-spec') return
          const row = yield* runOfLineage(session.lineage)
          if (row !== null && row.state === 'running') return
          yield* sessions.end(session.lineage, ENDED)
        }).pipe(
          run,
          Effect.catchCause((cause) => said(`a turn's start was not followed: ${String(cause)}`)),
        )

      const post = yield* SessionPost
      yield* post.turns.pipe(
        Stream.runForEach((turn) =>
          (turn.on ? startedTurn(turn.sessionId) : settledTurn(turn.sessionId)).pipe(
            Effect.forkIn(scope),
          ),
        ),
        Effect.forkScoped,
      )

      if (settings.starts) {
        // Subscribed before anything else, so no Project added from now on is missed.
        const events = yield* DomainEvents.use((domain) => domain.subscribe)
        yield* events.pipe(
          Stream.filter((event) => event.type === 'project.created'),
          Stream.runForEach((event) =>
            bootstrap(event.entityId, null).pipe(
              Effect.catchCause((cause) =>
                said(`the bootstrap of ${event.entityId} did not start: ${String(cause)}`),
              ),
            ),
          ),
          Effect.forkScoped,
        )
      }

      const ours = (sessionId: string, projectId: string) =>
        Effect.map(
          getSession(sessionId).pipe(Effect.option),
          Option.exists(
            (session) =>
              session.role === 'living-spec' &&
              session.owner.kind === 'project' &&
              session.owner.projectId === projectId,
          ),
        )

      const changes = (projectId: string) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* getProject(projectId)
            const committed = yield* DomainEvents.use((events) => events.subscribe)
            const state = Effect.gen(function* () {
              const database = yield* Database
              const domains = yield* database.transaction((transaction) =>
                domainsIn(transaction, projectId),
              )
              return { domains, runs: yield* runs(projectId) }
            })
            const changed = Stream.merge(
              committed.pipe(
                Stream.filter(
                  (event) =>
                    (event.entityKind === 'project' && event.entityId === projectId) ||
                    (event.entityKind === 'session' &&
                      event.payload['role'] === 'living-spec' &&
                      event.payload['projectId'] === projectId),
                ),
              ),
              // A run waiting for its slot runs once its first turn starts.
              post.turns.pipe(
                Stream.filterEffect((turn) =>
                  turn.on ? ours(turn.sessionId, projectId) : Effect.succeed(false),
                ),
              ),
            )
            return Stream.concat(
              Stream.fromEffect(state),
              changed.pipe(Stream.mapEffect(() => state)),
            )
          }),
        ).pipe(Stream.provideContext(context))

      return { bootstrap, runs, changes }
    }),
  )
