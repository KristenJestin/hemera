/**
 * The missions opened last, which Home lists as Recent. The list is the engine's, kept as the
 * identifiers of the missions in `app_preferences`, so a restart and a second window read the
 * same one.
 */

import { type Mission, UnknownMission } from '@hemera/ipc'
import { eq, inArray, sql } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import { type MissionActivity, missionsOf } from '../missions.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { appPreferences, missions } from '../storage/schema.ts'
import { type DomainEvents } from '../domain-events.ts'
import { mutate } from '../transaction.ts'

/** How many missions Recent keeps. */
export const RECENT_LIMIT = 8

const KEY = 'home.recent'

const codec = Schema.fromJsonString(Schema.Array(Schema.String))
const readIds = Schema.decodeUnknownOption(codec)
const writeIds = Schema.encodeSync(codec)

/** The identifiers kept, the last opened first; none when nothing was kept or it cannot be read. */
const keptIds = (value: string | undefined): ReadonlyArray<string> =>
  Option.getOrElse(readIds(value), () => [])

/** At most eight missions, the last opened first. A mission that no longer exists is not listed. */
export const recentMissions: Effect.Effect<
  ReadonlyArray<Mission>,
  DatabaseError,
  Database | MissionActivity
> = Effect.gen(function* () {
  const database = yield* Database
  const [row] = yield* database
    .select()
    .from(appPreferences)
    .where(eq(appPreferences.key, KEY))
    .pipe(Effect.mapError(refusedWhile('reading the missions opened last')))
  const ids = keptIds(row?.value).slice(0, RECENT_LIMIT)
  if (ids.length === 0) return []
  const rows = yield* database
    .select()
    .from(missions)
    .where(inArray(missions.id, [...ids]))
    .pipe(Effect.mapError(refusedWhile('reading the missions opened last')))
  const whole = new Map((yield* missionsOf(rows)).map((mission) => [mission.id, mission]))
  return ids.flatMap((id) => {
    const mission = whole.get(id)
    return mission === undefined ? [] : [mission]
  })
})

/** The user opened a mission: it becomes the first of Recent, once. */
export const missionOpened = (
  missionId: string,
): Effect.Effect<void, DatabaseError | UnknownMission, Database | DomainEvents> =>
  // One at a time with every other write: two missions opened together are both kept.
  mutate('keeping the missions opened last', (transaction) =>
    Effect.gen(function* () {
      const [mission] = yield* transaction
        .select({ id: missions.id })
        .from(missions)
        .where(eq(missions.id, missionId))
        .pipe(Effect.mapError(refusedWhile('reading a mission')))
      if (mission === undefined) return yield* new UnknownMission({ id: missionId })
      const [row] = yield* transaction
        .select()
        .from(appPreferences)
        .where(eq(appPreferences.key, KEY))
        .pipe(Effect.mapError(refusedWhile('reading the missions opened last')))
      const ids = [missionId, ...keptIds(row?.value).filter((id) => id !== missionId)].slice(
        0,
        RECENT_LIMIT,
      )
      yield* transaction
        .insert(appPreferences)
        .values({ key: KEY, value: writeIds(ids) })
        .onConflictDoUpdate({ target: appPreferences.key, set: { value: sql`excluded.value` } })
        .pipe(Effect.mapError(refusedWhile('keeping the missions opened last')))
      return { result: undefined, events: [] }
    }),
  )
