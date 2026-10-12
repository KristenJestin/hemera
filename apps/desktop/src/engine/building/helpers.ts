/**
 * The helpers of a Building (#145): child sessions the Builder, or a helper at depth 1, launches
 * to hand them one piece of work; a free one on its parent's brief, or the Prototyper (CT-43).
 *
 * - **Launch.** `helper_launch` is refused at depth 2, above the Project's cap or the mission's
 *   launch budget (#41, never queued), or with a task neither available nor run by the caller.
 *   Otherwise the helper is recorded, its session opens through #40 (its id its lineage, so its
 *   brief and its tools read the row), and the caller is answered at once with its id. A helper
 *   tied to a task its parent runs becomes its runner at a new epoch, its claims with it; one tied
 *   to an available task starts it with `task_start`.
 * - **Result.** `helper_result` is read against the helper's shape; for the Prototyper, the files
 *   it names are copied into the mission's evidence. In one transaction the helper ends, its task
 *   goes back to its parent when it is not done, and its result is queued; then the queue hands it
 *   to the parent's lineage as `[hemera:result]`, marked delivered in the same transaction, so a
 *   quit loses none and none is delivered twice.
 * - **Health.** A helper silent in a turn is stuck (#40): its flag is set until its lineage speaks
 *   again, its parent told in its words; #40 replaces it with the same brief, and its task keeps
 *   its attempt. A turn that ends without a result is told once to end with one; a second fails
 *   it. A helper whose session failed for good fails, and its parent is told.
 * - **Start.** Queued results not yet delivered are delivered once. Cancel ends the running ones.
 *
 * There is no stop: neither the parent nor the user stops a helper.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import {
  DEFINED_HELPERS,
  FreeHelperResult,
  HELPER_DEPTH,
  type HelperDefinition,
  type PrototyperResult,
  STUCK_AFTER_MINUTES,
  definedHelperNamed,
  freeResultText,
  helperLabel,
  helperNumberOf,
  prototyperResultText,
} from '@hemera/core/domain'
import { formatSchemaError } from '@hemera/core/schema'
import { AgentAuthor } from '@hemera/ipc'
import { and, eq, isNull } from 'drizzle-orm'
import {
  Cause,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { AgentRuntime } from '../agents/runtime.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import type { NewEvent } from '../journal.ts'
import { putEvidence } from '../memory/evidence.ts'
import { missionFolder, missionKeyOf } from '../memory/files.ts'
import { Memory } from '../memory/index.ts'
import { ProfileHome } from '../profile-home.ts'
import { Secrets } from '../secrets.ts'
import { storeDeliveryIn } from '../sessions/deliveries.ts'
import { assignWorkIn } from '../sessions/leases.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { type RoleSession, getSession, sessionsOfLineage } from '../sessions/store.ts'
import { threadOf } from '../sessions/thread.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  buildingAttempts,
  buildingClaims,
  buildingTasks,
  helpers,
  queuedResults,
} from '../storage/schema.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { HelperDesk, type HelperWork } from './helper-desk.ts'
import {
  type HelperRow,
  PROTOTYPES_FOLDER,
  helperEvent,
  helperNameOf,
  helperOfLineage,
  helperRow,
  helperRowsOf,
  queuedResultIn,
  undeliveredResults,
  writeTools,
} from './helper-store.ts'
import { activeBuildingIn, tasksIn, workItemOf } from './tasks.ts'

export interface HelpersSettings {
  readonly log: Log
}

/** The roles a helper's session holds. */
const HELPER_ROLES: ReadonlyArray<string> = ['helper', 'prototyper']

/** How long a helper's turn may go on after its result before its session is ended. */
const RESULT_TURN_BOUND = Duration.minutes(2)

/** What a helper that ended a turn without its result is told, once. */
export const END_WITH_RESULT =
  'End with helper_result: your result is the only thing your parent receives. If what you need is held for approval and nothing else can be done, say so in your result.'

