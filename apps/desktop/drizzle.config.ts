/**
 * What `drizzle-kit generate` reads to produce a migration (design D3-05).
 *
 * The schema is the one file that describes the database, and `drizzle/` is where the
 * migrations it generates land — bundled with the application and read back at start-up, so a
 * package carries the migrations it knows how to apply and no others.
 *
 *   pnpm --filter @hemera/desktop exec drizzle-kit generate
 */

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/engine/storage/schema.ts',
  out: './drizzle',
})
