/**
 * Permission requests: the single human question a call that asks becomes, which never blocks the
 * agent (#33's `PermissionRequests` port).
 *
 * When the order of decision answers "ask", the request is stored with its permission need, in one
 * transaction: the whole call (tool, arguments, the place it was called on), the identity of the
 * action and the guard state the verdict saw, Hemera's reasons and the agent's, and its owner: the
 * mission and its task, or the Project for the Chat. Requests are numbered per owner. The agent is
 * answered at once that the call waits for the user and has not happened; the same call key from
 * the same owner is the same request, one row and one need. A pending request survives a restart,
 * and nothing runs until the user answers.
 *
 * The answer reaches this service through the needs' outbox, in its own transaction: Deny ends the
 * request, Allow once marks it allowed, Allow for this mission writes the grant first. Then Hemera
 * acts itself (`Approvals.settle`), never inside a transaction: what the request froze is checked
 * again (CT-10: the role's guards, the "never" list, the resolution of the paths, the mission's
 * stage, the task, the place, the fingerprint of the file it writes, the identity of what it runs),
 * and only then is the call run through the gate's executor. Whatever no longer holds expires the
 * need ("the situation changed since you allowed it") and nothing runs.
 *
 * Every result is a `permission.result` event of the owner (the Memory shows it, so a replacement
 * session reads it there) and is handed to the `Delivery` port exactly once, keyed by the request.
 * A request whose need expired (a cancelled mission, a restore) ends "not executed" with its reason.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ActionIdentity,
  type Masked,
  MissionOwner,
  PERMISSION_POLICY,
  PermissionFields,
  type PlaceContext,
  ProjectOwner,
  type RequestResult,
  Role,
  SITUATION_CHANGED,
  TOOL_NAMES,
  maskText,
  placesNamed,
  resultText,
  waitingText,
  wordsOf,
} from '@hemera/core/domain'
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Predicate, Schema, Semaphore, Stream } from 'effect'
import type { Scope } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import type { EventPayload, NewEvent } from '../journal.ts'
import { type NeedHandler, createNeedIn, expireNeedIn, needService } from '../needs.ts'
import { ReconciliationFailed, type ReconciliationStep } from '../reconciliation.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { missions, needs, permissionRequests, workspaces } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { ToolGate } from '../tools/gate.ts'
import { resolvePath, shownPath } from '../tools/paths.ts'
import {
  type FrozenCall,
  type JudgedCall,
  PermissionRequests,
  type RequestAsked,
} from '../tools/ports.ts'
import { fingerprintFile } from '../tools/read.ts'
import { Delivery } from './delivery.ts'
import { grantWritten } from './grants.ts'
import { callIdentity } from './identity.ts'
import { userName } from './order.ts'

/** The engine service permission requests' needs belong to. */
export const PERMISSION_REQUESTS = needService('permission-requests')

/** What the user reads on a need whose approval no longer holds. */
export const CHANGED_SINCE_ALLOWED = 'the situation changed since you allowed it'

/** Why the requests of a restored Profile expire: a human answer does not apply to a changed world. */
export const RESTORED = 'restored from a backup'

/** What a request left running by an engine that stopped ends with. */
const STOPPED_WHILE_ACTING =
  'Hemera stopped while it was doing it, and cannot tell whether it took effect: check before asking again'

/**
 * Whether the task a request belongs to still holds: not ended, not replaced. Tasks come with the
 * build (#40 and later); until then every request holds.
 */
export class TaskStates extends Context.Service<
  TaskStates,
  { readonly holds: (missionId: string, taskId: string | null) => Effect.Effect<boolean> }
>()('TaskStates') {}

export const everyTaskHolds = Layer.succeed(TaskStates, { holds: () => Effect.succeed(true) })

export interface RequestsSettings {
  readonly log: Log
  /** What `~` stands for. */
  readonly home: string
  readonly platform: NodeJS.Platform
}

const PlaceKind = Schema.Literals(['main-checkout', 'own-worktree', 'workspace'])

