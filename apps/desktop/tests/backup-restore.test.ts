/**
 * The backup of a Profile into a folder the user chooses, its restore, and what a restore leaves
 * closed until the Profile is reconciled with the world. Every data folder is a temporary one.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { RestoreRefused, type StorageFailed } from '@hemera/ipc'
import { Deferred, Effect, Fiber, Layer, Option, Stream, SubscriptionRef } from 'effect'
import type { Scope } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { MANIFEST_FILE, backupFoldersLayer } from '../src/engine/backup.ts'
import { readEvents } from '../src/engine/journal.ts'
import { BACKUPS_FOLDER, DATABASE_FILE, carriedMigrations } from '../src/engine/migrate.ts'
import { type ProfileParts, type StartedProfile, startProfile } from '../src/engine/profile.ts'
import {
  LiveMissions,
  ReconciliationFailed,
  RestoreJournal,
  type ReconciliationStep,
} from '../src/engine/reconciliation.ts'
import { RESTORE_FOLDER, isNewer } from '../src/engine/restore.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

/** A folder a later ticket registers; this one is the tests' own. */
const FAKE = 'fake-missions'

const start = (dataFolder: string, version = '1.0.0') => ({
  dataFolder,
  version,
  migrations: SHIPPED,
})

const parts = (more: Partial<ProfileParts> = {}): ProfileParts => ({
  backupFolders: [FAKE],
  reconciliationSteps: [],
  ...more,
})

/** One run of the engine on a data folder, for as long as `body` lasts. */
const running = <A, E>(
  dataFolder: string,
  body: (profile: StartedProfile) => Effect.Effect<A, E, Scope.Scope>,
  more: Partial<ProfileParts> = {},
  version = '1.0.0',
  log: (line: string) => void = () => undefined,
) =>
  Effect.runPromise(
    Effect.scoped(Effect.flatMap(startProfile(start(dataFolder, version), parts(more), log), body)),
  )

/** Waits until the Profile's reconciliation is no longer running, and answers how it ended. */
const settled = (profile: StartedProfile) =>
  SubscriptionRef.changes(profile.database).pipe(
    Stream.map((database) => ('reconciliation' in database ? database.reconciliation : 'none')),
    Stream.filter((state) => state !== 'running'),
    Stream.runHead,
    Effect.map(Option.getOrElse(() => 'none')),
  )

const profileEvents = (dataFolder: string) =>
  on(
    dataFolder,
    Effect.map(readEvents({ entity: { kind: 'profile', id: 'profile' } }), ({ events }) => events),
  )

/** A data folder with a theme, a file in the registered folder, and a Workspace's sources. */
const seeded = async (theme: 'dark' | 'light', note: string) => {
  const data = temporaryFolder('profile')
  await running(data, (profile) => profile.calls.writePreferences({ theme }))
  mkdirSync(join(data, FAKE), { recursive: true })
  writeFileSync(join(data, FAKE, 'note.txt'), note)
  mkdirSync(join(data, 'workspaces', 'atlas'), { recursive: true })
  writeFileSync(join(data, 'workspaces', 'atlas', 'source.ts'), 'export {}\n')
  return data
}

describe('A backup of the Profile', () => {
  test('is a folder holding the manifest, the database and each registered folder', async () => {
    const data = await seeded('dark', 'one')
    const chosen = temporaryFolder('chosen')
    const written = await running(data, (profile) => profile.calls.backup(chosen))

    expect(written.startsWith(join(chosen, 'hemera-backup-'))).toBe(true)
    expect(readdirSync(written).toSorted()).toEqual([DATABASE_FILE, FAKE, MANIFEST_FILE].toSorted())
    expect(readFileSync(join(written, FAKE, 'note.txt'), 'utf8')).toBe('one')
    const manifest = JSON.parse(readFileSync(join(written, MANIFEST_FILE), 'utf8'))
    expect(manifest).toMatchObject({
      hemeraVersion: '1.0.0',
      lastMigration: carriedMigrations(SHIPPED).at(-1)?.name,
      folders: [FAKE],
    })
    expect(manifest.profileId).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number.isNaN(Date.parse(manifest.takenAt))).toBe(false)
    // Workspace sources are never part of a backup.
    expect(existsSync(join(written, 'workspaces'))).toBe(false)
  })

  test('a folder that only a test registers is carried without touching the backup code', () => {
    expect(() => backupFoldersLayer(['../outside'])).toThrow()
    expect(() => backupFoldersLayer(['/absolute'])).toThrow()
    expect(Layer.isLayer(backupFoldersLayer(['missions', 'snapshots']))).toBe(true)
  })

  test('the automatic backups are listed with their count and the latest', async () => {
    const data = await seeded('dark', 'one')
    expect(await running(data, (profile) => profile.calls.backups)).toEqual({
      count: 0,
      latest: null,
    })
  })
})

