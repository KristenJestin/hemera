/**
 * What can be done to a Project, and what is refused (design D4-03).
 *
 * Each suite is named after the scenario of `specs/project-workspaces/spec.md` it covers. Every
 * one of them runs on a data folder made for it under the temporary directory, migrated by the
 * migrations the application really ships. Nothing here touches a folder of this machine: the
 * service writes rows, and whether a path exists at all is the main process's question — which
 * is exactly why creating a Project on a folder that is not there works here and is refused
 * before it ever reaches the engine.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { InvalidProjectNameError, InvalidRepositoryPathError } from '@hemera/core'
import { InvalidBranchPrefixError, InvalidWorkspacesRootError } from '#engine/projects.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { SqliteClient, databaseLayer } from '#engine/storage/database.ts'
import { StaleVersionError } from '#engine/transaction.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

let dataFolder: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-projects-'))
  mkdirSync(dataFolder, { recursive: true })
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
})

/** A data folder opened and migrated, with the service standing on it. */
function opened() {
  const services = projectsLayer.pipe(
    Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite'))),
  )
  return <A, E>(program: Effect.Effect<A, E, Projects | SqliteClient>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(dataFolder, SHIPPED, '0.4.0')
            return yield* program
          }),
          services,
        ),
      ),
    )
}

/** The same, for a program expected to fail: its refusal is the answer, typed as it was raised. */
function refusalOn<A, E>(program: Effect.Effect<A, E, Projects | SqliteClient>) {
  return opened()(Effect.flip(program))
}

/** One Project, created the way the Dialog creates one. */
const created = Effect.gen(function* () {
  const projects = yield* Projects
  return yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: '/tmp/atlas' })
})

/**
 * What these suites wrote to the journal, oldest first.
 *
 * The line the profile writes when it is opened is left out by name: it is written by the
 * opening and not by a use case, and what is under test here are the use cases.
 */
const journal = Effect.gen(function* () {
  const sql = yield* SqliteClient
  // Of the Projects. What opening the data folder did — it was opened, it was migrated — is
  // written down too, and is the subject of `migrate.test.ts` rather than of this file.
  return yield* sql<{ type: string; entity_id: string; author: string }>`
    SELECT type, entity_id, author FROM domain_events
    WHERE entity_kind = 'project' ORDER BY sequence`
})

describe('Création sur un dossier vide', () => {
  test('the Project and its main Workspace are written, and the event names both', async () => {
    const [project, entries] = await opened()(
      Effect.gen(function* () {
        const one = yield* created
        return [one, yield* journal] as const
      }),
    )

    expect(project.name).toBe('Atlas')
    expect(project.tone).toBe('primary')
    expect(project.mainPath).toBe('/tmp/atlas')
    expect(project.version).toBe(1)
    expect(project.archivedAt).toBeNull()
    // No repository is assumed to be there and none is initialised.
    expect(project.repositories).toEqual([])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.type).toBe('project.created')
    expect(entries[0]?.entity_id).toBe(project.id)
    expect(entries[0]?.author).toBe('human')
  })

  test('a name that is only spaces is refused, and nothing is written', async () => {
    const entries = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* Effect.ignore(
          projects.create({ name: '   ', tone: 'primary', mainPath: '/tmp/atlas' }),
        )
        return yield* journal
      }),
    )
    expect(entries).toEqual([])
  })
})

describe('A Workspace is kept as the disk spells it', () => {
  test('a root reached through a link, or a short name, is written in its canonical form', async () => {
    const real = join(dataFolder, 'the-real-workspace')
    mkdirSync(real)
    // A junction on Windows, which needs no privilege; a directory link elsewhere. A DOS short
    // name is the same case on a runner that has one: another spelling of one place.
    const link = join(dataFolder, 'through-a-link')
    symlinkSync(real, link, 'junction')

    const project = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        const made = yield* projects.create({ name: 'Linked', tone: 'primary', mainPath: link })
        return yield* projects.moveMain(made.id, made.version, link)
      }),
    )

    expect(project.mainPath).toBe(realpathSync.native(real))
  })
})

describe('Version périmée', () => {
  test('a change made against a version that is no longer current is refused', async () => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        // Someone else got there first: the Project is at version 2 by the time this arrives.
        yield* projects.update({ id: one.id, version: one.version, name: 'Atlas II' })
        return yield* projects.update({ id: one.id, version: one.version, name: 'Atlas III' })
      }),
    )

    expect(raised).toBeInstanceOf(StaleVersionError)
  })

  test('and the configuration is left exactly as the first change made it', async () => {
    const [name, entries] = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        yield* projects.update({ id: one.id, version: one.version, name: 'Atlas II' })
        yield* Effect.ignore(
          projects.update({ id: one.id, version: one.version, name: 'Atlas III' }),
        )
        const after = yield* projects.list()
        return [after[0]?.name, yield* journal] as const
      }),
    )

    expect(name).toBe('Atlas II')
    // One creation and one change: the refused one wrote nothing at all.
    expect(entries.map((entry) => entry.type)).toEqual(['project.created', 'project.updated'])
  })
})

