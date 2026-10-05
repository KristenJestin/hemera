/**
 * The intent and the outcome of every action with an effect outside the database.
 *
 * An idempotency key prevents a double write in the database, not a double execution in the
 * world. So every action that has an effect outside it (a file written, a command run, and later a
 * push, a forge call, a step of a delivery) first writes its intent, committed before the effect
 * starts (`started`), then its outcome (`done` or `failed`).
 *
 * At the engine's start, an intent without an outcome is perhaps done: it becomes `indeterminate`,
 * and the post-condition its kind registered, when it has one, says what the world shows (`done`,
 * `failed`, or still `indeterminate`). An action without a post-condition is never run again on
 * its own: the handler its kind registered for indeterminate actions is called once, and only once
 * the reconciliation of a restore is over; until a handler is registered, it stays recorded as
 * indeterminate and nothing is done with it.
 */

import { type Masked, maskText, maskedJson } from '@hemera/core/domain'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import type { DomainEvents } from '../domain-events.ts'
import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { effectfulActions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { fingerprintFile } from './read.ts'

/** Whom an action is done for: a mission (and optionally one of its tasks), or a Project. */
export type ActionOwner =
  | { readonly kind: 'mission'; readonly missionId: string; readonly taskId: string | null }
  | { readonly kind: 'project'; readonly projectId: string }

export type ActionState = 'started' | 'done' | 'failed' | 'indeterminate'

/** An action as it is recorded. */
export interface EffectfulAction {
  readonly id: string
  readonly kind: string
  readonly owner: ActionOwner
  readonly details: Schema.Json
  readonly state: ActionState
  readonly outcome: string | null
}

/** What a post-condition finds of an action whose outcome was lost. */
export type FoundOutcome = 'done' | 'failed' | 'indeterminate'

/** How a kind of action is checked against the world, from what its intent recorded. */
export type PostCondition = (details: Schema.Json) => Effect.Effect<FoundOutcome>

/** What is done with an indeterminate action of a kind that has no checkable post-condition. */
export type IndeterminateHandler = (action: EffectfulAction) => Effect.Effect<void>

/** The post-conditions and the indeterminate handlers, by kind; later tickets register theirs. */
export class ActionRules extends Context.Service<
  ActionRules,
  {
    readonly postConditions: ReadonlyMap<string, PostCondition>
    readonly handlers: ReadonlyMap<string, IndeterminateHandler>
  }
>()('ActionRules') {}

/** What a `file.write` intent records: the file, its fingerprint before, and the one it is to have. */
export const FileWriteDetails = Schema.Struct({
  path: Schema.String,
  before: Schema.NullOr(Schema.String),
  after: Schema.String,
})

const readFileWrite = Schema.decodeUnknownOption(FileWriteDetails)

/**
 * A file write: the file's fingerprint is the one the write would produce, it was done; the one
 * before, it failed; anything else, nobody can say.
 */
export const fileWritten: PostCondition = (details) =>
  Effect.gen(function* () {
    const read = readFileWrite(details)
    if (Option.isNone(read)) return 'indeterminate'
    const now = yield* Effect.promise(() => fingerprintFile(read.value.path).catch(() => undefined))
    if (now === undefined) return 'indeterminate'
    if (now === read.value.after) return 'done'
    if (now === read.value.before) return 'failed'
    return 'indeterminate'
  })

/** The rules of this version: `file.write` has a post-condition; nothing has a handler yet. */
export const actionRulesLayer = (
  extra: {
    readonly postConditions?: ReadonlyMap<string, PostCondition>
    readonly handlers?: ReadonlyMap<string, IndeterminateHandler>
  } = {},
) =>
  Layer.succeed(ActionRules, {
    postConditions: new Map([['file.write', fileWritten], ...(extra.postConditions ?? new Map())]),
    handlers: new Map(extra.handlers ?? new Map()),
  })

const now = (): string => new Date().toISOString()

const actionEvent = (
  type: string,
  id: string,
  kind: string,
  payload: Record<string, string | null> = {},
): NewEvent => ({
  type,
  entityKind: 'action',
  entityId: id,
  source: 'system',
  author: 'hemera',
  payload: { kind, ...payload },
})

/** Writes the intent of an action, committed before its effect starts; answers its id. */
export const beginAction = (kind: string, owner: ActionOwner, details: Schema.JsonObject) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const id = crypto.randomUUID()
    yield* mutate('recording the intent of an action', (transaction) =>
      transaction
        .insert(effectfulActions)
        .values({
          id,
          kind,
          ownerKind: owner.kind,
          ownerId: owner.kind === 'mission' ? owner.missionId : owner.projectId,
          taskId: owner.kind === 'mission' ? owner.taskId : null,
          details: maskedJson(secrets.maskRecord(details)),
          state: 'started',
          outcome: null,
          startedAt: now(),
          endedAt: null,
          handledAt: null,
        })
        .pipe(
          Effect.mapError(refusedWhile('recording the intent of an action')),
          Effect.as({ result: undefined, events: [actionEvent('action.started', id, kind)] }),
        ),
    )
    return id
  })

/** Writes the outcome of an action whose intent is `started`. */
const settle = (id: string, state: 'done' | 'failed', outcome: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const masked: Masked<string> = secrets.mask(outcome)
    yield* mutate('recording the outcome of an action', (transaction) =>
      transaction
        .update(effectfulActions)
        .set({ state, outcome: masked, endedAt: now() })
        .where(and(eq(effectfulActions.id, id), eq(effectfulActions.state, 'started')))
        .returning({ kind: effectfulActions.kind })
        .pipe(
          Effect.mapError(refusedWhile('recording the outcome of an action')),
          Effect.map((rows) => ({
            result: undefined,
            events: rows.map((row) => actionEvent(`action.${state}`, id, row.kind)),
          })),
        ),
    )
  })

