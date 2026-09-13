import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BUSY_TIMEOUT_MS,
  DATABASE_FILE,
  MIGRATIONS,
  MigrationChecksumError,
  MigrationFailedError,
  SchemaAheadError,
  checksumOf,
  migrate,
  openProfile,
  statementsOf,
} from '../src/index.ts'
import type { Migration } from '../src/index.ts'

const NOW = 1_789_000_000_000

/** A throwaway profile directory; never the real one. */
function temporaryProfile(): string {
  return mkdtempSync(join(tmpdir(), 'hemera-profile-'))
}

function withProfile(body: (directory: string) => void): void {
  const directory = temporaryProfile()
  try {
    body(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const TABLES = [
  'projects',
  'project_repositories',
  'workspaces',
  'sessions',
  'session_entries',
  'domain_events',
  'app_preferences',
]

function tablesOf(database: Database): string[] {
  return (
    database.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string
    }[]
  ).map((row) => row.name)
}

describe('Ouverture de la base du profil', () => {
  test('the database is created where the profile is, with every table of the lot', () => {
    withProfile((directory) => {
      const profile = openProfile({ directory, now: NOW })
      try {
        expect(existsSync(join(directory, DATABASE_FILE))).toBe(true)
        expect(profile.path).toBe(join(directory, DATABASE_FILE))
        for (const table of TABLES) expect(tablesOf(profile.database)).toContain(table)
      } finally {
        profile.database.close()
      }
    })
  })

  test('foreign keys, write-ahead logging and a bounded wait are really on', () => {
    withProfile((directory) => {
      const profile = openProfile({ directory, now: NOW })
      try {
        expect(profile.database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
        expect(profile.database.query('PRAGMA journal_mode').get()).toEqual({
          journal_mode: 'wal',
        })
        expect(profile.database.query('PRAGMA busy_timeout').get()).toEqual({
          timeout: BUSY_TIMEOUT_MS,
        })
      } finally {
        profile.database.close()
      }
    })
  })

  test('a foreign key that names nothing is refused', () => {
    withProfile((directory) => {
      const profile = openProfile({ directory, now: NOW })
      try {
        expect(() =>
          profile.database.run(
            'INSERT INTO workspaces (id, project_id, name, path, created_at) VALUES (?, ?, ?, ?, ?)',
            ['w1', 'nowhere', 'main', '/tmp/x', NOW],
          ),
        ).toThrow(/FOREIGN KEY/i)
      } finally {
        profile.database.close()
      }
    })
  })

  test('the database reopens after a restart with its tables and its pragmas', () => {
    withProfile((directory) => {
      openProfile({ directory, now: NOW }).database.close()
      const reopened = openProfile({ directory, now: NOW + 1 })
      try {
        expect(reopened.migrations.applied).toEqual([])
        expect(reopened.migrations.alreadyApplied).toEqual(['0001-lot-1'])
        expect(tablesOf(reopened.database)).toContain('sessions')
      } finally {
        reopened.database.close()
      }
    })
  })
})

describe('Migration déjà appliquée', () => {
  test('a migration already applied is never replayed', () => {
    withProfile((directory) => {
      const first = openProfile({ directory, now: NOW })
      expect(first.migrations.applied).toEqual(['0001-lot-1'])
      first.database.close()

      const second = openProfile({ directory, now: NOW + 1 })
      try {
        expect(second.migrations.applied).toEqual([])
      } finally {
        second.database.close()
      }
    })
  })

  test('a fingerprint that no longer matches is reported instead of ignored', () => {
    withProfile((directory) => {
      const profile = openProfile({ directory, now: NOW })
      try {
        const tampered: Migration[] = [{ name: '0001-lot-1', sql: 'SELECT 1;' }]
        expect(() => migrate(profile.database, NOW, tampered)).toThrow(MigrationChecksumError)
      } finally {
        profile.database.close()
      }
    })
  })

  test('the lot produces exactly one migration', () => {
    expect(MIGRATIONS).toHaveLength(1)
    expect(MIGRATIONS[0]!.name).toBe('0001-lot-1')
    expect(checksumOf(MIGRATIONS[0]!)).toMatch(/^[0-9a-f]{64}$/)
    expect(statementsOf(MIGRATIONS[0]!).length).toBeGreaterThan(TABLES.length)
  })
})

describe('Échec de migration', () => {
  test('an injected failure leaves no half-applied schema and no writable start', () => {
    withProfile((directory) => {
      const broken: Migration[] = [
        {
          name: '0001-broken',
          sql: [
            'CREATE TABLE early (id TEXT PRIMARY KEY NOT NULL);',
            '--> statement-breakpoint',
            'CREATE TABLE early (id TEXT PRIMARY KEY NOT NULL);',
          ].join('\n'),
        },
      ]
      expect(() => openProfile({ directory, now: NOW, migrations: broken })).toThrow(
        MigrationFailedError,
      )

      // Nothing of the migration survived, not even the table its first statement created.
      const inspected = new Database(join(directory, DATABASE_FILE))
      try {
        expect(tablesOf(inspected)).not.toContain('early')
        expect(inspected.query('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({
          n: 0,
        })
      } finally {
        inspected.close()
      }
    })
  })

  test('the failure names the migration in cause', () => {
    withProfile((directory) => {
      const broken: Migration[] = [{ name: '0001-broken', sql: 'NOT SQL AT ALL;' }]
      expect(() => openProfile({ directory, now: NOW, migrations: broken })).toThrow(
        /migration 0001-broken failed/,
      )
    })
  })
})

describe('Ancien paquet sur profil récent', () => {
  test('a profile carrying an unknown migration is refused by name', () => {
    withProfile((directory) => {
      const ahead: Migration[] = [
        ...MIGRATIONS,
        { name: '0002-later-lot', sql: 'CREATE TABLE later (id TEXT PRIMARY KEY NOT NULL);' },
      ]
      openProfile({ directory, now: NOW, migrations: ahead }).database.close()

      expect(() => openProfile({ directory, now: NOW + 1 })).toThrow(SchemaAheadError)
      expect(() => openProfile({ directory, now: NOW + 1 })).toThrow(/0002-later-lot/)
    })
  })
})
