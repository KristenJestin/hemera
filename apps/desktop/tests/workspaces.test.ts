/**
 * Workspaces: made over the Project's repositories, observed, and removed.
 *
 * Each test runs on a data folder and on repositories made for it under the temporary directory
 * by the machine's own `git`, with a bare repository on the same disk as each one's remote.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_BASE_BRANCH } from '@hemera/core/domain'
import {
  DetachedAt,
  InvalidWorkspaceName,
  NewBranch,
  type Project,
  RemovalRefused,
  WorkspaceRefused,
  type WorkspaceRepositoryStatus,
} from '@hemera/ipc'
import { Effect, Fiber, Match, Predicate, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { readEvents } from '../src/engine/journal.ts'
import { prepareWorkspace } from '../src/engine/preparation.ts'
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  workspaceChanges,
  workspaceStatus,
} from '../src/engine/workspaces.ts'
import { commitOnRemote, git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import {
  REPOSITORIES,
  atlas,
  atlasOnDisk,
  opened,
  refusedBy,
  workspaceEngine,
} from './workspace-engine.ts'

let data: string
let work: string
let main: string

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('workspaces'))
  work = realpathSync.native(temporaryFolder('workspaces-work'))
  main = atlasOnDisk(work)
  await opened(data)
})
afterEach(removeFolders)

const ids = (project: Project) => project.repositories.map((one) => one.id)

/** A Workspace on new branches over every repository of Atlas, made and prepared. */
const made = (name = 'login-form') =>
  Effect.gen(function* () {
    const project = yield* atlas(main)
    const workspace = yield* createWorkspace({
      projectId: project.id,
      name,
      repositories: ids(project),
      mode: NewBranch.make({}),
    })
    return { project, workspace: yield* prepareWorkspace(workspace.id) }
  })

const describedState = (status: WorkspaceRepositoryStatus) =>
  Match.value(status.state).pipe(
    Match.tagsExhaustive({
      WorktreeRead: ({ branch, changed, ahead, behind }) =>
        `${branch ?? 'detached'} changed=${changed.join(',')} ahead=${String(ahead)} behind=${String(behind)}`,
      WorktreeUnreadable: ({ reason }) => `unreadable: ${reason}`,
      WorktreeNotMade: ({ step }) => `not made: ${step}`,
    }),
  )

describe('A Workspace over three repositories gets three worktrees on new branches', () => {
  test('each from its repository’s up-to-date base, whose commit is recorded', async () => {
    // Someone else pushed to api's base since the clone: the Workspace starts from their commit.
    const theirs = commitOnRemote(join(work, 'remotes', 'api.git'), DEFAULT_BASE_BRANCH, work)

    const { workspace } = await workspaceEngine(data)(made())

    expect(workspace.folder).toBe(join(data, 'workspaces', workspace.projectId, 'login-form'))
    expect(workspace.branch).toBe('atlas/login-form')
    expect(workspace.preparation).toBe('ready')
    expect(workspace.repositories.map((one) => one.path)).toEqual([...REPOSITORIES])
    for (const repository of workspace.repositories) {
      expect(repository.worktree).toBe(join(workspace.folder, repository.path))
      expect(git(repository.worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('atlas/login-form')
      expect(git(repository.worktree, 'rev-parse', 'HEAD')).toBe(repository.base.commit)
      expect(repository.base.ref).toBe(`refs/remotes/origin/${DEFAULT_BASE_BRANCH}`)
      expect(Predicate.isTagged(repository.base.freshness, 'FetchedNow')).toBe(true)
    }
    expect(workspace.repositories[0]?.base.commit).toBe(theirs)
    // The user's own checkout is where it was: no branch of theirs moved.
    expect(git(join(main, 'api'), 'rev-parse', 'HEAD')).not.toBe(theirs)
  })

  test('only the repositories the caller chose get a worktree', async () => {
    const workspace = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const created = yield* createWorkspace({
          projectId: project.id,
          name: 'api-only',
          repositories: [project.repositories[0]?.id ?? ''],
          mode: NewBranch.make({}),
        })
        return yield* prepareWorkspace(created.id)
      }),
    )
    expect(workspace.repositories.map((one) => one.path)).toEqual(['api'])
    expect(existsSync(join(workspace.folder, 'web'))).toBe(false)
  })

  test('the creation is written to the journal, and told to who follows the Workspaces', async () => {
    const [told, events] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const following = yield* workspaceChanges.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        )
        yield* Effect.yieldNow
        const project = yield* atlas(main)
        yield* createWorkspace({
          projectId: project.id,
          name: 'login-form',
          repositories: ids(project),
          mode: NewBranch.make({}),
        })
        const first = yield* Fiber.join(following)
        return [first, (yield* readEvents({})).events.map((event) => event.type)] as const
      }),
    )
    expect(told[0]?.workspace?.name).toBe('login-form')
    expect(events).toContain('workspace.created')
  })
})

