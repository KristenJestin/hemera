/**
 * A mission's Journal: what happened, as a projection of the committed domain events.
 *
 * The projection reads the events in sequence order from its durable cursor, hands each to the
 * mapper registered for its type (`event type → a Journal line, or nothing`), and writes the lines
 * and the new cursor in one transaction (CT-04). A line is keyed by the sequence of the event that
 * produced it: replaying the projection from an older cursor never writes a line twice, and an
 * engine that stops between an event and its projection projects it at its next start. No service
 * writes a Journal row itself: it registers a mapper.
 *
 * Every text and field of a line is masked before it is written. Hemera's own lines are in
 * English, the language of the interface; an agent's line is written as the agent wrote it.
 */

import {
  AgentAuthor,
  HemeraAuthor,
  type JournalFields,
  type JournalLine,
  type JournalPage,
  type JournalRefs,
  type MemoryAuthor,
  type Need,
  UserAuthor,
} from '@hemera/ipc'
import { JOURNAL_PAGE, MOVES, MOVE_NAMES, maskedJson } from '@hemera/core/domain'
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { Effect, Match, Option, Schema } from 'effect'

import type { DomainEvents } from '../domain-events.ts'
import { type DomainEvent, type EventPayload, readEvents } from '../journal.ts'
import { getNeed } from '../needs.ts'
import { needSentence } from './now.ts'
import { Secrets } from '../secrets.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { memoryJournal, missions, projectionCursors } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'

/** The name the Journal's projection keeps its cursor under. */
export const JOURNAL_PROJECTION = 'memory.journal'

/** How many events one transaction of the projection takes. */
const BATCH = 500

/** A line as a mapper drafts it: the projection numbers it with its event and masks it. */
export interface JournalDraft {
  readonly missionId: string
  readonly kind: string
  readonly author: MemoryAuthor
  readonly text: string
  readonly fields?: JournalFields
  readonly refs?: Partial<JournalRefs>
}

/**
 * What an event becomes in the Journal: a line, or nothing. A mapper may read the records the
 * event names (a need's question, its answer), which are never rewritten once written.
 */
export type JournalMapper = (
  event: DomainEvent,
) => Effect.Effect<JournalDraft | null, DatabaseError, Database>

/** A mapper that needs nothing but the event. */
const fromEvent =
  (map: (event: DomainEvent) => JournalDraft | null): JournalMapper =>
  (event) =>
    Effect.succeed(map(event))

const HEMERA: MemoryAuthor = HemeraAuthor.make({})
const USER: MemoryAuthor = UserAuthor.make({})

const readString = Schema.decodeUnknownOption(Schema.String)
const readNumber = Schema.decodeUnknownOption(Schema.Number)

const stringOf = (payload: EventPayload, key: string): string | null =>
  Option.getOrNull(readString(payload[key]))

/** The mission an event is about: the mission itself, or the one its payload names. */
export const missionOfEvent = (event: DomainEvent): string | null =>
  event.entityKind === 'mission' ? event.entityId : stringOf(event.payload, 'missionId')

/** The stage as a sentence says it. */
const stageSaid = (stage: string | null): string =>
  stage === null ? 'an unknown stage' : `${stage.charAt(0).toUpperCase()}${stage.slice(1)}`

/** A move as the user knows it, by its name in an event. */
const moveSaid = (move: string): string => {
  const known = MOVE_NAMES.find((one) => one === move)
  return known === undefined ? move : MOVES[known].label
}

/** Who did what an event records, as the Journal names them. */
const byAuthor = (event: DomainEvent): MemoryAuthor => (event.author === 'human' ? USER : HEMERA)

/** An agent's session, as the payload of a Memory event names it. */
const agentOf = (event: DomainEvent): MemoryAuthor =>
  AgentAuthor.make({
    role: stringOf(event.payload, 'role') ?? 'agent',
    sessionId: stringOf(event.payload, 'sessionId') ?? '',
  })

