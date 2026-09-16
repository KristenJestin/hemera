/**
 * The database itself, and the one door the storage layer comes through (design D3-04, D3-11).
 *
 * Every other file of this process asks for `Database` and gets a query builder; none of them
 * names the driver, the client or `node:sqlite`. The boundary check refuses the storage layer
 * anywhere outside this folder, and this file is the only reason it has to be allowed here.
 *
 * The client underneath is re-exported rather than imported twice, for the two things a schema
 * cannot express and a query builder will not do: the checkpoint that makes a backup coherent,
 * and the backup itself.
 */

import { SqliteClient } from '@effect/sql-sqlite-node/SqliteClient'
import { layer as sqliteClientLayer } from '@effect/sql-sqlite-node/SqliteClient'
import type { EffectSQLiteNodeDatabase } from 'drizzle-orm/effect-sqlite-node'
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-node'
import { Context, Data, Layer } from 'effect'

import { relations } from './relations.ts'

export { SqliteClient }

/** The profile could not be read or written, which is not the same as it being out of step. */
export class DatabaseError extends Data.TaggedError('DatabaseError')<{
  readonly doing: string
  readonly cause: unknown
}> {}

/** What a query is written against: the schema of the profile, relations and all. */
export type ProfileDatabase = EffectSQLiteNodeDatabase<typeof relations>

export class Database extends Context.Service<Database, ProfileDatabase>()('Database') {}

/**
 * The database of one profile, opened for as long as the scope it is built in lasts.
 *
 * The client's own layer is what holds the file: built with the scope, closed with it, so the
 * process that holds the database lets go of it by ending and not by remembering to.
 */
export function databaseLayer(file: string): Layer.Layer<Database | SqliteClient> {
  return Layer.effect(Database, makeWithDefaults({ relations })).pipe(
    Layer.provideMerge(sqliteClientLayer({ filename: file })),
  )
}
