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

/** The database could not be read or written, which is not the same as it being out of step. */
export class DatabaseError extends Data.TaggedError('DatabaseError')<{
  readonly doing: string
  readonly cause: unknown
}> {
  /**
   * What the window is told: what Hemera was doing, and what the driver said about it.
   *
   * An Effect error carries fields and no message, and the fields are what would cross the port
   * as JSON. What a reader can do something with is the sentence, so the sentence is what a
   * refusal of this kind carries.
   */
  override get message(): string {
    return `The data folder refused while ${this.doing}: ${String(this.cause)}`
  }
}

/** What a query is written against: the schema of the data folder, relations and all. */
export type EngineDatabase = EffectSQLiteNodeDatabase<typeof relations>

/**
 * The same, inside a transaction, which is what everything that writes is handed.
 *
 * It is named here rather than inferred at each call site because it is a signature the domain
 * writes against: a function taking one of these cannot be called outside a transaction.
 */
export type EngineTransaction = Parameters<Parameters<EngineDatabase['transaction']>[0]>[0]

export class Database extends Context.Service<Database, EngineDatabase>()('Database') {}

/**
 * The database of one data folder, opened for as long as the scope it is built in lasts.
 *
 * The client's own layer is what holds the file: built with the scope, closed with it, so the
 * engine lets go of it by ending and not by remembering to.
 */
export function databaseLayer(file: string): Layer.Layer<Database | SqliteClient> {
  return Layer.effect(Database, makeWithDefaults({ relations })).pipe(
    // Each query is prepared anew rather than taken from the client's cache: a cached statement
    // is one object for every fiber asking the same query, and the client switches it between
    // rows as objects and rows as arrays across two steps of a fiber — another fiber running the
    // same query in between reads rows in the other shape, which the query builder then maps to
    // rows of nothing but `undefined`. Preparing a statement costs microseconds; a row read wrong
    // is a build that stalls.
    Layer.provideMerge(sqliteClientLayer({ filename: file, prepareCacheSize: 0 })),
  )
}