describe('A detached worktree at a given commit in a given folder', () => {
  test('is made on no branch, at that commit, in that folder', async () => {
    const api = join(main, 'api')
    const first = git(api, 'rev-parse', 'HEAD')
    git(api, 'commit', '-q', '--allow-empty', '-m', 'later')
    const folder = join(data, 'probes', 'p1')

    const workspace = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const apiId = project.repositories[0]?.id ?? ''
        const created = yield* createWorkspace({
          projectId: project.id,
          name: 'probe-1',
          repositories: [apiId],
          mode: DetachedAt.make({ folder, commits: { [apiId]: first } }),
        })
        return yield* prepareWorkspace(created.id)
      }),
    )

    expect(workspace.folder).toBe(folder)
    expect(workspace.branch).toBeNull()
    expect(workspace.repositories[0]?.base).toEqual({ commit: first, ref: null, freshness: null })
    const worktree = join(folder, 'api')
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(first)
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD')
  })

  test('a repository without its commit is refused before anything is made', async () => {
    const folder = join(data, 'probes', 'p2')
    const refused = await refusedBy(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        return yield* createWorkspace({
          projectId: project.id,
          name: 'probe-2',
          repositories: ids(project),
          mode: DetachedAt.make({ folder, commits: {} }),
        })
      }),
    )
    expect(refused).toBeInstanceOf(WorkspaceRefused)
    expect(existsSync(folder)).toBe(false)
  })
})

describe('A creation that cannot be made is refused whole', () => {
  test('a name that is a path, a name taken, a folder that exists', async () => {
    const [path, taken, folder] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const asked = (name: string) =>
          createWorkspace({
            projectId: project.id,
            name,
            repositories: ids(project),
            mode: NewBranch.make({}),
          }).pipe(Effect.flip)
        const first = yield* asked('a/b')
        yield* createWorkspace({
          projectId: project.id,
          name: 'twice',
          repositories: ids(project),
          mode: NewBranch.make({}),
        })
        const second = yield* asked('twice')
        mkdirSync(join(data, 'workspaces', project.id, 'there'), { recursive: true })
        return [first, second, yield* asked('there')] as const
      }),
    )
    expect(path).toBeInstanceOf(InvalidWorkspaceName)
    expect(taken).toBeInstanceOf(WorkspaceRefused)
    expect(folder).toBeInstanceOf(WorkspaceRefused)
  })

  test('a branch that already exists in a repository is named', async () => {
    git(join(main, 'web'), 'branch', 'atlas/login-form')
    const refused = await refusedBy(data)(made())
    expect(refused).toBeInstanceOf(WorkspaceRefused)
    expect(refused.message).toContain('atlas/login-form')
    expect(refused.message).toContain('web')
  })
})

