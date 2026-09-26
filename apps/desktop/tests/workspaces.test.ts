/**
 * The Workspaces of a Project: planned, created, observed and cleaned up (D8-01 to D8-04, D8-14,
 * D8-15).
 *
 * Each suite is named after the scenario of the Spec it covers, and nothing is mocked: the engine
 * is the real one over a database in a temporary folder, Git is the machine's own on real
 * repositories with no remote — so no network is ever asked for — and a command is a real child
 * of the machine running the tests.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect } from 'effect'

import { InvalidRepositoryPathError } from '@hemera/core'
import { Commands } from '#engine/commands/service.ts'
import { GitError, gitLayer, spawnGit } from '#engine/git.ts'
import type { GitSpawn } from '#engine/git.ts'
import { Projects } from '#engine/projects.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import { Preparation } from '#engine/workspaces/preparation.ts'
import { Recipe, RecipeRefusedError } from '#engine/workspaces/recipe.ts'
import {
  CleanupRefusedError,
  CreationRefusedError,
  Workspaces,
} from '#engine/workspaces/workspaces.ts'

import { git } from './repositories.ts'
import { aSessionOf, atlas, atlasMain, saved, workspaceEngine } from './workspace-engine.ts'

let folder: string
let main: string

beforeEach(() => {
  // The engine spells a path the way the filesystem does — `realpathSync.native`, the long form
  // of a short name under a Windows runner — so the fixture is settled the same way before use.
  folder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-workspaces-')))
  main = atlasMain(folder)
  // Two repositories are four `git` processes, and a Windows runner that has just been created
  // starts each one in seconds where a warm machine takes one. The timeout is this suite's own
  // rather than the ten a hook is given by default, and nothing here spends it (#99).
}, 60_000)

afterEach(() => {
  // A worktree and a service stopped by tree are handed back a beat late on Windows, which
  // refuses the first attempt with EPERM, as agent-tools.test.ts says.
  rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}, 60_000)

const API = './sources/api'
const FRONT = './sources/front'

/** What the database holds: the Workspaces, their steps and the Journal, counted. */
const counted = Effect.gen(function* () {
  const sql = yield* SqliteClient
  const [row] = yield* sql<{ workspaces: number; steps: number; events: number }>`
    SELECT (SELECT count(*) FROM workspaces) AS workspaces,
           (SELECT count(*) FROM workspace_steps) AS steps,
           (SELECT count(*) FROM domain_events) AS events`
  return row
})

/** The steps of a Workspace, in their order, as their rows hold them. */
const stepsOf = (workspaceId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    return yield* sql<{ kind: string; target: string; state: string; message: string | null }>`
      SELECT kind, target, state, message FROM workspace_steps
      WHERE workspace_id = ${workspaceId} ORDER BY position`
  })

/**
 * One location of a plan, read on its own, as the dialog reads them (D8-04, #110).
 */
const readLocation = (projectId: string, key: string | null, slug: string, relativePath: string) =>
  Effect.gen(function* () {
    const workspaces = yield* Workspaces
    return yield* workspaces.planRepository(projectId, key, slug, relativePath)
  })

/**
 * Every location of a plan, read one after the other, as the dialog does (#110).
 */
const readPlan = (
  projectId: string,
  key: string | null,
  slug: string,
  relativePaths: readonly string[],
) =>
  Effect.gen(function* () {
    const workspaces = yield* Workspaces
    return yield* Effect.forEach(relativePaths, (relativePath) =>
      workspaces.planRepository(projectId, key, slug, relativePath),
    )
  })

/**
 * The plan for `HEM-7`, `login-form`, created as proposed, on what each location was read as
 * (#110).
 */
const created = (projectId: string) =>
  Effect.gen(function* () {
    const workspaces = yield* Workspaces
    const plan = yield* workspaces.plan(projectId, 'HEM-7', 'login-form')
    const reads = yield* readPlan(projectId, 'HEM-7', 'login-form', plan.repositories)
    return yield* workspaces.create(projectId, {
      specId: 'HEM-7',
      name: plan.name,
      repositories: reads
        .filter((one) => one.included)
        .map((one) => ({
          relativePath: one.relativePath,
          base: one.base ?? '',
          branch: one.branch,
        })),
    })
  })

/** The same, prepared: its worktrees made and its recipe run. */
const prepared = (projectId: string) =>
  Effect.gen(function* () {
    const preparation = yield* Preparation
    const workspace = yield* created(projectId)
    return yield* preparation.prepare(workspace.id)
  })