/** A frozen call as it is stored. */
const StoredCall = Schema.Struct({
  grant: Schema.Struct({
    sessionId: Schema.String,
    epoch: Schema.Number,
    role: Role,
    tools: Schema.Array(Schema.Literals(TOOL_NAMES)),
    place: Schema.Struct({ kind: PlaceKind, readOnly: Schema.Boolean, root: Schema.String }),
    projectId: Schema.String,
    missionId: Schema.NullOr(Schema.String),
    workspaceId: Schema.NullOr(Schema.String),
    mainCheckout: Schema.Boolean,
  }),
  tool: Schema.Literals(TOOL_NAMES),
  arguments: Schema.Json,
})
const readCall = Schema.decodeUnknownOption(Schema.fromJsonString(StoredCall))
const readIdentity = Schema.decodeUnknownOption(Schema.fromJsonString(ActionIdentity))

type RequestRow = typeof permissionRequests.$inferSelect

const now = (): string => new Date().toISOString()

/** The entity a request's events belong to: its mission, or its Project. */
const ownerEntity = (row: Pick<RequestRow, 'ownerKind' | 'ownerId'>) => ({
  entityKind: row.ownerKind,
  entityId: row.ownerId,
})

/** What a request is shown as: the command with its line, or the tool and its path. */
const described = (call: JudgedCall, home: string): string => {
  if (call.command !== null) return `${call.command.name}: ${call.command.line}`
  if (call.line !== null) {
    return call.folder === null || call.folder === '.'
      ? call.line
      : `${call.line} (in ${call.folder})`
  }
  return call.path === null ? call.tool : `${call.tool} ${shownPath(call.path.resolved, home)}`
}

/**
 * What the verdict saw, as it can be computed again before acting: the identity of the action,
 * where its path leads, the fingerprint of the file it writes, where the paths of its line lead,
 * the mission's stage, and whether the place is still there. Two equal states are equal strings.
 */
const guardOf = (call: JudgedCall, frozen: FrozenCall, settings: RequestsSettings) =>
  Effect.gen(function* () {
    const database = yield* Database
    const root = call.session.place.root
    const identity = yield* Effect.promise(() => callIdentity(call, settings.platform))
    const writes = call.tool === 'fs_write' || call.tool === 'fs_edit'
    const written =
      writes && call.path !== null
        ? yield* Effect.promise(() => fingerprintFile(call.path?.resolved ?? '').catch(() => null))
        : null
    const places: string[] = []
    if (call.tool === 'commands_run' && call.command === null) {
      const context: PlaceContext = {
        home: settings.home,
        user: userName(),
        platform: settings.platform,
      }
      const folder = resolve(root, call.folder ?? '.')
      const named = placesNamed(wordsOf(call.line ?? ''), context)
      for (const path of named.paths) {
        const led = yield* Effect.promise(() => resolvePath(root, folder, path, settings.home))
        places.push(led.path)
      }
    }
    let stage: string | null = null
    if (call.session.missionId !== null) {
      const [mission] = yield* database
        .select({ stage: missions.stage })
        .from(missions)
        .where(eq(missions.id, call.session.missionId))
        .pipe(Effect.mapError(refusedWhile('reading the mission')))
      stage = mission?.stage ?? null
    }
    let place = existsSync(root)
    if (frozen.grant.workspaceId !== null) {
      const [workspace] = yield* database
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, frozen.grant.workspaceId))
        .pipe(Effect.mapError(refusedWhile('reading the Workspace')))
      place = place && workspace !== undefined
    }
    const target =
      call.path === null
        ? null
        : { resolved: call.path.resolved, inside: call.path.inside, certain: call.path.certain }
    return {
      identity,
      guard: JSON.stringify({ identity, target, written, places, stage, place }),
    }
  })

/** The decision of the user, as the order records its own. */
const decidedByUser = (row: RequestRow, choice: string): NewEvent => ({
  type: 'permission.decided',
  ...ownerEntity(row),
  source: 'ui',
  author: 'human',
  payload: {
    requestId: row.id,
    number: row.number,
    sessionId: row.sessionId,
    role: row.role,
    tool: row.tool,
    target: row.described,
    verdict: choice === 'deny' ? 'deny' : 'allow',
    by: 'user',
    choice,
    grantId: row.grantId,
    policyVersion: PERMISSION_POLICY.policyVersion,
    level: PERMISSION_POLICY.level,
  },
})