describe('Un nom refusé à la relecture', () => {
  test('a name emptied on the settings page is refused as a refusal, not as a defect', async () => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        return yield* projects.update({ id: one.id, version: one.version, name: '   ' })
      }),
    )

    expect(raised).toBeInstanceOf(InvalidProjectNameError)
  })
})

describe('Deux emplacements déclarés', () => {
  test('both are kept, in the order they were added', async () => {
    const project = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        const withApi = yield* projects.addRepository(one.id, one.version, './sources/api')
        return yield* projects.addRepository(withApi.id, withApi.version, './sources/front')
      }),
    )

    expect(project.repositories).toEqual(['./sources/api', './sources/front'])
  })

  test('a fourth one takes a rank of its own, since a rank is read and never counted', async () => {
    const ranks = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        let one = yield* created
        for (const path of ['./api', './front', './docs', './tools']) {
          one = yield* projects.addRepository(one.id, one.version, path)
        }
        const sql = yield* SqliteClient
        return yield* sql<{ rank: string }>`
          SELECT rank FROM project_repositories ORDER BY rowid`
      }),
    )

    // Every one strictly after the last: two locations sharing a rank are two locations in no
    // order at all, whatever order the list happens to come back in.
    expect(ranks.map((one) => one.rank)).toEqual([...ranks.map((one) => one.rank)].toSorted())
    expect(new Set(ranks.map((one) => one.rank)).size).toBe(4)
  })
})

describe('Chemin hors racine refusé', () => {
  test.each(['/tmp/x', '../elsewhere'])('%s is refused by the domain', async (path) => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        return yield* projects.addRepository(one.id, one.version, path)
      }),
    )

    expect(raised).toBeInstanceOf(InvalidRepositoryPathError)
  })

  test('a location already declared is refused, and the list is left intact', async () => {
    const project = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        const withApi = yield* projects.addRepository(one.id, one.version, './sources/api')
        yield* Effect.ignore(projects.addRepository(withApi.id, withApi.version, './sources/api'))
        const after = yield* projects.list()
        return after[0]
      }),
    )

    expect(project?.repositories).toEqual(['./sources/api'])
  })
})

describe('The folder of the Workspaces and the branch prefix are the Project’s', () => {
  test('both start at their default, are set, and are cleared back to it', async () => {
    const [fresh, set, cleared, entries] = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        const rooted = yield* projects.setWorkspacesRoot(one.id, one.version, '/tmp/atlas-trees')
        const prefixed = yield* projects.setBranchPrefix(rooted.id, rooted.version, ' hemera ')
        const unrooted = yield* projects.setWorkspacesRoot(prefixed.id, prefixed.version, null)
        const back = yield* projects.setBranchPrefix(unrooted.id, unrooted.version, null)
        return [one, prefixed, back, yield* journal] as const
      }),
    )

    // Null is the default and not a value: Hemera's own folder, and the Project's name (D8-02).
    expect(fresh.workspacesRoot).toBeNull()
    expect(fresh.branchPrefix).toBeNull()
    expect(set.workspacesRoot).toBe('/tmp/atlas-trees')
    expect(set.branchPrefix).toBe('hemera')
    expect(cleared.workspacesRoot).toBeNull()
    expect(cleared.branchPrefix).toBeNull()
    expect(entries.map((entry) => entry.type)).toEqual([
      'project.created',
      'project.updated',
      'project.updated',
      'project.updated',
      'project.updated',
    ])
  })

  test('a setting made against a version that is no longer current is refused', async () => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        yield* projects.setBranchPrefix(one.id, one.version, 'hemera')
        return yield* projects.setBranchPrefix(one.id, one.version, 'atlas')
      }),
    )

    expect(raised).toBeInstanceOf(StaleVersionError)
  })
})

