/**
 * The schema of the profile, in code, from which every migration is generated (design D3-04).
 *
 * It is never written by hand as SQL: `drizzle-kit generate` reads this file and produces the
 * migration, so a profile created today and a profile migrated up to today have the same schema
 * by construction rather than by care.
 *
 * Lot 3 gave it what the application knows about itself; lot 4 adds the domain — the Projects,
 * their working environments and the journal every change is written to (design D4-04). The
 * Sessions are lot 5's; the Specs, their revisions and the mission of a Session are lot 19's
 * (design D7-01, D7-07).
 *
 * Two conventions run through all of it. An identifier is a `crypto.randomUUID()` in a text
 * column, because an identifier the database hands out is one that cannot be decided before the
 * row is written. A date is an ISO string, as `profile.last_opened_at` already is: a text date
 * sorts and reads as itself, and no timezone is ever inferred from a number.
 */

import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import {
  AGENT_PROVIDERS,
  COMMAND_SCOPES,
  COMMAND_TYPES,
  LAUNCH_STATES,
  MISSIONS,
  NATIVE_STATES,
  PHASE_IDS,
  PHASE_STATES,
  PROJECT_TONES,
  RECIPE_KINDS,
  REPOSITORY_ICONS,
  SECTION_NAMES,
  SESSION_ENTRY_KINDS,
  SESSION_ENTRY_ORIGINS,
  SPEC_ACTORS,
  SPEC_STATUSES,
  SPEC_TYPES,
  STEP_KINDS,
  STEP_STATES,
  TASK_EXECUTORS,
  WORKSPACE_STATES,
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
 *
 * `workspaces_root` is where its dedicated Workspaces are made, and null means Hemera's own
 * folder for them, `<data folder>/workspaces/<project id>` (D8-02); `branch_prefix` is what
 * their branches start with, and null means the Project's name as a slug (D8-04). Both are
 * nullable rather than filled in, so a default that changes is not a value frozen in every row.
 *
 * `spec_prefix` and `next_spec_number` mint the key of its next Spec, `PREFIX-n`, in the
 * transaction that creates it (design D7-02): a counter per project, never reused.
 */
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tone: text('tone').notNull(),
    specPrefix: text('spec_prefix').notNull().default('SPEC'),
    nextSpecNumber: integer('next_spec_number').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
    version: integer('version').notNull().default(1),
    workspacesRoot: text('workspaces_root'),
    branchPrefix: text('branch_prefix'),
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
 *
 * There is one kind of Workspace (D8-01): `main`, one the user made on a folder of theirs, and
 * one dedicated to a Spec are rows of this table alike. `spec_id` is the Spec a dedicated one was
 * made for, and null for the two others; a Spec has one at most, which the partial index says,
 * and the foreign key to `specs` keeps it a Spec that exists. `state` defaults to `ready`
 * because that is what every Workspace written before this lot is, `main` first, and what one
 * made on a folder is from its creation; a dedicated one is written `preparing`, explicitly.
 * `cleaned_at` is when a cleanup removed its folder: the row is kept, `cleaned`, and so is every
 * branch it made (D8-14).
 *
 * Both uniques leave a `cleaned` Workspace out. Its folder is gone, so its name is free for a new
 * one in the same place (D8-02), and a Spec whose Workspace was cleaned can be given another
 * (D8-01, D8-14): the row stays as a record, not as a claim on the name or the Spec.
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
    specId: text('spec_id').references((): AnySQLiteColumn => specs.id, { onDelete: 'set null' }),
    state: text('state').notNull().default('ready'),
    cleanedAt: text('cleaned_at'),
  },
  (table) => [
    uniqueIndex('workspace_name_in_project')
      .on(table.projectId, table.name)
      .where(sql`${table.state} <> 'cleaned'`),
    check('workspace_state_is_known', sql`${table.state} IN (${sql.raw(oneOf(WORKSPACE_STATES))})`),
    uniqueIndex('workspace_once_per_spec')
      .on(table.specId)
      .where(sql`${table.specId} IS NOT NULL AND ${table.state} <> 'cleaned'`),
  ],
)

