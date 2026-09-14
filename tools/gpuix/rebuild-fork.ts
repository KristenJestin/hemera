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
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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

/**
 * Identity every reconstruction commits under.
 *
 * A rebuild is not the work of whoever ran it: it is the base and the queue, applied. Signing
 * it with the identity of the machine is what made the same tree produce a different commit.
 */
export const REBUILD_COMMITTER = { name: 'hemera-rebuild', email: 'rebuild@hemera.invalid' }

/**
 * Settings that keep a reconstruction dependent on the base and the queue alone.
 *
 * `git am` stamps the committer at the moment of the run, so the same tree got a different
 * commit every time. Only the identity is pinned here: forcing `core.autocrlf=false` as well
 * makes every file of a clone checked out with the Windows default read as modified, and the
 * rebuild then refuses to switch branches. Line endings are settled on the queue instead, by
 * `stageQueue`, which is the only input the conversion can reach.
 */
const DETERMINISTIC_CONFIG = [
  '-c',
  `user.name=${REBUILD_COMMITTER.name}`,
  '-c',
  `user.email=${REBUILD_COMMITTER.email}`,
]

function run(command: string[], cwd: string, env?: Record<string, string>): CommandResult {
  const invocation =
    command[0] === 'git' ? ['git', ...DETERMINISTIC_CONFIG, ...command.slice(1)] : command
  const result = Bun.spawnSync(invocation, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  })
  const decoder = new TextDecoder()
  return {
    ok: result.exitCode === 0,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  }
}

function mustRun(command: string[], cwd: string, env?: Record<string, string>): string {
  const result = run(command, cwd, env)
  if (!result.ok) {
    throw new Error(`${command.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

export function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Fingerprint of a text file, as the lines it declares rather than as the checkout wrote them.
 *
 * A clone made with the Windows default writes CRLF, so hashing the bytes of the working tree
 * records a property of the machine and not of the revision: the same licence, reconstructed on
 * two hosts, would answer with two fingerprints.
 */
function textSha256Of(path: string): string {
  return createHash('sha256')
    .update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'))
    .digest('hex')
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
 * of the rebuild, so which commit is recorded here does not survive the run.
 *
 * It is written straight into the index, at the pointer the fork base carries. Staging the
 * worktree instead would record whatever the submodule was left at, which is the result of the
 * previous rebuild: the patch commits then hashed differently on a second run than on a first,
 * and on a fresh clone the submodule has no commit checked out at all, so staging it fails.
 * Returns false for any other conflict.
 */
function resolveSubmodulePointerConflict(repository: string, gpuiBase: string): boolean {
  const unmerged = run(['git', 'diff', '--name-only', '--diff-filter=U'], repository)
  const paths = unmerged.stdout.split('\n').filter((path) => path.length > 0)
  if (paths.length !== 1 || paths[0] !== 'zed') return false
  if (!run(['git', 'update-index', '--cacheinfo', `160000,${gpuiBase},zed`], repository).ok) {
    return false
  }
  return run(
    ['git', '-c', 'core.editor=true', 'am', '--committer-date-is-author-date', '--continue'],
    repository,
  ).ok
}

export function applyQueue(
  repository: string,
  patchDirectory: string,
  files: string[],
  appliedCount: number,
  gpuiBase = '',
): PatchRecord[] {
  const records: PatchRecord[] = []
  for (const [index, file] of files.entries()) {
    const path = join(patchDirectory, file)
    const applied = index < appliedCount
    if (applied) {
      const result = run(
        ['git', 'am', '--3way', '--committer-date-is-author-date', path],
        repository,
      )
      if (!result.ok && !resolveSubmodulePointerConflict(repository, gpuiBase)) {
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

/**
 * Date the commits of a reconstruction carry, read from the queue it applied.
 *
 * The two commits a rebuild adds of its own have no patch behind them, so `now` would be the
 * only date available and would differ on every run. The author date of the last applied patch
 * is a property of the queue, which is what a reconstruction is meant to depend on.
 */
function queueDate(repository: string): Record<string, string> {
  const date = mustRun(['git', 'log', '-1', '--format=%aI'], repository)
  return { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
}

/**
 * Copies the patch queue aside, with every patch read as the lines it declares.
 *
 * A checkout converts line endings to the habit of the machine, and a clone made with the
 * Windows default writes the queue itself as CRLF. The patches are the input of the whole
 * reconstruction, so that conversion would decide what the commits contain and two hosts
 * applying the same queue would not reach the same tree. They are normalised here, once, where
 * the queue enters the rebuild.
 */
function stageQueue(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      stageQueue(from, to)
    } else if (entry.name.endsWith('.patch')) {
      writeFileSync(to, readFileSync(from, 'utf8').replaceAll('\r\n', '\n'))
    } else {
      cpSync(from, to)
    }
  }
}

export async function rebuild(forkPath: string): Promise<ProvenanceManifest> {
  if (!run(['git', 'cat-file', '-e', `${FORK_BASE_COMMIT}^{commit}`], forkPath).ok) {
    throw new Error(`${forkPath} does not contain the base commit ${FORK_BASE_COMMIT}`)
  }

  // Resetting the branch onto the base drops a queue already tracked by a previous rebuild,
  // so the queue is held aside and put back once the patches have been applied.
  const queue = mkdtempSync(join(tmpdir(), 'hemera-queue-'))
  stageQueue(join(forkPath, 'patches'), queue)
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
  // Read before the queue runs: a patch that moves the submodule pointer conflicts, and the
  // pointer of the base is what settles it without reading the state the last run left.
  const gpuiBase = gpuiBaseCommitOf(forkPath)
  const gpuixFiles = patchFilesOf(gpuixPatchDirectory)
  const gpuixRecords = applyQueue(
    forkPath,
    gpuixPatchDirectory,
    gpuixFiles,
    APPLIED_GPUIX_PATCHES,
    gpuiBase,
  )

  const hemeraFiles = patchFilesOf(hemeraPatchDirectory)
  const hemeraRecords = applyQueue(
    forkPath,
    hemeraPatchDirectory,
    hemeraFiles,
    hemeraFiles.length,
    gpuiBase,
  )

  const gpui = rebuildSubmodule(forkPath, gpuiPatchDirectory, gpuiBase)

  // The queue bumps the submodule pointer to a commit rebuilt elsewhere; restore it to the
  // commit this run actually produced, so the recorded pointer resolves locally.
  mustRun(['git', 'update-index', '--cacheinfo', `160000,${gpui.headCommit},zed`], forkPath)
  mustRun(
    ['git', 'commit', '-q', '-m', 'build(gpuix): restore the rebuilt gpui submodule pointer'],
    forkPath,
    queueDate(forkPath),
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
    licences: LICENCE_FILES.map((file) => ({ file, sha256: textSha256Of(join(forkPath, file)) })),
  }

  cpSync(queue, join(forkPath, 'patches'), { recursive: true })

  const manifestPath = join(forkPath, 'PROVENANCE.json')
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  mustRun(['git', 'add', 'PROVENANCE.json', 'patches'], forkPath)
  mustRun(
    ['git', 'commit', '-q', '-m', 'docs(gpuix): record the provenance of the rebuilt fork'],
    forkPath,
    queueDate(forkPath),
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
