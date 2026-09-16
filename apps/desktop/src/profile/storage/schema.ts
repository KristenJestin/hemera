/**
 * The schema of the profile, in code, from which every migration is generated (design D3-04).
 *
 * It is never written by hand as SQL: `drizzle-kit generate` reads this file and produces the
 * migration, so a profile created today and a profile migrated up to today have the same schema
 * by construction rather than by care.
 *
 * Lot 3 gives it what the application knows about itself and nothing of the domain: the
 * Projects, the Sessions and the journal of events arrive in lot 4.
 */

import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
