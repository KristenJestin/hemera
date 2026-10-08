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
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
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
    /** How many sub-agents run at once in this Project (CT-13), 1 to 6. */
    subAgentCap: integer('sub_agent_cap').notNull().default(3),
    /** The budget a new mission of this Project starts with (#41). */
    budgetLaunches: integer('budget_launches').notNull().default(8),
    budgetAttempts: integer('budget_attempts').notNull().default(30),
    budgetRounds: integer('budget_rounds').notNull().default(3),
    /** The language its Specs are written in, a BCP 47 tag (#85); copied into each new Spec. */
    specLanguage: text('spec_language').notNull().default('en'),
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
 * A Project's "never" list: the commands always refused to its agents, in the order they were
 * listed. `entry` is the JSON of a `NeverEntry`: a program with its leading arguments, or a
 * catalogue command by its id. Read live by every call, never copied into a mission.
 */
export const projectNeverEntries = sqliteTable(
  'project_never_entries',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    entry: text('entry').notNull(),
  },
  (table) => [index('never_by_project').on(table.projectId, table.position)],
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
 *
 * Starting from the Project's field (#84): `ticket_reference` is the ticket's canonical form, once
 * per Project; `search_text` is the key, title and idea, lower case without accents, written with
 * the mission; `origin_id` the mission it was started from; `idempotency_key` the key of the
 * user's choice that created it, so that a double click creates one mission.
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
    /** The mission's budget, copied from its Project at its creation, raised by the user. */
    budgetLaunches: integer('budget_launches'),
    budgetAttempts: integer('budget_attempts'),
    budgetRounds: integer('budget_rounds'),
    ticketKey: text('ticket_key'),
    ticketUrl: text('ticket_url'),
    ticketReference: text('ticket_reference'),
    searchText: text('search_text').notNull().default(''),
    originId: text('origin_id').references((): AnySQLiteColumn => missions.id, {
      onDelete: 'set null',
    }),
    idempotencyKey: text('idempotency_key'),
    /**
     * The Planner's triage answer (#85), when the input was not new work: its kind, what it points
     * to, why, and whether it still waits on the user (`pending`) or they kept the mission (`kept`).
     */
    triageKind: text('triage_kind'),
    triageRef: text('triage_ref').$type<Masked<string>>(),
    triageText: text('triage_text').$type<Masked<string>>(),
    triageState: text('triage_state'),
    triagedAt: text('triaged_at'),
    /** Whether a `delivered` triage answer rests on a living requirement still proposed (#93). */
    triageBasedOnProposed: integer('triage_based_on_proposed', { mode: 'boolean' })
      .notNull()
      .default(false),
    stage: text('stage').notNull(),
    round: integer('round').notNull(),
    cleanup: text('cleanup'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    unique('mission_key_once').on(table.keyPrefix, table.keyNumber),
    index('missions_by_project').on(table.projectId, table.keyNumber),
    uniqueIndex('mission_ticket_once').on(table.projectId, table.ticketReference),
    uniqueIndex('mission_choice_once').on(table.projectId, table.idempotencyKey),
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
export const agentSessions = sqliteTable(
  'agent_sessions',
  {
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
    /**
     * The role session's line: the same across the replacements of a session, so what was meant
     * for it reaches whichever session holds it. Null for a session opened before role sessions,
     * which is its own lineage.
     */
    lineage: text('lineage'),
    /** The session that started this one, for a child session (a helper, a Probe). */
    parentId: text('parent_id'),
    /** How far down the tree of its owner it stands: 0 for a session with no parent. */
    depth: integer('depth').notNull().default(0),
    /** Raised at each replacement of its lineage: a call carrying an older epoch is refused. */
    epoch: integer('epoch').notNull().default(0),
    /** `starting`, `working`, `idle`, `stuck`, `ended`, `replaced` or `failed`. */
    state: text('state').notNull().default('idle'),
    /** Why it stuck, ended, was replaced or failed, in words, masked. */
    stateReason: text('state_reason').$type<Masked<string>>(),
    endedAt: text('ended_at'),
    /** The level of the cascade its agent and model came from: app, Project or mission (#41). */
    modelLevel: text('model_level'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    // One live session per lineage at most: a second one is refused rather than run beside it.
    uniqueIndex('one_live_session_per_lineage')
      .on(table.lineage)
      .where(sql`${table.state} in ('starting', 'working', 'idle', 'stuck')`),
  ],
)

/**
 * What Hemera hands a role session, stored before it is sent so it survives a restart and reaches
 * a replacement: its owner (a mission or a Project), its target (a session's lineage, or a role of
 * the owner when none is named), its kind (the marker it travels under), its body, how urgent it
 * is, and where it stands. A delivery belongs to its owner and lineage, never to one session:
 * `sent_to` records the session that took it, once.
 */
export const sessionDeliveries = sqliteTable(
  'session_deliveries',
  {
    id: text('id').primaryKey(),
    ownerKind: text('owner_kind').notNull(),
    ownerId: text('owner_id').notNull(),
    targetLineage: text('target_lineage'),
    targetRole: text('target_role'),
    kind: text('kind').notNull(),
    body: text('body').$type<Masked<string>>().notNull(),
    urgency: text('urgency').notNull(),
    state: text('state').notNull(),
    createdAt: text('created_at').notNull(),
    sentAt: text('sent_at'),
    sentTo: text('sent_to'),
  },
  (table) => [
    index('deliveries_by_target').on(table.ownerKind, table.ownerId, table.state, table.createdAt),
  ],
)

/**
 * Who runs a piece of work (a task, later): the lineage, the session holding it now, and the
 * epoch it holds it at. Reassigning the work raises the epoch in the same transaction that names
 * the new session (CT-11), so two sessions never hold the same work.
 */
export const runnerLeases = sqliteTable('runner_leases', {
  workItem: text('work_item').primaryKey(),
  lineage: text('lineage').notNull(),
  sessionId: text('session_id').notNull(),
  epoch: integer('epoch').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/**
 * A session's hidden thread, for diagnosis only: what it was sent, what it said, the tools it
 * called and the notes it received, in order, masked. Diagnostic class: rotated with the rest.
 */
export const sessionThreads = sqliteTable(
  'session_threads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),
    at: text('at').notNull(),
    kind: text('kind').notNull(),
    text: text('text').$type<Masked<string>>().notNull(),
  },
  (table) => [index('threads_by_session').on(table.sessionId, table.id)],
)

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

/**
 * The requests of calls that asked the user (#37), one per call, with its permission need. It
 * belongs to its owner (a mission and its task, or a Project for the Chat), numbered per owner, and
 * keeps the whole call so that Hemera can act on it once the user answers, across restarts: the
 * tool, its arguments and the place it was called on (`call`, JSON), what the verdict saw
 * (`guard`, JSON) and the identity of the action (`identity`, JSON). The arguments are kept as the
 * agent sent them, since they are what runs; every text shown to someone is masked.
 *
 * `state` is `pending` until the answer, `allowed` until Hemera acts, `running` while it does, and
 * `ended` with its `result` and `result_text` (what the agent is handed). `handed_over_at` is when
 * the result reached the delivery.
 */
export const permissionRequests = sqliteTable(
  'permission_requests',
  {
    id: text('id').primaryKey(),
    ownerKind: text('owner_kind').notNull(),
    ownerId: text('owner_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    missionId: text('mission_id').references(() => missions.id, { onDelete: 'cascade' }),
    taskId: text('task_id'),
    number: integer('number').notNull(),
    /** The agent's own key of the call: the same key from the same owner is the same request. */
    callKey: text('call_key'),
    /** The session and role that asked, for the record only: the request is the owner's. */
    sessionId: text('session_id').notNull(),
    role: text('role').notNull(),
    tool: text('tool').notNull(),
    call: text('call').notNull(),
    guard: text('guard').notNull(),
    identity: text('identity').notNull(),
    described: text('described').$type<Masked<string>>().notNull(),
    hemeraReason: text('hemera_reason').$type<Masked<string>>().notNull(),
    agentReason: text('agent_reason').$type<Masked<string>>().notNull(),
    sensitive: integer('sensitive', { mode: 'boolean' }).notNull(),
    needId: text('need_id').notNull(),
    state: text('state').notNull(),
    choice: text('choice'),
    grantId: text('grant_id'),
    result: text('result'),
    resultText: text('result_text').$type<Masked<string>>(),
    createdAt: text('created_at').notNull(),
    answeredAt: text('answered_at'),
    endedAt: text('ended_at'),
    handedOverAt: text('handed_over_at'),
  },
  (table) => [
    unique('request_number_once').on(table.ownerKind, table.ownerId, table.number),
    unique('request_key_once').on(table.ownerKind, table.ownerId, table.callKey),
    index('requests_by_state').on(table.state),
    index('requests_by_need').on(table.needId),
  ],
)

/**
 * The "Allow for this mission" grants (CT-19): the action's identity (JSON) and the key it is
 * looked up by, the action in words (masked), who gave it and when, how many calls it allowed, and
 * its end: `live`, `revoked` by the user, or `fallen` when its identity moved, with the reason.
 */
export const missionGrants = sqliteTable(
  'mission_grants',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    identity: text('identity').notNull(),
    action: text('action').$type<Masked<string>>().notNull(),
    givenBy: text('given_by').notNull(),
    givenAt: text('given_at').notNull(),
    uses: integer('uses').notNull(),
    state: text('state').notNull(),
    endedReason: text('ended_reason'),
    endedAt: text('ended_at'),
  },
  (table) => [index('grants_by_mission').on(table.missionId, table.key, table.state)],
)

/**
 * The results of requests queued for their owner until the delivery into a session exists (#40),
 * which drains it: one row per request, so a result is queued once however often it is handed.
 */
export const queuedDeliveries = sqliteTable(
  'queued_deliveries',
  {
    requestId: text('request_id').primaryKey(),
    ownerKind: text('owner_kind').notNull(),
    ownerId: text('owner_id').notNull(),
    taskId: text('task_id'),
    number: integer('number').notNull(),
    text: text('text').$type<Masked<string>>().notNull(),
    queuedAt: text('queued_at').notNull(),
  },
  (table) => [index('queued_by_owner').on(table.ownerKind, table.ownerId, table.queuedAt)],
)

/**
 * Where each projection of the domain events stands: the sequence of the last event it projected,
 * written in the same transaction as what it projected, so a projection that stops in between
 * starts again from there and never projects an event twice.
 */
export const projectionCursors = sqliteTable('projection_cursors', {
  name: text('name').primaryKey(),
  cursor: integer('cursor').notNull(),
})

/**
 * A mission's Journal: one line per domain event its mapper turns into a line, keyed by that
 * event's sequence, so the same event never makes two lines. Who wrote it is `hemera`, `user` or
 * `agent` (then its role and session); `fields` is a flat JSON object and `refs` the JSON of what it
 * names (a need, a task, a run, an evidence file, a session). Text and fields are masked.
 */
export const memoryJournal = sqliteTable(
  'memory_journal',
  {
    sequence: integer('sequence').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    at: text('at').notNull(),
    kind: text('kind').notNull(),
    authorKind: text('author_kind').notNull(),
    authorRole: text('author_role'),
    authorSession: text('author_session'),
    text: text('text').$type<Masked<string>>().notNull(),
    fields: text('fields').$type<Masked<string>>().notNull(),
    refs: text('refs').notNull(),
  },
  (table) => [index('journal_by_mission').on(table.missionId, table.sequence)],
)

/**
 * The "doing" lines of Now, one per live session working on a mission, each written by its session
 * alone at the epoch it held then, and removed when the session stops.
 */
export const memoryNowLines = sqliteTable(
  'memory_now_lines',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    role: text('role').notNull(),
    epoch: integer('epoch').notNull(),
    doing: text('doing').$type<Masked<string>>().notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [unique('now_line_once').on(table.missionId, table.sessionId)],
)

/** The next step of a mission, written by its stage's main session. */
export const memoryNext = sqliteTable('memory_next', {
  missionId: text('mission_id')
    .primaryKey()
    .references(() => missions.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  epoch: integer('epoch').notNull(),
  text: text('text').$type<Masked<string>>().notNull(),
  updatedAt: text('updated_at').notNull(),
})

/**
 * A mission's Notes, numbered in the mission. A condensed note keeps its row and the number of the
 * note that replaced it.
 */
export const memoryNotes = sqliteTable(
  'memory_notes',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    text: text('text').$type<Masked<string>>().notNull(),
    topic: text('topic').$type<Masked<string>>(),
    authorKind: text('author_kind').notNull(),
    authorRole: text('author_role'),
    authorSession: text('author_session'),
    replacedBy: integer('replaced_by'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique('note_number_once').on(table.missionId, table.number)],
)

/**
 * A mission's evidence, one row per reference: the file is `missions/<key>/evidence/<sha256>.<ext>`,
 * once per content, however many references it has. `about` is what it is evidence of, an opaque
 * reference other tickets fill.
 */
export const memoryEvidence = sqliteTable(
  'memory_evidence',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    mediaType: text('media_type').notNull(),
    name: text('name').$type<Masked<string>>().notNull(),
    about: text('about'),
    authorKind: text('author_kind').notNull(),
    authorRole: text('author_role'),
    authorSession: text('author_session'),
    addedAt: text('added_at').notNull(),
  },
  (table) => [index('evidence_by_mission').on(table.missionId, table.addedAt)],
)

/**
 * A role's agent, model and effort at one level of the cascade (#41): the app (scope ''), a
 * Project (its id) or a mission (its id). A level that is not set has no row: it inherits, and a
 * default is never stored as a copy of the level above.
 */
export const roleModels = sqliteTable(
  'role_models',
  {
    level: text('level').notNull(),
    scopeId: text('scope_id').notNull(),
    role: text('role').notNull(),
    agent: text('agent').notNull(),
    model: text('model'),
    effort: text('effort'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.level, table.scopeId, table.role] })],
)

/** The user's favourite and hidden models, per agent, which the model picker reads. */
export const modelMarks = sqliteTable(
  'model_marks',
  {
    agent: text('agent').notNull(),
    model: text('model').notNull(),
    favourite: integer('favourite', { mode: 'boolean' }).notNull(),
    hidden: integer('hidden', { mode: 'boolean' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.agent, table.model] })],
)

