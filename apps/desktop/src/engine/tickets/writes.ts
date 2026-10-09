/**
 * Remote Specs (#98): in a Project in `remote` mode, the frozen Spec of a mission from a ticket is
 * written into that ticket, its whole description, and nothing else is ever written to a ticket.
 *
 * - **When.** At each Freeze: the write is queued in the Freeze's own transaction
 *   (`queueWriteIn`), so a Freeze never waits on the network. Nothing is written during Planning,
 *   and a mission started from a sentence keeps a local Spec: no ticket is created.
 * - **The procedure** (`runWrite`), once automations may run (CT-08): the ticket read again (out
 *   of reach: `waiting_offline`, tried again at each sync check of its Project and when its
 *   provider is back); the version read kept as #97 keeps any, so a change found is a ticket event;
 *   its description compared with the version the write knew (CT-53), whether that change was
 *   found as an event or not: a description changed by anyone but Hemera is a **conflict**, never
 *   a write: the mission outdated with the difference, and a decision asked, "Keep the ticket’s change" or "Write the Spec over it". Otherwise the intent is
 *   written (`started`, CT-09), the description written, and the ticket read back: holding the
 *   Spec, `done`, and the version read back is the last known one at once, so Hemera's own write
 *   never makes an event; otherwise `failed`, with the masked sentence.
 * - **A stop between the intent and the outcome** leaves the write `indeterminate`; the next start
 *   settles it from what the ticket holds: the Spec, `done`; what Hemera knew before, `failed` and
 *   queued once again; anything else, a conflict.
 * - **A failed write blocks nothing**: it is said once (`tickets.write_failed`, a notification),
 *   and the user's Retry queues it again. A write a return to Planning, a later Freeze, an ended
 *   mission or a Project no longer in remote mode made stale is dropped, never sent.
 *
 * Two runs of one write never both write: each step moves the state from the one it read, and one
 * mission's writes run one after the other.
 */

import {
  DecisionFields,
  KEEP_TICKET_CHANGE,
  MissionOwner,
  REMOTE_SPEC_LIMITS,
  RemoteSpecTarget,
  type TicketVersion,
  type TicketWriteState,
  TICKET_WRITE_STATES,
  TicketTooLong,
  WRITE_SPEC_OVER,
  lineDifference,
  maskText,
  normalisedText,
  parseTicketReference,
  remoteSpecReadBack,
  remoteSpecTooLong,
  renderRemoteSpec,
} from '@hemera/core/domain'
import { type TicketWriteInfo, TicketWriteRefused, UnknownTicketWrite } from '@hemera/ipc'
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm'
import {
  Cause,
  Context,
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
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import type { NewEvent } from '../journal.ts'
import { Memory } from '../memory/index.ts'
import { type NeedHandler, createNeedIn, expireNeedIn, needService } from '../needs.ts'
import { markOutdatedIn } from '../planning/outdated.ts'
import { specIn } from '../planning/store.ts'
import { Secrets } from '../secrets.ts'
import {
  Database,
  DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  missionTickets,
  missions,
  projects,
  ticketEvents,
  ticketProviders,
  ticketVersions,
  ticketWrites,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import {
  TICKET_DATA_LABEL,
  keepOwnVersion,
  keepVersion,
  quoted,
  seenOverWriteIn,
  writtenByHemeraIn,
} from './events.ts'
import { observed } from './link.ts'
import { descriptionFingerprint, isOutage, specFingerprint } from './provider.ts'
import { type LiveProvider, TicketProviders } from './search.ts'
import { getProvider } from './store.ts'
import { ticketEnd } from './text.ts'
import { maskedVersion, versionOf } from './versions.ts'

/** The engine service the decisions of a conflict belong to. */
export const TICKET_WRITES = needService('ticket-writes')

/** The stages a frozen Spec is written in: after the Freeze, while the mission lives. */
const FROZEN_STAGES = ['ready', 'building', 'review', 'shipping'] as const

/** The states a write is taken up from by the procedure. */
const PENDING_STATES = ['queued', 'waiting_offline', 'indeterminate'] as const

/** The order rows were written in, which two dates of the same millisecond do not tell. */
const INSERTED = sql`rowid`

const now = (): string => new Date().toISOString()

type WriteRow = typeof ticketWrites.$inferSelect

const stateOf = (text: string): TicketWriteState =>
  TICKET_WRITE_STATES.find((one) => one === text) ?? 'failed'

const readResolution = Schema.decodeUnknownOption(Schema.Literals(['kept', 'written_over']))
const readTarget = Schema.decodeUnknownOption(RemoteSpecTarget)
const readDeployment = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ deployment: Schema.String })),
)

