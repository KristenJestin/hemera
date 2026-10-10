/**
 * The checkpoints of a mission's Workspace (#140): per repository its `HEAD`, the snapshot tree of
 * its working tree, its base and merge base, and the files from the merge base to the tree with
 * their contents, copied into the database so that they read back without the Workspace.
 *
 * On the engine as it starts, over a data folder of the suite's own, with the machine's `git` on
 * repositories made under the temporary directory: two main checkouts with a remote each, and a
 * linked worktree of each standing for the Workspace's repositories.
 */

import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { Checkpoints, type CheckpointPlace } from '../src/engine/building/checkpoints.ts'
import { createMission } from '../src/engine/missions.ts'
import { createProject } from '../src/engine/projects.ts'
import { Database } from '../src/engine/storage/database.ts'
import { checkpointRepositories, checkpoints } from '../src/engine/storage/schema.ts'
import { commandsEngine } from './commands-engine.ts'
import { git, remote } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('checkpoints'))
  work = realpathSync.native(temporaryFolder('checkpoints-work'))
})
afterEach(removeFolders)

/** A main checkout with its remote, on `main`, and a worktree of it on the mission's branch. */
function repositoryOf(name: string) {
  const main = join(work, 'main', name)
  mkdirSync(main, { recursive: true })
  git(main, 'init', '-q', '-b', 'main')
  git(main, 'commit', '-q', '--allow-empty', '-m', 'base')
  remote(main, join(work, 'remotes', `${name}.git`))
  const worktree = join(work, 'workspace', name)
  git(main, 'worktree', 'add', '-q', '-b', 'mission/readme', worktree, 'origin/main')
  return { main, worktree, base: git(main, 'rev-parse', 'origin/main') }
}

const missionOf = (folder: string) =>
  Effect.gen(function* () {
    const project = yield* createProject({ name: 'Acme', mainCheckout: folder, repositories: [] })
    const mission = yield* createMission({
      projectId: project.id,
      idea: { sentence: 'Write the READMEs', ticket: null },
    })
    return mission.id
  })

describe('A checkpoint of two repositories tells them apart', () => {
  test('two repositories with a README.md each are two rows, the untracked one says so, and the merge base is recorded', async () => {
    const api = repositoryOf('api')
    const front = repositoryOf('front')
    writeFileSync(join(api.worktree, 'README.md'), '# API\n')
    git(api.worktree, 'add', 'README.md')
    git(api.worktree, 'commit', '-q', '-m', 'readme')
    writeFileSync(join(api.worktree, 'README.md'), '# API\n\nExports the journal.\n')
    writeFileSync(join(front.worktree, 'README.md'), '# Front\n')
    const places: ReadonlyArray<CheckpointPlace> = [
      { name: 'api', folder: api.worktree, baseRef: 'origin/main', baseCommit: api.base },
      { name: 'front', folder: front.worktree, baseRef: 'origin/main', baseCommit: front.base },
    ]

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const missionId = yield* missionOf(work)
          const checkpointsService = yield* Checkpoints
          const id = yield* checkpointsService.take(missionId, 'review', places)
          const repositories = yield* Database.use((database) =>
            database
              .select()
              .from(checkpointRepositories)
              .where(eq(checkpointRepositories.checkpointId, id))
              .orderBy(asc(checkpointRepositories.position)),
          ).pipe(Effect.orDie)
          const [row] = yield* Database.use((database) =>
            database.select().from(checkpoints).where(eq(checkpoints.id, id)),
          ).pipe(Effect.orDie)
          const files = yield* checkpointsService.files(id)
          const readme = yield* checkpointsService.diff(id, 'api', 'README.md')
          return { missionId, row, repositories, files, readme }
        }),
      ),
    )

    expect(seen.row).toMatchObject({ missionId: seen.missionId, kind: 'review' })
    expect(
      seen.repositories.map(({ repository, head, base, mergeBase }) => ({
        repository,
        head,
        base,
        mergeBase,
      })),
    ).toEqual([
      {
        repository: 'api',
        head: git(api.worktree, 'rev-parse', 'HEAD'),
        base: 'origin/main',
        mergeBase: api.base,
      },
      { repository: 'front', head: front.base, base: 'origin/main', mergeBase: front.base },
    ])
    expect(seen.files).toEqual([
      {
        repository: 'api',
        path: 'README.md',
        oldPath: null,
        status: 'A',
        added: 3,
        removed: 0,
        binary: false,
        untracked: false,
        sizeBefore: null,
        sizeAfter: 28,
      },
      {
        repository: 'front',
        path: 'README.md',
        oldPath: null,
        status: 'A',
        added: 1,
        removed: 0,
        binary: false,
        untracked: true,
        sizeBefore: null,
        sizeAfter: 8,
      },
    ])
    expect(Buffer.from(seen.readme?.after?.content ?? []).toString('utf8')).toBe(
      '# API\n\nExports the journal.\n',
    )
  })
})