/** What a mission has spent of each counter of its budget. */
export const missionSpent = sqliteTable(
  'mission_spent',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    counter: text('counter').notNull(),
    spent: integer('spent').notNull(),
  },
  (table) => [primaryKey({ columns: [table.missionId, table.counter] })],
)

/** The business attempts of a task, whoever ran them (CT-14). */
export const taskAttempts = sqliteTable('task_attempts', {
  taskId: text('task_id').primaryKey(),
  missionId: text('mission_id'),
  count: integer('count').notNull(),
})

/**
 * What a session's agent reported it used, or an estimate when it reported nothing: tokens in and
 * out, the cost when given, and whether it was measured.
 */
export const sessionUsage = sqliteTable('session_usage', {
  sessionId: text('session_id').primaryKey(),
  ownerKind: text('owner_kind').notNull(),
  ownerId: text('owner_id').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costAmount: real('cost_amount'),
  costCurrency: text('cost_currency'),
  measured: integer('measured', { mode: 'boolean' }).notNull(),
})

/** Which session a need about a session stands for: what its Retry starts again. */
export const sessionNeeds = sqliteTable('session_needs', {
  needId: text('need_id').primaryKey(),
  sessionId: text('session_id').notNull(),
  /** `start` (the model or the agent), `failing` (CT-14), `limit` (a provider's quota). */
  reason: text('reason').notNull(),
  /** The agent and model it was about, to see at a Retry whether the setting changed. */
  agent: text('agent').notNull(),
  model: text('model'),
})

