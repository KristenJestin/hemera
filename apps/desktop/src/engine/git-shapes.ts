/**
 * What shapes the engine's own Git in a checkout (#457): the files Git reads to decide what it
 * runs (its configuration, its hooks, its attributes) as a fingerprint, compared before and after
 * an agent acts, so a change is seen however it was made.
 *
 * For each checkout: its `.git` (a folder, or a file naming one), the Git folder's `commondir`,
 * `gitdir` and `config.worktree`; in the common folder, `config`, `config.worktree`, every
 * worktree's `config.worktree`, `commondir` and `gitdir` and the `.git` file that `gitdir` names,
 * `hooks/` whole, `info/attributes` and `info/exclude`; the files every `include.path` and
 * `includeIf.*.path` of those configurations names, followed as deep as Git follows them; the
 * home's `.gitconfig`, `git/config` and `git/attributes`; and every folder a `core.hooksPath` of
 * any of them names, whole, relative to each checkout and linked worktree, or from the home. What the engine's own Git writes (the
 * index, the refs, `ORIG_HEAD`, `FETCH_HEAD`, the logs, `packed-refs`, the objects) is none of it.
 *
 * Every file is read on the engine's own behalf (`readOwnSync`): never a link as its last name,
 * never waiting on a pipe, never more than `SHAPE_CAP`; a hooks folder is walked to `WALKED`
 * entries at most, a link to a folder walked where it leads. A link is fingerprinted by what it says
 * and by the content where it leads, which is never kept as text: what the question shows is only
 * what sits in the files themselves. A pipe, a device or a socket is fingerprinted by its kind,
 * never opened; a file past the cap by its size and times.
 */