describe('A dedicated Workspace assembles one worktree per repository', () => {
  it('names the folder and every location of it before Git has read any, and writes the Workspace preparing', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const projects = yield* Projects
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const plan = yield* workspaces.plan(project.id, 'HEM-7', 'login-form')
        yield* projects.setBranchPrefix(project.id, project.version, 'hemera')
        const prefixed = yield* readLocation(project.id, 'HEM-7', 'login-form', API)
        const workspace = yield* created(project.id)
        return { plan, prefixed, workspace, steps: yield* stepsOf(workspace.id) }
      }),
    )

    // The prefix is the Project's name as a slug until one is set (D8-04).
    expect(seen.plan.branchPrefix).toBe('atlas')
    expect(seen.plan.gitAvailable).toBe(true)
    // The plan names its locations and reads none of them: the dialog opens on the folder and on
    // the rows, and each row is read on its own afterwards (#110).
    expect(seen.plan.repositories).toEqual([API, FRONT])
    expect(seen.plan.path).toBe(join(seen.plan.root, 'login-form'))
    // One location read on its own: the branch it is checked out on, out of the branches it has
    // here — a branch name as the base, and never the sha it points at (D8-04) — and the branch
    // it would be given under the prefix set since.
    expect(seen.prefixed).toEqual({
      relativePath: API,
      holdsRepository: true,
      branches: ['main'],
      base: 'main',
      detachedCommit: null,
      branch: 'hemera/HEM-7-login-form',
      included: true,
      reason: null,
    })
    // Written preparing, with its two worktree steps, and nothing on disk yet.
    expect(seen.workspace.state).toBe('preparing')
    expect(seen.workspace.specId).toBe('HEM-7')
    expect(seen.steps).toEqual([
      { kind: 'worktree', target: API, state: 'pending', message: null },
      { kind: 'worktree', target: FRONT, state: 'pending', message: null },
    ])
    expect(existsSync(seen.workspace.path)).toBe(false)
    // No remote anywhere: nothing the creation did could have reached a network.
    expect(git(join(main, 'sources', 'api'), 'remote')).toBe('')
    expect(git(join(main, 'sources', 'front'), 'remote')).toBe('')
  })

  it('prepares each worktree on the branch from the local HEAD, and the Workspace is ready', async () => {
    const workspace = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const project = yield* atlas(main, [API, FRONT])
        return yield* prepared(project.id)
      }),
    )

    for (const repository of ['api', 'front']) {
      const worktree = join(workspace.path, 'sources', repository)
      expect(existsSync(join(worktree, '.git'))).toBe(true)
      expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('atlas/HEM-7-login-form')
      expect(git(worktree, 'rev-parse', 'HEAD')).toBe(
        git(join(main, 'sources', repository), 'rev-parse', 'HEAD'),
      )
    }
    expect(workspace.path.endsWith(join('workspaces', workspace.projectId, 'login-form'))).toBe(
      true,
    )
    expect(workspace.state).toBe('ready')
    expect(workspace.specId).toBe('HEM-7')
    expect(workspace.repositories.map((one) => one.relativePath)).toEqual([API, FRONT])
    expect(git(join(main, 'sources', 'api'), 'remote')).toBe('')
  })
})

describe('A dedicated Workspace is made from the Project settings, with no Spec', () => {
  it('plans <prefix>/<slug> with no key, and is prepared with its worktrees and its recipe', async () => {
    writeFileSync(join(main, 'sources', 'api', '.env'), 'PORT=3000\n')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const preparation = yield* Preparation
        const project = yield* atlas(main, [API, FRONT])
        yield* (yield* Recipe).add(project.id, {
          kind: 'copy',
          base: API,
          path: '.env',
          commandId: null,
          line: null,
          lineWindows: null,
          lineLinux: null,
        })
        const plan = yield* workspaces.plan(project.id, null, 'spike')
        const reads = yield* readPlan(project.id, null, 'spike', plan.repositories)
        const workspace = yield* workspaces.create(project.id, {
          specId: null,
          name: plan.name,
          repositories: reads
            .filter((one) => one.included)
            .map((one) => ({
              relativePath: one.relativePath,
              base: one.base ?? '',
              branch: one.branch,
            })),
        })
        const ready = yield* preparation.prepare(workspace.id)
        return { plan, reads, ready, steps: yield* preparation.steps(workspace.id) }
      }),
    )

    expect(seen.reads.map((one) => one.branch)).toEqual(['atlas/spike', 'atlas/spike'])
    expect(seen.ready).toMatchObject({ state: 'ready', specId: null, dedicated: true })
    expect(seen.steps.map((step) => [step.kind, step.state])).toEqual([
      ['worktree', 'done'],
      ['worktree', 'done'],
      ['copy', 'done'],
    ])
    for (const repository of ['api', 'front']) {
      const worktree = join(seen.ready.path, 'sources', repository)
      expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('atlas/spike')
    }
    expect(readFileSync(join(seen.ready.path, 'sources', 'api', '.env'), 'utf8')).toBe(
      'PORT=3000\n',
    )
  })
})