/**
 * The Chats of a Project (#43): free conversations with an agent beside its missions. Each keeps
 * its own agent, model and effort (the cascade's for the `chat` role when it was made), and the
 * lineage its sessions run on, null before its first message.
 */
export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Set once the user renamed it: its first message no longer names it. */
    renamed: integer('renamed', { mode: 'boolean' }).notNull(),
    agent: text('agent').notNull(),
    model: text('model'),
    effort: text('effort'),
    lineage: text('lineage'),
    createdAt: text('created_at').notNull(),
    lastActivityAt: text('last_activity_at').notNull(),
  },
  (table) => [index('chats_by_project').on(table.projectId, table.lastActivityAt)],
)

/**
 * A Chat's transcript, in order: the user's messages, the agent's, each of its tool calls folded
 * to one line (with its outcome and, when it was held, the approval request), and Hemera's own
 * notices. Masked; permanent until the Chat is deleted.
 */
export const chatEntries = sqliteTable(
  'chat_entries',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    text: text('text').$type<Masked<string>>().notNull(),
    /** For an action: the tool, and how it ended (`completed`, `failed`, `held`). */
    tool: text('tool'),
    outcome: text('outcome'),
    /** For an action held for the user: the approval request's number. */
    request: integer('request'),
    at: text('at').notNull(),
  },
  (table) => [index('chat_entries_by_chat').on(table.chatId, table.sequence)],
)

