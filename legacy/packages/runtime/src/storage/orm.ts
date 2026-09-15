/**
 * The Drizzle handle of an open profile.
 *
 * The schema is declared once, in `schema.ts`, and the queries are built from it: a column
 * renamed there is a type error here rather than an SQL string that still parses and returns
 * nothing. Raw SQL is kept for what a schema cannot express — pragmas, migrations, backups.
 *
 * One handle per connection, not one per call: `drizzle()` allocates its own session state,
 * and the connection is what identifies a profile.
 */

import type { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

import * as schema from './schema.ts'

export type Orm = BunSQLiteDatabase<typeof schema>

const HANDLES = new WeakMap<Database, Orm>()

export function orm(database: Database): Orm {
  const existing = HANDLES.get(database)
  if (existing !== undefined) return existing
  const created = drizzle(database, { schema })
  HANDLES.set(database, created)
  return created
}