describe('A repository on no branch proposes the commit it is on', () => {
  it('names the commit as the base, beside its short hash, and lists the branches it has', async () => {
    const api = join(main, 'sources', 'api')
    git(api, 'branch', 'release')
    git(api, 'checkout', '--detach')
    const read = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const project = yield* atlas(main, [API])
        return yield* readLocation(project.id, 'HEM-7', 'login-form', API)
      }),
    )

    // A hash is read where no branch name can stand for it: the commit it is on, said as such,
    // its short form as the hint the dialog shows, and the branches still there to choose instead.
    expect(read).toMatchObject({
      relativePath: API,
      holdsRepository: true,
      branches: ['main', 'release'],
      base: git(api, 'rev-parse', 'HEAD'),
      detachedCommit: git(api, 'rev-parse', '--short', 'HEAD'),
      included: true,
    })
  })

  it('proposes nothing to start from in a repository with no commit yet', async () => {
    const tools = join(main, 'sources', 'tools')
    mkdirSync(tools, { recursive: true })
    git(tools, 'init', '-q', '-b', 'main')
    const read = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const project = yield* atlas(main, [API, './sources/tools'])
        return yield* readLocation(project.id, 'HEM-7', 'login-form', './sources/tools')
      }),
    )

    expect(read).toMatchObject({
      relativePath: './sources/tools',
      holdsRepository: true,
      branches: [],
      base: null,
      detachedCommit: null,
      included: false,
      // Nothing was refused: a repository with no commit yet is not a repository to report.
      reason: null,
    })
  })
})

describe('A repository whose head fails once is still read', () => {
  it('reads it again, and answers as it is, with nothing to report', async () => {
    // A machine at work: the first read of one repository's head fails, and the second answers.
    // The repositories are Git's own and the read that fails is a read of Git itself: the read of
    // that location survives it, nothing of it taken on trust (D8-04, #102, #110).
    let reads = 0
    const once: GitSpawn = (program, cwd, args, limit) => {
      const isHead = args.some((one) => one.startsWith('--format=%(HEAD)'))
      if (!cwd.endsWith(join('sources', 'api')) || !isHead) {
        return spawnGit(program, cwd, args, limit)
      }
      reads += 1
      return reads === 1
        ? Effect.fail(
            new GitError({
              args,
              cwd,
              stderr: 'fatal: a moment of it, and no more',
            }),
          )
        : spawnGit(program, cwd, args, limit)
    }

    const read = await workspaceEngine(
      folder,
      undefined,
      undefined,
      undefined,
      gitLayer('git', once),
    )(
      Effect.gen(function* () {
        const project = yield* atlas(main, [API, FRONT])
        return yield* readLocation(project.id, 'HEM-7', 'login-form', API)
      }),
    )

    // It was read twice — the refusal, then the answer — and answered as it is.
    expect(reads).toBe(2)
    expect(read).toMatchObject({
      relativePath: API,
      holdsRepository: true,
      branches: ['main'],
      base: 'main',
      detachedCommit: null,
      included: true,
      reason: null,
    })
  })
})

describe('A repository Git keeps refusing is shown with its reason, not ticked', () => {
  it('keeps it in the plan with the words Git wrote, and makes no worktree of it', async () => {
    const billing = join(main, 'sources', 'billing')
    mkdirSync(billing, { recursive: true })
    // A `.git` Git cannot make anything of, refused every time it is asked.
    writeFileSync(join(billing, '.git'), 'gitdir: /nowhere/billing\n')

    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const project = yield* atlas(main, [API, './sources/billing'])
        const read = yield* readLocation(project.id, 'HEM-7', 'login-form', './sources/billing')
        const workspace = yield* created(project.id)
        return { read, steps: yield* stepsOf(workspace.id) }
      }),
    )

    expect(seen.read).toMatchObject({
      relativePath: './sources/billing',
      holdsRepository: false,
      branches: [],
      base: null,
      detachedCommit: null,
      included: false,
    })
    // What Git said, in the read's own words, where a location that holds no repository at all
    // says nothing (#110).
    expect(seen.read.reason).toMatch(/^Git could not read this repository: fatal: /)
    expect(seen.steps).toEqual([
      { kind: 'worktree', target: API, state: 'pending', message: null },
      {
        kind: 'worktree',
        target: './sources/billing',
        state: 'skipped',
        message: './sources/billing holds no repository in main',
      },
    ])
  })
})