/** A need's kind, as a sentence says it. */
const needSaid = (event: DomainEvent): string => {
  switch (stringOf(event.payload, 'kind')) {
    case 'Decision':
      return 'decision'
    case 'Environment':
      return 'environment need'
    case 'Error':
      return 'error'
    case 'Permission':
      return 'permission'
    default:
      return 'need'
  }
}

/** What the user answered, in words. */
const answerSaid = (need: Need): string | null =>
  need.answer === null
    ? null
    : Match.value(need.answer).pipe(
        Match.tagsExhaustive({
          Chosen: (answer) => answer.option,
          Written: (answer) => answer.text,
          Permission: (answer) => answer.choice,
        }),
      )

const needLine =
  (
    text: (event: DomainEvent, need: Need | null) => string,
    author: (event: DomainEvent) => MemoryAuthor,
  ): JournalMapper =>
  (event) =>
    Effect.gen(function* () {
      const missionId = stringOf(event.payload, 'missionId')
      if (missionId === null) return null
      const need = yield* getNeed(event.entityId).pipe(
        Effect.map(Option.some),
        Effect.catchTag('UnknownNeed', () => Effect.succeed(Option.none<Need>())),
      )
      const reason = stringOf(event.payload, 'reason')
      return {
        missionId,
        kind: 'need',
        author: author(event),
        text: text(event, Option.getOrNull(need)),
        fields: { kind: stringOf(event.payload, 'kind'), reason },
        refs: { need: event.entityId, task: stringOf(event.payload, 'taskId') },
      }
    })

/** A list of texts in a payload, none when it holds another value. */
const stringsOf = (payload: EventPayload, key: string): ReadonlyArray<string> =>
  Option.getOrElse(readStrings(payload[key]), () => [])

const readStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String))

/** A permission event of a mission, or nothing for one of a Project (the Chat's). */
const ofMission = (event: DomainEvent): string | null =>
  event.entityKind === 'mission' ? event.entityId : null

/** A verdict as a sentence says it, in the middle and at the start. */
const verdictSaid = (verdict: string): readonly [string, string] => {
  switch (verdict) {
    case 'allow':
      return ['allowed', 'Allowed']
    case 'deny':
      return ['denied', 'Denied']
    default:
      return ['asked the user about', 'Asked the user about']
  }
}

/**
 * A permission decision: who decided (Hemera's rules, a grant of the mission, the judge by its
 * name, the user) and why, with the policy's version and level; for a judged call the model and
 * the scores, how it was settled, and why the judge failed when it did. Never the call's raw
 * arguments: the target is the masked text the decision recorded.
 */
const permissionDecided = (event: DomainEvent): JournalDraft | null => {
  const missionId = ofMission(event)
  if (missionId === null) return null
  const verdict = stringOf(event.payload, 'verdict') ?? 'ask'
  const by = stringOf(event.payload, 'by') ?? 'rules'
  const tool = stringOf(event.payload, 'tool') ?? ''
  const target = stringOf(event.payload, 'target') ?? ''
  const reasons = stringsOf(event.payload, 'reasons')
  const choice = stringOf(event.payload, 'choice')
  const judge = stringOf(event.payload, 'judge')
  const numberOf = (key: string) => Option.getOrNull(readNumber(event.payload[key]))
  const what = `${tool} ${target}`.trim()
  const [verb, Verb] = verdictSaid(verdict)
  const because = reasons.length === 0 ? '' : `: ${reasons.join('; ')}`
  const text = Match.value(by).pipe(
    Match.when(
      'user',
      () => `The user ${verb} ${what}${choice === 'allow-for-mission' ? ' for this mission' : ''}`,
    ),
    Match.when('grant', () => `${Verb} ${what} by the mission's grant`),
    Match.when('judge', () => `${Verb} ${what} by ${judge ?? 'the judge'}${because}`),
    Match.orElse(() => `${Verb} ${what} by Hemera's rules${because}`),
  )
  return {
    missionId,
    kind: 'permission',
    author: by === 'user' ? USER : HEMERA,
    text,
    fields: {
      verdict,
      by,
      tool,
      target,
      reasons: [...reasons],
      choice,
      policyVersion: Option.getOrNull(readNumber(event.payload['policyVersion'])),
      level: stringOf(event.payload, 'level'),
      grantId: stringOf(event.payload, 'grantId'),
      requestId: stringOf(event.payload, 'requestId'),
      judge,
      model: stringOf(event.payload, 'model'),
      risk: numberOf('risk'),
      approval: numberOf('approval'),
      userRequested: numberOf('userRequested'),
      settled: stringOf(event.payload, 'settled'),
      latencyMs: numberOf('latencyMs'),
      failure: stringOf(event.payload, 'failure'),
    },
    refs: {
      session: stringOf(event.payload, 'sessionId'),
      run: stringOf(event.payload, 'runId'),
      task: stringOf(event.payload, 'taskId'),
    },
  }
}

