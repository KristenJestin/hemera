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
 * Which build this is, and therefore which data folder it opens.
 *
 * It is written into the manifest of a package when the package is built and read from there
 * at start-up. `prod` and `beta` share one data folder; `dev` has its own.
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
 * own — which is where that number lives and the one place it may be read from. The engine
 * holds what the user chose, never what the theme would have chosen for them.
 */
export const sidebarPreferenceSchema = z.object({
  collapsed: z.boolean(),
  width: z.number().nullable(),
})

export type SidebarPreference = z.infer<typeof sidebarPreferenceSchema>

/** Everything the engine holds about what the window wears, read in one go at start-up. */
/**
 * The Project everything else is about, remembered between two starts (design D4-04).
 *
 * A preference and not a column of the profile: `profile` says what the data folder is, this
 * says what the user was looking at. Null before there is a Project at all, and null again the
 * moment the one that was active is archived — the shell picks the first of the list when what
 * it was told to show is gone.
 */
export const activeProjectSchema = z.string().nullable()

export const displayPreferencesSchema = z.object({
  theme: themePreferenceSchema,
  sidebar: sidebarPreferenceSchema,
  activeProjectId: activeProjectSchema,
})

export type DisplayPreferences = z.infer<typeof displayPreferencesSchema>

/** What a data folder answers before anyone has chosen anything. */
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  theme: 'system',
  sidebar: { collapsed: false, width: null },
  activeProjectId: null,
}

/** A change to what the window wears: what is absent is what the user did not touch. */
export const displayPreferencesChangeSchema = z.object({
  theme: themePreferenceSchema.optional(),
  sidebar: sidebarPreferenceSchema.optional(),
  activeProjectId: activeProjectSchema.optional(),
})

export type DisplayPreferencesChange = z.infer<typeof displayPreferencesChangeSchema>

/**
 * Where the engine stands, which is what a diagnostic is written from.
 *
 * The last migration and the version that wrote it are null on a data folder the application
 * has not opened yet: there is nothing to report until something has been written.
 */
export const engineStatusSchema = z.object({
  directory: z.string(),
  channel: channelSchema,
  version: z.string(),
  lastMigration: z.string().nullable(),
  writtenByVersion: z.string().nullable(),
  /** How big the database file is, in bytes, so the settings can say it in words. */
  databaseSize: z.number(),
  /** How many copies of it there are and which is the most recent (design D4-07). */
  backups: z.object({ count: z.number(), latest: z.string().nullable() }),
})

export type EngineStatus = z.infer<typeof engineStatusSchema>

/**
 * The five tones a Project is told apart by, and the three entities an event is about.
 *
 * Written here and produced by these schemas; `packages/core` declares the same names as its
 * domain types. The domain does not depend on `ipc` and `ipc` does not depend on the domain —
 * what holds the two together is a table in the application, which is the one program that
 * sees both (design D4-02).
 */
export const projectToneSchema = z.enum(['primary', 'info', 'success', 'warning', 'neutral'])

export const entityKindSchema = z.enum(['project', 'profile', 'session'])

export const eventAuthorSchema = z.enum(['human', 'hemera', 'agent', 'mcp', 'system'])

export const eventSourceSchema = z.enum(['ui', 'system'])

/** A Project as the interface is handed one: the domain's own, its path and its locations. */
export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  tone: projectToneSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().nullable(),
  version: z.number(),
  mainPath: z.string(),
  repositories: z.array(z.string()),
})

export type Project = z.infer<typeof projectSchema>

/** One line of the Journal, already read out of the database. */
export const journalEntrySchema = z.object({
  sequence: z.number(),
  type: z.string(),
  entityKind: entityKindSchema,
  entityId: z.string(),
  source: eventSourceSchema,
  author: eventAuthorSchema,
  occurredAt: z.string(),
  projectId: z.string().nullable(),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  seenAt: z.string().nullable(),
})

export type JournalEntry = z.infer<typeof journalEntrySchema>

/** Whether a Session's title is still Hemera's to propose, or the user's decision (D4b-03). */
export const titleSourceSchema = z.enum(['derived', 'user'])

/** Who wrote a message of a thread. One value while no agent is plugged in (design D4b-09). */
export const entryRoleSchema = z.enum(['user'])

/**
 * A Session as the interface is handed one (design D4b-01).
 *
 * The dates are milliseconds, as a Project's are: what crosses the port is a number the page
 * builds a `Date` from, and never a string two sides could read two ways. A Session with no
 * message carries the title the engine wrote at creation — the interface's own "New session" —
 * so nothing that shows a thread has to invent a name for one.
 */
export const sessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  titleSource: titleSourceSchema,
  archivedAt: z.number().nullable(),
  createdAt: z.number(),
  /** The last message or rename, which is what the sidebar sorts on (design D4b-04). */
  lastWrittenAt: z.number(),
  version: z.number(),
})

export type Session = z.infer<typeof sessionSchema>

/** One message of a thread, numbered by the Session it belongs to. */
export const sessionEntrySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number(),
  role: entryRoleSchema,
  body: z.string(),
  createdAt: z.number(),
})