describe('A location without a repository gets no worktree', () => {
  it('is not proposed, and its worktree step is skipped naming it', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const project = yield* atlas(main, [API, './docs', FRONT])
        const docs = yield* readLocation(project.id, 'HEM-7', 'login-form', './docs')
        const workspace = yield* created(project.id)
        return { docs, steps: yield* stepsOf(workspace.id) }
      }),
    )

    expect(seen.docs).toMatchObject({
      relativePath: './docs',
      holdsRepository: false,
      base: null,
      included: false,
    })
    expect(seen.steps).toEqual([
      { kind: 'worktree', target: API, state: 'pending', message: null },
      {
        kind: 'worktree',
        target: './docs',
        state: 'skipped',
        message: './docs holds no repository in main',
      },
      { kind: 'worktree', target: FRONT, state: 'pending', message: null },
    ])
    // Nothing was initialised there.
    expect(existsSync(join(main, 'docs', '.git'))).toBe(false)
  })

  it('assembles the other repositories, and the Workspace is ready', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const project = yield* atlas(main, [API, './docs', FRONT])
        const workspace = yield* prepared(project.id)
        return { workspace, steps: yield* stepsOf(workspace.id) }
      }),
    )

    expect(seen.steps.map((step) => step.state)).toEqual(['done', 'skipped', 'done'])
    expect(seen.workspace.state).toBe('ready')
    expect(existsSync(join(seen.workspace.path, 'sources', 'front', '.git'))).toBe(true)
    expect(existsSync(join(seen.workspace.path, 'docs'))).toBe(false)
    expect(existsSync(join(main, 'docs', '.git'))).toBe(false)
  })
})

describe('A failed check refuses the whole creation', () => {
  /** A creation from the plan, changed by `edit`, and what it left behind. */
  const refusedWith = (
    edit: (
      draft: { relativePath: string; base: string; branch: string }[],
    ) => { relativePath: string; base: string; branch: string }[],
    // What the suite puts at the Workspace's path before the creation, if anything.
    occupy: (path: string) => void = () => undefined,
  ) =>
    workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const before = yield* counted
        const plan = yield* workspaces.plan(project.id, 'HEM-7', 'login-form')
        const reads = yield* readPlan(project.id, 'HEM-7', 'login-form', plan.repositories)
        occupy(plan.path)
        const refused = yield* Effect.flip(
          workspaces.create(project.id, {
            specId: 'HEM-7',
            name: 'login-form',
            repositories: edit(
              reads
                .filter((one) => one.included)
                .map((one) => ({
                  relativePath: one.relativePath,
                  base: one.base ?? '',
                  branch: one.branch,
                })),
            ),
          }),
        )
        return { refused, before, after: yield* counted, path: plan.path }
      }),
    )

  it('refuses a base that does not resolve locally', async () => {
    const seen = await refusedWith((draft) =>
      draft.map((one) => (one.relativePath === API ? { ...one, base: 'a1b2c3' } : one)),
    )

    expect(seen.refused).toBeInstanceOf(CreationRefusedError)
    expect(seen.refused).toMatchObject({ check: 'base' })
    expect(seen.refused.message).toBe('the base a1b2c3 of ./sources/api does not resolve locally')
    expect(seen.after).toEqual(seen.before)
    expect(existsSync(seen.path)).toBe(false)
  })

  it('refuses a branch that already exists', async () => {
    git(join(main, 'sources', 'front'), 'branch', 'atlas/HEM-7-login-form')
    const seen = await refusedWith((draft) => draft)

    expect(seen.refused).toMatchObject({ check: 'branch' })
    expect(seen.refused.message).toBe(
      'a branch named atlas/HEM-7-login-form already exists in ./sources/front',
    )
    expect(seen.after).toEqual(seen.before)
    expect(existsSync(seen.path)).toBe(false)
    // The branch was only looked at: the api repository has none.
    expect(git(join(main, 'sources', 'api'), 'branch', '--list', 'atlas/*')).toBe('')
  })

  it('refuses a branch name Git would not take', async () => {
    const seen = await refusedWith((draft) =>
      draft.map((one) => (one.relativePath === FRONT ? { ...one, branch: 'atlas/HEM 7..' } : one)),
    )

    expect(seen.refused).toMatchObject({ check: 'branch' })
    expect(seen.refused.message).toBe(
      'atlas/HEM 7.. is not a branch name Git takes, in ./sources/front',
    )
    expect(seen.after).toEqual(seen.before)
    expect(existsSync(seen.path)).toBe(false)
    expect(git(join(main, 'sources', 'api'), 'branch', '--list', 'atlas/*')).toBe('')
  })

  it('refuses a folder that already exists', async () => {
    const seen = await refusedWith(
      (draft) => draft,
      (path) => {
        mkdirSync(path, { recursive: true })
        writeFileSync(join(path, 'kept.txt'), 'mine\n')
      },
    )

    expect(seen.refused).toMatchObject({ check: 'folder' })
    expect(seen.refused.message).toBe(`the folder ${seen.path} already exists`)
    expect(seen.after).toEqual(seen.before)
    expect(git(join(main, 'sources', 'api'), 'branch', '--list', 'atlas/*')).toBe('')
  })
})

