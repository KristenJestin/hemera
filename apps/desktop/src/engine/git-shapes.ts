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
 * A submodule's own Git folder is read as the repository's (#470): each one under the common
 * folder's `modules/`, nested ones under theirs, and each one a checkout's `.git` leads to, for every
 * submodule its index names (its gitlinks), as `git status` walks into them. Its checkout is where
 * its hooks run from. An index that cannot be read for them (a link, not a file, past `INDEX_CAP`,
 * locked, cut, of a version not known) is never taken as naming none: it stands in the fingerprint
 * at its path, by its reason (#474), so the guard asks about it.
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
import {
  type BigIntStats,
  type Stats,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { Result } from 'effect'

import { NotJudged, readOwnSync } from './tools/judged.ts'

/** The most of one file that is read and hashed: past it, its size and times stand for it. */
export const SHAPE_CAP = 8 * 1024 * 1024

/** The most of one file kept as text for the question: past it, its change is said, not shown. */
const TEXT_KEPT = 64 * 1024

/** The most entries walked under one hooks folder: past it, the folder stands as one, too large. */
const WALKED = 20_000

/** The most of an index that is read for its submodules: past it, the index is said unread. */
const INDEX_CAP = 64 * 1024 * 1024

/** The digest of an index that could not be read for its submodules, before its reason. */
const UNREAD_INDEX = 'index:unread:'

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
  /**
   * For a configuration only, never a hook or an attributes file: the digest of its entries but
   * those a user's everyday Git writes on its own and that run nothing (`EVERYDAY`). Null for any
   * other file, and for a configuration Git would not read whole.
   */
  readonly steady: string | null
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
  steady: null,
})

/** How long a file must have stood unchanged before its stat stands for its bytes. */
const SETTLED_NS = 2_000_000_000n
/** At most this many files are remembered; past it, the memory starts again. */
const REMEMBERED = 100_000

/**
 * The shapes of the files of hooks folders hashed once, by path, with the stat they had. One whose
 * size, times, inode, device and mode are the same is not read again, unless it was hashed less
 * than `SETTLED_NS` after its last change: a rewrite in that same tick could keep every one of
 * them. A configuration, an included file or an attributes file is hashed every time, on every
 * system: a stat can be set back (NTFS's ChangeTime can), and those few files are cheap to read.
 */
const hashed = new Map<
  string,
  {
    readonly stat: string
    readonly settled: boolean
    readonly shape: Shape
  }
>()

/**
 * What a configuration file of this digest includes, where it sets the hooks, its steady digest,
 * and whether its objects are named by sha256, parsed once.
 */
const configNames = new Map<
  string,
  {
    readonly includes: ReadonlyArray<string>
    readonly hooksPaths: ReadonlyArray<string>
    readonly steady: string | null
    readonly sha256: boolean
  }
>()

/** The submodules an index names, by its path, with the stat it had: read again once it changed. */
const indexed = new Map<
  string,
  {
    readonly stat: string
    readonly settled: boolean
    readonly read: Gitlinks
  }
>()

/** What a fingerprint reads of a path's stat. */
export type ShapeStat = Pick<
  BigIntStats,
  | 'isSymbolicLink'
  | 'isDirectory'
  | 'isFile'
  | 'size'
  | 'mtimeNs'
  | 'ctimeNs'
  | 'ino'
  | 'dev'
  | 'mode'
>

/** A path's stat, as the fingerprint reads it: the machine's own, but for the tests. */
export type StatOf = (path: string) => ShapeStat

const lstatOf: StatOf = (path) => lstatSync(path, { bigint: true })

/** What a file's stat says of it: one that says the same has not been rewritten, once settled. */
const statKey = (named: ShapeStat): string =>
  [named.size, named.mtimeNs, named.ctimeNs, named.ino, named.dev, named.mode].join(':')

/** Whether a file's last change is long enough ago that a rewrite would change its stat. */
const settledOf = (named: ShapeStat): boolean =>
  BigInt(Date.now()) * 1_000_000n -
    (named.mtimeNs > named.ctimeNs ? named.mtimeNs : named.ctimeNs) >=
  SETTLED_NS

/**
 * One path as it stands, and its bytes when it is a file read (a link's, where it leads). Only a
 * `trusted` file, one of a hooks folder, may stand for its bytes by its stat.
 */
function entryOf(
  path: string,
  trusted = false,
  statOf: StatOf = lstatOf,
): { readonly shape: Shape; readonly bytes: Buffer | null } | null {
  let named: ShapeStat
  try {
    named = statOf(path)
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
    const behind = entryOf(real, trusted, statOf)
    const digest = `link:${says}:${behind === null ? 'none' : behind.shape.digest}`
    return { shape: shapeOf('link', digest), bytes: behind?.bytes ?? null }
  }
  if (named.isDirectory()) return { shape: shapeOf('folder', 'folder'), bytes: null }
  if (!named.isFile())
    return { shape: shapeOf('other', `other:${String(named.mode)}`), bytes: null }
  if (named.size > BigInt(SHAPE_CAP)) {
    const digest = `over:${String(named.size)}:${String(named.mtimeNs)}:${String(named.ctimeNs)}`
    return { shape: shapeOf('over', digest), bytes: null }
  }
  const stat = statKey(named)
  const known = trusted ? hashed.get(path) : undefined
  if (known !== undefined && known.settled && known.stat === stat) {
    return { shape: known.shape, bytes: null }
  }
  const settled = settledOf(named)
  const read = bytesOf(path)
  if (Result.isFailure(read)) {
    return { shape: shapeOf('other', `unread:${read.failure}`), bytes: null }
  }
  const bytes = read.success
  const mode = (named.mode & 0o777n).toString(8)
  const text = bytes.length <= TEXT_KEPT && isUtf8(bytes) ? bytes.toString('utf8') : null
  const shape = shapeOf('file', `file:${mode}:${sha256(bytes)}`, text)
  if (trusted) {
    if (hashed.size >= REMEMBERED) hashed.clear()
    hashed.set(path, { stat, settled, shape })
  }
  return { shape, bytes }
}

/** A file's bytes as read now, or null. */
function textOf(path: string): Buffer | null {
  const read = bytesOf(path)
  return Result.isSuccess(read) ? read.success : null
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

/** Whether a folder is a Git folder itself, as Git finds a bare one: a HEAD, objects and refs. */
function isGitFolder(folder: string): boolean {
  const kind = (name: string) => entryOf(join(folder, name))?.shape.kind
  return kind('HEAD') === 'file' && kind('objects') === 'folder' && kind('refs') === 'folder'
}

/** The common folder of a Git folder: the one its `commondir` names, or itself. */
function commonDirOf(gitDir: string): string {
  const line = lineOf(join(gitDir, 'commondir'))
  return line === null || line === '' ? gitDir : resolve(gitDir, line)
}

/** What an index says of its submodules. */
interface IndexRead {
  readonly gitlinks: ReadonlyArray<string>
  /** The name of the shared index a split index builds on, or null. */
  readonly shared: string | null
}

/** The submodules a Git folder's index names, or why it could not be read for them. */
type Gitlinks = Result.Result<ReadonlyArray<string>, string>

/**
 * The paths of the submodules an index names (its gitlinks), in its versions 2 to 4, and the shared
 * index a split index builds on; null for an index it cannot parse (cut, another version), which is
 * never taken as naming none.
 */
function indexOf(bytes: Buffer, hash: number): IndexRead | null {
  if (bytes.length < 12 || bytes.toString('latin1', 0, 4) !== 'DIRC') return null
  const version = bytes.readUInt32BE(4)
  if (version < 2 || version > 4) return null
  const gitlinks: string[] = []
  let at = 12
  let previous: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  try {
    for (let left = bytes.readUInt32BE(8); left > 0; left -= 1) {
      const start = at
      const mode = bytes.readUInt32BE(at + 24)
      const flags = bytes.readUInt16BE(at + 40 + hash)
      at += 42 + hash + (version >= 3 && (flags & 0x4000) !== 0 ? 2 : 0)
      let name: Buffer
      if (version === 4) {
        // The name is the end of the one before, cut by a varint, then its own NUL-ended rest.
        let byte = bytes.readUInt8(at)
        at += 1
        let cut = byte & 127
        while ((byte & 128) !== 0) {
          byte = bytes.readUInt8(at)
          at += 1
          cut = ((cut + 1) << 7) + (byte & 127)
        }
        const end = bytes.indexOf(0, at)
        if (end < 0 || cut > previous.length) return null
        name = Buffer.concat([previous.subarray(0, previous.length - cut), bytes.subarray(at, end)])
        at = end + 1
      } else {
        const end = bytes.indexOf(0, at)
        if (end < 0) return null
        name = bytes.subarray(at, end)
        at = start + ((at - start + name.length + 8) & ~7)
      }
      if ((mode & 0o170000) === 0o160000) gitlinks.push(name.toString('utf8'))
      previous = name
    }
    let shared: string | null = null
    while (at + 8 <= bytes.length - hash) {
      if (bytes.toString('latin1', at, at + 4) === 'link') {
        shared = bytes.toString('hex', at + 8, at + 8 + hash)
      }
      at += 8 + bytes.readUInt32BE(at + 4)
    }
    return { gitlinks, shared: shared === null || /^0+$/.test(shared) ? null : shared }
  } catch {
    // An entry past the end: the index is cut.
    return null
  }
}

/**
 * The submodules the index of a Git folder names, and its shared index's, if a split index, or why
 * it could not be read for them (a link, not a file, past `INDEX_CAP`, an error, not parsed); read
 * again only once the index's stat changed, as a hooks folder's files are. A Git folder with no
 * index names none, as Git reads it.
 */
function gitlinksAt(gitDir: string, hash: number, statOf: StatOf): Gitlinks {
  const path = join(gitDir, 'index')
  let named: ShapeStat
  try {
    named = statOf(path)
  } catch (cause) {
    if (codeOf(cause) === 'ENOENT' || codeOf(cause) === 'ENOTDIR') return Result.succeed([])
    return Result.fail(`it could not be read (${codeOf(cause)})`)
  }
  const stat = statKey(named)
  const known = indexed.get(path)
  if (known !== undefined && known.settled && known.stat === stat) return known.read
  const settled = settledOf(named)
  const read = readGitlinks(gitDir, path, named, hash)
  if (indexed.size >= REMEMBERED) indexed.clear()
  indexed.set(path, { stat, settled, read })
  return read
}

/** What an index of this stat names, its shared part's included, or why it could not be read. */
function readGitlinks(gitDir: string, path: string, named: ShapeStat, hash: number): Gitlinks {
  if (named.isSymbolicLink()) return Result.fail('it is a link, never followed')
  if (!named.isFile()) return Result.fail('it is not a regular file, never opened')
  if (named.size > BigInt(INDEX_CAP)) {
    return Result.fail(`it is larger than ${String(INDEX_CAP / 1024 / 1024)} MiB`)
  }
  const own = indexIn(path, hash)
  if (Result.isFailure(own)) return Result.fail(own.failure)
  if (own.success.shared === null) return Result.succeed(own.success.gitlinks)
  const shared = indexIn(join(gitDir, `sharedindex.${own.success.shared}`), hash)
  if (Result.isFailure(shared))
    return Result.fail(`its shared part (a split index): ${shared.failure}`)
  return Result.succeed([...own.success.gitlinks, ...shared.success.gitlinks])
}

/** An index file read on the engine's own behalf and parsed, or why it was not. */
function indexIn(path: string, hash: number): Result.Result<IndexRead, string> {
  let bytes: Buffer
  try {
    bytes = readOwnSync(path, INDEX_CAP).bytes
  } catch (cause) {
    return Result.fail(
      `it could not be read (${cause instanceof NotJudged ? cause.message : codeOf(cause)})`,
    )
  }
  const read = indexOf(bytes, hash)
  return read === null
    ? Result.fail('it is cut, or of a version or a format Hemera does not know')
    : Result.succeed(read)
}

/**
 * An index that could not be read for its submodules, as the fingerprint says it: by its reason
 * only, so it is asked about once, and with words for the question.
 */
const unreadIndex = (reason: string): Shape =>
  shapeOf(
    'other',
    `${UNREAD_INDEX}${reason}`,
    `Hemera could not read this index for its submodules: ${reason}.\nThe Git folders of the submodules it names are not watched until it can.\n`,
  )

/** Whether a shape stands for an index that could not be read for its submodules. */
export const isUnreadIndex = (shape: Shape): boolean => shape.digest.startsWith(UNREAD_INDEX)

/** Whether a path is a folder or under it. */
const inside = (folder: string, path: string): boolean =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep)

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
  statOf: StatOf = lstatOf,
): Shapes {
  const shapes = new Map<string, Shape>()
  const bytes = new Map<string, Buffer>()
  /** The files read as something other than a configuration: hooks, attributes, excludes. */
  const plain = new Set<string>()
  const add = (path: string, everywhere = false, trusted = false): void => {
    if (trusted) plain.add(path)
    const known = shapes.get(path)
    if (known !== undefined) {
      if (everywhere && !known.everywhere) shapes.set(path, { ...known, everywhere })
      return
    }
    const entry = entryOf(path, trusted, statOf)
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
      add(folder, everywhere, true)
      const shape = shapes.get(folder)
      if (shape === undefined) return
      let real = folder
      if (shape.kind === 'link') {
        const leads = realOrNull(folder)
        if (leads === null || entryOf(leads, true, statOf)?.shape.kind !== 'folder') return
        real = leads
        add(real, everywhere, true)
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
  /** The folders under a `modules/` already looked into, by their real path. */
  const looked = new Set<string>()
  /** The configuration of a file read so far, parsed once per digest. */
  const parsed = (path: string) => {
    const shape = shapes.get(path)
    if (shape === undefined || (shape.kind !== 'file' && shape.kind !== 'link')) return null
    const known = configNames.get(shape.digest)
    if (known !== undefined) return known
    // A large file trusted on its stat comes without its bytes: read again here.
    const text = (bytes.get(path) ?? textOf(realOrNull(path) ?? path))?.toString('utf8')
    if (text === undefined) return null
    const names = {
      includes: includesOf(text),
      hooksPaths: hooksPathsOf(text),
      steady: steadyOf(text),
      sha256: entriesOf(text).some(
        (entry) =>
          entry.section === 'extensions' &&
          entry.subsection === null &&
          entry.key === 'objectformat' &&
          entry.value?.toLowerCase() === 'sha256',
      ),
    }
    if (configNames.size >= REMEMBERED) configNames.clear()
    configNames.set(shape.digest, names)
    return names
  }
  /** The submodules' Git folders under a `modules/`, a name perhaps holding slashes. */
  const modulesIn = (folder: string): void => {
    const real = realOf(folder)
    if (looked.has(real)) return
    looked.add(real)
    if (isGitFolder(real)) {
      commonOnce(real)
      return
    }
    for (const name of namesIn(real)) modulesIn(join(real, name))
  }
  /** Where hooks run from: every checkout, and every linked worktree of their repositories. */
  const tops = new Set<string>()
  const commonOnce = (common: string): void => {
    if (commons.has(common)) return
    commons.add(common)
    for (const name of ['config', 'config.worktree']) {
      add(join(common, name))
      configs.push(join(common, name))
    }
    for (const name of ['attributes', 'exclude']) {
      add(join(common, 'info', name))
      plain.add(join(common, 'info', name))
    }
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
    for (const name of namesIn(join(common, 'modules'))) modulesIn(join(common, 'modules', name))
  }
  // Each checkout, and each submodule its index names, as `git status` walks into them.
  const pending = checkouts.map(realOf)
  const visited = new Set<string>()
  for (let checkout = pending.shift(); checkout !== undefined; checkout = pending.shift()) {
    if (visited.has(checkout)) continue
    visited.add(checkout)
    tops.add(checkout)
    add(join(checkout, '.git'))
    const gitDir = gitDirOf(checkout)
    if (gitDir === null) continue
    for (const name of ['commondir', 'gitdir', 'config.worktree']) add(join(gitDir, name))
    configs.push(join(gitDir, 'config.worktree'))
    const common = realOf(commonDirOf(gitDir))
    commonOnce(common)
    const hash = parsed(join(common, 'config'))?.sha256 === true ? 32 : 20
    const gitlinks = gitlinksAt(gitDir, hash, statOf)
    if (Result.isFailure(gitlinks)) {
      // Never read as naming none: an embedded repository's own filter would go unwatched.
      shapes.set(join(gitDir, 'index'), unreadIndex(gitlinks.failure))
      continue
    }
    for (const path of gitlinks.success) pending.push(realOf(join(checkout, path)))
  }
  for (const common of repositories) commonOnce(common)
  const homeConfigs = [join(home.home, '.gitconfig'), join(home.configHome, 'git', 'config')]
  for (const path of homeConfigs) add(path, true)
  add(join(home.configHome, 'git', 'attributes'), true)
  plain.add(join(home.configHome, 'git', 'attributes'))
  // Every include, from the file that names it, as deep as Git goes; the home's first.
  const queue = [
    ...homeConfigs.map((path) => ({ path, depth: 0, everywhere: true })),
    ...configs.map((path) => ({ path, depth: 0, everywhere: false })),
  ]
  const followed = new Set<string>()
  const read: Array<{ readonly hooksPaths: ReadonlyArray<string>; readonly everywhere: boolean }> =
    []
  const steadies = new Map<string, string | null>()
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const seen = `${String(next.everywhere)}\0${next.path}`
    if (followed.has(seen)) continue
    followed.add(seen)
    const names = parsed(next.path)
    if (names === null) continue
    read.push({ hooksPaths: names.hooksPaths, everywhere: next.everywhere })
    steadies.set(next.path, names.steady)
    for (const named of names.includes) {
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
  for (const { hooksPaths, everywhere } of read) {
    for (const named of hooksPaths) {
      if (named.startsWith('~/')) walk(join(home.home, named.slice(2)), everywhere)
      else if (isAbsolute(named)) walk(resolve(named), everywhere)
      else for (const top of tops) walk(resolve(top, named), false)
    }
  }
  // A file read as a configuration and as nothing else has its steady digest.
  for (const [path, steady] of steadies) {
    const shape = shapes.get(path)
    if (shape !== undefined && !plain.has(path)) shapes.set(path, { ...shape, steady })
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
 * of the nearest one above it, or the folder itself when it is a bare repository, as its real
 * path; null outside any. Git is not asked: it is what
 * is guarded.
 */
export function repositoryOf(folder: string): string | null {
  let at = realOf(resolve(folder))
  for (;;) {
    const gitDir = gitDirOf(at) ?? (isGitFolder(at) ? at : null)
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

/**
 * The entries a user's everyday Git writes into a configuration on its own, by section, and that
 * run nothing: a branch's upstream (`checkout --track`, `branch -u`, `push -u`, a worktree's branch
 * made from a remote one) and a submodule's address and activation (`submodule add`, `init`,
 * `deinit`). A submodule's `update`, which may name a program, is not one of them.
 */
const EVERYDAY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['branch', new Set(['remote', 'merge'])],
  ['submodule', new Set(['url', 'active'])],
])

/**
 * The digest of a configuration's entries but the everyday ones, in order: two texts with the same
 * one differ only by what everyday Git writes. Null where Git would not read the text whole: what it
 * would make of the rest is not judged.
 */
function steadyOf(text: string): string | null {
  const { entries, whole } = configOf(text)
  if (!whole) return null
  const kept = entries.filter(
    (entry) => entry.subsection === null || EVERYDAY.get(entry.section)?.has(entry.key) !== true,
  )
  return sha256(Buffer.from(JSON.stringify(kept)))
}

/**
 * What `git clone` writes into the configuration of the repository it makes, beside the everyday
 * entries: its format, how it reads the disk, its work tree, its remote. None of it runs anything.
 */
const CLONED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    'core',
    new Set([
      'repositoryformatversion',
      'filemode',
      'bare',
      'logallrefupdates',
      'worktree',
      'symlinks',
      'ignorecase',
      'precomposeunicode',
    ]),
  ],
  ['extensions', new Set(['objectformat'])],
])

/**
 * Whether a file added to a repository's fingerprint is part of a submodule's Git folder as `git
 * submodule` clones it, which runs nothing: a folder under the common folder's `modules/`, a
 * sample hook or `info/exclude` there, a `config` holding only what a clone writes, or a
 * checkout's `.git` file. Anything else a submodule brings is asked about.
 */
export function asCloned(common: string, path: string, shape: Shape): boolean {
  const modules = join(common, 'modules')
  if (inside(modules, path)) {
    if (shape.kind === 'folder') return true
    if (shape.kind !== 'file') return false
    const name = basename(path)
    const parent = basename(dirname(path))
    if (parent === 'hooks' && name.endsWith('.sample')) return true
    if (parent === 'info' && name === 'exclude') return true
    if (name !== 'config' || shape.text === null) return false
    const { entries, whole } = configOf(shape.text)
    return (
      whole &&
      entries.every((entry) =>
        entry.subsection === null
          ? CLONED.get(entry.section)?.has(entry.key) === true
          : (entry.section === 'remote' && (entry.key === 'url' || entry.key === 'fetch')) ||
            EVERYDAY.get(entry.section)?.has(entry.key) === true,
      )
    )
  }
  // What it names is part of the fingerprint, and judged there.
  return basename(path) === '.git' && shape.kind === 'file'
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
  return configOf(text).entries
}

/** The entries of a Git configuration up to where Git would refuse it, and whether it read whole. */
interface ConfigRead {
  readonly entries: ReadonlyArray<ConfigEntry>
  readonly whole: boolean
}

function configOf(text: string): ConfigRead {
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
      if (!isSpace(source[at]) || name.includes('.')) return { entries: found, whole: false }
      while (isSpace(source[at])) at += 1
      if (source[at] !== '"') return { entries: found, whole: false }
      at += 1
      let named = ''
      while (at < source.length && source[at] !== '"') {
        if (source[at] === '\n') return { entries: found, whole: false }
        if (source[at] === '\\') at += 1
        named += source[at] ?? ''
        at += 1
      }
      if (source[at + 1] !== ']') return { entries: found, whole: false }
      at += 2
      base = name.toLowerCase()
      sub = named
      continue
    }
    if (!isAlpha(c)) return { entries: found, whole: false }
    let key = ''
    for (; isKeyChar(source[at]); at += 1) key += source[at]
    while (isSpace(source[at])) at += 1
    let said: string | null = null
    if (at < source.length && source[at] !== '\n') {
      if (source[at] !== '=') return { entries: found, whole: false }
      at += 1
      said = value()
      if (said === null) return { entries: found, whole: false }
    }
    found.push({ section: base, subsection: sub, key: key.toLowerCase(), value: said })
  }
  return { entries: found, whole: true }
}