import { isUtf8 } from 'node:buffer'
import { createHash } from 'node:crypto'
import { type Stats, lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { Result } from 'effect'

import { readOwnSync } from './tools/judged.ts'

/** The most of one file that is read and hashed: past it, its size and times stand for it. */
export const SHAPE_CAP = 8 * 1024 * 1024

/** The most of one file kept as text for the question: past it, its change is said, not shown. */
const TEXT_KEPT = 64 * 1024

/** The most entries walked under one hooks folder: past it, the folder stands as one, too large. */
const WALKED = 20_000

/** How deep includes are followed: Git's own limit (`MAX_INCLUDE_DEPTH`). */
const INCLUDE_DEPTH = 10

/** Where the home's configuration is: the home folder, and the folder `XDG_CONFIG_HOME` names. */
export interface ShapeHome {
  readonly home: string
  readonly configHome: string
}

/** One file of the fingerprint. */
export interface Shape {
  /** A file, a link, a folder, a file past the cap, or anything else (a pipe, a device). */
  readonly kind: 'file' | 'link' | 'folder' | 'over' | 'other'
  /** What is compared: its kind, its mode and the hash of its content. */
  readonly digest: string
  /** Its text, for the question: null for a link, a binary, a file past what is kept. */
  readonly text: string | null
  /** Whether the home's configuration reaches it: it shapes every repository, not one. */
  readonly everywhere: boolean
}

/** The fingerprint: every file that shapes the engine's Git there, by its path. */
export type Shapes = ReadonlyMap<string, Shape>

/** One file that changed between two fingerprints: null where it was not there. */
export interface ShapeChange {
  readonly path: string
  readonly was: Shape | null
  readonly now: Shape | null
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const codeOf = (cause: unknown): string =>
  cause instanceof Error && 'code' in cause ? String(cause.code) : 'unreadable'

/** A regular file's bytes, read on the engine's own behalf, or why it was not read. */
function bytesOf(path: string): Result.Result<Buffer, string> {
  try {
    return Result.succeed(readOwnSync(path, SHAPE_CAP).bytes)
  } catch (cause) {
    return Result.fail(cause instanceof Error ? cause.message : codeOf(cause))
  }
}

/** A shape of one kind, with no text and reached from a repository only, until said otherwise. */
const shapeOf = (kind: Shape['kind'], digest: string, text: string | null = null): Shape => ({
  kind,
  digest,
  text,
  everywhere: false,
})

/** One path as it stands, and its bytes when it is a file read (a link's, where it leads). */
function entryOf(path: string): { readonly shape: Shape; readonly bytes: Buffer | null } | null {
  let named: Stats
  try {
    named = lstatSync(path)
  } catch (cause) {
    if (codeOf(cause) === 'ENOENT' || codeOf(cause) === 'ENOTDIR') return null
    return { shape: shapeOf('other', `unreadable:${codeOf(cause)}`), bytes: null }
  }
  if (named.isSymbolicLink()) {
    let says = ''
    let real: string
    try {
      says = readlinkSync(path)
      real = realpathSync.native(path)
    } catch (cause) {
      return { shape: shapeOf('link', `link:${says}:${codeOf(cause)}`), bytes: null }
    }
    const behind = entryOf(real)
    const digest = `link:${says}:${behind === null ? 'none' : behind.shape.digest}`
    return { shape: shapeOf('link', digest), bytes: behind?.bytes ?? null }
  }
  if (named.isDirectory()) return { shape: shapeOf('folder', 'folder'), bytes: null }
  if (!named.isFile())
    return { shape: shapeOf('other', `other:${String(named.mode)}`), bytes: null }
  if (named.size > SHAPE_CAP) {
    const digest = `over:${String(named.size)}:${String(named.mtimeMs)}:${String(named.ctimeMs)}`
    return { shape: shapeOf('over', digest), bytes: null }
  }
  const read = bytesOf(path)
  if (Result.isFailure(read)) {
    return { shape: shapeOf('other', `unread:${read.failure}`), bytes: null }
  }
  const bytes = read.success
  const mode = (named.mode & 0o777).toString(8)
  const text = bytes.length <= TEXT_KEPT && isUtf8(bytes) ? bytes.toString('utf8') : null
  return { shape: shapeOf('file', `file:${mode}:${sha256(bytes)}`, text), bytes }
}

/** The first line of a small file, trimmed, or null. */
function lineOf(path: string): string | null {
  const read = bytesOf(path)
  if (Result.isFailure(read)) return null
  return read.success.toString('utf8').split('\n')[0]?.trim() ?? null
}

/** The Git folder a checkout's `.git` is or names, or null when it has none. */
function gitDirOf(checkout: string): string | null {
  const dotGit = join(checkout, '.git')
  let named: Stats
  try {
    named = lstatSync(dotGit)
  } catch {
    return null
  }
  if (named.isDirectory()) return dotGit
  if (named.isSymbolicLink()) {
    try {
      return realpathSync.native(dotGit)
    } catch {
      return null
    }
  }
  const line = lineOf(dotGit)
  if (line === null || !line.startsWith('gitdir:')) return null
  return resolve(checkout, line.slice('gitdir:'.length).trim())
}

/** The common folder of a Git folder: the one its `commondir` names, or itself. */
function commonDirOf(gitDir: string): string {
  const line = lineOf(join(gitDir, 'commondir'))
  return line === null || line === '' ? gitDir : resolve(gitDir, line)
}

/** The names in a folder, none when it cannot be listed. */
function namesIn(folder: string): ReadonlyArray<string> {
  try {
    return readdirSync(folder).toSorted()
  } catch {
    return []
  }
}

/** The real path of a checkout that exists, as Git writes it into its pointers; as given otherwise. */
function realOf(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/**
 * The fingerprint of what shapes the engine's Git in these checkouts and in the home, and in these
 * common Git folders whichever checkouts still lead to them.
 */
export function shapesOf(
  checkouts: ReadonlyArray<string>,
  home: ShapeHome,
  repositories: ReadonlyArray<string> = [],
): Shapes {
  const shapes = new Map<string, Shape>()
  const bytes = new Map<string, Buffer>()
  const add = (path: string, everywhere = false): void => {
    const known = shapes.get(path)
    if (known !== undefined) {
      if (everywhere && !known.everywhere) shapes.set(path, { ...known, everywhere })
      return
    }
    const entry = entryOf(path)
    if (entry === null) return
    shapes.set(path, { ...entry.shape, everywhere })
    if (entry.bytes !== null) bytes.set(path, entry.bytes)
  }
  /**
   * A folder and everything under it, at most `WALKED` entries. A link is kept as itself and judged
   * where it leads: a folder it leads to is walked there, each real folder once.
   */
  const walk = (start: string, everywhere: boolean): void => {
    const walked = new Set<string>()
    let entries = 0
    const into = (folder: string): void => {
      if (entries > WALKED) return
      add(folder, everywhere)
      const shape = shapes.get(folder)
      if (shape === undefined) return
      let real = folder
      if (shape.kind === 'link') {
        const leads = realOrNull(folder)
        if (leads === null || entryOf(leads)?.shape.kind !== 'folder') return
        real = leads
        add(real, everywhere)
      } else if (shape.kind !== 'folder') return
      if (walked.has(real)) return
      walked.add(real)
      for (const name of namesIn(real)) {
        entries += 1
        if (entries > WALKED) {
          shapes.set(start, { ...shapeOf('over', `over:entries:${String(WALKED)}`), everywhere })
          return
        }
        into(join(real, name))
        if (entries > WALKED) return
      }
    }
    into(start)
  }
  const configs: string[] = []
  const commons = new Set<string>()
  /** Where hooks run from: every checkout, and every linked worktree of their repositories. */
  const tops = new Set<string>()
  const commonOnce = (common: string): void => {
    if (commons.has(common)) return
    commons.add(common)
    for (const name of ['config', 'config.worktree']) {
      add(join(common, name))
      configs.push(join(common, name))
    }
    add(join(common, 'info', 'attributes'))
    add(join(common, 'info', 'exclude'))
    walk(join(common, 'hooks'), false)
    const worktrees = join(common, 'worktrees')
    for (const name of namesIn(worktrees)) {
      const admin = join(worktrees, name)
      for (const file of ['commondir', 'gitdir', 'config.worktree']) add(join(admin, file))
      configs.push(join(admin, 'config.worktree'))
      const pointer = lineOf(join(admin, 'gitdir'))
      if (pointer === null || pointer === '') continue
      const named = resolve(admin, pointer)
      add(named)
      tops.add(dirname(named))
    }
  }
  for (const checkout of checkouts.map(realOf)) {
    tops.add(checkout)
    add(join(checkout, '.git'))
    const gitDir = gitDirOf(checkout)
    if (gitDir === null) continue
    for (const name of ['commondir', 'gitdir', 'config.worktree']) add(join(gitDir, name))
    configs.push(join(gitDir, 'config.worktree'))
    commonOnce(realOf(commonDirOf(gitDir)))
  }
  for (const common of repositories) commonOnce(common)
  const homeConfigs = [join(home.home, '.gitconfig'), join(home.configHome, 'git', 'config')]
  for (const path of homeConfigs) add(path, true)
  add(join(home.configHome, 'git', 'attributes'), true)
  // Every include, from the file that names it, as deep as Git goes; the home's first.
  const queue = [
    ...homeConfigs.map((path) => ({ path, depth: 0, everywhere: true })),
    ...configs.map((path) => ({ path, depth: 0, everywhere: false })),
  ]
  const followed = new Set<string>()
  const read: Array<{ readonly text: string; readonly everywhere: boolean }> = []
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const seen = `${String(next.everywhere)}\0${next.path}`
    if (followed.has(seen)) continue
    followed.add(seen)
    const text = bytes.get(next.path)?.toString('utf8')
    if (text === undefined) continue
    read.push({ text, everywhere: next.everywhere })
    for (const named of includesOf(text)) {
      const path = named.startsWith('~/')
        ? join(home.home, named.slice(2))
        : isAbsolute(named)
          ? resolve(named)
          : resolve(dirname(next.path), named)
      add(path, next.everywhere)
      if (next.depth + 1 < INCLUDE_DEPTH) {
        queue.push({ path, depth: next.depth + 1, everywhere: next.everywhere })
      }
    }
  }
  // Every folder a `core.hooksPath` names, whichever configuration set it: one named from the
  // home's shapes every repository; one relative to where the hooks run, each checkout.
  for (const { text, everywhere } of read) {
    for (const named of hooksPathsOf(text)) {
      if (named.startsWith('~/')) walk(join(home.home, named.slice(2)), everywhere)
      else if (isAbsolute(named)) walk(resolve(named), everywhere)
      else for (const top of tops) walk(resolve(top, named), false)
    }
  }
  return shapes
}

/** The real path of what is there, or null. */
function realOrNull(path: string): string | null {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/** The checkout a folder is in: the nearest folder at or above it with a `.git`; null outside any. */
export function checkoutOf(folder: string): string | null {
  let at = realOf(resolve(folder))
  for (;;) {
    if (gitDirOf(at) !== null) return at
    const up = dirname(at)
    if (up === at) return null
    at = up
  }
}

/** The common Git folder of a Git folder Git is handed (`--git-dir`, `GIT_DIR`), as its real path. */
export function commonOf(gitDir: string): string {
  return realOf(commonDirOf(gitDir))
}

/** The real path of a folder that exists; as given otherwise. */
export function realPathOf(path: string): string {
  return realOf(path)
}

/** One path as it stands now, as a fingerprint has it; null when it is not there. */
export function shapeAt(path: string): Shape | null {
  return entryOf(path)?.shape ?? null
}

/**
 * The common Git folder of the repository a folder is in, read from the `.git` of the folder or
 * of the nearest one above it, as its real path; null outside any. Git is not asked: it is what
 * is guarded.
 */
export function repositoryOf(folder: string): string | null {
  let at = realOf(resolve(folder))
  for (;;) {
    const gitDir = gitDirOf(at)
    if (gitDir !== null) return realOf(commonDirOf(gitDir))
    const up = dirname(at)
    if (up === at) return null
    at = up
  }
}

/** Each file that differs between two fingerprints, by its path. */
export function shapeChanges(before: Shapes, after: Shapes): ReadonlyArray<ShapeChange> {
  const paths = [...new Set([...before.keys(), ...after.keys()])].toSorted()
  return paths.flatMap((path) => {
    const was = before.get(path) ?? null
    const now = after.get(path) ?? null
    return was?.digest === now?.digest ? [] : [{ path, was, now }]
  })
}

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\r'
const isAlpha = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z]$/.test(c)
const isKeyChar = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z0-9-]$/.test(c)
const isSectionChar = (c: string | undefined): boolean =>
  c !== undefined && /^[A-Za-z0-9.-]$/.test(c)

/** What a backslash and the letter after it stand for in a value, as Git reads them. */
const ESCAPED = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['b', '\b'],
  ['\\', '\\'],
  ['"', '"'],
])