/**
 * What each worktree of a dedicated Workspace was created on (D8-01): the repository it is, by
 * its path relative to the root, the branch it was made with and the base it started from.
 *
 * A record of the creation and not of the present: the branch a worktree is on now is read from
 * Git when it is shown (D8-15), never from this row, and never stored on the Spec.
 */
export const workspaceRepositories = sqliteTable(
  'workspace_repositories',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    relativePath: text('relative_path').notNull(),
    branch: text('branch').notNull(),
    base: text('base').notNull(),
  },
  (table) => [unique('worktree_once_in_workspace').on(table.workspaceId, table.relativePath)],
)

/**
 * Where a project reads its sources from, relative to the folder of `main`.
 *
 * The path is relative and stays relative: the root is a property of the workspace, and a
 * repository that stored an absolute path would break the day the folder moves. Order is a
 * rank rather than a position, so inserting one never renumbers the others.
 *
 * `included_by_default` says whether a dedicated Workspace gets a worktree of it unless the
 * user leaves it out at creation (D8-04): 1 by default, which is what every repository declared
 * before this lot is. `icon` is the one of a fixed set it wears (recette 1, item 11), and null
 * for none.
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
    includedByDefault: integer('included_by_default').notNull().default(1),
    icon: text('icon'),
  },
  (table) => [
    unique('repository_once_in_project').on(table.projectId, table.relativePath),
    check(
      'repository_icon_is_known',
      sql`${table.icon} IS NULL OR ${table.icon} IN (${sql.raw(oneOf(REPOSITORY_ICONS))})`,
    ),
  ],
)

/**
 * The variables a Project sets, and those a Workspace sets over them (D8-06).
 *
 * A row with no `workspace_id` is the Project's; one with a Workspace overrides the Project's
 * variable of the same key in that Workspace. What a run is given is the process's environment,
 * then the Project's, then the Workspace's. A key is set once per Project and once per
 * Workspace: two partial indexes rather than one unique on the three columns, because SQLite
 * holds two NULLs as distinct and a plain unique would let a Project set `PORT` twice.
 */
export const environmentVariables = sqliteTable(
  'environment_variables',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (table) => [
    uniqueIndex('variable_once_in_project')
      .on(table.projectId, table.key)
      .where(sql`${table.workspaceId} IS NULL`),
    uniqueIndex('variable_once_in_workspace')
      .on(table.workspaceId, table.key)
      .where(sql`${table.workspaceId} IS NOT NULL`),
  ],
)

/** What a title is: proposed from the first message, or chosen by the user (design D4b-03). */
export const SESSION_TITLE_SOURCES = ['derived', 'user'] as const

/** Who wrote an entry: the user, the agent working in the Session, or Hemera itself. */
export const SESSION_ENTRY_ROLES = ['user', 'agent', 'hemera'] as const

/**
 * A Session: the thread of work of a project, and what it is called (design D4b-01, D4b-03).
 *
 * It is attached to a Project, and since lot 19 it carries a mission and the Spec it defines
 * (design D7-07): a Session is `free` with no Spec, or `define` with the Spec it was switched
 * onto when the human accepted the agent's proposal, or was opened on. `briefed_at` is when the
 * last mission brief was composed, so the human edits and answers after it are those "since the
 * last turn".
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
 *
 * `workspace_id` is the Workspace the Session works in (D8-08), fixed once its agent started;
 * null on a Session written before this lot, which is read as `main`.
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
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    /** The revision a `build` Session was started on (D8-13); null on every other Session. */
    revisionId: text('revision_id'),
    mission: text('mission').notNull().default('free'),
    specId: text('spec_id').references((): AnySQLiteColumn => specs.id),
    briefedAt: text('briefed_at'),
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
    check('session_mission_is_known', sql`${table.mission} IN (${sql.raw(oneOf(MISSIONS))})`),
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

