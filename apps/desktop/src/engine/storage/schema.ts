/**
 * The schema of the profile, in code, from which every migration is generated (design D3-04).
 *
 * It is never written by hand as SQL: `drizzle-kit generate` reads this file and produces the
 * migration, so a profile created today and a profile migrated up to today have the same schema
 * by construction rather than by care.
 *
 * Lot 3 gave it what the application knows about itself; lot 4 adds the domain — the Projects,
 * their working environments and the journal every change is written to (design D4-04). The
 * Sessions are lot 5's.
 *
 * Two conventions run through all of it. An identifier is a `crypto.randomUUID()` in a text
 * column, because an identifier the database hands out is one that cannot be decided before the
 * row is written. A date is an ISO string, as `profile.last_opened_at` already is: a text date
 * sorts and reads as itself, and no timezone is ever inferred from a number.
 */

import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import {
  AGENT_PROVIDERS,
  COMMAND_KINDS,
  NATIVE_STATES,
  PROJECT_TONES,
  SESSION_ENTRY_KINDS,
  SESSION_ENTRY_ORIGINS,
} from '@hemera/core'

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

/** What a title is: proposed from the first message, or chosen by the user (design D4b-03). */
export const SESSION_TITLE_SOURCES = ['derived', 'user'] as const

/** Who wrote an entry: the user, the agent working in the Session, or Hemera itself. */
export const SESSION_ENTRY_ROLES = ['user', 'agent', 'hemera'] as const

/**
 * A Session: the thread of work of a project, and what it is called (design D4b-01, D4b-03).
 *
 * It is attached to a Project and to nothing else — no Spec, no Workspace — and `free` is the
 * absence of a mission rather than a column: this lot writes one kind of Session, and a column
 * holding one value is a column that lies about having a choice.
 *
 * The title is proposed from the first message and belongs to the engine, because the rule
 * that derives it is one rule: derived in the renderer, it would be two machines with two
 * opinions. `title_source` is what makes a proposal and a choice different things — a title
 * the user typed is never proposed over, and nothing has to remember not to.
 *
 * `last_written_at` is written by a message and by a rename both, because both are the user
 * working on the Session: the list is ordered by what was touched last, and a Session renamed
 * a minute ago is a Session the user is working on. `version` is incremented by every change
 * and compared inside the transaction, as a Project's is.
 *
 * There is no `deleted_at` and no delete: archiving is how a Session ends, and the absence of
 * the operation is the guarantee (design D4b-06).
 *
 * The agent columns (design D5-06) are nullable for the same reason `free` has no column: a
 * Session is created before it is given an agent, and every Session written before the agents
 * existed has none. `provider` is constrained to the agents Hemera knows how to start, so the
 * model it names is the model of a real one; `native_session_id` is what makes a Session
 * durable I — it is the handle the agent itself gave, kept so the next start can ask to resume
 * — and `native_state` says whether that handle is still worth anything. `cwd` is the directory
 * the agent was started in, kept because a resumed Session must be resumed where it ran.
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
    provider: text('provider'),
    model: text('model'),
    nativeSessionId: text('native_session_id'),
    nativeState: text('native_state').notNull().default('none'),
    cwd: text('cwd'),
    createdAt: text('created_at').notNull(),
    lastWrittenAt: text('last_written_at').notNull(),
    archivedAt: text('archived_at'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check(
      'session_title_source_is_known',
      sql`${table.titleSource} IN (${sql.raw(oneOf(SESSION_TITLE_SOURCES))})`,
    ),
    // A Session with no agent is a Session; a Session naming an agent nobody can start is a bug.
    check(
      'session_provider_is_known',
      sql`${table.provider} IS NULL OR ${table.provider} IN (${sql.raw(oneOf(AGENT_PROVIDERS))})`,
    ),
    check(
      'session_native_state_is_known',
      sql`${table.nativeState} IN (${sql.raw(oneOf(NATIVE_STATES))})`,
    ),
    // The list of a Project is read in one order, and it is this one: the index is the query.
    index('session_by_project').on(table.projectId, table.lastWrittenAt),
  ],
)

/**
 * One message of a Session: what the user wrote, and where it sits in the thread (D4b-01).
 *
 * `seq` counts from one inside its Session and the pair is unique, so the order of a thread is
 * the database's own and not the order a read happened to return: two messages written in the
 * same millisecond are still two messages, in an order that was decided when they were
 * written. It is a number and not the rank a list uses — a rank exists to insert between two
 * neighbours, and nothing inserts into a thread.
 *
 * The body is stored as it was written, trimmed of nothing: what the user sent is what is read
 * back, and the domain is where an empty message is refused.
 *
 * The `role` column holds the user's, the agent's and Hemera's, and the check says which three:
 * a thread is no longer only what the user typed.
 *
 * `kind` and `payload` are what let one table hold everything a thread is made of (design
 * D5-11): the body stays the line a reader shows and the payload carries the shape its own
 * block draws, so a diff, a plan and a set of options are rows here rather than tables of their
 * own. `correlation_id` is how an update finds its row — a tool call that ends, a message that
 * finishes arriving — and `turn_id` how everything an agent did in one turn is read together.
 * `state` is where a life goes and is null for what has no life to live, a message.
 *
 * `kind` defaults to `message` and `payload` to `{}` so that the rows written before this lot
 * keep meaning what they meant: a message with no payload is a message.
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
    kind: text('kind').notNull().default('message'),
    body: text('body').notNull(),
    payload: text('payload').notNull().default('{}'),
    /**
     * Whether the entry was written as it happened or from what an agent replayed (D5-08).
     *
     * `live` by default, because an entry written by a turn that is happening is the ordinary
     * case: only a resume writes `replay`, and it says so on every entry it inserts.
     */
    origin: text('origin').notNull().default('live'),
    correlationId: text('correlation_id'),
    turnId: text('turn_id'),
    state: text('state'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check('entry_role_is_known', sql`${table.role} IN (${sql.raw(oneOf(SESSION_ENTRY_ROLES))})`),
    check('entry_kind_is_known', sql`${table.kind} IN (${sql.raw(oneOf(SESSION_ENTRY_KINDS))})`),
    check(
      'entry_origin_is_known',
      sql`${table.origin} IN (${sql.raw(oneOf(SESSION_ENTRY_ORIGINS))})`,
    ),
    unique('entry_once_in_session').on(table.sessionId, table.seq),
    // An update finds the row it updates by what it is about, inside its own session.
    index('entry_by_correlation').on(table.sessionId, table.correlationId),
    index('entry_by_turn').on(table.sessionId, table.turnId),
  ],
)

