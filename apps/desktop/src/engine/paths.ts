/**
 * The entries of one folder under a base, which a path field offers while it is typed (#109).
 *
 * One level at a time: the field asks for the folder being typed in, and what comes back is the
 * names in it and what each one is. The field never climbs above its base, so neither does this:
 * a folder written as an absolute path, one that climbs with `..`, and one whose real path leads
 * outside the base — through a link — are refused, each with the reason the field can show.
 *
 * What is not there is not refused: a path can be typed before anything is at it, and a folder
 * that does not exist yet, or cannot be read, simply offers nothing.
 */

import { readdir, realpath, stat } from 'node:fs/promises'
import { join, posix, resolve, win32 } from 'node:path'
import { Effect } from 'effect'

import type { PathEntryKind } from '@hemera/ipc'

import { containedIn } from './tools/paths.ts'

/** A folder asked for that is not under its base, and why. */
export class PathOutsideBaseError extends Error {
  constructor(
    readonly relative: string,
    reason: string,
  ) {
    super(reason)
    this.name = 'PathOutsideBaseError'
  }
}

/** One entry of a folder: its name alone, and what it is. */
export interface PathEntry {
  readonly name: string
  readonly kind: PathEntryKind
}

/**
 * Whether a folder is written as an absolute path, on either system: `/x`, `\x`, `C:\x`, `C:x`
 * and `\\host\share` all name something that is not under the base.
 */
function absolute(relative: string): boolean {
  return posix.isAbsolute(relative) || win32.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)
}

/**
 * Why a folder cannot be listed under its base, judged on what was written, or null when it can.
 *
 * `..` is refused wherever it stands, even where it would come back down: the field never offers
 * it, and a path that climbs to come back is a path that could be written without climbing.
 */
export function refusalOf(relative: string): string | null {
  if (absolute(relative)) return `${relative} is absolute: a folder is listed from its base.`
  if (relative.split(/[\\/]/).includes('..')) {
    return `${relative} climbs above the folder it is listed from.`
  }
  return null
}

/** What an entry is, following a link to what it leads to; null for anything else. */
async function kindOf(folder: string, name: string, link: boolean): Promise<PathEntryKind | null> {
  if (!link) return null
  const found = await stat(join(folder, name)).catch(() => null)
  if (found === null) return null
  if (found.isDirectory()) return 'folder'
  return found.isFile() ? 'file' : null
}

/** The real path of a folder, or null when nothing is there to follow. */
async function realOf(path: string): Promise<string | null> {
  return await realpath(path).catch(() => null)
}

/**
 * The entries of `relative` under `base`, of the kinds asked for, folders first and each group
 * in the alphabet's order.
 */
export const entriesUnder = (
  base: string,
  relative: string,
  kinds: readonly PathEntryKind[],
): Effect.Effect<PathEntry[], PathOutsideBaseError> =>
  Effect.gen(function* () {
    const said = relative.trim()
    if (!absolute(base)) {
      return yield* Effect.fail(
        new PathOutsideBaseError(said, `${base} is not an absolute folder.`),
      )
    }
    const refused = refusalOf(said)
    if (refused !== null) return yield* Effect.fail(new PathOutsideBaseError(said, refused))
    const folder = resolve(base, said)
    const listed = yield* Effect.promise(async () => {
      const [root, real] = await Promise.all([realOf(base), realOf(folder)])
      if (root === null || real === null) return { inside: true, entries: [] }
      // A link under the base that leads out of it is outside, whatever its name says.
      if (!containedIn(root, real)) return { inside: false, entries: [] }
      const read = await readdir(real, { withFileTypes: true }).catch(() => [])
      const entries = await Promise.all(
        read.map(async (entry): Promise<PathEntry | null> => {
          const kind: PathEntryKind | null = entry.isDirectory()
            ? 'folder'
            : entry.isFile()
              ? 'file'
              : await kindOf(real, entry.name, entry.isSymbolicLink())
          return kind === null ? null : { name: entry.name, kind }
        }),
      )
      return { inside: true, entries }
    })
    if (!listed.inside) {
      return yield* Effect.fail(
        new PathOutsideBaseError(said, `${said} leads outside the folder it is listed from.`),
      )
    }
    return listed.entries
      .filter((entry): entry is PathEntry => entry !== null && kinds.includes(entry.kind))
      .toSorted((one, other) =>
        one.kind === other.kind
          ? one.name.localeCompare(other.name)
          : one.kind === 'folder'
            ? -1
            : 1,
      )
  })
