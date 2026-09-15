#!/usr/bin/env bun
/**
 * Turns each migration SQL file into a TypeScript module.
 *
 * Drizzle's own reader walks a folder on disk, which a compiled binary does not have. An
 * ambient `*.sql` module would only be visible to the package that declares it, so the SQL
 * becomes plain TypeScript instead: every consumer sees it, and a packaged application
 * carries its migrations with it.
 *
 *   bun tools/migrations.ts --generate   rewrite the modules from the SQL files
 *   bun tools/migrations.ts              check the modules match their SQL
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface MigrationSource {
  name: string
  sqlPath: string
  modulePath: string
}

function migrationsDirectory(repositoryRoot: string): string {
  return join(repositoryRoot, 'packages', 'runtime', 'src', 'storage', 'migrations')
}

export function migrationSources(repositoryRoot: string): MigrationSource[] {
  const directory = migrationsDirectory(repositoryRoot)
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.sql'))
    .toSorted()
    .map((entry) => ({
      name: entry.replace(/\.sql$/, ''),
      sqlPath: join(directory, entry),
      modulePath: join(directory, `${entry.replace(/\.sql$/, '')}.sql.ts`),
    }))
}

/** The module a migration SQL file becomes. */
export function moduleOf(source: MigrationSource): string {
  const sql = readFileSync(source.sqlPath, 'utf8')
  const quoted = sql.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')
  return `/**
 * Generated from ${source.name}.sql by \`bun tools/migrations.ts --generate\`.
 *
 * Edit the SQL file, never this module.
 */

export const sql = \`${quoted}\`
`
}

export interface MigrationDrift {
  name: string
  problem: string
}

export function analyzeMigrations(repositoryRoot: string): MigrationDrift[] {
  const drift: MigrationDrift[] = []
  for (const source of migrationSources(repositoryRoot)) {
    if (!existsSync(source.modulePath)) {
      drift.push({ name: source.name, problem: 'has no generated module' })
      continue
    }
    if (readFileSync(source.modulePath, 'utf8') !== moduleOf(source)) {
      drift.push({ name: source.name, problem: 'no longer matches its SQL file' })
    }
  }
  return drift
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  if (process.argv.includes('--generate')) {
    for (const source of migrationSources(repositoryRoot)) {
      writeFileSync(source.modulePath, moduleOf(source))
    }
    console.log(`generated ${migrationSources(repositoryRoot).length} migration modules`)
  }

  const drift = analyzeMigrations(repositoryRoot)
  for (const entry of drift) console.error(`migration ${entry.name} ${entry.problem}`)
  console.log(
    drift.length === 0 ? 'migrations match their SQL' : `${drift.length} migration drifts`,
  )
  if (drift.length > 0) process.exit(1)
}
