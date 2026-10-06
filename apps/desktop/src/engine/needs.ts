/**
 * The needs: everything that blocks and waits on a human, in one place.
 *
 * A need is created by the engine service that owns it (`createNeed`, which no agent tool can
 * reach), or asked for by an agent (`requestFromAgent`, a decision or an environment need only),
 * which Hemera checks before it creates it. It stays `pending`, across restarts, until the user
 * answers it, it expires, or its owner withdraws it; nothing ever answers it on the user's behalf.
 *
 * An answer applies once: the write is `WHERE state = 'pending'`, so a second answer, or two at
 * once, find the first one written and are answered with it. The answer is handed to its owner
 * through an outbox written in the answer's own transaction: an engine that stops in between hands
 * it over at its next start, and an answer delivered is never handed over again.
 */

import {
  ApplicationOwner,
  DecisionFields,
  EnvironmentFields,
  type NeedAnswer as Answer,
  type NeedFields as Fields,
  type NeedKind,
  type NeedOwner,
  NEED_STATES,
  MissionOwner,
  NeedAnswer,
  NeedAnswerRefused,
  NeedFields,
  ProjectOwner,
  RequestedDecision,
  RequestedEnvironment,
  fittingAnswer,
  isLive,
  maskedJson,
  permissionChoices,
  STAGES,
} from '@hemera/core/domain'
import {
  type Need,
  type NeedAnswerAsked,
  type NeedGroup,
  UnknownMission,
  UnknownNeed,
  UnknownProject,
} from '@hemera/ipc'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Brand, Context, Effect, Layer, Match, Option, Predicate, Schema, Semaphore } from 'effect'

import type { DomainEvents } from './domain-events.ts'
import type { EventPayload, NewEvent } from './journal.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from './storage/database.ts'
import { missions, needDeliveries, needs, projects } from './storage/schema.ts'
import { Secrets } from './secrets.ts'
import { mutate } from './transaction.ts'

/**
 * The engine service a need belongs to: the one handed its answer and asked to check it again.
 * Only engine code names one; nothing an agent reaches can.
 */
export type NeedService = string & Brand.Brand<'NeedService'>

export const needService = Brand.nominal<NeedService>()

/** Who owns the needs an agent asked for: the agents' side, which hands the answer back. */
export const AGENT_REQUESTS = needService('agents')

/** The owner could not take an answer now; it is handed over again at the next start. */
export class DeliveryFailed extends Schema.TaggedError<DeliveryFailed>()('DeliveryFailed', {
  reason: Schema.String,
}) {}

/**
 * What a service that owns needs registers: where their answers go, and how one is checked.
 * `deliver` records the answer in the owner's own state, inside the transaction that marks it
 * delivered, so an answer is taken exactly once whatever stops in between; what the owner then
 * does outside the database starts from that state, never from inside the transaction.
 */
export interface NeedHandler {
  readonly deliver: (
    need: Need,
    transaction: EngineTransaction,
  ) => Effect.Effect<ReadonlyArray<NewEvent>, DeliveryFailed | DatabaseError>
  /**
   * Whether what an environment need says is missing still is: false withdraws it. `retried` is
   * the user's Retry, which tries again whatever changed; otherwise Hemera looks again by itself.
   */
  readonly recheck?: (need: Need, retried: boolean) => Effect.Effect<boolean>
}

export class NeedOwners extends Context.Service<
  NeedOwners,
  {
    readonly handlers: ReadonlyMap<string, NeedHandler>
    /** One delivery round at a time, so no answer is handed over twice at once. */
    readonly delivering: Semaphore.Semaphore
  }
>()('NeedOwners') {}

export const needOwnersLayer = (handlers: ReadonlyMap<string, NeedHandler>) =>
  Layer.sync(NeedOwners, () => ({ handlers, delivering: Semaphore.makeUnsafe(1) }))

/** An agent's session, as the request it makes names it. */
export interface AgentSession {
  readonly id: string
  readonly role: string
  readonly missionId: string
}