describe('A Workspace on a chosen folder takes the folder’s name', () => {
  it('is ready on that path, with no worktree and no step', async () => {
    const spike = join(folder, 'spike')
    mkdirSync(spike)
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const workspace = yield* workspaces.createOnFolder(project.id, spike)
        const missing = yield* Effect.flip(
          workspaces.createOnFolder(project.id, join(folder, 'nowhere')),
        )
        const twice = yield* Effect.flip(workspaces.createOnFolder(project.id, spike))
        return { workspace, missing, twice, steps: yield* stepsOf(workspace.id) }
      }),
    )

    expect(seen.workspace).toMatchObject({
      name: 'spike',
      path: spike,
      state: 'ready',
      specId: null,
      main: false,
      repositories: [],
    })
    expect(seen.steps).toEqual([])
    expect(seen.missing).toMatchObject({ check: 'folder' })
    expect(seen.twice).toMatchObject({ check: 'name' })
  })
})

describe('Each repository shows its branch, commit and changes', () => {
  it('reads each repository of main now, and writes nothing to the database', async () => {
    const api = join(main, 'sources', 'api')
    writeFileSync(join(api, 'tracked.txt'), 'one\n')
    git(api, 'add', 'tracked.txt')
    git(api, 'commit', '-q', '-m', 'tracked')
    writeFileSync(join(api, 'tracked.txt'), 'two\n')
    writeFileSync(join(api, 'staged.txt'), 'new\n')
    git(api, 'add', 'staged.txt')
    writeFileSync(join(api, 'untracked.txt'), 'loose\n')

    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const mainWorkspace = (yield* workspaces.list(project.id))[0]!
        const before = yield* counted
        const status = yield* workspaces.status(mainWorkspace.id)
        return { status, before, after: yield* counted }
      }),
    )

    expect(seen.status[0]).toEqual({
      relativePath: API,
      git: {
        ok: true,
        branch: 'main',
        commit: git(api, 'rev-parse', 'HEAD'),
        staged: 1,
        unstaged: 1,
        untracked: 1,
      },
    })
    expect(seen.after).toEqual(seen.before)
  })
})

describe('A Git error is surfaced as is', () => {
  it("shows Git's own message for the broken repository and the state of the others", async () => {
    const front = join(main, 'sources', 'front')
    rmSync(join(front, '.git'), { recursive: true, force: true })
    writeFileSync(join(front, '.git'), 'gitdir: /nowhere/hemera\n')

    const status = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const mainWorkspace = (yield* workspaces.list(project.id))[0]!
        return yield* workspaces.status(mainWorkspace.id)
      }),
    )

    expect(status[0]?.git).toMatchObject({ ok: true, branch: 'main' })
    expect(status[1]?.relativePath).toBe(FRONT)
    expect(status[1]?.git.ok).toBe(false)
    expect(status[1]?.git).toMatchObject({ error: expect.stringMatching(/^fatal: /) })
  })
})

describe('A missing git is a named refusal', () => {
  it('refuses the creation saying git was not found, and writes nothing', async () => {
    const seen = await workspaceEngine(
      folder,
      'git-that-does-not-exist-hemera',
    )(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const plan = yield* workspaces.plan(project.id, 'HEM-7', 'login-form')
        const reads = yield* readPlan(project.id, 'HEM-7', 'login-form', plan.repositories)
        const before = yield* counted
        const refused = yield* Effect.flip(
          workspaces.create(project.id, {
            specId: 'HEM-7',
            name: 'login-form',
            repositories: [{ relativePath: API, base: 'HEAD', branch: 'atlas/HEM-7-login-form' }],
          }),
        )
        return { plan, reads, refused, before, after: yield* counted }
      }),
    )

    // The plan still answers, with nothing to start from, and says why for each repository.
    expect(seen.plan.gitAvailable).toBe(false)
    expect(seen.reads.every((one) => one.base === null && !one.included)).toBe(true)
    expect(
      seen.reads.every((one) =>
        (one.reason ?? '').endsWith('git-that-does-not-exist-hemera was not found on the PATH'),
      ),
    ).toBe(true)
    expect(seen.refused).toMatchObject({ check: 'git' })
    expect(seen.refused.message).toBe('git-that-does-not-exist-hemera was not found on the PATH')
    expect(seen.after).toEqual(seen.before)
    expect(existsSync(seen.plan.path)).toBe(false)
  })
})

