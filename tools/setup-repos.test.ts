import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FORK_BASE_COMMIT,
  assertDocumentationRootIsNotARepository,
  gitRootOf,
  inspect,
  inspectFork,
  inspectMonorepo,
} from './setup-repos.ts'

function temporaryDocumentationRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-setup-'))
  mkdirSync(join(root, 'sources'), { recursive: true })
  return root
}

function initRepository(path: string): void {
  mkdirSync(path, { recursive: true })
  Bun.spawnSync(['git', 'init', '--initial-branch=main', path], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
}

describe('Initialisation du socle', () => {
  test('two prepared destinations are two distinct Git roots', () => {
    const root = temporaryDocumentationRoot()
    try {
      const sources = join(root, 'sources')
      initRepository(join(sources, 'hemera'))
      initRepository(join(sources, 'gpuix'))

      const monorepo = inspectMonorepo(join(sources, 'hemera'))
      expect(monorepo.state).toBe('ready')
      expect(gitRootOf(join(sources, 'hemera'))).not.toBe(gitRootOf(join(sources, 'gpuix')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the documentation root is refused as a Git repository', () => {
    const root = temporaryDocumentationRoot()
    try {
      initRepository(root)
      expect(() => assertDocumentationRootIsNotARepository(join(root, 'sources'))).toThrow(
        /documentation root/,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an unpatched fork clone is reported as missing the base commit', () => {
    const root = temporaryDocumentationRoot()
    try {
      const fork = join(root, 'sources', 'gpuix')
      initRepository(fork)
      const report = inspectFork(fork)
      expect(report.state).toBe('conflict')
      expect(report.detail).toContain(FORK_BASE_COMMIT)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Dossier déjà occupé', () => {
  test('local work in the fork destination is reported and left intact', () => {
    const root = temporaryDocumentationRoot()
    try {
      const fork = join(root, 'sources', 'gpuix')
      mkdirSync(fork, { recursive: true })
      writeFileSync(join(fork, 'local-work.txt'), 'keep me')

      const report = inspectFork(fork)
      expect(report.state).toBe('conflict')
      expect(report.detail).toContain('local-work.txt')
      expect(Bun.file(join(fork, 'local-work.txt')).size).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('bootstrap instruction files are kept when the monorepo is initialized', () => {
    const root = temporaryDocumentationRoot()
    try {
      const monorepo = join(root, 'sources', 'hemera')
      mkdirSync(monorepo, { recursive: true })
      writeFileSync(join(monorepo, 'CLAUDE.md'), '# instructions')
      writeFileSync(join(monorepo, 'AGENTS.md'), '# instructions')

      const report = inspectMonorepo(monorepo)
      expect(report.state).toBe('pending')
      expect(report.detail).toContain('kept by initialization')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a destination owned by an outer Git root is not re-initialized', () => {
    const root = temporaryDocumentationRoot()
    try {
      initRepository(join(root, 'sources'))
      const monorepo = join(root, 'sources', 'hemera')
      mkdirSync(monorepo, { recursive: true })

      const report = inspectMonorepo(monorepo)
      expect(report.state).toBe('conflict')
      expect(report.detail).toContain('not re-initialized')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Aucun remote configuré', () => {
  test('preparation reports both destinations without requiring a personal remote', () => {
    const root = temporaryDocumentationRoot()
    try {
      const sources = join(root, 'sources')
      initRepository(join(sources, 'hemera'))
      const report = inspect(sources)
      expect(report.destinations.map((destination) => destination.name)).toEqual([
        'hemera',
        'gpuix',
      ])
      expect(report.gitRoots).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
