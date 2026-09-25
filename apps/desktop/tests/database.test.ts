/**
 * The database a data folder holds, read by several fibers at once.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { openProfile } from '#engine/migrate.ts'
import { Database, databaseLayer } from '#engine/storage/database.ts'
import { appPreferences } from '#engine/storage/schema.ts'

import { SHIPPED, VERSION } from './application.ts'

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-database-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

describe('The same query asked by several fibers at once', () => {
  test('answers each of them its rows, whole', async () => {
    const rows = await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(dataFolder, SHIPPED, VERSION)
            const database = yield* Database
            const read = database
              .select()
              .from(appPreferences)
              .where(eq(appPreferences.key, 'theme'))
            yield* database.insert(appPreferences).values({ key: 'theme', value: '"dark"' })
            // Each fiber asks many times in a row, so the scheduler hands the connection from one
            // to the next in the middle of a query, as a long transaction's reads do.
            const many = Effect.forEach(Array.from({ length: 300 }), () => read)
            return yield* Effect.all(
              Array.from({ length: 40 }, () => many),
              {
                concurrency: 'unbounded',
              },
            )
          }),
          databaseLayer(join(dataFolder, 'hemera.sqlite')),
        ),
      ),
    )
    expect(rows.flat(2).filter((row) => row.key !== 'theme')).toEqual([])
  })
})