/** Whether a session holds a live grant on a mission, and on one of its tasks when named. */
export class SessionGrants extends Context.Service<
  SessionGrants,
  {
    readonly holds: (
      sessionId: string,
      missionId: string,
      taskId: string | null,
    ) => Effect.Effect<boolean>
  }
>()('SessionGrants') {}

/** Until sessions and their grants exist, no session holds one. */
export const noGrants = Layer.succeed(SessionGrants, { holds: () => Effect.succeed(false) })

/** An agent asked for something that is not a need it may ask for. */
export class AgentRequestRefused extends Schema.TaggedError<AgentRequestRefused>()(
  'AgentRequestRefused',
  { reason: Schema.String },
) {
  override get message(): string {
    return `This request was refused: ${this.reason}.`
  }
}

/** A need its owner cannot have: a mission that has ended, or one of another Project. */
export class NeedRefused extends Schema.TaggedError<NeedRefused>()('NeedRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `This need was not created: ${this.reason}.`
  }
}

/** What the calls on needs stand on. */
export type NeedServices = Database | DomainEvents | NeedOwners | SessionGrants | Secrets

type NeedRow = typeof needs.$inferSelect

/** The order rows were written in, which two dates of the same millisecond do not tell. */
const INSERTED = sql`rowid`

const readFields = Schema.decodeUnknownOption(Schema.fromJsonString(NeedFields))
const readAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(NeedAnswer))

const ownerOf = (row: NeedRow): NeedOwner => {
  if (row.missionId !== null && row.projectId !== null) {
    return MissionOwner.make({
      projectId: row.projectId,
      missionId: row.missionId,
      taskId: row.taskId,
    })
  }
  return row.projectId === null
    ? ApplicationOwner.make({})
    : ProjectOwner.make({ projectId: row.projectId })
}

/** A row, as the need a screen is shown; null when this version cannot read its fields. */
function needOf(row: NeedRow): Need | null {
  const fields = readFields(row.fields)
  if (Option.isNone(fields)) return null
  const owner = ownerOf(row)
  return {
    id: row.id,
    owner,
    fields: fields.value,
    choices: Predicate.isTagged(fields.value, 'Permission')
      ? permissionChoices({
          ownedByMission: Predicate.isTagged(owner, 'Mission'),
          sensitive: fields.value.sensitive,
        })
      : [],
    requestedBy: row.requestedBy,
    state: NEED_STATES.find((one) => one === row.state) ?? 'expired',
    answer: row.answer === null ? null : Option.getOrNull(readAnswer(row.answer)),
    endedReason: row.endedReason,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
  }
}

const readable = (rows: ReadonlyArray<NeedRow>): ReadonlyArray<Need> =>
  rows.flatMap((row) => {
    const need = needOf(row)
    return need === null ? [] : [need]
  })

const needRow = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(needs)
      .where(eq(needs.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a need')))
    if (row === undefined) return yield* new UnknownNeed({ id })
    return row
  })

/** A need, whatever its state. */
export const getNeed = (id: string): Effect.Effect<Need, DatabaseError | UnknownNeed, Database> =>
  Effect.flatMap(needRow(id), (row) => {
    const need = needOf(row)
    return need === null ? Effect.fail(new UnknownNeed({ id })) : Effect.succeed(need)
  })

/** The pending needs of missions, each mission's oldest first. */
export const pendingNeedsOf = (missionIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (missionIds.length === 0) return new Map<string, ReadonlyArray<Need>>()
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(needs)
      .where(and(inArray(needs.missionId, [...missionIds]), eq(needs.state, 'pending')))
      .orderBy(asc(needs.createdAt), asc(INSERTED))
      .pipe(Effect.mapError(refusedWhile('reading the needs')))
    const byMission = new Map<string, ReadonlyArray<Need>>()
    for (const id of missionIds) {
      byMission.set(id, readable(rows.filter((row) => row.missionId === id)))
    }
    return byMission
  })

/**
 * Needs you: every pending need of the Profile, grouped by owner, the application's first, then
 * each Project's in the order the Projects were made; inside a group, the oldest first.
 */