/**
 * The paths every `include.path` and `includeIf.<condition>.path` of a Git configuration names,
 * read as Git's own parser reads them (`config.c`): sections in any case, a key on the line of its
 * section, quotes, escapes, a backslash that continues the line, and comments. Every condition is
 * taken as met. Where Git would refuse the file, reading stops: Git runs nothing from it.
 */
export function includesOf(text: string): ReadonlyArray<string> {
  return entriesOf(text).flatMap((entry) =>
    ((entry.section === 'include' && entry.subsection === null) ||
      (entry.section === 'includeif' && entry.subsection !== null)) &&
    entry.key === 'path' &&
    entry.value !== null &&
    entry.value !== ''
      ? [entry.value]
      : [],
  )
}

/** Every `core.hooksPath` a Git configuration sets, read as `includesOf` reads it. */
export function hooksPathsOf(text: string): ReadonlyArray<string> {
  return entriesOf(text).flatMap((entry) =>
    entry.section === 'core' &&
    entry.subsection === null &&
    entry.key === 'hookspath' &&
    entry.value !== null &&
    entry.value !== ''
      ? [entry.value]
      : [],
  )
}

/** The entries `git worktree add` writes itself under `worktree.useRelativePaths`. */
const WORKTREE_FORMAT = new Set(['extensions.relativeworktrees', 'core.repositoryformatversion'])

