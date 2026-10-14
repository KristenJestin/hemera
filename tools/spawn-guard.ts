/**
 * The guard the suites run under: no test starts a program of the machine's own.
 *
 * A test may start what lives in a temporary folder (the fakes the suites write) or in this
 * repository (its fixtures, its `node_modules/.bin`), and the toolchain and system programs named
 * in `SYSTEM_PROGRAMS`, wherever the `PATH` finds them. Anything else, resolved along the `PATH`
 * the spawn is handed, is refused before it runs: a real `claude`, `codex`, `opencode` or `gh`
 * answers differently on every machine, and one that prompts would hang the suite. A line Windows
 * hands to `cmd.exe` is judged by the program it runs, not by `cmd.exe`.
 *
 * A refused spawn throws where it is asked, and is kept: the code under test may swallow the
 * throw, so the setup fails the test that asked for it (see `spawn-guard.setup.ts`).
 */

import childProcess, { ChildProcess } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'

/** What a test may start. */
export interface SpawnRule {
  /** The folders a program may live in, at any depth. */
  readonly folders: ReadonlyArray<string>
  /** The programs, besides, a test may start wherever they are found. */
  readonly names: ReadonlyArray<string>
  readonly platform: NodeJS.Platform
}

/** One spawn as asked: the program, its arguments, its environment and its folder. */
export interface Asked {
  readonly file: string
  readonly args: ReadonlyArray<string>
  readonly env: Readonly<Partial<Record<string, string>>>
  readonly cwd: string
}

/**
 * The programs a test may start wherever the `PATH` finds them: Node, the repository's own
 * toolchain (`pnpm`), `git`, what the supervisor asks about the machine's processes (`ps`,
 * `taskkill`, `powershell`), the shells the CI's steps run in, the read and build commands the
 * permission suites run for an agent (`ls`, `make`), and pacman's `vercmp`. Never an agent's CLI or
 * a forge's: a suite that wants one hands its fake.
 */
export const SYSTEM_PROGRAMS = [
  'node',
  'pnpm',
  'git',
  'ps',
  'taskkill',
  'powershell',
  'sh',
  'bash',
  'ls',
  'make',
  'vercmp',
]

/** The real path, short names and links resolved; the path as it is when it cannot be. */
function real(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    // Not there: compared as written.
    return path
  }
}

function isFile(candidate: string, platform: NodeJS.Platform): boolean {
  try {
    if (platform !== 'win32') accessSync(candidate, constants.X_OK)
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

/** Where the program of a spawn is, as the system would find it, or null when it is nowhere. */
export function located(asked: Asked, platform: NodeJS.Platform): string | null {
  const extensions =
    platform === 'win32'
      ? [
          '',
          ...(asked.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((one) => one !== ''),
        ]
      : ['']
  const folders = /[\\/]/.test(asked.file)
    ? [isAbsolute(asked.file) ? '' : asked.cwd]
    : (asked.env['PATH'] ?? asked.env['Path'] ?? '')
        .split(platform === 'win32' ? ';' : ':')
        .filter((one) => one !== '')
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate =
        folder === '' ? asked.file + extension : resolve(folder, asked.file + extension)
      if (isFile(candidate, platform)) return candidate
    }
  }
  return null
}

/** The program a `cmd.exe /d /s /c "<line>"` runs: the first word of the line, its carets removed. */
export function programOfLine(line: string): string {
  const inner = line.startsWith('"') && line.endsWith('"') ? line.slice(1, -1) : line
  const word = /^(?:\^.|[^ ])*/.exec(inner)?.[0] ?? ''
  return word.replace(/\^(.)/g, '$1')
}

const nameOf = (program: string): string => basename(program, extname(program)).toLowerCase()

function within(path: string, folder: string): boolean {
  const between = relative(folder, path)
  return between !== '' && !between.startsWith('..') && !isAbsolute(between)
}

/** The program a spawn would run that the rule refuses, or null when it may run. */
export function refusedBy(rule: SpawnRule, asked: Asked): string | null {
  const name = nameOf(asked.file)
  if (rule.platform === 'win32' && name === 'cmd' && asked.args.includes('/c')) {
    const line = asked.args.at(-1) ?? ''
    return refusedBy(rule, { ...asked, file: programOfLine(line), args: [] })
  }
  if (rule.names.includes(name)) return null
  const found = located(asked, rule.platform)
  // Found nowhere, nothing runs: the spawn fails on its own.
  if (found === null) return null
  const path = real(found)
  return rule.folders.some((folder) => within(path, real(folder))) ? null : found
}

/** The internal options `ChildProcess.prototype.spawn` receives from every asynchronous spawn. */
interface InternalOptions {
  readonly file: string
  readonly args?: ReadonlyArray<string>
  readonly envPairs?: ReadonlyArray<string>
  readonly cwd?: string
}

/** The environment a spawn hands its program, from Node's `KEY=value` pairs. */
const environmentOf = (pairs: ReadonlyArray<string> | undefined): Asked['env'] =>
  pairs === undefined
    ? { ...process.env }
    : Object.fromEntries(
        pairs.flatMap((pair) => {
          const at = pair.indexOf('=')
          return at > 0 ? [[pair.slice(0, at), pair.slice(at + 1)]] : []
        }),
      )

/** The options of a synchronous spawn, wherever its overload put them. */
interface SyncOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly cwd?: string | URL
}