/**
 * What a delivery of the context was: the base, the record of a native read, the file given at
 * the start to an agent that does not read it, or a change; and, for a `define` Session, the
 * mission brief, the human's answers and edits of the Spec, and a sub-agent's result (D7-09,
 * D7-14).
 */
export const CONTEXT_DELIVERY_KINDS = [
  'base',
  'native',
  'provided',
  'instructions',
  'brief',
  'answer',
  'edit',
  'internal',
] as const

/** The kinds recorded once per Session and fingerprint: what a Session starts with. */
const STARTED_WITH: readonly ContextDeliveryKind[] = ['base', 'native', 'provided']

export type ContextDeliveryKind = (typeof CONTEXT_DELIVERY_KINDS)[number]

/**
 * The commands of a Project: a name, a line to run, what it is for, and where it runs (D6-12).
 *
 * The catalogue is the Project's and not a Session's: a command written once is offered to
 * every Session of that Project, and the same process answers the agent and the user. Where it
 * runs is a base and a folder under it (D8-07 as amended by recette 1): `folder_base` is one of
 * the Project's repositories as the Project declares it, null for the Workspace root, and
 * `folder` is relative to that base, null for the base itself — so a command of a repository
 * follows it into every Workspace, and a Project whose folder moves keeps pointing at what it
 * meant. The migration reads lot 18's `folder`, a repository or empty for the root, as that base.
 *
 * `type` is what the command is for, one of seven with the icon the design system fixes (D8-07),
 * and it replaces lot 18's `kind`: the migration reads `app` as `serve`, `check` as `test` and
 * `utility` as `script`. It is a closed set in the database rather than a convention, because it
 * decides whether a second run starts a second process: a `serve` already running is joined.
 * `line_windows` and `line_linux` are the machine's own line, null when it runs the default one;
 * `scope` says whether a `serve` runs once per Workspace or once for the Project; `portless`
 * whether its line runs through Portless (D8-10), and `portless_name` the name it runs under,
 * null for the Project's name as a slug (D8-10 as amended by recette 1).
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
    type: text('type').notNull(),
    folder: text('folder'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lineWindows: text('line_windows'),
    lineLinux: text('line_linux'),
    scope: text('scope').notNull().default('workspace'),
    portless: integer('portless').notNull().default(0),
    folderBase: text('folder_base'),
    portlessName: text('portless_name'),
  },
  (table) => [
    check('command_type_is_known', sql`${table.type} IN (${sql.raw(oneOf(COMMAND_TYPES))})`),
    check('command_scope_is_known', sql`${table.scope} IN (${sql.raw(oneOf(COMMAND_SCOPES))})`),
    // One name per Project: a catalogue with two `dev` entries is a name nobody can ask for.
    unique('command_name_in_project').on(table.projectId, table.name),
  ],
)

/**
 * One run of a command, what it printed, and what it published (D6-12).
 *
 * A run belongs to the Session that asked for it and not to the process that held it: the row
 * outlives the process, and the Commands panel of a Session reads what it did. `session_id` is
 * null for a run no Session asked for — a preparation's `run` step, which has none (Decided 11) —
 * and a Session's panel never lists such a run. `command_id` is
 * null for a one-off command line, which is the one thing that tells the two apart — a one-off
 * is never promoted to the catalogue by itself.
 *
 * The output is kept here and bounded: a process that prints for an hour must not become an
 * hour of rows, so the store keeps the last `OUTPUT_KEPT_BYTES` and says it truncated the rest.
 * `url` is the first `http://localhost:<port>` the output named, which is what the panel offers
 * to open and what the agent reads back.
 *
 * `type` replaces `kind` as the catalogue's does (D8-07), with no check, as before: a run keeps
 * what it was started as. `workspace_id` is the Workspace it runs in (D8-08), null on a run
 * written before this lot, which is read as `main`; the index is how a Workspace's services and
 * a cleanup's running runs are found. `environment` is the JSON of the variables it was given
 * (D8-06). `ready_at` is when its address first answered (D8-09), and `port_conflict` the JSON
 * of the run holding the port it published — `{ port, runId, workspaceId, workspaceName, name }`.
 *
 * `folder` and `scope` are the command's as the run was started, kept on the run because the
 * Spec asks every run to record its folder, and the catalogue entry cannot answer for it: it may
 * have been edited or removed since, and a one-off has none. `folder` is relative to the
 * Workspace root and null for the root; a run written before this lot ran at the root, once per
 * Workspace, which is what the defaults say (D8-07).
 */