/**
 * The setup agent's proposals (#44): one card per change, the changes of one call one batch, in
 * the order proposed. A card is decided once; a refusal at the click keeps it pending with the
 * use case's reason. A variable's value is never here: the engine holds it in memory only.
 */
export const setupCards = sqliteTable(
  'setup_cards',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    batch: text('batch').notNull(),
    position: integer('position').notNull(),
    /** The change, as `SetupChange` writes it: never a value. */
    change: text('change').notNull(),
    title: text('title').notNull(),
    /** Its details, as their lines, in JSON. */
    details: text('details').notNull(),
    state: text('state').notNull(),
    /** Why the last click was refused, by the use case, masked; null otherwise. */
    refusal: text('refusal').$type<Masked<string>>(),
    createdAt: text('created_at').notNull(),
    decidedAt: text('decided_at'),
  },
  (table) => [index('setup_cards_by_project').on(table.projectId, table.createdAt, table.position)],
)

/**
 * A mission's Spec (#85), one per mission: its version, bumped by every write; its language, copied
 * from its Project's when the mission was created; the version last declared complete; whether it
 * is frozen (#92); the next number its requirements take, never reused; and whether the Planner set
 * the mission's title and type.
 */
export const specs = sqliteTable('specs', {
  missionId: text('mission_id')
    .primaryKey()
    .references(() => missions.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(0),
  language: text('language').notNull(),
  declaredCompleteVersion: integer('declared_complete_version'),
  frozen: integer('frozen', { mode: 'boolean' }).notNull().default(false),
  frozenAt: text('frozen_at'),
  nextRequirement: integer('next_requirement').notNull().default(1),
  describedAt: text('described_at'),
  updatedAt: text('updated_at').notNull(),
  /** The version of the task graph (#90), what `tasks_write` names as its base; 0 until written. */
  tasksVersion: integer('tasks_version').notNull().default(0),
})

/** A prose section of a Spec, once written: its Markdown, its own version, who wrote it, when. */
export const specSections = sqliteTable(
  'spec_sections',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    body: text('body').$type<Masked<string>>().notNull(),
    version: integer('version').notNull(),
    sessionId: text('session_id').notNull(),
    writtenAt: text('written_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.missionId, table.name] })],
)

/**
 * A requirement of a Spec: `R1`, `R2`… in the order written, never reused; a delta against the
 * living spec's domain, the living requirement it changes and its version then (#93 checks both);
 * its own version; removed or not; and the next number its scenarios take.
 */
export const specRequirements = sqliteTable(
  'spec_requirements',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    rank: integer('rank').notNull(),
    domain: text('domain').$type<Masked<string>>().notNull(),
    delta: text('delta').notNull(),
    livingRef: text('living_ref').$type<Masked<string>>(),
    livingVersion: integer('living_version'),
    text: text('text').$type<Masked<string>>().notNull(),
    version: integer('version').notNull(),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
    nextScenario: integer('next_scenario').notNull().default(1),
    sessionId: text('session_id').notNull(),
    writtenAt: text('written_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.missionId, table.id] })],
)

/**
 * A scenario of a requirement: `R1.S1`… never reused; WHEN and THEN; its rank and version. A
 * scenario left out of a write is kept, removed. Its Proof block is #90's.
 */
export const specScenarios = sqliteTable(
  'spec_scenarios',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    requirementId: text('requirement_id').notNull(),
    id: text('id').notNull(),
    whenText: text('when_text').$type<Masked<string>>().notNull(),
    thenText: text('then_text').$type<Masked<string>>().notNull(),
    rank: integer('rank').notNull(),
    version: integer('version').notNull(),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.missionId, table.id] })],
)

