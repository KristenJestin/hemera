/** The database of a data folder, read by several fibers at once. */

import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { openProfile } from '../src/engine/migrate.ts'
import { writePreferences } from '../src/engine/preferences.ts'
import { Database } from '../src/engine/storage/database.ts'
import { appPreferences } from '../src/engine/storage/schema.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

describe('The same query asked by several fibers at once', () => {
  test('answers each of them its rows, whole', async () => {
    const data = temporaryFolder('database')
    const rows = await on(
      data,
      Effect.gen(function* () {
        yield* openProfile(data, SHIPPED, '1.0.0')
        yield* writePreferences({ theme: 'dark' })
        const database = yield* Database
        const read = database.select().from(appPreferences).where(eq(appPreferences.key, 'theme'))
        // Each fiber asks many times in a row, so the scheduler hands the connection from one to
        // the next in the middle of a query.
        const many = Effect.forEach(Array.from({ length: 300 }), () => read)
        return yield* Effect.all(
          Array.from({ length: 40 }, () => many),
          { concurrency: 'unbounded' },
        )
      }),
    )
    expect(rows.flat(2).filter((row) => row.key !== 'theme')).toEqual([])
    expect(rows.flat(2)).toHaveLength(40 * 300)
  })
})