export const commandRuns = sqliteTable(
  'command_runs',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    /** The catalogue entry this ran, and null for a one-off command line. */
    commandId: text('command_id').references(() => projectCommands.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    line: text('line').notNull(),
    type: text('type').notNull(),
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
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    environment: text('environment').notNull().default('{}'),
    readyAt: text('ready_at'),
    portConflict: text('port_conflict'),
    folder: text('folder'),
    scope: text('scope').notNull().default('workspace'),
  },
  (table) => [
    check('run_state_is_known', sql`${table.state} IN (${sql.raw(oneOf(COMMAND_RUN_STATES))})`),
    check('run_scope_is_known', sql`${table.scope} IN (${sql.raw(oneOf(COMMAND_SCOPES))})`),
    check('run_starter_is_known', sql`${table.startedBy} IN ('agent', 'user')`),
    index('run_by_session').on(table.sessionId, table.startedAt),
    index('run_by_workspace').on(table.workspaceId, table.state),
  ],
)

/**
 * The recipe a Project prepares each dedicated Workspace with (D8-05), in `rank` order.
 *
 * `copy` puts a file or a folder of `main` at the same relative place, `link` makes a link to
 * it, `run` starts a command of the catalogue or a line of its own (recette 2). `base` is where a
 * copy or a link applies, and where a run of a line of its own runs from (D8-05 as amended by
 * recette 1): one of the Project's repositories as the Project declares it, null for the Workspace
 * root, several repositories being several steps; `path` is relative to that base — the file or
 * the folder of a copy and a link, the folder a run of a line of its own starts in, or null.
 * `command_id` is the catalogue command a `run` starts; a line of its own belongs to the step and
 * never reaches the catalogue, so it carries `line`, `line_windows` and `line_linux` the way a
 * command carries its own, and the agent never sees it. A command taken out of the catalogue
 * leaves its step without one rather than taking the step with it: the recipe is the user's, and a
 * step that cannot run is one they are shown.
 */
export const projectPreparationSteps = sqliteTable(
  'project_preparation_steps',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    base: text('base'),
    path: text('path'),
    commandId: text('command_id').references(() => projectCommands.id, { onDelete: 'set null' }),
    /** The line a run of a line of its own runs where it has no variant of its own. */
    line: text('line'),
    /** The lines a run of a line of its own runs on Windows and on Linux, when it has one each. */
    lineWindows: text('line_windows'),
    lineLinux: text('line_linux'),
    rank: text('rank').notNull(),
  },
  (table) => [
    check('recipe_kind_is_known', sql`${table.kind} IN (${sql.raw(oneOf(RECIPE_KINDS))})`),
  ],
)

/**
 * The preparation of one Workspace, one row per step, each with its own state (D8-05).
 *
 * Built at creation — the worktrees in the repositories' order, then the recipe in its order —
 * and written as each step changes, outside any transaction that would hold a process or Git:
 * a failure stops the list and keeps what was done, and a resume reads this table to know what
 * to re-check and what to retry. `base` and `target` are a copy's or a link's repository and its
 * path under it, the recipe's own; a run of a line of its own (recette 2) keeps that line as its
 * `target` and the folder it starts in as `path`, its `base` being where it runs from. `message`
 * is what refused a step, as it was said; `run_id` the run a `run` step started, whose output is
 * where its failure is read.
 */
