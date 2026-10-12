/**
 * The helpers as they are kept (#145): their rows, their events and their lines in the Journal,
 * the results queued for their parents, and what the Building and Planning pages read of them
 * (each one's chip with its step, one helper whole, and the chips again at each change).
 *
 * Every event of a helper is about its mission (`entityKind` mission), so the mission's Journal and
 * whoever follows the mission hear it.
 */

import {
  FREE_HELPER_ICON,
  HELPER_STATES,
  type HelperPlace,
  type HelperState,
  PROTOTYPER,
  PrototypeVerdict,
  avatarToneOf,
  definedHelperNamed,
  helperLabel,
} from '@hemera/core/domain'
import {
  type HelperChip,
  type HelperDetail,
  HemeraAuthor,
  UnknownHelper,
  UserAuthor,
  UnknownMission,
} from '@hemera/ipc'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Effect, Option, Schema, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import type { EventPayload, NewEvent } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'
import { ProbeSteps } from '../planning/probe-steps.ts'
import { sessionsOfLineage } from '../sessions/store.ts'
import { threadOf } from '../sessions/thread.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { helpers, missions, queuedResults } from '../storage/schema.ts'

export type HelperRow = typeof helpers.$inferSelect

type Reader = Database['Service'] | EngineTransaction

/** The folder of a mission's folder its Prototypers' throwaway folders live in. */
export const PROTOTYPES_FOLDER = 'prototypes'

/** What a free helper is called on its chip. */
export const FREE_HELPER_NAME = 'Helper'

const ToolsJson = Schema.fromJsonString(Schema.Array(Schema.String))
const readTools = Schema.decodeUnknownOption(ToolsJson)
export const writeTools = Schema.encodeSync(ToolsJson)

/** The tools a free helper's parent chose for it, or null for its role's. */
export const chosenToolsOf = (row: HelperRow): ReadonlyArray<string> | null =>
  row.tools === null ? null : Option.getOrNull(readTools(row.tools))

const stateOf = (state: string): HelperState =>
  HELPER_STATES.find((one) => one === state) ?? 'failed'

const placeOf = (place: string): HelperPlace => (place === 'prototype' ? 'prototype' : 'workspace')

const readVerdict = Schema.decodeUnknownOption(PrototypeVerdict)
/** A Prototyper's verdict as its row keeps it, or null before the user judged it. */
export const verdictOf = (row: Pick<HelperRow, 'verdict'>): PrototypeVerdict | null =>
  Option.getOrNull(readVerdict(row.verdict))

/** A helper's row by its session's lineage, or null for a session that runs no helper. */
export const helperOfLineage = (lineage: string, reader?: Reader) =>
  Effect.gen(function* () {
    const database = reader ?? (yield* Database)
    const [row] = yield* database
      .select()
      .from(helpers)
      .where(eq(helpers.lineage, lineage))
      .pipe(Effect.mapError(refusedWhile('reading a helper')))
    return row ?? null
  })

/** A helper's row by its id, or null. */
export const helperRow = (helperId: string, reader?: Reader) =>
  Effect.gen(function* () {
    const database = reader ?? (yield* Database)
    const [row] = yield* database
      .select()
      .from(helpers)
      .where(eq(helpers.id, helperId))
      .pipe(Effect.mapError(refusedWhile('reading a helper')))
    return row ?? null
  })

/** A mission's helpers, the first launched first. */
export const helperRowsOf = (missionId: string, reader?: Reader) =>
  Effect.gen(function* () {
    const database = reader ?? (yield* Database)
    return yield* database
      .select()
      .from(helpers)
      .where(eq(helpers.missionId, missionId))
      .orderBy(asc(helpers.number))
      .pipe(Effect.mapError(refusedWhile('reading the helpers')))
  })

/** The results queued for a parent and not delivered yet. */
export const undeliveredResults = Effect.gen(function* () {
  const database = yield* Database
  return yield* database
    .select()
    .from(queuedResults)
    .where(isNull(queuedResults.deliveredAt))
    .orderBy(asc(queuedResults.queuedAt))
    .pipe(Effect.mapError(refusedWhile('reading the queued results')))
})