describe('Each repository shows its branch, its changes, and its distance to its base', () => {
  test('read now from Git, in a Workspace and in the main checkout', async () => {
    const [inWorkspace, inMain] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const { project, workspace } = yield* made()
        const api = join(workspace.folder, 'api')
        writeFileSync(join(api, 'notes.txt'), 'mine\n')
        git(api, 'commit', '-q', '--allow-empty', '-m', 'mine')
        writeFileSync(join(main, 'web', 'draft.txt'), 'draft\n')
        return [
          yield* workspaceStatus(project.id, workspace.id),
          yield* workspaceStatus(project.id, null),
        ] as const
      }),
    )
    expect(inWorkspace.map(describedState)).toEqual([
      'atlas/login-form changed=notes.txt ahead=1 behind=0',
      'atlas/login-form changed= ahead=0 behind=0',
      'atlas/login-form changed= ahead=0 behind=0',
    ])
    expect(inMain.map(describedState)).toEqual([
      `${DEFAULT_BASE_BRANCH} changed= ahead=0 behind=0`,
      `${DEFAULT_BASE_BRANCH} changed=draft.txt ahead=0 behind=0`,
      `${DEFAULT_BASE_BRANCH} changed= ahead=0 behind=0`,
    ])
  })

  test('a worktree not made yet shows its step and asks Git nothing', async () => {
    const status = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const workspace = yield* createWorkspace({
          projectId: project.id,
          name: 'later',
          repositories: ids(project),
          mode: NewBranch.make({}),
        })
        return yield* workspaceStatus(project.id, workspace.id)
      }),
    )
    expect(status.map(describedState)).toEqual([
      'not made: pending',
      'not made: pending',
      'not made: pending',
    ])
  })
})

describe('A removed Workspace is gone from the disk and from Git', () => {
  test('its worktrees and folder are removed, its branches kept, and Git lists it no more', async () => {
    const [workspace, after] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const prepared = yield* made()
        yield* removeWorkspace(prepared.workspace.id)
        return [prepared.workspace, yield* listWorkspaces(prepared.project.id)] as const
      }),
    )
    expect(existsSync(workspace.folder)).toBe(false)
    expect(after).toEqual([])
    for (const name of REPOSITORIES) {
      expect(git(join(main, name), 'worktree', 'list')).not.toContain('login-form')
      expect(git(join(main, name), 'branch', '--list', 'atlas/login-form')).toContain(
        'atlas/login-form',
      )
    }
  })

  test('uncommitted work refuses the removal, naming the file, and nothing is removed', async () => {
    const [refused, workspace] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const prepared = yield* made()
        const { folder, id } = prepared.workspace
        writeFileSync(join(folder, 'worker', 'unsaved.txt'), 'mine\n')
        const refusal = yield* Effect.flip(removeWorkspace(id))
        return [refusal, yield* getWorkspace(id)] as const
      }),
    )
    expect(refused).toBeInstanceOf(RemovalRefused)
    expect(refused).toMatchObject({ file: 'worker/unsaved.txt' })
    expect(refused.message).toContain('worker/unsaved.txt')
    for (const name of REPOSITORIES) {
      expect(existsSync(join(workspace.folder, name, '.git'))).toBe(true)
    }
  })

  test('a changed tracked file refuses it too', async () => {
    writeFileSync(join(main, 'api', 'tracked.txt'), 'one\n')
    git(join(main, 'api'), 'add', 'tracked.txt')
    git(join(main, 'api'), 'commit', '-q', '-m', 'tracked')
    git(join(main, 'api'), 'push', '-q', 'origin', DEFAULT_BASE_BRANCH)
    const refused = await workspaceEngine(data)(
      Effect.gen(function* () {
        const { workspace } = yield* made()
        writeFileSync(join(workspace.folder, 'api', 'tracked.txt'), 'two\n')
        return yield* Effect.flip(removeWorkspace(workspace.id))
      }),
    )
    expect(refused).toMatchObject({ file: 'api/tracked.txt' })
  })

  test.skipIf(process.platform !== 'win32')(
    'on Windows, a program standing in the folder refuses it, and nothing is half removed',
    async () => {
      const [refused, workspace] = await workspaceEngine(data)(
        Effect.gen(function* () {
          const prepared = yield* made()
          const { folder, id } = prepared.workspace
          // A process whose working folder is inside the worktree: Windows will not let the
          // folder go while it stands there, as an editor holding a file open.
          const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
            cwd: join(folder, 'web'),
            stdio: 'ignore',
          })
          yield* Effect.sleep('300 millis')
          const refusal = yield* Effect.flip(removeWorkspace(id)).pipe(
            Effect.ensuring(Effect.sync(() => holder.kill())),
          )
          return [refusal, prepared.workspace] as const
        }),
      )
      expect(refused).toBeInstanceOf(RemovalRefused)
      for (const name of REPOSITORIES) {
        expect(existsSync(join(workspace.folder, name, '.git'))).toBe(true)
      }
    },
  )
})