export const workspaceSteps = sqliteTable(
  'workspace_steps',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    target: text('target').notNull(),
    base: text('base'),
    /** The folder a run of a line of its own starts in, relative to `base`; null otherwise. */
    path: text('path'),
    commandId: text('command_id').references(() => projectCommands.id, { onDelete: 'set null' }),
    state: text('state').notNull(),
    message: text('message'),
    runId: text('run_id').references(() => commandRuns.id, { onDelete: 'set null' }),
  },
  (table) => [
    check('step_kind_is_known', sql`${table.kind} IN (${sql.raw(oneOf(STEP_KINDS))})`),
    check('step_state_is_known', sql`${table.state} IN (${sql.raw(oneOf(STEP_STATES))})`),
    unique('step_once_in_workspace').on(table.workspaceId, table.position),
  ],
)

/**
 * What the agent was provided, and when (D6-07, D6-08).
 *
 * Four kinds of row, and they are the four answers the Context view gives. `base` is the
 * session's own start: the sentences every Session is given once, by whatever means its agent
 * has. `native` is not a delivery at all — it is the record that `AGENTS.md` was read by the
 * agent itself, with its fingerprint, which is why the view can say it was read natively rather
 * than sent. `provided` is that file given by Hemera at the start of the Session, to an agent
 * whose bare mode keeps it from reading it. `instructions` is a change of that file delivered
 * between two turns. A `define` Session is handed four more the same way (D7-09, D7-14): `brief`,
 * the mission brief, whose path is the phase it was composed for (`''` for none); `answer` and
 * `edit`, the human's answers and section edits since the last one; `internal`, a sub-agent's
 * result.
 *
 * The fingerprint is what makes a delivery identifiable. The base and the file as the Session
 * started with it are recorded once per Session and fingerprint, which the unique index enforces. A delivery is not
 * held to that, whatever its kind: a file edited A, then B, then back to A is delivered each time it changes, and
 * what decides that is the last fingerprint given, not every one ever given.
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
    uniqueIndex('delivery_once_per_change')
      .on(table.sessionId, table.kind, table.path, table.fingerprint)
      .where(sql`${table.kind} IN (${sql.raw(oneOf(STARTED_WITH))})`),
  ],
)

/**
 * What an event is about. `session` is lot 5's, `spec` lot 19's (design D7-13); `workspace`,
 * `command` and `launch` are lot 20's (D8-16): a Workspace prepared and cleaned, a run started,
 * ready and ended, a proposal decided, a build launched.
 */
export const ENTITY_KINDS = [
  'project',
  'profile',
  'session',
  'spec',
  'workspace',
  'command',
  'launch',
] as const

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
    index('event_by_spec').on(table.specId, table.sequence),
    index('event_unseen').on(table.seenAt),
  ],
)

/**
 * A Spec: what a project intends to build, relational rather than a document (design D7-01).
 *
 * `key` is `PREFIX-n`, minted from the project's counter in the creating transaction and unique
 * inside the project (D7-02); the slug follows the first title. A Spec needs no Workspace.
 * `content_version` is bumped by every write and is what an attestation and a "Mark ready" click
 * are made against.
 *
 * `current_revision_id` has no foreign key: a Spec and its first revision are written in one
 * transaction and each names the other, and a cycle of references is one SQLite and Drizzle
 * would both have to be talked round. The use case keeps it right.
 */
export const specs = sqliteTable(
  'specs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull(),
    priority: text('priority'),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    currentRevisionId: text('current_revision_id').notNull(),
    /** The one Session whose agent may write the draft (D7-11). */
    writerSessionId: text('writer_session_id').references((): AnySQLiteColumn => sessions.id),
    contentVersion: integer('content_version').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check('spec_status_is_known', sql`${table.status} IN (${sql.raw(oneOf(SPEC_STATUSES))})`),
    unique('spec_key_in_project').on(table.projectId, table.key),
    index('spec_by_project').on(table.projectId),
  ],
)

