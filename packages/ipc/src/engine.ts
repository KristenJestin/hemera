/**
 * The use cases the process that holds the database answers, and nothing else (design D3-02).
 *
 * A use case is a name, a schema for what it is called with, and a type for what it answers —
 * the same shape as a channel, read by the same discipline. The main process asks by name and
 * the process that holds the database refuses anything it has not declared, so a request no
 * one wrote down cannot be sent by accident. Nothing here knows about Electron or a port: this
 * is the declaration both ends read, not the wire between them.
 *
 * The same process also pushes what happens while a Session is being worked on. That is not a
 * use case — nothing asks for it and nothing waits for it — and it is declared at the end of
 * this file (design D5-12).
 */

import { z } from 'zod'

import {
  agentAvailabilitySchema,
  agentProviderSchema,
  agentUpdateSchema,
  configOptionSchema,
  resumeStateSchema,
  stopReasonSchema,
} from './agents.ts'

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

/**
 * Which Session of which Project the window was looking at, remembered between two starts
 * (design D4b-07).
 *
 * One identifier per Project rather than one in all, because coming back to a Project is coming
 * back to what was being written there. A Session that has since been archived, or that is not
 * there any more, is not an error: the shell opens the most recently written one instead, which
 * is the same answer as a Project where nothing was ever opened.
 */
export const activeSessionsSchema = z.record(z.string(), z.string())

export const displayPreferencesSchema = z.object({
  theme: themePreferenceSchema,
  sidebar: sidebarPreferenceSchema,
  activeProjectId: activeProjectSchema,
  activeSessions: activeSessionsSchema,
})

export type DisplayPreferences = z.infer<typeof displayPreferencesSchema>

/** What a data folder answers before anyone has chosen anything. */
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  theme: 'system',
  sidebar: { collapsed: false, width: null },
  activeProjectId: null,
  activeSessions: {},
}

/** A change to what the window wears: what is absent is what the user did not touch. */
export const displayPreferencesChangeSchema = z.object({
  theme: themePreferenceSchema.optional(),
  sidebar: sidebarPreferenceSchema.optional(),
  activeProjectId: activeProjectSchema.optional(),
  activeSessions: activeSessionsSchema.optional(),
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

/**
 * A cursor into the Journal: the sequence of an entry, and nothing that cannot be one.
 *
 * Refused here rather than in the engine, which is the point of declaring it: a page asked for
 * with a negative or fractional cursor is refused before a database is opened for it.
 */
const cursorSchema = z.number().int().nonnegative()

/** How many entries a page may hold, so one call cannot ask for the whole Journal. */
const limitSchema = z.number().int().positive().max(200)

/** What every change to an existing Project carries: which one, and the version it was read at. */
const addressedSchema = z.object({ id: z.string(), version: z.number().int().nonnegative() })

/** A call that takes no argument, which both declarations say the same way. */
export const nothingSchema = z.object({})

/**
 * A Session as the interface is handed one, and one message of its thread (design D4b-01).
 *
 * The mission does not cross: this lot writes one kind of Session, and what the interface needs
 * is what it shows — a name, a side of the archive, and a `version` to write against.
 *
 * `titleSource` is handed over rather than only used by the engine because the interface asks
 * the question it answers: a title still `derived` is one the first message may still propose.
 *
 * `provider` and `model` cross for the same reason: the window says which agent a Session talks
 * to and which model it was asked for, and a Session with neither has no agent yet (D5-06).
 */
export const sessionTitleSourceSchema = z.enum(['derived', 'user'])

/** How far a Session is still attached to the agent's own native session (design D5-06). */
export const nativeStateSchema = z.enum(['none', 'attached', 'lost', 'fallback'])

/** Who wrote an entry: the user, the agent, or Hemera on its own behalf. */
export const sessionEntryRoleSchema = z.enum(['user', 'agent', 'hemera'])

/**
 * What an entry is (design D5-11): its `kind` says which block of the thread draws it, and its
 * `payload` is where that block's own details are — the tool's name and arguments, a diff's
 * files, a permission's options. `payload` is JSON text rather than a shape of its own here:
 * the same column holds every kind's details, and each kind validates what it reads.
 */
export const sessionEntryKindSchema = z.enum([
  'message',
  'thought',
  'tool_call',
  'diff',
  'terminal',
  'plan',
  'permission_request',
  'permission_decision',
  'usage',
  'turn',
  'note',
])

/**
 * How an entry came to be in the thread: written as it happened, or written from what the agent
 * replayed when a Session came back to its own native session (design D5-08, D5-11).
 *
 * It is what tells a tool call that is running from one that ran before the window was opened:
 * a resumed thread holds both, and only one of them is happening now.
 */
export const sessionEntryOriginSchema = z.enum(['live', 'replay'])

export type SessionEntryOrigin = z.infer<typeof sessionEntryOriginSchema>

export const sessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  titleSource: sessionTitleSourceSchema,
  provider: agentProviderSchema.nullable(),
  model: z.string().nullable(),
  nativeState: nativeStateSchema,
  archivedAt: z.number().nullable(),
  createdAt: z.number(),
  lastWrittenAt: z.number(),
  version: z.number(),
})

