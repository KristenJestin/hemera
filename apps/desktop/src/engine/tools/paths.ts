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
 * to the agent. What it is never is a stack trace to parse.
 */
export class RefusedPathError extends Error {
  readonly named: string
  readonly why: RefusedWhy

  constructor(named: string, why: RefusedWhy, detail: string) {
    super(
      why === 'outside'
        ? `${named} is outside the Workspace root`
        : `${named} cannot be read: ${detail}`,
    )
    this.name = 'RefusedPathError'
    this.named = named
    this.why = why
  }
}

/** Whether a resolved path is the root itself or sits under it. */
export function containedIn(root: string, resolved: string): boolean {
  const path = relative(root, resolved)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

/**
 * The real path of what the agent named, following what exists and judging the rest by its
 * closest existing parent.
 *
 * `named` is relative to the root or absolute; both are accepted because an agent that read an
 * absolute path from `pwd` will name an absolute one, and refusing it would be a refusal about
 * spelling rather than about the workspace.
 */
export async function resolveInside(root: string, named: string): Promise<string> {
  const real = await reading(() => realpath(root), named)
  const candidate = isAbsolute(named) ? resolve(named) : resolve(real, named)
  const existing = await closestExisting(candidate)
  const anchored = await reading(() => realpath(existing), named)
  const settled = existing === candidate ? anchored : join(anchored, relative(existing, candidate))
  if (!containedIn(real, settled)) throw new RefusedPathError(named, 'outside', settled)
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
 * lint refuses is the loop that awaits inside itself. A path that reaches the filesystem root
 * without finding anything is answered by the root itself, which the caller then refuses as
 * outside the workspace — which is what it is.
 */
async function closestExisting(candidate: string): Promise<string> {
  const exists = await realpath(candidate).then(
    () => true,
    () => false,
  )
  if (exists) return candidate
  const parent = dirname(candidate)
  if (parent === candidate) return candidate
  return closestExisting(parent)
}