/** A queued result of a helper, not delivered yet, or null. */
export const queuedResultIn = (transaction: EngineTransaction, helperId: string) =>
  transaction
    .select()
    .from(queuedResults)
    .where(and(eq(queuedResults.helperId, helperId), isNull(queuedResults.deliveredAt)))
    .pipe(
      Effect.mapError(refusedWhile('reading a queued result')),
      Effect.map(([row]) => row ?? null),
    )

/** A helper's event, about its mission; a Prototyper's says so, for the Journal's Planning lines. */
export const helperEvent = (
  type: string,
  row: Pick<HelperRow, 'id' | 'missionId' | 'number' | 'definition'>,
  payload: NewEvent['payload'] = {},
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: row.missionId,
  source: 'system',
  author: 'hemera',
  payload: {
    helperId: row.id,
    helper: helperLabel(row.number),
    definition: row.definition,
    ...payload,
  },
})

/** What a helper is called: its definition's name, or `Helper`. */
export const helperNameOf = (row: Pick<HelperRow, 'definition'>): string =>
  (row.definition === null ? null : definedHelperNamed(row.definition)?.name) ?? FREE_HELPER_NAME

/** A helper as its chip shows it, with its latest step while it runs. */
export const chipOf = (row: HelperRow, step: string | null): HelperChip => {
  const defined = row.definition === null ? null : definedHelperNamed(row.definition)
  const label = helperLabel(row.number)
  return {
    id: row.id,
    missionId: row.missionId,
    number: row.number,
    label,
    name: helperNameOf(row),
    definition: row.definition,
    icon: defined?.icon ?? FREE_HELPER_ICON,
    letter: (defined?.name ?? label).charAt(0).toUpperCase(),
    tone: defined?.colour ?? avatarToneOf(label),
    depth: row.depth,
    task: row.taskId,
    state: stateOf(row.state),
    stuck: row.stuck,
    step: row.state === 'running' ? step : null,
    verdict: verdictOf(row),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  }
}

const missionThere = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [mission] = yield* database
      .select({ id: missions.id })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return yield* new UnknownMission({ id: missionId })
  })

/** Whether a helper is a Prototyper: Planning's, never listed with the Building's (#222). */
const isPrototyper = (row: Pick<HelperRow, 'definition'>): boolean =>
  row.definition === PROTOTYPER.id

/** The chips of a mission's helpers that `keep` keeps, with their steps. */
const chipsOf = (missionId: string, keep: (row: HelperRow) => boolean) =>
  Effect.gen(function* () {
    yield* missionThere(missionId)
    const steps = yield* ProbeSteps
    return yield* Effect.forEach((yield* helperRowsOf(missionId)).filter(keep), (row) =>
      Effect.map(steps.of(row.id), (step) => chipOf(row, step)),
    )
  })

/** A mission's Building helpers as their chips show them. */
export const listHelpers = (missionId: string) => chipsOf(missionId, (row) => !isPrototyper(row))

/** A mission's Prototypers as their chips show them, for the Planning page (#222). */
export const listPrototypes = (missionId: string) => chipsOf(missionId, isPrototyper)

/** The result a helper handed back, as its parent read it, once it is done. */
const resultTextOf = (row: HelperRow): string | null => row.result

/** One helper whole; its sessions' hidden thread only when asked. */
export const readHelper = (helperId: string, withThread: boolean) =>
  Effect.gen(function* () {
    const row = yield* helperRow(helperId)
    if (row === null) return yield* new UnknownHelper({ id: helperId })
    const sessions = withThread
      ? (yield* sessionsOfLineage(row.lineage)).toSorted((a, b) => a.epoch - b.epoch)
      : []
    const lines = yield* Effect.forEach(sessions, (session) => threadOf(session.id))
    const detail: HelperDetail = {
      ...chipOf(row, yield* ProbeSteps.use((steps) => steps.of(row.id))),
      brief: row.brief,
      place: placeOf(row.place),
      folder: row.folder,
      writes: row.writes,
      result: resultTextOf(row),
      failure: row.failure,
      verdictNote: row.verdictNote,
      judgedAt: row.judgedAt,
      thread: withThread ? lines.flat() : null,
    }
    return detail
  })

