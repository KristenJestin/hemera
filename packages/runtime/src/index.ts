/** Public surface of the Bun implementations of the core ports. */

export {
  CHANNELS,
  CHANNEL_OVERRIDE_VARIABLE,
  DEVELOPMENT_CHANNEL,
  isChannel,
  profileFolderOf,
  resolveChannel,
} from './platform/channel.ts'
export type { Channel, ChannelSource } from './platform/channel.ts'
export {
  PROFILE_OVERRIDE_VARIABLE,
  UnsupportedPlatformError,
  resolveProfileLocation,
} from './platform/profile.ts'
export type { ProfileLocation, ProfileQuery } from './platform/profile.ts'
