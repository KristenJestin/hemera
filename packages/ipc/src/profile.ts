/**
 * The Profile's values: the application's preferences, the backups of the data folder, and the
 * refusals a screen shows of them. The engine serves them in its own group (`engine.ts`).
 */

import { Schema } from 'effect'

/** Which theme the window wears: the system's, or one chosen. */
export const ThemePreference = Schema.Literals(['system', 'light', 'dark'])
export type ThemePreference = typeof ThemePreference.Type

/** The preferences, one `Schema` per key. */
export const Preferences = Schema.Struct({
  theme: ThemePreference,
})
export type Preferences = typeof Preferences.Type

/** What a key that was never written, or cannot be read, answers. */
export const DEFAULT_PREFERENCES: Preferences = { theme: 'system' }

/** A change of the preferences: only the keys it names are written. */
export const PreferencesChange = Schema.Struct({
  theme: Schema.optionalKey(ThemePreference),
})
export type PreferencesChange = typeof PreferencesChange.Type

/** The automatic backups of the data folder: how many there are and the latest one. */
export const AutomaticBackups = Schema.Struct({
  count: Schema.Number,
  latest: Schema.NullOr(Schema.String),
})
export type AutomaticBackups = typeof AutomaticBackups.Type

/** The data folder could not be read or written; the sentence says what Hemera was doing. */
export class StorageFailed extends Schema.TaggedError<StorageFailed>()('StorageFailed', {
  sentence: Schema.String,
}) {
  override get message(): string {
    return this.sentence
  }
}

/** A backup that cannot be restored, and why, in a sentence. */
export class RestoreRefused extends Schema.TaggedError<RestoreRefused>()('RestoreRefused', {
  sentence: Schema.String,
}) {
  override get message(): string {
    return this.sentence
  }
}
