/**
 * The preparation recipe, and the preparation of a Workspace with it: copies that never
 * overwrite, links, run steps handed to the runner, template names filled, and a preparation that
 * resumes where it stopped.
 *
 * The runner of `run` steps is a fake that records what it is handed: the real one is the command
 * catalogue's. Everything else is real: the machine's Git, the disk, the database.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_BASE_BRANCH } from '@hemera/core/domain'
import {
  InvalidRecipeStep,
  InvalidTemplate,
  NewBranch,
  PreparationRunning,
  type Project,
  type RecipeStepDraft,
} from '@hemera/ipc'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  beginPreparation,
  linkType,
  prepareWorkspace,
  resumeInterrupted,
  resumeWorkspace,
} from '../src/engine/preparation.ts'
import { getProject } from '../src/engine/projects.ts'
import { checkRecipe, getRecipe, saveRecipe } from '../src/engine/recipe.ts'
import type { RecipeRun } from '../src/engine/recipe-runner.ts'
import { SqliteClient } from '../src/engine/storage/database.ts'
import { setVariable } from '../src/engine/variables.ts'
import { createWorkspace, getWorkspace, removeWorkspace } from '../src/engine/workspaces.ts'
import { git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { atlas, atlasOnDisk, fakeRunner, opened, workspaceEngine } from './workspace-engine.ts'

let data: string
let work: string
let main: string

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('preparation'))
  work = realpathSync.native(temporaryFolder('preparation-work'))
  main = atlasOnDisk(work)
  await opened(data)
})
afterEach(removeFolders)

const repositoryId = (project: Project, path: string) =>
  project.repositories.find((one) => one.path === path)?.id ?? null

const copy = (repository: string | null, path: string): RecipeStepDraft => ({
  kind: 'copy',
  repositoryId: repository,
  path,
  commandId: null,
  line: null,
})
const link = (repository: string | null, path: string): RecipeStepDraft => ({
  ...copy(repository, path),
  kind: 'link',
})
const line = (repository: string | null, text: string, path: string | null = null) =>
  ({ kind: 'run', repositoryId: repository, path, commandId: null, line: text }) as const

/** Atlas with a recipe written by `steps`, then a Workspace over all its repositories. */
const withRecipe = (steps: (project: Project) => ReadonlyArray<RecipeStepDraft>) =>
  Effect.gen(function* () {
    const created = yield* atlas(main)
    yield* saveRecipe({ projectId: created.id, version: created.version, steps: steps(created) })
    const project = yield* getProject(created.id)
    const workspace = yield* createWorkspace({
      projectId: project.id,
      name: 'login-form',
      repositories: project.repositories.map((one) => one.id),
      mode: NewBranch.make({}),
    })
    return { project, workspace }
  })

describe('A copy never overwrites an existing file', () => {
  test('a file the worktree already has is kept; one it lacks is copied from the main checkout', async () => {
    const api = join(main, 'api')
    writeFileSync(join(api, 'settings.json'), 'committed\n')
    git(api, 'add', 'settings.json')
    git(api, 'commit', '-q', '-m', 'settings')
    git(api, 'push', '-q', 'origin', DEFAULT_BASE_BRANCH)
    // The user's own checkout has changed it since: the Workspace keeps what Git gave it.
    writeFileSync(join(api, 'settings.json'), 'local\n')
    mkdirSync(join(api, 'config'), { recursive: true })
    writeFileSync(join(api, 'config', 'local.json'), '{}\n')

    const workspace = await workspaceEngine(data)(
      Effect.gen(function* () {
        const made = yield* withRecipe((project) => [
          copy(null, '.env'),
          copy(repositoryId(project, 'api'), 'settings.json'),
          copy(repositoryId(project, 'api'), 'config'),
        ])
        return yield* prepareWorkspace(made.workspace.id)
      }),
    )

    expect(workspace.preparation).toBe('ready')
    expect(readFileSync(join(workspace.folder, '.env'), 'utf8')).toBe('FROM_MAIN=1\n')
    expect(readFileSync(join(workspace.folder, 'api', 'settings.json'), 'utf8')).toBe('committed\n')
    expect(existsSync(join(workspace.folder, 'api', 'config', 'local.json'))).toBe(true)
  })
})