/** The guard's state, one per process: the module is loaded again for every test file. */
interface GuardState {
  readonly refused: string[]
}

const STATE = Symbol.for('hemera.spawn-guard')

const stateOf = (): GuardState | undefined => {
  const state: GuardState | undefined = Reflect.get(globalThis, STATE)
  return state
}

/** The programs refused since the last call, now forgotten. */
export function takeRefused(): ReadonlyArray<string> {
  return stateOf()?.refused.splice(0) ?? []
}

/** Puts the guard on every way Node starts a process, once per process. */
export function installSpawnGuard(rule: SpawnRule): void {
  if (stateOf() !== undefined) return
  const state: GuardState = { refused: [] }
  Reflect.set(globalThis, STATE, state)

  const check = (asked: Asked) => {
    const program = refusedBy(rule, asked)
    if (program === null) return
    state.refused.push(program)
    throw new Error(`spawn-guard: a test may not start ${program} (see tools/spawn-guard.ts)`)
  }

  // SAFETY: Node's ChildProcess has an undocumented `spawn(options)` every asynchronous spawn,
  // `exec`, `execFile` and `fork` go through; its options carry the file, argv and environment.
  const spawnAsync = Reflect.get(ChildProcess.prototype, 'spawn') as (
    this: ChildProcess,
    options: InternalOptions,
  ) => void
  Reflect.set(
    ChildProcess.prototype,
    'spawn',
    function guarded(this: ChildProcess, options: InternalOptions) {
      check({
        file: options.file,
        args: options.args?.slice(1) ?? [],
        env: environmentOf(options.envPairs),
        cwd: options.cwd ?? process.cwd(),
      })
      spawnAsync.call(this, options)
    },
  )

  const syncAsked = (
    file: string,
    second: ReadonlyArray<string> | SyncOptions | undefined,
    third: SyncOptions | undefined,
  ): Asked => {
    const args = Array.isArray(second) ? second : []
    const options = Array.isArray(second) ? third : second
    const cwd = options?.cwd
    return {
      file,
      args,
      env: { ...(options?.env ?? process.env) },
      cwd: cwd === undefined ? process.cwd() : String(cwd),
    }
  }
  const { spawnSync, execFileSync } = childProcess
  // SAFETY: the wrappers hand their arguments on unchanged; only their reading is narrowed.
  childProcess.spawnSync = function guarded(file: string, second?: never, third?: never) {
    check(syncAsked(file, second, third))
    return spawnSync(file, second, third)
  } as typeof spawnSync
  // SAFETY: as above.
  childProcess.execFileSync = function guarded(file: string, second?: never, third?: never) {
    check(syncAsked(file, second, third))
    return execFileSync(file, second, third)
  } as typeof execFileSync
  // The named imports of `node:child_process` are bound to the exports as they were: rebind them.
  syncBuiltinESMExports()
}

/** The repository's root folder. */
export const REPOSITORY = join(import.meta.dirname, '..')