/**
 * One row per item a write changed: the Spec version it made, the item (a section's name, a
 * requirement's or a scenario's id), its text before and after (null for none), the session.
 */
export const specChanges = sqliteTable(
  'spec_changes',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    item: text('item').notNull(),
    before: text('before').$type<Masked<string>>(),
    after: text('after').$type<Masked<string>>(),
    sessionId: text('session_id').notNull(),
    at: text('at').notNull(),
  },
  (table) => [index('spec_changes_by_mission').on(table.missionId, table.version)],
)

/** The Spec version the user last marked read. */
export const specReads = sqliteTable('spec_reads', {
  missionId: text('mission_id')
    .primaryKey()
    .references(() => missions.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  readAt: text('read_at').notNull(),
})

/** The user's vision of a mission, given at any time in Planning, delivered to the Planner. */
export const specVisions = sqliteTable(
  'spec_visions',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    text: text('text').$type<Masked<string>>().notNull(),
    at: text('at').notNull(),
  },
  (table) => [index('spec_visions_by_mission').on(table.missionId, table.at)],
)

/**
 * A domain of a Project's living spec (#93): its name as a user would say it (unique among the
 * Project's domains that are not removed), a summary, what the agent was not sure of, and its
 * state: `proposed` until the user validates it, again `proposed` while a re-run's proposals wait.
 * A rejected domain is kept, removed, so its requirements' history stays readable.
 */
