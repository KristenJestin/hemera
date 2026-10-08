/**
 * The missions: created in Planning with their key, moved through their stages, marked, and
 * cancelled; and what the window reads of them.
 *
 * A mission's identifier is a ULID that every internal reference uses; its key (`ACME-12`) is given
 * at creation from its Project's prefix and next number, and never changes. A move is checked
 * against the stage it leaves and the actor it is for, then against the guard its ticket registers
 * (Freeze, Launch, Fix and Ship; a move whose guard is not registered yet is refused), and written
 * as `WHERE stage = <the stage it leaves>`: of two moves at once, the second finds the mission
 * moved and is refused, so a mission is never in two Buildings.
 *
 * Cancel ends the mission in one transaction (its stage, its pending needs expired, the stops it
 * owes written down), then calls each stopper later tickets register. A stopper that fails keeps
 * its row, is listed on the mission, and is tried again at the next start. Nothing is deleted:
 * the mission awaits the confirmation of its cleanup.
 */

import { createHash, randomBytes } from 'node:crypto'

import {
  type Actor,
  type Mark,
  MISSION_TYPES,
  type Move,
  MoveRefused,
  STAGES,
  type Stage,
  CanonicalTicket,
  Mark as MarkSchema,
  ballOf,
  checkedMove,
  isFrozen,
  isLive,
  markIdentity,
  MaskedText,
  type TicketReference,
  GITHUB_HOST,
  GithubIssue,
  canonicalTicket,
  markSentence,
  missionKey,
  parseTicketReference,
  provisionalTitleOf,
  searchTextOf,
  ticketKeyOf,
  ticketProviderOf,
  ticketUrlOf,
} from '@hemera/core/domain'
import {
  InvalidMissionIdea,
  type Mission,
  MissionChanged,
  type MissionMark,
  type MissionsChange,
  type Need,
  NeedChanged,
  type NewMission,
  TicketAlreadyLinked,
  UnknownMission,
  UnknownProject,
} from '@hemera/ipc'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  Context,
  Crypto,
  Effect,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import { DomainEvents } from './domain-events.ts'
import type { DomainEvent, EventPayload, NewEvent } from './journal.ts'
import {
  type NeedHandler,
  type NeedServices,
  SessionGrants,
  expireMissionNeeds,
  getNeed,
  needOwnersLayer,
  noGrants,
  pendingNeedsOf,
} from './needs.ts'
import { getProject, givePrefix } from './projects.ts'
import { type RunServices, stopMissionRuns } from './runs.ts'
import { MissionStarts, missionStartsLayer } from './start/started.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from './storage/database.ts'
import {
  memoryNext,
  missionMarks,
  missionStops,
  missions,
  projects,
  questions,
} from './storage/schema.ts'
import { mutate } from './transaction.ts'
import { newSpec, triageOf } from './planning/store.ts'
import { discussionBalls } from './planning/discussion-store.ts'
import { type TicketLinkAtCreation, linkMissionTicket } from './tickets/versions.ts'

/** The longest idea sentence a mission keeps. */
export const MAX_IDEA_LENGTH = 2000

/** Where a new mission stands in its Now until the Planner says otherwise. */
export const PLANNING_STARTS = 'Planning starts'

/** The moves a later ticket guards: Freeze (P9), Launch (B1), Fix (R2) and Ship (R9). */
export type GuardedMove = 'freeze' | 'launch' | 'fix' | 'ship'

/** What a guard finds against a move: the reasons it is refused, none when it may be made. */
export type Guard = (mission: Mission) => Effect.Effect<ReadonlyArray<string>>

export class MoveGuards extends Context.Service<MoveGuards, Partial<Record<GuardedMove, Guard>>>()(
  'MoveGuards',
) {}

/** A stopper could not stop what it holds for a mission; it is tried again at the next start. */
export class StopFailed extends Schema.TaggedError<StopFailed>()('StopFailed', {
  reason: Schema.String,
}) {}

/** What a cancel calls: the runs, the session tree, the Probes, the delivery steps… */
export interface Stopper {
  readonly name: string
  readonly stop: (missionId: string) => Effect.Effect<void, StopFailed>
}

export class MissionStoppers extends Context.Service<MissionStoppers, ReadonlyArray<Stopper>>()(
  'MissionStoppers',
) {}

