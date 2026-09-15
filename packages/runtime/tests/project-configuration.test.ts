import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MAIN_WORKSPACE, ROOT_REPOSITORY } from '@hemera/core'

import {
  createProject,
  createSession,
  listSessions,
  mainWorkspace,
  openProfile,
  readConfiguration,
  readMessages,
  recordMessage,
  writeConfiguration,
} from '#index.ts'
import type { OpenProfile, StoreContext } from '#index.ts'

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
  /** A folder of documents, standing in for the user's own. */
  documents: string
}

function withStore(body: (fixture: Fixture) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-config-'))
  const documents = mkdtempSync(join(tmpdir(), 'hemera-documents-'))
  const profile = openProfile({ directory, now: NOW })
  try {
    body({
      profile,
      context: { database: profile.database, ids: identifiers(), now: NOW },
      documents,
    })
  } finally {
    profile.database.close(true)
    rmSync(directory, { recursive: true, force: true })
    rmSync(documents, { recursive: true, force: true })
  }
}

/** Everything the folder holds, at every depth. */
function entriesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: 'utf8' }).sort()
}

describe('Chemin unique du Projet', () => {
  test('the location read back is the one of main, and no second root is offered', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })

      expect(mainWorkspace(profile.database, project.id)?.name).toBe(MAIN_WORKSPACE)
      expect(mainWorkspace(profile.database, project.id)?.path).toBe(documents)

      // The configuration a user edits carries no path of its own.
      expect(Object.keys(readConfiguration(profile.database, project.id)).sort()).toEqual([
        'name',
        'repositories',
      ])
    })
  })
})

describe('Sources ajoutées plus tard', () => {
  test('sources arriving later keep the project, its sessions and its history', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      const session = createSession(context, project.id)
      recordMessage(context, session.id, 'started before the sources existed')

      // The user puts sources in the folder afterwards; Hemera is told nothing.
      mkdirSync(join(documents, 'sources', 'api'), { recursive: true })
      writeFileSync(join(documents, 'sources', 'api', 'main.ts'), 'export {}\n')

      writeConfiguration(context, project.id, project.version, {
        name: 'Hemera',
        repositories: ['./sources/api'],
      })

      expect(listSessions(profile.database, project.id)).toHaveLength(1)
      expect(readMessages(profile.database, session.id).map((entry) => entry.body)).toEqual([
        'started before the sources existed',
      ])
      expect(readConfiguration(profile.database, project.id).repositories).toEqual([
        './sources/api',
      ])
    })
  })
})

describe('Aucune initialisation imposée', () => {
  test('creating a project writes nothing into the folder of the user', () => {
    withStore(({ context, documents }) => {
      expect(entriesUnder(documents)).toEqual([])

      createProject(context, { name: 'Hemera', path: documents })

      expect(entriesUnder(documents)).toEqual([])
    })
  })
})

describe('Édition de la configuration', () => {
  test('an edited configuration is stored and read back after a restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-config-'))
    const documents = mkdtempSync(join(tmpdir(), 'hemera-documents-'))
    try {
      const first = openProfile({ directory, now: NOW })
      const context: StoreContext = {
        database: first.database,
        ids: identifiers(),
        now: NOW,
      }
      const { project } = createProject(context, { name: 'Hemera', path: documents })
      writeConfiguration(context, project.id, project.version, {
        name: 'Hemera cockpit',
        repositories: ['./sources/api', './sources/front'],
      })
      first.database.close(true)

      const second = openProfile({ directory, now: NOW + 1 })
      try {
        const configuration = readConfiguration(second.database, project.id)
        expect(configuration.name).toBe('Hemera cockpit')
        expect(configuration.repositories).toEqual(['./sources/api', './sources/front'])
      } finally {
        second.database.close(true)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(documents, { recursive: true, force: true })
    }
  })
})

describe('Aucun fichier écrit dans les sources', () => {
  test('creating then editing a configuration leaves the workspace folder untouched', () => {
    withStore(({ context, documents }) => {
      mkdirSync(join(documents, 'sources'), { recursive: true })
      writeFileSync(join(documents, 'sources', 'note.md'), 'written by the user\n')
      const before = entriesUnder(documents)

      const { project } = createProject(context, { name: 'Hemera', path: documents })
      writeConfiguration(context, project.id, project.version, {
        name: 'Hemera',
        repositories: ['./sources'],
      })

      expect(entriesUnder(documents)).toEqual(before)
      expect(Bun.file(join(documents, 'sources', 'note.md')).size).toBe(
        'written by the user\n'.length,
      )
    })
  })
})

describe('Deux emplacements déclarés', () => {
  test('two declared locations are stored as relative paths under the workspace root', () => {
    withStore(({ profile, context, documents }) => {
      const { project } = createProject(context, { name: 'Hemera', path: documents })

      writeConfiguration(context, project.id, project.version, {
        name: 'Hemera',
        repositories: ['sources/api', './sources/front'],
      })

      const configuration = readConfiguration(profile.database, project.id)
      expect(configuration.repositories).toEqual(['./sources/api', './sources/front'])
      expect(configuration.repositories).not.toContain(ROOT_REPOSITORY)
      for (const location of configuration.repositories) {
        expect(location.startsWith('./')).toBe(true)
      }
    })
  })
})
