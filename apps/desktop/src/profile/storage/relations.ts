/**
 * The relations of the schema, which lot 3 has none of, declared all the same (design D3-04).
 *
 * The shape is fixed now rather than later: the database is built with relations from the start,
 * so lot 4 adds a relation to a file that already exists and the query builder never has to be
 * handed a different kind of schema halfway through.
 */

import { defineRelations } from 'drizzle-orm'

import * as schema from './schema.ts'

export const relations = defineRelations(schema, () => ({}))
