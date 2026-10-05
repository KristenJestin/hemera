/**
 * The schema of the data folder's database, in code, from which every migration is generated.
 *
 * It is never written as SQL by hand: `drizzle-kit generate` reads this file and produces the
 * migration, so a database created today and one migrated up to today have the same schema by
 * construction. Hemera 1.0 starts this schema afresh: nothing of the 0.x model is here.
 *
 * Two conventions run through it. An identifier is a `crypto.randomUUID()` in a text column, and
 * a date is an ISO string: a text date sorts and reads as itself. A column that keeps text an
 * agent, a command, Git or a forge produced takes `Masked<string>`: it is masked before the insert.
 */

import type { Masked } from '@hemera/core/domain'
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * The Profile itself, in one row: its identifier, the version of Hemera that created it, and the
 * last version that opened it. The migrations applied are not kept here; the migrator keeps its
 * own table, and duplicating it is how the two come to disagree.
 */
export const profile = sqliteTable(
  'profile',
  {
    row: integer('row').primaryKey(),
    id: text('id').notNull(),
    createdByVersion: text('created_by_version').notNull(),
    createdAt: text('created_at').notNull(),
    lastOpenedByVersion: text('last_opened_by_version').notNull(),
    lastOpenedAt: text('last_opened_at').notNull(),
  },
  (table) => [check('profile_is_one_row', sql`${table.row} = 1`)],
)

/** The one row of `profile`. */
export const PROFILE_ROW = 1

/**
 * The application's preferences, one row per key. The value is the JSON of the key's `Schema`,
 * decoded by that schema when it is read; a row it cannot read is the default.
 */
export const appPreferences = sqliteTable('app_preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/**
 * The domain events: what happened, written in the transaction of the change that made it
 * happen, and never changed afterwards.
 *
 * `sequence` is an `AUTOINCREMENT` key rather than a plain rowid: strictly increasing and never
 * reused, even after the last row is deleted, so a reader can keep it as a durable cursor. The
 * correlations later tickets need (a mission, a task) are columns their own migrations add.
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
    /** A flat JSON object of plain values. */
    payload: text('payload').notNull(),
  },
  (table) => [index('event_by_entity').on(table.entityKind, table.entityId, table.sequence)],
)

/**
 * The Projects: a name, the main checkout (the folder of the user's own clones), and where and
 * under which branch prefix its Workspaces are made, null meaning the default for both. The
 * identifier is internal and never changes; the name changes freely. `version` is what an edit
 * must have read: an edit of an older one is refused.
 *
 * `key_prefix` starts the keys of its missions, once in the Profile; it is null only for a Project
 * made before missions existed, until the engine's start gives it its default. `next_mission` is
 * the number its next mission takes: numbers are never reused, whatever became of a mission.
 */
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    mainCheckout: text('main_checkout').notNull(),
    workspacesRoot: text('workspaces_root'),
    branchPrefix: text('branch_prefix'),
    keyPrefix: text('key_prefix'),
    nextMission: integer('next_mission').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  // An index rather than a column constraint: adding it leaves the table and its rows in place.
  (table) => [uniqueIndex('key_prefix_once').on(table.keyPrefix)],
)

/**
 * The repositories of a Project, each at a path relative to its main checkout, once per Project,
 * in the order they were added. `remote` is the remote its base is fetched from (null when it has
 * none) and `base_branch` the branch its work starts from and is delivered to. `last_fetched_at`
 * is the last fetch of that base that succeeded. A repository is part of its Project's record: an
 * edit of it takes the Project's version.
 */
export const projectRepositories = sqliteTable(
  'project_repositories',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    position: integer('position').notNull(),
    includedByDefault: integer('included_by_default', { mode: 'boolean' }).notNull(),
    remote: text('remote'),
    baseBranch: text('base_branch').notNull(),
    lastFetchedAt: text('last_fetched_at'),
  },
  (table) => [unique('repository_once_in_project').on(table.projectId, table.path)],
)

/**
 * The Workspaces: a Project's isolated folders, one worktree per chosen repository. `branch` is
 * the branch its worktrees were made on, or null for worktrees on a detached HEAD. A removed
 * Workspace's row goes with its folder; the journal keeps that it was.
 */