const infoOf = (row: WriteRow): TicketWriteInfo => ({
  id: row.id,
  missionId: row.missionId,
  key: row.key,
  specVersion: row.specVersion,
  state: stateOf(row.state),
  error: row.error,
  needId: row.needId,
  resolution: Option.getOrNull(readResolution(row.resolution)),
  queuedAt: row.queuedAt,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
})

const targetOf = (row: WriteRow): RemoteSpecTarget =>
  Option.getOrElse(readTarget(row.target), (): RemoteSpecTarget => 'markdown')

/** The limit of the tracker a target is written to. */
const limitOf = (target: RemoteSpecTarget): number =>
  target === 'markdown' ? REMOTE_SPEC_LIMITS.github : REMOTE_SPEC_LIMITS.jira

/**
 * Whether a description holds the remote Spec a write is to leave there, as the tracker stored it:
 * the marks and the spacing it may rewrite do not count.
 */
const holds = (row: WriteRow, description: string): boolean =>
  specFingerprint(description) === row.fingerprint

/** Two descriptions the same once normalised: what a conflict is decided on. */
const sameText = (one: string, other: string): boolean =>
  normalisedText(one).trim() === normalisedText(other).trim()

const writeEvent = (
  type: string,
  row: Pick<WriteRow, 'id' | 'missionId' | 'key'>,
  projectId: string,
  payload: Record<string, string> = {},
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: row.missionId,
  source: 'system',
  author: 'hemera',
  payload: { projectId, write: row.id, key: row.key, ...payload },
})

const projectIdOf = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission'))),
    ([row]) => row?.projectId ?? '',
  )

/** The mission's last ticket event, by its place in detection order; 0 for none. */
const lastSequenceIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select({ last: max(ticketEvents.sequence) })
      .from(ticketEvents)
      .where(eq(ticketEvents.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the ticket events'))),
    ([row]) => row?.last ?? 0,
  )

// --- Queued at the Freeze -------------------------------------------------------------------------

/**
 * In the Freeze's transaction: the write of the frozen Spec into the mission's ticket, queued, when
 * the mission comes from a ticket of a provider of the Project, was linked in remote mode, and the
 * Project is still in remote mode. The Spec is rendered for the provider (Markdown for GitHub, ADF
 * for Jira Cloud, wiki markup for Data Center), its known secret values masked. Answers the events.
 */
export const queueWriteIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const [row] = yield* transaction
      .select({
        link: missionTickets,
        mission: missions,
        mode: projects.specMode,
        provider: ticketProviders,
      })
      .from(missionTickets)
      .innerJoin(missions, eq(missions.id, missionTickets.missionId))
      .innerJoin(projects, eq(projects.id, missions.projectId))
      .leftJoin(ticketProviders, eq(ticketProviders.id, missionTickets.providerId))
      .where(eq(missionTickets.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission’s ticket')))
    if (
      row === undefined ||
      row.mode !== 'remote' ||
      row.link.mode !== 'remote' ||
      row.provider === null ||
      row.mission.ticketReference === null
    ) {
      return []
    }
    const target: RemoteSpecTarget =
      row.provider.kind === 'github'
        ? 'markdown'
        : Option.match(readDeployment(row.provider.configuration), {
            onNone: () => 'adf',
            onSome: (config) => (config.deployment === 'datacenter' ? 'wiki' : 'adf'),
          })
    const spec = yield* specIn(transaction, missionId)
    const text = renderRemoteSpec(spec, target, secrets.mask)
    const at = now()
    const write: WriteRow = {
      id: crypto.randomUUID(),
      missionId,
      providerId: row.provider.id,
      reference: row.mission.ticketReference,
      key: row.mission.ticketKey ?? row.mission.ticketReference,
      specVersion: spec.version,
      target,
      text: secrets.mask(text),
      fingerprint: specFingerprint(remoteSpecReadBack(text, target)),
      state: 'queued',
      error: null,
      eventsSeen: yield* lastSequenceIn(transaction, missionId),
      // What Hemera knew of the ticket at the Freeze: none when it was never read.
      expectedVersionId: row.link.lastVersionId,
      conflictVersionId: null,
      needId: null,
      resolution: null,
      retried: false,
      queuedAt: at,
      startedAt: null,
      endedAt: null,
      updatedAt: at,
    }
    yield* transaction
      .insert(ticketWrites)
      .values(write)
      .pipe(Effect.mapError(refusedWhile('queueing the write of the Spec')))
    return [writeEvent('tickets.write_queued', write, row.mission.projectId)]
  })

/** The sentence a write dropped by a return to Planning keeps. */
const droppedSaid = (key: string): string =>
  `Not written: the mission went back to Planning before the Spec reached ${key}. The next Freeze writes it.`

/**
 * In the transaction of a return to Planning: the writes not sent yet (queued, waiting, or in a
 * conflict not answered) are dropped, and their decisions expire. A write already started settles
 * as it is.
 */
export const dropWritesIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const rows = yield* transaction
      .select()
      .from(ticketWrites)
      .where(eq(ticketWrites.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the writes of the Spec')))
    const projectId = yield* projectIdOf(transaction, missionId)
    const events: NewEvent[] = []
    for (const row of rows) {
      const waiting = row.state === 'queued' || row.state === 'waiting_offline'
      const unanswered = row.state === 'conflict' && row.resolution === null
      if (!waiting && !unanswered) continue
      yield* transaction
        .update(ticketWrites)
        .set({
          state: 'failed',
          error: maskText(droppedSaid(row.key), []),
          endedAt: now(),
          updatedAt: now(),
        })
        .where(eq(ticketWrites.id, row.id))
        .pipe(Effect.mapError(refusedWhile('dropping a write of the Spec')))
      events.push(
        writeEvent('tickets.write_dropped', row, projectId, { error: droppedSaid(row.key) }),
      )
      if (row.needId !== null) {
        events.push(
          ...(yield* expireNeedIn(transaction, row.needId, 'the mission went back to Planning')),
        )
      }
    }
    return events
  })

// --- Reading ------------------------------------------------------------------------------------

/** The writes of a mission's remote Spec, the first first. */
export const ticketWritesOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(ticketWrites)
      .where(eq(ticketWrites.missionId, missionId))
      .orderBy(asc(ticketWrites.queuedAt), asc(INSERTED))
      .pipe(Effect.mapError(refusedWhile('reading the writes of the Spec')))
    return rows.map(infoOf)
  })