/** Chips now, then again after each change of one of the mission's helpers, and each new step. */
const chipChanges = <A, E, R>(missionId: string, list: Effect.Effect<A, E, R>) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const committed = yield* DomainEvents.use((events) => events.subscribe)
      const stepped = yield* ProbeSteps.use((steps) => steps.subscribe)
      return Stream.concat(
        Stream.fromEffect(list),
        Stream.merge(
          committed.pipe(
            Stream.filter(
              (event) =>
                event.entityKind === 'mission' &&
                event.entityId === missionId &&
                (event.type.startsWith('helper.') || event.type.startsWith('prototype.')),
            ),
          ),
          stepped.pipe(Stream.filter((mission) => mission === missionId)),
        ).pipe(Stream.mapEffect(() => list)),
      )
    }),
  )

/** A mission's Building chips now, then again at each change. */
export const helperChanges = (missionId: string) => chipChanges(missionId, listHelpers(missionId))

/** A mission's Prototypers' chips now, then again at each change (#222). */
export const prototypeChanges = (missionId: string) =>
  chipChanges(missionId, listPrototypes(missionId))

const readString = Schema.decodeUnknownOption(Schema.String)
const readStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String))
const stringOf = (payload: EventPayload, key: string): string =>
  Option.getOrElse(readString(payload[key]), () => '')
const stringsOf = (payload: EventPayload, key: string): ReadonlyArray<string> =>
  Option.getOrElse(readStrings(payload[key]), () => [])

/** A helper's line: a Prototyper's is Planning's (#222), a free helper's Building's. */
const lineOf =
  (text: (payload: EventPayload) => string): JournalMapper =>
  (event) =>
    Effect.succeed({
      missionId: event.entityId,
      kind: stringOf(event.payload, 'definition') === 'prototyper' ? 'planning' : 'building',
      author: HemeraAuthor.make({}),
      text: text(event.payload),
    })

const listed = (items: ReadonlyArray<string>) => (items.length === 0 ? 'nothing' : items.join('; '))

/** The helpers' lines in the mission's Journal, one per domain event. */
export const HELPER_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map([
  [
    'helper.launched',
    lineOf((payload) => {
      const task = stringOf(payload, 'task')
      return `${stringOf(payload, 'helper')} (${stringOf(payload, 'name')}) was launched${task === '' ? '' : ` on ${task}`}.`
    }),
  ],
  ['helper.refused', lineOf((payload) => `A helper was refused: ${stringOf(payload, 'why')}`)],
  [
    'helper.stuck',
    lineOf((payload) => `${stringOf(payload, 'helper')} has been silent: Hemera replaces it.`),
  ],
  [
    'helper.replaced',
    lineOf(
      (payload) => `${stringOf(payload, 'helper')} was replaced: ${stringOf(payload, 'reason')}.`,
    ),
  ],
  [
    'helper.ended',
    lineOf((payload) => `${stringOf(payload, 'helper')} ended: ${stringOf(payload, 'summary')}`),
  ],
  [
    'helper.failed',
    lineOf((payload) => `${stringOf(payload, 'helper')} failed: ${stringOf(payload, 'why')}`),
  ],
  [
    'prototype.result',
    lineOf(
      (payload) =>
        `${stringOf(payload, 'helper')} prototyped. Works: ${listed(stringsOf(payload, 'works'))}. Does not work: ${listed(stringsOf(payload, 'doesNotWork'))}. Files: ${listed(stringsOf(payload, 'files'))}.`,
    ),
  ],
  [
    'prototype.judged',
    (event) => {
      const note = stringOf(event.payload, 'note')
      const helper = stringOf(event.payload, 'helper')
      return Effect.succeed({
        missionId: event.entityId,
        kind: 'planning',
        author: UserAuthor.make({}),
        text: `${stringOf(event.payload, 'verdict') === 'validated' ? `Validated ${helper}'s prototype` : `Set ${helper}'s prototype aside`}${note === '' ? '.' : `: ${note}`}`,
      })
    },
  ],
])
