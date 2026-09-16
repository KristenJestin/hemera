/**
 * The use cases the process that holds the database answers, and nothing else (design D3-02).
 *
 * A use case is a name, a schema for what it is called with, and a type for what it answers —
 * the same shape as a channel, read by the same discipline. The main process asks by name and
 * the process that holds the database refuses anything it has not declared, so a request no
 * one wrote down cannot be sent by accident. Nothing here knows about Electron or a port: this
 * is the declaration both ends read, not the wire between them.
 */

import { z } from 'zod'

/**
 * Which build this is, and therefore which profile it opens.
 *
 * It is written into the manifest of a package when the package is built and read from there
 * at start-up. `prod` and `beta` share one profile; `dev` has its own.
 */
export const channelSchema = z.enum(['prod', 'beta', 'dev'])

export type Channel = z.infer<typeof channelSchema>

/** What the user can ask for; `system` means "whatever the desktop says, from now on". */
export const themePreferenceSchema = z.enum(['system', 'light', 'dark'])

export type ThemePreference = z.infer<typeof themePreferenceSchema>

/**
 * What the shell of the window keeps of itself: folded or not, and the width it opens at.
 *
 * A width of null is one the user has never set, and the answer to it is the design system's
 * own — which is where that number lives and the one place it may be read from. The profile
 * holds what the user chose, never what the theme would have chosen for them.
 */
export const sidebarPreferenceSchema = z.object({
  collapsed: z.boolean(),
  width: z.number().nullable(),
})

export type SidebarPreference = z.infer<typeof sidebarPreferenceSchema>

/** Everything the profile holds about what the window wears, read in one go at start-up. */
export const displayPreferencesSchema = z.object({
  theme: themePreferenceSchema,
  sidebar: sidebarPreferenceSchema,
})

export type DisplayPreferences = z.infer<typeof displayPreferencesSchema>

/** What a profile answers before anyone has chosen anything. */
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  theme: 'system',
  sidebar: { collapsed: false, width: null },
}

/** A change to what the window wears: what is absent is what the user did not touch. */
export const displayPreferencesChangeSchema = z.object({
  theme: themePreferenceSchema.optional(),
  sidebar: sidebarPreferenceSchema.optional(),
})

export type DisplayPreferencesChange = z.infer<typeof displayPreferencesChangeSchema>

/**
 * Where the profile stands, which is what a diagnostic is written from.
 *
 * The last migration and the version that wrote it are null on a profile the application has
 * not opened yet: there is nothing to report until something has been written.
 */
export const profileStatusSchema = z.object({
  directory: z.string(),
  channel: channelSchema,
  version: z.string(),
  lastMigration: z.string().nullable(),
  writtenByVersion: z.string().nullable(),
})

export type ProfileStatus = z.infer<typeof profileStatusSchema>

/** A call that takes no argument, which both declarations say the same way. */
export const nothingSchema = z.object({})

/**
 * Every use case of the process that holds the database.
 *
 * `arguments` is what the main process sends and that process validates; `response` is the
 * schema of what comes back, so the type of an answer is read from the same place.
 */
export const PROFILE_REQUESTS = {
  'preferences.read': {
    arguments: nothingSchema,
    response: displayPreferencesSchema,
  },
  'preferences.write': {
    arguments: displayPreferencesChangeSchema,
    response: z.void(),
  },
  'profile.status': {
    arguments: nothingSchema,
    response: profileStatusSchema,
  },
} as const

export type ProfileRequests = typeof PROFILE_REQUESTS

export type ProfileRequestName = keyof ProfileRequests

export type ProfileArguments<K extends ProfileRequestName> = z.infer<
  ProfileRequests[K]['arguments']
>

export type ProfileResponse<K extends ProfileRequestName> = z.infer<ProfileRequests[K]['response']>
