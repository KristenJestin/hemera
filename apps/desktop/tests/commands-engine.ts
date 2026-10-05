/**
 * The engine the suites about runs stand on: the Profile as the engine starts it, with its real
 * process supervisor, its runs and its recipe runner, over a data folder of the suite's own and
 * Atlas's main checkout (see `workspace-engine.ts`).
 *
 * Nothing is mocked: a run is a real child of the machine running the suites. The children are
 * `node` itself, reached through `process.execPath` rather than through the `PATH`, running scripts
 * this suite writes into a temporary folder; their paths are quoted, so a line stays a line a user
 * could have written. What a suite may change is handed as a part of the Profile (the
 * "ask before running" port, the readiness and grace settings), never patched.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect } from 'effect'
import type { Scope } from 'effect'

import { type ProfileParts, type StartedProfile, startProfile } from '../src/engine/profile.ts'
import { SHIPPED, temporaryFolder } from './storage.ts'

/** Fast enough for a suite: a readiness asked every 50 ms, and half a second of grace. */
const FAST = { readinessEveryMillis: 50, readinessForMillis: 10_000, graceMillis: 500 }

/** What a program of these suites is handed: the Profile, and the engine's diagnostic lines. */
export interface Started {
  readonly profile: StartedProfile
  readonly lines: string[]
}

/**
 * One opening of the engine over `data`: the Profile started, the program run, then everything
 * closed, as a quit closes it. Two calls are a restart.
 */
export function commandsEngine(
  data: string,
  parts: Pick<
    ProfileParts,
    'askBeforeRunning' | 'missions' | 'secrets' | 'tools' | 'actionRules' | 'memory'
  > &
    Partial<Pick<ProfileParts, 'reconciliationSteps'>> = {},
) {
  return <A, E>(program: (started: Started) => Effect.Effect<A, E, Scope.Scope>): Promise<A> => {
    const lines: string[] = []
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const profile = yield* startProfile(
            { dataFolder: data, version: '1.0.0', migrations: SHIPPED },
            { backupFolders: [], reconciliationSteps: [], runs: FAST, ...parts },
            (line) => lines.push(line),
          )
          return yield* program({ profile, lines })
        }),
      ),
    )
  }
}

let scripts = 0

/** Writes a script into a folder of its own, and answers its path. */
export function script(body: string): string {
  scripts += 1
  const path = join(temporaryFolder('runs-scripts'), `script-${String(scripts)}.mjs`)
  writeFileSync(path, body)
  return path
}

/** The line that runs a script with `node`, every word quoted. */
export const nodeLine = (path: string, ...args: ReadonlyArray<string>): string =>
  [process.execPath, path, ...args].map((word) => `"${word}"`).join(' ')

/** Keeps a script up on a timer of its own, never on its input. */
export const STAYS_UP = 'setInterval(() => {}, 1000)\n'

/** Writes its pid into the file it is given, then stays up. */
export const WRITES_ITS_PID = `
import { appendFileSync } from 'node:fs'
appendFileSync(process.argv[2], String(process.pid) + '\\n')
${STAYS_UP}`

/** Says something on both outputs, then ends badly, as a failing tool does. */
export const FAILS_LOUDLY = `
process.stdout.write('checking\\n')
process.stderr.write('boom\\n')
process.exit(3)
`

/**
 * A dev server: it listens on a port of the system's choosing, says its address with colour codes
 * around it, as Vite does, writes its pid, and answers every request.
 */
export const SERVES = `
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
appendFileSync(process.argv[2], String(process.pid) + '\\n')
const server = createServer((_, response) => response.end('ok'))
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  console.log('  \\u001b[32m➜\\u001b[39m  Local:   \\u001b[36mhttp://localhost:' + port + '/\\u001b[39m')
})
`

/**
 * A child that starts a grandchild, which starts a great-grandchild: a tree of three, each pid
 * written down, none of them ending when its input closes.
 */
export const TREE_OF_THREE = `
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
const [, , where, depth] = process.argv
appendFileSync(where, String(process.pid) + '\\n')
if (Number(depth) > 1) {
  spawn(process.execPath, [process.argv[1], where, String(Number(depth) - 1)], {
    stdio: 'ignore',
    windowsHide: true,
  })
}
${STAYS_UP}`

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Reads until what is waited for is true, and answers the last thing read. Bounded: a run that
 * never gets there fails a test rather than hanging it.
 */
export const until = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  ready: (seen: A) => boolean,
  millis = 10_000,
) =>
  Effect.gen(function* () {
    const deadline = Date.now() + millis
    let seen = yield* read
    while (!ready(seen) && Date.now() < deadline) {
      yield* Effect.sleep('25 millis')
      seen = yield* read
    }
    return seen
  })