describe('A link is a junction for a folder on Windows and a symbolic link elsewhere', () => {
  test('the kind of link follows the system and what is linked', () => {
    expect(linkType('win32', true)).toBe('junction')
    expect(linkType('linux', true)).toBe('dir')
    expect(linkType('darwin', true)).toBe('dir')
    expect(linkType('win32', false)).toBe('file')
    expect(linkType('linux', false)).toBe('file')
  })

  test('a folder and a file are linked to the main checkout’s, and a removal leaves those alone', async () => {
    const web = join(main, 'web')
    // As in any project, what the recipe links is ignored by Git: a removal does not count it as
    // work to lose.
    writeFileSync(join(web, '.gitignore'), 'node_modules\n.env.local\n')
    git(web, 'add', '.gitignore')
    git(web, 'commit', '-q', '-m', 'ignore')
    git(web, 'push', '-q', 'origin', DEFAULT_BASE_BRANCH)
    const modules = join(web, 'node_modules')
    mkdirSync(join(modules, 'left-pad'), { recursive: true })
    writeFileSync(join(modules, 'left-pad', 'index.js'), 'module.exports = 1\n')
    writeFileSync(join(main, 'web', '.env.local'), 'LOCAL=1\n')

    const workspace = await workspaceEngine(data)(
      Effect.gen(function* () {
        const made = yield* withRecipe((project) => [
          link(repositoryId(project, 'web'), 'node_modules'),
          link(repositoryId(project, 'web'), '.env.local'),
        ])
        const prepared = yield* prepareWorkspace(made.workspace.id)
        const linked = join(prepared.folder, 'web', 'node_modules')
        const seen = {
          folder: lstatSync(linked).isSymbolicLink(),
          leadsTo: realpathSync.native(linked),
          file: lstatSync(join(prepared.folder, 'web', '.env.local')).isSymbolicLink(),
          content: readFileSync(join(linked, 'left-pad', 'index.js'), 'utf8'),
        }
        yield* removeWorkspace(prepared.id)
        return { prepared, seen }
      }),
    )

    expect(workspace.seen).toEqual({
      folder: true,
      leadsTo: realpathSync.native(modules),
      file: true,
      content: 'module.exports = 1\n',
    })
    expect(existsSync(workspace.prepared.folder)).toBe(false)
    // What the links led to is the main checkout's, and is still there.
    expect(readFileSync(join(modules, 'left-pad', 'index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(readFileSync(join(main, 'web', '.env.local'), 'utf8')).toBe('LOCAL=1\n')
  })
})

describe('A step whose source is missing in the main checkout is refused when saved', () => {
  test('saving refuses it naming the step, and checking says so without writing', async () => {
    const [refused, checked, recipe] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const steps = [copy(null, '.env'), copy(repositoryId(project, 'api'), 'missing.txt')]
        const refusal = yield* Effect.flip(
          saveRecipe({ projectId: project.id, version: project.version, steps }),
        )
        return [refusal, yield* checkRecipe(project.id, steps), yield* getRecipe(project.id)]
      }),
    )
    expect(refused).toBeInstanceOf(InvalidRecipeStep)
    expect(refused).toMatchObject({ position: 2 })
    expect(refused.message).toContain('missing.txt')
    expect(checked.map((one) => one.problem === null)).toEqual([true, false])
    expect(recipe).toEqual([])
  })

  test('a source removed since it was saved fails its step when it runs', async () => {
    writeFileSync(join(main, 'api', 'local.txt'), 'x\n')
    const workspace = await workspaceEngine(data)(
      Effect.gen(function* () {
        const made = yield* withRecipe((project) => [
          copy(repositoryId(project, 'api'), 'local.txt'),
        ])
        rmSync(join(main, 'api', 'local.txt'))
        return yield* prepareWorkspace(made.workspace.id)
      }),
    )
    expect(workspace.preparation).toBe('failed')
    expect(workspace.steps.at(-1)?.failure?.output).toContain('not in the main checkout')
  })
})