const writeRow = (writeId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(ticketWrites)
      .where(eq(ticketWrites.id, writeId))
      .pipe(Effect.mapError(refusedWhile('reading a write of the Spec')))
    return row ?? null
  })

/** The mission's latest write, the one of its latest Freeze. */
const latestIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select({ id: ticketWrites.id })
      .from(ticketWrites)
      .where(eq(ticketWrites.missionId, missionId))
      .orderBy(desc(ticketWrites.queuedAt), desc(INSERTED))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the writes of the Spec'))),
    ([row]) => row?.id ?? null,
  )

/**
 * Why a write is no longer to be sent: a return to Planning, a later Freeze, an ended mission, or a
 * Project (or a link) no longer in remote mode, whose ticket is no longer Hemera's to write.
 */
const staleIn = (transaction: EngineTransaction, row: WriteRow) =>
  Effect.gen(function* () {
    const [mission] = yield* transaction
      .select({ stage: missions.stage, mode: projects.specMode, link: missionTickets.mode })
      .from(missions)
      .innerJoin(projects, eq(projects.id, missions.projectId))
      .leftJoin(missionTickets, eq(missionTickets.missionId, missions.id))
      .where(eq(missions.id, row.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    const stage = mission?.stage ?? 'cancelled'
    if (stage === 'planning') return droppedSaid(row.key)
    if (!FROZEN_STAGES.some((one) => one === stage)) {
      return `Not written: the mission ended before the Spec reached ${row.key}.`
    }
    if (mission?.mode !== 'remote' || mission.link !== 'remote') {
      return `Not written: the Project no longer writes its Specs to their tickets, so the Spec stays out of ${row.key}.`
    }
    if ((yield* latestIn(transaction, row.missionId)) !== row.id) {
      return `Not written: a later Freeze writes the Spec to ${row.key}.`
    }
    return null
  })

// --- The outcomes -------------------------------------------------------------------------------

/**
 * Moves a write from one of the states `from` to `to`, with what else it sets, and writes its
 * event; answers false when the write was no longer in those states (another run took it).
 */
const moveWrite = (
  row: WriteRow,
  from: ReadonlyArray<TicketWriteState>,
  to: Partial<WriteRow> & { readonly state: TicketWriteState },
  type: string,
  payload: Record<string, string> = {},
) =>
  mutate(`moving a write of the Spec to ${to.state}`, (transaction) =>
    Effect.gen(function* () {
      const moved = yield* transaction
        .update(ticketWrites)
        .set({ ...to, updatedAt: now() })
        .where(and(eq(ticketWrites.id, row.id), inArray(ticketWrites.state, [...from])))
        .returning({ id: ticketWrites.id })
        .pipe(Effect.mapError(refusedWhile('moving a write of the Spec')))
      if (moved.length === 0) return { result: false, events: [] }
      const projectId = yield* projectIdOf(transaction, row.missionId)
      return { result: true, events: [writeEvent(type, row, projectId, payload)] }
    }),
  )

const ANY_TAKEN: ReadonlyArray<TicketWriteState> = [...PENDING_STATES, 'started']

/** The write failed, in a sentence: said once, blocking nothing. */
const failWrite = (row: WriteRow, sentence: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const error = secrets.mask(sentence)
    yield* moveWrite(
      row,
      ANY_TAKEN,
      { state: 'failed', error, endedAt: now() },
      'tickets.write_failed',
      {
        error,
      },
    )
  })

/** A write no longer to be sent: dropped, not a failure to tell. */
const dropWrite = (row: WriteRow, sentence: string) =>
  moveWrite(
    row,
    ANY_TAKEN,
    { state: 'failed', error: maskText(sentence, []), endedAt: now() },
    'tickets.write_dropped',
    { error: sentence },
  )

/**
 * The ticket holds the Spec: the version read back is the last known one at once (so no event is
 * ever made of it), then the write is done.
 */
const doneWrite = (row: WriteRow, providerId: string, back: TicketVersion) =>
  Effect.gen(function* () {
    yield* keepOwnVersion(row.missionId, providerId, back)
    yield* moveWrite(
      row,
      ANY_TAKEN,
      { state: 'done', error: null, endedAt: now() },
      'tickets.write_done',
    )
  })

/**
 * The decision a conflict asks, with the difference that writing would lose. The difference is
 * what people wrote in the ticket: it is quoted after the data label, never Hemera's own words, as
 * whoever reads the decision (the Journal, an agent reading it) must take it.
 */
const conflictQuestion = (key: string, difference: string): string =>
  [
    `${key} changed since Hemera last read it, and the Spec was not written. Writing it now would lose this change of the description.`,
    [
      TICKET_DATA_LABEL,
      quoted(difference === '' ? '(the description as it is now)' : difference),
      ticketEnd(key),
    ].join('\n'),
    `“${KEEP_TICKET_CHANGE}” writes nothing: the change is handled as any change of the ticket. “${WRITE_SPEC_OVER}” writes the frozen Spec in its place.`,
  ].join('\n\n')

/**
 * A conflict (CT-53): nothing is written; the mission is outdated with the difference, and a
 * decision is asked. `before` is the description Hemera knew (null when it never read one), `read`
 * the ticket as just read, kept already.
 */
const conflictWrite = (row: WriteRow, before: string | null, read: TicketVersion) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const database = yield* Database
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, row.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return
    const after = maskedVersion(read, secrets.mask).description
    const difference = lineDifference(before ?? '', after)
    const need = yield* createNeedIn(
      TICKET_WRITES,
      MissionOwner.make({ projectId: mission.projectId, missionId: row.missionId, taskId: null }),
      DecisionFields.make({
        question: conflictQuestion(row.key, difference),
        options: [KEEP_TICKET_CHANGE, WRITE_SPEC_OVER],
        recommended: null,
      }),
    )
    yield* mutate('recording a conflict of the Spec’s write', (transaction) =>
      Effect.gen(function* () {
        const [current] = yield* transaction
          .select({ state: ticketWrites.state })
          .from(ticketWrites)
          .where(eq(ticketWrites.id, row.id))
          .pipe(Effect.mapError(refusedWhile('reading a write of the Spec')))
        if (current === undefined || !ANY_TAKEN.includes(stateOf(current.state))) {
          return { result: undefined, events: [] }
        }
        const [link] = yield* transaction
          .select({ last: missionTickets.lastVersionId })
          .from(missionTickets)
          .where(eq(missionTickets.missionId, row.missionId))
          .pipe(Effect.mapError(refusedWhile('reading the mission’s ticket')))
        // A mission that ended meanwhile is asked nothing.
        const refused: AskedNeed = { id: null, events: [] }
        const asked = yield* need(transaction).pipe(
          Effect.catchTag('NeedRefused', () => Effect.succeed(refused)),
        )
        const marked = yield* markOutdatedIn(
          transaction,
          row.missionId,
          { reason: 'ticket-changed', reference: row.key, difference, expiring: [] },
          secrets.mask,
        ).pipe(Effect.catchTag('MarkRefused', () => Effect.succeed([])))
        yield* transaction
          .update(ticketWrites)
          .set({
            state: 'conflict',
            needId: asked.id,
            conflictVersionId: link?.last ?? null,
            // The decision is on the changes found so far: one found after it is a new conflict.
            eventsSeen: yield* lastSequenceIn(transaction, row.missionId),
            resolution: null,
            endedAt: now(),
            updatedAt: now(),
          })
          .where(eq(ticketWrites.id, row.id))
          .pipe(Effect.mapError(refusedWhile('recording a conflict of the Spec’s write')))
        return {
          result: undefined,
          events: [
            writeEvent('tickets.write_conflict', row, mission.projectId, {
              difference: secrets.mask(difference),
            }),
            ...asked.events,
            ...marked,
          ],
        }
      }),
    )
  })