describe('Cleanup removes the worktrees and keeps the branches', () => {
  it('removes each worktree and the folder, keeps the row cleaned, and every branch', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const workspace = yield* prepared(project.id)
        const cleaned = yield* workspaces.cleanup(workspace.id)
        const sql = yield* SqliteClient
        const events = yield* sql<{ type: string }>`
          SELECT type FROM domain_events WHERE type = 'workspace.cleaned'`
        return { workspace, cleaned, events }
      }),
    )

    expect(existsSync(seen.workspace.path)).toBe(false)
    expect(seen.cleaned.state).toBe('cleaned')
    expect(seen.cleaned.cleanedAt).not.toBeNull()
    expect(seen.events).toHaveLength(1)
    for (const repository of ['api', 'front']) {
      const source = join(main, 'sources', repository)
      // The branch stays, and Git no longer holds a worktree of it.
      expect(git(source, 'branch', '--list', 'atlas/HEM-7-login-form')).toContain(
        'atlas/HEM-7-login-form',
      )
      expect(git(source, 'worktree', 'list')).not.toContain('login-form')
    }
  })

  it('frees the name and the Spec of the cleaned Workspace for a new one', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const first = yield* prepared(project.id)
        yield* workspaces.cleanup(first.id)
        // The old branches stay, so the new Workspace is made on branches of its own.
        const again = yield* workspaces.create(project.id, {
          specId: 'HEM-7',
          name: 'login-form',
          repositories: first.repositories.map((one) => ({
            relativePath: one.relativePath,
            base: one.base,
            branch: 'atlas/HEM-7-login-form-again',
          })),
        })
        return { first, again, listed: yield* workspaces.list(project.id) }
      }),
    )

    expect(seen.again.name).toBe('login-form')
    expect(seen.again.specId).toBe('HEM-7')
    expect(seen.again.id).not.toBe(seen.first.id)
    expect(seen.listed.map((one) => [one.name, one.state])).toEqual([
      ['main', 'ready'],
      ['login-form', 'cleaned'],
      ['login-form', 'preparing'],
    ])
  })
})

describe('Cleanup is refused while a service runs or Git refuses', () => {
  it('names the running service, then Git’s own message, and removes nothing', async () => {
    const front = join(main, 'sources', 'front')
    writeFileSync(join(front, 'tracked.txt'), 'one\n')
    git(front, 'add', 'tracked.txt')
    git(front, 'commit', '-q', '-m', 'tracked')

    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const commands = yield* Commands
        const project = yield* atlas(main, [API, FRONT])
        const workspace = yield* prepared(project.id)
        const session = yield* aSessionOf(project.id)
        const dev = yield* saved(
          project.id,
          'dev',
          `"${process.execPath}" -e "setInterval(()=>{},1000)"`,
          'serve',
        )
        const running = yield* commands.run({
          sessionId: session.id,
          projectId: project.id,
          commandId: dev.id,
          name: dev.name,
          line: dev.line,
          lineWindows: dev.lineWindows,
          lineLinux: dev.lineLinux,
          type: dev.type,
          scope: dev.scope,
          portless: dev.portless,
          portlessName: null,
          folder: null,
          cwd: workspace.path,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          environment: {},
          startedBy: 'user',
        })
        const whileRunning = yield* Effect.flip(workspaces.cleanup(workspace.id))
        yield* commands.stop(session.id, running.id)

        // A tracked file changed in the second worktree: Git refuses to remove it, and the first,
        // which it would have removed, is not removed either.
        writeFileSync(join(workspace.path, 'sources', 'front', 'tracked.txt'), 'changed\n')
        const whileChanged = yield* Effect.flip(workspaces.cleanup(workspace.id))
        const sql = yield* SqliteClient
        const events = yield* sql<{ payload: string }>`
          SELECT payload FROM domain_events WHERE type = 'workspace.cleanup_refused'
          ORDER BY sequence`
        return {
          workspace,
          whileRunning,
          whileChanged,
          events,
          after: yield* workspaces.one(workspace.id),
        }
      }),
    )

    expect(seen.whileRunning).toBeInstanceOf(CleanupRefusedError)
    expect(seen.whileRunning.message).toBe('the service dev of login-form is running')
    expect(seen.whileChanged).toBeInstanceOf(CleanupRefusedError)
    expect(seen.whileChanged.message).toMatch(
      /^fatal: .*sources[\\/]front.* contains modified or untracked files/,
    )
    expect(seen.events).toHaveLength(2)
    // Nothing was removed: both worktrees are there, and the Workspace is still ready.
    expect(existsSync(join(seen.workspace.path, 'sources', 'api', '.git'))).toBe(true)
    expect(existsSync(join(seen.workspace.path, 'sources', 'front', '.git'))).toBe(true)
    expect(seen.after.state).toBe('ready')
  })
})

