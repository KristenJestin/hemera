/**
 * Where the profile stands, which is what a diagnostic and a refusal are written from (D3-03).
 *
 * Four of the five things it reports are what this build is — its channel, its version and the
 * folder it opened. The last two come from the profile itself: the migration it stands at, as
 * the migrator wrote it down, and the version that wrote it last.
 */

import type { Channel, ProfileStatus as Reported } from '@hemera/ipc'
import { Context, Effect, Layer } from 'effect'

import { appliedMigrations, writtenByVersion } from './migrate.ts'
import { DatabaseError, SqliteClient } from './storage/database.ts'

/** What this process knows about itself before it has read anything. */
export interface ProfileIdentity {
  directory: string
  channel: Channel
  version: string
}

export class ProfileStatus extends Context.Service<
  ProfileStatus,
  { readonly read: Effect.Effect<Reported, DatabaseError> }
>()('ProfileStatus') {}

export function profileStatusLayer(identity: ProfileIdentity) {
  return Layer.effect(
    ProfileStatus,
    Effect.gen(function* () {
      const client = yield* SqliteClient

      return {
        read: Effect.gen(function* () {
          const applied = yield* appliedMigrations
          return {
            directory: identity.directory,
            channel: identity.channel,
            version: identity.version,
            lastMigration: applied.at(-1)?.name ?? null,
            writtenByVersion: yield* writtenByVersion,
          }
        }).pipe(
          Effect.provideService(SqliteClient, client),
          Effect.mapError((cause) => new DatabaseError({ doing: 'reading the status', cause })),
        ),
      }
    }),
  )
}