export const livingDomains = sqliteTable(
  'living_domains',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    name: text('name').$type<Masked<string>>().notNull(),
    summary: text('summary').$type<Masked<string>>().notNull(),
    uncertainty: text('uncertainty').$type<Masked<string>>().notNull(),
    state: text('state').notNull(),
    validatedAt: text('validated_at'),
    removedAt: text('removed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('living_domains_by_project').on(table.projectId, table.rank)],
)

/**
 * A requirement of a living spec: `LR1`, `LR2`… from `seq`, never reused (a removed one is kept);
 * its text and scenarios (JSON `[{when, then}]`); its origin (no mission for the bootstrap, or the
 * mission and its round, whose key is read from the mission); its state; what the agent was not
 * sure of; its version, from 1, bumped by each change of text, scenarios or removal; and the change
 * a re-run of its domain proposes on it (`replace` or `obsolete`) with the version it was proposed
 * on, applied only at validation, and only on that version.
 */
export const livingRequirements = sqliteTable(
  'living_requirements',
  {
    id: text('id').primaryKey(),
    seq: integer('seq').notNull().unique(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    domainId: text('domain_id')
      .notNull()
      .references(() => livingDomains.id, { onDelete: 'cascade' }),
    text: text('text').$type<Masked<string>>().notNull(),
    scenarios: text('scenarios').$type<Masked<string>>().notNull(),
    originMissionId: text('origin_mission_id'),
    originRound: integer('origin_round'),
    state: text('state').notNull(),
    uncertainty: text('uncertainty').$type<Masked<string>>().notNull(),
    version: integer('version').notNull(),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
    pendingKind: text('pending_kind'),
    pendingVersion: integer('pending_version'),
    pendingText: text('pending_text').$type<Masked<string>>(),
    pendingScenarios: text('pending_scenarios').$type<Masked<string>>(),
    pendingUncertainty: text('pending_uncertainty').$type<Masked<string>>(),
    pendingReason: text('pending_reason').$type<Masked<string>>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('living_requirements_by_domain').on(table.domainId, table.seq)],
)

/**
 * One row per change of a living requirement: what happened, its version before (null when it was
 * proposed) and after, its text and scenarios before and after, who (`bootstrap`, a mission and
 * its round, or `user`), and when.
 */
export const livingHistory = sqliteTable(
  'living_history',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    requirementId: text('requirement_id')
      .notNull()
      .references(() => livingRequirements.id, { onDelete: 'cascade' }),
    what: text('what').notNull(),
    versionBefore: integer('version_before'),
    versionAfter: integer('version_after').notNull(),
    textBefore: text('text_before').$type<Masked<string>>(),
    textAfter: text('text_after').$type<Masked<string>>(),
    scenariosBefore: text('scenarios_before').$type<Masked<string>>(),
    scenariosAfter: text('scenarios_after').$type<Masked<string>>(),
    /** Why it was removed, for a removal. */
    reason: text('reason').$type<Masked<string>>(),
    byKind: text('by_kind').notNull(),
    byMissionId: text('by_mission_id'),
    byRound: integer('by_round'),
    at: text('at').notNull(),
  },
  (table) => [index('living_history_by_requirement').on(table.requirementId, table.sequence)],
)

/**
 * A bootstrap run of a living spec: its Project, its domain on a run on one domain (null for all),
 * the session lineage that reads, its state as written (`running` until it ends; whether it waits
 * for a slot is the cap's to say), why it ended, the commit of each repository's main checkout
 * when it started (JSON `[{repository, commit}]`) and its summary once done.
 */
export const livingRuns = sqliteTable(
  'living_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    domainId: text('domain_id').references(() => livingDomains.id, { onDelete: 'set null' }),
    lineage: text('lineage').notNull().unique(),
    state: text('state').notNull(),
    stateReason: text('state_reason'),
    commits: text('commits').notNull(),
    summary: text('summary').$type<Masked<string>>(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
  },
  (table) => [index('living_runs_by_project').on(table.projectId, table.startedAt)],
)

/**
 * A Project's exclusive resources (#88): what several of its Workspaces share and only one mission
 * at a time may use (a shared development database, a fixed port, a test device). `key` is its
 * name trimmed and case-folded, its identity on the whole machine: two Projects declaring the same
 * key share one reservation. Its reset command brings it back to the state a mission expects.
 */
export const exclusiveResources = sqliteTable(
  'exclusive_resources',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description').notNull(),
    resetCommandId: text('reset_command_id').references(() => projectCommands.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    unique('resource_once_in_project').on(table.projectId, table.key),
    index('resources_by_key').on(table.key),
  ],
)

/**
 * The catalogue commands declared on an exclusive resource, each once: `use` runs on it, `change`
 * changes it (a migration, a seed, its reset), which an agent is always asked about.
 */
export const exclusiveResourceCommands = sqliteTable(
  'exclusive_resource_commands',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => exclusiveResources.id, { onDelete: 'cascade' }),
    commandId: text('command_id')
      .notNull()
      .references(() => projectCommands.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.resourceId, table.commandId] }),
    index('resource_commands_by_command').on(table.commandId),
  ],
)

/**
 * The reservations of the machine's exclusive resources and their queues, by `key`: one mission
 * holds a resource (`state` held, at most one per key), the others wait in the order their rows
 * were written. `lasts` says whether it is held for the mission's Building or only for its runs.
 * `readiness` is where the taking of a held one stands (`take`, `resetting`, `failed`, `unsure`,
 * `confirm`, `retry`, `ready`), with the reset's intent and the need it waits on. `blocked_by` is
 * the holder's key the waiting mission's mark names. `name` is as the mission's Project wrote it.
 * `round` is the mission's round when a Building's reservation was taken: a later one is another
 * Building.
 */
export const resourceClaims = sqliteTable(
  'resource_claims',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    lasts: text('lasts').notNull(),
    round: integer('round'),
    state: text('state').notNull(),
    readiness: text('readiness'),
    actionId: text('action_id'),
    needId: text('need_id'),
    blockedBy: text('blocked_by'),
    requestedAt: text('requested_at').notNull(),
    acquiredAt: text('acquired_at'),
  },
  (table) => [
    unique('claim_once_per_mission').on(table.key, table.missionId),
    uniqueIndex('one_holder_per_resource')
      .on(table.key)
      .where(sql`${table.state} = 'held'`),
  ],
)