/** Ends a request with its result, inside a transaction; answers the events. */
const endedWith = (
  transaction: EngineTransaction,
  row: RequestRow,
  from: ReadonlyArray<string>,
  result: RequestResult,
  text: Masked<string>,
) =>
  Effect.gen(function* () {
    const said = maskText(resultText({ number: row.number, tool: row.tool, result, text }), [])
    const written = yield* transaction
      .update(permissionRequests)
      .set({ state: 'ended', result, resultText: said, endedAt: now() })
      .where(and(eq(permissionRequests.id, row.id), inArray(permissionRequests.state, [...from])))
      .returning({ id: permissionRequests.id })
      .pipe(Effect.mapError(refusedWhile('ending a request')))
    if (written.length === 0) return []
    const payload: EventPayload = {
      requestId: row.id,
      number: row.number,
      tool: row.tool,
      taskId: row.taskId,
      sessionId: row.sessionId,
      result,
      text: said,
    }
    return [
      {
        type: 'permission.result',
        ...ownerEntity(row),
        source: 'system',
        author: 'hemera',
        payload,
      } satisfies NewEvent,
    ]
  })

/**
 * Where the answers of permission needs go: Deny ends the request, an Allow marks it allowed (and
 * Allow for this mission writes its grant), in the transaction that marks the answer delivered. An
 * answer to a request that no longer exists or is no longer pending changes nothing.
 */
export const requestsHandler: NeedHandler = {
  deliver: (need, transaction) =>
    Effect.gen(function* () {
      const [row] = yield* transaction
        .select()
        .from(permissionRequests)
        .where(eq(permissionRequests.needId, need.id))
        .pipe(Effect.mapError(refusedWhile('reading a request')))
      if (row === undefined || row.state !== 'pending') return []
      const choice =
        need.answer !== null && Predicate.isTagged(need.answer, 'Permission')
          ? need.answer.choice
          : 'deny'
      if (choice === 'deny') {
        const ended = yield* endedWith(transaction, row, ['pending'], 'refused', maskText('', []))
        return [decidedByUser(row, choice), ...ended]
      }
      const events: NewEvent[] = []
      let grantId: string | null = null
      if (choice === 'allow-for-mission' && row.missionId !== null && !row.sensitive) {
        const identity = readIdentity(row.identity)
        if (Option.isSome(identity)) {
          const granted = yield* grantWritten(transaction, {
            missionId: row.missionId,
            identity: identity.value,
            action: row.described,
            requestId: row.id,
          })
          grantId = granted.id
          events.push(...granted.events)
        }
      }
      const written = yield* transaction
        .update(permissionRequests)
        .set({ state: 'allowed', choice, grantId, answeredAt: now() })
        .where(and(eq(permissionRequests.id, row.id), eq(permissionRequests.state, 'pending')))
        .returning({ id: permissionRequests.id })
        .pipe(Effect.mapError(refusedWhile('answering a request')))
      if (written.length === 0) return []
      return [decidedByUser({ ...row, grantId }, choice), ...events]
    }),
}

