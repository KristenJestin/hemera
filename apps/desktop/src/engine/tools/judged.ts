/**
 * The file a path the gate judged really is, when a tool uses it (#373).
 *
 * The gate judges a path by where it really leads, then the tool uses it: between the two, a
 * command running beside the session can plant a link or a junction on the way, and keep swapping
 * it. So a file or a folder is opened once, and every judgement after the open is made on the
 * opened handle, never on a name again:
 *
 * - it is a regular file (or, for a folder, a folder): a pipe or a device is refused, and is
 *   opened without waiting (`O_NONBLOCK`), so a pipe never holds a thread of the engine;
 * - where the handle really is, as the system has it, is the real path the gate judged: on Linux
 *   the path of the open file (`/proc/self/fd/<fd>`), so no link or junction stood on the way when
 *   it was opened, whatever the names say before or after;
 * - a file kept as evidence or written over has a single name on the disk, under the rule on
 *   hard links (`SECOND_NAME_REFUSED`, one place); a file only read may have several;
 * - a file read is one whose content the session may read (`./withholding.ts`, #392): a file in a
 *   sensitive place is never opened, its read refused as withheld.
 *
 * A folder is used through its handle too: on Linux a name in it is reached through
 * `/proc/self/fd/<fd>/<name>`, which is the opened folder itself whatever happens to its path, so
 * what is listed, made, written and renamed there is in the folder that was proven.
 *
 * Windows has no path of an open handle that Node can read without a native call. There the
 * check looks the path up by name after the open (`realpath`, then the file id), which a swap that
 * keeps racing can beat: the residual put to the maintainer.
 */

