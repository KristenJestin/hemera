/**
 * Where the engine stands, which is what a diagnostic and a refusal are written from (D3-03).
 *
 * Four of the five things it reports are what this build is — its channel, its version and the
 * folder it opened. The last two come from the data folder itself: the migration it stands at,
 * as the migrator wrote it down, and the version that wrote it last.
 */

import type { Channel, EngineStatus as Reported } from '@hemera/ipc'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { Context, Effect, Layer } from 'effect'

import { BACKUPS_FOLDER, appliedMigrations, writtenByVersion } from './migrate.ts'
import { DatabaseError, SqliteClient } from './storage/database.ts'

/** What this process knows about itself before it has read anything. */
export interface EngineIdentity {
  directory: string
  channel: Channel
  version: string
}

export class EngineStatus extends Context.Service<
  EngineStatus,
  { readonly read: Effect.Effect<Reported, DatabaseError> }
>()('EngineStatus') {}

export function engineStatusLayer(identity: EngineIdentity) {
  return Layer.effect(
    EngineStatus,
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
            ...measured(identity.directory),
          }
        }).pipe(
          Effect.provideService(SqliteClient, client),
          Effect.mapError((cause) => new DatabaseError({ doing: 'reading the status', cause })),
        ),
      }
    }),
  )
}

/**
 * How big the data folder's database is and how many copies of it there are.
 *
 * Read off the filesystem rather than asked of the database: a page count times a page size is
 * the size of what SQLite is using, and what the settings show is the size of the file the user
 * can see. Both are read at the moment they are asked for, because both change without anyone
 * touching a row.
 *
 * Nothing here fails. A folder of backups that is not there is none taken yet, and a file that
 * cannot be measured is one the settings say nothing about — neither is a reason to refuse a
 * status somebody asked for.
 */
function measured(directory: string): Pick<Reported, 'databaseSize' | 'backups'> {
  const backups = join(directory, BACKUPS_FOLDER)
  const taken = existsSync(backups) ? readdirSync(backups).toSorted() : []
  return {
    databaseSize: sizeOf(join(directory, 'hemera.sqlite')),
    backups: { count: taken.length, latest: taken.at(-1) ?? null },
  }
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}