/** Why a helper that ended its turns twice without a result fails. */
const NO_RESULT = 'it ended its turns without helper_result'

const NO_MISSION = refusal('refused: this session works for no mission')
const NO_BUILDING = refusal('refused: the mission has no Building under way')

const readString = Schema.decodeUnknownOption(Schema.String)

/** What a refusal or a failure says, in words. */
const said = (cause: unknown): string =>
  cause instanceof Error && cause.message !== '' ? cause.message : String(cause)

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | Sessions
  | SessionPost
  | ProfileHome
  | AgentRuntime
  | AutomationGate
  | Memory
  | HelperDesk

export const helpersLayer = (settings: HelpersSettings) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const sessions = yield* Sessions
      const post = yield* SessionPost
      const { dataFolder } = yield* ProfileHome
      const scope = yield* Effect.scope
      const log = (line: string) => Effect.sync(() => settings.log(`helpers: ${line}`))
      /** Every change of a helper's row, one after the other: two launches never share a number. */
      const lock = yield* Semaphore.make(1)
      const locked = Semaphore.withPermits(lock, 1)
      /** The lineages of helpers stuck, until a session of theirs speaks again. */
      const stuck = new Set<string>()
      /** The lineages told once to end with their result. */
      const reminded = new Set<string>()

      const refusedEvent = (missionId: string, why: string) =>
        mutate('refusing a helper', () =>
          Effect.succeed({
            result: undefined,
            events: [
              {
                type: 'helper.refused',
                entityKind: 'mission',
                entityId: missionId,
                source: 'system' as const,
                author: 'hemera' as const,
                payload: { why },
              },
            ],
          }),
        )

      /** A launch refused, said in the Journal and to the caller. */
      const refused = (missionId: string, why: string) =>
        Effect.as(refusedEvent(missionId, why), refusal(`refused: ${why}`))

      // --- the task a helper runs ---------------------------------------------------------------

      /**
       * A task's runner, made another session's: the lease at a new epoch, the claims, the task's
       * runner and its open attempt. The session that held it keeps its token: it goes on working.
       */
      const runnerTo = (
        transaction: EngineTransaction,
        buildingId: string,
        taskId: string,
        session: RoleSession,
      ) =>
        Effect.gen(function* () {
          const lease = yield* assignWorkIn(transaction, workItemOf(buildingId, taskId), session)
          yield* transaction
            .update(buildingClaims)
            .set({ runner: session.lineage })
            .where(
              and(eq(buildingClaims.buildingId, buildingId), eq(buildingClaims.taskId, taskId)),
            )
            .pipe(Effect.mapError(refusedWhile('moving the claims')))
          yield* transaction
            .update(buildingTasks)
            .set({ runner: session.lineage, epoch: lease.result.lease.epoch })
            .where(and(eq(buildingTasks.buildingId, buildingId), eq(buildingTasks.id, taskId)))
            .pipe(Effect.mapError(refusedWhile('moving the runner')))
          yield* transaction
            .update(buildingAttempts)
            .set({ runner: session.lineage, epoch: lease.result.lease.epoch })
            .where(
              and(
                eq(buildingAttempts.buildingId, buildingId),
                eq(buildingAttempts.taskId, taskId),
                isNull(buildingAttempts.endedAt),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('moving the attempt')))
          return lease.events
        })

      /** The latest session of a lineage, live or not. */
      const latestOf = (lineage: string) =>
        Effect.map(sessionsOfLineage(lineage), (rows) =>
          rows.toSorted((a, b) => b.epoch - a.epoch).at(0),
        )

      /**
       * A helper that ends while its task is not done gives it back: the task's runner becomes its
       * parent again, so a later red reaches the parent (open question 25).
       */
      const giveBackIn = (transaction: EngineTransaction, row: HelperRow) =>
        Effect.gen(function* () {
          if (row.taskId === null) return []
          const building = yield* activeBuildingIn(transaction, row.missionId)
          if (building === null) return []
          const task = (yield* tasksIn(transaction, building.id)).find(
            (one) => one.id === row.taskId,
          )
          if (task === undefined || task.runner !== row.lineage) return []
          if (task.state === 'done' || task.state === 'skipped') return []
          const parent = yield* latestOf(row.parentLineage)
          if (parent === undefined) return []
          return yield* runnerTo(transaction, building.id, task.id, parent)
        })

      // --- the queue of results -----------------------------------------------------------------

      /** A helper's queued result handed to its parent's lineage, marked delivered with it. */
      const deliverQueued = (helperId: string) =>
        Effect.gen(function* () {
          const handed = yield* mutate('handing a result to its parent', (transaction) =>
            Effect.gen(function* () {
              const queued = yield* queuedResultIn(transaction, helperId)
              if (queued === null) return { result: false, events: [] }
              yield* storeDeliveryIn(transaction, {
                id: `result-${helperId}`,
                owner: { kind: 'mission', missionId: queued.missionId },
                target: { lineage: queued.parentLineage },
                kind: 'result',
                body: queued.body,
              })
              yield* transaction
                .update(queuedResults)
                .set({ deliveredAt: new Date().toISOString() })
                .where(eq(queuedResults.helperId, helperId))
                .pipe(Effect.mapError(refusedWhile('marking a result delivered')))
              return { result: true, events: [] }
            }),
          )
          if (handed) yield* post.ring
        })

      /** The row of a helper ended, its result queued and its task given back, in one transaction. */
      const endIn = (
        transaction: EngineTransaction,
        row: HelperRow,
        ended: {
          readonly state: 'done' | 'failed'
          readonly body: string
          readonly result: string | null
          readonly failure: string | null
          readonly events: ReadonlyArray<NewEvent>
        },
      ) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const at = new Date().toISOString()
          yield* transaction
            .update(helpers)
            .set({
              state: ended.state,
              stuck: false,
              result: ended.result === null ? null : secrets.mask(ended.result),
              failure: ended.failure === null ? null : secrets.mask(ended.failure),
              endedAt: at,
            })
            .where(eq(helpers.id, row.id))
            .pipe(Effect.mapError(refusedWhile('ending a helper')))
          yield* transaction
            .insert(queuedResults)
            .values({
              helperId: row.id,
              missionId: row.missionId,
              parentLineage: row.parentLineage,
              body: secrets.mask(ended.body),
              queuedAt: at,
              deliveredAt: null,
            })
            .onConflictDoNothing()
            .pipe(Effect.mapError(refusedWhile('queuing a result')))
          const given = yield* giveBackIn(transaction, row)
          return [...ended.events, ...given]
        })

      /** Fails a helper still running: its parent is told, its task given back, its session ended. */
      const fail = (helperId: string, why: string, endSession: boolean) =>
        Effect.gen(function* () {
          const failed = yield* locked(
            mutate('failing a helper', (transaction) =>
              Effect.gen(function* () {
                const row = yield* helperRow(helperId, transaction)
                if (row?.state !== 'running') return { result: null, events: [] }
                const label = helperLabel(row.number)
                const events = yield* endIn(transaction, row, {
                  state: 'failed',
                  body: `${label} (${helperNameOf(row)}) failed: ${why}${row.taskId === null ? '' : `\nIts task ${row.taskId} is yours again.`}`,
                  result: null,
                  failure: why,
                  events: [helperEvent('helper.failed', row, { why })],
                })
                return { result: row, events }
              }),
            ),
          )
          if (failed === null) return
          stuck.delete(failed.lineage)
          yield* deliverQueued(failed.id)
          if (endSession) yield* sessions.end(failed.lineage, `it failed: ${why}`)
        })

      // --- the tools ----------------------------------------------------------------------------

      const launch: HelperWork['launch'] = (grant, args) =>
        Effect.gen(function* () {
          const missionId = grant.missionId
          if (missionId === null) return NO_MISSION
          const database = yield* Database
          const building = yield* activeBuildingIn(database, missionId)
          if (building === null) return NO_BUILDING
          const caller = yield* getSession(grant.sessionId)
          const callerHelper = yield* helperOfLineage(caller.lineage)
          const depth = callerHelper === null ? 1 : callerHelper.depth + 1
          if (depth > HELPER_DEPTH) {
            return yield* refused(missionId, 'a helper of a helper cannot launch helpers')
          }
          let definition: HelperDefinition | null = null
          if (args.helper !== undefined) {
            definition = definedHelperNamed(args.helper)
            if (definition === null) {
              return yield* refused(
                missionId,
                `there is no defined helper ${args.helper}: the one that exists is ${DEFINED_HELPERS.map((one) => one.id).join(', ')}`,
              )
            }
            if (args.writes !== undefined || args.tools !== undefined) {
              return yield* refused(
                missionId,
                `writes and tools are a free helper's: ${definition.name} has its own`,
              )
            }
          }
          const chosen = args.tools ?? null
          const foreign = (chosen ?? []).filter((tool) => !grant.tools.some((one) => one === tool))
          if (foreign.length > 0) {
            return yield* refused(missionId, `${foreign.join(', ')} is not one of your tools`)
          }
          if (args.task !== undefined) {
            if (definition !== null && !definition.inputs.includes('task')) {
              return yield* refused(missionId, `${definition.name} is tied to no task`)
            }
            const task = (yield* tasksIn(database, building.id)).find((one) => one.id === args.task)
            if (task === undefined) {
              return yield* refused(missionId, `${args.task} is not a task of the plan`)
            }
            const yours = task.state === 'in_progress' && task.runner === caller.lineage
            if (task.state !== 'available' && !yours) {
              return yield* refused(
                missionId,
                `${task.id} is neither available nor in progress for you: it is ${task.state.replace('_', ' ')}`,
              )
            }
          }
          const tied = args.task ?? null
          // A free helper writes when it is told to, and when it carries a task to its end.
          const writes = definition?.writes ?? args.writes ?? tied !== null
          const role = definition === null ? 'helper' : 'prototyper'
          const secrets = yield* Secrets
          const launched = yield* locked(
            Effect.gen(function* () {
              const rows = yield* helperRowsOf(missionId)
              const number = Math.max(0, ...rows.map((one) => one.number)) + 1
              const prototype = definition?.place === 'prototype'
              const folder = prototype
                ? join(
                    missionFolder(dataFolder, yield* missionKeyOf(missionId)),
                    PROTOTYPES_FOLDER,
                    String(rows.filter((one) => one.place === 'prototype').length + 1),
                  )
                : caller.folder
              if (prototype) mkdirSync(folder, { recursive: true })
              const row: HelperRow = {
                id: crypto.randomUUID(),
                missionId,
                number,
                parentLineage: caller.lineage,
                lineage: crypto.randomUUID(),
                depth,
                definition: definition?.id ?? null,
                taskId: tied,
                writes,
                place: definition?.place ?? 'workspace',
                folder,
                tools: chosen === null ? null : writeTools(chosen),
                brief: secrets.mask(args.brief),
                state: 'running',
                stuck: false,
                result: null,
                failure: null,
                startedAt: new Date().toISOString(),
                endedAt: null,
              }
              // Written before its session opens: its brief and its tools are read from it.
              yield* mutate('recording a helper', (transaction) =>
                transaction
                  .insert(helpers)
                  .values(row)
                  .pipe(
                    Effect.mapError(refusedWhile('recording a helper')),
                    Effect.as({ result: undefined, events: [] }),
                  ),
              )
              const opened = yield* sessions
                .open({
                  id: row.lineage,
                  owner: { kind: 'mission', missionId },
                  role,
                  folder,
                  parent: caller,
                  requestedBy: 'agent',
                })
                .pipe(Effect.result)
              if (Result.isFailure(opened)) {
                yield* mutate('forgetting a refused helper', (transaction) =>
                  transaction
                    .delete(helpers)
                    .where(eq(helpers.id, row.id))
                    .pipe(
                      Effect.mapError(refusedWhile('forgetting a refused helper')),
                      Effect.as({ result: undefined, events: [] }),
                    ),
                )
                if (prototype) rmSync(folder, { recursive: true, force: true })
                const why = Predicate.isTagged(opened.failure, 'SessionRefused')
                  ? opened.failure.reason
                  : said(opened.failure)
                return { kind: 'refused', why } as const
              }
              const session = opened.success
              yield* mutate('saying a helper was launched', (transaction) =>
                Effect.gen(function* () {
                  const task =
                    tied === null
                      ? undefined
                      : (yield* tasksIn(transaction, building.id)).find((one) => one.id === tied)
                  // Tied to a task its parent runs: the helper becomes its runner, at a new epoch.
                  const moved =
                    task?.state === 'in_progress' && task.runner === caller.lineage
                      ? yield* runnerTo(transaction, building.id, task.id, session)
                      : []
                  return {
                    result: undefined,
                    events: [
                      helperEvent('helper.launched', row, {
                        name: helperNameOf(row),
                        task: tied,
                        depth,
                        parent: caller.lineage,
                      }),
                      ...moved,
                    ],
                  }
                }),
              )
              return { kind: 'launched', row } as const
            }),
          )
          if (launched.kind === 'refused') return yield* refused(missionId, launched.why)
          const label = helperLabel(launched.row.number)
          return answered(
            `${label} launched${tied === null ? '' : ` on ${tied}`}: it works in the background. Its result arrives as [hemera:result]; helper_read says where it stands. Keep working.`,
          )
        }).pipe(
          run,
          Effect.catchCause((cause) =>
            Effect.succeed(failure(`the call failed: ${Cause.pretty(cause).split('\n')[0] ?? ''}`)),
          ),
        )

      /** The last thing a helper's sessions said, or null. */
      const lastLineOf = (lineage: string) =>
        Effect.gen(function* () {
          const latest = yield* latestOf(lineage)
          if (latest === undefined) return null
          const lines = yield* threadOf(latest.id)
          const spoken = lines.findLast((line) => line.kind === 'said')
          return spoken === undefined ? null : (spoken.text.trim().split('\n').at(-1) ?? null)
        })

      const read: HelperWork['read'] = (grant, args) =>
        Effect.gen(function* () {
          if (grant.missionId === null) return NO_MISSION
          const caller = yield* getSession(grant.sessionId)
          const number = helperNumberOf(args.helper)
          const row =
            number === null
              ? undefined
              : (yield* helperRowsOf(grant.missionId)).find((one) => one.number === number)
          if (row === undefined || row.parentLineage !== caller.lineage) {
            return refusal(`refused: ${args.helper} is not one of your helpers`)
          }
          const label = helperLabel(row.number)
          const state = row.state === 'running' && row.stuck ? 'running, stuck' : row.state
          const last = yield* lastLineOf(row.lineage)
          return answered(
            [
              `${label} (${helperNameOf(row)}) is ${state}${row.taskId === null ? '' : `, on ${row.taskId}`}.`,
              last === null ? null : `Its last line: ${last}`,
              row.result === null ? null : `Its result:\n${row.result}`,
              row.failure === null ? null : `It failed: ${row.failure}`,
            ]
              .filter((line) => line !== null)
              .join('\n'),
          )
        }).pipe(
          run,
          Effect.catchCause((cause) =>
            Effect.succeed(failure(`the call failed: ${Cause.pretty(cause).split('\n')[0] ?? ''}`)),
          ),
        )

      /** The Prototyper's files copied into the mission's evidence, or the refusal naming one. */
      const keepFiles = (row: HelperRow, session: RoleSession, files: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const label = helperLabel(row.number)
          const kept: string[] = []
          for (const named of files) {
            const path = resolve(row.folder, named)
            const inside = relative(row.folder, path)
            if (inside === '' || inside.startsWith('..') || inside.split(sep).includes('..')) {
              return Result.fail(`${named} is not a file of your folder`)
            }
            if (!existsSync(path) || !statSync(path).isFile()) {
              return Result.fail(`${named} is not a file of your folder`)
            }
            const put = yield* putEvidence({
              missionId: row.missionId,
              content: { bytes: readFileSync(path) },
              name: `${label}/${inside.split(sep).join('/')}`,
              about: `helper ${label}`,
              author: AgentAuthor.make({ role: session.role, sessionId: session.id }),
            }).pipe(Effect.result)
            if (Result.isFailure(put)) {
              return Result.fail(
                `${named} could not be kept: ${Predicate.isTagged(put.failure, 'EvidenceRefused') ? put.failure.reason : said(put.failure)}`,
              )
            }
            kept.push(put.success.name)
          }
          return Result.succeed(kept)
        })

      const result: HelperWork['result'] = (grant, args) =>
        Effect.gen(function* () {
          const session = yield* getSession(grant.sessionId)
          const row = yield* helperOfLineage(session.lineage)
          if (row === null) return refusal('refused: only a helper hands back a result')
          if (row.state !== 'running') return refusal('refused: this helper has ended already')
          const label = helperLabel(row.number)
          const definition = row.definition === null ? null : definedHelperNamed(row.definition)
          const shape = definition?.result ?? FreeHelperResult
          const decoded = Schema.decodeUnknownResult(shape)(args)
          if (Result.isFailure(decoded)) {
            return refusal(
              `refused: the result does not read: ${formatSchemaError(decoded.failure)}`,
            )
          }
          let text: string
          let events: NewEvent[]
          if ('tried' in decoded.success) {
            const prototype: PrototyperResult = decoded.success
            const kept = yield* keepFiles(row, session, prototype.files)
            if (Result.isFailure(kept)) return refusal(`refused: ${kept.failure}`)
            text = prototyperResultText(prototype, kept.success.join(', '))
            events = [
              helperEvent('helper.ended', row, { summary: prototype.tried }),
              helperEvent('prototype.result', row, {
                works: [...prototype.works],
                doesNotWork: [...prototype.does_not_work],
                files: [...kept.success],
              }),
            ]
          } else {
            text = freeResultText(decoded.success)
            events = [helperEvent('helper.ended', row, { summary: decoded.success.summary })]
          }
          const body = `${label} (${helperNameOf(row)}) handed back its result${row.taskId === null ? '' : ` on ${row.taskId}`}. Read it before you rely on it: a helper's word is not a verification.\n${text}`
          const ended = yield* locked(
            mutate('ending a helper', (transaction) =>
              Effect.gen(function* () {
                const now = yield* helperRow(row.id, transaction)
                if (now?.state !== 'running') return { result: false, events: [] }
                const written = yield* endIn(transaction, now, {
                  state: 'done',
                  body,
                  result: text,
                  failure: null,
                  events,
                })
                return { result: true, events: written }
              }),
            ),
          )
          if (!ended) return refusal('refused: this helper has ended already')
          stuck.delete(row.lineage)
          yield* deliverQueued(row.id)
          // Its turn is left to end, so the agent hears its result kept; then its session ends.
          yield* sessions.settled(session.id).pipe(
            Effect.timeoutOption(RESULT_TURN_BOUND),
            Effect.ignore,
            Effect.andThen(sessions.end(row.lineage, 'it handed back its result')),
            Effect.catchCause((cause) => log(`${label} was not ended: ${String(cause)}`)),
            run,
            Effect.forkIn(scope),
          )
          return answered('Your result is kept and handed to your parent. End your turn now.')
        }).pipe(
          run,
          Effect.catchCause((cause) =>
            Effect.succeed(failure(`the call failed: ${Cause.pretty(cause).split('\n')[0] ?? ''}`)),
          ),
        )

      yield* HelperDesk.use((desk) => desk.serve({ launch, read, result }))

      // --- what follows the helpers -------------------------------------------------------------

      /** A helper's session stuck (#40): its flag, its parent told in its words. */
      const stuckSession = (lineage: string) =>
        Effect.gen(function* () {
          const row = yield* helperOfLineage(lineage)
          if (row?.state !== 'running') return
          stuck.add(lineage)
          const label = helperLabel(row.number)
          yield* mutate('saying a helper is stuck', (transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .update(helpers)
                .set({ stuck: true })
                .where(eq(helpers.id, row.id))
                .pipe(Effect.mapError(refusedWhile('saying a helper is stuck')))
              yield* storeDeliveryIn(transaction, {
                owner: { kind: 'mission', missionId: row.missionId },
                target: { lineage: row.parentLineage },
                kind: 'child',
                body: `${label} has been silent for ${String(STUCK_AFTER_MINUTES)} minutes: Hemera replaces it with a fresh session, same brief.`,
              })
              return { result: undefined, events: [helperEvent('helper.stuck', row)] }
            }),
          )
          yield* post.ring
        })

      /** A helper's session that speaks again is no longer stuck. */
      const lineages = new Map<string, string>()
      const spoke = (sessionId: string) =>
        Effect.gen(function* () {
          if (stuck.size === 0) return
          const lineage = lineages.get(sessionId) ?? (yield* getSession(sessionId)).lineage
          lineages.set(sessionId, lineage)
          if (!stuck.has(lineage)) return
          stuck.delete(lineage)
          const row = yield* helperOfLineage(lineage)
          if (row === null) return
          yield* mutate('saying a helper speaks again', (transaction) =>
            transaction
              .update(helpers)
              .set({ stuck: false })
              .where(eq(helpers.id, row.id))
              .pipe(
                Effect.mapError(refusedWhile('saying a helper speaks again')),
                Effect.as({ result: undefined, events: [helperEvent('helper.unstuck', row)] }),
              ),
          )
        })

      /** A helper's session replaced (#40): said in the Journal and to its parent. */
      const replacedSession = (lineage: string, reason: string) =>
        Effect.gen(function* () {
          const row = yield* helperOfLineage(lineage)
          if (row?.state !== 'running') return
          yield* mutate('saying a helper was replaced', (transaction) =>
            Effect.gen(function* () {
              yield* storeDeliveryIn(transaction, {
                owner: { kind: 'mission', missionId: row.missionId },
                target: { lineage: row.parentLineage },
                kind: 'child',
                body: `${helperLabel(row.number)} was replaced by a fresh session (${reason}): it goes on with the same brief.`,
              })
              return {
                result: undefined,
                events: [helperEvent('helper.replaced', row, { reason })],
              }
            }),
          )
          yield* post.ring
        })

      /** A helper's session stopped as failed, with no successor: the helper fails. */
      const stoppedSession = (lineage: string, reason: string) =>
        Effect.gen(function* () {
          const row = yield* helperOfLineage(lineage)
          if (row?.state !== 'running') return
          const live = (yield* sessionsOfLineage(lineage)).some((one) =>
            ['starting', 'working', 'idle', 'stuck'].includes(one.state),
          )
          if (live) return
          yield* fail(row.id, reason, false)
        })

      /** A turn of a helper that ended without its result: told once, then failed. */
      const silentEnd = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* getSession(sessionId)
          if (!HELPER_ROLES.includes(session.role)) return
          const row = yield* helperOfLineage(session.lineage)
          if (row?.state !== 'running') return
          yield* sessions.settled(sessionId)
          if ((yield* getSession(sessionId)).state !== 'idle') return
          if ((yield* helperRow(row.id))?.state !== 'running') return
          if (!reminded.has(row.lineage)) {
            reminded.add(row.lineage)
            yield* sessions.deliver({
              owner: session.owner,
              target: { lineage: row.lineage },
              kind: 'reminder',
              body: END_WITH_RESULT,
            })
            return
          }
          yield* fail(row.id, NO_RESULT, true)
        })

      /** A mission cancelled: its helpers end with its tree, as failed. */
      const cancelled = (missionId: string) =>
        Effect.gen(function* () {
          for (const row of yield* helperRowsOf(missionId)) {
            if (row.state !== 'running') continue
            const secrets = yield* Secrets
            yield* mutate('ending a helper with its mission', (transaction) =>
              transaction
                .update(helpers)
                .set({
                  state: 'failed',
                  stuck: false,
                  failure: secrets.mask('the mission was cancelled'),
                  endedAt: new Date().toISOString(),
                })
                .where(and(eq(helpers.id, row.id), eq(helpers.state, 'running')))
                .pipe(
                  Effect.mapError(refusedWhile('ending a helper with its mission')),
                  Effect.as({
                    result: undefined,
                    events: [
                      helperEvent('helper.failed', row, { why: 'the mission was cancelled' }),
                    ],
                  }),
                ),
            )
          }
        })

      const isHelperEvent = (payload: NewEvent['payload']) =>
        payload !== undefined && HELPER_ROLES.includes(String(payload['role']))

      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      yield* events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const payload = event.payload ?? {}
            const lineage = Option.getOrNull(readString(payload['lineage']))
            if (event.type === 'mission.cancelled') return yield* locked(cancelled(event.entityId))
            if (lineage === null || !isHelperEvent(payload)) return
            if (event.type === 'session.stuck') yield* stuckSession(lineage)
            if (event.type === 'session.replaced') {
              yield* replacedSession(
                lineage,
                Option.getOrElse(readString(payload['reason']), () => ''),
              )
            }
            if (event.type === 'session.stopped' && payload['state'] === 'failed') {
              yield* stoppedSession(
                lineage,
                Option.getOrElse(readString(payload['reason']), () => 'its session failed'),
              )
            }
          }).pipe(
            run,
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : log(`an event was not followed: ${String(cause)}`),
            ),
          ),
        ),
        Effect.forkScoped,
      )
      yield* post.turns.pipe(
        Stream.filter((turn) => !turn.on),
        Stream.runForEach((turn) =>
          silentEnd(turn.sessionId).pipe(
            run,
            Effect.catchCause((cause) => log(`a turn's end was not followed: ${String(cause)}`)),
            Effect.forkIn(scope),
          ),
        ),
        Effect.forkScoped,
      )
      const runtime = yield* AgentRuntime
      yield* runtime.activity.pipe(
        Stream.filter(({ event }) => !event.replay),
        Stream.runForEach(({ sessionId }) =>
          spoke(sessionId).pipe(
            run,
            Effect.catchCause((cause) => log(`a sign of life was not read: ${String(cause)}`)),
          ),
        ),
        Effect.forkScoped,
      )

      // At every start, once automations may run: the results a stopped engine queued, delivered.
      const gate = yield* AutomationGate
      const memory = yield* Memory
      yield* gate.pass.pipe(
        Effect.andThen(memory.ready),
        Effect.andThen(
          Effect.gen(function* () {
            for (const queued of yield* undeliveredResults) yield* deliverQueued(queued.helperId)
          }).pipe(run),
        ),
        Effect.catchCause((cause) =>
          log(`the queued results were not delivered: ${String(cause)}`),
        ),
        Effect.forkScoped,
      )
    }),
  )