export const listNeeds: Effect.Effect<
  ReadonlyArray<NeedGroup>,
  DatabaseError,
  Database
> = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database
    .select()
    .from(needs)
    .where(eq(needs.state, 'pending'))
    .orderBy(asc(needs.createdAt), asc(INSERTED))
    .pipe(Effect.mapError(refusedWhile('reading the needs')))
  const order = yield* database
    .select({ id: projects.id })
    .from(projects)
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .pipe(Effect.mapError(refusedWhile('reading the Projects')))
  const pending = readable(rows)
  const projectOf = (need: Need) =>
    Match.value(need.owner).pipe(
      Match.tag('Application', () => null),
      Match.orElse((owner) => owner.projectId),
    )
  return [null, ...order.map((project) => project.id)].flatMap((projectId) => {
    const group = pending.filter((need) => projectOf(need) === projectId)
    return group.length === 0 ? [] : [{ projectId, needs: group }]
  })
})

const BY_THE_USER = { source: 'ui', author: 'human' } as const
const BY_HEMERA = { source: 'system', author: 'hemera' } as const
const BY_AN_AGENT = { source: 'system', author: 'agent' } as const

type By = typeof BY_THE_USER | typeof BY_HEMERA | typeof BY_AN_AGENT

const needEvent = (type: string, row: NeedRow, by: By, more: EventPayload = {}): NewEvent => ({
  type,
  entityKind: 'need',
  entityId: row.id,
  ...by,
  payload: {
    ownerKind: row.ownerKind,
    projectId: row.projectId,
    missionId: row.missionId,
    kind: row.kind,
    service: row.service,
    ...more,
  },
})

const now = (): string => new Date().toISOString()

/**
 * The owner of a need, checked inside the transaction that writes it: a Project that exists, a
 * live mission of that Project. A cancel that commits first is seen, so no need is left pending
 * on a mission that has ended.
 */
const checkedOwner = (transaction: EngineTransaction, owner: NeedOwner) =>
  Match.value(owner).pipe(
    Match.tag('Application', () => Effect.void),
    Match.tag('Project', ({ projectId }) =>
      Effect.gen(function* () {
        const found = yield* transaction
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, projectId))
          .pipe(Effect.mapError(refusedWhile('reading the Project')))
        if (found.length === 0) return yield* new UnknownProject({ id: projectId })
      }),
    ),
    Match.tag('Mission', ({ projectId, missionId }) =>
      Effect.gen(function* () {
        const [mission] = yield* transaction
          .select({ projectId: missions.projectId, stage: missions.stage })
          .from(missions)
          .where(eq(missions.id, missionId))
          .pipe(Effect.mapError(refusedWhile('reading the mission')))
        if (mission === undefined) return yield* new UnknownMission({ id: missionId })
        if (mission.projectId !== projectId) {
          return yield* new NeedRefused({ reason: 'the mission is not of that Project' })
        }
        const stage = STAGES.find((one) => one === mission.stage) ?? 'cancelled'
        if (!isLive(stage)) return yield* new NeedRefused({ reason: 'the mission has ended' })
      }),
    ),
    Match.exhaustive,
  )

const ownerColumns = (owner: NeedOwner) =>
  Match.value(owner).pipe(
    Match.tag('Application', () => ({
      ownerKind: 'application',
      projectId: null,
      missionId: null,
      taskId: null,
    })),
    Match.tag('Project', ({ projectId }) => ({
      ownerKind: 'project',
      projectId,
      missionId: null,
      taskId: null,
    })),
    Match.tag('Mission', ({ projectId, missionId, taskId }) => ({
      ownerKind: 'mission',
      projectId,
      missionId,
      taskId,
    })),
    Match.exhaustive,
  )

const kindOf = Match.type<Fields>().pipe(
  Match.tagsExhaustive({
    Environment: () => 'Environment',
    Decision: () => 'Decision',
    Error: () => 'Error',
    Permission: () => 'Permission',
  }),
)

