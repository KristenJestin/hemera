/**
 * The retention classes: what is kept as long as its mission (permanent and heavy), and what
 * rotates (the diagnostic class), by age and by total size, never while its mission is live; and
 * the one sink every write into the diagnostic class goes through.
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'

import type { Table } from 'drizzle-orm'
import { maskText } from '@hemera/core/domain'
import { Effect, Predicate } from 'effect'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { DIAGNOSTIC_FILE, TRACES_FOLDER } from '../src/main/diagnostic.ts'
import { createMission, moveMission } from '../src/engine/missions.ts'
import { createProject } from '../src/engine/projects.ts'
import {
  FILE_CLASSES,
  MAX_AGE_DAYS,
  MAX_TOTAL_MEGABYTES,
  TABLE_CLASSES,
  sweepDiagnostics,
  undeclaredTables,
} from '../src/engine/retention.ts'
import { Database } from '../src/engine/storage/database.ts'
import * as schema from '../src/engine/storage/schema.ts'
import { commandsEngine } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('retention'))
  work = realpathSync.native(temporaryFolder('retention-work'))
})
afterEach(removeFolders)

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-10-05T12:00:00.000Z')
const daysAgo = (days: number) => new Date(now - days * DAY).toISOString()

describe('Every table and file of history or diagnostics has its class', () => {
  test('the constants are 30 days and 500 MB', () => {
    expect([MAX_AGE_DAYS, MAX_TOTAL_MEGABYTES]).toEqual([30, 500])
  })

  // Every export of the schema is a table but the number of the Profile's one row.
  const tables: ReadonlyArray<Table> = Object.values(schema).flatMap((value) =>
    Predicate.isNumber(value) ? [] : [value],
  )

  test('every table of the schema is declared', () => {
    expect(tables.length).toBeGreaterThan(10)
    expect(undeclaredTables(tables)).toEqual([])
  })

  test('a table added without its class fails the check', () => {
    const later = sqliteTable('mission_findings', { id: text('id').primaryKey() })
    expect(undeclaredTables([...tables, later])).toEqual(['mission_findings'])
  })

  test('the history of a mission is permanent, and the diagnostic log rotates', () => {
    const { missions, mission_marks, needs, need_deliveries, domain_events } = TABLE_CLASSES
    expect([missions, mission_marks, needs, need_deliveries, domain_events]).toEqual(
      Array.from({ length: 5 }, () => 'permanent'),
    )
    expect(TABLE_CLASSES.command_runs).toBe('diagnostic')
    expect(FILE_CLASSES[DIAGNOSTIC_FILE]).toBe('diagnostic')
    expect(FILE_CLASSES[TRACES_FOLDER]).toBe('diagnostic')
  })
})

describe('Only the diagnostic sink writes into the diagnostic class', () => {
  const SOURCE = join(import.meta.dirname, '..', 'src')
  const SINK = join('main', 'diagnostic.ts')
  const WRITES = /\b(?:appendFileSync|appendFile|writeFileSync|writeFile|createWriteStream)\b/

  const files = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(folder, entry.name))
        : entry.name.endsWith('.ts')
          ? [join(folder, entry.name)]
          : [],
    )

  test('no other file names the diagnostic file and writes to the disk', () => {
    const offenders = files(SOURCE).filter((file) => {
      if (relative(SOURCE, file) === SINK) return false
      const source = readFileSync(file, 'utf8')
      return /DIAGNOSTIC_FILE|diagnostic\.log/.test(source) && WRITES.test(source)
    })
    expect(offenders).toEqual([])
  })

  test('no other file names the traces folder and writes to the disk', () => {
    const offenders = files(SOURCE).filter((file) => {
      if (relative(SOURCE, file) === SINK) return false
      const source = readFileSync(file, 'utf8')
      return /TRACES_FOLDER|'traces'/.test(source) && WRITES.test(source)
    })
    expect(offenders).toEqual([])
  })

  test('no other file spells the diagnostic file’s name', () => {
    const offenders = files(SOURCE).filter(
      (file) =>
        relative(SOURCE, file) !== SINK &&
        readFileSync(file, 'utf8').includes(`'${DIAGNOSTIC_FILE}'`),
    )
    expect(offenders).toEqual([])
  })
})

describe('The diagnostic class rotates by age and size, never under a live mission', () => {
  /** Acme, with a run of a given age, output size and mission, ended. */
  const seeded = Effect.gen(function* () {
    const folder = join(work, 'acme')
    mkdirSync(folder, { recursive: true })
    const project = yield* createProject({ name: 'Acme', mainCheckout: folder, repositories: [] })
    const live = yield* createMission({
      projectId: project.id,
      idea: { sentence: 'live', ticket: null },
    })
    const ended = yield* createMission({
      projectId: project.id,
      idea: { sentence: 'ended', ticket: null },
    })
    yield* moveMission(ended.id, 'cancel', 'user')
    const database = yield* Database
    const run = (id: string, age: number, size: number, missionId: string | null) =>
      database.insert(schema.commandRuns).values({
        id,
        projectId: project.id,
        workspaceId: null,
        commandId: null,
        name: id,
        type: 'script',
        line: 'node build.mjs',
        folder,
        startedBy: 'user',
        sessionId: null,
        missionId,
        state: 'done',
        output: maskText('x'.repeat(size), []),
        dropped: 0,
        startedAt: daysAgo(age),
        endedAt: daysAgo(age),
      })
    yield* run('old', 40, 10, null)
    yield* run('old-of-live-mission', 40, 10, live.id)
    yield* run('old-of-ended-mission', 40, 10, ended.id)
    yield* run('recent-big', 2, 600, null)
    yield* run('recent-small', 1, 10, null)
    const permanent = yield* Effect.all([
      database.select().from(schema.missions),
      database.select().from(schema.domainEvents),
      database.select().from(schema.needs),
    ])
    return permanent.map((rows) => rows.length)
  })

  const runsLeft = Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database.select({ id: schema.commandRuns.id }).from(schema.commandRuns)
    return rows.map((row) => row.id).toSorted()
  })

  const counts = Effect.gen(function* () {
    const database = yield* Database
    const permanent = yield* Effect.all([
      database.select().from(schema.missions),
      database.select().from(schema.domainEvents),
      database.select().from(schema.needs),
    ])
    return permanent.map((rows) => rows.length)
  })

  test('what is older than 30 days goes, unless its mission is live; the permanent class stays', async () => {
    const [left, before, after] = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const seededCounts = yield* seeded
          yield* sweepDiagnostics(data, { now, maxTotalBytes: 1_000_000_000 })
          return [yield* runsLeft, seededCounts, yield* counts] as const
        }),
      ),
    )
    expect(left).toEqual(['old-of-live-mission', 'recent-big', 'recent-small'])
    expect(after).toEqual(before)
  })

  test('past the total size, the oldest go first, and a live mission’s still stay', async () => {
    const left = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          yield* seeded
          yield* sweepDiagnostics(data, { now, maxTotalBytes: 100 })
          return yield* runsLeft
        }),
      ),
    )
    expect(left).toEqual(['old-of-live-mission', 'recent-small'])
  })

  test('an old generation of the log goes, and the log being written stays', async () => {
    const generation = join(data, 'diagnostic.20260801T120000Z-4242.log')
    const current = join(data, DIAGNOSTIC_FILE)
    writeFileSync(generation, 'turned over in August\n')
    utimesSync(generation, new Date(now - 60 * DAY), new Date(now - 60 * DAY))
    writeFileSync(current, 'today\n')
    utimesSync(current, new Date(now), new Date(now))
    await commandsEngine(data)(({ profile }) =>
      profile.use(sweepDiagnostics(data, { now, maxTotalBytes: 1_000_000_000 })),
    )
    expect(() => statSync(generation)).toThrow()
    expect(readFileSync(current, 'utf8')).toBe('today\n')
  })

  test('an ACP trace older than 30 days goes, and a recent one stays', async () => {
    const traces = join(data, TRACES_FOLDER)
    mkdirSync(traces)
    const old = join(traces, 'old-session.1.log')
    const recent = join(traces, 'recent-session.log')
    writeFileSync(old, 'an old line\n')
    utimesSync(old, new Date(now - 40 * DAY), new Date(now - 40 * DAY))
    writeFileSync(recent, 'a recent line\n')
    utimesSync(recent, new Date(now - DAY), new Date(now - DAY))
    await commandsEngine(data)(({ profile }) =>
      profile.use(sweepDiagnostics(data, { now, maxTotalBytes: 1_000_000_000 })),
    )
    expect(() => statSync(old)).toThrow()
    expect(readFileSync(recent, 'utf8')).toBe('a recent line\n')
  })

  test('a diagnostic file older than 30 days is removed; a recent one is kept', async () => {
    const file = join(data, DIAGNOSTIC_FILE)
    await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          writeFileSync(file, 'an old line\n')
          utimesSync(file, new Date(now - 40 * DAY), new Date(now - 40 * DAY))
          yield* sweepDiagnostics(data, { now, maxTotalBytes: 1_000_000_000 })
        }),
      ),
    )
    expect(() => statSync(file)).toThrow()
    writeFileSync(file, 'a recent line\n')
    utimesSync(file, new Date(now - DAY), new Date(now - DAY))
    await commandsEngine(data)(({ profile }) =>
      profile.use(sweepDiagnostics(data, { now, maxTotalBytes: 1_000_000_000 })),
    )
    expect(readFileSync(file, 'utf8')).toContain('a recent line')
  })
})
