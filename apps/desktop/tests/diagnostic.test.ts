import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EngineGone } from '@hemera/ipc'
import { Effect, Fiber, Stream } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
  DIAGNOSTIC_FILE,
  observed,
  observedStream,
  openDiagnosticLog,
} from '../src/main/diagnostic.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('The diagnostic log', () => {
  test('each line is dated, says which program wrote it, and lands in the data folder', () => {
    const folder = mkdtempSync(join(tmpdir(), 'hemera-diagnostic-'))
    folders.push(folder)
    const data = join(folder, 'not created yet')
    openDiagnosticLog(data, 'main')('first')
    openDiagnosticLog(data, 'engine')('second')
    const lines = readFileSync(join(data, DIAGNOSTIC_FILE), 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT\S+Z \[main\] first$/)
    expect(lines[1]).toMatch(/ \[engine\] second$/)
  })

  test('a failed call is written under its RPC name, as its sentence', async () => {
    const lines: string[] = []
    await Effect.runPromise(
      Effect.exit(
        Effect.fail(new EngineGone()).pipe(observed('engine.status', (line) => lines.push(line))),
      ),
    )
    expect(lines).toEqual(['engine.status: failed: Hemera’s engine stopped.'])
  })

  test('an interrupted stream and the end of one are written down; a successful call is not', async () => {
    const lines: string[] = []
    const log = (line: string) => lines.push(line)
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.succeed(1).pipe(observed('engine.status', log))
        const fiber = yield* Effect.forkChild(
          Stream.runDrain(Stream.never.pipe(observedStream('engine.statusChanges', log))),
        )
        yield* Effect.sleep(10)
        yield* Fiber.interrupt(fiber)
        yield* Stream.runDrain(Stream.make(1).pipe(observedStream('engine.statusChanges', log)))
      }),
    )
    expect(lines).toEqual(['engine.statusChanges: interrupted', 'engine.statusChanges: ended'])
  })
})