/**
 * Writes a need inside a transaction its writer holds, its owner checked there: the need's row and
 * its `need.created` event. `masked` is its fields, masked before the transaction.
 */
const needWritten = (
  transaction: EngineTransaction,
  written: {
    readonly service: NeedService
    readonly owner: NeedOwner
    readonly fields: Fields
    readonly masked: ReturnType<typeof maskedJson>
    readonly requestedBy: string | null
    readonly by: By
  },
) =>
  Effect.gen(function* () {
    const id = crypto.randomUUID()
    yield* checkedOwner(transaction, written.owner)
    const [row] = yield* transaction
      .insert(needs)
      .values({
        id,
        ...ownerColumns(written.owner),
        kind: kindOf(written.fields),
        fields: written.masked,
        service: written.service,
        requestedBy: written.requestedBy,
        state: 'pending',
        answer: null,
        answerKey: null,
        endedReason: null,
        createdAt: now(),
        endedAt: null,
      })
      .returning()
      .pipe(Effect.mapError(refusedWhile('writing a need')))
    return {
      id,
      events: row === undefined ? [] : [needEvent('need.created', row, written.by)],
    }
  })

const insertNeed = (
  service: NeedService,
  owner: NeedOwner,
  fields: Fields,
  requestedBy: string | null,
  by: By,
) =>
  Effect.gen(function* () {
    // What a need says may quote what an agent, a command or Git wrote: it is masked before it is kept.
    const masked = maskedJson((yield* Secrets).maskRecord(fields))
    const written = yield* mutate('writing a need', (transaction) =>
      needWritten(transaction, { service, owner, fields, masked, requestedBy, by }).pipe(
        Effect.map(({ id, events }) => ({ result: id, events })),
      ),
    )
    // Written a moment ago: a need that is not there now is a defect, not a refusal.
    return yield* getNeed(written).pipe(Effect.catchTag('UnknownNeed', Effect.die))
  })

/**
 * A need an engine service writes inside a transaction of its own, with what the transaction
 * writes beside it: its fields masked first (`Secrets`), its owner checked in the transaction.
 * Answers the body that writes it, for `mutate`.
 */
export const createNeedIn = (service: NeedService, owner: NeedOwner, fields: Fields) =>
  Secrets.useSync((secrets) => {
    const masked = maskedJson(secrets.maskRecord(fields))
    return (transaction: EngineTransaction) =>
      needWritten(transaction, {
        service,
        owner,
        fields,
        masked,
        requestedBy: null,
        by: BY_HEMERA,
      })
  })

/**
 * Expires a need inside the transaction of its owner, pending or already answered: an answer the
 * owner could not act on because the situation changed. Answers the events.
 */
export const expireNeedIn = (transaction: EngineTransaction, id: string, reason: string) =>
  transaction
    .update(needs)
    .set({ state: 'expired', endedReason: reason, endedAt: now() })
    .where(and(eq(needs.id, id), inArray(needs.state, ['pending', 'answered'])))
    .returning()
    .pipe(
      Effect.mapError(refusedWhile('expiring a need')),
      Effect.map((rows) =>
        rows.map((row) => needEvent('need.expired', row, BY_HEMERA, { reason })),
      ),
    )

/**
 * A need an engine service creates and owns: an error, a permission, or any of the four kinds. No
 * agent tool reaches this: an agent asks through `requestFromAgent`.
 */
export const createNeed = (service: NeedService, owner: NeedOwner, fields: Fields) =>
  insertNeed(service, owner, fields, null, BY_HEMERA)

const refused = (reason: string) => new AgentRequestRefused({ reason })

/** The fields an agent sent, as those of the kind it asked for, or the reason they are not. */
const requested = (kind: 'Decision' | 'Environment', fields: Schema.Json) =>
  Effect.gen(function* () {
    const options = { onExcessProperty: 'error' } as const
    if (kind === 'Environment') {
      const decoded = yield* Schema.decodeUnknownEffect(RequestedEnvironment)(fields, options).pipe(
        Effect.mapError(() => refused('its fields are not those of an environment need')),
      )
      return EnvironmentFields.make(decoded)
    }
    const decoded = yield* Schema.decodeUnknownEffect(RequestedDecision)(fields, options).pipe(
      Effect.mapError(() => refused('its fields are not those of a decision')),
    )
    if (decoded.recommended !== null && !decoded.options.includes(decoded.recommended.option)) {
      return yield* refused('the option it recommends is not one of its options')
    }
    return DecisionFields.make(decoded)
  })

