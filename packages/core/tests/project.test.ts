/**
 * What a Project accepts as a name and as a repository location (design D4-03, D4-07).
 *
 * The rules are the domain's, and they are checked here rather than in the interface: the same
 * refusal has to come out whether the caller is a Dialog, a use case of the engine or a test.
 * Each suite is named after the scenario of `specs/project-workspaces/spec.md` it covers.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  InvalidProjectNameError,
  InvalidRepositoryPathError,
  MAX_PROJECT_NAME_LENGTH,
  ROOT_REPOSITORY,
  projectName,
  repositoryLocations,
  repositoryPath,
} from '#index.ts'

describe('Nom refusé', () => {
  test('a name that is empty, or nothing but spaces, is refused', () => {
    expect(() => projectName('')).toThrow(InvalidProjectNameError)
    expect(() => projectName('   ')).toThrow(InvalidProjectNameError)
  })

  test('a name longer than the maximum is refused, and the maximum itself is not', () => {
    expect(() => projectName('a'.repeat(MAX_PROJECT_NAME_LENGTH + 1))).toThrow(
      InvalidProjectNameError,
    )
    expect(projectName('a'.repeat(MAX_PROJECT_NAME_LENGTH))).toHaveLength(MAX_PROJECT_NAME_LENGTH)
  })

  test('the name kept is the one without the spaces around it', () => {
    expect(projectName('  Atlas  ')).toBe('Atlas')
  })
})

describe('Chemin hors racine refusé', () => {
  test('an absolute path is refused, on either platform', () => {
    expect(() => repositoryPath('/tmp/x')).toThrow(InvalidRepositoryPathError)
    expect(() => repositoryPath('D:\\Projects\\atlas')).toThrow(InvalidRepositoryPathError)
  })

  test('a path climbing out of the root is refused', () => {
    expect(() => repositoryPath('../ailleurs')).toThrow(InvalidRepositoryPathError)
    expect(() => repositoryPath('./sources/../../ailleurs')).toThrow(InvalidRepositoryPathError)
  })

  test('the same location declared twice is refused, whichever way it was written', () => {
    expect(() => repositoryLocations(['./sources/api', 'sources/api'])).toThrow(
      InvalidRepositoryPathError,
    )
  })
})

describe('Deux emplacements déclarés', () => {
  test('both are kept, in the order they were declared, relative to the root', () => {
    expect(repositoryLocations(['./sources/api', './sources/front'])).toEqual([
      './sources/api',
      './sources/front',
    ])
  })
})

describe('Liste vide', () => {
  test('a Project that declares nothing reads from the root itself', () => {
    expect(repositoryLocations([])).toEqual([ROOT_REPOSITORY])
  })

  test('a path that resolves to the root is the root, and not an empty string', () => {
    expect(repositoryPath('./')).toBe(ROOT_REPOSITORY)
  })
})
