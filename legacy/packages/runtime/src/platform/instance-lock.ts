/**
 * One instance owns the database of a profile.
 *
 * The lock is a file beside the database naming the process that holds it. A second instance
 * on the same profile never opens the database in write: it asks the running window to come
 * forward, or says which instance is running and stops. A lock left by a process that no
 * longer exists is reclaimed, without asking anyone to delete a file by hand.
 *
 * Two profiles are two locks: they never exclude each other.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** File the lock lives in, beside the database. */
export const LOCK_FILE = 'instance.lock'

export interface LockOwner {
  /** Process holding the lock. */
  pid: number
  /** Token the running instance answers on, to bring its window forward. */
  activationToken: string
  acquiredAt: number
}

export type LockOutcome =
  /** The lock was free. */
  | { kind: 'acquired'; owner: LockOwner; release: () => void }
  /** A process that no longer exists had left it behind. */
  | { kind: 'reclaimed'; owner: LockOwner; previous: LockOwner; release: () => void }
  /** Another live instance owns the profile. */
  | { kind: 'busy'; owner: LockOwner }

export interface AcquireLockOptions {
  /** Directory of the profile; the lock sits beside its database. */
  directory: string
  pid: number
  activationToken: string
  now: number
  /** How liveness is decided; injected so a test never depends on a real process. */
  isProcessAlive?: (pid: number) => boolean
}

/** Whether a process exists, without touching it. */
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // A process we may not signal still exists; only "no such process" means gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readOwner(path: string): LockOwner | null {
  try {
    const owner = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockOwner>
    if (typeof owner.pid !== 'number' || typeof owner.activationToken !== 'string') return null
    return {
      pid: owner.pid,
      activationToken: owner.activationToken,
      acquiredAt: typeof owner.acquiredAt === 'number' ? owner.acquiredAt : 0,
    }
  } catch {
    // An unreadable lock names no owner, so it holds nothing.
    return null
  }
}

export function lockPathOf(directory: string): string {
  return join(directory, LOCK_FILE)
}

/** Takes the lock of a profile, or reports the instance that holds it. */
export function acquireInstanceLock({
  directory,
  pid,
  activationToken,
  now,
  isProcessAlive = processExists,
}: AcquireLockOptions): LockOutcome {
  mkdirSync(directory, { recursive: true })
  const path = lockPathOf(directory)
  const owner: LockOwner = { pid, activationToken, acquiredAt: now }
  const release = () => {
    // Only the owner clears its own lock.
    if (readOwner(path)?.pid === pid) rmSync(path, { force: true })
  }

  const previous = existsSync(path) ? readOwner(path) : null
  if (previous !== null && previous.pid !== pid && isProcessAlive(previous.pid)) {
    return { kind: 'busy', owner: previous }
  }

  writeFileSync(path, `${JSON.stringify(owner, null, 2)}\n`)
  if (previous === null) return { kind: 'acquired', owner, release }
  return { kind: 'reclaimed', owner, previous, release }
}

/** The instance holding a profile, or null when none does. */
export function currentLockOwner(
  directory: string,
  isProcessAlive: (pid: number) => boolean = processExists,
): LockOwner | null {
  const path = lockPathOf(directory)
  if (!existsSync(path)) return null
  const owner = readOwner(path)
  if (owner === null || !isProcessAlive(owner.pid)) return null
  return owner
}