/**
 * A need an agent asks for, on the mission its session works for and optionally one of its
 * tasks: a decision or an environment need only, from a session holding a live grant on that
 * mission (and task), with fields of that kind and nothing else, bounded. Hemera creates it and
 * records which role asked.
 */
export const requestFromAgent = (
  session: AgentSession,
  kind: NeedKind,
  fields: Schema.Json,
  taskId: string | null,
) =>
  Effect.gen(function* () {
    if (kind !== 'Decision' && kind !== 'Environment') {
      return yield* refused('an agent asks only for a decision or an environment need')
    }
    const grants = yield* SessionGrants
    if (!(yield* grants.holds(session.id, session.missionId, taskId))) {
      return yield* refused(
        taskId === null
          ? 'this session holds no live grant on the mission'
          : 'this session holds no live grant on the mission and its task',
      )
    }
    const database = yield* Database
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, session.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return yield* new UnknownMission({ id: session.missionId })
    const checked = yield* requested(kind, fields)
    const owner = MissionOwner.make({
      projectId: mission.projectId,
      missionId: session.missionId,
      taskId,
    })
    return yield* insertNeed(AGENT_REQUESTS, owner, checked, session.role, BY_AN_AGENT)
  })

/**
 * Hands every answer not yet delivered to the service that owns its need, and marks each one
 * delivered once that service has it. An answer whose owner is not there, or failed to take it,
 * waits for the next round.
 */
export const deliverAnswers = Effect.gen(function* () {
  const owners = yield* NeedOwners
  yield* deliveryRound(owners).pipe(Semaphore.withPermits(owners.delivering, 1))
})

const deliveryRound = (owners: NeedOwners['Service']) =>
  Effect.gen(function* () {
    const database = yield* Database
    const waiting = yield* database
      .select({ need: needs })
      .from(needDeliveries)
      .innerJoin(needs, eq(needs.id, needDeliveries.needId))
      .where(isNull(needDeliveries.deliveredAt))
      .orderBy(asc(needs.endedAt))
      .pipe(Effect.mapError(refusedWhile('reading the answers to deliver')))
    for (const { need: row } of waiting) {
      const handler = owners.handlers.get(row.service)
      const need = needOf(row)
      if (handler === undefined || need === null) continue
      yield* mutate('handing an answer to its owner', (transaction) =>
        Effect.gen(function* () {
          const events = yield* handler.deliver(need, transaction)
          yield* transaction
            .update(needDeliveries)
            .set({ deliveredAt: now() })
            .where(eq(needDeliveries.needId, row.id))
            .pipe(Effect.mapError(refusedWhile('marking an answer delivered')))
          return { result: undefined, events }
        }),
      ).pipe(Effect.catchTag('DeliveryFailed', () => Effect.void))
    }
  })

/**
 * Answers a need once. A need no longer pending answers as it ended and nothing is written; of
 * two answers at once, the second finds the first written. The answer is then handed to the
 * service that owns the need.
 */