export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    folder: text('folder').notNull(),
    branch: text('branch'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique('workspace_name_once_in_project').on(table.projectId, table.name)],
)

/**
 * The worktrees of a Workspace, one per repository it took, as they were made: the repository's
 * path then, the worktree's folder, and the base it was made from. `base_ref` and
 * `base_freshness` (the JSON of the up-to-date base's freshness) are null for a worktree made at
 * a commit it was given.
 */
export const workspaceRepositories = sqliteTable(
  'workspace_repositories',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').notNull(),
    path: text('path').notNull(),
    worktree: text('worktree').notNull(),
    position: integer('position').notNull(),
    baseCommit: text('base_commit').notNull(),
    baseRef: text('base_ref'),
    baseFreshness: text('base_freshness'),
  },
  (table) => [unique('repository_once_in_workspace').on(table.workspaceId, table.repositoryId)],
)

/**
 * A Project's preparation recipe, in its order: a copy or a link of `path` under its repository
 * (null for the main checkout's root), or a run of a catalogue command or of a line of its own,
 * in `path` under its repository.
 */
export const projectPreparationSteps = sqliteTable('project_preparation_steps', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  kind: text('kind').notNull(),
  repositoryId: text('repository_id').references(() => projectRepositories.id, {
    onDelete: 'cascade',
  }),
  path: text('path'),
  commandId: text('command_id'),
  line: text('line'),
})

/**
 * The steps of a Workspace's preparation: its worktrees, then the recipe as it was when the
 * Workspace was made, each with its state written as it changes. `base` is the repository's path
 * a step applies under, null for the root; a failed step keeps what it did and the end of what
 * it printed.
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
    base: text('base'),
    path: text('path'),
    commandId: text('command_id'),
    line: text('line'),
    state: text('state').notNull(),
    failedDoing: text('failed_doing'),
    failedOutput: text('failed_output').$type<Masked<string>>(),
  },
  (table) => [unique('step_once_in_workspace').on(table.workspaceId, table.position)],
)

/**
 * The environment variables of a Project (`workspace_id` null) and of its Workspaces, set over
 * the Project's. A value is never written anywhere else: not in an event, not in the diagnostic.
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
  (table) => [index('variables_by_scope').on(table.projectId, table.workspaceId)],
)

/**
 * A Project's command catalogue: each command once by name, run in `folder` under its repository
 * (null for the main checkout's root, or the Workspace's). A line of its own for Windows or Linux
 * runs there instead of `line`. `scope` and the Portless fields mean something for a `serve`
 * only. The roles are flags; `write_globs` is the JSON of an array of globs relative to its folder.
 */
export const projectCommands = sqliteTable(
  'project_commands',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    line: text('line').notNull(),
    lineWindows: text('line_windows'),
    lineLinux: text('line_linux'),
    repositoryId: text('repository_id').references(() => projectRepositories.id, {
      onDelete: 'cascade',
    }),
    folder: text('folder'),
    scope: text('scope').notNull(),
    portless: integer('portless', { mode: 'boolean' }).notNull(),
    portlessName: text('portless_name'),
    check: integer('check', { mode: 'boolean' }).notNull(),
    atOpen: integer('at_open', { mode: 'boolean' }).notNull(),
    askBeforeRunning: integer('ask_before_running', { mode: 'boolean' }).notNull(),
    readOnly: integer('read_only', { mode: 'boolean' }).notNull(),
    writeGlobs: text('write_globs').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique('command_name_once_in_project').on(table.projectId, table.name)],
)

/**
 * The runs of a Project's commands and lines, in a Workspace or in the main checkout
 * (`workspace_id` null): who started it, the line as it ran, its folder, its state and exit, the
 * address it published, and the last of what it printed. `command_id` is kept as it was, even
 * once the command is removed from the catalogue. A free line keeps the line and the folder it
 * was asked with (`asked_line`, `asked_folder`, before its template names were filled), which is
 * what a restart runs again. `mission_id` is the mission it was started for, which a cancel stops.
 */