describe('A Workspace with a running build Session is not cleaned up', () => {
  it('names the build, removes nothing, and lets it go once the Session is archived', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const workspace = yield* prepared(project.id)
        const sql = yield* SqliteClient
        // The build Session a launch writes when it starts the build, and has not archived
        // (D8-13): the folder is where that build works.
        const at = '2026-09-25T08:00:00.000Z'
        yield* sql`INSERT INTO sessions
          (id, project_id, title, title_source, mission, spec_id, workspace_id, created_at,
           last_written_at)
          VALUES ('build-of-HEM-7', ${project.id}, 'Build the login form', 'derived', 'build',
            'HEM-7', ${workspace.id}, ${at}, ${at})`
        const running = yield* Effect.flip(workspaces.cleanup(workspace.id))
        const events = yield* sql<{ payload: string }>`
          SELECT payload FROM domain_events WHERE type = 'workspace.cleanup_refused'`
        // Nothing was removed while it was refused: both worktrees are there, the folder is
        // there, and the Workspace is still ready.
        const kept = {
          api: existsSync(join(workspace.path, 'sources', 'api', '.git')),
          folder: existsSync(workspace.path),
          front: existsSync(join(workspace.path, 'sources', 'front', '.git')),
          state: (yield* workspaces.one(workspace.id)).state,
        }
        // Archived, the build no longer works there: the cleanup goes through.
        yield* sql`UPDATE sessions SET archived_at = ${at} WHERE id = 'build-of-HEM-7'`
        const cleaned = yield* workspaces.cleanup(workspace.id)
        return { cleaned, events, kept, running, workspace }
      }),
    )

    expect(seen.running).toBeInstanceOf(CleanupRefusedError)
    expect(seen.running.message).toBe('the build of login-form is still open')
    expect(seen.kept).toEqual({ api: true, folder: true, front: true, state: 'ready' })
    expect(seen.events).toEqual([
      { payload: JSON.stringify({ reason: 'the build of login-form is still open' }) },
    ])
    expect(seen.cleaned.state).toBe('cleaned')
    expect(existsSync(seen.workspace.path)).toBe(false)
  })
})

describe('main cannot be cleaned up', () => {
  it('is refused, the refusal is in the Journal, and main is unchanged', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        const project = yield* atlas(main, [API, FRONT])
        const mainWorkspace = (yield* workspaces.list(project.id))[0]!
        const refused = yield* Effect.flip(workspaces.cleanup(mainWorkspace.id))
        const sql = yield* SqliteClient
        const events = yield* sql<{ type: string; entity_kind: string; payload: string }>`
          SELECT type, entity_kind, payload FROM domain_events WHERE type LIKE 'workspace.%'`
        return { refused, events, after: yield* workspaces.one(mainWorkspace.id) }
      }),
    )

    expect(seen.refused).toBeInstanceOf(CleanupRefusedError)
    expect(seen.refused.message).toBe('main cannot be cleaned up')
    expect(seen.events).toEqual([
      {
        type: 'workspace.cleanup_refused',
        entity_kind: 'workspace',
        payload: JSON.stringify({ reason: 'main cannot be cleaned up' }),
      },
    ])
    expect(seen.after.state).toBe('ready')
    expect(existsSync(main)).toBe(true)
  })
})

describe('A run step never starts a service', () => {
  it('refuses a serve command in the recipe, naming why, and adds nothing', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const recipe = yield* Recipe
        const project = yield* atlas(main, [API])
        const dev = yield* saved(project.id, 'dev', 'pnpm dev', 'serve')
        const refused = yield* Effect.flip(
          recipe.add(project.id, {
            kind: 'run',
            base: null,
            path: null,
            commandId: dev.id,
            line: null,
            lineWindows: null,
            lineLinux: null,
          }),
        )
        return { refused, left: yield* recipe.list(project.id) }
      }),
    )

    expect(seen.refused).toBeInstanceOf(RecipeRefusedError)
    expect(seen.refused.message).toBe(
      'a service never ends: a preparation step waits for its command to end',
    )
    expect(seen.left).toEqual([])
  })
})

