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
export {
  BUSY_TIMEOUT_MS,
  DATABASE_FILE,
  MigrationChecksumError,
  MigrationFailedError,
  SchemaAheadError,
  migrate,
  openProfile,
} from './storage/database.ts'
export type {
  AppliedMigration,
  MigrationReport,
  OpenProfile,
  OpenProfileOptions,
} from './storage/database.ts'
export {
  MIGRATIONS,
  STATEMENT_BREAKPOINT,
  checksumOf,
  statementsOf,
} from './storage/migrations/index.ts'
export type { Migration } from './storage/migrations/index.ts'
export * as schema from './storage/schema.ts'
