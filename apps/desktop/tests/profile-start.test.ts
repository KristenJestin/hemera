/**
 * The Profile at the engine's start: what the status says once it is open, and what the window is
 * told when it cannot be opened. The engine still serves then, and refuses every call with the
 * same sentence.
 */

import { join } from 'node:path'

import { DatabaseOpen, DatabaseRefused } from '@hemera/ipc'
import { Effect, Option, Result, SubscriptionRef } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { carriedMigrations } from '../src/engine/migrate.ts'
import { startProfile } from '../src/engine/profile.ts'
import { SHIPPED, migrationsWith, removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

const started = (dataFolder: string, migrations: string, version = '1.0.0') => {
  const lines: string[] = []
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const profile = yield* startProfile(
          { dataFolder, version, migrations },
          { backupFolders: [], reconciliationSteps: [] },
          (line) => lines.push(line),
        )
        const database = yield* SubscriptionRef.get(profile.database)
        const preferences = yield* Effect.result(profile.calls.readPreferences)
        return { database, preferences, lines }
      }),
    ),
  )
}

describe('The status of the Profile at start', () => {
  test('an opened Profile reports its last migration, its writer, its backups and no reconciliation', async () => {
    const data = temporaryFolder('start')
    const { database, lines } = await started(data, SHIPPED)
    expect(database).toEqual(
      DatabaseOpen.make({
        lastMigration: carriedMigrations(SHIPPED).at(-1)?.name ?? null,
        writtenByVersion: '1.0.0',
        backups: { count: 0, latest: null },
        reconciliation: 'none',
      }),
    )
    expect(lines[0]).toBe(
      `opened the database ${join(data, 'hemera-1.sqlite')} at ${carriedMigrations(SHIPPED).at(-1)?.name}`,
    )
  })

  test('a migration backed up and applied is counted among the automatic backups', async () => {
    const data = temporaryFolder('start')
    await started(data, SHIPPED)
    const { database } = await started(data, migrationsWith('CREATE TABLE `added` (`id` integer);'))
    expect(database).toMatchObject({
      backups: { count: 1, latest: '20990101000000_later_0.sqlite' },
      lastMigration: '20990101000000_later_0',
    })
  })
})

describe('A Profile that cannot be opened', () => {
  test('a newer one gives the window its sentence, and every call is refused with it', async () => {
    const data = temporaryFolder('start')
    await started(data, migrationsWith('CREATE TABLE `added` (`id` integer);'), '1.1.0')
    const { database, preferences, lines } = await started(data, SHIPPED)
    const sentence =
      'This data folder was written by a newer version of Hemera and cannot be opened by this one.'
    expect(database).toEqual(DatabaseRefused.make({ sentence }))
    expect(Result.isFailure(preferences)).toBe(true)
    expect(Result.getFailure(preferences)).toMatchObject(Option.some({ sentence }))
    expect(lines.some((line) => line.endsWith(sentence))).toBe(true)
  })

  test('a build that cannot read its own migrations is refused, not crashed', async () => {
    const data = temporaryFolder('start')
    const { database } = await started(data, join(data, 'no-migrations-here'))
    expect(database).toEqual(
      DatabaseRefused.make({
        sentence: 'This data folder could not be brought up to this version of Hemera.',
      }),
    )
  })
})