/**
 * The mappers of the events that exist when the Memory lands: the missions and their needs (#34),
 * the Memory's own, and a restore. Later tickets add theirs beside these.
 */
export const DEFAULT_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map<string, JournalMapper>([
  [
    'mission.started',
    fromEvent((event) => ({
      missionId: event.entityId,
      kind: 'mission',
      author: byAuthor(event),
      text: [
        `Mission started: ${stringOf(event.payload, 'title') ?? ''}`,
        ...[stringOf(event.payload, 'fromChat')].flatMap((chat) =>
          chat === null ? [] : [`(created from the Chat “${chat}”)`],
        ),
      ].join(' '),
      fields: { key: stringOf(event.payload, 'key'), type: stringOf(event.payload, 'type') },
    })),
  ],
  [
    'mission.moved',
    fromEvent((event) => {
      const from = stringOf(event.payload, 'from')
      const to = stringOf(event.payload, 'to')
      const move = stringOf(event.payload, 'move') ?? ''
      return {
        missionId: event.entityId,
        kind: 'stage',
        author: byAuthor(event),
        text: `Moved from ${stageSaid(from)} to ${stageSaid(to)} (${moveSaid(move)})`,
        fields: {
          from,
          to,
          move,
          round: Option.getOrNull(readNumber(event.payload['round'])),
        },
      }
    }),
  ],
  [
    'mission.cancelled',
    fromEvent((event) => ({
      missionId: event.entityId,
      kind: 'stage',
      author: byAuthor(event),
      text: `Mission cancelled in ${stageSaid(stringOf(event.payload, 'from'))}`,
      fields: { from: stringOf(event.payload, 'from') },
    })),
  ],
  [
    'mission.mark_set',
    fromEvent((event) => ({
      missionId: event.entityId,
      kind: 'mark',
      author: byAuthor(event),
      text: `Marked: ${stringOf(event.payload, 'sentence') ?? stringOf(event.payload, 'mark') ?? ''}`,
      fields: { mark: stringOf(event.payload, 'mark') },
    })),
  ],
  [
    'mission.mark_cleared',
    fromEvent((event) => ({
      missionId: event.entityId,
      kind: 'mark',
      author: byAuthor(event),
      text: `Mark lifted: ${stringOf(event.payload, 'mark') ?? ''}`,
      fields: { mark: stringOf(event.payload, 'mark') },
    })),
  ],
  [
    'mission.restored',
    fromEvent((event) => ({
      missionId: event.entityId,
      kind: 'mission',
      author: HEMERA,
      text: `Restored from the backup of ${stringOf(event.payload, 'takenAt') ?? 'an unknown date'}`,
    })),
  ],
  [
    'need.created',
    needLine(
      (event, need) =>
        `A ${needSaid(event)} waits on the user${need === null ? '' : `: ${needSentence(need)}`}`,
      () => HEMERA,
    ),
  ],
  [
    'need.answered',
    needLine(
      (event, need) => {
        const answer = need === null ? null : answerSaid(need)
        return `The user answered the ${needSaid(event)}${answer === null ? '' : `: ${answer}`}`
      },
      () => USER,
    ),
  ],
  [
    'need.expired',
    needLine(
      (event) =>
        `The ${needSaid(event)} expired: ${stringOf(event.payload, 'reason') ?? 'no reason given'}`,
      byAuthor,
    ),
  ],
  [
    'need.withdrawn',
    needLine(
      (event) =>
        `The ${needSaid(event)} was withdrawn: ${stringOf(event.payload, 'reason') ?? 'no reason given'}`,
      byAuthor,
    ),
  ],
  [
    'memory.journal_added',
    fromEvent((event) => ({
      missionId: event.entityId,
      kind: 'agent',
      author: agentOf(event),
      text: stringOf(event.payload, 'text') ?? '',
      refs: { session: stringOf(event.payload, 'sessionId') },
    })),
  ],
  [
    'memory.note_added',
    fromEvent((event) => ({
      missionId: event.entityId,
      kind: 'note',
      author: agentOf(event),
      text: `Note added: ${stringOf(event.payload, 'text') ?? ''}`,
      fields: {
        number: Option.getOrNull(readNumber(event.payload['number'])),
        topic: stringOf(event.payload, 'topic'),
      },
      refs: { session: stringOf(event.payload, 'sessionId') },
    })),
  ],
  [
    'memory.notes_condensed',
    fromEvent((event) => {
      const replaced = event.payload['replaced']
      const count = Array.isArray(replaced) ? replaced.length : 0
      const number = Option.getOrNull(readNumber(event.payload['number']))
      return {
        missionId: event.entityId,
        kind: 'note',
        author: agentOf(event),
        text: `${String(count)} notes condensed into note ${String(number)}`,
        fields: { number, replaced: Array.isArray(replaced) ? replaced : [] },
        refs: { session: stringOf(event.payload, 'sessionId') },
      }
    }),
  ],
  [
    'memory.evidence_added',
    fromEvent((event) => {
      const sessionId = stringOf(event.payload, 'sessionId')
      return {
        missionId: event.entityId,
        kind: 'evidence',
        author:
          sessionId !== null
            ? agentOf(event)
            : stringOf(event.payload, 'by') === 'user'
              ? USER
              : HEMERA,
        text: `Evidence kept: ${stringOf(event.payload, 'name') ?? ''}`,
        fields: {
          mediaType: stringOf(event.payload, 'mediaType'),
          about: stringOf(event.payload, 'about'),
        },
        refs: { evidence: stringOf(event.payload, 'evidenceId'), session: sessionId },
      }
    }),
  ],
  ['permission.decided', fromEvent(permissionDecided)],
  [
    'permission.result',
    fromEvent((event) => {
      const missionId = ofMission(event)
      if (missionId === null) return null
      const number = Option.getOrNull(readNumber(event.payload['number']))
      const result = stringOf(event.payload, 'result') ?? ''
      return {
        missionId,
        kind: 'permission',
        author: HEMERA,
        text: stringOf(event.payload, 'text') ?? `Request ${String(number)} ended: ${result}`,
        fields: { number, tool: stringOf(event.payload, 'tool'), result },
        refs: {
          session: stringOf(event.payload, 'sessionId'),
          task: stringOf(event.payload, 'taskId'),
        },
      }
    }),
  ],
  [
    'permission.granted',
    fromEvent((event) => {
      const missionId = ofMission(event)
      if (missionId === null) return null
      return {
        missionId,
        kind: 'permission',
        author: USER,
        text: `The user allowed for this mission: ${stringOf(event.payload, 'action') ?? ''}`,
        fields: { grantId: stringOf(event.payload, 'grantId') },
      }
    }),
  ],
  [
    'permission.grant_fell',
    fromEvent((event) => {
      const missionId = ofMission(event)
      if (missionId === null) return null
      return {
        missionId,
        kind: 'permission',
        author: HEMERA,
        text: `A grant of this mission no longer holds: ${stringOf(event.payload, 'action') ?? ''} (${stringOf(event.payload, 'reason') ?? 'no reason given'})`,
        fields: {
          grantId: stringOf(event.payload, 'grantId'),
          reason: stringOf(event.payload, 'reason'),
        },
      }
    }),
  ],
  [
    'permission.revoked',
    fromEvent((event) => {
      const missionId = ofMission(event)
      if (missionId === null) return null
      return {
        missionId,
        kind: 'permission',
        author: USER,
        text: `The user revoked a grant of this mission: ${stringOf(event.payload, 'action') ?? ''}`,
        fields: { grantId: stringOf(event.payload, 'grantId') },
      }
    }),
  ],
])

