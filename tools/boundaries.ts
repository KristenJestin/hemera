#!/usr/bin/env node
/**
 * Checks that the shared packages stay free of Electron and of React, and that the storage layer
 * stays in the engine.
 *
 * A package under `packages/` is read by every process: the renderer, main, the engine and the
 * agents' processes. One that imports Electron cannot be loaded by a page, and one that imports
 * React drags the interface into a process that has none. The applications import them; never
 * the other way round. The design system, `packages/ui`, is the one package made of React: it is
 * drawn by the renderer and nothing else, so it may import React and still never Electron.
 *
 * The database is the engine's alone: a second program holding the same file is how a data folder
 * gets two writers. So `node:sqlite`, Drizzle and the Effect SQLite client are imported under
 * `apps/desktop/src/engine/` and nowhere else.
 *
 * A file tool hands an agent a file's content through the judged open (`judged.ts`), which asks
 * the sensitive places first (#392). So under `apps/desktop/src/engine/tools/`, no other file
 * imports what of `node:fs` reads a file, nor does the capture of a Probe's files
 * (`engine/planning/probes.ts`, #425), which keeps what it reads; and the one exception to the
 * sensitive places, the file of a call a verdict judged (`Withholding.asked`), is made by the gate
 * alone. What the agents' other tools read is not seen here.
 *
 * The engine reads files of an agent's place on its own behalf too (#434, #439): a proof's test
 * file, a snapshot's index, a digest, a manifest. A pipe planted there would block the engine
 * on a read, so the files that do read through the judged open's own reads, which never wait on
 * one, and import nothing of `node:fs` that reads.
 *
 *   node tools/boundaries.ts
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** What a shared package must never import, and why. */
export const FORBIDDEN = [
  {
    pattern: /^electron(\/|$)/,
    reason: 'Electron, which only main and its utility processes have',
  },
  { pattern: /^react(-dom)?(\/|$)/, reason: 'React, which only the renderer has' },
] as const

/** The one folder the storage layer may be imported from. */
export const ENGINE = 'apps/desktop/src/engine/'

const STORAGE = /^(node:sqlite|drizzle-orm|drizzle-kit|@effect\/sql-sqlite-node)(\/|$)/

export interface Refusal {
  file: string
  found: string
  problem: string
}

const SPECIFIERS = [
  /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

/** Every module a source file names, in the order it names them. */
export function importsOf(source: string): string[] {
  const found: Array<{ at: number; specifier: string }> = []
  for (const pattern of SPECIFIERS) {
    for (const match of source.matchAll(pattern)) {
      found.push({ at: match.index, specifier: match[1]! })
    }
  }
  return found.toSorted((left, right) => left.at - right.at).map(({ specifier }) => specifier)
}

/** The package of React components, which the renderer alone draws. */
export const DESIGN_SYSTEM = 'packages/ui/'

export function refusalsOf(file: string, source: string): Refusal[] {
  const forbidden = file.startsWith(DESIGN_SYSTEM)
    ? FORBIDDEN.filter(({ pattern }) => !pattern.test('react'))
    : FORBIDDEN
  return importsOf(source).flatMap((specifier) =>
    forbidden
      .filter(({ pattern }) => pattern.test(specifier))
      .map(({ reason }) => ({
        file,
        found: specifier,
        problem: `a shared package imports ${reason}`,
      })),
  )
}

/** What a file outside the engine imports of the storage layer. */
export function storageRefusalsOf(file: string, source: string): Refusal[] {
  if (file.startsWith(ENGINE)) return []
  return importsOf(source)
    .filter((specifier) => STORAGE.test(specifier))
    .map((specifier) => ({
      file,
      found: specifier,
      problem: `the storage layer is imported outside ${ENGINE}`,
    }))
}

/** The file tools, which read files for an agent. */
export const FILE_TOOLS = 'apps/desktop/src/engine/tools/'

/** The capture of a Probe's files, which keeps their content as a file tool hands it (#425). */
const PROBE_CAPTURE = 'apps/desktop/src/engine/planning/probes.ts'

/** The judged open, the one file tool that reads a file's content with `node:fs`. */
const JUDGED_OPEN = `${FILE_TOOLS}judged.ts`

/** The gate, the one place that makes the exception for the file a verdict judged. */
const GATE = `${FILE_TOOLS}gate.ts`

/** What of `node:fs` opens, reads or copies a file, `promises` holding them all. */
const READS = new Set([
  'promises',
  'open',
  'openSync',
  'openAsBlob',
  'read',
  'readSync',
  'readv',
  'readvSync',
  'readFile',
  'readFileSync',
  'createReadStream',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
])

/** The files of the engine that read a file of an agent's place on Hemera's own behalf. */
export const OWN_READERS: ReadonlyArray<string> = [
  'building/proof-runner.ts',
  'building/snapshots.ts',
  'building/documenter.ts',
  'review/diffs.ts',
  'permissions/order.ts',
  'sessions/instructions.ts',
  'delivery-rules.ts',
].map((file) => `${ENGINE}${file}`)

const FS = String.raw`[\`'"](?:node:)?fs(?:/promises)?[\`'"]`

/** `{ a, b as c, type D }`'s names as the module has them, its types left out. */
const namesIn = (list: string, renamed: RegExp): string[] =>
  list
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '' && !one.startsWith('type '))
    .map((one) => one.split(renamed)[0]!.trim())