/** The question a call that asks becomes: stored with its need, answered to the agent at once. */
export const permissionRequestsLayer = (settings: RequestsSettings) =>
  Layer.effect(
    PermissionRequests,
    Effect.gen(function* () {
      const context = yield* Effect.context<Database | DomainEvents | Secrets>()
      const request = (asked: RequestAsked) =>
        Effect.gen(function* () {
          const { call, frozen } = asked
          const secrets = yield* Secrets
          const missionId = call.session.missionId
          const projectId = call.session.projectId
          const owner =
            missionId === null
              ? { kind: 'project', id: projectId }
              : { kind: 'mission', id: missionId }
          const { identity, guard } = yield* guardOf(call, frozen, settings)
          const shown = secrets.mask(described(call, settings.home))
          const why = call.why?.trim() ?? ''
          const agentReason = secrets.mask(why === '' ? 'no reason given' : why)
          const hemeraReason = secrets.mask(asked.reason)
          const { sensitive } = asked
          const writeNeed = yield* createNeedIn(
            PERMISSION_REQUESTS,
            missionId === null
              ? ProjectOwner.make({ projectId })
              : MissionOwner.make({ projectId, missionId, taskId: null }),
            asked.settingsSection === null
              ? PermissionFields.make({ call: shown, agentReason, hemeraReason, sensitive })
              : PermissionFields.make({
                  call: shown,
                  agentReason,
                  hemeraReason,
                  sensitive,
                  settingsSection: asked.settingsSection,
                }),
          )
          const row = yield* mutate('asking the user', (transaction) =>
            Effect.gen(function* () {
              const sameOwner = and(
                eq(permissionRequests.ownerKind, owner.kind),
                eq(permissionRequests.ownerId, owner.id),
              )
              if (asked.key !== null) {
                const [earlier] = yield* transaction
                  .select()
                  .from(permissionRequests)
                  .where(and(sameOwner, eq(permissionRequests.callKey, asked.key)))
                  .pipe(Effect.mapError(refusedWhile('reading the requests')))
                if (earlier !== undefined) return { result: earlier, events: [] }
              }
              const [last] = yield* transaction
                .select({ number: max(permissionRequests.number) })
                .from(permissionRequests)
                .where(sameOwner)
                .pipe(Effect.mapError(refusedWhile('numbering a request')))
              const need = yield* writeNeed(transaction)
              const [written] = yield* transaction
                .insert(permissionRequests)
                .values({
                  id: crypto.randomUUID(),
                  ownerKind: owner.kind,
                  ownerId: owner.id,
                  projectId,
                  missionId,
                  taskId: null,
                  number: (last?.number ?? 0) + 1,
                  callKey: asked.key,
                  sessionId: call.session.sessionId,
                  role: call.session.role,
                  tool: call.tool,
                  call: JSON.stringify(frozen),
                  guard,
                  identity: JSON.stringify(identity),
                  described: shown,
                  hemeraReason,
                  agentReason,
                  sensitive: asked.sensitive,
                  needId: need.id,
                  state: 'pending',
                  choice: null,
                  grantId: null,
                  result: null,
                  resultText: null,
                  createdAt: now(),
                  answeredAt: null,
                  endedAt: null,
                  handedOverAt: null,
                })
                .returning()
                .pipe(Effect.mapError(refusedWhile('writing a request')))
              if (written === undefined) {
                return yield* Effect.die(new Error('a request was not written'))
              }
              return { result: written, events: need.events }
            }),
          )
          const answer =
            row.state === 'ended' && row.resultText !== null
              ? row.resultText
              : waitingText(row.number)
          return { answer }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              settings.log(`permissions: a request could not be made: ${String(cause)}`)
              return {
                answer:
                  'refused: the request for the user could not be made, so nothing was done; say so and go on with what does not depend on it',
              }
            }),
          ),
          Effect.provide(context),
        )
      return { request }
    }),
  )

/** Acting on the requests the user answered, and handing their results over. */
export class Approvals extends Context.Service<
  Approvals,
  {
    /** One round: expired requests ended, allowed ones acted on, results handed over. */
    readonly settle: Effect.Effect<void>
    /** A round now, then one after every answer and every need that ends; for as long as it runs. */
    readonly watch: Effect.Effect<never, never, Scope.Scope>
  }
>()('Approvals') {}

/** The events after which a round may have something to do. */
const wakes = (event: { readonly type: string; readonly payload: EventPayload }): boolean =>
  event.type === 'need.expired' ||
  event.type === 'need.withdrawn' ||
  (event.type === 'permission.decided' && event.payload['by'] === 'user')