describe('An interrupted preparation resumes', () => {
  test('a removed copied file is redone, a done run is not run again, the failed step is retried', async () => {
    let migrations = 0
    const runner = fakeRunner((run) => {
      if (run.line !== 'pnpm migrate') return { exitCode: 0, output: 'installed\n' }
      migrations += 1
      return migrations === 1
        ? { exitCode: 1, output: 'connecting\nerror: the database is down\n' }
        : { exitCode: 0, output: 'migrated\n' }
    })

    const [failed, resumed] = await workspaceEngine(
      data,
      runner,
    )(
      Effect.gen(function* () {
        const made = yield* withRecipe(() => [
          copy(null, '.env'),
          line(null, 'pnpm install'),
          line(null, 'pnpm migrate'),
        ])
        const first = yield* prepareWorkspace(made.workspace.id)
        rmSync(join(first.folder, '.env'))
        return [first, yield* resumeWorkspace(made.workspace.id)] as const
      }),
    )

    expect(failed.preparation).toBe('failed')
    expect(failed.steps.map((step) => step.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'failed',
    ])
    expect(failed.steps.at(-1)?.failure).toEqual({
      doing: 'pnpm migrate',
      output: 'connecting\nerror: the database is down',
    })
    expect(resumed.preparation).toBe('ready')
    expect(runner.runs.map((run) => run.line)).toEqual([
      'pnpm install',
      'pnpm migrate',
      'pnpm migrate',
    ])
    expect(existsSync(join(resumed.folder, '.env'))).toBe(true)
  })

  test('a removed worktree is made again on its branch', async () => {
    const workspace = await workspaceEngine(data)(
      Effect.gen(function* () {
        const made = yield* withRecipe(() => [])
        const first = yield* prepareWorkspace(made.workspace.id)
        rmSync(join(first.folder, 'api'), { recursive: true, force: true })
        return yield* resumeWorkspace(made.workspace.id)
      }),
    )
    expect(workspace.preparation).toBe('ready')
    expect(git(join(workspace.folder, 'api'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'atlas/login-form',
    )
  })

  test('at the engine’s start, a preparation a stopped engine left running is resumed', async () => {
    const runner = fakeRunner()
    const id = await workspaceEngine(
      data,
      runner,
    )(
      Effect.gen(function* () {
        const made = yield* withRecipe(() => [line(null, 'pnpm install')])
        return made.workspace.id
      }),
    )
    // The engine stopped in the middle of the worktree of web: what it wrote last says so.
    await workspaceEngine(
      data,
      runner,
    )(
      Effect.gen(function* () {
        yield* prepareWorkspace(id)
        const sql = yield* SqliteClient
        yield* sql`UPDATE workspace_steps SET state = 'running' WHERE position = 2`
        yield* sql`UPDATE workspace_steps SET state = 'pending' WHERE position > 2`
      }),
    )
    const [resumed, workspace] = await workspaceEngine(
      data,
      runner,
    )(
      Effect.gen(function* () {
        const ids = yield* resumeInterrupted
        return [ids, yield* settled(id)] as const
      }),
    )
    expect(resumed).toEqual([id])
    expect(workspace.preparation).toBe('ready')
    // The install was done before the stop was written over it, and runs once more after it.
    expect(runner.runs).toHaveLength(2)
  })
})

/** A Workspace once its preparation in the background has let it go. */
const settled = (id: string) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 300; tries += 1) {
      const workspace = yield* getWorkspace(id)
      if (!workspace.preparing) return workspace
      yield* Effect.sleep('20 millis')
    }
    return yield* getWorkspace(id)
  })

