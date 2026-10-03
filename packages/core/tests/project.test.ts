/**
 * What a Project accepts as a name, a repository path, a base branch and a branch prefix.
 *
 * The rules are the domain's and are checked here rather than in a screen: the same refusal comes
 * out whether the caller is a dialog, the engine or a test.
 */

import { execFileSync } from 'node:child_process'

import { Result } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  DEFAULT_BASE_BRANCH,
  InvalidBranchName,
  InvalidProjectName,
  InvalidRepositoryPath,
  MAX_PROJECT_NAME_LENGTH,
  ROOT_REPOSITORY,
  branchName,
  branchPrefix,
  defaultBranchPrefix,
  projectName,
  repositoryPath,
} from '../src/domain/index.ts'

const refusal = <A, E>(result: Result.Result<A, E>): E | undefined =>
  Result.isFailure(result) ? result.failure : undefined
const value = <A, E>(result: Result.Result<A, E>): A | undefined =>
  Result.isSuccess(result) ? result.success : undefined

describe('A Project name is refused when it cannot be one', () => {
  test('an empty name, or one of spaces only, is refused', () => {
    expect(refusal(projectName(''))).toBeInstanceOf(InvalidProjectName)
    expect(refusal(projectName('   '))).toBeInstanceOf(InvalidProjectName)
  })

  test('a name longer than the maximum is refused, and the maximum itself is kept', () => {
    expect(refusal(projectName('a'.repeat(MAX_PROJECT_NAME_LENGTH + 1)))).toBeInstanceOf(
      InvalidProjectName,
    )
    expect(value(projectName('a'.repeat(MAX_PROJECT_NAME_LENGTH)))).toHaveLength(
      MAX_PROJECT_NAME_LENGTH,
    )
  })

  test('the name kept has no spaces around it', () => {
    expect(value(projectName('  Atlas  '))).toBe('Atlas')
  })
})

describe('A repository path stays inside the main checkout', () => {
  test('an absolute path is refused, on either platform', () => {
    expect(refusal(repositoryPath('/tmp/x'))).toBeInstanceOf(InvalidRepositoryPath)
    expect(refusal(repositoryPath('D:\\Work\\atlas'))).toBeInstanceOf(InvalidRepositoryPath)
    expect(refusal(repositoryPath('\\\\server\\share'))).toBeInstanceOf(InvalidRepositoryPath)
  })

  test('a path that leaves through .. is refused', () => {
    expect(refusal(repositoryPath('../elsewhere'))).toBeInstanceOf(InvalidRepositoryPath)
    expect(refusal(repositoryPath('sources/../../elsewhere'))).toBeInstanceOf(InvalidRepositoryPath)
  })

  test('an empty path is refused', () => {
    expect(refusal(repositoryPath(' '))).toBeInstanceOf(InvalidRepositoryPath)
  })

  test('a path is kept in one spelling, with forward slashes', () => {
    expect(value(repositoryPath('./sources/api'))).toBe('sources/api')
    expect(value(repositoryPath('sources\\api\\'))).toBe('sources/api')
    expect(value(repositoryPath('sources/./front/../api'))).toBe('sources/api')
  })

  test('a path that resolves to the main checkout itself is the root', () => {
    expect(value(repositoryPath('./'))).toBe(ROOT_REPOSITORY)
    expect(value(repositoryPath('api/..'))).toBe(ROOT_REPOSITORY)
  })
})

/** What the machine's own Git says of a branch name, which the rule has to agree with. */
const gitAccepts = (name: string): boolean => {
  try {
    execFileSync('git', ['check-ref-format', '--branch', name], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const NAMES = [
  'main',
  'dev',
  'feature/1.0',
  'team/hemera',
  'fix-a.b',
  'release/v1',
  'a',
  'UPPER/Case',
  'unicode-é',
  '',
  ' ',
  'with space',
  'a..b',
  'a/',
  '/a',
  'a//b',
  'a.',
  'a.lock',
  'a/b.lock/c',
  '.a',
  'a/.b',
  'a@{b',
  'a@b',
  'a{b}',
  'a~b',
  'a^b',
  'a:b',
  'a?b',
  'a*b',
  'a[b',
  'a\\b',
  'a\u0007b',
  '-a',
]

describe('A base branch is a name Git accepts', () => {
  test.each(NAMES)('%j is judged as the machine’s git judges it', (name) => {
    expect(Result.isSuccess(branchName(name))).toBe(gitAccepts(name))
  })

  test('“@” alone and “HEAD” are refused, whatever this Git’s version says of them', () => {
    expect(refusal(branchName('@'))).toBeInstanceOf(InvalidBranchName)
    expect(refusal(branchName('HEAD'))).toBeInstanceOf(InvalidBranchName)
  })

  test('a refused name says why', () => {
    const refused = refusal(branchName('a..b'))
    expect(refused).toBeInstanceOf(InvalidBranchName)
    expect(refused?.message).toBe('“a..b” is not a branch name Git accepts: it holds “..”.')
  })

  test('the default base branch is itself a name Git accepts', () => {
    expect(value(branchName(DEFAULT_BASE_BRANCH))).toBe(DEFAULT_BASE_BRANCH)
  })
})

describe('A branch prefix is the start of a name Git accepts', () => {
  test('a prefix with folders of its own is kept, without the spaces around it', () => {
    expect(value(branchPrefix(' team/hemera '))).toBe('team/hemera')
  })

  test.each(['', 'my team', 'team..x', '/team', 'team/', 'team:x'])('%j is refused', (prefix) => {
    expect(refusal(branchPrefix(prefix))).toBeInstanceOf(InvalidBranchName)
  })

  test.each([
    ['Hemera', 'hemera'],
    ['Key Road', 'key-road'],
    ['Été 2026 !', 'ete-2026'],
    ['***', 'project'],
  ])('the default prefix of %j is %j, and Git accepts it', (name, slug) => {
    expect(defaultBranchPrefix(name)).toBe(slug)
    expect(gitAccepts(`${slug}/x`)).toBe(true)
  })
})
