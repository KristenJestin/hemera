/**
 * CT-01's mandatory test (#140): what makes the history of a mission survives the cleanup of its
 * Workspace. Two attempts are snapshotted and captured, and a checkpoint taken; then the Workspace
 * is removed, its branch deleted and `git gc --prune=now` run on the repository, so the objects the
 * trees borrowed are gone; every attempt's diff and the checkpoint's read back whole, the same as
 * before, binaries and deletions included, byte for byte.
 *
 * On the engine as it starts, over a data folder of the suite's own, with the machine's `git` on a
 * main checkout, its bare remote and a linked worktree made under the temporary directory.
 */

import { execFileSync } from 'node:child_process'
import { realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { Checkpoints } from '../src/engine/building/checkpoints.ts'
import { type FileDiff, Snapshots } from '../src/engine/building/snapshots.ts'
import { createMission } from '../src/engine/missions.ts'
import { createProject } from '../src/engine/projects.ts'
import { commandsEngine } from './commands-engine.ts'
import { git, remote, repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('history'))
  work = realpathSync.native(temporaryFolder('history-work'))
})
afterEach(removeFolders)

/** Whether a repository still has an object. */
function has(cwd: string, object: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', object], { cwd, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const PICTURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0xff])
const LONG = `${Array.from({ length: 40 }, (_, line) => `export const line${String(line)} = ${String(line)}`).join('\n')}\n`

/** The bytes of a side as Hemera answers it. */
const bytesOf = (side: FileDiff['before']) => Buffer.from(side?.content ?? [])

describe('The history of a mission survives the cleanup of its Workspace', () => {
  test('after the worktree is removed, its branch deleted and git gc --prune=now, every attempt and checkpoint diff reads back whole', async () => {
    const main = repository(join(work, 'acme'), 'main')
    writeFileSync(join(main, 'kept.txt'), 'kept\n')
    git(main, 'add', '.')
    git(main, 'commit', '-q', '-m', 'kept')
    remote(main, join(work, 'remote.git'))
    const base = git(main, 'rev-parse', 'origin/main')
    const worktree = join(work, 'workspace', 'acme')
    git(main, 'worktree', 'add', '-q', '-b', 'mission/history', worktree, 'origin/main')
    const acme = { name: 'acme', folder: worktree }

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* createProject({
            name: 'Acme',
            mainCheckout: main,
            repositories: [],
          })
          const { id: missionId } = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Keep the history', ticket: null },
          })
          const snapshots = yield* Snapshots
          const checkpointsService = yield* Checkpoints

          // The first attempt adds a picture and a long file, and commits them on the branch:
          // their blobs live in the user's repository only.
          const one = yield* snapshots.take(acme, {
            kind: 'attempt',
            missionId,
            attemptId: 'attempt-1',
            side: 'start',
          })
          writeFileSync(join(worktree, 'picture.png'), PICTURE)
          writeFileSync(join(worktree, 'long.ts'), LONG)
          git(worktree, 'add', '.')
          git(worktree, 'commit', '-q', '-m', 'first attempt')
          const oneEnd = yield* snapshots.take(acme, {
            kind: 'attempt',
            missionId,
            attemptId: 'attempt-1',
            side: 'end',
          })
          // The second deletes the picture, renames the long file, and edits the kept one.
          const two = yield* snapshots.take(acme, {
            kind: 'attempt',
            missionId,
            attemptId: 'attempt-2',
            side: 'start',
          })
          rmSync(join(worktree, 'picture.png'))
          renameSync(join(worktree, 'long.ts'), join(worktree, 'renamed.ts'))
          writeFileSync(join(worktree, 'kept.txt'), 'kept, and edited\n')
          git(worktree, 'add', '-A')
          git(worktree, 'commit', '-q', '-m', 'second attempt')
          const twoEnd = yield* snapshots.take(acme, {
            kind: 'attempt',
            missionId,
            attemptId: 'attempt-2',
            side: 'end',
          })
          for (const [from, to] of [
            [one, oneEnd],
            [two, twoEnd],
          ] as const) {
            yield* snapshots.capture(
              missionId,
              acme,
              from,
              to,
              yield* snapshots.changed(missionId, acme, from, to),
            )
          }
          const checkpoint = yield* checkpointsService.take(missionId, 'review', [
            { name: 'acme', folder: worktree, baseRef: 'origin/main', baseCommit: base },
          ])

          const read = () =>
            Effect.all({
              first: snapshots.diff(missionId, acme, one, oneEnd),
              second: snapshots.diff(missionId, acme, two, twoEnd),
              picture: snapshots.read(missionId, acme, oneEnd, 'picture.png'),
              files: checkpointsService.files(checkpoint),
              renamed: checkpointsService.diff(checkpoint, 'acme', 'renamed.ts'),
              kept: checkpointsService.diff(checkpoint, 'acme', 'kept.txt'),
            })
          const before = yield* read()
          const picture = git(main, 'rev-parse', 'mission/history~1:picture.png')

          git(main, 'worktree', 'remove', '--force', worktree)
          git(main, 'branch', '-D', 'mission/history')
          git(main, 'reflog', 'expire', '--expire=now', '--all')
          git(main, 'gc', '-q', '--prune=now')
          const gone = !has(main, picture)

          const after = yield* read()
          return { before, after, gone }
        }),
      ),
    )

    // The objects the trees borrowed are gone from the user's repository: what reads back is the
    // database's copy.
    expect(seen.gone).toBe(true)
    expect(seen.after).toEqual(seen.before)

    const { first, second } = seen.after
    const firstBy = new Map(first.map((file) => [file.path, file]))
    expect(first.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: 'long.ts', status: 'A' },
      { path: 'picture.png', status: 'A' },
    ])
    expect(bytesOf(firstBy.get('picture.png')?.after ?? null).equals(PICTURE)).toBe(true)
    expect(firstBy.get('picture.png')?.added).toBeNull()
    expect(bytesOf(firstBy.get('long.ts')?.after ?? null).toString('utf8')).toBe(LONG)
    expect(bytesOf(seen.after.picture).equals(PICTURE)).toBe(true)

    const secondBy = new Map(second.map((file) => [file.path, file]))
    expect(second.map(({ path, oldPath, status }) => ({ path, oldPath, status }))).toEqual([
      { path: 'kept.txt', oldPath: null, status: 'M' },
      { path: 'picture.png', oldPath: null, status: 'D' },
      { path: 'renamed.ts', oldPath: 'long.ts', status: 'R' },
    ])
    expect(bytesOf(secondBy.get('picture.png')?.before ?? null).equals(PICTURE)).toBe(true)
    expect(secondBy.get('picture.png')?.after).toBeNull()
    expect(bytesOf(secondBy.get('kept.txt')?.before ?? null).toString('utf8')).toBe('kept\n')
    expect(bytesOf(secondBy.get('kept.txt')?.after ?? null).toString('utf8')).toBe(
      'kept, and edited\n',
    )

    expect(seen.after.files.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: 'kept.txt', status: 'M' },
      { path: 'renamed.ts', status: 'A' },
    ])
    expect(bytesOf(seen.after.renamed?.after ?? null).toString('utf8')).toBe(LONG)
    expect(bytesOf(seen.after.kept?.before ?? null).toString('utf8')).toBe('kept\n')
  })
})
