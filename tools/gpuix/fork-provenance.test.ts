import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { APPLIED_GPUIX_PATCHES, applyQueue, sha256Of } from './rebuild-fork.ts'
import { recordedSubmodulePointer, verifyFork } from './verify-fork.ts'

const forkPath = resolve(import.meta.dir, '..', '..', '..', 'gpuix')

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  return new TextDecoder().decode(result.stdout).trim()
}

function repositoryWithOneFile(): string {
  const path = mkdtempSync(join(tmpdir(), 'hemera-patch-'))
  git(path, 'init', '-q', '--initial-branch=main')
  git(path, 'config', 'user.name', 'test')
  git(path, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(path, 'file.txt'), 'base content\n')
  git(path, 'add', '-A')
  git(path, 'commit', '-q', '-m', 'chore(test): seed')
  return path
}

/** A mail-formatted patch editing a line that does not exist in the repository. */
function conflictingPatch(directory: string): string {
  mkdirSync(directory, { recursive: true })
  const patch = [
    'From 0000000000000000000000000000000000000000 Mon Sep 17 00:00:00 2001',
    'From: Test <test@example.invalid>',
    'Date: Sun, 13 Sep 2026 00:00:00 +0000',
    'Subject: [PATCH 01/01] test: edit a line that is not there',
    '',
    '---',
    ' file.txt | 2 +-',
    ' 1 file changed, 1 insertion(+), 1 deletion(-)',
    '',
    'diff --git a/file.txt b/file.txt',
    'index 1111111..2222222 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '-a line that is not there',
    '+a replacement',
    '-- ',
    '2.53.0',
    '',
  ].join('\n')
  writeFileSync(join(directory, '0001-conflict.patch'), patch)
  return directory
}

describe('Installation propre', () => {
  test('the rebuilt fork matches its provenance manifest', async () => {
    const report = await verifyFork(forkPath)
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  })

  test('exactly the socle subset of the gpuix queue is applied', async () => {
    const manifest = await Bun.file(join(forkPath, 'PROVENANCE.json')).json()
    const applied = manifest.patches.gpuix.filter((patch: { applied: boolean }) => patch.applied)
    expect(applied).toHaveLength(APPLIED_GPUIX_PATCHES)
    expect(manifest.patches.gpuix.length).toBeGreaterThan(APPLIED_GPUIX_PATCHES)
    expect(manifest.patches.gpui.every((patch: { applied: boolean }) => patch.applied)).toBe(true)
  })

  test('licence files of the rebuilt revision are recorded with their fingerprint', async () => {
    const manifest = await Bun.file(join(forkPath, 'PROVENANCE.json')).json()
    expect(manifest.licences.map((licence: { file: string }) => licence.file)).toEqual([
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
    ])
    for (const licence of manifest.licences) {
      expect(sha256Of(join(forkPath, licence.file))).toBe(licence.sha256)
    }
  })
})

describe('Empreinte non conforme', () => {
  test('a tampered patch file is reported as a fingerprint gap', async () => {
    const path = mkdtempSync(join(tmpdir(), 'hemera-fork-'))
    try {
      git(path, 'init', '-q', '--initial-branch=main')
      git(path, 'config', 'user.name', 'test')
      git(path, 'config', 'user.email', 'test@example.invalid')
      mkdirSync(join(path, 'patches', 'gpuix'), { recursive: true })
      mkdirSync(join(path, 'patches', 'zed'), { recursive: true })
      writeFileSync(join(path, 'patches', 'gpuix', '0001-x.patch'), 'tampered\n')
      writeFileSync(join(path, 'LICENSE'), 'licence\n')
      writeFileSync(join(path, 'THIRD_PARTY_NOTICES.md'), 'notices\n')
      writeFileSync(join(path, 'file.txt'), 'x\n')
      git(path, 'add', '-A')
      git(path, 'commit', '-q', '-m', 'chore(test): seed')
      const base = git(path, 'rev-parse', 'HEAD')

      writeFileSync(
        join(path, 'PROVENANCE.json'),
        JSON.stringify({
          fork: { remote: 'x', baseCommit: base, branch: 'b', headCommit: base, commits: [] },
          gpui: { remote: 'x', baseCommit: base, headCommit: base, commits: [] },
          patches: {
            gpuix: [
              { file: '0001-x.patch', sha256: 'f'.repeat(64), subject: 'x', applied: true },
            ],
            gpui: [],
          },
          licences: [
            { file: 'LICENSE', sha256: sha256Of(join(path, 'LICENSE')) },
            { file: 'THIRD_PARTY_NOTICES.md', sha256: sha256Of(join(path, 'THIRD_PARTY_NOTICES.md')) },
          ],
        }),
      )

      const report = await verifyFork(path)
      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toContain('0001-x.patch has fingerprint')
      expect(report.problems.join('\n')).toContain('f'.repeat(64))
    } finally {
      rmSync(path, { recursive: true, force: true })
    }
  })
})

describe('Patch qui ne s\'applique pas', () => {
  test('a patch that conflicts with the base is reported instead of being forced', () => {
    const repository = repositoryWithOneFile()
    const queue = conflictingPatch(mkdtempSync(join(tmpdir(), 'hemera-queue-')))
    try {
      expect(() => applyQueue(repository, queue, ['0001-conflict.patch'], 1)).toThrow(
        /0001-conflict\.patch does not apply cleanly onto the identified base/,
      )
      // The failed application leaves no half-applied state behind.
      expect(git(repository, 'status', '--porcelain')).toBe('')
      expect(existsSync(join(repository, '.git', 'rebase-apply'))).toBe(false)
    } finally {
      rmSync(repository, { recursive: true, force: true })
      rmSync(queue, { recursive: true, force: true })
    }
  })
})

describe('Aucune dépendance aux spikes', () => {
  test('the gpui submodule pointer resolves in the rebuilt fork', () => {
    const pointer = recordedSubmodulePointer(forkPath)
    expect(pointer).not.toBeNull()
    expect(existsSync(join(forkPath, 'zed', '.git'))).toBe(true)
    expect(git(join(forkPath, 'zed'), 'rev-parse', 'HEAD')).toBe(pointer!)
  })

  test('the rebuilt fork carries its own patch queue', () => {
    expect(existsSync(join(forkPath, 'patches', 'gpuix'))).toBe(true)
    expect(existsSync(join(forkPath, 'patches', 'zed'))).toBe(true)
    expect(git(forkPath, 'ls-files', 'patches').split('\n').length).toBeGreaterThan(
      APPLIED_GPUIX_PATCHES,
    )
  })
})