/** What goes on in a mission beyond its records: a session working, a question waiting. */
export interface Activity {
  readonly sessionWorking: boolean
  readonly questionWaiting: boolean
}

/** Sessions (#40) and Planning questions (P3) answer it; until then, nothing goes on. */
export class MissionActivity extends Context.Service<
  MissionActivity,
  (missionId: string) => Effect.Effect<Activity>
>()('MissionActivity') {}

/** A mark refused on a mission: on a stage it does not belong to, or once the mission ended. */
export class MarkRefused extends Schema.TaggedError<MarkRefused>()('MarkRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `This mark is refused: ${this.reason}.`
  }
}

/** What later tickets plug into missions and needs. */
export interface MissionParts {
  readonly guards: Partial<Record<GuardedMove, Guard>>
  /** Called by a cancel, after the runs of the mission, which this ticket stops itself. */
  readonly stoppers: ReadonlyArray<Stopper>
  readonly activity: MissionActivity['Service']
  /** The services that own needs, by name: where their answers go. */
  readonly owners: ReadonlyMap<string, NeedHandler>
  readonly grants: SessionGrants['Service']
}

/**
 * The stoppers a cancel calls: first the runs and services started for the mission, which this
 * engine stops itself, then those later tickets register.
 */
const stoppersLayer = (registered: ReadonlyArray<Stopper>) =>
  Layer.effect(
    MissionStoppers,
    Effect.map(Effect.context<RunServices>(), (runs): ReadonlyArray<Stopper> => [
      {
        name: 'runs',
        stop: (missionId) =>
          stopMissionRuns(missionId).pipe(
            Effect.provide(runs),
            Effect.mapError((failure) => new StopFailed({ reason: failure.message })),
          ),
      },
      ...registered,
    ]),
  )

/** The missions' services: the parts given, and the defaults of what is not built yet. */
export const missionsLayer = (parts: Partial<MissionParts> = {}) =>
  Layer.mergeAll(
    Layer.succeed(MoveGuards, parts.guards ?? {}),
    stoppersLayer(parts.stoppers ?? []),
    Layer.succeed(
      MissionActivity,
      parts.activity ?? (() => Effect.succeed({ sessionWorking: false, questionWaiting: false })),
    ),
    needOwnersLayer(parts.owners ?? new Map()),
    parts.grants === undefined ? noGrants : Layer.succeed(SessionGrants, parts.grants),
    missionStartsLayer,
  )

/** What the calls on missions stand on. */
export type MissionServices =
  | NeedServices
  | MoveGuards
  | MissionStoppers
  | MissionActivity
  | MissionStarts

/** Mission identifiers: ULIDs from the system's own secure random source. */
const identifiers = Crypto.make({
  randomBytes: (size) => new Uint8Array(randomBytes(size)),
  digest: (algorithm, data) =>
    Effect.sync(
      () =>
        new Uint8Array(createHash(algorithm.replace('-', '').toLowerCase()).update(data).digest()),
    ),
})

const now = (): string => new Date().toISOString()

type MissionRow = typeof missions.$inferSelect

/** The order rows were written in, which two dates of the same millisecond do not tell. */
const INSERTED = sql`rowid`
type MarkRow = typeof missionMarks.$inferSelect

const readMark = Schema.decodeUnknownOption(Schema.fromJsonString(MarkSchema))

const markOf = (row: MarkRow): ReadonlyArray<MissionMark> =>
  Option.match(readMark(row.mark), {
    onNone: () => [],
    onSome: (mark) => [{ id: row.id, mark, sentence: markSentence(mark), setAt: row.setAt }],
  })

const stageOf = (row: MissionRow): Stage => STAGES.find((one) => one === row.stage) ?? 'cancelled'