describe('Backup then restore', () => {
  test('round-trips the database and a registered folder, after backing the current one up', async () => {
    const data = await seeded('dark', 'one')
    const backup = await running(data, (profile) => profile.calls.backup(temporaryFolder('chosen')))

    // The Profile goes on: another theme, another note.
    await running(data, (profile) => profile.calls.writePreferences({ theme: 'light' }))
    writeFileSync(join(data, FAKE, 'note.txt'), 'two')

    await running(data, (profile) => profile.calls.restore(backup))
    // Staged, not applied while the engine runs; the current Profile is backed up first.
    expect(existsSync(join(data, RESTORE_FOLDER))).toBe(true)
    const [before] = readdirSync(join(data, BACKUPS_FOLDER))
    expect(before).toMatch(/^before-restore-/)
    expect(readFileSync(join(data, BACKUPS_FOLDER, before!, FAKE, 'note.txt'), 'utf8')).toBe('two')

    // The relaunch: the next start applies it.
    const theme = await running(data, (profile) =>
      Effect.andThen(
        profile.gate,
        Effect.map(profile.calls.readPreferences, (preferences) => preferences.theme),
      ),
    )
    expect(theme).toBe('dark')
    expect(readFileSync(join(data, FAKE, 'note.txt'), 'utf8')).toBe('one')
    expect(existsSync(join(data, RESTORE_FOLDER))).toBe(false)
    // Workspace sources are neither restored nor deleted.
    expect(readFileSync(join(data, 'workspaces', 'atlas', 'source.ts'), 'utf8')).toBe('export {}\n')

    const events = await profileEvents(data)
    const restored = events.find((event) => event.type === 'profile.restored')
    expect(restored?.payload).toMatchObject({ version: '1.0.0' })
    expect(events.at(-1)?.type).toBe('profile.reconciled')
  })

  test.each([
    ['a folder without a readable manifest', 'none', 'This folder is not a backup of Hemera'],
    [
      'a backup written by a newer Hemera',
      'version',
      'written by a newer version of Hemera (9.0.0)',
    ],
    ['a backup carrying a newer migration', 'migration', 'holds data of a newer version'],
  ])('%s is refused with a sentence, and nothing is staged', async (_, kind, sentence) => {
    const data = await seeded('dark', 'one')
    const backup = await running(data, (profile) => profile.calls.backup(temporaryFolder('chosen')))
    const manifest = JSON.parse(readFileSync(join(backup, MANIFEST_FILE), 'utf8'))
    if (kind === 'none') writeFileSync(join(backup, MANIFEST_FILE), '{not json')
    if (kind === 'version') {
      writeFileSync(
        join(backup, MANIFEST_FILE),
        JSON.stringify({ ...manifest, hemeraVersion: '9.0.0' }),
      )
    }
    if (kind === 'migration') {
      writeFileSync(
        join(backup, MANIFEST_FILE),
        JSON.stringify({ ...manifest, lastMigration: '20990101000000_later' }),
      )
    }
    const refused: RestoreRefused | StorageFailed = await running(data, (profile) =>
      Effect.flip(profile.calls.restore(backup)),
    )
    expect(refused).toBeInstanceOf(RestoreRefused)
    expect(refused.message).toContain(sentence)
    expect(existsSync(join(data, RESTORE_FOLDER))).toBe(false)
    expect(existsSync(join(data, BACKUPS_FOLDER))).toBe(false)
  })

  test('versions compare as semantic versions', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true)
    expect(isNewer('1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('1.0.0', '1.0.0-beta.3')).toBe(true)
    expect(isNewer('1.0.0-beta.10', '1.0.0-beta.9')).toBe(true)
    expect(isNewer('1.0.0-beta.3', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('0.9.0', '1.0.0')).toBe(false)
  })
})

/** A data folder with a restore staged, ready for the start that applies it. */
const restoreStaged = async () => {
  const data = await seeded('dark', 'one')
  const backup = await running(data, (profile) => profile.calls.backup(temporaryFolder('chosen')))
  await running(data, (profile) => profile.calls.restore(backup))
  return data
}

/** A step over the fake missions, whose recorded and observed states the test holds. */
const step = (
  name: string,
  record: Map<string, string>,
  world: Map<string, string>,
  ran: string[],
  hold: Effect.Effect<void> = Effect.void,
): ReconciliationStep => ({
  name,
  per: 'mission',
  states: ['open', 'pushed', 'merged'],
  recorded: (mission) => Effect.succeed(record.get(mission) ?? 'open'),
  observed: (mission) =>
    Effect.andThen(
      Effect.sync(() => ran.push(`${name}:${mission}`)),
      Effect.andThen(hold, Effect.succeed(world.get(mission) ?? 'open')),
    ),
  advance: (mission, to) =>
    Effect.sync(() => {
      record.set(mission, to)
    }),
})

const missions = Layer.succeed(LiveMissions, Effect.succeed(['M-1', 'M-2']))

describe('After a restore, automations wait for the reconciliation', () => {
  test('a normal start opens the gate at once', async () => {
    const data = temporaryFolder('normal')
    await running(data, (profile) => profile.gate)
  })

  test('a fake automation waits until two steps have run in order', async () => {
    const data = await restoreStaged()
    const record = new Map([
      ['M-1', 'open'],
      ['M-2', 'pushed'],
    ])
    const world = new Map([
      ['M-1', 'merged'],
      ['M-2', 'pushed'],
    ])
    const ran: string[] = []
    const journaled: string[] = []
    const release = Deferred.makeUnsafe<void>()

    const acted = await running(
      data,
      (profile) =>
        Effect.gen(function* () {
          const acts: string[] = []
          const automation = yield* Effect.forkChild(
            Effect.andThen(
              profile.gate,
              Effect.sync(() => acts.push(`acted after ${ran.length}`)),
            ),
          )
          yield* Effect.sleep(20)
          expect(acts).toEqual([])
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(automation)
          expect(yield* settled(profile)).toBe('none')
          return acts
        }),
      {
        reconciliationSteps: [
          step('first', record, world, ran, Deferred.await(release)),
          step('second', record, world, ran),
        ],
        liveMissions: missions,
        restoreJournal: Layer.succeed(RestoreJournal, {
          restored: (mission, takenAt) =>
            Effect.sync(() => {
              journaled.push(`${mission} ${takenAt.slice(0, 4)}`)
            }),
        }),
      },
    )

    expect(acted).toEqual(['acted after 4'])
    expect(ran).toEqual(['first:M-1', 'first:M-2', 'second:M-1', 'second:M-2'])
    expect(record.get('M-1')).toBe('merged')
    expect(journaled.map((line) => line.split(' ')[0])).toEqual(['M-1', 'M-2'])
    const reconciled = (await profileEvents(data)).at(-1)
    expect(reconciled?.type).toBe('profile.reconciled')
    expect(reconciled?.payload).toEqual({ missions: ['M-1'] })
  })

  test('a step cannot move a state back', async () => {
    const data = await restoreStaged()
    const record = new Map([
      ['M-1', 'merged'],
      ['M-2', 'open'],
    ])
    const world = new Map([
      ['M-1', 'pushed'],
      ['M-2', 'open'],
    ])
    const lines: string[] = []
    await running(
      data,
      (profile) => Effect.andThen(profile.gate, settled(profile)),
      { reconciliationSteps: [step('checks', record, world, [])], liveMissions: missions },
      '1.0.0',
      (line) => lines.push(line),
    )
    expect(record.get('M-1')).toBe('merged')
    expect(lines).toContain('reconciliation: checks kept M-1 at merged; the world shows pushed')
    expect((await profileEvents(data)).at(-1)?.payload).toEqual({ missions: [] })
  })

  test('a step that fails keeps the gate closed, is recorded, and runs again at the next start', async () => {
    const data = await restoreStaged()
    const lines: string[] = []
    const failing: ReconciliationStep = {
      ...step('checks', new Map(), new Map(), []),
      observed: () =>
        Effect.fail(new ReconciliationFailed({ reason: 'the remote did not answer' })),
    }
    await running(
      data,
      (profile) =>
        Effect.gen(function* () {
          expect(yield* settled(profile)).toBe('failed')
          const passed = yield* Effect.forkChild(profile.gate)
          yield* Effect.sleep(20)
          expect(passed.pollUnsafe()).toBeUndefined()
          yield* Fiber.interrupt(passed)
          const status = yield* SubscriptionRef.get(profile.database)
          expect(status).toMatchObject({ reconciliation: 'failed' })
        }),
      { reconciliationSteps: [failing], liveMissions: missions },
      '1.0.0',
      (line) => lines.push(line),
    )
    expect(lines).toContain('reconciliation: failed: checks: the remote did not answer')
    const failed = (await profileEvents(data)).at(-1)
    expect(failed?.type).toBe('profile.reconciliation_failed')
    expect(failed?.payload).toEqual({ reason: 'checks: the remote did not answer' })

    // The next start runs it again; this time the world answers.
    const ran: string[] = []
    await running(data, (profile) => profile.gate, {
      reconciliationSteps: [step('checks', new Map(), new Map(), ran)],
      liveMissions: missions,
    })
    expect(ran).toEqual(['checks:M-1', 'checks:M-2'])
    expect((await profileEvents(data)).at(-1)?.type).toBe('profile.reconciled')
  })
})
