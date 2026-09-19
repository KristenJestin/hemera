/**
 * What the main process can say about a folder on disk (design D4-09, D4-10).
 *
 * Each suite is named after the scenario of `specs/project-workspaces/spec.md` it covers. Every
 * one of them builds the folder it reads under the temporary directory, because what is under
 * test is reading a real one: a fake filesystem would be testing the fake.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { repositoryStatus, workspaceFiles } from '#main/workspace.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hemera-workspace-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Writes a file and every folder above it. */
function put(path: string, contents = ''): void {
  const full = join(root, path)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents)
}

describe('Branche lue à l’affichage', () => {
  test('a location holding a repository says which branch, and one that does not says so', async () => {
    put('sources/api/.git/HEAD', 'ref: refs/heads/develop\n')
    put('docs/core.md')

    const status = await repositoryStatus(root, ['./sources/api', './docs'])

    expect(status).toEqual([
      { path: './sources/api', git: 'develop', exists: true },
      { path: './docs', git: null, exists: true },
    ])
  })

  test('a location that is not there is told apart from one without a repository', async () => {
    const status = await repositoryStatus(root, ['./nowhere'])
    expect(status).toEqual([{ path: './nowhere', git: null, exists: false }])
  })

  test('a detached head is a repository with no branch to name', async () => {
    put('sources/api/.git/HEAD', '9c1e2f0a4b6d8e0f2a4c6e8a0c2e4f6a8b0d2f4e\n')

    const status = await repositoryStatus(root, ['./sources/api'])

    expect(status[0]?.exists).toBe(true)
    // It is a repository, and the interface shows it as one without inventing a name for where
    // it is.
    expect(status[0]?.git).toBeNull()
  })
})

describe('Les fichiers du Workspace sont lus bornés', () => {
  test('what matches is offered, matched on the whole path and not on the name', async () => {
    put('sources/api/src/index.ts')
    put('sources/front/src/index.ts')
    put('docs/core.md')

    const found = await workspaceFiles(root, 'front')

    // What tells two `index.ts` apart is the folder above them.
    expect(found).toEqual(['sources/front/src/index.ts'])
  })

  test('the walk never descends into what is not a Project’s own source', async () => {
    put('node_modules/react/index.js')
    put('.git/HEAD', 'ref: refs/heads/main\n')
    put('dist/bundle.js')
    put('src/kept.ts')

    const found = await workspaceFiles(root, '')

    expect(found).toEqual(['src/kept.ts'])
  })

  test('no more paths are handed back than were asked for', async () => {
    for (let index = 0; index < 40; index += 1) put(`src/file-${String(index)}.ts`)

    expect(await workspaceFiles(root, '', 5)).toHaveLength(5)
  })

  test('a folder deeper than the walk goes is not read', async () => {
    put('a/b/c/d/e/f/g/too-deep.ts')
    put('a/shallow.ts')

    const found = await workspaceFiles(root, 'ts')

    expect(found).toContain('a/shallow.ts')
    expect(found).not.toContain('a/b/c/d/e/f/g/too-deep.ts')
  })

  test('a root that is not there answers nothing rather than failing', async () => {
    expect(await workspaceFiles(join(root, 'nowhere'), '')).toEqual([])
  })
})

describe('Les tests du Workspace tournent sur un dossier temporaire', () => {
  test('the folder this suite built is under the temporary directory it made', () => {
    expect(root.startsWith(tmpdir())).toBe(true)
  })
})
