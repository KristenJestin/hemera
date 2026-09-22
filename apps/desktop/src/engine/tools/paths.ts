/**
 * Where a tool may act: inside the Workspace root, and nowhere else (D6-05).
 *
 * The rule is one rule and it is checked on resolved paths, never on the text the agent wrote:
 * a symlink that leaves the root is a path outside the root, and so is `..` that climbs out of
 * it. A file that does not exist yet is judged by its deepest existing ancestor, which is what
 * lets a tool create a file in a folder the user asked for without first creating the folder.
 *
 * Nothing here decides to refuse: it says whether a path is inside, and the caller asks the
 * human for what is not. Technical reachability is not an authorisation (D6-05), so the token a
 * Session carries never enters this file.
 */

import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Why a path the agent named was not accepted. */
export type RefusedWhy = 'outside' | 'unreadable'

/**
 * Thrown when a path cannot be accepted: it climbs out of the Workspace root, or nothing along
 * it can be read.
 *
 * One error for both, because the caller treats them differently and must be able to tell them
 * apart: a path outside is a question to the human, and a path that cannot be read is a refusal
 * to the agent. What it is never is a stack trace to parse. `resolved` is where the path leads,
 * as far as it was followed: what the human is shown, rather than the text the agent wrote.
 */
export class RefusedPathError extends Error {
  readonly named: string
  readonly why: RefusedWhy
  readonly resolved: string

  constructor(named: string, why: RefusedWhy, detail: string, resolved: string = named) {
    super(
      why === 'outside'
        ? `${named} is outside the Workspace root`
        : `${named} cannot be read: ${detail}`,
    )
    this.name = 'RefusedPathError'
    this.named = named
    this.why = why
    this.resolved = resolved
  }
}

/** Whether a resolved path is the root itself or sits under it. */
export function containedIn(root: string, resolved: string): boolean {
  const path = relative(root, resolved)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

/**
 * Whether a name is a UNC or a device path: `\\host\share`, `\\?\C:\…`, `\\.\pipe\…`, and on
 * Windows `//host/share` as well.
 *
 * Asking the filesystem about one of these is not a question about a file: on Windows it opens
 * an SMB connection to whatever host the agent named, or talks to a device. None of them is
 * inside a Workspace the user opened by its drive path, so they go to the human untouched.
 */
function uncOrDevice(named: string): boolean {
  if (named.startsWith('\\\\')) return true
  return process.platform === 'win32' && /^[\\/]{2}[^\\/]/.test(named)
}

/** How a path is followed to what it is: the filesystem's own answer, or a suite's. */
export type RealPath = (path: string) => Promise<string>

/**
 * The real path of what the agent named, following what exists and judging the rest by its
 * closest existing parent.
 *
 * `named` is relative to the root or absolute; both are accepted because an agent that read an
 * absolute path from `pwd` will name an absolute one, and refusing it would be a refusal about
 * spelling rather than about the workspace.
 *
 * The containment is checked on the text first: a path that does not even read as inside the
 * root is outside it, and the filesystem is not asked about it at all — an agent does not get to
 * make Hemera follow a path of its choosing before the human has said yes. Only a path that reads
 * as inside is then followed, because a symlink under the root can still lead out of it.
 */
export async function resolveInside(
  root: string,
  named: string,
  realpathOf: RealPath = realpath,
): Promise<string> {
  if (uncOrDevice(named)) throw new RefusedPathError(named, 'outside', named)
  const written = resolve(root)
  const real = await reading(() => realpathOf(root), named)
  const candidate = isAbsolute(named) ? resolve(named) : resolve(real, named)
  const underReal = containedIn(real, candidate)
  if (!underReal && !containedIn(written, candidate)) {
    throw new RefusedPathError(named, 'outside', candidate, candidate)
  }
  // An absolute path spelled under the root as the user opened it is the same place under the
  // root as it really is: it is followed from the real root, so the last check is one check.
  const within = underReal ? candidate : join(real, relative(written, candidate))
  const existing = await closestExisting(within, realpathOf)
  const anchored = await reading(() => realpathOf(existing), named)
  const settled = existing === within ? anchored : join(anchored, relative(existing, within))
  if (!containedIn(real, settled)) throw new RefusedPathError(named, 'outside', settled, settled)
  return settled
}

/** One filesystem read, as a refusal with a reason rather than as an unparsed rejection. */
async function reading<A>(run: () => Promise<A>, named: string): Promise<A> {
  return run().catch((cause: Error) => {
    throw new RefusedPathError(named, 'unreadable', cause.message)
  })
}

/**
 * The path itself when it exists, and its closest existing ancestor when it does not.
 *
 * Recursive rather than a loop: each step is one filesystem read, and the shape the repository's
 * lint refuses is the loop that awaits inside itself. What it is handed already reads as inside
 * the root, and the root exists, so it never climbs above it.
 */
async function closestExisting(candidate: string, realpathOf: RealPath): Promise<string> {
  const exists = await realpathOf(candidate).then(
    () => true,
    () => false,
  )
  if (exists) return candidate
  const parent = dirname(candidate)
  if (parent === candidate) return candidate
  return closestExisting(parent, realpathOf)
}