const NO_REFS: JournalRefs = { need: null, task: null, run: null, evidence: null, session: null }

interface AuthorColumns {
  readonly authorKind: string
  readonly authorRole: string | null
  readonly authorSession: string | null
}

const authorColumns = Match.type<MemoryAuthor>().pipe(
  Match.tagsExhaustive({
    Hemera: (): AuthorColumns => ({ authorKind: 'hemera', authorRole: null, authorSession: null }),
    User: (): AuthorColumns => ({ authorKind: 'user', authorRole: null, authorSession: null }),
    Agent: (agent): AuthorColumns => ({
      authorKind: 'agent',
      authorRole: agent.role,
      authorSession: agent.sessionId,
    }),
  }),
)

/** The author of a row, as columns hold it. */
export const authorOf = (row: AuthorColumns): MemoryAuthor => {
  if (row.authorKind === 'agent') {
    return AgentAuthor.make({ role: row.authorRole ?? 'agent', sessionId: row.authorSession ?? '' })
  }
  return row.authorKind === 'user' ? USER : HEMERA
}

export { authorColumns as authorColumnsOf }

const readFields = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Record(
      Schema.String,
      Schema.Union([
        Schema.String,
        Schema.Number,
        Schema.Boolean,
        Schema.Null,
        Schema.Array(Schema.String),
      ]),
    ),
  ),
)
const readRefs = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      need: Schema.NullOr(Schema.String),
      task: Schema.NullOr(Schema.String),
      run: Schema.NullOr(Schema.String),
      evidence: Schema.NullOr(Schema.String),
      session: Schema.NullOr(Schema.String),
    }),
  ),
)

