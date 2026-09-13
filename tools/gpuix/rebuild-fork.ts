#!/usr/bin/env bun
/**
 * Rebuilds the GPUiX fork from its identified base and patch queue (design D01).
 *
 * The fork is reconstructed, never copied: the queue is applied onto the base commit of
 * the upstream repository, the GPUI submodule is rebuilt from its own base and patches,
 * the submodule pointer is restored to the commit that was actually rebuilt, and every
 * input is recorded with its SHA-256 in a provenance manifest.
 *
 *   bun tools/gpuix/rebuild-fork.ts --import-from <dir>   import the queue, then rebuild
 *   bun tools/gpuix/rebuild-fork.ts                       rebuild from the fork's own queue
 */

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Upstream repository of the renderer fork. */
export const FORK_REMOTE = 'https://github.com/remorses/gpuix'

/**
 * Commit the GPUiX queue applies onto: upstream `main` as pulled on 2026-09-13.
 *
 * Design D01 named `a24b4a42`, the commit the queue was first written against. The base was
 * moved forward to current upstream so the font patch below is written against live code;
 * the whole queue was replayed onto it, only the submodule pointer conflicting.
 */
export const FORK_BASE_COMMIT = '0fac5c941e8431261605eaf0f48d8528322b414d'

/** Upstream repository of the GPUI submodule. */
export const GPUI_REMOTE = 'https://github.com/remorses/zed.git'

/** Branch holding the rebuilt fork. */
export const FORK_BRANCH = 'hemera/0.7.0-hemera.1'

/** Patches applied to the socle; the rest of the queue is kept as a reference only. */
export const APPLIED_GPUIX_PATCHES = 9

/** Files whose licence terms are recorded with the rebuilt revision. */
const LICENCE_FILES = ['LICENSE', 'THIRD_PARTY_NOTICES.md']

export interface PatchRecord {
  file: string
  sha256: string
  subject: string
  applied: boolean
}

export interface CommitRecord {
  sha: string
  subject: string
}

export interface ProvenanceManifest {
  fork: {
    remote: string
    baseCommit: string
    branch: string
    /** Last commit of the rebuild; the commit recording this manifest sits on top of it. */
    headCommit: string
    commits: CommitRecord[]
  }
  gpui: {
    remote: string
    baseCommit: string
    headCommit: string
    commits: CommitRecord[]
  }
  patches: { gpuix: PatchRecord[]; hemera: PatchRecord[]; gpui: PatchRecord[] }
  licences: { file: string; sha256: string }[]
}

interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

function run(command: string[], cwd: string): CommandResult {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const decoder = new TextDecoder()
  return {
    ok: result.exitCode === 0,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  }
}