/** The missions of these rows, read whole: marks, pending needs, stops owed, and the ball. */
export const missionsOf = (rows: ReadonlyArray<MissionRow>) =>
  Effect.gen(function* () {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const database = yield* Database
    const marks = yield* database
      .select()
      .from(missionMarks)
      .where(inArray(missionMarks.missionId, ids))
      .orderBy(asc(missionMarks.setAt), asc(INSERTED))
      .pipe(Effect.mapError(refusedWhile('reading the marks')))
    const stops = yield* database
      .select()
      .from(missionStops)
      .where(inArray(missionStops.missionId, ids))
      .orderBy(asc(missionStops.stopper))
      .pipe(Effect.mapError(refusedWhile('reading the stops')))
    const pending = yield* pendingNeedsOf(ids)
    // A Planning question open waits on the user (#86); one waiting on someone is a mark.
    const asking = yield* database
      .selectDistinct({ missionId: questions.missionId })
      .from(questions)
      .where(and(inArray(questions.missionId, ids), eq(questions.state, 'open')))
      .pipe(Effect.mapError(refusedWhile('reading the questions')))
    const discussing = yield* discussionBalls(ids)
    const activityOf = yield* MissionActivity
    return yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const stage = stageOf(row)
        const own = marks.filter((mark) => mark.missionId === row.id).flatMap(markOf)
        const needs: ReadonlyArray<Need> = pending.get(row.id) ?? []
        const activity = yield* activityOf(row.id)
        const { ticketProvider, ticketKey, ticketReference } = row
        return {
          id: row.id,
          projectId: row.projectId,
          key: missionKey(row.keyPrefix, row.keyNumber),
          title: row.title,
          idea: { sentence: row.ideaSentence, ticket: row.ideaTicket },
          type: MISSION_TYPES.find((one) => one === row.type) ?? 'feature',
          ticketLink:
            ticketProvider === null || ticketKey === null || ticketReference === null
              ? null
              : {
                  provider: ticketProvider,
                  reference: CanonicalTicket.make(ticketReference),
                  key: ticketKey,
                  url: row.ticketUrl,
                },
          origin: row.originId,
          stage,
          round: row.round,
          frozen: isFrozen(stage),
          marks: own,
          ball: ballOf({
            stage,
            pendingNeeds: needs.length,
            // An open discussion whose last message is the user's has the agent working (#87).
            sessionWorking:
              activity.sessionWorking || discussing.get(row.id)?.agentWorking === true,
            // A triage answer waits on the user until they keep, open or cancel (#85); so does an
            // open discussion whose last message is the agent's, or with a proposal (#87).
            questionWaiting:
              activity.questionWaiting ||
              row.triageState === 'pending' ||
              asking.some((one) => one.missionId === row.id) ||
              discussing.get(row.id)?.waitingOnYou === true,
            marks: own.map((one) => one.mark),
          }),
          needs,
          cleanup: row.cleanup === 'awaiting-confirmation' ? row.cleanup : null,
          unstopped: stops.filter((stop) => stop.missionId === row.id).map((stop) => stop.stopper),
          triage: triageOf(row),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        } satisfies Mission
      }),
    )
  })

export const getMission = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(missions)
      .where(eq(missions.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a mission')))
    const [mission] = yield* missionsOf(rows)
    if (mission === undefined) return yield* new UnknownMission({ id })
    return mission
  })

/** The missions of a Project, in the order of their numbers. */
export const listMissions = (projectId: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(missions)
      .where(eq(missions.projectId, projectId))
      .orderBy(asc(missions.keyNumber))
      .pipe(Effect.mapError(refusedWhile('reading the missions')))
    return yield* missionsOf(rows)
  })

const BY_THE_USER = { source: 'ui', author: 'human' } as const
const BY_HEMERA = { source: 'system', author: 'hemera' } as const

const byActor = (actor: Actor) => (actor === 'user' ? BY_THE_USER : BY_HEMERA)

const missionEvent = (
  type: string,
  id: string,
  by: typeof BY_THE_USER | typeof BY_HEMERA,
  payload: EventPayload,
): NewEvent => ({ type, entityKind: 'mission', entityId: id, ...by, payload })

