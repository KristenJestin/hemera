import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BACKUP_DIRECTORY,
  DATABASE_FILE,
  MIGRATIONS,
  MigrationFailedError,
  backupNameOf,
  backupProfile,
  backupsOf,
  openProfile,
} from '../src/index.ts'
import type { Migration } from '../src/index.ts'

const NOW = 1_789_000_000_000

function withDirectory(body: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-backup-'))
  try {
    body(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** A profile of the previous version, carrying a project and a session. */
function profileOfPreviousVersion(directory: string): void {
  const profile = openProfile({ directory, now: NOW })
  profile.database.run(
    'INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['p1', 'Hemera', NOW, NOW],
  )
  profile.database.run(
    'INSERT INTO sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['s1', 'p1', 'A session', NOW, NOW],
  )
  profile.database.close()
}

describe('Mise à jour du paquet sur un profil existant', () => {
  test('a consistent copy is taken before the profile is migrated', () => {
    withDirectory((directory) => {
      profileOfPreviousVersion(directory)
      const backup = backupProfile({ directory, now: NOW, schemaVersion: '0001-lot-1' })

      expect(backup.files).toContain(DATABASE_FILE)
      expect(existsSync(join(backup.directory, DATABASE_FILE))).toBe(true)

      // The copy holds the committed work, not a database whose writes live in a log.
      const copied = new Database(join(backup.directory, DATABASE_FILE))
      try {
        expect(copied.query('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 1 })
        expect(copied.query('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 })
      } finally {
        copied.close()
      }
    })
  })

  test('the projects and sessions are found again after the migration runs', () => {
    withDirectory((directory) => {
      profileOfPreviousVersion(directory)
      backupProfile({ directory, now: NOW, schemaVersion: '0001-lot-1' })

      const migrated = openProfile({ directory, now: NOW + 1 })
      try {
        expect(migrated.migrations.applied).toEqual([])
        expect(migrated.database.query('SELECT id FROM projects').all()).toEqual([{ id: 'p1' }])
        expect(migrated.database.query('SELECT id FROM sessions').all()).toEqual([{ id: 's1' }])
      } finally {
        migrated.database.close()
      }
    })
  })

  test('the files the profile keeps beside its database travel with it', () => {
    withDirectory((directory) => {
      profileOfPreviousVersion(directory)
      writeFileSync(join(directory, 'instance.lock'), '{}')
      const backup = backupProfile({ directory, now: NOW, schemaVersion: '0001-lot-1' })
      expect(backup.files).toContain('instance.lock')
      expect(existsSync(join(backup.directory, 'instance.lock'))).toBe(true)
    })
  })

  test('each copy is dated and named after the schema it holds', () => {
    withDirectory((directory) => {
      profileOfPreviousVersion(directory)
      backupProfile({ directory, now: NOW, schemaVersion: '0001-lot-1' })
      backupProfile({ directory, now: NOW + 86_400_000, schemaVersion: '0001-lot-1' })

      const copies = backupsOf(directory)
      expect(copies).toHaveLength(2)
      expect(copies[0]).toBe(backupNameOf(NOW, '0001-lot-1'))
      expect(copies.every((name) => name.includes('0001-lot-1'))).toBe(true)
      // Sorting the names sorts the copies in time.
      expect([...copies].toSorted()).toEqual(copies)
    })
  })
})

describe("Échec pendant la migration d'un profil existant", () => {
  test('the previous profile is untouched and its copy is kept', () => {
    withDirectory((directory) => {
      profileOfPreviousVersion(directory)
      const backup = backupProfile({ directory, now: NOW, schemaVersion: '0001-lot-1' })

      const broken: Migration[] = [
        ...MIGRATIONS,
        { name: '0002-broken', sql: 'CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL);' },
      ]
      expect(() => openProfile({ directory, now: NOW + 1, migrations: broken })).toThrow(
        MigrationFailedError,
      )

      // The profile still holds what it held, and the copy is still there.
      const reopened = openProfile({ directory, now: NOW + 2 })
      try {
        expect(reopened.database.query('SELECT id FROM projects').all()).toEqual([{ id: 'p1' }])
      } finally {
        reopened.database.close()
      }
      expect(existsSync(join(backup.directory, DATABASE_FILE))).toBe(true)
      expect(backupsOf(directory)).toHaveLength(1)
    })
  })

  test('the failure names the migration in cause', () => {
    withDirectory((directory) => {
      profileOfPreviousVersion(directory)
      const broken: Migration[] = [...MIGRATIONS, { name: '0002-broken', sql: 'NOT SQL AT ALL;' }]
      expect(() => openProfile({ directory, now: NOW + 1, migrations: broken })).toThrow(
        /migration 0002-broken failed/,
      )
    })
  })
})

describe('Test de migration depuis la version précédente', () => {
  test('the suite produces a profile fixture the next lot migrates from', () => {
    withDirectory((directory) => {
      profileOfPreviousVersion(directory)
      const backup = backupProfile({ directory, now: NOW, schemaVersion: '0001-lot-1' })

      // The fixture is a complete profile directory, usable as the starting point of a
      // migration test in the lot that follows.
      expect(existsSync(join(directory, BACKUP_DIRECTORY))).toBe(true)
      expect(backup.files).toContain(DATABASE_FILE)

      const fixture = new Database(join(backup.directory, DATABASE_FILE))
      try {
        const applied = fixture.query('SELECT name FROM schema_migrations ORDER BY name').all() as {
          name: string
        }[]
        expect(applied.map((row) => row.name)).toEqual(['0001-lot-1'])
      } finally {
        fixture.close()
      }
    })
  })
})
