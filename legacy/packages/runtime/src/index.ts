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
  DEFAULT_RETENTION_DAYS,
  diagnosticLine,
  expiredLogs,
  logExists,
  logFileNameOf,
  openDiagnosticLog,
} from './platform/diagnostics.ts'
export type {
  DiagnosticLevel,
  DiagnosticLog,
  DiagnosticLogOptions,
} from './platform/diagnostics.ts'
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
export {
  MAX_OUTPUT_BLOCKS,
  OutputNotAnEventError,
  appendOutput,
  outputExtent,
  readOutput,
  refuseOutputAsEvent,
} from './storage/activity.ts'
export type {
  AppendOutput,
  OutputBlock,
  OutputExtent,
  OutputPage,
  OutputStream,
} from './storage/activity.ts'
export {
  BACKUP_DIRECTORY,
  DATABASE_FILES,
  backupNameOf,
  backupProfile,
  backupsOf,
  checkpoint,
} from './storage/backup.ts'
export type { BackupOptions, BackupResult } from './storage/backup.ts'
export {
  UnknownProjectError,
  UnknownSessionError,
  VersionConflictError,
  createProject,
  createSession,
  findProject,
  findSession,
  listProjects,
  listSessions,
  mainWorkspace,
  readConfiguration,
  readMessages,
  recordMessage,
  renameSession,
  setSessionArchived,
  writeConfiguration,
} from './storage/workspace-store.ts'
export type {
  CreatedProject,
  Identifiers,
  ProjectConfiguration,
  RecordedMessage,
  StoreContext,
} from './storage/workspace-store.ts'
