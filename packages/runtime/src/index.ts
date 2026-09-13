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
export {
  DEFAULT_PAGE_SIZE,
  ExternalEffectInTransactionError,
  InvalidCursorError,
  MAX_PAGE_SIZE,
  lastSequence,
  readJournal,
  recordChange,
} from './storage/journal.ts'
export type {
  EventAuthor,
  EventSource,
  JournalEvent,
  JournalPage,
  JournalQuery,
  Recorded,
  RecordedEvent,
} from './storage/journal.ts'
export {
  LOCK_FILE,
  acquireInstanceLock,
  currentLockOwner,
  lockPathOf,
  processExists,
} from './platform/instance-lock.ts'
export type { AcquireLockOptions, LockOutcome, LockOwner } from './platform/instance-lock.ts'
export {
  DEFAULT_BOUNDS,
  DEFAULT_PREFERENCES,
  PREFERENCE_KEYS,
  loadPreferences,
  savePreferences,
} from './storage/preferences.ts'
export type {
  DisplayPreferences,
  LoadedPreferences,
  PreferenceBounds,
  PreferenceKey,
} from './storage/preferences.ts'