describe('A folder of Workspaces is absolute and outside main, a prefix one Git takes', () => {
  test.each([
    ['relative', 'workspaces', 'it is not an absolute path'],
    ['main itself', '/tmp/atlas', 'it is inside main'],
    ['inside main', '/tmp/atlas/.worktrees', 'it is inside main'],
  ])('a folder %s is refused, naming why', async (_, path, reason) => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        return yield* projects.setWorkspacesRoot(one.id, one.version, path)
      }),
    )

    expect(raised).toBeInstanceOf(InvalidWorkspacesRootError)
    expect(raised.message).toContain(reason)
  })

  test.each([
    ['', 'it is empty'],
    ['my team', 'it holds a space'],
    ['team..x', 'it holds ".."'],
    ['/team', 'it starts or ends with "/"'],
    ['team/', 'it starts or ends with "/"'],
    ['team:x', 'it holds a character a branch name cannot'],
  ])('the prefix "%s" is refused: %s', async (prefix, reason) => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        return yield* projects.setBranchPrefix(one.id, one.version, prefix)
      }),
    )

    expect(raised).toBeInstanceOf(InvalidBranchPrefixError)
    expect(raised.message).toContain(reason)
  })

  test('a prefix with folders of its own is kept', async () => {
    const project = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        return yield* projects.setBranchPrefix(one.id, one.version, 'team/hemera')
      }),
    )

    expect(project.branchPrefix).toBe('team/hemera')
  })
})

describe('A repository is included by default and can be left out', () => {
  test('included beside the list of repositories, which stays as it is', async () => {
    const [declared, left, entries] = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        const withApi = yield* projects.addRepository(one.id, one.version, './sources/api')
        const both = yield* projects.addRepository(withApi.id, withApi.version, './sources/front')
        const out = yield* projects.setRepositoryIncluded(
          both.id,
          both.version,
          './sources/front',
          false,
        )
        return [both, out, yield* journal] as const
      }),
    )

    expect(declared.included).toEqual(['./sources/api', './sources/front'])
    expect(left.repositories).toEqual(['./sources/api', './sources/front'])
    expect(left.included).toEqual(['./sources/api'])
    expect(entries.at(-1)?.type).toBe('project.repository_updated')
  })

  test('a location the Project does not declare is refused', async () => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        return yield* projects.setRepositoryIncluded(one.id, one.version, './nowhere', false)
      }),
    )

    expect(raised).toBeInstanceOf(InvalidRepositoryPathError)
  })
})

describe('Archivé puis restauré', () => {
  test('it leaves the list, comes back to it, and keeps its Journal', async () => {
    const [afterArchive, afterRestore, entries] = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        const archived = yield* projects.archive(one.id, one.version)
        const gone = yield* projects.list()
        yield* projects.restore(archived.id, archived.version)
        const back = yield* projects.list()
        return [gone, back, yield* journal] as const
      }),
    )

    expect(afterArchive).toEqual([])
    expect(afterRestore).toHaveLength(1)
    expect(afterRestore[0]?.archivedAt).toBeNull()
    // Nothing was taken away: the Journal still holds everything that happened to it.
    expect(entries.map((entry) => entry.type)).toEqual([
      'project.created',
      'project.archived',
      'project.restored',
    ])
  })

  test('an archived Project is still there when asked for', async () => {
    const archived = await opened()(
      Effect.gen(function* () {
        const projects = yield* Projects
        const one = yield* created
        yield* projects.archive(one.id, one.version)
        return yield* projects.list(true)
      }),
    )

    expect(archived).toHaveLength(1)
    expect(archived[0]?.archivedAt).not.toBeNull()
  })
})

describe('Aucune suppression', () => {
  test('the service offers these use cases and no other', async () => {
    // Asked of the service the layer really builds, and listed in full rather than checked for
    // the absence of one word: a use case added tomorrow has to be added here too, which is
    // where anyone adding a way to delete a Project would have to argue for it.
    const offered = await opened()(
      Effect.gen(function* () {
        return Object.keys(yield* Projects).toSorted()
      }),
    )

    expect(offered).toEqual([
      'addRepository',
      'archive',
      'create',
      'list',
      'moveMain',
      'removeRepository',
      'restore',
      'setBranchPrefix',
      'setRepositoryIncluded',
      'setWorkspacesRoot',
      'update',
    ])
  })
})

describe('Un Projet inconnu', () => {
  test('a change aimed at an identifier nothing answers to is refused', async () => {
    const raised = await refusalOn(
      Effect.gen(function* () {
        const projects = yield* Projects
        return yield* projects.archive('nobody', 1)
      }),
    )

    expect(raised).toBeInstanceOf(StaleVersionError)
  })
})

describe('Les tests des Projets tournent sur un dossier temporaire', () => {
  test('the data folder this suite wrote to is under the temporary directory it made', () => {
    expect(dataFolder.startsWith(tmpdir())).toBe(true)
  })
})
