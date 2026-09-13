/**
 * Installation channel of this executable.
 *
 * Hemera is installed on the same machine it is developed on, so each build carries a channel
 * fixed when the package was assembled. The channel decides which profile is opened, is shown
 * in the window title and in the diagnostic, and is never offered as a user setting.
 *
 * A development run is always on `dev`: nothing a developer starts can touch the installed
 * profile.
 */

export type Channel = 'prod' | 'dev'

export const CHANNELS: readonly Channel[] = ['prod', 'dev']

/** Variable that overrides the channel. Reserved for tests. */
export const CHANNEL_OVERRIDE_VARIABLE = 'HEMERA_CHANNEL'

/** Channel a development run carries, whatever the package says. */
export const DEVELOPMENT_CHANNEL: Channel = 'dev'

export function isChannel(value: string | undefined): value is Channel {
  return value !== undefined && (CHANNELS as readonly string[]).includes(value)
}

export interface ChannelSource {
  /** Channel written into the package when it was assembled. */
  packaged: Channel
  /** Environment the process was started with. */
  env: Record<string, string | undefined>
  /** True when the process was started from the sources rather than from a package. */
  development: boolean
}

/**
 * The channel in force.
 *
 * A development run is `dev`. Otherwise the packaged channel applies, unless the reserved
 * variable names a known channel; an unknown value is ignored rather than failing the start.
 */
export function resolveChannel({ packaged, env, development }: ChannelSource): Channel {
  if (development) return DEVELOPMENT_CHANNEL
  const override = env[CHANNEL_OVERRIDE_VARIABLE]
  return isChannel(override) ? override : packaged
}

/** Folder name the channel keeps its profile under. */
export function profileFolderOf(channel: Channel): string {
  return channel === 'prod' ? 'Hemera' : 'Hemera-dev'
}
