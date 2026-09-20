/**
 * The schema of the profile, in code, from which every migration is generated (design D3-04).
 *
 * It is never written by hand as SQL: `drizzle-kit generate` reads this file and produces the
 * migration, so a profile created today and a profile migrated up to today have the same schema
 * by construction rather than by care.
 *
 * Lot 3 gave it what the application knows about itself; lot 4a added the domain — the Projects,
 * their working environments and the journal every change is written to (design D4-04) — and
 * lot 4b the Sessions, which is where what the user writes is kept (design D4b-01).
 *
 * Two conventions run through all of it. An identifier is a `crypto.randomUUID()` in a text
 * column, because an identifier the database hands out is one that cannot be decided before the
 * row is written. A date is an ISO string, as `profile.last_opened_at` already is: a text date
 * sorts and reads as itself, and no timezone is ever inferred from a number.
 */

import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import { PROJECT_TONES } from '@hemera/core'

/**
 * What the window wears, one key at a time.
 *
 * The value is the JSON the page reads back, because a preference is a shape and not a string:
 * the sidebar is a fold and a width, and splitting it into columns here would be a schema that
 * changes every time the shell gains a control.
 */
export const appPreferences = sqliteTable('app_preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/**
 * Where the profile stands, in one row that is rewritten at every start.
 *
 * The last migration applied is not kept here: the migrator has its own table and duplicating
 * it is how the two come to disagree. What this row carries is what the migrator does not — the
 * version of the application that wrote the profile last, which is the name a refusal gives.
 */
export const profile = sqliteTable(
  'profile',
  {
    id: integer('id').primaryKey(),
    writtenByVersion: text('written_by_version').notNull(),
    lastOpenedAt: text('last_opened_at').notNull(),
  },
  (table) => [check('profile_is_one_row', sql`${table.id} = 1`)],
)

/** The row of `profile`, which is the only one there is. */
export const PROFILE_ROW = 1

/**
 * A closed set of values, written into a `check` as the literals it is.
 *
 * A check is compiled into the migration once and read by SQLite from then on, so its values
 * cannot be bound at run time: they are inlined. They are still never typed twice — the list
 * comes from wherever it is declared, and this turns it into the SQL that constrains the column.
 */
function oneOf(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ')
}

/**
 * A project: a logical grouping that exists before its sources do.
 *
 * It has no path of its own — that belongs to its `main` workspace — and it is never deleted:
 * `archived_at` is how a project ends, and it is a date that can be cleared. `version` is
 * incremented by every mutation and compared inside the transaction, so two windows editing the
 * same project refuse the second write instead of losing it.
 */
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tone: text('tone').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check('project_tone_is_known', sql`${table.tone} IN (${sql.raw(oneOf(PROJECT_TONES))})`),
  ],
)

/**
 * A working environment of a project, and where its path lives.
 *
 * `main` is created with the project and never removed. The name is unique inside a project
 * rather than globally: two projects both have a `main`, and they are not the same folder.
 */
export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique('workspace_name_in_project').on(table.projectId, table.name)],
)

/**
 * Where a project reads its sources from, relative to the folder of `main`.
 *
 * The path is relative and stays relative: the root is a property of the workspace, and a
 * repository that stored an absolute path would break the day the folder moves. Order is a
 * rank rather than a position, so inserting one never renumbers the others.
 */
export const projectRepositories = sqliteTable(
  'project_repositories',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    relativePath: text('relative_path').notNull(),
    rank: text('rank').notNull(),
  },
  (table) => [unique('repository_once_in_project').on(table.projectId, table.relativePath)],
)

/**
 * Where a title came from, which is what says whether Hemera may still choose it.
 *
 * `derived` is a proposal the engine made and may make again; `user` is a decision, and a
 * decision is never overwritten by a proposal (design D4b-03).
 */
export const TITLE_SOURCES = ['derived', 'user'] as const

/**
 * Who wrote an entry of a thread.
 *
 * One value in this lot, because no agent is plugged in and a thread is the user's own
 * (design D4b-09). The column exists all the same: the day an agent answers, that is a row
 * with another role and not a migration.
 */
export const ENTRY_ROLES = ['user'] as const

