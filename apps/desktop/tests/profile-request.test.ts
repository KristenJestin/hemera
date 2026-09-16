/**
 * What the process that holds the database accepts, and what it refuses (design D3-02).
 *
 * Each suite is named after the scenario of `specs/profile-storage/spec.md` it covers. None of
 * this needs Electron or a port: a decision is a pure reading of a name and a schema, and what
 * follows an accepted one is a service standing on a database made for the test.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { openProfile } from '#profile/migrate.ts'
import { type Preferences, preferencesLayer } from '#profile/preferences.ts'
import { answer, decideRequest } from '#profile/request.ts'
import { type ProfileStatus, profileStatusLayer } from '#profile/status.ts'
import { DatabaseError, SqliteClient, databaseLayer } from '#profile/storage/database.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

let profile: string

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'hemera-request-'))
  mkdirSync(profile, { recursive: true })
})

afterEach(() => {
  rmSync(profile, { recursive: true, force: true })
})

/** Runs one accepted message against a profile of this test's own. */
function running<A, E>(program: Effect.Effect<A, E, Preferences | ProfileStatus | SqliteClient>) {
  const services = Layer.mergeAll(
    preferencesLayer,
    profileStatusLayer({ directory: profile, channel: 'dev', version: '0.3.0' }),
  ).pipe(Layer.provideMerge(databaseLayer(join(profile, 'hemera.sqlite'))))

  return Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          yield* openProfile(profile, SHIPPED, '0.3.0')
          return yield* program
        }),
        services,
      ),
    ),
  )
}

/** Decides a message and runs it, which is what the entry point does with one that arrives. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a message as it arrives, which is what `decideRequest` is for
function send(name: string, argument: unknown) {
  const decision = decideRequest(name, argument)
  if (!decision.accepted) throw new Error(decision.reason)
  return running(answer(decision))
}

describe('Un message conforme est traité', () => {
  test('profile.status asked with no argument answers what the profile stands at', async () => {
    const status = await send('profile.status', {})

    expect(status).toEqual({
      directory: profile,
      channel: 'dev',
      version: '0.3.0',
      lastMigration: expect.stringMatching(/profile_and_preferences$/),
      writtenByVersion: '0.3.0',
    })
  })

  test('preferences.write is accepted and preferences.read gives it back', async () => {
    const written = decideRequest('preferences.write', { theme: 'dark' })
    const read = decideRequest('preferences.read', {})
    expect(written.accepted).toBe(true)
    expect(read.accepted).toBe(true)

    const both = await running(
      Effect.gen(function* () {
        if (!written.accepted || !read.accepted) return null
        yield* answer(written)
        return yield* answer(read)
      }),
    )
    expect(both).toEqual({ theme: 'dark', sidebar: { collapsed: false, width: null } })
  })
})

describe('Un message non conforme est refusé sans effet', () => {
  test('a theme outside system, light and dark is refused, naming the use case and the field', () => {
    const decision = decideRequest('preferences.write', { theme: 'sepia' })

    expect(decision.accepted).toBe(false)
    expect(decision.accepted || decision.reason).toContain('preferences.write')
    expect(decision.accepted || decision.reason).toContain('theme')
  })

  test('a refused message carries a reason and no argument, so nothing can be run on it', () => {
    const decision = decideRequest('preferences.write', { theme: 'sepia' })
    expect(decision).not.toHaveProperty('argument')
  })

  test('the database is untouched by a message that was refused', async () => {
    const before = await send('preferences.read', {})
    expect(decideRequest('preferences.write', { theme: 'sepia' }).accepted).toBe(false)
    expect(await send('preferences.read', {})).toEqual(before)
  })

  test.each([
    ['a use case that is not declared', 'preferences.reed', {}],
    ['a use case from another process', 'window.command', { command: 'minimize' }],
    ['a sidebar missing a field', 'preferences.write', { sidebar: { collapsed: true } }],
    ['a sidebar of the wrong type', 'preferences.write', { sidebar: 'wide' }],
    ['nothing at all', 'profile.status', undefined],
  ])('%s is refused', (_case, name, argument) => {
    const decision = decideRequest(name, argument)
    expect(decision.accepted).toBe(false)
    expect(decision.accepted || decision.reason).toContain(name)
  })
})

describe('Une erreur typée traverse la frontière', () => {
  test('a use case that fails answers with the name of what failed, not an anonymous throw', async () => {
    const decision = decideRequest('preferences.read', {})
    expect(decision.accepted).toBe(true)
    if (!decision.accepted) return

    // The table the use case reads is taken out from under it, which is the closest a test can
    // get to a database that answers something other than what it was asked.
    const failed = await running(
      Effect.gen(function* () {
        const sql = yield* SqliteClient
        yield* sql`DROP TABLE app_preferences`
        return yield* Effect.flip(answer(decision))
      }),
    )

    expect(failed).toBeInstanceOf(DatabaseError)
    if (failed instanceof DatabaseError) expect(failed.doing).toBe('reading the preferences')
  })
})