export type Session = z.infer<typeof sessionSchema>

/** Where a Session's title came from, which is what decides whether it can still change. */
export type SessionTitleSource = z.infer<typeof sessionTitleSourceSchema>

export const sessionEntrySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  /** Its place in the thread, counting from one: what the messages are ordered by. */
  seq: z.number(),
  role: sessionEntryRoleSchema,
  kind: sessionEntryKindSchema,
  body: z.string(),
  payload: z.string(),
  /** What an update of this entry found it by, inside its Session. */
  correlationId: z.string().nullable(),
  turnId: z.string().nullable(),
  /** How far it got, in the vocabulary its own kind defines. */
  state: z.string().nullable(),
  /** Whether it was written as it happened, or from what the agent replayed (design D5-08). */
  origin: sessionEntryOriginSchema,
  createdAt: z.number(),
})

export type SessionEntry = z.infer<typeof sessionEntrySchema>

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

  'sessions.list': {
    arguments: z.object({ projectId: z.string(), archived: z.boolean().optional() }),
    response: z.array(sessionSchema),
  },
  'sessions.create': {
    // The Project is what the interface has and may not: a refusal says so in a sentence, where
    // a schema that refused `null` would say it in the words of a parser.
    //
    // The agent is chosen when the Session is made, and null is a Session made without one:
    // every Session written before the agents existed holds nothing there (design D5-06).
    arguments: z.object({
      projectId: z.string().nullable(),
      provider: agentProviderSchema.nullable(),
    }),
    response: sessionSchema,
  },
  'sessions.rename': {
    arguments: addressedSchema.extend({ title: z.string() }),
    response: sessionSchema,
  },
  'sessions.archive': { arguments: addressedSchema, response: sessionSchema },
  'sessions.restore': { arguments: addressedSchema, response: sessionSchema },
  'sessions.append': {
    arguments: z.object({ sessionId: z.string(), body: z.string() }),
    response: z.object({ session: sessionSchema, entry: sessionEntrySchema }),
  },
  'sessions.read': {
    // Entries are read as what they are: each one says by its `kind` which block of the thread
    // draws it, and the block reads its own details out of `payload` (design D5-11, D5-13).
    arguments: z.object({
      sessionId: z.string(),
      before: cursorSchema.optional(),
      limit: limitSchema.optional(),
    }),
    response: z.object({
      entries: z.array(sessionEntrySchema),
      nextBefore: z.number().nullable(),
    }),
  },

  // The agents, asked for by name like the rest of them. What this machine has is the engine's
  // to answer because it is the one that can start an agent, and the one that knows which of
  // them a Session is already talking to (design D5-13).
  'agents.list': {
    arguments: nothingSchema,
    response: z.object({ agents: z.readonly(z.array(agentAvailabilitySchema)) }),
  },
  'agents.options': {
    arguments: z.object({ sessionId: z.string() }),
    response: z.object({ options: z.readonly(z.array(configOptionSchema)) }),
  },
  'agents.setOption': {
    arguments: z.object({ sessionId: z.string(), optionId: z.string(), value: z.string() }),
    response: z.void(),
  },
  'agents.prompt': {
    // Answered when the turn is over and not when it is sent: what the page is waiting for is
    // why it ended, and the rest of the turn reaches it as it happens (design D5-12).
    arguments: z.object({ sessionId: z.string(), text: z.string() }),
    response: z.object({ stopReason: stopReasonSchema }),
  },
  'agents.stop': {
    arguments: z.object({ sessionId: z.string() }),
    response: z.void(),
  },
  'agents.decide': {
    // An option of null is not a missing answer: it is the user closing the request without
    // choosing one, which the agent has to be told either way (design D5-13).
    arguments: z.object({ sessionId: z.string(), optionId: z.string().nullable() }),
    response: z.void(),
  },
  'agents.resume': {
    arguments: z.object({ sessionId: z.string() }),
    response: z.object({ state: resumeStateSchema, reason: z.string().nullable() }),
  },

  // What the Agents section of the settings asks for, and what it does about the answer
  // (design D5-18). `check` is the one use case here that leaves the machine: it reads the
  // registry of the tool each agent was installed with, which is why it is asked when the
  // section is opened and never on a schedule. `update` runs that tool's own update command,
  // only ever because somebody pressed a button, and answers with its output rather than with a
  // sentence of Hemera's — an update that refused says why in its own words.
  'agents.check': {
    arguments: nothingSchema,
    response: z.object({ agents: z.readonly(z.array(agentAvailabilitySchema)) }),
  },
  'agents.update': {
    arguments: z.object({ id: agentProviderSchema }),
    response: agentUpdateSchema,
  },
} as const