export const commandRuns = sqliteTable(
  'command_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    commandId: text('command_id'),
    name: text('name').notNull(),
    type: text('type').notNull(),
    line: text('line').notNull(),
    folder: text('folder').notNull(),
    askedLine: text('asked_line'),
    askedFolder: text('asked_folder'),
    startedBy: text('started_by').notNull(),
    sessionId: text('session_id'),
    missionId: text('mission_id'),
    state: text('state').notNull(),
    exitCode: integer('exit_code'),
    url: text('url'),
    portConflict: text('port_conflict'),
    output: text('output').$type<Masked<string>>().notNull(),
    dropped: integer('dropped').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
  },
  (table) => [index('runs_by_place').on(table.projectId, table.workspaceId, table.startedAt)],
)

/**
 * The root processes the supervisor started, while they run: the pid, the program and its
 * arguments (the JSON of an array), what owns it (a run, or later an agent's session), and the
 * engine that started it. A row left by an engine that stopped is a process to end at the next
 * start, if it is still there and still the same program.
 */
export const supervisedProcesses = sqliteTable('supervised_processes', {
  id: text('id').primaryKey(),
  pid: integer('pid').notNull(),
  program: text('program').notNull(),
  args: text('args').notNull(),
  ownerKind: text('owner_kind').notNull(),
  ownerId: text('owner_id').notNull(),
  engine: text('engine').notNull(),
  startedAt: text('started_at').notNull(),
})

/**
 * The missions: an identifier (a ULID) every internal reference uses, and a key given at creation
 * that never changes, made of the Project's prefix then and its number in that Project. The idea
 * it started from is a sentence, a ticket reference, or both; the remote ticket, when there is
 * one, is its provider, key and address. `round` is the number of the last review round, 0 before
 * the first. `cleanup` is null while there is nothing to clean up.
 */
export const missions = sqliteTable(
  'missions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    keyPrefix: text('key_prefix').notNull(),
    keyNumber: integer('key_number').notNull(),
    title: text('title').notNull(),
    ideaSentence: text('idea_sentence'),
    ideaTicket: text('idea_ticket'),
    type: text('type').notNull(),
    ticketProvider: text('ticket_provider'),
    ticketKey: text('ticket_key'),
    ticketUrl: text('ticket_url'),
    stage: text('stage').notNull(),
    round: integer('round').notNull(),
    cleanup: text('cleanup'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    unique('mission_key_once').on(table.keyPrefix, table.keyNumber),
    index('missions_by_project').on(table.projectId, table.keyNumber),
  ],
)

/**
 * The marks a mission carries, each once (`identity` says which one it is), as the JSON of its
 * `Mark`. "Needs you" is never stored: it is derived from the pending needs.
 */
export const missionMarks = sqliteTable(
  'mission_marks',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    identity: text('identity').notNull(),
    mark: text('mark').notNull(),
    setAt: text('set_at').notNull(),
  },
  (table) => [unique('mark_once_on_mission').on(table.missionId, table.identity)],
)

/**
 * The needs: whom each belongs to (the application, a Project, or a mission and optionally one of
 * its tasks), its kind's fields as the JSON of its `NeedFields`, who asked for it, and its life.
 * `answer` is the JSON of the answer once there is one, given under `answer_key`, the answer's
 * idempotency key; `ended_reason` says why it expired or was withdrawn.
 */
export const needs = sqliteTable(
  'needs',
  {
    id: text('id').primaryKey(),
    ownerKind: text('owner_kind').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    missionId: text('mission_id').references(() => missions.id, { onDelete: 'cascade' }),
    taskId: text('task_id'),
    kind: text('kind').notNull(),
    fields: text('fields').$type<Masked<string>>().notNull(),
    /** The engine service that owns it and is handed its answer. */
    service: text('service').notNull(),
    /** The role of the agent that asked for it, or null when Hemera did. */
    requestedBy: text('requested_by'),
    state: text('state').notNull(),
    answer: text('answer'),
    answerKey: text('answer_key'),
    endedReason: text('ended_reason'),
    createdAt: text('created_at').notNull(),
    endedAt: text('ended_at'),
  },
  (table) => [
    index('needs_by_state').on(table.state, table.createdAt),
    index('needs_by_mission').on(table.missionId, table.state),
  ],
)