/** A wave of the Planner's questions (#86): its number in the mission, when, by which session. */
export const waves = sqliteTable(
  'waves',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    sessionId: text('session_id').notNull(),
    askedAt: text('asked_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.missionId, table.number] })],
)

/**
 * A question of the Planner: `Q1`, `Q2`… per mission, never reused; its wave, its text and why,
 * its options as JSON (`[{ id, label, detail }]`), the option it recommends and why, the Spec item
 * it concerns, the finding it comes from, the question it replaces and the one that replaced it;
 * its state (`open`, `waiting`, `answered`, `withdrawn`, `replaced`, `moot`), the user's note
 * while it waits on someone, and the reason or the decision that retired it.
 */
export const questions = sqliteTable(
  'questions',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    number: integer('number').notNull(),
    wave: integer('wave').notNull(),
    text: text('text').$type<Masked<string>>().notNull(),
    why: text('why').$type<Masked<string>>().notNull(),
    options: text('options').$type<Masked<string>>().notNull(),
    recommended: text('recommended').notNull(),
    recommendedReason: text('recommended_reason').$type<Masked<string>>().notNull(),
    section: text('section'),
    fromFinding: text('from_finding'),
    replaces: text('replaces'),
    replacedBy: text('replaced_by'),
    state: text('state').notNull(),
    waitingNote: text('waiting_note').$type<Masked<string>>(),
    retiredReason: text('retired_reason').$type<Masked<string>>(),
    mootDecision: text('moot_decision').$type<Masked<string>>(),
    askedAt: text('asked_at').notNull(),
    changedAt: text('changed_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.missionId, table.id] }),
    index('questions_by_state').on(table.state, table.missionId),
  ],
)

/**
 * An answer to a question, one row per version (1, 2…): exactly one of an option id and a text
 * of the user's own, its author and when. A changed answer is a new version; nothing is
 * overwritten.
 */
export const answers = sqliteTable(
  'answers',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    version: integer('version').notNull(),
    optionId: text('option_id'),
    text: text('text').$type<Masked<string>>(),
    author: text('author').notNull(),
    at: text('at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.missionId, table.questionId, table.version] })],
)

/** A message the Planner drafted for a question that waits on someone: never sent by Hemera. */
export const questionDrafts = sqliteTable(
  'question_drafts',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    text: text('text').$type<Masked<string>>().notNull(),
    sessionId: text('session_id').notNull(),
    at: text('at').notNull(),
  },
  (table) => [index('question_drafts_by_question').on(table.missionId, table.questionId)],
)

/**
 * The human inputs of Planning (CT-26): `I1`, `I2`… per mission; their kind (`answer`, `waiting`,
 * `vision`, `discuss_decision`, `dismissed_finding`, `triage_kept`), the item they refer to and
 * its version, what the Planner is told of them; their state (`received` → `delivered` →
 * `integrated`, or `superseded` by a later version), the session delivery that carries them, and
 * where the Planner integrated them.
 */
export const planningInputs = sqliteTable(
  'planning_inputs',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    number: integer('number').notNull(),
    kind: text('kind').notNull(),
    item: text('item').notNull(),
    itemVersion: integer('item_version'),
    said: text('said').$type<Masked<string>>().notNull(),
    state: text('state').notNull(),
    receivedAt: text('received_at').notNull(),
    deliveryId: text('delivery_id'),
    deliveredAt: text('delivered_at'),
    integratedAt: text('integrated_at'),
    where: text('where').$type<Masked<string>>(),
    supersededBy: text('superseded_by'),
  },
  (table) => [
    primaryKey({ columns: [table.missionId, table.id] }),
    index('planning_inputs_by_state').on(table.missionId, table.state),
  ],
)

/**
 * The Probes of Planning (#89): a sub-agent the Planner launched to answer one question by running
 * things, in a worktree of its own under `probes/<mission key>/<number>/` of the data folder, kept
 * until the mission leaves Planning. `number` is its `#n` in its mission. `bases` is the JSON of
 * the commit each repository's worktree was made from, with its ref and freshness. `prepared` is
 * the JSON of what its preparation left against those commits (repository, path, sha256), taken
 * once before its session first opens, so its capture leaves it out. `lineage` is
 * its session's lineage, whose slot of the cap was taken at its launch; `parent_lineage` the
 * Planner's. `reminded` says it was told once to end with its report. `report` is the JSON of its
 * report, masked. `wipe_attempts` and `wipe_error` follow a wipe that has not succeeded yet.
 */
export const probes = sqliteTable(
  'probes',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    scenario: text('scenario'),
    question: text('question').$type<Masked<string>>().notNull(),
    brief: text('brief').$type<Masked<string>>().notNull(),
    state: text('state').notNull(),
    stuck: integer('stuck', { mode: 'boolean' }).notNull(),
    folder: text('folder').notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    bases: text('bases'),
    prepared: text('prepared'),
    lineage: text('lineage').notNull(),
    parentLineage: text('parent_lineage').notNull(),
    reminded: integer('reminded', { mode: 'boolean' }).notNull(),
    outcome: text('outcome'),
    answer: text('answer').$type<Masked<string>>(),
    report: text('report').$type<Masked<string>>(),
    failure: text('failure').$type<Masked<string>>(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    wipeAttempts: integer('wipe_attempts').notNull(),
    wipeError: text('wipe_error').$type<Masked<string>>(),
  },
  (table) => [
    unique('probe_number_in_mission').on(table.missionId, table.number),
    uniqueIndex('probe_of_lineage').on(table.lineage),
  ],
)

/**
 * What a Probe left in its worktree, captured at its report: each created or modified file not
 * ignored, by repository and path, with its sha256, and for a modified one its patch against the
 * Probe's commit. `withheld` says why its content was not kept (a sensitive place, a binary file).
 */