type JournalRow = typeof memoryJournal.$inferSelect

export const lineOf = (row: JournalRow): JournalLine => ({
  sequence: row.sequence,
  missionId: row.missionId,
  at: row.at,
  kind: row.kind,
  author: authorOf(row),
  text: row.text,
  fields: Option.getOrElse(readFields(row.fields), () => ({})),
  refs: Option.getOrElse(readRefs(row.refs), () => NO_REFS),
})

/** What one pass of the projection did: the missions it touched and the lines it added. */
export interface Projected {
  readonly missions: ReadonlyArray<string>
  readonly added: ReadonlyArray<JournalLine>
  /** Whether it reached the end of the event log. */
  readonly done: boolean
}

/** The cursor of a projection, 0 before its first pass. */
export const cursorOf = (name: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ cursor: projectionCursors.cursor })
      .from(projectionCursors)
      .where(eq(projectionCursors.name, name))
      .pipe(Effect.mapError(refusedWhile('reading the cursor of the Journal')))
    return row?.cursor ?? 0
  })

/** Sets the cursor of a projection back, as a replay does. */
export const rewindTo = (name: string, cursor: number) =>
  mutate('setting the cursor of the Journal', (transaction) =>
    transaction
      .insert(projectionCursors)
      .values({ name, cursor })
      .onConflictDoUpdate({ target: projectionCursors.name, set: { cursor } })
      .pipe(
        Effect.mapError(refusedWhile('setting the cursor of the Journal')),
        Effect.as({ result: undefined, events: [] }),
      ),
  )

/**
 * One transaction of the projection: the events after the cursor, at most a batch of them, mapped
 * into lines, and the lines with the new cursor written together. `before` runs once the events
 * are read and before anything is written: a test holds the projection there.
 */
