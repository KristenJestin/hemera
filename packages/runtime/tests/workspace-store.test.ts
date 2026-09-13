import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EmptyMessageError,
  InvalidProjectNameError,
  InvalidRepositoryPathError,
  MAIN_WORKSPACE,
  NoActiveProjectError,
  ROOT_REPOSITORY,
  UNTITLED_SESSION,
  archivedSessions,
  currentSessions,
} from '@hemera/core'

import {
  UnknownProjectError,
  VersionConflictError,
  createProject,
  createSession,
  listProjects,
  listSessions,
  mainWorkspace,
  openProfile,
  readConfiguration,
  readJournal,
  readMessages,
  recordMessage,
  renameSession,
  setSessionArchived,
  writeConfiguration,
} from '../src/index.ts'
import type { OpenProfile, StoreContext } from '../src/index.ts'

const NOW = 1_789_000_000_000

/** Identifiers a test can read, so nothing depends on randomness. */
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
  /** A folder of documents, standing in for the user's own. */
  documents: string
}

function withStore(body: (fixture: Fixture) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-store-'))
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

describe('Projet de conception', () => {
  test('a folder of documents becomes a project with its main workspace', () => {
    withStore(({ profile, context, documents }) => {
      const created = createProject(context, { name: 'Hemera', path: documents })

      expect(created.workspace.name).toBe(MAIN_WORKSPACE)
      expect(created.workspace.path).toBe(documents)
      expect(mainWorkspace(profile.database, created.project.id)?.path).toBe(documents)
      expect(listProjects(profile.database)).toHaveLength(1)
    })
  })

  test('the path is carried by main, and the project has no second root', () => {
    withStore(({ profile, context, documents }) => {
      const created = createProject(context, { name: 'Hemera', path: documents })

      const columns = (
        profile.database.query('PRAGMA table_info(projects)').all() as { name: string }[]
      ).map((column) => column.name)
      expect(columns).not.toContain('path')
      expect(columns).not.toContain('root')

      const workspaces = profile.database
        .query('SELECT name FROM workspaces WHERE project_id = ?')
        .all(created.project.id) as { name: string }[]
      expect(workspaces.map((workspace) => workspace.name)).toEqual([MAIN_WORKSPACE])
    })
  })

  test('no repository is created in the folder and no file is written there', () => {
    withStore(({ context, documents }) => {
      const before = readdirSync(documents)
      createProject(context, { name: 'Hemera', path: documents })
      expect(readdirSync(documents)).toEqual(before)
      expect(existsSync(join(documents, '.git'))).toBe(false)
      expect(existsSync(join(documents, 'hemera.json'))).toBe(false)
    })
  })

  test('a name that cannot be one is refused and nothing is created', () => {
    withStore(({ profile, context, documents }) => {
      expect(() => createProject(context, { name: '   ', path: documents })).toThrow(
        InvalidProjectNameError,
      )
      expect(listProjects(profile.database)).toEqual([])
      expect(readJournal(profile.database).events).toEqual([])
    })
  })
})

describe('Aucun dépôt déclaré', () => {
  test('an empty list means the root itself', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      expect(readConfiguration(profile.database, project.id).repositories).toEqual([
        ROOT_REPOSITORY,
      ])
    })
  })

  test('two declared locations are kept relative and in order', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      writeConfiguration(context, project.id, project.version, {
        name: 'Hemera',
        repositories: ['./sources/api', './sources/front'],
      })
      expect(readConfiguration(profile.database, project.id).repositories).toEqual([
        './sources/api',
        './sources/front',
      ])
    })
  })
})

describe('Chemin sortant de la racine', () => {
  test('an absolute location or one climbing out is refused', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      for (const location of ['/etc', 'C:\\Windows', '../elsewhere', './sources/../../out']) {
        expect(() =>
          writeConfiguration(context, project.id, project.version, {
            name: 'Hemera',
            repositories: [location],
          }),
        ).toThrow(InvalidRepositoryPathError)
      }
      // The previous configuration is intact.
      expect(readConfiguration(profile.database, project.id).repositories).toEqual([
        ROOT_REPOSITORY,
      ])
    })
  })
})

describe('Configuration invalide refusée', () => {
  test('a refused configuration leaves the previous one exactly as it was', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const saved = writeConfiguration(context, project.id, project.version, {
        name: 'Hemera',
        repositories: ['./sources/api'],
      })

      expect(() =>
        writeConfiguration(context, project.id, saved.version, {
          name: '',
          repositories: ['./sources/front'],
        }),
      ).toThrow(InvalidProjectNameError)

      const configuration = readConfiguration(profile.database, project.id)
      expect(configuration.name).toBe('Hemera')
      expect(configuration.repositories).toEqual(['./sources/api'])
    })
  })

  test('a configuration written against a stale version is refused as a conflict', () => {
    withStore(({ context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      writeConfiguration(context, project.id, project.version, {
        name: 'Hemera',
        repositories: [],
      })
      expect(() =>
        writeConfiguration(context, project.id, project.version, {
          name: 'Other',
          repositories: [],
        }),
      ).toThrow(VersionConflictError)
    })
  })

  test('an unknown project is refused by name', () => {
    withStore(({ profile }) => {
      expect(() => readConfiguration(profile.database, 'nowhere')).toThrow(UnknownProjectError)
    })
  })
})