export const probeFiles = sqliteTable(
  'probe_files',
  {
    probeId: text('probe_id')
      .notNull()
      .references(() => probes.id, { onDelete: 'cascade' }),
    repository: text('repository').notNull(),
    path: text('path').notNull(),
    status: text('status').notNull(),
    sha256: text('sha256').notNull(),
    patch: text('patch').$type<Masked<string>>(),
    withheld: text('withheld'),
  },
  (table) => [primaryKey({ columns: [table.probeId, table.repository, table.path] })],
)

/** The contents the Probes captured, masked, once each by the sha256 of the file. */
export const probeContents = sqliteTable('probe_contents', {
  sha256: text('sha256').primaryKey(),
  content: text('content').$type<Masked<string>>().notNull(),
})

/**
 * The Proof block of a scenario (#90), kept with it by (mission, scenario id): the JSON of the
 * block, masked, its support files' contents within; its own version, what `proof_write` names as
 * its base; the Probe it comes from, by its `#n` in the mission; who wrote it and when.
 */
export const specProofs = sqliteTable(
  'spec_proofs',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    scenarioId: text('scenario_id').notNull(),
    version: integer('version').notNull(),
    block: text('block').$type<Masked<string>>().notNull(),
    fromProbe: text('from_probe'),
    sessionId: text('session_id').notNull(),
    writtenAt: text('written_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.missionId, table.scenarioId] })],
)

/**
 * The task graph of a Spec (#90): `T1`, `T2`… per mission, never reused, a task left out of a
 * write kept as a row marked removed. `requirements`, `scenarios`, `targets` and `depends_on` are
 * JSON arrays; `rank` is its place in the last write.
 */
export const specTasks = sqliteTable(
  'spec_tasks',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    number: integer('number').notNull(),
    rank: integer('rank').notNull(),
    title: text('title').$type<Masked<string>>().notNull(),
    result: text('result').$type<Masked<string>>().notNull(),
    requirements: text('requirements').notNull(),
    scenarios: text('scenarios').notNull(),
    targets: text('targets').$type<Masked<string>>().notNull(),
    dependsOn: text('depends_on').notNull(),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
    sessionId: text('session_id').notNull(),
    writtenAt: text('written_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.missionId, table.id] })],
)

/**
 * The Planner's recommended setting for a mission's Building (#90), with its reason. `checked`
 * says whether the model and the effort were found among what the agent offers; the pre-launch
 * check reads it, and the user may change it there.
 */
export const missionRecommendations = sqliteTable('mission_recommendations', {
  missionId: text('mission_id')
    .primaryKey()
    .references(() => missions.id, { onDelete: 'cascade' }),
  agent: text('agent').notNull(),
  model: text('model').notNull(),
  effort: text('effort'),
  reason: text('reason').$type<Masked<string>>().notNull(),
  checked: integer('checked', { mode: 'boolean' }).notNull(),
  sessionId: text('session_id').notNull(),
  at: text('at').notNull(),
})

/**
 * A Discuss conversation of Planning (#87): the user and the Planner on one item of a mission's
 * Spec (`question`, `section`, `requirement`, `scenario` or `decision`, named by its id), numbered
 * `#1`, `#2`… per mission. Open, then closed by the user on a decision or without one; the agent's
 * pending proposal (a decision in transit) is kept until replaced or closed. At most one open
 * discussion per item.
 */
export const discussions = sqliteTable(
  'discussions',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    itemKind: text('item_kind').notNull(),
    itemId: text('item_id').notNull(),
    state: text('state').notNull(),
    outcome: text('outcome'),
    decision: text('decision').$type<Masked<string>>(),
    proposal: text('proposal').$type<Masked<string>>(),
    proposedAt: text('proposed_at'),
    closedBy: text('closed_by'),
    closedAt: text('closed_at'),
    openedAt: text('opened_at').notNull(),
  },
  (table) => [
    uniqueIndex('discussion_number_once').on(table.missionId, table.number),
    uniqueIndex('one_open_discussion_per_item')
      .on(table.missionId, table.itemKind, table.itemId)
      .where(sql`${table.state} = 'open'`),
  ],
)

/**
 * A message of a discussion, by the user or the agent, a proposal marked; append-only. A user's
 * message names the session delivery that carries it to the Planner, stored with it.
 */
export const discussionMessages = sqliteTable(
  'discussion_messages',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    discussionId: text('discussion_id')
      .notNull()
      .references(() => discussions.id, { onDelete: 'cascade' }),
    author: text('author').notNull(),
    text: text('text').$type<Masked<string>>().notNull(),
    proposal: integer('proposal', { mode: 'boolean' }).notNull().default(false),
    at: text('at').notNull(),
    deliveryId: text('delivery_id'),
  },
  (table) => [index('discussion_messages_by_discussion').on(table.discussionId, table.sequence)],
)
