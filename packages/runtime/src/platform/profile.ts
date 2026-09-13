/**
 * Where Hemera keeps its mutable data.
 *
 * The profile lives outside any product Workspace, which the user may clean at any time, and
 * outside the package, which is replaced on update. It is never a temporary directory: a
 * profile that disappears with the session is not a profile.
 */

import { join } from 'node:path'

import { profileFolderOf } from './channel.ts'
import type { Channel } from './channel.ts'

export interface ProfileLocation {
  /** Directory holding the database, the lock, the preferences and the kept files. */
  directory: string
  /** How the location was decided, for the diagnostic. */
  source: 'explicit' | 'localAppData' | 'xdgDataHome' | 'xdgFallback'
}

export interface ProfileQuery {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  channel: Channel
  /** Home directory, used by the Linux fallback. */
  home: string
  /** Directory a verification names explicitly, instead of the user's own profile. */
  override?: string | undefined
}

/** Variable a verification sets to keep away from the user's own profile. */
export const PROFILE_OVERRIDE_VARIABLE = 'HEMERA_PROFILE_DIR'

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(`no profile location is defined for ${platform}`)
    this.name = 'UnsupportedPlatformError'
  }
}

export function resolveProfileLocation({
  platform,
  env,
  channel,
  home,
  override,
}: ProfileQuery): ProfileLocation {
  const folder = profileFolderOf(channel)

  const explicit = override ?? env[PROFILE_OVERRIDE_VARIABLE]
  if (explicit !== undefined && explicit.length > 0) {
    return { directory: join(explicit, folder), source: 'explicit' }
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    if (localAppData === undefined || localAppData.length === 0) {
      throw new Error('LOCALAPPDATA is not set; Hemera cannot place its profile')
    }
    return { directory: join(localAppData, folder), source: 'localAppData' }
  }

  if (platform === 'linux') {
    const xdg = env.XDG_DATA_HOME
    if (xdg !== undefined && xdg.length > 0) {
      return { directory: join(xdg, folder), source: 'xdgDataHome' }
    }
    return { directory: join(home, '.local', 'share', folder), source: 'xdgFallback' }
  }

  throw new UnsupportedPlatformError(platform)
}