export type SessionEntry = z.infer<typeof sessionEntrySchema>

/**
 * A cursor into the Journal: the sequence of an entry, and nothing that cannot be one.
 *
 * Refused here rather than in the engine, which is the point of declaring it: a page asked for
 * with a negative or fractional cursor is refused before a database is opened for it.
 */
const cursorSchema = z.number().int().nonnegative()

/** How many entries a page may hold, so one call cannot ask for the whole Journal. */
const limitSchema = z.number().int().positive().max(200)

/** What a change to an existing Project or Session carries: which one, at which version. */
const addressedSchema = z.object({ id: z.string(), version: z.number().int().nonnegative() })

/**
 * What a message has to be to be one: text, and not the absence of it.
 *
 * A composer that was never typed in is not a message and is refused here, before a thread is
 * opened for it — the draft stays where it is, which is what the spec asks for.
 */
const messageSchema = z.string().min(1)

/** A call that takes no argument, which both declarations say the same way. */
export const nothingSchema = z.object({})

/**
 * Every use case of the process that holds the database.
 *
 * `arguments` is what the main process sends and that process validates; `response` is the
 * schema of what comes back, so the type of an answer is read from the same place.
 */
export const ENGINE_REQUESTS = {
  'preferences.read': {
    arguments: nothingSchema,
    response: displayPreferencesSchema,
  },
  'preferences.write': {
    arguments: displayPreferencesChangeSchema,
    response: z.void(),
  },
  'engine.status': {
    arguments: nothingSchema,
    response: engineStatusSchema,
  },

  'projects.list': {
    arguments: z.object({ includeArchived: z.boolean().optional() }),
    response: z.array(projectSchema),
  },
  'projects.create': {
    arguments: z.object({
      name: z.string(),
      tone: projectToneSchema,
      mainPath: z.string(),
    }),
    response: projectSchema,
  },
  'projects.update': {
    arguments: addressedSchema.extend({
      name: z.string().optional(),
      tone: projectToneSchema.optional(),
    }),
    response: projectSchema,
  },
  'projects.moveMain': {
    arguments: addressedSchema.extend({ path: z.string() }),
    response: projectSchema,
  },
  'projects.archive': { arguments: addressedSchema, response: projectSchema },
  'projects.restore': { arguments: addressedSchema, response: projectSchema },

  'repositories.add': {
    arguments: addressedSchema.extend({ relativePath: z.string() }),
    response: projectSchema,
  },
  'repositories.remove': {
    arguments: addressedSchema.extend({ relativePath: z.string() }),
    response: projectSchema,
  },

  'sessions.list': {
    arguments: z.object({ projectId: z.string(), archived: z.boolean().optional() }),
    response: z.array(sessionSchema),
  },
  /** With the message the Home composer was sent with, when it was sent with one. */
  'sessions.create': {
    arguments: z.object({ projectId: z.string(), firstMessage: messageSchema.optional() }),
    response: sessionSchema,
  },
  'sessions.rename': {
    arguments: addressedSchema.extend({ title: z.string().min(1) }),
    response: sessionSchema,
  },
  'sessions.archive': { arguments: addressedSchema, response: sessionSchema },
  'sessions.restore': { arguments: addressedSchema, response: sessionSchema },
  /**
   * The one use case that carries no version, because it takes nothing away.
   *
   * A message is a row added to a thread, so there is no change of another window's it could
   * overwrite — and a burst typed faster than the answers come back could not carry ten
   * versions nobody has been handed yet (design D4b-02).
   */
  'sessions.append': {
    arguments: z.object({ id: z.string(), body: messageSchema }),
    response: z.object({ session: sessionSchema, entry: sessionEntrySchema }),
  },
  'sessions.read': {
    arguments: z.object({
      sessionId: z.string(),
      after: cursorSchema.optional(),
      limit: limitSchema.optional(),
    }),
    response: z.object({
      entries: z.array(sessionEntrySchema),
      nextAfter: z.number().nullable(),
    }),
  },

  'journal.read': {
    arguments: z.object({
      projectId: z.string(),
      before: cursorSchema.optional(),
      limit: limitSchema.optional(),
      kinds: z.array(entityKindSchema).optional(),
      authors: z.array(eventAuthorSchema).optional(),
    }),
    response: z.object({
      entries: z.array(journalEntrySchema),
      nextBefore: z.number().nullable(),
    }),
  },
  'journal.unseen': {
    arguments: nothingSchema,
    response: z.object({
      entries: z.array(journalEntrySchema),
      /** How many each Project has, as pairs: a map does not survive being sent. */
      byProject: z.array(z.tuple([z.string(), z.number()])),
    }),
  },
  'journal.markSeen': {
    arguments: z.object({ upTo: cursorSchema }),
    response: z.void(),
  },
} as const

export type EngineRequests = typeof ENGINE_REQUESTS

export type EngineRequestName = keyof EngineRequests

export type EngineArguments<K extends EngineRequestName> = z.infer<EngineRequests[K]['arguments']>

export type EngineResponse<K extends EngineRequestName> = z.infer<EngineRequests[K]['response']>
