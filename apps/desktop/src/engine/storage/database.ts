/**
 * The database of a data folder, and the one door the storage layer comes through.
 *
 * Every other file of the engine asks for `Database` and gets a query builder; the boundary check
 * refuses the storage layer anywhere outside the engine's folder. The client underneath is
 * re-exported for the two things a query builder will not do: the checkpoint that makes a backup
 * consistent, and the backup itself.
 */

import { SqliteClient, layer as sqliteClientLayer } from '@effect/sql-sqlite-node/SqliteClient'
import type { EffectSQLiteNodeDatabase } from 'drizzle-orm/effect-sqlite-node'
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-node'
import { Context, Effect, Layer, Schema } from 'effect'

export { SqliteClient }

/**
 * The data folder refused a read or a write. Its message says what Hemera was doing; what the
 * driver said is in `reason`, for the diagnostic.
 */
export class DatabaseError extends Schema.TaggedError<DatabaseError>()('DatabaseError', {
  doing: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `The data folder refused while ${this.doing}: ${this.reason}`
  }
}

/** A failure of the driver, as the error the engine speaks. */
export const refusedWhile =
  (doing: string) =>
  <E>(cause: E): DatabaseError =>
    new DatabaseError({
      doing,
      reason: cause instanceof Error && cause.message !== '' ? cause.message : String(cause),
    })

export type EngineDatabase = EffectSQLiteNodeDatabase

/**
 * The same, inside a transaction, which is what everything that writes is handed: a function
 * that takes one cannot be called outside a transaction.
 */
export type EngineTransaction = Parameters<Parameters<EngineDatabase['transaction']>[0]>[0]

export class Database extends Context.Service<Database, EngineDatabase>()('Database') {}

/**
 * The database of one file, open for as long as the scope it is built in. WAL is the client's
 * default; foreign keys are turned on for the connection, which is the only one there is.
 *
 * Each query is prepared anew rather than taken from the client's cache: a cached statement is
 * one object for every fiber asking the same query, and the client switches it between rows as
 * objects and rows as arrays across two steps of a fiber, so another fiber running the same
 * query in between would read rows of the other shape.
 */
export function databaseLayer(file: string): Layer.Layer<Database | SqliteClient, DatabaseError> {
  return Layer.effect(
    Database,
    Effect.gen(function* () {
      const client = yield* SqliteClient
      yield* client`PRAGMA foreign_keys = ON`.pipe(Effect.mapError(refusedWhile('opening it')))
      return yield* makeWithDefaults()
    }),
  ).pipe(Layer.provideMerge(sqliteClientLayer({ filename: file, prepareCacheSize: 0 })))
}