/** Where a run of a command is: it is running, or it has ended in one of three ways. */
export const COMMAND_RUN_STATES = ['running', 'exited', 'failed', 'stopped'] as const

export type RunState = (typeof COMMAND_RUN_STATES)[number]

/** What a delivery of the context was: the base, the record of a native read, or a change. */
export const CONTEXT_DELIVERY_KINDS = ['base', 'native', 'instructions'] as const

/**
 * The commands of a Project: a name, a line to run, what it is for, and where it runs (D6-12).
 *
 * The catalogue is the Project's and not a Session's: a command written once is offered to
 * every Session of that Project, and the same process answers the agent and the user. `folder`
 * is empty for the Workspace root and is otherwise one of the Project's repositories, stored
 * the way a repository is — relative to the root — so that a Project whose folder moves keeps
 * pointing at what it meant.
 *
 * `kind` decides whether a second run starts a second process, and it is a closed set in the
 * database rather than a convention: an `app` command already running is returned, and a
 * `check` or a `utility` run twice is two runs.
 */
export const projectCommands = sqliteTable(
  'project_commands',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    line: text('line').notNull(),
    kind: text('kind').notNull(),
    folder: text('folder').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check('command_kind_is_known', sql`${table.kind} IN (${sql.raw(oneOf(COMMAND_KINDS))})`),
    // One name per Project: a catalogue with two `dev` entries is a name nobody can ask for.
    unique('command_name_in_project').on(table.projectId, table.name),
  ],
)

/**
 * One run of a command, what it printed, and what it published (D6-12).
 *
 * A run belongs to the Session that asked for it and not to the process that held it: the row
 * outlives the process, and the Commands panel of a Session reads what it did. `command_id` is
 * null for a one-off command line, which is the one thing that tells the two apart — a one-off
 * is never promoted to the catalogue by itself.
 *
 * The output is kept here and bounded: a process that prints for an hour must not become an
 * hour of rows, so the store keeps the last `OUTPUT_KEPT_BYTES` and says it truncated the rest.
 * `url` is the first `http://localhost:<port>` the output named, which is what the panel offers
 * to open and what the agent reads back.
 */
export const commandRuns = sqliteTable(
  'command_runs',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** The catalogue entry this ran, and null for a one-off command line. */
    commandId: text('command_id').references(() => projectCommands.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    line: text('line').notNull(),
    kind: text('kind').notNull(),
    cwd: text('cwd').notNull(),
    state: text('state').notNull(),
    pid: integer('pid'),
    url: text('url'),
    exitCode: integer('exit_code'),
    output: text('output').notNull().default(''),
    outputBytes: integer('output_bytes').notNull().default(0),
    truncated: integer('truncated').notNull().default(0),
    /** Who started it: the agent through its tool, or the user through the panel. */
    startedBy: text('started_by').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
  },
  (table) => [
    check('run_state_is_known', sql`${table.state} IN (${sql.raw(oneOf(COMMAND_RUN_STATES))})`),
    check('run_starter_is_known', sql`${table.startedBy} IN ('agent', 'user')`),
    index('run_by_session').on(table.sessionId, table.startedAt),
  ],
)

/**
 * What the agent was provided, and when (D6-07, D6-08).
 *
 * Three kinds of row, and they are the three answers the Context view gives. `base` is the
 * session's own start: the sentences every Session is given once, by whatever means its agent
 * has. `native` is not a delivery at all — it is the record that `AGENTS.md` was read by the
 * agent itself, with its fingerprint, which is why the view can say it was read natively rather
 * than sent. `instructions` is a change of that file delivered between two turns.
 *
 * The fingerprint is what makes a delivery identifiable and repeatable: the same text is never
 * delivered twice to the same Session, and the unique index is what enforces it rather than the
 * code remembering to.
 */
export const contextDeliveries = sqliteTable(
  'context_deliveries',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** What was provided: the file's path, and `''` for the base, which is not a file. */
    path: text('path').notNull(),
    fingerprint: text('fingerprint').notNull(),
    deliveredAt: text('delivered_at').notNull(),
  },
  (table) => [
    check(
      'delivery_kind_is_known',
      sql`${table.kind} IN (${sql.raw(oneOf(CONTEXT_DELIVERY_KINDS))})`,
    ),
    unique('delivery_once_per_change').on(
      table.sessionId,
      table.kind,
      table.path,
      table.fingerprint,
    ),
  ],
)

/** What an event is about. `session` is declared now and filled by lot 5. */
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
 * Session, the Spec, the revision and the phase exist from today and stay empty until the lot
 * that fills them — a column added later is a migration, a column left null is nothing at all.
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