/** A text the user gave, without the spaces around it; null when nothing is left. */
const given = (text: string | null): string | null => {
  const trimmed = text?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** How a mission is created beyond its idea: where from, and under which choice of the user. */
export interface MissionCreation {
  /** The title of the Chat it was created from (#43). */
  readonly fromChat?: string | undefined
  /** The ticket it came from, as recognised; read from the idea's ticket otherwise. */
  readonly reference?: TicketReference | undefined
  /** The host a short form `owner/repo#n` resolved to, through the Project's GitHub providers. */
  readonly githubHost?: string | undefined
  /** The ticket's title, when its provider answered it. */
  readonly ticketTitle?: string | undefined
  /** The mission it was started from, checked by the caller. */
  readonly origin?: string | undefined
  /** The key of the user's choice: the same key twice creates one mission. */
  readonly idempotencyKey?: string | undefined
  /** The provider that reads its ticket, the Spec mode and the version read (#95). */
  readonly ticket?: TicketLinkAtCreation | null | undefined
}

/**
 * The missions of a Project linked to a ticket. Jira keys are one ticket when their keys are equal
 * and their hosts are, or one of them is not known: a bare key and a browse URL name the same. A
 * GitHub short form names no host: it is the issue of that repository and number on any host.
 */
export const linkedTo = (projectId: string, reference: TicketReference) => {
  const canonical = canonicalTicket(reference)
  const sameTicket = Predicate.isTagged(reference, 'JiraKey')
    ? and(
        eq(missions.ticketProvider, 'jira'),
        eq(missions.ticketKey, reference.key),
        reference.host === null
          ? undefined
          : inArray(missions.ticketReference, [canonical, `jira:/${reference.key}`]),
      )
    : reference.host === null
      ? and(eq(missions.ticketProvider, 'github'), eq(missions.ticketKey, ticketKeyOf(reference)))
      : eq(missions.ticketReference, canonical)
  return and(eq(missions.projectId, projectId), sameTicket)
}

/** The key of the mission of a Project linked to a ticket, or null when none is. */
export const linkedMission = (
  database: EngineTransaction | Database['Service'],
  projectId: string,
  reference: TicketReference,
) =>
  database
    .select({ keyPrefix: missions.keyPrefix, keyNumber: missions.keyNumber })
    .from(missions)
    .where(linkedTo(projectId, reference))
    .limit(1)
    .pipe(
      Effect.mapError(refusedWhile('reading the tickets of the missions')),
      Effect.map(([row]) => (row === undefined ? null : missionKey(row.keyPrefix, row.keyNumber))),
    )

/**
 * Creates a mission in Planning: its key is its Project's prefix and next number, its title the
 * provisional one, its Now "Planning starts", and `mission.created` is written with it. A ticket
 * already linked to a mission of the Project is refused; a choice already made answers the mission
 * it made. Once committed, `mission.started` is told.
 */
export const createMission = (asked: NewMission, creation: MissionCreation = {}) =>
  Effect.gen(function* () {
    const sentence = given(asked.idea.sentence)
    const ticket = given(asked.idea.ticket)
    if (sentence === null && ticket === null) {
      return yield* new InvalidMissionIdea({ reason: 'give it a sentence or a ticket' })
    }
    if (sentence !== null && sentence.length > MAX_IDEA_LENGTH) {
      return yield* new InvalidMissionIdea({
        reason: `its sentence is longer than ${String(MAX_IDEA_LENGTH)} characters`,
      })
    }
    const project = yield* getProject(asked.projectId)
    const id = yield* identifiers.randomULID.pipe(Effect.orDie)
    const type = asked.type ?? 'feature'
    const reference = creation.reference ?? (ticket === null ? null : parseTicketReference(ticket))
    // What is stored names the host a short form resolved to; the check for a ticket already
    // linked uses the reference as given, so that a short form matches its issue on any host.
    const stored =
      reference !== null && Predicate.isTagged(reference, 'GithubIssue') && reference.host === null
        ? GithubIssue.make({ ...reference, host: creation.githubHost ?? GITHUB_HOST })
        : reference
    const canonical = stored === null ? null : canonicalTicket(stored)
    const title = provisionalTitleOf(
      sentence ??
        creation.ticketTitle ??
        (reference === null ? (ticket ?? '') : ticketKeyOf(reference)),
    )
    const fromChat = creation.fromChat ?? null
    const origin = creation.origin ?? null
    const choice = creation.idempotencyKey ?? null
    // The commit and `mission.started` are one step: an interruption between them would leave a
    // mission no retry starts, since the retry of the same choice finds it already made.
    const made = yield* mutate('creating a mission', (transaction) =>
      Effect.gen(function* () {
        if (choice !== null) {
          const [already] = yield* transaction
            .select({ id: missions.id })
            .from(missions)
            .where(and(eq(missions.projectId, project.id), eq(missions.idempotencyKey, choice)))
            .pipe(Effect.mapError(refusedWhile('reading the missions')))
          if (already !== undefined)
            return { result: { id: already.id, created: false }, events: [] }
        }
        if (reference !== null) {
          const linked = yield* linkedMission(transaction, project.id, reference)
          if (linked !== null) {
            return yield* new TicketAlreadyLinked({
              ticket: ticketKeyOf(reference),
              missionKey: linked,
            })
          }
        }
        const [counter] = yield* transaction
          .update(projects)
          .set({ nextMission: sql`${projects.nextMission} + 1` })
          .where(eq(projects.id, project.id))
          .returning({
            keyPrefix: projects.keyPrefix,
            next: projects.nextMission,
            budgetLaunches: projects.budgetLaunches,
            budgetAttempts: projects.budgetAttempts,
            budgetRounds: projects.budgetRounds,
          })
          .pipe(Effect.mapError(refusedWhile('numbering the mission')))
        if (counter === undefined) return yield* new UnknownProject({ id: project.id })
        // A Project the start could not give its prefix to is given it now.
        const prefix = counter.keyPrefix ?? (yield* givePrefix(transaction, project))
        const at = now()
        const number = counter.next - 1
        const key = missionKey(prefix, number)
        yield* transaction
          .insert(missions)
          .values({
            id,
            projectId: project.id,
            keyPrefix: prefix,
            keyNumber: number,
            title,
            ideaSentence: sentence,
            ideaTicket: reference === null ? ticket : ticketKeyOf(reference),
            type,
            ticketProvider: reference === null ? null : ticketProviderOf(reference),
            ticketKey: reference === null ? null : ticketKeyOf(reference),
            ticketUrl: stored === null ? null : ticketUrlOf(stored),
            ticketReference: canonical,
            searchText: searchTextOf([key, title, sentence, ticket]),
            originId: origin,
            idempotencyKey: choice,
            stage: 'planning',
            round: 0,
            cleanup: null,
            // The budget it starts with is its Project's now (#41); a raise is its own.
            budgetLaunches: counter.budgetLaunches,
            budgetAttempts: counter.budgetAttempts,
            budgetRounds: counter.budgetRounds,
            createdAt: at,
            updatedAt: at,
          })
          .pipe(Effect.mapError(refusedWhile('writing the mission')))
        // Its Spec, in the Project's Spec language as it is now (#85).
        yield* newSpec(transaction, id, project.id)
        // Its ticket's snapshot, base and last known, in the same transaction (#95).
        if (creation.ticket != null && stored !== null) {
          yield* linkMissionTicket(transaction, id, creation.ticket)
        }
        const next = MaskedText.make(PLANNING_STARTS)
        yield* transaction
          .insert(memoryNext)
          .values({
            missionId: id,
            sessionId: '',
            role: 'hemera',
            epoch: 0,
            text: next,
            updatedAt: at,
          })
          .pipe(Effect.mapError(refusedWhile('writing Now')))
        const by = fromChat === null ? BY_THE_USER : BY_HEMERA
        return {
          result: { id, created: true },
          events: [
            missionEvent('mission.created', id, by, {
              projectId: project.id,
              key,
              type,
              title,
              sentence,
              ticket: canonical ?? ticket,
              origin,
              fromChat,
            }),
            missionEvent('memory.now_set', id, BY_HEMERA, {
              sessionId: '',
              role: 'hemera',
              epoch: 0,
              doing: null,
              next,
            }),
          ],
        }
      }),
    ).pipe(
      Effect.tap((committed) =>
        committed.created
          ? MissionStarts.use((starts) => starts.started({ missionId: committed.id }))
          : Effect.void,
      ),
      Effect.uninterruptible,
    )
    // Written a moment ago: a mission that is not there now is a defect, not a refusal.
    return yield* getMission(made.id).pipe(Effect.catchTag('UnknownMission', Effect.die))
  })

const isGuarded = (move: Move): move is GuardedMove =>
  move === 'freeze' || move === 'launch' || move === 'fix' || move === 'ship'

const movedMeanwhile = (move: Move, stage: Stage) =>
  new MoveRefused({ move, stage, reasons: ['the mission moved meanwhile'] })

const CANCELLED = 'the mission was cancelled'

/** The stops are run one round at a time: two rounds at once would call a stopper twice. */
const stopping = Semaphore.makeUnsafe(1)

/**
 * Calls the stoppers a mission's cancel owes, all of them when no mission is named: a stopper
 * that stopped what it held is done with; one that failed keeps its reason and waits for the next
 * call.
 */
export const runStops = (missionId: string | null) =>
  Effect.gen(function* () {
    const stoppers = yield* MissionStoppers
    const database = yield* Database
    const owed = yield* database
      .select()
      .from(missionStops)
      .where(missionId === null ? undefined : eq(missionStops.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the stops')))
    for (const stop of owed) {
      const stopper = stoppers.find((one) => one.name === stop.stopper)
      if (stopper === undefined) continue
      const outcome = yield* Effect.result(stopper.stop(stop.missionId))
      const which = and(
        eq(missionStops.missionId, stop.missionId),
        eq(missionStops.stopper, stop.stopper),
      )
      yield* mutate('writing a stop', (transaction) =>
        (Result.isSuccess(outcome)
          ? transaction.delete(missionStops).where(which)
          : transaction
              .update(missionStops)
              .set({ failedReason: outcome.failure.reason })
              .where(which)
        ).pipe(
          Effect.mapError(refusedWhile('writing a stop')),
          Effect.as({ result: undefined, events: [] }),
        ),
      )
    }
  }).pipe(Semaphore.withPermits(stopping, 1))

/** Cancel: the stage, the pending needs and the stops owed in one transaction, then the stops. */
const cancel = (mission: Mission) =>
  Effect.gen(function* () {
    const stoppers = yield* MissionStoppers
    yield* mutate('cancelling a mission', (transaction) =>
      Effect.gen(function* () {
        const written = yield* transaction
          .update(missions)
          .set({ stage: 'cancelled', cleanup: 'awaiting-confirmation', updatedAt: now() })
          .where(and(eq(missions.id, mission.id), eq(missions.stage, mission.stage)))
          .returning({ id: missions.id })
          .pipe(Effect.mapError(refusedWhile('cancelling the mission')))
        if (written.length === 0) return yield* movedMeanwhile('cancel', mission.stage)
        const expired = yield* expireMissionNeeds(transaction, mission.id, CANCELLED)
        if (stoppers.length > 0) {
          yield* transaction
            .insert(missionStops)
            .values(
              stoppers.map((stopper) => ({
                missionId: mission.id,
                stopper: stopper.name,
                failedReason: null,
              })),
            )
            .pipe(Effect.mapError(refusedWhile('writing the stops')))
        }
        return {
          result: undefined,
          events: [
            missionEvent('mission.cancelled', mission.id, BY_THE_USER, {
              from: mission.stage,
              actor: 'user',
              round: mission.round,
              cleanup: 'awaiting-confirmation',
            }),
            ...expired,
          ],
        }
      }),
    )
    yield* runStops(mission.id)
  })

/**
 * Moves a mission, refused from a stage the move does not leave, by an actor it is not for, or by
 * its guard. Each move is written with the stage it left, its actor and the round.
 */
export const moveMission = (id: string, move: Move, actor: Actor) =>
  Effect.gen(function* () {
    const mission = yield* getMission(id)
    const { stage } = mission
    const to = yield* Effect.fromResult(checkedMove(move, stage, actor))
    if (isGuarded(move)) {
      const guard = (yield* MoveGuards)[move]
      if (guard === undefined) {
        return yield* new MoveRefused({ move, stage, reasons: ['not available yet'] })
      }
      const reasons = yield* guard(mission)
      if (reasons.length > 0) return yield* new MoveRefused({ move, stage, reasons })
    }
    if (move === 'cancel') {
      yield* cancel(mission)
      return yield* getMission(id)
    }
    const round = move === 'fix' ? mission.round + 1 : mission.round
    yield* mutate('moving a mission', (transaction) =>
      Effect.gen(function* () {
        const written = yield* transaction
          .update(missions)
          .set({ stage: to, round, updatedAt: now() })
          .where(and(eq(missions.id, id), eq(missions.stage, stage)))
          .returning({ id: missions.id })
          .pipe(Effect.mapError(refusedWhile('moving the mission')))
        if (written.length === 0) return yield* movedMeanwhile(move, stage)
        return {
          result: undefined,
          events: [
            missionEvent('mission.moved', id, byActor(actor), {
              from: stage,
              to,
              move,
              actor,
              round,
            }),
          ],
        }
      }),
    )
    return yield* getMission(id)
  })

/**
 * Sets a mark on a mission, once: setting it again changes nothing. Refused once the mission has
 * ended, and `fixing` anywhere but in Shipping. Marks are set by the engine service that owns
 * their reason.
 */
export const setMark = (missionId: string, mark: Mark) =>
  Effect.gen(function* () {
    const mission = yield* getMission(missionId)
    if (!isLive(mission.stage)) return yield* new MarkRefused({ reason: 'the mission has ended' })
    if (Predicate.isTagged(mark, 'Fixing') && mission.stage !== 'shipping') {
      return yield* new MarkRefused({ reason: 'a mission is fixing only in Shipping' })
    }
    yield* mutate('setting a mark', (transaction) =>
      Effect.map(markIn(transaction, missionId, mark), (events) => ({ result: undefined, events })),
    )
    return yield* getMission(missionId)
  })

/**
 * Clears a mark from a mission inside a change of its owner's, so the mark goes with what it
 * stood for; answers the events to commit with it.
 */
export const clearMarkIn = (transaction: EngineTransaction, missionId: string, mark: Mark) =>
  Effect.gen(function* () {
    const identity = markIdentity(mark)
    const cleared = yield* transaction
      .delete(missionMarks)
      .where(and(eq(missionMarks.missionId, missionId), eq(missionMarks.identity, identity)))
      .returning({ id: missionMarks.id })
      .pipe(Effect.mapError(refusedWhile('clearing a mark')))
    return cleared.length === 0
      ? []
      : [missionEvent('mission.mark_cleared', missionId, BY_HEMERA, { mark: identity })]
  })

/** Sets a mark in the transaction given, once; answers its event, or none when it was set. */
export const markIn = (transaction: EngineTransaction, missionId: string, mark: Mark) => {
  const identity = markIdentity(mark)
  return transaction
    .insert(missionMarks)
    .values({
      id: crypto.randomUUID(),
      missionId,
      identity,
      mark: JSON.stringify(mark),
      setAt: now(),
    })
    .onConflictDoNothing()
    .returning({ id: missionMarks.id })
    .pipe(
      Effect.mapError(refusedWhile('setting a mark')),
      Effect.map((written) =>
        written.length === 0
          ? []
          : [
              missionEvent('mission.mark_set', missionId, BY_HEMERA, {
                mark: identity,
                sentence: markSentence(mark),
              }),
            ],
      ),
    )
}

/** Clears a mark from a mission; a mark it does not carry changes nothing. */
export const clearMark = (missionId: string, mark: Mark) =>
  Effect.gen(function* () {
    yield* mutate('clearing a mark', (transaction) =>
      Effect.map(clearMarkIn(transaction, missionId, mark), (events) => ({
        result: undefined,
        events,
      })),
    )
    return yield* getMission(missionId)
  })

const readId = Schema.decodeUnknownOption(Schema.String)

/** What an event changed that the window follows: a mission, a need, and a need's mission. */
const changedBy = (event: DomainEvent) =>
  Effect.gen(function* () {
    const changes: MissionsChange[] = []
    const missionIds: string[] = []
    if (event.entityKind === 'mission') missionIds.push(event.entityId)
    if (event.entityKind === 'need') {
      const need = yield* Effect.option(getNeed(event.entityId))
      if (Option.isSome(need)) changes.push(NeedChanged.make({ need: need.value }))
      const owner = readId(event.payload['missionId'])
      if (Option.isSome(owner)) missionIds.push(owner.value)
    }
    for (const id of missionIds) {
      const mission = yield* Effect.option(getMission(id))
      if (Option.isSome(mission)) changes.push(MissionChanged.make({ mission: mission.value }))
    }
    return changes
  })

/** Each mission and each need as a committed change left it, for as long as the caller listens. */
export const missionChanges: Stream.Stream<
  MissionsChange,
  DatabaseError,
  Database | DomainEvents | MissionActivity
> = Stream.unwrap(
  Effect.map(
    DomainEvents.use((events) => events.subscribe),
    (committed) =>
      committed.pipe(
        Stream.mapEffect(changedBy),
        Stream.flatMap((changes) => Stream.fromIterable(changes)),
      ),
  ),
)