/** The decision a conflict asked, or none when its mission ended meanwhile. */
interface AskedNeed {
  readonly id: string | null
  readonly events: ReadonlyArray<NewEvent>
}

/** A version kept, by its id, as it was kept (masked); null for none. */
const keptVersion = (id: string | null) =>
  Effect.gen(function* () {
    if (id === null) return null
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(ticketVersions)
      .where(eq(ticketVersions.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a ticket version')))
    return row === undefined ? null : versionOf(row)
  })

/** The mission's last known version now, its id. */
const lastKnownOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ last: missionTickets.lastVersionId })
      .from(missionTickets)
      .where(eq(missionTickets.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission’s ticket')))
    return row?.last ?? null
  })

// --- The procedure --------------------------------------------------------------------------------

/**
 * The intent (CT-09), in the transaction that checks the write is still to be sent: a cancel, a
 * Done, an archive, a return to Planning or a mode switch committed while the ticket was read again
 * drops it there, and nothing is sent. Answers whether the write was taken up.
 */
const takeWrite = (row: WriteRow, lastKnown: string | null) =>
  mutate('taking up a write of the Spec', (transaction) =>
    Effect.gen(function* () {
      const projectId = yield* projectIdOf(transaction, row.missionId)
      const waiting = and(
        eq(ticketWrites.id, row.id),
        inArray(ticketWrites.state, ['queued', 'waiting_offline']),
      )
      const stale = yield* staleIn(transaction, row)
      if (stale !== null) {
        const dropped = yield* transaction
          .update(ticketWrites)
          .set({ state: 'failed', error: maskText(stale, []), endedAt: now(), updatedAt: now() })
          .where(waiting)
          .returning({ id: ticketWrites.id })
          .pipe(Effect.mapError(refusedWhile('dropping a write of the Spec')))
        return {
          result: false,
          events:
            dropped.length === 0
              ? []
              : [writeEvent('tickets.write_dropped', row, projectId, { error: stale })],
        }
      }
      const taken = yield* transaction
        .update(ticketWrites)
        .set({
          state: 'started',
          expectedVersionId: lastKnown,
          startedAt: now(),
          endedAt: null,
          error: null,
          updatedAt: now(),
        })
        .where(waiting)
        .returning({ id: ticketWrites.id })
        .pipe(Effect.mapError(refusedWhile('taking up a write of the Spec')))
      return {
        result: taken.length > 0,
        events: taken.length === 0 ? [] : [writeEvent('tickets.write_started', row, projectId)],
      }
    }),
  )

