/**
 * Opening the profile of this instance, and the services the screens call.
 *
 * The window talks to these directly: there is no internal HTTP in the desktop version, and
 * a user action never needs one.
 */

import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'

import {
  acquireInstanceLock,
  openProfile,
  resolveChannel,
  resolveProfileLocation,
} from '@hemera/runtime'
import type { Channel, LockOutcome, OpenProfile, StoreContext } from '@hemera/runtime'

export class UnreadableFolderError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`the folder "${path}" cannot be opened: ${reason}`)
    this.name = 'UnreadableFolderError'
  }
}

/**
 * Checks a folder before a project is created around it.
 *
 * Hemera never creates a folder in the user's place, and never creates a project around a
 * path it cannot read.
 */
export function requireReadableFolder(path: string): void {
  const cause = folderCause(path)
  if (cause !== null) throw new UnreadableFolderError(path, cause)
}

function folderCause(path: string): string | null {
  let stats
  try {
    stats = statSync(path)
  } catch {
    return 'it does not exist or cannot be read'
  }
  return stats.isDirectory() ? null : 'it is not a folder'
}

/**
 * Says why a folder cannot be read, or null when it can.
 *
 * A project whose folder became unreachable keeps all of its data: the cause is shown, the
 * project is never removed.
 */
export function folderProblem(path: string): string | null {
  const cause = folderCause(path)
  return cause === null ? null : new UnreadableFolderError(path, cause).message
}

export interface InstanceProfile {
  channel: Channel
  directory: string
  profile: OpenProfile
  lock: LockOutcome
  /** Context the store operations are called with. */
  context: StoreContext
}

export interface OpenInstanceOptions {
  /** Channel written into the package; a development run is always `dev`. */
  packaged?: Channel
  development?: boolean
  env?: Record<string, string | undefined>
  now?: number
}

/**
 * Opens the profile of this instance, unless another one already owns it.
 *
 * A second instance never opens the database in write: the caller reads the outcome of the
 * lock and brings the running window forward instead.
 */
/**
 * Where this run's profile is, without opening anything.
 *
 * A start that fails before the database is opened still has somewhere to write why: the
 * location is a function of the channel and the system, not of a profile being readable.
 */
export function profileDirectoryOf(options: OpenInstanceOptions = {}): {
  channel: Channel
  directory: string
} {
  const env = options.env ?? process.env
  const channel = resolveChannel({
    packaged: options.packaged ?? 'dev',
    env,
    development: options.development ?? true,
  })
  const { directory } = resolveProfileLocation({
    platform: process.platform,
    env,
    channel,
    home: homedir(),
  })
  return { channel, directory }
}

export function openInstance(options: OpenInstanceOptions = {}): InstanceProfile | LockOutcome {
  const now = options.now ?? Date.now()
  const { channel, directory } = profileDirectoryOf(options)

  const lock = acquireInstanceLock({
    directory,
    pid: process.pid,
    activationToken: `hemera-${channel}-${process.pid}`,
    now,
  })
  if (lock.kind === 'busy') return lock

  const profile = openProfile({ directory, now })
  return {
    channel,
    directory,
    profile,
    lock,
    context: { database: profile.database, ids: { next: () => randomUUID() }, now },
  }
}