/**
 * The answers not yet handed to the service that owns their need: written with the answer, in its
 * transaction, and marked delivered once the service has it. An engine that stopped in between
 * hands it over at its next start; nothing else ever answers a need.
 */
export const needDeliveries = sqliteTable('need_deliveries', {
  needId: text('need_id')
    .primaryKey()
    .references(() => needs.id, { onDelete: 'cascade' }),
  deliveredAt: text('delivered_at'),
})

/**
 * What a cancel has to stop for a mission, one row per stopper, written with the cancel and
 * removed once that stopper has stopped what it holds. A stopper that failed keeps its row and its
 * reason, and is tried again at the next start.
 */
export const missionStops = sqliteTable(
  'mission_stops',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    stopper: text('stopper').notNull(),
    failedReason: text('failed_reason'),
  },
  (table) => [unique('stop_once').on(table.missionId, table.stopper)],
)

/**
 * The agents' sessions: the agent, who owns the session (a mission or a Project) and in which
 * role, the folder it works in, the agent's own session id once it has one, and the options
 * Hemera chose for it (model, effort, mode) beside what the agent reported it took. What was
 * chosen is what every restart of the agent applies again.
 */
export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  ownerKind: text('owner_kind').notNull(),
  ownerId: text('owner_id').notNull(),
  role: text('role').notNull(),
  folder: text('folder').notNull(),
  nativeId: text('native_id'),
  chosenModel: text('chosen_model'),
  chosenEffort: text('chosen_effort'),
  chosenMode: text('chosen_mode'),
  takenModel: text('taken_model'),
  takenEffort: text('taken_effort'),
  takenMode: text('taken_mode'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/**
 * The actions with an effect outside the database (a file written, a command run, and later a
 * push, a forge call, a step of a delivery): the intent, written and committed before the effect
 * starts, then its outcome. `state` is `started` until the outcome is known, then `done` or
 * `failed`; an intent an engine that stopped left without an outcome is `indeterminate` until its
 * post-condition, when its kind has one, says what happened. `details` is the JSON of what the
 * action is (the post-condition reads it), masked; `outcome` says how it ended, masked.
 * `handled_at` is when the handler of an indeterminate action was called, once.
 */
export const effectfulActions = sqliteTable(
  'effectful_actions',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    ownerKind: text('owner_kind').notNull(),
    ownerId: text('owner_id').notNull(),
    taskId: text('task_id'),
    details: text('details').$type<Masked<string>>().notNull(),
    state: text('state').notNull(),
    outcome: text('outcome').$type<Masked<string>>(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    handledAt: text('handled_at'),
  },
  (table) => [index('actions_by_state').on(table.state, table.startedAt)],
)

/**
 * The calls of Hemera's MCP tools, one row per call (a retry under the same call key is the same
 * row): the session, its role and mission, the tool and its gate class, the verdict and who gave
 * it, the outcome, its reason (masked), and how long it took. Never a file's content.
 */
export const toolCalls = sqliteTable(
  'tool_calls',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    role: text('role').notNull(),
    projectId: text('project_id'),
    missionId: text('mission_id'),
    tool: text('tool').notNull(),
    gateClass: text('gate_class'),
    verdict: text('verdict'),
    verdictBy: text('verdict_by'),
    outcome: text('outcome').notNull(),
    reason: text('reason').$type<Masked<string>>(),
    callKey: text('call_key'),
    durationMs: integer('duration_ms').notNull(),
    calledAt: text('called_at').notNull(),
  },
  (table) => [index('calls_by_session').on(table.sessionId, table.calledAt)],
)

/**
 * The fingerprint (sha256 of the bytes) of the version of a file a session last read or wrote, by
 * the file's resolved path: a write is made only on that version. Kept with the session, across
 * restarts.
 */
export const sessionFiles = sqliteTable(
  'session_files',
  {
    sessionId: text('session_id').notNull(),
    path: text('path').notNull(),
    fingerprint: text('fingerprint').notNull(),
    recordedAt: text('recorded_at').notNull(),
  },
  (table) => [unique('file_once_in_session').on(table.sessionId, table.path)],
)
