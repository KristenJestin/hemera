/**
 * "Allow for this mission" (CT-19): a grant the user gives on a permission need of a mission,
 * stored with the mission. It holds for the same action only, in the whole mission, for every role
 * (helpers included) and every later session, until the user revokes it or its identity moves.
 *
 * Before each use the identity is recomputed: a grant whose script changed, whose program resolves
 * elsewhere, or whose catalogue line changed falls by itself, with a line in the Journal, and the
 * call goes on through the normal order. A grant never reaches a sensitive place: the order checks
 * the refusals and the sensitive places before it asks for a grant. Each use is counted and
 * recorded by the order as a decision `by: grant`.
 */

import { ActionIdentity, type Masked, grantKey, identityChange } from '@hemera/core/domain'
import { type MissionGrant, UnknownMission } from '@hemera/ipc'
import { and, asc, eq, sql } from 'drizzle-orm'
import { Effect, Layer, Option, Schema } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import type { DomainEvents } from '../domain-events.ts'
import type { EventPayload, NewEvent } from '../journal.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import { missionGrants, missions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { callIdentity } from './identity.ts'
import { MissionGrants } from './ports.ts'

const readIdentity = Schema.decodeUnknownOption(Schema.fromJsonString(ActionIdentity))

const GRANT_STATES = ['live', 'revoked', 'fallen'] as const

const now = (): string => new Date().toISOString()

const missionEvent = (type: string, missionId: string, payload: EventPayload): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: missionId,
  source: 'system',
  author: 'hemera',
  payload,
})

/**
 * Writes a grant for an action of a mission, inside the transaction of the answer that gives it;
 * a live grant for the same action is kept rather than doubled. Answers its id and its events.
 */
export const grantWritten = (
  transaction: EngineTransaction,
  given: {
    readonly missionId: string
    readonly identity: ActionIdentity
    readonly action: Masked<string>
    readonly requestId: string | null
  },
) =>
  Effect.gen(function* () {
    const key = grantKey(given.identity)
    const [live] = yield* transaction
      .select({ id: missionGrants.id })
      .from(missionGrants)
      .where(
        and(
          eq(missionGrants.missionId, given.missionId),
          eq(missionGrants.key, key),
          eq(missionGrants.state, 'live'),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the grants')))
    if (live !== undefined) return { id: live.id, events: [] }
    const id = crypto.randomUUID()
    yield* transaction
      .insert(missionGrants)
      .values({
        id,
        missionId: given.missionId,
        key,
        identity: JSON.stringify(given.identity),
        action: given.action,
        givenBy: 'user',
        givenAt: now(),
        uses: 0,
        state: 'live',
        endedReason: null,
        endedAt: null,
      })
      .pipe(Effect.mapError(refusedWhile('writing a grant')))
    return {
      id,
      events: [
        {
          ...missionEvent('permission.granted', given.missionId, {
            grantId: id,
            action: given.action,
            requestId: given.requestId,
          }),
          source: 'ui',
          author: 'human',
        } satisfies NewEvent,
      ],
    }
  })

/**
 * The live grant of a mission for this action, used once: its id, or null when there is none. A
 * grant for the same key whose identity moved falls, with its reason, and allows nothing.
 */
export const useGrant = (missionId: string, identity: ActionIdentity) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(missionGrants)
      .where(
        and(
          eq(missionGrants.missionId, missionId),
          eq(missionGrants.key, grantKey(identity)),
          eq(missionGrants.state, 'live'),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the grants')))
    for (const row of rows) {
      const granted = readIdentity(row.identity)
      const change = Option.isNone(granted)
        ? 'it could not be read'
        : identityChange(granted.value, identity)
      if (change === null) {
        const used = yield* mutate('using a grant', (transaction) =>
          transaction
            .update(missionGrants)
            .set({ uses: sql`${missionGrants.uses} + 1` })
            .where(and(eq(missionGrants.id, row.id), eq(missionGrants.state, 'live')))
            .returning({ id: missionGrants.id })
            .pipe(
              Effect.mapError(refusedWhile('using a grant')),
              Effect.map((written) => ({ result: written.length > 0, events: [] })),
            ),
        )
        if (used) return row.id
        continue
      }
      yield* mutate('ending a grant', (transaction) =>
        transaction
          .update(missionGrants)
          .set({ state: 'fallen', endedReason: change, endedAt: now() })
          .where(and(eq(missionGrants.id, row.id), eq(missionGrants.state, 'live')))
          .returning({ id: missionGrants.id })
          .pipe(
            Effect.mapError(refusedWhile('ending a grant')),
            Effect.map((written) => ({
              result: undefined,
              events:
                written.length === 0
                  ? []
                  : [
                      missionEvent('permission.grant_fell', missionId, {
                        grantId: row.id,
                        action: row.action,
                        reason: change,
                      }),
                    ],
            })),
          ),
      )
    }
    return null
  })

/** The grants hook of the order: a live grant of the call's mission for the same action. */
export const missionGrantsLayer = (settings: {
  readonly platform: NodeJS.Platform
  readonly log: Log
}) =>
  Layer.effect(
    MissionGrants,
    Effect.gen(function* () {
      const context = yield* Effect.context<Database | DomainEvents>()
      return {
        allowing: (call) =>
          Effect.gen(function* () {
            const missionId = call.session.missionId
            if (missionId === null) return null
            const identity = yield* Effect.promise(() => callIdentity(call, settings.platform))
            return yield* useGrant(missionId, identity)
          }).pipe(
            // A grant that cannot be read allows nothing: the call goes on through the order.
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                settings.log(`permissions: the grants could not be read: ${String(cause)}`)
                return null
              }),
            ),
            Effect.provide(context),
          ),
      }
    }),
  )

/** The grants of a mission, oldest first, whatever they became. */
export const listGrants = (
  missionId: string,
): Effect.Effect<ReadonlyArray<MissionGrant>, DatabaseError | UnknownMission, Database> =>
  Effect.gen(function* () {
    const database = yield* Database
    const [mission] = yield* database
      .select({ id: missions.id })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return yield* new UnknownMission({ id: missionId })
    const rows = yield* database
      .select()
      .from(missionGrants)
      .where(eq(missionGrants.missionId, missionId))
      .orderBy(asc(missionGrants.givenAt), asc(sql`rowid`))
      .pipe(Effect.mapError(refusedWhile('reading the grants')))
    return rows.map((row) => ({
      id: row.id,
      missionId: row.missionId,
      action: row.action,
      givenBy: row.givenBy,
      givenAt: row.givenAt,
      uses: row.uses,
      state: GRANT_STATES.find((one) => one === row.state) ?? 'fallen',
      reason: row.endedReason,
    }))
  })

/** Revokes a live grant, from the next call, with a line in the Journal; any other is left. */
export const revokeGrant = (grantId: string) =>
  mutate('revoking a grant', (transaction) =>
    transaction
      .update(missionGrants)
      .set({ state: 'revoked', endedReason: 'revoked by the user', endedAt: now() })
      .where(and(eq(missionGrants.id, grantId), eq(missionGrants.state, 'live')))
      .returning()
      .pipe(
        Effect.mapError(refusedWhile('revoking a grant')),
        Effect.map((written) => ({
          result: undefined,
          events: written.map((row): NewEvent => ({
            ...missionEvent('permission.revoked', row.missionId, {
              grantId: row.id,
              action: row.action,
            }),
            source: 'ui',
            author: 'human',
          })),
        })),
      ),
  )
