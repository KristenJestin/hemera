/**
 * What `drizzle-kit generate` reads to produce a migration.
 *
 * The schema is the one file that describes the database, and `drizzle/` is where the migrations
 * it generates land: bundled with the application and read back at start, so a package carries
 * the migrations it knows how to apply and no others. A migration is generated, never written
 * by hand, and never edited once a build has applied it.
 *
 *   pnpm --filter @hemera/desktop exec drizzle-kit generate --name <what it brings>
 */

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/engine/storage/schema.ts',
  out: './drizzle',
})