/** What a source takes of `node:fs`: its names, or `node:fs` for the whole module. */
function fsTaken(source: string): string[] {
  const taken: string[] = []
  for (const match of source.matchAll(
    new RegExp(String.raw`\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*${FS}`, 'g'),
  )) {
    if (match[1] === undefined) taken.push(...namesIn(match[2]!, /\s+as\s+/))
  }
  const whole = [
    String.raw`\bimport\s+(?!type\b)(?:\*\s*as\s+\w+|\w+)[^;'"]*?from\s*${FS}`,
    String.raw`\b(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*${FS}\s*\)`,
    String.raw`\bimport\s*\(\s*${FS}\s*\)`,
  ]
  for (const pattern of whole) {
    for (const _ of source.matchAll(new RegExp(pattern, 'g'))) taken.push('node:fs')
  }
  for (const match of source.matchAll(
    new RegExp(String.raw`\{([^}]*)\}\s*=\s*require\s*\(\s*${FS}\s*\)`, 'g'),
  )) {
    taken.push(...namesIn(match[1]!, /\s*:\s*/))
  }
  return taken
}

/**
 * What a file tool other than the judged open, the capture of a Probe's files, or a file of the
 * engine that reads a place's files on its own behalf, takes of `node:fs` to read a file.
 */
export function readRefusalsOf(file: string, source: string): Refusal[] {
  const tool = (file.startsWith(FILE_TOOLS) || file === PROBE_CAPTURE) && file !== JUDGED_OPEN
  if (!tool && !OWN_READERS.includes(file)) return []
  return fsTaken(source)
    .filter((name) => name === 'node:fs' || READS.has(name))
    .map((name) => ({
      file,
      found: name,
      problem: tool
        ? `a file tool reads a file without the judged open (${JUDGED_OPEN})`
        : `the engine reads a file of a place without the judged open's own reads (${JUDGED_OPEN}), which never wait on a pipe`,
    }))
}

/** A use of the exception for a judged call's file anywhere but the gate. */
export function askedRefusalsOf(file: string, source: string): Refusal[] {
  if (file === GATE || !/\bWithholding\.asked\b/.test(source)) return []
  return [
    {
      file,
      found: 'Withholding.asked',
      problem: `the file of a call a verdict judged is read by ${GATE} only`,
    },
  ]
}

function sourceFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFilesOf(path)
    return /\.[cm]?tsx?$/.test(entry.name) ? [path] : []
  })
}

/**
 * What a source file holds, or nothing when it is gone: a file another process creates and
 * removes while the tree is walked (a test's own deliberate type error) is not source.
 */
function sourceOf(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    // SAFETY: what `readFileSync` throws is a system error, which carries a `code`.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/** The source folders of the applications, each `apps/<name>/src`. */
function applicationSources(root: string): string[] {
  const apps = join(root, 'apps')
  if (!existsSync(apps)) return []
  return readdirSync(apps).map((name) => join(apps, name, 'src'))
}

/** Every refusal of the repository at `root`. */
export function analyze(root: string): Refusal[] {
  const named = (path: string) => relative(root, path).replaceAll('\\', '/')
  const shared = sourceFilesOf(join(root, 'packages')).flatMap((path) =>
    refusalsOf(named(path), sourceOf(path)),
  )
  const storage = [join(root, 'packages'), ...applicationSources(root)]
    .flatMap(sourceFilesOf)
    .flatMap((path) => storageRefusalsOf(named(path), sourceOf(path)))
  const reads = applicationSources(root)
    .flatMap(sourceFilesOf)
    .flatMap((path) => {
      const source = sourceOf(path)
      return readRefusalsOf(named(path), source).concat(askedRefusalsOf(named(path), source))
    })
  return [...shared, ...storage, ...reads]
}

if (import.meta.main) {
  const refusals = analyze(resolve(import.meta.dirname, '..'))
  for (const { file, found, problem } of refusals) console.error(`${file}: ${found} — ${problem}`)
  if (refusals.length > 0) process.exit(1)
  console.log(
    'the shared packages import no Electron, and no React outside the design system; the storage layer stays in the engine; the file tools and the engine’s own reads of a place read through the judged open',
  )
}