export const answerNeed = (asked: NeedAnswerAsked) =>
  Effect.gen(function* () {
    const row = yield* needRow(asked.id)
    const need = needOf(row)
    if (need === null) return yield* new UnknownNeed({ id: asked.id })
    if (need.state !== 'pending') return need
    const answer: Answer = yield* Effect.fromResult(
      fittingAnswer(need.fields, need.owner, asked.answer),
    )
    const answered = yield* mutate('answering a need', (transaction) =>
      Effect.gen(function* () {
        const written = yield* transaction
          .update(needs)
          .set({
            state: 'answered',
            answer: JSON.stringify(answer),
            answerKey: asked.key,
            endedAt: now(),
          })
          .where(and(eq(needs.id, asked.id), eq(needs.state, 'pending')))
          .returning({ id: needs.id })
          .pipe(Effect.mapError(refusedWhile('answering a need')))
        if (written.length === 0) return { result: false, events: [] }
        yield* transaction
          .insert(needDeliveries)
          .values({ needId: asked.id, deliveredAt: null })
          .pipe(Effect.mapError(refusedWhile('answering a need')))
        return {
          result: true,
          events: [needEvent('need.answered', row, BY_THE_USER, { answerKey: asked.key })],
        }
      }),
    )
    if (answered) yield* deliverAnswers.pipe(Effect.catchTag('DatabaseError', () => Effect.void))
    return yield* getNeed(asked.id)
  })

/** Ends a pending need without an answer: it expired, or its owner withdrew it. */
const endNeed = (id: string, state: 'expired' | 'withdrawn', reason: string) =>
  Effect.gen(function* () {
    const row = yield* needRow(id)
    yield* mutate(`ending a need`, (transaction) =>
      transaction
        .update(needs)
        .set({ state, endedReason: reason, endedAt: now() })
        .where(and(eq(needs.id, id), eq(needs.state, 'pending')))
        .returning({ id: needs.id })
        .pipe(
          Effect.mapError(refusedWhile('ending a need')),
          Effect.map((written) => ({
            result: undefined,
            events:
              written.length === 0 ? [] : [needEvent(`need.${state}`, row, BY_HEMERA, { reason })],
          })),
        ),
    )
    return yield* getNeed(id)
  })

/** A need that no longer holds (the base moved, the mission is outdated) expires with its reason. */
export const expireNeed = (id: string, reason: string) => endNeed(id, 'expired', reason)

/** Its owner withdraws a need when the situation resolved itself. */
export const withdrawNeed = (id: string, reason: string) => endNeed(id, 'withdrawn', reason)

/** Expires every pending need of a mission, inside the transaction that ends it. */
export const expireMissionNeeds = (
  transaction: EngineTransaction,
  missionId: string,
  reason: string,
) =>
  transaction
    .update(needs)
    .set({ state: 'expired', endedReason: reason, endedAt: now() })
    .where(and(eq(needs.missionId, missionId), eq(needs.state, 'pending')))
    .returning()
    .pipe(
      Effect.mapError(refusedWhile('expiring the needs of a mission')),
      Effect.map((rows) =>
        rows.map((row) => needEvent('need.expired', row, BY_THE_USER, { reason })),
      ),
    )

const RESOLVED = 'what was missing is there now'

/**
 * Retry: an environment need checked again by its owner, and withdrawn when what it said was
 * missing is there now. Any other kind is answered, not retried.
 */
export const retryNeed = (id: string) =>
  Effect.gen(function* () {
    const need = yield* getNeed(id)
    if (!Predicate.isTagged(need.fields, 'Environment')) {
      return yield* new NeedAnswerRefused({ reason: 'only an environment need is retried' })
    }
    if (need.state !== 'pending') return need
    const row = yield* needRow(id)
    const owners = yield* NeedOwners
    const recheck = owners.handlers.get(row.service)?.recheck
    if (recheck === undefined) return need
    return (yield* recheck(need, true)) ? need : yield* withdrawNeed(id, RESOLVED)
  })

/**
 * Every pending environment need checked again by its owner, as at the engine's start and every
 * few minutes while one is pending; those that no longer hold are withdrawn.
 */
export const recheckNeeds = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database
    .select()
    .from(needs)
    .where(and(eq(needs.state, 'pending'), eq(needs.kind, 'Environment')))
    .pipe(Effect.mapError(refusedWhile('reading the needs')))
  const owners = yield* NeedOwners
  for (const row of rows) {
    const recheck = owners.handlers.get(row.service)?.recheck
    const need = needOf(row)
    if (recheck === undefined || need === null) continue
    if (!(yield* recheck(need, false))) yield* withdrawNeed(row.id, RESOLVED)
  }
})