export const actionDone = (id: string, result: string) => settle(id, 'done', result)
export const actionFailed = (id: string, reason: string) => settle(id, 'failed', reason)

type ActionRow = typeof effectfulActions.$inferSelect

const readDetails = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))

const actionOf = (row: ActionRow): EffectfulAction => ({
  id: row.id,
  kind: row.kind,
  owner:
    row.ownerKind === 'mission'
      ? { kind: 'mission', missionId: row.ownerId, taskId: row.taskId }
      : { kind: 'project', projectId: row.ownerId },
  details: Option.getOrNull(readDetails(row.details)),
  state:
    row.state === 'done' || row.state === 'failed' || row.state === 'started'
      ? row.state
      : 'indeterminate',
  outcome: row.outcome,
})

/** The actions recorded, the oldest first; every one of them, or those in the states named. */
export const listActions = (states?: ReadonlyArray<ActionState>) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(effectfulActions)
      .where(states === undefined ? undefined : inArray(effectfulActions.state, [...states]))
      .orderBy(effectfulActions.startedAt)
      .pipe(Effect.mapError(refusedWhile('reading the actions')))
    return rows.map(actionOf)
  })

/**
 * At the engine's start, before anything acts: every intent without an outcome becomes
 * `indeterminate`, then the post-condition of its kind, when there is one, records what it finds.
 * Answers the actions that stay indeterminate.
 */
export const settleLeftActions: Effect.Effect<
  ReadonlyArray<EffectfulAction>,
  DatabaseError,
  Database | DomainEvents | ActionRules
> = Effect.gen(function* () {
  const rules = yield* ActionRules
  const left = yield* listActions(['started'])
  if (left.length === 0) return []
  yield* mutate('marking the actions an engine left without an outcome', (transaction) =>
    transaction
      .update(effectfulActions)
      .set({ state: 'indeterminate' })
      .where(
        and(
          inArray(
            effectfulActions.id,
            left.map((action) => action.id),
          ),
          eq(effectfulActions.state, 'started'),
        ),
      )
      .pipe(
        Effect.mapError(refusedWhile('marking the actions left')),
        Effect.as({
          result: undefined,
          events: left.map((action) => actionEvent('action.indeterminate', action.id, action.kind)),
        }),
      ),
  )
  const still: EffectfulAction[] = []
  for (const action of left) {
    const check = rules.postConditions.get(action.kind)
    const found = check === undefined ? 'indeterminate' : yield* check(action.details)
    if (found === 'indeterminate') {
      still.push({ ...action, state: 'indeterminate' })
      continue
    }
    yield* mutate('recording what the world shows of an action', (transaction) =>
      transaction
        .update(effectfulActions)
        .set({ state: found, outcome: maskText('found so at restart', []), endedAt: now() })
        .where(eq(effectfulActions.id, action.id))
        .pipe(
          Effect.mapError(refusedWhile('recording an action')),
          Effect.as({
            result: undefined,
            events: [actionEvent(`action.${found}`, action.id, action.kind, { at: 'restart' })],
          }),
        ),
    )
  }
  return still
})

/**
 * Once the reconciliation is over: each indeterminate action whose kind registered a handler is
 * handed to it, once. An action whose kind has none stays as it is.
 */
export const handleIndeterminate = Effect.gen(function* () {
  const rules = yield* ActionRules
  const database = yield* Database
  const rows = yield* database
    .select()
    .from(effectfulActions)
    .where(and(eq(effectfulActions.state, 'indeterminate'), isNull(effectfulActions.handledAt)))
    .pipe(Effect.mapError(refusedWhile('reading the indeterminate actions')))
  let handled = 0
  for (const row of rows) {
    const handler = rules.handlers.get(row.kind)
    if (handler === undefined) continue
    yield* mutate('handing an indeterminate action over', (transaction) =>
      transaction
        .update(effectfulActions)
        .set({ handledAt: now() })
        .where(eq(effectfulActions.id, row.id))
        .pipe(
          Effect.mapError(refusedWhile('handing an action over')),
          Effect.as({ result: undefined, events: [] }),
        ),
    )
    yield* handler(actionOf(row))
    handled += 1
  }
  return handled
})

/**
 * The service every effect outside the database goes through: its intent first, then its outcome.
 * Its calls carry what they stand on, so a tool that holds it needs nothing else.
 */
export class EffectfulActions extends Context.Service<
  EffectfulActions,
  {
    readonly begin: (
      kind: string,
      owner: ActionOwner,
      details: Schema.JsonObject,
    ) => Effect.Effect<string, DatabaseError>
    readonly done: (id: string, result: string) => Effect.Effect<void, DatabaseError>
    readonly failed: (id: string, reason: string) => Effect.Effect<void, DatabaseError>
  }
>()('EffectfulActions') {}

export const effectfulActionsLayer = Layer.effect(
  EffectfulActions,
  Effect.map(Effect.context<Database | DomainEvents | Secrets>(), (context) => ({
    begin: (kind, owner, details) => Effect.provide(beginAction(kind, owner, details), context),
    done: (id, result) => Effect.provide(actionDone(id, result), context),
    failed: (id, reason) => Effect.provide(actionFailed(id, reason), context),
  })),
)