export const approvalsLayer = (settings: RequestsSettings) =>
  Layer.effect(
    Approvals,
    Effect.gen(function* () {
      const context = yield* Effect.context<
        Database | DomainEvents | Secrets | ToolGate | Delivery | TaskStates
      >()
      const settling = Semaphore.makeUnsafe(1)
      const { log } = settings

      const rowsIn = (states: ReadonlyArray<string>) =>
        Effect.flatMap(Database, (database) =>
          database
            .select()
            .from(permissionRequests)
            .where(inArray(permissionRequests.state, [...states]))
            .orderBy(asc(permissionRequests.createdAt), asc(sql`rowid`))
            .pipe(Effect.mapError(refusedWhile('reading the requests'))),
        )

      /** Pending requests whose need ended without an answer end "not executed", with its reason. */
      const endExpired = Effect.gen(function* () {
        const database = yield* Database
        const ended = yield* database
          .select({ request: permissionRequests, need: needs })
          .from(permissionRequests)
          .innerJoin(needs, eq(needs.id, permissionRequests.needId))
          .where(
            and(
              eq(permissionRequests.state, 'pending'),
              inArray(needs.state, ['expired', 'withdrawn']),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('reading the requests')))
        for (const { request, need } of ended) {
          const reason = maskText(need.endedReason ?? 'it no longer holds', [])
          yield* mutate('ending a request', (transaction) =>
            Effect.map(
              endedWith(transaction, request, ['pending'], 'not-executed', reason),
              (events) => ({ result: undefined, events }),
            ),
          )
        }
      })

      /** What an engine that stopped left acting has an end, never a second run. */
      const endLeftRunning = Effect.gen(function* () {
        for (const row of yield* rowsIn(['running'])) {
          yield* mutate('ending a request', (transaction) =>
            Effect.map(
              endedWith(
                transaction,
                row,
                ['running'],
                'failed',
                maskText(STOPPED_WHILE_ACTING, []),
              ),
              (events) => ({ result: undefined, events }),
            ),
          )
        }
      })

      /** Acts on one allowed request: checked again, then run through the gate's executor. */
      const act = (row: RequestRow) =>
        Effect.gen(function* () {
          const claimed = yield* mutate('acting on a request', (transaction) =>
            transaction
              .update(permissionRequests)
              .set({ state: 'running' })
              .where(
                and(eq(permissionRequests.id, row.id), eq(permissionRequests.state, 'allowed')),
              )
              .returning({ id: permissionRequests.id })
              .pipe(
                Effect.mapError(refusedWhile('acting on a request')),
                Effect.map((written) => ({ result: written.length > 0, events: [] })),
              ),
          )
          if (!claimed) return
          const secrets = yield* Secrets
          const frozen = readCall(row.call)
          const gate = yield* ToolGate
          const holds = (call: JudgedCall) =>
            Effect.gen(function* () {
              if (Option.isNone(frozen)) return 'the call could not be read'
              if (row.missionId !== null) {
                const task = yield* TaskStates.use((tasks) =>
                  tasks.holds(row.missionId ?? '', row.taskId),
                )
                if (!task) return 'its task ended'
              }
              const { guard } = yield* guardOf(call, frozen.value, settings)
              return guard === row.guard ? null : 'what it acts on changed'
            }).pipe(
              Effect.provide(context),
              Effect.catchCause(() => Effect.succeed('it could not be checked again')),
            )
          const performed = Option.isNone(frozen)
            ? ({ kind: 'changed', reason: 'the call could not be read' } as const)
            : yield* gate.perform(frozen.value, holds)
          if (performed.kind === 'changed') {
            log(`permissions: request #${String(row.number)} was not executed: ${performed.reason}`)
          }
          yield* mutate('recording what a request did', (transaction) =>
            Effect.gen(function* () {
              if (performed.kind === 'changed') {
                const events = yield* endedWith(
                  transaction,
                  row,
                  ['running'],
                  'not-executed',
                  maskText(SITUATION_CHANGED, []),
                )
                const expired = yield* expireNeedIn(transaction, row.needId, CHANGED_SINCE_ALLOWED)
                return { result: undefined, events: [...events, ...expired] }
              }
              const { answer } = performed
              const events = yield* endedWith(
                transaction,
                row,
                ['running'],
                answer.ok ? 'done' : 'failed',
                secrets.mask(answer.text),
              )
              return { result: undefined, events }
            }),
          )
        })

      /** Hands every result not handed over yet to the delivery; one that fails waits. */
      const handOver = Effect.gen(function* () {
        const database = yield* Database
        const delivery = yield* Delivery
        const waiting = yield* database
          .select()
          .from(permissionRequests)
          .where(
            and(eq(permissionRequests.state, 'ended'), isNull(permissionRequests.handedOverAt)),
          )
          .orderBy(asc(permissionRequests.endedAt))
          .pipe(Effect.mapError(refusedWhile('reading the results')))
        for (const row of waiting) {
          const handed = yield* delivery
            .deliver({
              requestId: row.id,
              number: row.number,
              owner:
                row.missionId === null
                  ? { kind: 'project', projectId: row.projectId }
                  : { kind: 'mission', missionId: row.missionId, taskId: row.taskId },
              sessionId: row.sessionId,
              text: row.resultText ?? maskText('', []),
            })
            .pipe(
              Effect.as(true),
              Effect.catchCause((cause) =>
                Effect.sync(() => {
                  log(
                    `permissions: the result of request #${String(row.number)} was not handed over: ${String(cause)}`,
                  )
                  return false
                }),
              ),
            )
          if (!handed) continue
          yield* database
            .update(permissionRequests)
            .set({ handedOverAt: now() })
            .where(eq(permissionRequests.id, row.id))
            .pipe(Effect.mapError(refusedWhile('recording a hand-over')))
        }
      })

      const settle = Effect.gen(function* () {
        yield* endExpired
        yield* endLeftRunning
        for (const row of yield* rowsIn(['allowed'])) yield* act(row)
        yield* handOver
      }).pipe(
        Semaphore.withPermits(settling, 1),
        Effect.catchCause((cause) =>
          Effect.sync(() => log(`permissions: the requests were not settled: ${String(cause)}`)),
        ),
        Effect.provide(context),
      )

      const watch = Effect.gen(function* () {
        const events = yield* DomainEvents.use((followed) => followed.subscribe)
        yield* settle
        yield* events.pipe(
          Stream.filter(wakes),
          Stream.runForEach(() => settle),
        )
        return yield* Effect.never
      }).pipe(Effect.provide(context))

      return { settle, watch }
    }),
  )