/** The sentence a write that could not be made says, the provider's words masked. */
const failedSaid = (key: string, message: string): string =>
  `The Spec could not be written to ${key}: ${message}`

/**
 * One pass of the procedure on a write: answers true when the write was queued again and is to be
 * taken up at once (an indeterminate write that did not land, once).
 */
const step = (writeId: string) =>
  Effect.gen(function* () {
    const row = yield* writeRow(writeId)
    if (row === null || !PENDING_STATES.some((one) => one === row.state)) return false
    const indeterminate = row.state === 'indeterminate'
    const database = yield* Database
    const stale = yield* database.transaction((transaction) => staleIn(transaction, row))
    // A write cut short settles from what the ticket holds, whatever happened since; any other
    // write that is no longer the mission's latest Freeze's is dropped.
    if (stale !== null && !indeterminate) {
      yield* dropWrite(row, stale)
      return false
    }
    if (row.providerId === null) {
      yield* failWrite(row, failedSaid(row.key, 'its ticket provider was removed.'))
      return false
    }
    const info = yield* getProvider(row.providerId).pipe(
      Effect.catchTag('UnknownTicketProvider', () => Effect.succeed(null)),
    )
    const [mission] = yield* database
      .select({ url: missions.ticketUrl, key: missions.ticketKey })
      .from(missions)
      .where(eq(missions.id, row.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    const reference = parseTicketReference(mission?.url ?? mission?.key ?? row.key)
    if (info === null || reference === null) {
      yield* failWrite(row, failedSaid(row.key, 'its ticket provider was removed.'))
      return false
    }
    const target = targetOf(row)
    if (!indeterminate && remoteSpecTooLong(row.text, limitOf(target))) {
      yield* failWrite(row, new TicketTooLong({ key: row.key, limit: limitOf(target) }).message)
      return false
    }
    const live: LiveProvider = {
      info,
      provider: yield* TicketProviders.use((providers) => providers.of(info)),
    }
    // Read again (CT-53). Out of reach, the write waits; a cut-short write stays indeterminate.
    const reread = yield* Effect.result(observed(live, live.provider.read(reference)))
    if (Result.isFailure(reread)) {
      if (reread.failure instanceof DatabaseError) return yield* Effect.fail(reread.failure)
      if (isOutage(reread.failure)) {
        if (row.state === 'queued') {
          yield* moveWrite(row, ['queued'], { state: 'waiting_offline' }, 'tickets.write_waiting')
        }
        return false
      }
      yield* failWrite(row, failedSaid(row.key, reread.failure.message))
      return false
    }
    const read = reread.success
    // Whatever moved is kept as #97 keeps it: a change of the description is its event.
    yield* keepVersion(row.missionId, info.id, read)
    const secrets = yield* Secrets
    const masked = maskedVersion(read, secrets.mask).description
    if (indeterminate) {
      // The post-condition (CT-09): the Spec, done; what Hemera knew, not written; else a conflict.
      if (holds(row, read.description)) {
        yield* doneWrite(row, info.id, read)
        return false
      }
      // Not written, and no longer to be: dropped, whatever the ticket holds (its change is kept).
      if (stale !== null) {
        yield* dropWrite(row, stale)
        return false
      }
      const expected = yield* keptVersion(row.expectedVersionId)
      if (expected !== null && sameText(expected.description, masked)) {
        if (row.retried) {
          yield* failWrite(row, `The Spec did not reach ${row.key}, and was not written again.`)
          return false
        }
        return yield* moveWrite(
          row,
          ['indeterminate'],
          { state: 'queued', retried: true },
          'tickets.write_retried',
        )
      }
      yield* conflictWrite(row, expected?.description ?? null, read)
      return false
    }
    // Written already (a write whose outcome was settled elsewhere): nothing to send.
    if (holds(row, read.description)) {
      yield* doneWrite(row, info.id, read)
      return false
    }
    // Compared with what the write knew (CT-53), whether or not the change was found as an event: a
    // change read while the ticket was not watched (the Project in another mode) is no event.
    const known = yield* keptVersion(row.expectedVersionId)
    // A ticket Hemera never read before the Freeze: whatever it holds was read by no one.
    if (known === null) {
      yield* conflictWrite(row, null, read)
      return false
    }
    if (
      !sameText(known.description, masked) &&
      !(yield* database.transaction((transaction) =>
        writtenByHemeraIn(transaction, row.missionId, read.description),
      ))
    ) {
      yield* conflictWrite(row, known.description, read)
      return false
    }
    // The intent (CT-09), committed before anything is sent.
    const lastKnown = yield* lastKnownOf(row.missionId)
    if (!(yield* takeWrite(row, lastKnown))) return false
    const sent = yield* Effect.result(
      observed(
        live,
        live.provider.write(reference, row.text, {
          fingerprint: descriptionFingerprint(read.description),
        }),
      ),
    )
    if (Result.isSuccess(sent)) {
      if (holds(row, sent.success.description)) {
        yield* doneWrite(row, info.id, sent.success)
      } else {
        // The tracker took the write: what it holds now is what Hemera sent, as it stored it, and
        // never a change of the ticket's.
        yield* keepOwnVersion(row.missionId, info.id, sent.success)
        yield* failWrite(row, `The Spec was sent, but ${row.key} did not hold it when read back.`)
      }
      return false
    }
    const failure = sent.failure
    if (failure instanceof DatabaseError) return yield* Effect.fail(failure)
    if (Predicate.isTagged(failure, 'TicketMoved')) {
      // Changed between the read and the write: kept as any change, and a conflict.
      yield* keepVersion(row.missionId, info.id, failure.version)
      yield* conflictWrite(row, masked, failure.version)
      return false
    }
    if (Predicate.isTagged(failure, 'TicketTooLong')) {
      yield* failWrite(row, failure.message)
      return false
    }
    if (Predicate.isTagged(failure, 'ProviderUnreachable')) {
      // No answer, or the tracker's own failure (5xx): it may have been applied, and the next pass
      // decides from what the ticket holds.
      yield* moveWrite(row, ['started'], { state: 'indeterminate' }, 'tickets.write_indeterminate')
      return false
    }
    if (Predicate.isTagged(failure, 'ProviderLimited')) {
      // Refused before it was applied (a rate limit): it waits for the reset, and runs whole again.
      yield* moveWrite(
        row,
        ['started'],
        { state: 'waiting_offline', startedAt: null },
        'tickets.write_waiting',
      )
      return false
    }
    // Any other refusal (not signed in, no gh, forbidden…) was not applied: a failure, said once.
    yield* failWrite(row, failedSaid(row.key, failure.message))
    return false
  })

/** The procedure on a write, until it settles or waits. */
export const runWrite = (writeId: string) =>
  Effect.gen(function* () {
    // At most once more: an indeterminate write that did not land is queued again once.
    for (let pass = 0; pass < 2; pass += 1) {
      if (!(yield* step(writeId))) return
    }
  })

// --- The decision, Retry and the start --------------------------------------------------------------

/** The sentence a write ends with once the user kept the ticket's change. */
const KEPT_SAID = 'Not written: you kept the ticket’s change.'

/**
 * The answer to a conflict, in the transaction that marks it delivered: "Write the Spec over it"
 * queues the write again, the changes its decision showed seen by the user; a change found after
 * the decision was asked is a new conflict. Any other answer keeps the ticket's change: nothing is
 * written, and the write ends (`failed`, its sentence said, no notification), for Retry to take up
 * again when the user wants it.
 */
export const ticketWritesNeeds: NeedHandler = {
  deliver: (need, transaction) =>
    Effect.gen(function* () {
      const [row] = yield* transaction
        .select()
        .from(ticketWrites)
        .where(eq(ticketWrites.needId, need.id))
        .pipe(Effect.mapError(refusedWhile('reading a write of the Spec')))
      if (row === undefined || row.state !== 'conflict' || row.resolution !== null) return []
      const projectId = yield* projectIdOf(transaction, row.missionId)
      const over =
        need.answer !== null &&
        Predicate.isTagged(need.answer, 'Chosen') &&
        need.answer.option === WRITE_SPEC_OVER
      if (!over) {
        // Answered, so no longer waiting on anyone: ended, never told as a failure, and Retry is
        // the user's to ask.
        yield* transaction
          .update(ticketWrites)
          .set({
            state: 'failed',
            resolution: 'kept',
            error: maskText(KEPT_SAID, []),
            endedAt: now(),
            updatedAt: now(),
          })
          .where(eq(ticketWrites.id, row.id))
          .pipe(Effect.mapError(refusedWhile('keeping the ticket’s change')))
        return [writeEvent('tickets.write_kept', row, projectId)]
      }
      const seen = yield* seenOverWriteIn(transaction, row.missionId, row.eventsSeen)
      yield* transaction
        .update(ticketWrites)
        .set({
          state: 'queued',
          resolution: 'written_over',
          expectedVersionId: row.conflictVersionId,
          error: null,
          endedAt: null,
          updatedAt: now(),
        })
        .where(eq(ticketWrites.id, row.id))
        .pipe(Effect.mapError(refusedWhile('queueing the write of the Spec again')))
      return [writeEvent('tickets.write_queued', row, projectId, { answer: 'over' }), ...seen]
    }),
}

/**
 * Retry: a failed write of the mission's latest Freeze, while the mission is frozen, queued again;
 * the procedure runs whole once automations may. A conflict is answered through its decision.
 */
export const retryWrite = (writeId: string) =>
  Effect.gen(function* () {
    yield* mutate('queueing the write of the Spec again', (transaction) =>
      Effect.gen(function* () {
        const [row] = yield* transaction
          .select()
          .from(ticketWrites)
          .where(eq(ticketWrites.id, writeId))
          .pipe(Effect.mapError(refusedWhile('reading a write of the Spec')))
        if (row === undefined) return yield* new UnknownTicketWrite({ id: writeId })
        if (row.state !== 'failed') {
          return yield* new TicketWriteRefused({
            reason:
              row.state === 'conflict'
                ? 'This write waits on your decision: answer it instead.'
                : 'Only a write that failed is tried again.',
          })
        }
        const stale = yield* staleIn(transaction, row)
        if (stale !== null) return yield* new TicketWriteRefused({ reason: stale })
        yield* transaction
          .update(ticketWrites)
          .set({
            state: 'queued',
            error: null,
            retried: false,
            resolution: null,
            startedAt: null,
            endedAt: null,
            updatedAt: now(),
          })
          .where(eq(ticketWrites.id, writeId))
          .pipe(Effect.mapError(refusedWhile('queueing the write of the Spec again')))
        const projectId = yield* projectIdOf(transaction, row.missionId)
        return {
          result: undefined,
          events: [writeEvent('tickets.write_queued', row, projectId, { answer: 'retry' })],
        }
      }),
    )
    const row = yield* writeRow(writeId)
    if (row === null) return yield* new UnknownTicketWrite({ id: writeId })
    return infoOf(row)
  })

/**
 * At the start: a write an engine left `started` is perhaps done (CT-09), indeterminate until its
 * post-condition is read.
 */
const settleLeft = mutate('marking the writes a stop left', (transaction) =>
  Effect.gen(function* () {
    const left = yield* transaction
      .update(ticketWrites)
      .set({ state: 'indeterminate', updatedAt: now() })
      .where(eq(ticketWrites.state, 'started'))
      .returning()
      .pipe(Effect.mapError(refusedWhile('marking the writes a stop left')))
    const events: NewEvent[] = []
    for (const row of left) {
      events.push(
        writeEvent(
          'tickets.write_indeterminate',
          row,
          yield* projectIdOf(transaction, row.missionId),
        ),
      )
    }
    return { result: undefined, events }
  }),
)

/** The writes to take up, of a Project or of all, the first queued first. */
const pendingOf = (projectId: string | null) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select({ id: ticketWrites.id })
      .from(ticketWrites)
      .innerJoin(missions, eq(missions.id, ticketWrites.missionId))
      .where(
        and(
          inArray(ticketWrites.state, [...PENDING_STATES]),
          projectId === null ? undefined : eq(missions.projectId, projectId),
        ),
      )
      .orderBy(asc(ticketWrites.queuedAt), asc(sql`${ticketWrites}.rowid`))
      .pipe(Effect.mapError(refusedWhile('reading the writes of the Spec')))
    return rows.map((row) => row.id)
  })