describe('Création dans un Projet', () => {
  test('a session is created without Spec and without workspace', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)

      expect(session.mission).toBe('free')
      expect(session.title).toBe(UNTITLED_SESSION)
      expect(listSessions(profile.database, project.id)).toHaveLength(1)
      // Only the main workspace exists: nothing was created for the session.
      expect(profile.database.query('SELECT COUNT(*) AS n FROM workspaces').get()).toEqual({ n: 1 })
    })
  })

  test('two sessions keep their own histories', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const first = createSession(context, project.id)
      const second = createSession(context, project.id)

      recordMessage(context, first.id, 'first thread')
      recordMessage(context, second.id, 'second thread')

      expect(readMessages(profile.database, first.id).map((entry) => entry.body)).toEqual([
        'first thread',
      ])
      expect(readMessages(profile.database, second.id).map((entry) => entry.body)).toEqual([
        'second thread',
      ])
    })
  })

  test('no active project means no session, and no project is created either', () => {
    withStore(({ profile, context }) => {
      expect(() => createSession(context, null)).toThrow(NoActiveProjectError)
      expect(listProjects(profile.database)).toEqual([])
    })
  })

  test('a project with no session shows no session at all', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      expect(listSessions(profile.database, project.id)).toEqual([])
    })
  })
})

describe('Ordre des messages', () => {
  test('messages are read back in the order they were recorded, even in quick succession', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)

      const sent = ['one', 'two', 'three', 'four', 'five']
      for (const body of sent) recordMessage(context, session.id, body)

      expect(readMessages(profile.database, session.id).map((entry) => entry.body)).toEqual(sent)
    })
  })

  test('an empty message is not recorded and nothing is presented as kept', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)

      expect(() => recordMessage(context, session.id, '   ')).toThrow(EmptyMessageError)
      expect(readMessages(profile.database, session.id)).toEqual([])
    })
  })

  test('no agent answer and no generation marker is ever produced', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      recordMessage(context, session.id, 'hello')

      const entries = readMessages(profile.database, session.id)
      expect(entries).toHaveLength(1)
      expect(entries.every((entry) => entry.author === 'human')).toBe(true)
    })
  })
})

describe('Titre dérivé du premier message', () => {
  test('the first message proposes the title of a session without one', () => {
    withStore(({ context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      const recorded = recordMessage(context, session.id, 'Bootstrap the socle\nand more')
      expect(recorded.session.title).toBe('Bootstrap the socle')
    })
  })

  test('a renamed session keeps its title through later messages', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      renameSession(context, session.id, 'Chosen title')
      recordMessage(context, session.id, 'a first message')
      recordMessage(context, session.id, 'a second message')
      expect(findSessionTitle(profile, session.id)).toBe('Chosen title')
    })
  })

  test('a session with no message keeps a title that says so', () => {
    withStore(({ context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      expect(createSession(context, project.id).title).toBe(UNTITLED_SESSION)
    })
  })
})

function findSessionTitle(profile: OpenProfile, sessionId: string): string {
  return (
    profile.database.query('SELECT title FROM sessions WHERE id = ?').get(sessionId) as {
      title: string
    }
  ).title
}

describe('Session archivée puis restaurée', () => {
  test('archiving hides it from the current list and keeps it readable', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      recordMessage(context, session.id, 'one')
      recordMessage(context, session.id, 'two')

      setSessionArchived(context, session.id, true)
      const sessions = listSessions(profile.database, project.id)
      expect(currentSessions(sessions)).toEqual([])
      expect(archivedSessions(sessions)).toHaveLength(1)
      // Its messages are untouched.
      expect(readMessages(profile.database, session.id)).toHaveLength(2)
    })
  })

  test('restoring brings it back with every message in order', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      for (const body of ['one', 'two', 'three']) recordMessage(context, session.id, body)

      setSessionArchived(context, session.id, true)
      setSessionArchived(context, session.id, false)

      expect(currentSessions(listSessions(profile.database, project.id))).toHaveLength(1)
      expect(readMessages(profile.database, session.id).map((entry) => entry.body)).toEqual([
        'one',
        'two',
        'three',
      ])
    })
  })

  test('archiving deletes nothing, and the journal records both moves', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      setSessionArchived(context, session.id, true)
      setSessionArchived(context, session.id, false)

      const types = readJournal(profile.database, { sessionId: session.id }).events.map(
        (recorded) => recorded.type,
      )
      expect(types).toEqual(['session.created', 'session.archived', 'session.restored'])
      expect(profile.database.query('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 })
    })
  })
})