/** What a restore's reconciliation reads of the requests: some still open, or none. */
const openRequests = Effect.flatMap(Database, (database) =>
  database
    .select()
    .from(permissionRequests)
    .where(inArray(permissionRequests.state, ['pending', 'allowed', 'running']))
    .pipe(Effect.mapError(refusedWhile('reading the requests'))),
)

const failedStep = (failure: { readonly message: string }) =>
  new ReconciliationFailed({ reason: failure.message })

/**
 * The reconciliation step of a restored Profile: every request still open expires "restored from
 * a backup", and its need with it. Nothing runs. Grants are kept, and checked at each use.
 */
export const RESTORED_REQUESTS: ReconciliationStep = {
  name: 'permission requests',
  per: 'profile',
  states: ['open', 'expired'],
  recorded: () =>
    openRequests.pipe(
      Effect.map((rows) => (rows.length === 0 ? 'expired' : 'open')),
      Effect.mapError(failedStep),
    ),
  observed: () => Effect.succeed('expired'),
  advance: () =>
    Effect.gen(function* () {
      for (const row of yield* openRequests) {
        yield* mutate('expiring a restored request', (transaction) =>
          Effect.gen(function* () {
            const ended = yield* endedWith(
              transaction,
              row,
              ['pending', 'allowed', 'running'],
              'not-executed',
              maskText(RESTORED, []),
            )
            const expired = yield* expireNeedIn(transaction, row.needId, RESTORED)
            return { result: undefined, events: [...ended, ...expired] }
          }),
        )
      }
    }).pipe(Effect.mapError(failedStep)),
}
