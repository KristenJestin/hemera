import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NoActiveProjectError, UNTITLED_SESSION, currentSessions } from '@hemera/core'

import {
  createProject,
  createSession,
  listSessions,
  openProfile,
  readMessages,
  recordMessage,
  renameSession,
  setSessionArchived,
} from '../src/index.ts'
import type { OpenProfile, StoreContext } from '../src/index.ts'

const NOW = 1_789_000_000_000

function identifiers(): { next: () => string } {
  let count = 0
  return {
    next: () => {
      count += 1
      return `id-${count}`
    },
  }
}

interface Fixture {
  profile: OpenProfile
  context: StoreContext
  documents: string
}

function withStore(body: (fixture: Fixture) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-thread-'))
  const documents = mkdtempSync(join(tmpdir(), 'hemera-documents-'))
  const profile = openProfile({ directory, now: NOW })
  try {
    body({
      profile,
      context: { database: profile.database, ids: identifiers(), now: NOW },
      documents,
    })
  } finally {
    profile.database.close()
    rmSync(directory, { recursive: true, force: true })
    rmSync(documents, { recursive: true, force: true })
  }
}

describe('Travaux parallèles', () => {
  test('two sessions of the same project keep their own history', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const first = createSession(context, project.id)
      const second = createSession(context, project.id)

      recordMessage(context, first.id, 'about the migration')
      recordMessage(context, second.id, 'about the renderer')
      recordMessage(context, first.id, 'still the migration')

      expect(listSessions(profile.database, project.id)).toHaveLength(2)
      expect(readMessages(profile.database, first.id).map((entry) => entry.body)).toEqual([
        'about the migration',
        'still the migration',
      ])
      expect(readMessages(profile.database, second.id).map((entry) => entry.body)).toEqual([
        'about the renderer',
      ])
    })
  })
})

describe('Aucune Spec créée implicitement', () => {
  test('creating and using a free session creates no spec and no second workspace', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      recordMessage(context, session.id, 'a first note')

      expect(session.mission).toBe('free')
      const workspaces = profile.database
        .query('SELECT name FROM workspaces WHERE project_id = ?')
        .all(project.id) as { name: string }[]
      expect(workspaces.map((row) => row.name)).toEqual(['main'])

      const tables = profile.database
        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
      expect(tables.map((row) => row.name)).not.toContain('specs')
    })
  })
})

describe('Aucun Projet actif', () => {
  test('a session cannot be created without a project, and none is created for it', () => {
    withStore(({ profile, context }) => {
      expect(() => createSession(context, null)).toThrow(NoActiveProjectError)
      expect(
        (
          profile.database.query('SELECT count(*) AS total FROM projects').get() as {
            total: number
          }
        ).total,
      ).toBe(0)
    })
  })
})

describe('Message enregistré', () => {
  test('a message is durable before it is presented, and no agent answers it', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)

      const recorded = recordMessage(context, session.id, 'the only message of this thread')

      // Read back from the database, not from what the call returned.
      const stored = readMessages(profile.database, session.id)
      expect(stored).toHaveLength(1)
      expect(stored[0]?.id).toBe(recorded.entry.id)
      expect(stored[0]?.body).toBe('the only message of this thread')
      expect(stored.every((entry) => entry.author === 'human')).toBe(true)
    })
  })
})

describe("Échec d'enregistrement", () => {
  test('a refused message is nowhere in the thread', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      recordMessage(context, session.id, 'the first one')

      // The identifier of the entry already exists: the insert is refused mid-transaction.
      const colliding: StoreContext = {
        ...context,
        ids: { next: () => readMessages(profile.database, session.id)[0]?.id ?? 'id-1' },
      }
      expect(() => recordMessage(colliding, session.id, 'never recorded')).toThrow()

      const bodies = readMessages(profile.database, session.id).map((entry) => entry.body)
      expect(bodies).toEqual(['the first one'])
      expect(bodies).not.toContain('never recorded')
    })
  })
})

describe('Renommage conservé', () => {
  test('a title chosen by the user survives the messages that follow', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)

      const renamed = renameSession(context, session.id, 'Migration of the profile')
      recordMessage(context, session.id, 'a message that would have proposed another title')
      recordMessage(context, session.id, 'and another one')

      expect(renamed.titleChosen).toBe(true)
      const stored = listSessions(profile.database, project.id)[0]
      expect(stored?.title).toBe('Migration of the profile')
      expect(stored?.titleChosen).toBe(true)
    })
  })
})

describe('Session sans message', () => {
  test('a session without a message carries the default title and stays renamable', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)

      expect(session.title).toBe(UNTITLED_SESSION)
      expect(readMessages(profile.database, session.id)).toEqual([])

      const renamed = renameSession(context, session.id, 'Named before anything was said')
      expect(renamed.title).toBe('Named before anything was said')
    })
  })
})

describe('Archivage durable', () => {
  test('an archived session is still archived after a restart, with its messages intact', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-thread-'))
    const documents = mkdtempSync(join(tmpdir(), 'hemera-documents-'))
    try {
      const first = openProfile({ directory, now: NOW })
      const context: StoreContext = { database: first.database, ids: identifiers(), now: NOW }
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      recordMessage(context, session.id, 'one')
      recordMessage(context, session.id, 'two')
      setSessionArchived(context, session.id, true)
      first.database.close()

      const second = openProfile({ directory, now: NOW + 1 })
      try {
        const sessions = listSessions(second.database, project.id)
        expect(sessions).toHaveLength(1)
        expect(sessions[0]?.archivedAt).not.toBeNull()
        expect(currentSessions(sessions)).toEqual([])
        expect(readMessages(second.database, session.id).map((entry) => entry.body)).toEqual([
          'one',
          'two',
        ])
      } finally {
        second.database.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(documents, { recursive: true, force: true })
    }
  })
})

describe('Contenu conservé indépendamment', () => {
  test('the thread is read back from the storage of Hemera, with no external state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-thread-'))
    const documents = mkdtempSync(join(tmpdir(), 'hemera-documents-'))
    try {
      const first = openProfile({ directory, now: NOW })
      const context: StoreContext = { database: first.database, ids: identifiers(), now: NOW }
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      recordMessage(context, session.id, 'kept by Hemera alone')
      first.database.close()

      // The folder of the user disappears: the thread belongs to the profile, not to it.
      rmSync(documents, { recursive: true, force: true })

      const second = openProfile({ directory, now: NOW + 1 })
      try {
        expect(readMessages(second.database, session.id).map((entry) => entry.body)).toEqual([
          'kept by Hemera alone',
        ])
        expect(listSessions(second.database, project.id)).toHaveLength(1)
      } finally {
        second.database.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(documents, { recursive: true, force: true })
    }
  })
})
