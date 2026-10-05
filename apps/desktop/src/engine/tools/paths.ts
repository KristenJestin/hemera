/**
 * Where a path an agent named leads, and whether that is inside its role's place.
 *
 * A path is resolved before it is judged: `~`, absolute paths, `..`, symbolic links and junctions
 * are followed, and the answer is about the place it leads to, never the text the agent wrote. A
 * file that does not exist yet is judged by its deepest existing folder; a link that leads nowhere
 * is judged by where it points, since writing through it creates whatever it points at. A path
 * that cannot be resolved with certainty (a folder that cannot be read, a loop of links, a UNC or
 * device path) counts as outside.
 *
 * Nothing here refuses or asks: it says where a path leads. The gate decides.
 */

import { readlink, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Where a path leads, and whether it is inside the place. */
export interface ResolvedPath {
  /** As the agent wrote it. */
  readonly named: string
  /** Where it leads, as far as it could be followed. */
  readonly path: string
  readonly inside: boolean
  /** False when it could not be followed with certainty: it is then outside. */
  readonly certain: boolean
}

/** How many links a path may go through before it is taken for a loop. */
const LINKS_FOLLOWED = 32

/** Whether a resolved path is the root itself or sits under it. */
export function containedIn(root: string, path: string): boolean {
  const between = relative(root, path)
  // `..` itself, or a path that starts by climbing out: a child named `..notes` is inside.
  const climbs = between === '..' || between.startsWith(`..${sep}`)
  return between === '' || (!climbs && !isAbsolute(between))
}

/**
 * A UNC or device path: `\\host\share`, `\\?\C:\…`, `\\.\pipe\…`, and on Windows `//host/share`.
 * Asking the filesystem about one opens a connection to whatever host the agent named.
 */
function uncOrDevice(named: string): boolean {
  if (named.startsWith('\\\\')) return true
  return process.platform === 'win32' && /^[\\/]{2}[^\\/]/.test(named)
}

/** `~` and `~/…` as the user's home: what an agent copies from a shell means it. */
function expanded(named: string, home: string): string {
  if (named === '~') return home
  if (named.startsWith('~/') || named.startsWith('~\\')) return join(home, named.slice(2))
  return named
}

/** Thrown when a path cannot be followed with certainty. */
class Uncertain extends Error {}

/**
 * Where a path really leads: its real path when it exists; otherwise its real parent joined with
 * its name, unless that name is a link, which is followed to where it points whether or not
 * anything is there.
 */
async function followed(candidate: string, links: number): Promise<string> {
  const real = await realpath(candidate).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') return null
    throw new Uncertain(cause.message)
  })
  if (real !== null) return real
  const parent = dirname(candidate)
  if (parent === candidate) return candidate
  const realParent = await followed(parent, links)
  const here = join(realParent, basename(candidate))
  const target = await readlink(here).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === 'ENOENT' || cause.code === 'EINVAL' || cause.code === 'ENOTDIR') return null
    throw new Uncertain(cause.message)
  })
  if (target === null) return here
  if (links >= LINKS_FOLLOWED) throw new Uncertain('too many links along the path')
  return followed(resolve(realParent, target), links + 1)
}

/**
 * Where `named` leads from `base` (a folder under `root`, or the root itself), judged against
 * `root`. `home` is what `~` stands for.
 *
 * A path that does not even read as inside the root (as the root is written, or as it really is)
 * is outside, and the filesystem is not asked about it: an agent does not get to make Hemera
 * follow a path of its choosing outside its place. One that reads as inside is followed, since a
 * link under the root can still lead out of it.
 */
export async function resolvePath(
  root: string,
  base: string,
  named: string,
  home: string,
): Promise<ResolvedPath> {
  const outside = (path: string, certain: boolean): ResolvedPath => ({
    named,
    path,
    inside: false,
    certain,
  })
  if (uncOrDevice(named)) return outside(named, false)
  const text = expanded(named, home)
  const candidate = isAbsolute(text) ? resolve(text) : resolve(base, text)
  try {
    const realRoot = await realpath(root)
    const written = resolve(root)
    const underReal = containedIn(realRoot, candidate)
    if (!underReal && !containedIn(written, candidate)) return outside(candidate, true)
    // A path spelled under the root as it is written is the same place under the real root.
    const within = underReal ? candidate : join(realRoot, relative(written, candidate))
    const settled = await followed(within, 0)
    return { named, path: settled, inside: containedIn(realRoot, settled), certain: true }
  } catch {
    return outside(candidate, false)
  }
}

/** A path as a refusal shows it: under the home folder, with `~`. */
export function shownPath(path: string, home: string): string {
  return home !== '' && containedIn(home, path) && path !== home
    ? `~/${relative(home, path).split(sep).join('/')}`
    : path
}