function mustRun(command: string[], cwd: string): string {
  const result = run(command, cwd)
  if (!result.ok) {
    throw new Error(`${command.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

export function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Subject line of a mail-formatted patch, without its bracketed patch-number prefix. */
export function patchSubject(path: string): string {
  const lines = readFileSync(path, 'utf8').split('\n')
  const index = lines.findIndex((line) => line.startsWith('Subject: '))
  if (index === -1) return ''
  let subject = lines[index]!.slice('Subject: '.length)
  for (let next = index + 1; next < lines.length && lines[next]!.startsWith(' '); next += 1) {
    subject += lines[next]!.slice(1)
  }
  return subject.replace(/^\[PATCH[^\]]*\]\s*/, '').trim()
}

function patchFilesOf(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.patch'))
    .toSorted()
}

/** Copies the reference queue into the fork so the rebuild no longer reads the spikes. */
export function importQueue(source: string, forkPath: string): void {
  const destination = join(forkPath, 'patches')
  // The Hemera queue lives in the fork only; it is never re-imported from a reference.
  for (const family of ['gpuix', 'zed']) {
    const from = join(source, family)
    if (!existsSync(from)) throw new Error(`patch queue ${from} not found`)
    rmSync(join(destination, family), { recursive: true, force: true })
    cpSync(from, join(destination, family), { recursive: true })
  }
}

/**
 * A patch that moves the GPUI submodule pointer conflicts whenever the pointer it expects is
 * not the one the base records. The pointer is restored from the rebuilt submodule at the end
 * of the rebuild, so taking either side here is safe. Returns false for any other conflict.
 */
function resolveSubmodulePointerConflict(repository: string): boolean {
  const unmerged = run(['git', 'diff', '--name-only', '--diff-filter=U'], repository)
  const paths = unmerged.stdout.split('\n').filter((path) => path.length > 0)
  if (paths.length !== 1 || paths[0] !== 'zed') return false
  if (!run(['git', 'add', 'zed'], repository).ok) return false
  return run(['git', '-c', 'core.editor=true', 'am', '--continue'], repository).ok
}

export function applyQueue(
  repository: string,
  patchDirectory: string,
  files: string[],
  appliedCount: number,
): PatchRecord[] {
  const records: PatchRecord[] = []
  for (const [index, file] of files.entries()) {
    const path = join(patchDirectory, file)
    const applied = index < appliedCount
    if (applied) {
      const result = run(['git', 'am', '--3way', path], repository)
      if (!result.ok && !resolveSubmodulePointerConflict(repository)) {
        run(['git', 'am', '--abort'], repository)
        throw new Error(
          `patch ${file} does not apply cleanly onto the identified base: ` +
            `${result.stderr || result.stdout}`,
        )
      }
    }
    records.push({ file, sha256: sha256Of(path), subject: patchSubject(path), applied })
  }
  return records
}

/** Separator emitted by git for the %x1f placeholder. */
const SEPARATOR = String.fromCharCode(31)

function commitsSince(repository: string, base: string): CommitRecord[] {
  const format = `--format=%H%x1f%s`
  const log = mustRun(['git', 'log', '--reverse', format, `${base}..HEAD`], repository)
  if (log.length === 0) return []
  return log.split('\n').map((line) => {
    const [sha, subject] = line.split(SEPARATOR)
    return { sha: sha!, subject: subject! }
  })
}

interface SubmoduleRebuild {
  headCommit: string
  commits: CommitRecord[]
  records: PatchRecord[]
}

/** Submodule pointer the fork base records; the GPUI queue applies onto it. */
export function gpuiBaseCommitOf(forkPath: string): string {
  const entry = mustRun(['git', 'ls-tree', FORK_BASE_COMMIT, 'zed'], forkPath)
  const match = /^160000 commit ([0-9a-f]{40})	/.exec(entry)
  if (match === null) throw new Error(`the fork base records no gpui submodule pointer`)
  return match[1]!
}

/** Rebuilds the GPUI submodule in place and returns the commit that was produced. */
function rebuildSubmodule(
  forkPath: string,
  patchDirectory: string,
  gpuiBase: string,
): SubmoduleRebuild {
  const submodule = join(forkPath, 'zed')
  if (!existsSync(join(submodule, '.git'))) {
    mustRun(['git', 'init', '-q', '--initial-branch=gpuix', submodule], forkPath)
    mustRun(['git', 'remote', 'add', 'origin', GPUI_REMOTE], submodule)
  }
  if (!run(['git', 'cat-file', '-e', `${gpuiBase}^{commit}`], submodule).ok) {
    mustRun(['git', 'fetch', '--depth', '1', '--no-tags', 'origin', gpuiBase], submodule)
  }
  mustRun(['git', 'checkout', '-q', '-B', 'hemera/gpui', gpuiBase], submodule)

  const files = patchFilesOf(patchDirectory)
  const records = applyQueue(submodule, patchDirectory, files, files.length)
  return {
    headCommit: mustRun(['git', 'rev-parse', 'HEAD'], submodule),
    commits: commitsSince(submodule, gpuiBase),
    records,
  }
}

export async function rebuild(forkPath: string): Promise<ProvenanceManifest> {
  if (!run(['git', 'cat-file', '-e', `${FORK_BASE_COMMIT}^{commit}`], forkPath).ok) {
    throw new Error(`${forkPath} does not contain the base commit ${FORK_BASE_COMMIT}`)
  }

  // Resetting the branch onto the base drops a queue already tracked by a previous rebuild,
  // so the queue is held aside and put back once the patches have been applied.
  const queue = mkdtempSync(join(tmpdir(), 'hemera-queue-'))
  cpSync(join(forkPath, 'patches'), queue, { recursive: true })
  try {
    return await rebuildFromQueue(forkPath, queue)
  } finally {
    // A failed rebuild must not leave the fork without the queue it was rebuilt from.
    cpSync(queue, join(forkPath, 'patches'), { recursive: true })
    rmSync(queue, { recursive: true, force: true })
  }
}

async function rebuildFromQueue(forkPath: string, queue: string): Promise<ProvenanceManifest> {
  mustRun(['git', 'checkout', '-q', '-B', FORK_BRANCH, FORK_BASE_COMMIT], forkPath)

  const gpuixPatchDirectory = join(queue, 'gpuix')
  const hemeraPatchDirectory = join(queue, 'hemera')
  const gpuiPatchDirectory = join(queue, 'zed')
  const gpuixFiles = patchFilesOf(gpuixPatchDirectory)
  const gpuixRecords = applyQueue(forkPath, gpuixPatchDirectory, gpuixFiles, APPLIED_GPUIX_PATCHES)

  const hemeraFiles = patchFilesOf(hemeraPatchDirectory)
  const hemeraRecords = applyQueue(forkPath, hemeraPatchDirectory, hemeraFiles, hemeraFiles.length)

  const gpuiBase = gpuiBaseCommitOf(forkPath)
  const gpui = rebuildSubmodule(forkPath, gpuiPatchDirectory, gpuiBase)

  // The queue bumps the submodule pointer to a commit rebuilt elsewhere; restore it to the
  // commit this run actually produced, so the recorded pointer resolves locally.
  mustRun(['git', 'update-index', '--cacheinfo', `160000,${gpui.headCommit},zed`], forkPath)
  mustRun(
    ['git', 'commit', '-q', '-m', 'build(gpuix): restore the rebuilt gpui submodule pointer'],
    forkPath,
  )

  const manifest: ProvenanceManifest = {
    fork: {
      remote: FORK_REMOTE,
      baseCommit: FORK_BASE_COMMIT,
      branch: FORK_BRANCH,
      headCommit: mustRun(['git', 'rev-parse', 'HEAD'], forkPath),
      commits: commitsSince(forkPath, FORK_BASE_COMMIT),
    },
    gpui: {
      remote: GPUI_REMOTE,
      baseCommit: gpuiBase,
      headCommit: gpui.headCommit,
      commits: gpui.commits,
    },
    patches: { gpuix: gpuixRecords, hemera: hemeraRecords, gpui: gpui.records },
    licences: LICENCE_FILES.map((file) => ({ file, sha256: sha256Of(join(forkPath, file)) })),
  }

  cpSync(queue, join(forkPath, 'patches'), { recursive: true })

  const manifestPath = join(forkPath, 'PROVENANCE.json')
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  mustRun(['git', 'add', 'PROVENANCE.json', 'patches'], forkPath)
  mustRun(
    ['git', 'commit', '-q', '-m', 'docs(gpuix): record the provenance of the rebuilt fork'],
    forkPath,
  )
  return manifest
}

if (import.meta.main) {
  const forkPath = resolve(import.meta.dir, '..', '..', '..', 'gpuix')
  const importIndex = process.argv.indexOf('--import-from')
  if (importIndex !== -1) {
    const source = process.argv[importIndex + 1]
    if (source === undefined) {
      console.error('--import-from requires a directory holding gpuix/ and zed/ patches')
      process.exit(2)
    }
    importQueue(resolve(source), forkPath)
  }
  const manifest = await rebuild(forkPath)
  console.log(`fork ${manifest.fork.branch} at ${manifest.fork.headCommit}`)
  for (const commit of manifest.fork.commits) {
    console.log(`  ${commit.sha.slice(0, 7)} ${commit.subject}`)
  }
  console.log(`gpui submodule at ${manifest.gpui.headCommit}`)
  const applied = manifest.patches.gpuix.filter((patch) => patch.applied).length
  console.log(
    `patches: ${applied} of ${manifest.patches.gpuix.length} gpuix applied, ` +
      `${manifest.patches.hemera.length} hemera applied, ` +
      `${manifest.patches.gpui.length} gpui applied`,
  )
}