export type EngineRequests = typeof ENGINE_REQUESTS

export type EngineRequestName = keyof EngineRequests

export type EngineArguments<K extends EngineRequestName> = z.infer<EngineRequests[K]['arguments']>

export type EngineResponse<K extends EngineRequestName> = z.infer<EngineRequests[K]['response']>

/**
 * One pushed event, named by what it says happened.
 *
 * Nothing is waiting for it and nothing is answered, so it carries no identifier: what the page
 * does with it is draw what it says, and an event that is not an answer cannot be mistaken for
 * one. `entry` is the entry the event is about when it is about one — an entry that was written,
 * a turn that ended, a permission that is being asked for — and null when it is about the
 * Session or the agent itself.
 */
function pushedEvent<const Event extends string>(event: Event) {
  return z.object({
    event: z.literal(event),
    sessionId: z.string(),
    entry: sessionEntrySchema.nullable(),
  })
}

/**
 * What the engine pushes while a Session is being worked on, one schema per name (design D5-12).
 *
 * The engine writes these as they happen rather than when they are asked for: an entry was
 * written, a turn ended, a permission is being asked for, or the agent itself changed. One
 * schema per name, so that whoever sends one is held to the name it sends.
 */
export const ENGINE_EVENTS = {
  entry: pushedEvent('entry'),
  turn: pushedEvent('turn'),
  permission: pushedEvent('permission'),
  agent: pushedEvent('agent'),
} as const

export type EngineEventName = keyof typeof ENGINE_EVENTS

/** One pushed message, of whichever of the four names it carries. */
export type EngineEvent = z.infer<(typeof ENGINE_EVENTS)[EngineEventName]>

/**
 * The name these messages travel under, from the engine to the page.
 *
 * Declared here for the reason every other name is: the main process sends on this name and the
 * preload listens on it, and two copies of a name are two contracts.
 */
export const ENGINE_EVENT_CHANNEL = 'agents.event'