/**
 * One revision of a Spec: its title and type, and why it was opened (design D7-01).
 *
 * Only the current revision of a draft is written; a reopening copies it whole into the next
 * number, so an old revision stays readable as it was.
 */
export const specRevisions = sqliteTable(
  'spec_revisions',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    type: text('type').notNull(),
    changeSummary: text('change_summary'),
    changeReason: text('change_reason'),
    createdBy: text('created_by').notNull(),
    /** The `content_version` the agent attested the contract on, if it did. */
    attestedContentVersion: integer('attested_content_version'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check('revision_type_is_known', sql`${table.type} IN (${sql.raw(oneOf(SPEC_TYPES))})`),
    check(
      'revision_created_by_is_known',
      sql`${table.createdBy} IN (${sql.raw(oneOf(SPEC_ACTORS))})`,
    ),
    unique('revision_number_in_spec').on(table.specId, table.number),
  ],
)

/**
 * A section of a revision, one row per name, each with its own version (design D7-01, D7-12).
 *
 * The version is what a conflict and a stale phase are decided on, so it belongs to the section
 * and not to the Spec; the author and the Session say who wrote it last.
 */
export const specSections = sqliteTable(
  'spec_sections',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => specRevisions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    body: text('body').notNull().default(''),
    version: integer('version').notNull().default(1),
    author: text('author').notNull(),
    sessionId: text('session_id'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check('section_name_is_known', sql`${table.name} IN (${sql.raw(oneOf(SECTION_NAMES))})`),
    check('section_author_is_known', sql`${table.author} IN (${sql.raw(oneOf(SPEC_ACTORS))})`),
    unique('section_once_in_revision').on(table.revisionId, table.name),
  ],
)

/** A user story of a revision, ordered by rank (design D7-01). */
export const userStories = sqliteTable('user_stories', {
  id: text('id').primaryKey(),
  revisionId: text('revision_id')
    .notNull()
    .references(() => specRevisions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  narrative: text('narrative').notNull(),
  priority: text('priority'),
  rank: text('rank').notNull(),
})

/** An acceptance criterion of a story, ordered by rank (design D7-01). */
export const acceptanceCriteria = sqliteTable('acceptance_criteria', {
  id: text('id').primaryKey(),
  storyId: text('story_id')
    .notNull()
    .references(() => userStories.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  rank: text('rank').notNull(),
})

/** The kinds of task set a revision holds; `contract` is the only one written (design D7-01). */
export const TASK_SET_KINDS = ['contract'] as const

/** A set of tasks of a revision (design D7-01). */
export const taskSets = sqliteTable(
  'task_sets',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => specRevisions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
  },
  (table) => [
    check('task_set_kind_is_known', sql`${table.kind} IN (${sql.raw(oneOf(TASK_SET_KINDS))})`),
  ],
)

/** A task of a set, ordered by rank, done by an agent or a human (design D7-01). */
export const specTasks = sqliteTable(
  'spec_tasks',
  {
    id: text('id').primaryKey(),
    taskSetId: text('task_set_id')
      .notNull()
      .references(() => taskSets.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    result: text('result').notNull(),
    type: text('type').notNull(),
    executor: text('executor').notNull(),
    criteria: text('criteria').notNull(),
    rank: text('rank').notNull(),
  },
  (table) => [
    check('task_executor_is_known', sql`${table.executor} IN (${sql.raw(oneOf(TASK_EXECUTORS))})`),
  ],
)

/** `task_id` depends on `depends_on_id`; the graph is checked by the domain (design D7-01). */
export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => specTasks.id, { onDelete: 'cascade' }),
    dependsOnId: text('depends_on_id')
      .notNull()
      .references(() => specTasks.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.dependsOnId] })],
)

/** `task_id` covers `story_id` (design D7-01). */
export const taskStories = sqliteTable(
  'task_stories',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => specTasks.id, { onDelete: 'cascade' }),
    storyId: text('story_id')
      .notNull()
      .references(() => userStories.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.storyId] })],
)

