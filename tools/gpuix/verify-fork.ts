#!/usr/bin/env bun
/**
 * Checks a rebuilt GPUiX fork against its provenance manifest: resulting commits, patch
 * fingerprints, licence files, and a GPUI submodule pointer that resolves locally.
 *
 *   bun tools/gpuix/verify-fork.ts
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  APPLIED_GPUIX_PATCHES,
  type ProvenanceManifest,
  sha256Of,
} from './rebuild-fork.ts'

export interface VerificationReport {
  ok: boolean
  problems: string[]
}

function run(command: string[], cwd: string): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  return { ok: result.exitCode === 0, stdout: new TextDecoder().decode(result.stdout).trim() }
}

/** Gitlink recorded for the GPUI submodule in the fork's current tree. */
export function recordedSubmodulePointer(forkPath: string): string | null {
  const entry = run(['git', 'ls-tree', 'HEAD', 'zed'], forkPath)
  const match = /^160000 commit ([0-9a-f]{40})\t/.exec(entry.stdout)
  return match === null ? null : match[1]!
}

export async function verifyFork(forkPath: string): Promise<VerificationReport> {
  const problems: string[] = []
  const manifestPath = join(forkPath, 'PROVENANCE.json')
  if (!existsSync(manifestPath)) {
    return { ok: false, problems: [`no provenance manifest at ${manifestPath}`] }
  }
  const manifest = (await Bun.file(manifestPath).json()) as ProvenanceManifest

  if (!run(['git', 'merge-base', '--is-ancestor', manifest.fork.baseCommit, 'HEAD'], forkPath).ok) {
    problems.push(`the identified base ${manifest.fork.baseCommit} is not an ancestor of HEAD`)
  }
  for (const commit of manifest.fork.commits) {
    if (!run(['git', 'cat-file', '-e', `${commit.sha}^{commit}`], forkPath).ok) {
      problems.push(`recorded commit ${commit.sha} (${commit.subject}) is missing from the fork`)
    }
  }

  const applied = manifest.patches.gpuix.filter((patch) => patch.applied)
  if (applied.length !== APPLIED_GPUIX_PATCHES) {
    problems.push(
      `${applied.length} gpuix patches are recorded as applied, expected ${APPLIED_GPUIX_PATCHES}`,
    )
  }
  for (const [family, records] of [
    ['gpuix', manifest.patches.gpuix],
    ['zed', manifest.patches.gpui],
  ] as const) {
    for (const record of records) {
      const path = join(forkPath, 'patches', family, record.file)
      if (!existsSync(path)) {
        problems.push(`patch ${family}/${record.file} is missing from the fork`)
        continue
      }
      const digest = sha256Of(path)
      if (digest !== record.sha256) {
        problems.push(
          `patch ${family}/${record.file} has fingerprint ${digest}, manifest records ${record.sha256}`,
        )
      }
    }
  }

  for (const licence of manifest.licences) {
    const path = join(forkPath, licence.file)
    if (!existsSync(path)) {
      problems.push(`licence file ${licence.file} is missing from the rebuilt revision`)
      continue
    }
    const digest = sha256Of(path)
    if (digest !== licence.sha256) {
      problems.push(
        `licence file ${licence.file} has fingerprint ${digest}, manifest records ${licence.sha256}`,
      )
    }
  }

  const pointer = recordedSubmodulePointer(forkPath)
  if (pointer === null) {
    problems.push('the fork tree records no gpui submodule pointer')
  } else if (pointer !== manifest.gpui.headCommit) {
    problems.push(
      `the gpui submodule pointer is ${pointer}, manifest records ${manifest.gpui.headCommit}`,
    )
  } else if (!run(['git', 'cat-file', '-e', `${pointer}^{commit}`], join(forkPath, 'zed')).ok) {
    problems.push(`the gpui submodule pointer ${pointer} does not resolve in the checked out zed`)
  }

  return { ok: problems.length === 0, problems }
}

if (import.meta.main) {
  const forkPath = resolve(import.meta.dir, '..', '..', '..', 'gpuix')
  const report = await verifyFork(forkPath)
  for (const problem of report.problems) console.error(problem)
  console.log(report.ok ? 'fork provenance verified' : `${report.problems.length} problems`)
  if (!report.ok) process.exit(1)
}