describe('The recipe of a Project is kept in the order the user sets', () => {
  it('adds at the end, moves one place, removes, and refuses what it cannot hold', async () => {
    writeFileSync(join(main, 'sources', 'api', '.env'), 'PORT=3000\n')
    writeFileSync(join(main, 'CLAUDE.md'), '# Atlas\n')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const recipe = yield* Recipe
        const project = yield* atlas(main, [API, FRONT])
        const install = yield* saved(project.id, 'install', 'node --version', 'script')
        yield* recipe.add(project.id, {
          kind: 'copy',
          base: API,
          path: '.env',
          commandId: null,
          line: null,
          lineWindows: null,
          lineLinux: null,
        })
        yield* recipe.add(project.id, {
          kind: 'link',
          base: null,
          path: 'CLAUDE.md',
          commandId: null,
          line: null,
          lineWindows: null,
          lineLinux: null,
        })
        const three = yield* recipe.add(project.id, {
          kind: 'run',
          base: null,
          path: null,
          commandId: install.id,
          line: null,
          lineWindows: null,
          lineLinux: null,
        })
        const moved = yield* recipe.move(project.id, three[2]!.id, 'up')
        const first = yield* recipe.move(project.id, moved[0]!.id, 'up')
        const removed = yield* recipe.remove(project.id, moved[0]!.id)
        const outside = yield* Effect.flip(
          recipe.add(project.id, {
            kind: 'copy',
            base: null,
            path: '../x',
            commandId: null,
            line: null,
            lineWindows: null,
            lineLinux: null,
          }),
        )
        const stranger = yield* Effect.flip(
          recipe.add(project.id, {
            kind: 'run',
            base: null,
            path: null,
            commandId: 'nobody',
            line: null,
            lineWindows: null,
            lineLinux: null,
          }),
        )
        const sql = yield* SqliteClient
        const events = yield* sql<{ type: string }>`
          SELECT type FROM domain_events WHERE type = 'project.recipe_changed'`
        return { three, moved, first, removed, outside, stranger, events }
      }),
    )

    expect(seen.three.map((step) => [step.kind, step.base, step.path])).toEqual([
      ['copy', API, './.env'],
      ['link', null, './CLAUDE.md'],
      ['run', null, null],
    ])
    expect(seen.moved.map((step) => step.kind)).toEqual(['copy', 'run', 'link'])
    // The first stays first, and nothing is written for a move that moves nothing.
    expect(seen.first.map((step) => step.kind)).toEqual(['copy', 'run', 'link'])
    expect(seen.removed.map((step) => step.kind)).toEqual(['run', 'link'])
    expect(seen.outside).toBeInstanceOf(InvalidRepositoryPathError)
    expect(seen.stranger).toBeInstanceOf(RecipeRefusedError)
    expect(seen.events).toHaveLength(5)
  })
})

describe('A repository is rewritten with its icon, and what named it follows', () => {
  it('moves api to server, sets its icon and inclusion, and its command and step follow', async () => {
    writeFileSync(join(main, 'sources', 'api', 'CLAUDE.md'), '# api')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const projects = yield* Projects
        const commands = yield* Commands
        const recipe = yield* Recipe
        const project = yield* atlas(main, [API, FRONT])
        yield* commands.save(
          {
            projectId: project.id,
            name: 'dev',
            line: 'pnpm dev',
            lineWindows: null,
            lineLinux: null,
            type: 'serve',
            folderBase: API,
            folder: './src',
            scope: 'workspace',
            portless: false,
            portlessName: null,
          },
          false,
        )
        yield* recipe.add(project.id, {
          kind: 'link',
          base: API,
          path: 'CLAUDE.md',
          commandId: null,
          line: null,
          lineWindows: null,
          lineLinux: null,
        })
        const moved = yield* projects.updateRepository({
          id: project.id,
          version: project.version,
          relativePath: API,
          newPath: 'sources/server',
          icon: 'server',
          included: false,
        })
        const taken = yield* Effect.flip(
          projects.updateRepository({
            id: project.id,
            version: moved.version,
            relativePath: './sources/server',
            newPath: FRONT,
            icon: null,
            included: true,
          }),
        )
        const unknown = yield* Effect.flip(
          projects.updateRepository({
            id: project.id,
            version: moved.version,
            relativePath: API,
            newPath: API,
            icon: null,
            included: true,
          }),
        )
        const outside = yield* Effect.flip(
          projects.updateRepository({
            id: project.id,
            version: moved.version,
            relativePath: './sources/server',
            newPath: '../elsewhere',
            icon: null,
            included: true,
          }),
        )
        const sql = yield* SqliteClient
        const events = yield* sql<{ payload: string }>`
          SELECT payload FROM domain_events WHERE type = 'project.repository_updated'`
        return {
          moved,
          taken,
          unknown,
          outside,
          events,
          catalogue: yield* commands.list(project.id),
          steps: yield* recipe.list(project.id),
        }
      }),
    )

    // Its place in the list is kept, under its new path, with the icon it now wears.
    expect(seen.moved.repositories).toEqual(['./sources/server', FRONT])
    expect(seen.moved.repositoryIcons).toEqual({ './sources/server': 'server' })
    expect(seen.moved.included).toEqual([FRONT])
    // The command still runs under it, and the step still applies there.
    expect(seen.catalogue[0]).toMatchObject({ folderBase: './sources/server', folder: './src' })
    expect(seen.steps[0]).toMatchObject({ base: './sources/server', path: './CLAUDE.md' })
    // Refused as an added one would be: taken, not declared, or out of the root.
    expect(seen.taken).toBeInstanceOf(InvalidRepositoryPathError)
    expect(seen.taken.message).toContain('it is declared twice')
    expect(seen.unknown.message).toContain('it is not declared')
    expect(seen.outside.message).toContain('it resolves outside the workspace root')
    expect(seen.events.map((event) => JSON.parse(event.payload))).toEqual([
      { relativePath: API, newPath: './sources/server', icon: 'server', included: false },
    ])
  })
})