/**
 * A question raised on a revision, blocking the gate or not, and its answer (design D7-01).
 *
 * `options` is a JSON array of the answers offered, `{ id, label, recommended? }`, read whole
 * with the question and never searched. The answer is one of them or a text of the human's own,
 * one of the two columns filled once `resolved_at` is.
 */
export const specQuestions = sqliteTable(
  'spec_questions',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => specRevisions.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    blocking: integer('blocking', { mode: 'boolean' }).notNull(),
    phase: text('phase'),
    raisedBy: text('raised_by').notNull(),
    options: text('options').notNull().default('[]'),
    answerOptionId: text('answer_option_id'),
    answerText: text('answer_text'),
    resolvedAt: text('resolved_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check(
      'question_phase_is_known',
      sql`${table.phase} IS NULL OR ${table.phase} IN (${sql.raw(oneOf(PHASE_IDS))})`,
    ),
    check(
      'question_raised_by_is_known',
      sql`${table.raisedBy} IN (${sql.raw(oneOf(SPEC_ACTORS))})`,
    ),
  ],
)

/**
 * The durable execution of the define protocol, one row per phase and revision (design D7-08).
 *
 * The protocol itself lives in code; this is where it stands. `assumptions` is a JSON array of
 * the open assumptions and `basis` a JSON object of the section versions the phase was declared
 * on, read whole and never searched, so they are JSON rather than tables.
 */
export const specPhases = sqliteTable(
  'spec_phases',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => specRevisions.id, { onDelete: 'cascade' }),
    phase: text('phase').notNull(),
    state: text('state').notNull(),
    summary: text('summary'),
    assumptions: text('assumptions').notNull().default('[]'),
    basis: text('basis').notNull().default('{}'),
    protocolVersion: integer('protocol_version').notNull(),
    declaredAt: text('declared_at'),
  },
  (table) => [
    check('phase_is_known', sql`${table.phase} IN (${sql.raw(oneOf(PHASE_IDS))})`),
    check('phase_state_is_known', sql`${table.state} IN (${sql.raw(oneOf(PHASE_STATES))})`),
    unique('phase_once_in_revision').on(table.revisionId, table.phase),
  ],
)

/**
 * A human text a conflict refused, kept until it is applied or discarded (design D7-12).
 *
 * One per section and Spec, persisted so a relaunch keeps it: a conflict never loses what the
 * human typed. `base_version` is the section version the text was written against.
 */
export const specEditBuffers = sqliteTable(
  'spec_edit_buffers',
  {
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    body: text('body').notNull(),
    baseVersion: integer('base_version').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check('buffer_name_is_known', sql`${table.name} IN (${sql.raw(oneOf(SECTION_NAMES))})`),
    primaryKey({ columns: [table.specId, table.name] }),
  ],
)

/**
 * A launch of a build: the request that waits for its environment, then starts it (D8-13).
 *
 * A row per request and not a flag on the Spec, because a request has a life of its own: it
 * waits, it is being started, it started, it failed with a cause, or a Rework cancelled it.
 * `revision_id` is the revision the launch was asked on, and stays text rather than a foreign
 * key (D8-13). `workspace_id` and `session_id` are set to null rather than cascaded: a Workspace
 * cleaned up or a Session gone leaves the record of the launch where it is. `detail` is what
 * refused it, as it was said, and null while nothing did.
 *
 * The environment is not named here: the launch is a request against what the Spec already
 * holds, and its Workspace is the one the Spec was given.
 */
export const buildLaunches = sqliteTable(
  'build_launches',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    revisionId: text('revision_id').notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    state: text('state').notNull(),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    detail: text('detail'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check('launch_state_is_known', sql`${table.state} IN (${sql.raw(oneOf(LAUNCH_STATES))})`),
    index('launch_by_spec').on(table.specId, table.state),
  ],
)