export class TicketWrites extends Context.Service<
  TicketWrites,
  {
    /** The procedure on a write now, once automations may run, after its mission's others. */
    readonly run: (writeId: string) => Effect.Effect<void>
  }
>()('TicketWrites') {}

type Needs = Database | DomainEvents | Secrets | TicketProviders | AutomationGate | Memory

const readText = Schema.decodeUnknownOption(Schema.String)

/**
 * The writes, taken up once automations may run (CT-08): what a stop left settled first, then
 * every write waiting, then each write queued as it is committed, and a Project's waiting writes
 * at each of its sync checks and when one of its providers is back.
 */
export const ticketWritesLayer = (settings: { readonly log: Log }) =>
  Layer.effect(
    TicketWrites,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const said = (line: string) => Effect.sync(() => settings.log(`remote specs: ${line}`))
      const gate = yield* AutomationGate
      const locks = new Map<string, Semaphore.Semaphore>()
      const lockOf = (missionId: string) => {
        const found = locks.get(missionId)
        if (found !== undefined) return found
        const made = Semaphore.makeUnsafe(1)
        locks.set(missionId, made)
        return made
      }
      const run = (writeId: string) =>
        Effect.gen(function* () {
          yield* gate.pass
          const row = yield* writeRow(writeId)
          if (row === null) return
          yield* Semaphore.withPermits(lockOf(row.missionId), 1)(runWrite(writeId))
        }).pipe(
          provide,
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : said(`the write ${writeId} stopped: ${Cause.pretty(cause).split('\n')[0] ?? ''}`),
          ),
          Effect.orDie,
        )
      const scope = yield* Effect.scope
      const all = (projectId: string | null) =>
        Effect.flatMap(provide(pendingOf(projectId)), (ids) =>
          Effect.forEach(ids, (id) => Effect.forkIn(run(id), scope), { discard: true }),
        ).pipe(Effect.catchCause((cause) => said(`the writes were not taken up: ${String(cause)}`)))
      const committed = yield* DomainEvents.use((events) => events.subscribe)
      yield* gate.pass.pipe(
        Effect.andThen(Memory.use((memory) => memory.ready)),
        Effect.andThen(provide(settleLeft)),
        Effect.andThen(all(null)),
        Effect.andThen(
          committed.pipe(
            Stream.runForEach((event) => {
              if (event.type === 'tickets.write_queued') {
                const id = Option.getOrNull(readText(event.payload['write']))
                return id === null ? Effect.void : Effect.asVoid(Effect.forkIn(run(id), scope))
              }
              if (event.type === 'tickets.checked') return all(event.entityId)
              if (event.type === 'tickets.provider_back') {
                return all(Option.getOrElse(readText(event.payload['projectId']), () => ''))
              }
              return Effect.void
            }),
          ),
        ),
        provide,
        Effect.catchCause((cause) => said(`stopped following the writes: ${String(cause)}`)),
        Effect.forkScoped,
      )
      return { run }
    }),
  )