/**
 * A Session: a thread of a Project, with no Spec and no Workspace of its own (design D4b-01).
 *
 * It is never deleted — `archived_at` is how one ends, and it is a date that can be cleared —
 * and `version` is compared inside the transaction that writes it, as a Project's is.
 *
 * `last_written_at` is what the sidebar sorts on and is not `created_at` under another name:
 * a message and a rename both count as writing to a Session, and what is looked for in a list
 * of threads is the one worked on last (design D4b-04). `title` is never null: a Session with
 * no message carries the default the interface shows, and `title_source` is what says the
 * engine is still allowed to replace it.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    titleSource: text('title_source').notNull(),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    lastWrittenAt: text('last_written_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check(
      'session_title_source_is_known',
      sql`${table.titleSource} IN (${sql.raw(oneOf(TITLE_SOURCES))})`,
    ),
    // The three columns the sidebar asks by, in the order it asks them: whose Sessions, which
    // of them are still current, and the most recently written first.
    index('session_by_project').on(table.projectId, table.archivedAt, table.lastWrittenAt),
  ],
)

/**
 * One message of a thread, in the order it was written down.
 *
 * `seq` is handed out by the Session and not by the table: a thread is read and paged by its
 * own numbering, so two Sessions both start at one, and the uniqueness of the pair is what
 * makes a burst of messages either an order or a refusal — never two rows claiming a place.
 */
export const sessionEntries = sqliteTable(
  'session_entries',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check('entry_role_is_known', sql`${table.role} IN (${sql.raw(oneOf(ENTRY_ROLES))})`),
    unique('entry_seq_in_session').on(table.sessionId, table.seq),
  ],
)

/** What an event is about. `session` is filled from lot 4b on. */
export const ENTITY_KINDS = ['project', 'profile', 'session'] as const

/** Where an event came from: the user acting, or the application doing its work. */
export const EVENT_SOURCES = ['ui', 'system'] as const

/**
 * Who did the thing an event records.
 *
 * Five, because five things can really act on a Project: the user at the keyboard, Hemera on
 * its own behalf, an agent working inside a Session, a client driving Hemera from outside over
 * MCP, and the machine — a start, a scheduled run, something nobody asked for at that moment.
 * `hemera` and `system` are worth telling apart: one is the application deciding, the other is
 * the application being woken. Lots 5 and 7 fill `agent` and `mcp`; they are declared now for
 * the reason the reserved correlations are — a column that exists costs nothing, and a value a
 * `check` has never heard of costs a migration.
 */
export const EVENT_AUTHORS = ['human', 'hemera', 'agent', 'mcp', 'system'] as const

/**
 * The journal: every change made, in the order it happened, written with the change itself.
 *
 * Append-only, and the one column ever written again is `seen_at`. `sequence` is an
 * `AUTOINCREMENT` key rather than a plain rowid, which is what makes it strictly increasing
 * across restarts: SQLite remembers the highest one ever handed out instead of reusing a gap.
 *
 * The correlations are columns and not a payload to be searched: a journal read by project
 * finds its rows through an index, without opening a single JSON document. Those of the
 * Session, the Spec, the revision and the phase were all declared by lot 4a; the Session's is
 * written from lot 4b on and the others stay empty until the lot that fills them — a column
 * added later is a migration, a column left null is nothing at all.
 */
export const domainEvents = sqliteTable(
  'domain_events',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id').notNull(),
    source: text('source').notNull(),
    author: text('author').notNull(),
    occurredAt: text('occurred_at').notNull(),
    projectId: text('project_id'),
    sessionId: text('session_id'),
    specId: text('spec_id'),
    revisionId: text('revision_id'),
    phaseId: text('phase_id'),
    /** What the event says about itself, as the JSON its reader parses. */
    payload: text('payload').notNull(),
    /** When the user was shown it, and null for as long as they were not. */
    seenAt: text('seen_at'),
  },
  (table) => [
    check('event_entity_is_known', sql`${table.entityKind} IN (${sql.raw(oneOf(ENTITY_KINDS))})`),
    check('event_source_is_known', sql`${table.source} IN (${sql.raw(oneOf(EVENT_SOURCES))})`),
    check('event_author_is_known', sql`${table.author} IN (${sql.raw(oneOf(EVENT_AUTHORS))})`),
    index('event_by_project').on(table.projectId, table.sequence),
    index('event_by_session').on(table.sessionId, table.sequence),
    index('event_unseen').on(table.seenAt),
  ],
)