import {
  type BigIntStats,
  type Dirent,
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs'
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  stat,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { Predicate } from 'effect'

import { CONTENT_WITHHELD, type Withholding } from './withholding.ts'

/** Why a path is no longer the one judged: a link or a junction stood on its way. */
export const THROUGH_A_LINK =
  'a link or a junction now stands on its way, and a path is never followed after it was judged'

/**
 * The rule on files with more than one name on the disk (hard links), in one place: what such a
 * file is never used for, and why. It is read as any file (pnpm, bun and uv make one of every
 * dependency file, and a command that could plant one could as well copy the file); it is never
 * kept as evidence, where a hard link would carry a file from outside the Workspace into the
 * mission's evidence, and never written over, the rule #373 set for writes.
 */
const SECOND_NAME_REFUSED = {
  evidence:
    'it has more than one name on the disk (a hard link), and its other name may be a file outside the Workspace: it is never kept as evidence',
  write:
    'it has more than one name on the disk (a hard link), and its other name may be a file outside the Workspace: it is never written over',
} as const

/** What a file with more than one name is refused for. */
export type OneNameFor = keyof typeof SECOND_NAME_REFUSED

/** Why a pipe, a device or a folder is not read or written as a file. */
export const NOT_A_FILE = 'it is not a regular file (a pipe, a device or a folder)'

/** Why a file is not read: it is larger than what its reader reads of such a file. */
export const OVER_CAP = 'it is larger than Hemera reads of such a file'

/** Why a write is said to have failed when its folder moved while it was written. */
export const MOVED =
  'its folder was moved away from where it was judged while it was written, and what was written went with it'

/** Thrown when a path is not the file or folder that was judged. */
export class NotJudged extends Error {}

/** Whether the system says where an open handle is: Linux, through `/proc/self/fd`. */
const BY_HANDLE = process.platform === 'linux'

/** Never waiting on a pipe, and never through a link as the last name, where the flags exist. */
const NEVER_WAITING = BY_HANDLE ? constants.O_NONBLOCK | constants.O_NOFOLLOW : 0

/** The reasons a use of a judged path is refused rather than failed. */
const JUDGED_REFUSALS: ReadonlyArray<string> = [
  THROUGH_A_LINK,
  NOT_A_FILE,
  OVER_CAP,
  ...Object.values(SECOND_NAME_REFUSED),
]

/** Whether a use of a judged path was refused (a rule said no) rather than failed. */
export const refusedAsJudged = (reason: string): boolean =>
  JUDGED_REFUSALS.includes(reason) || reason.startsWith(CONTENT_WITHHELD)

/** Why a file is refused for `use` under the rule on hard links, or null. */
const secondNameRefused = (file: BigIntStats, use: OneNameFor | undefined): string | null =>
  use !== undefined && file.nlink > 1n ? SECOND_NAME_REFUSED[use] : null

/** Where an open handle is, as the system has it. */
const whereIs = (handle: FileHandle) => readlink(`/proc/self/fd/${String(handle.fd)}`)

/** The code of a system error, when it has one. */
const codeOf = (cause: Error): string | undefined =>
  'code' in cause && Predicate.isString(cause.code) ? cause.code : undefined

/** An open, its last name found to be a link (`O_NOFOLLOW`) said as such. */
const opened = (path: string, flags: number, mode?: number) =>
  open(path, flags, mode).catch((cause: Error) => {
    throw codeOf(cause) === 'ELOOP' ? new NotJudged(THROUGH_A_LINK) : cause
  })

/** Checks by name that `path` still leads to `real`: the check of a platform with no other. */
export async function stillJudged(path: string, real: string = path): Promise<void> {
  if ((await realpath(path)) !== real) throw new NotJudged(THROUGH_A_LINK)
}

/** Proves an open handle is at `real`: on the handle where the system says where, else by name. */
async function proven(handle: FileHandle, path: string, real: string): Promise<void> {
  if (BY_HANDLE) {
    const at = await whereIs(handle).catch(() => null)
    if (at !== real) throw new NotJudged(THROUGH_A_LINK)
    return
  }
  const held = await handle.stat({ bigint: true })
  await stillJudged(path, real)
  const named = await stat(path, { bigint: true })
  if (held.dev !== named.dev || held.ino !== named.ino) throw new NotJudged(THROUGH_A_LINK)
}

/**
 * How a judged file is opened: made to be written (`create`, it must not exist), or read, which
 * takes what is withheld from the session that reads it.
 */
export type Opening =
  | { readonly create: true; readonly real?: string; readonly mode?: number | undefined }
  | {
      readonly create?: false
      readonly real?: string
      readonly oneNameFor?: OneNameFor
      readonly withholding: Withholding
    }

/**
 * Opens the file at `path` and proves the opened file is the one judged at the real path `real`
 * (the path itself when the gate handed it over), a regular file; with `oneNameFor`, one with a
 * single name. With `create`, the file is made and must not exist. A file read is first asked of
 * its `withholding`: one whose content is withheld is never opened. The handle is the caller's to
 * close.
 */
export async function openJudged(path: string, options: Opening): Promise<FileHandle> {
  const real = options.real ?? path
  const read = options.create === true ? null : options
  const withheld = read === null ? null : await read.withholding.withheld(real)
  if (withheld !== null) throw new NotJudged(withheld)
  const handle =
    options.create === true
      ? await opened(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NEVER_WAITING,
          options.mode,
        )
      : await opened(path, constants.O_RDONLY | NEVER_WAITING)
  try {
    const file = await handle.stat({ bigint: true })
    if (!file.isFile()) throw new NotJudged(NOT_A_FILE)
    await proven(handle, path, real)
    const refused = secondNameRefused(file, read?.oneNameFor)
    if (refused !== null) throw new NotJudged(refused)
    return handle
  } catch (cause) {
    await handle.close()
    throw cause
  }
}

/** The bytes of an open file from `from` until `buffer` is full or the file ends: how many. */
async function readInto(handle: FileHandle, buffer: Buffer, from = 0): Promise<number> {
  if (from === buffer.length) return from
  const { bytesRead } = await handle.read(buffer, from, buffer.length - from, from)
  return bytesRead === 0 ? from : readInto(handle, buffer, from + bytesRead)
}

/** A whole open file of at most `cap` bytes, read through its handle; a larger one is refused. */
async function readUpTo(handle: FileHandle, cap: number): Promise<Buffer> {
  const { size } = await handle.stat()
  if (size > cap) throw new NotJudged(OVER_CAP)
  const buffer = Buffer.alloc(size)
  return buffer.subarray(0, await readInto(handle, buffer))
}

/**
 * The whole file at a judged path (at `real`, when it is reached by another), read through the
 * handle that was proven; with `cap`, a file larger than that is refused, never read.
 */
export async function readJudged(
  path: string,
  options: {
    readonly real?: string
    readonly oneNameFor?: OneNameFor
    readonly withholding: Withholding
    readonly cap?: number
  },
): Promise<Buffer> {
  const handle = await openJudged(path, options)
  try {
    return options.cap === undefined ? await handle.readFile() : await readUpTo(handle, options.cap)
  } finally {
    await handle.close()
  }
}

/**
 * A file the engine reads on its own behalf at a real path it chose (a recorded write's, a
 * script's), never for a session: opened without following a link as its last name and without
 * waiting on a pipe, proven at that path, a regular file of at most `cap` bytes. Anything else is
 * refused with why (`NotJudged`), at once. The handle is the caller's to close.
 */
export async function openOwn(real: string, cap: number): Promise<FileHandle> {
  const handle = await opened(real, constants.O_RDONLY | NEVER_WAITING)
  try {
    const file = await handle.stat()
    if (!file.isFile()) throw new NotJudged(NOT_A_FILE)
    if (file.size > cap) throw new NotJudged(OVER_CAP)
    await proven(handle, real, real)
    return handle
  } catch (cause) {
    await handle.close()
    throw cause
  }
}

/** Proves an open descriptor is at `real`, as `proven` does a handle, without waiting. */
function provenSync(file: number, path: string, real: string, held: BigIntStats): void {
  if (BY_HANDLE) {
    if (readlinkSync(`/proc/self/fd/${String(file)}`) !== real) throw new NotJudged(THROUGH_A_LINK)
    return
  }
  if (realpathSync.native(path) !== real) throw new NotJudged(THROUGH_A_LINK)
  const named = statSync(path, { bigint: true })
  if (held.dev !== named.dev || held.ino !== named.ino) throw new NotJudged(THROUGH_A_LINK)
}

/** A file the engine read on its own behalf: its bytes, and what its handle said of it. */
export interface OwnRead {
  readonly bytes: Buffer
  readonly stats: BigIntStats
}

/**
 * A whole file the engine reads on its own behalf where it cannot wait (a synchronous step: a
 * snapshot's copy of the index, a digest, a manifest): opened without following a link as its last
 * name and without waiting on a pipe, then read through its descriptor only when it is a regular
 * file of at most `cap` bytes; with `real`, only when the descriptor is proven at that real path,
 * so no link stood on the way either. Anything else is refused with why (`NotJudged`), at once.
 */
export function readOwnSync(path: string, cap: number, real?: string): OwnRead {
  let file: number
  try {
    file = openSync(path, constants.O_RDONLY | NEVER_WAITING)
  } catch (cause) {
    throw cause instanceof Error && codeOf(cause) === 'ELOOP'
      ? new NotJudged(THROUGH_A_LINK)
      : cause
  }
  try {
    const stats = fstatSync(file, { bigint: true })
    if (!stats.isFile()) throw new NotJudged(NOT_A_FILE)
    if (stats.size > BigInt(cap)) throw new NotJudged(OVER_CAP)
    if (real !== undefined) provenSync(file, path, real, stats)
    const bytes = Buffer.alloc(Number(stats.size))
    let length = 0
    for (let read = -1; read !== 0 && length < bytes.length; length += read) {
      read = readSync(file, bytes, length, bytes.length - length, length)
    }
    return { bytes: bytes.subarray(0, length), stats }
  } finally {
    closeSync(file)
  }
}

/**
 * A whole file Hemera wrote itself (an evidence it keeps), read as a regular file only: opened
 * without waiting, so a pipe put in its place is refused rather than holding the engine.
 */
export async function readRegular(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (BY_HANDLE ? constants.O_NONBLOCK : 0))
  try {
    if (!(await handle.stat()).isFile()) throw new NotJudged(NOT_A_FILE)
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

/** A folder proven at the real path the gate judged, used through its handle. */
export interface JudgedFolder {
  /** Its real path, as judged. */
  readonly real: string
  /** A name in it, reached through the opened folder where the platform allows it. */
  readonly at: (name: string) => string
  /** Its entries, read from the opened folder. */
  readonly entries: () => Promise<ReadonlyArray<Dirent>>
  /** Checks it is still where it was judged. */
  readonly still: () => Promise<void>
  readonly close: () => Promise<void>
}

/** Opens the folder at `path` and proves it is the one judged at `real`. */
export async function openFolder(path: string, real: string = path): Promise<JudgedFolder> {
  if (!BY_HANDLE) {
    await stillJudged(path, real)
    return {
      real,
      at: (name) => join(path, name),
      entries: async () => {
        const found = await readdir(path, { withFileTypes: true })
        await stillJudged(path, real)
        return found
      },
      still: () => stillJudged(path, real),
      close: async () => undefined,
    }
  }
  const handle = await opened(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | NEVER_WAITING,
  ).catch(async (cause: Error) => {
    // A link as the last name of a folder opened with `O_DIRECTORY` answers ENOTDIR: said as a
    // link (the name only chooses the words, the folder is refused either way).
    const link = codeOf(cause) === 'ENOTDIR' && (await lstat(path)).isSymbolicLink()
    throw link ? new NotJudged(THROUGH_A_LINK) : cause
  })
  try {
    await proven(handle, path, real)
  } catch (cause) {
    await handle.close()
    throw cause
  }
  const self = `/proc/self/fd/${String(handle.fd)}`
  return {
    real,
    at: (name) => join(self, name),
    entries: () => readdir(self, { withFileTypes: true }),
    still: () => proven(handle, self, real),
    close: () => handle.close(),
  }
}

/**
 * The folder at `real` (a path the gate judged), its missing folders made one level at a time:
 * the deepest one that exists is proven first, then each one is made through the handle of the
 * one above and proven in turn, so no folder is ever made through a link.
 */
export async function madeFolder(real: string): Promise<JudgedFolder> {
  const found = await openFolder(real).catch((cause: Error) => {
    if (codeOf(cause) !== 'ENOENT' || dirname(real) === real) throw cause
    return null
  })
  if (found !== null) return found
  const above = await madeFolder(dirname(real))
  try {
    const name = basename(real)
    await mkdir(above.at(name)).catch((cause: Error) => {
      if (codeOf(cause) !== 'EEXIST') throw cause
    })
    return await openFolder(above.at(name), join(above.real, name))
  } finally {
    await above.close()
  }
}