/**
 * Whether two texts of a configuration differ only by what `git worktree add` writes itself when
 * worktrees name their repository by a relative path: `extensions.relativeWorktrees` and the
 * repository's format version. Compared entry by entry, in order.
 */
export function onlyWorktreeFormat(was: string, now: string): boolean {
  const kept = (text: string) =>
    entriesOf(text)
      .filter(
        (entry) =>
          entry.subsection !== null || !WORKTREE_FORMAT.has(`${entry.section}.${entry.key}`),
      )
      .map((entry) => JSON.stringify(entry))
  const before = kept(was)
  const after = kept(now)
  return before.length === after.length && before.every((one, at) => one === after[at])
}

/** One entry of a Git configuration: its section and key lowercased, the subsection as written. */
interface ConfigEntry {
  readonly section: string
  readonly subsection: string | null
  readonly key: string
  readonly value: string | null
}

/** Every entry of a Git configuration, in order, up to where Git would refuse the file. */
function entriesOf(text: string): ReadonlyArray<ConfigEntry> {
  const source = text.replaceAll('\r\n', '\n')
  const found: ConfigEntry[] = []
  let at = source.startsWith('﻿') ? 1 : 0
  let base = ''
  let sub: string | null = null
  const toLineEnd = () => {
    while (at < source.length && source[at] !== '\n') at += 1
  }
  /** A value after its `=`, or null where Git refuses it. */
  const value = (): string | null => {
    let out = ''
    let spaces = 0
    let quoted = false
    let comment = false
    for (; at < source.length; at += 1) {
      const c = source[at]
      if (c === '\n') {
        if (quoted) return null
        return out
      }
      if (comment) continue
      if (isSpace(c) && !quoted) {
        if (out.length > 0) spaces += 1
        continue
      }
      if (!quoted && (c === ';' || c === '#')) {
        comment = true
        continue
      }
      out += ' '.repeat(spaces)
      spaces = 0
      if (c === '\\') {
        at += 1
        const escaped = source[at]
        if (escaped === '\n') continue
        const mapped = escaped === undefined ? undefined : ESCAPED.get(escaped)
        if (mapped === undefined) return null
        out += mapped
        continue
      }
      if (c === '"') {
        quoted = !quoted
        continue
      }
      out += c
    }
    return quoted ? null : out
  }
  while (at < source.length) {
    const c = source[at]
    if (c === '\n' || isSpace(c)) {
      at += 1
      continue
    }
    if (c === '#' || c === ';') {
      toLineEnd()
      continue
    }
    if (c === '[') {
      at += 1
      let name = ''
      for (; isSectionChar(source[at]); at += 1) name += source[at]
      if (source[at] === ']') {
        at += 1
        const dot = name.indexOf('.')
        base = (dot < 0 ? name : name.slice(0, dot)).toLowerCase()
        sub = dot < 0 ? null : name.slice(dot + 1).toLowerCase()
        continue
      }
      if (!isSpace(source[at]) || name.includes('.')) return found
      while (isSpace(source[at])) at += 1
      if (source[at] !== '"') return found
      at += 1
      let named = ''
      while (at < source.length && source[at] !== '"') {
        if (source[at] === '\n') return found
        if (source[at] === '\\') at += 1
        named += source[at] ?? ''
        at += 1
      }
      if (source[at + 1] !== ']') return found
      at += 2
      base = name.toLowerCase()
      sub = named
      continue
    }
    if (!isAlpha(c)) return found
    let key = ''
    for (; isKeyChar(source[at]); at += 1) key += source[at]
    while (isSpace(source[at])) at += 1
    let said: string | null = null
    if (at < source.length && source[at] !== '\n') {
      if (source[at] !== '=') return found
      at += 1
      said = value()
      if (said === null) return found
    }
    found.push({ section: base, subsection: sub, key: key.toLowerCase(), value: said })
  }
  return found
}
