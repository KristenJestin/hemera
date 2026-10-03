/**
 * The schema of the data folder's database, in code, from which every migration is generated.
 *
 * It is never written as SQL by hand: `drizzle-kit generate` reads this file and produces the
 * migration, so a database created today and one migrated up to today have the same schema by
 * construction. Hemera 1.0 starts this schema afresh: nothing of the 0.x model is here.
 *
 * Two conventions run through it. An identifier is a `crypto.randomUUID()` in a text column, and
 * a date is an ISO string: a text date sorts and reads as itself.
 */

import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

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
 */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mainCheckout: text('main_checkout').notNull(),
  workspacesRoot: text('workspaces_root'),
  branchPrefix: text('branch_prefix'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
})

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