export const projectBatch = (
  mappers: ReadonlyMap<string, JournalMapper>,
  before: (events: ReadonlyArray<DomainEvent>) => Effect.Effect<void>,
): Effect.Effect<Projected, DatabaseError, Database | DomainEvents | Secrets> =>
  Effect.gen(function* () {
    const cursor = yield* cursorOf(JOURNAL_PROJECTION)
    const page = yield* readEvents({ after: cursor, limit: BATCH }).pipe(
      // The cursor is read from its own column, a whole number by construction.
      Effect.catchTag('InvalidCursor', Effect.die),
    )
    const last = page.events.at(-1)
    if (last === undefined) return { missions: [], added: [], done: true }
    yield* before(page.events)
    const secrets = yield* Secrets
    const named = [...new Set(page.events.flatMap((event) => missionOfEvent(event) ?? []))]
    const database = yield* Database
    // A line of a mission that no longer exists is not written: the event stays the record.
    const existing = new Set(
      named.length === 0
        ? []
        : (yield* database
            .select({ id: missions.id })
            .from(missions)
            .where(inArray(missions.id, named))
            .pipe(Effect.mapError(refusedWhile('reading the missions')))).map((row) => row.id),
    )
    const drafts = yield* Effect.forEach(page.events, (event) => {
      const mapper = mappers.get(event.type)
      return mapper === undefined
        ? Effect.succeed(null)
        : Effect.map(mapper(event), (draft) => (draft === null ? null : { event, draft }))
    })
    const rows = drafts.flatMap((mapped) => {
      if (mapped === null || !existing.has(mapped.draft.missionId)) return []
      const { event, draft } = mapped
      return [
        {
          sequence: event.sequence,
          missionId: draft.missionId,
          at: event.occurredAt,
          kind: draft.kind,
          ...authorColumns(draft.author),
          text: secrets.mask(draft.text),
          fields: maskedJson(secrets.maskRecord(draft.fields ?? {})),
          refs: JSON.stringify({ ...NO_REFS, ...draft.refs }),
        },
      ]
    })
    const added = yield* mutate('projecting the Journal', (transaction) =>
      Effect.gen(function* () {
        const written =
          rows.length === 0
            ? []
            : yield* transaction
                .insert(memoryJournal)
                .values(rows)
                .onConflictDoNothing()
                .returning()
                .pipe(Effect.mapError(refusedWhile('writing the Journal')))
        yield* transaction
          .insert(projectionCursors)
          .values({ name: JOURNAL_PROJECTION, cursor: last.sequence })
          .onConflictDoUpdate({
            target: projectionCursors.name,
            set: { cursor: last.sequence },
          })
          .pipe(Effect.mapError(refusedWhile('moving the cursor of the Journal')))
        return { result: written, events: [] }
      }),
    )
    return {
      missions: named.filter((id) => existing.has(id)),
      added: added.map(lineOf),
      done: page.next === null,
    }
  })

/** A page of a mission's Journal, newest first, before the line `before` when it is given. */
export const journalPage = (missionId: string, before: number | null, size = JOURNAL_PAGE) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(memoryJournal)
      .where(
        and(
          eq(memoryJournal.missionId, missionId),
          before === null ? undefined : lt(memoryJournal.sequence, before),
        ),
      )
      .orderBy(desc(memoryJournal.sequence))
      .limit(size + 1)
      .pipe(Effect.mapError(refusedWhile('reading the Journal')))
    const lines = rows.slice(0, size).map(lineOf)
    return {
      lines,
      before: rows.length > size ? (lines.at(-1)?.sequence ?? null) : null,
    } satisfies JournalPage
  })

/** Every line of a mission's Journal, oldest first, for its markdown file. */
export const wholeJournal = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(memoryJournal)
      .where(eq(memoryJournal.missionId, missionId))
      .orderBy(memoryJournal.sequence)
      .pipe(Effect.mapError(refusedWhile('reading the Journal')))
    return rows.map(lineOf)
  })

/**
 * The last line written by a session lineage, or about it: what a resume tells the session it
 * left off at. Null when the Journal holds none.
 */
export const lastLineOf = (missionId: string, lineage: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(memoryJournal)
      .where(
        and(
          eq(memoryJournal.missionId, missionId),
          or(
            eq(memoryJournal.authorSession, lineage),
            sql`json_extract(${memoryJournal.refs}, '$.session') = ${lineage}`,
          ),
        ),
      )
      .orderBy(desc(memoryJournal.sequence))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the Journal')))
    return row === undefined ? null : lineOf(row)
  })
