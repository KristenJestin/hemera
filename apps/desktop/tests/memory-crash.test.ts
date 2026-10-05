/**
 * The Memory survives a crash between an event and its projection (CT-04): the engine runs in a
 * process of its own, its projection held after the mission's start is committed and before it is
 * projected; the process is killed outright (SIGKILL on Linux, `taskkill /F` on Windows), the
 * engine is started again, and the Journal holds exactly one line for that event. Replaying the
 * projection from an older cursor then adds nothing.
 */

import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { Memory } from '../src/engine/memory/index.ts'
import { Database } from '../src/engine/storage/database.ts'
import { domainEvents, memoryJournal } from '../src/engine/storage/schema.ts'
import { commandsEngine } from './commands-engine.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

const ENGINE = join(import.meta.dirname, 'fixtures', 'memory-engine.ts')

let data: string
let main: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('memory-crash'))
  main = join(realpathSync.native(temporaryFolder('memory-crash-work')), 'acme')
  mkdirSync(main, { recursive: true })
})
afterEach(removeFolders)

/** Starts the engine's process and answers it once it holds its projection, with the sequence. */
async function heldEngine() {
  const child = spawn(process.execPath, [ENGINE, data, SHIPPED, main], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let said = ''
  let errors = ''
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString()
  })
  const sequence = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the engine never held its projection: ${errors}`)),
      30_000,
    )
    child.stdout.on('data', (chunk: Buffer) => {
      said += chunk.toString()
      const held = /held (\d+)/.exec(said)
      if (held !== null) {
        clearTimeout(timer)
        resolve(Number(held[1]))
      }
    })
    child.on('exit', () => reject(new Error(`the engine ended before it held: ${errors}`)))
  })
  return { child, sequence }
}

/** Kills a process outright, as a crash would end it. */
async function killOutright(child: ReturnType<typeof spawn>): Promise<void> {
  const gone = once(child, 'exit')
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' })
  } else {
    child.kill('SIGKILL')
  }
  await gone
}

const linesOf = (sequence: number) =>
  Effect.flatMap(Database, (database) =>
    database.select().from(memoryJournal).where(eq(memoryJournal.sequence, sequence)),
  )

describe('The Memory survives a crash between an event and its projection', () => {
  test('killed while the projection is held, restarted: exactly one line for the event', async () => {
    const { child, sequence } = await heldEngine()
    await killOutright(child)

    // Between the two: the event is committed, its line is not written.
    const [events, before] = await on(
      data,
      Effect.gen(function* () {
        const database = yield* Database
        return [
          yield* database.select().from(domainEvents).where(eq(domainEvents.sequence, sequence)),
          yield* linesOf(sequence),
        ] as const
      }),
    )
    expect(events.map((event) => event.type)).toEqual(['mission.started'])
    expect(before).toEqual([])

    const [after, total, replayed] = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const memory = yield* Memory
          yield* memory.ready
          const lines = yield* linesOf(sequence)
          const count = (yield* Effect.flatMap(Database, (database) =>
            database.select().from(memoryJournal),
          )).length
          yield* memory.rewind(0)
          yield* memory.catchUp
          const again = (yield* Effect.flatMap(Database, (database) =>
            database.select().from(memoryJournal),
          )).length
          return [lines, count, again] as const
        }),
      ),
    )
    expect(after.map((line) => line.text)).toEqual(['Mission started: Export the invoices as CSV'])
    expect(replayed).toBe(total)
  }, 60_000)
})