describe('A run step is handed to the RecipeRunner port', () => {
  test('with its line, its folder and its variables, and its outcome becomes the step’s state', async () => {
    const runner = fakeRunner(() => ({ exitCode: 2, output: 'it broke\n' }))
    const workspace = await workspaceEngine(
      data,
      runner,
    )(
      Effect.gen(function* () {
        const made = yield* withRecipe((project) => [
          line(repositoryId(project, 'api'), 'make build', 'tools'),
        ])
        yield* setVariable({
          projectId: made.project.id,
          workspaceId: null,
          key: 'PORT',
          value: '3000',
        })
        yield* setVariable({
          projectId: made.project.id,
          workspaceId: made.workspace.id,
          key: 'PORT',
          value: '3100',
        })
        yield* setVariable({
          projectId: made.project.id,
          workspaceId: null,
          key: 'MODE',
          value: 'dev',
        })
        return yield* prepareWorkspace(made.workspace.id)
      }),
    )

    expect(runner.runs).toEqual([
      {
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        commandId: null,
        line: 'make build',
        folder: join(workspace.folder, 'api', 'tools'),
        variables: { PORT: '3100', MODE: 'dev' },
      } satisfies RecipeRun,
    ])
    expect(workspace.preparation).toBe('failed')
    expect(workspace.steps.at(-1)).toMatchObject({
      state: 'failed',
      failure: { doing: 'make build', output: 'it broke' },
    })
  })

  test('a run the runner refuses fails its step with the reason', async () => {
    const runner = fakeRunner(() => 'refused')
    const workspace = await workspaceEngine(
      data,
      runner,
    )(
      Effect.gen(function* () {
        const made = yield* withRecipe(() => [line(null, 'pnpm db:reset')])
        return yield* prepareWorkspace(made.workspace.id)
      }),
    )
    expect(workspace.steps.at(-1)?.failure).toEqual({
      doing: 'pnpm db:reset',
      output: 'the user denied it',
    })
  })

  test('a run step asks nothing of a repository the Workspace did not take', async () => {
    const runner = fakeRunner()
    const workspace = await workspaceEngine(
      data,
      runner,
    )(
      Effect.gen(function* () {
        const created = yield* atlas(main)
        yield* saveRecipe({
          projectId: created.id,
          version: created.version,
          steps: [line(repositoryId(created, 'web'), 'pnpm install')],
        })
        const made = yield* createWorkspace({
          projectId: created.id,
          name: 'api-only',
          repositories: [repositoryId(created, 'api') ?? ''],
          mode: NewBranch.make({}),
        })
        return yield* prepareWorkspace(made.id)
      }),
    )
    expect(runner.runs).toEqual([])
    expect(workspace.steps.map((step) => step.state)).toEqual(['done', 'skipped'])
    expect(workspace.preparation).toBe('ready')
  })
})

describe('Template names are filled where Hemera fills them', () => {
  test('{workspace} in a variable’s value, a step’s path and a step’s line', async () => {
    const runner = fakeRunner()
    const workspace = await workspaceEngine(
      data,
      runner,
    )(
      Effect.gen(function* () {
        const made = yield* withRecipe(() => [
          line(null, 'createdb app_{workspace} # {{literal}', 'out/{workspace}'),
        ])
        yield* setVariable({
          projectId: made.project.id,
          workspaceId: null,
          key: 'DATABASE_URL',
          value: 'postgres://localhost/app_{workspace}?from={project}&on={branch}',
        })
        return yield* prepareWorkspace(made.workspace.id)
      }),
    )
    expect(runner.runs[0]).toMatchObject({
      line: 'createdb app_login-form # {literal}',
      folder: join(workspace.folder, 'out', 'login-form'),
      variables: {
        DATABASE_URL: 'postgres://localhost/app_login-form?from=atlas&on=atlas/login-form',
      },
    })
  })

  test('an unknown name is refused when the step is saved, naming it', async () => {
    const refused = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        return yield* Effect.flip(
          saveRecipe({
            projectId: project.id,
            version: project.version,
            steps: [line(null, 'createdb app_{workspcae}')],
          }),
        )
      }),
    )
    expect(refused).toBeInstanceOf(InvalidTemplate)
    expect(refused.message).toContain('{workspcae}')
  })
})

describe('A Workspace keeps the recipe it was made with', () => {
  test('a recipe edited afterwards changes the next Workspace, not this one', async () => {
    const runner = fakeRunner()
    await workspaceEngine(
      data,
      runner,
    )(
      Effect.gen(function* () {
        const made = yield* withRecipe(() => [line(null, 'pnpm install')])
        yield* saveRecipe({
          projectId: made.project.id,
          version: made.project.version,
          steps: [line(null, 'npm ci')],
        })
        yield* prepareWorkspace(made.workspace.id)
      }),
    )
    expect(runner.runs.map((run) => run.line)).toEqual(['pnpm install'])
  })
})

describe('One preparation of a Workspace at a time', () => {
  test('a second one while the first runs is refused', async () => {
    const refused = await workspaceEngine(data)(
      Effect.gen(function* () {
        const made = yield* withRecipe(() => [])
        yield* beginPreparation(made.workspace.id, false)
        const second = yield* Effect.flip(prepareWorkspace(made.workspace.id))
        yield* settled(made.workspace.id)
        return second
      }),
    )
    expect(refused).toBeInstanceOf(PreparationRunning)
  })
})