describe('A checkpoint of a repository with no commit has no HEAD', () => {
  test('its HEAD and merge base are none, and its files are all added from nothing', async () => {
    const fresh = join(work, 'fresh')
    mkdirSync(fresh)
    git(fresh, 'init', '-q', '-b', 'main')
    writeFileSync(join(fresh, 'first.txt'), 'first\n')

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const missionId = yield* missionOf(fresh)
          const checkpointsService = yield* Checkpoints
          const id = yield* checkpointsService.take(missionId, 'round_end', [
            { name: '', folder: fresh, baseRef: null, baseCommit: null },
          ])
          const repositories = yield* Database.use((database) =>
            database
              .select()
              .from(checkpointRepositories)
              .where(eq(checkpointRepositories.checkpointId, id)),
          ).pipe(Effect.orDie)
          return { repositories, files: yield* checkpointsService.files(id) }
        }),
      ),
    )

    expect(seen.repositories).toMatchObject([{ repository: '', head: null, mergeBase: null }])
    expect(seen.files.map(({ path, status, untracked }) => ({ path, status, untracked }))).toEqual([
      { path: 'first.txt', status: 'A', untracked: true },
    ])
  })
})

describe('A Workspace with no repository is checkpointed with none', () => {
  test('the checkpoint is written, with no repository and no file', async () => {
    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const missionId = yield* missionOf(work)
          const checkpointsService = yield* Checkpoints
          const id = yield* checkpointsService.take(missionId, 'review_entry', [])
          const rows = yield* Database.use((database) =>
            database.select().from(checkpoints).where(eq(checkpoints.id, id)),
          ).pipe(Effect.orDie)
          return { rows, files: yield* checkpointsService.files(id) }
        }),
      ),
    )

    expect(seen.rows).toMatchObject([{ kind: 'review_entry' }])
    expect(seen.files).toEqual([])
  })
})

describe('A checkpoint reads the same without its Workspace', () => {
  test('its files, diffs and contents are read from the database after the repositories are removed', async () => {
    const api = repositoryOf('api')
    writeFileSync(join(api.worktree, 'README.md'), '# API\n')

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const missionId = yield* missionOf(work)
          const checkpointsService = yield* Checkpoints
          const id = yield* checkpointsService.take(missionId, 'review', [
            { name: 'api', folder: api.worktree, baseRef: 'origin/main', baseCommit: api.base },
          ])
          const read = () =>
            Effect.all({
              files: checkpointsService.files(id),
              diff: checkpointsService.diff(id, 'api', 'README.md'),
              content: checkpointsService.content(id, 'api', 'README.md', 'after'),
            })
          const before = yield* read()
          rmSync(work, { recursive: true, force: true })
          const after = yield* read()
          return { before, after }
        }),
      ),
    )

    expect(seen.after).toEqual(seen.before)
    expect(Buffer.from(seen.after.content?.content ?? []).toString('utf8')).toBe('# API\n')
  })
})
