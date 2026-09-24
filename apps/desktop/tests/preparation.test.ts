/**
 * The preparation of a Workspace: its steps, in order, stopped at a failure, and resumed after
 * a re-check (D8-05, D8-16, D8-17).
 *
 * Each suite is named after the scenario of the Spec it covers, over the real engine, the
 * machine's `git` on real repositories with no remote, and commands that are real children of
 * this machine. The one thing injected is the system's refusal of a link, through the port the
 * links are made by.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect, Fiber, Layer, Result } from 'effect'

import { runsOf } from '#engine/commands/panel.ts'
import { Sessions } from '#engine/sessions.ts'
import { AgentNotices } from '#engine/agents/notices.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import {
  LinkRefusedError,
  Links,
  Preparation,
  PreparationRunningError,
  hostLinks,
} from '#engine/workspaces/preparation.ts'
import { Recipe, type RecipeEdit } from '#engine/workspaces/recipe.ts'
import {
  CleanupRefusedError,
  Workspaces,
  type WorkspacesService,
} from '#engine/workspaces/workspaces.ts'

import { until } from './application.ts'
import { git } from './repositories.ts'
import { atlas, atlasMain, saved, workspaceEngine } from './workspace-engine.ts'

let folder: string
let main: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'hemera-preparation-'))
  main = atlasMain(folder)
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

const API = './sources/api'
const FRONT = './sources/front'
const BRANCH = 'atlas/HEM-7-login-form'

/** A line of `node` itself, reached without the `PATH`: a line is run, not interpreted. */
const node = (code: string) => `"${process.execPath}" -e "${code}"`

/** A path written in a quoted string of that code: a Windows path's backslashes doubled. */
const quoted = (path: string) => path.replaceAll('\\', '\\\\')

const COPY_ENV: RecipeEdit = { kind: 'copy', path: '.env', scope: 'repositories', commandId: null }
const LINK_CLAUDE: RecipeEdit = { kind: 'link', path: 'CLAUDE.md', scope: 'root', commandId: null }

/**
 * `Atlas` with its two repositories, the recipe given — a `run` names the line of its `install`
 * command — and the Workspace `login-form` for `HEM-7` created from the plan, not prepared.
 */
const createdWith = (recipe: readonly (RecipeEdit | { run: string })[]) =>
  Effect.gen(function* () {
    const workspaces = yield* Workspaces
    const edits = yield* Recipe
    const project = yield* atlas(main, [API, FRONT])
    for (const step of recipe) {
      if ('run' in step) {
        const install = yield* saved(project.id, 'install', step.run, 'script')
        yield* edits.add(project.id, {
          kind: 'run',
          path: null,
          scope: 'root',
          commandId: install.id,
        })
      } else {
        yield* edits.add(project.id, step)
      }
    }
    const plan = yield* workspaces.plan(project.id, 'HEM-7', 'login-form')
    return yield* workspaces.create(project.id, {
      specId: 'HEM-7',
      name: plan.name,
      repositories: plan.repositories
        .filter((one) => one.included)
        .map((one) => ({
          relativePath: one.relativePath,
          base: one.base ?? '',
          branch: one.branch,
        })),
    })
  })

/** A run that holds until the file `release` appears: a step caught in the middle of itself. */
const heldUntil = (release: string) =>
  node(
    `const f=require('fs');const t=setInterval(()=>{if(f.existsSync('${quoted(release)}'))clearInterval(t)},20)`,
  )

/** The steps of a Workspace as the engine reads them. */
const stepsOf = (workspaceId: string) =>
  Effect.gen(function* () {
    const preparation = yield* Preparation
    return yield* preparation.steps(workspaceId)
  })

/** The runs of the data folder, as their rows keep them. */
const runRows = Effect.gen(function* () {
  const sql = yield* SqliteClient
  return yield* sql<{
    id: string
    session_id: string | null
    workspace_id: string | null
    state: string
    exit_code: number | null
    output: string
    ended_at: string | null
  }>`SELECT id, session_id, workspace_id, state, exit_code, output, ended_at FROM command_runs`
})

/** What a step reads as: its kind, its target, its state and its message. */
const shown = (steps: readonly { kind: string; target: string; state: string }[]) =>
  steps.map((step) => [step.kind, step.target, step.state])

describe('The steps follow the recipe in order', () => {
  it('lists the two worktrees, then the copy, the link and the run, all pending', async () => {
    const steps = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspace = yield* createdWith([
          COPY_ENV,
          LINK_CLAUDE,
          { run: node('process.exit(0)') },
        ])
        return yield* stepsOf(workspace.id)
      }),
    )

    expect(shown(steps)).toEqual([
      ['worktree', API, 'pending'],
      ['worktree', FRONT, 'pending'],
      ['copy', './.env', 'pending'],
      ['link', './CLAUDE.md', 'pending'],
      ['run', 'install', 'pending'],
    ])
    expect(steps.map((step) => step.position)).toEqual([1, 2, 3, 4, 5])
    expect(steps[2]?.scope).toBe('repositories')
    expect(steps[3]?.scope).toBe('root')
  })
})

describe('A copy never overwrites and skips a missing source', () => {
  it('keeps the file already there, gives nothing where there is no source, and says both', async () => {
    const api = join(main, 'sources', 'api')
    // The api repository carries its own `.env`, which its worktree checks out; `main`'s copy of
    // it has since changed. The Workspace's is the one already there, and it is kept.
    writeFileSync(join(api, '.env'), 'PORT=from-the-branch\n')
    git(api, 'add', '.env')
    git(api, 'commit', '-q', '-m', 'env')
    writeFileSync(join(api, '.env'), 'PORT=from-main\n')

    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([COPY_ENV])
        const prepared = yield* preparation.prepare(workspace.id)
        return { prepared, steps: yield* stepsOf(workspace.id) }
      }),
    )

    const copied = seen.steps[2]
    expect(copied?.state).toBe('done')
    expect(copied?.message).toBe('sources/api: kept as it was; sources/front: no source')
    // The worktree's own checkout, with the line ends the machine's Git gives it (CRLF under
    // Windows' `core.autocrlf`), and never main's copy.
    const kept = readFileSync(join(seen.prepared.path, 'sources', 'api', '.env'), 'utf8')
    expect(kept.replaceAll('\r\n', '\n')).toBe('PORT=from-the-branch\n')
    expect(existsSync(join(seen.prepared.path, 'sources', 'front', '.env'))).toBe(false)
    expect(seen.prepared.state).toBe('ready')
  })

  it('copies where there is none, and skips a step whose every source is missing', async () => {
    writeFileSync(join(main, '.env.local'), 'SECRET=local\n')

    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([
          { kind: 'copy', path: '.env.local', scope: 'root', commandId: null },
          { kind: 'copy', path: '.env.absent', scope: 'repositories', commandId: null },
        ])
        const prepared = yield* preparation.prepare(workspace.id)
        return { prepared, steps: yield* stepsOf(workspace.id) }
      }),
    )

    expect(seen.steps[2]).toMatchObject({ state: 'done', message: null })
    expect(readFileSync(join(seen.prepared.path, '.env.local'), 'utf8')).toBe('SECRET=local\n')
    expect(seen.steps[3]).toMatchObject({
      state: 'skipped',
      message: 'sources/api: no source; sources/front: no source',
    })
    expect(seen.prepared.state).toBe('ready')
  })
})

describe('A failed step keeps what succeeded', () => {
  it('keeps the first worktree, fails the second with Git’s words, and creates no Session', async () => {
    const count = join(folder, 'installs')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([
          { run: node(`require('fs').appendFileSync('${quoted(count)}','x')`) },
        ])
        // Between the creation and the preparation, somebody made the branch in front.
        git(join(main, 'sources', 'front'), 'branch', BRANCH)
        const prepared = yield* preparation.prepare(workspace.id)
        const sql = yield* SqliteClient
        const [sessions] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM sessions`
        const events = yield* sql<{ type: string }>`
          SELECT type FROM domain_events WHERE entity_kind = 'workspace' ORDER BY sequence`
        return { prepared, sessions, events, steps: yield* stepsOf(workspace.id) }
      }),
    )

    const worktree = join(seen.prepared.path, 'sources', 'api')
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH)
    expect(shown(seen.steps)).toEqual([
      ['worktree', API, 'done'],
      ['worktree', FRONT, 'failed'],
      ['run', 'install', 'pending'],
    ])
    expect(seen.steps[1]?.message).toBe(`fatal: a branch named '${BRANCH}' already exists`)
    expect(seen.prepared.state).toBe('failed')
    expect(existsSync(count)).toBe(false)
    expect(seen.sessions?.count).toBe(0)
    expect(seen.events.map((event) => event.type)).toEqual([
      'workspace.created',
      'workspace.step_done',
      'workspace.step_failed',
    ])
  })
})

describe('Resuming re-checks before retrying', () => {
  it('redoes the removed worktree, retries the failed one, and never runs a done run twice', async () => {
    const count = join(folder, 'installs')
    const front = join(main, 'sources', 'front')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([
          { run: node(`require('fs').appendFileSync('${quoted(count)}','x')`) },
        ])
        git(front, 'branch', BRANCH)
        yield* preparation.prepare(workspace.id)

        // The first worktree's folder removed by hand, and the cause of the second's failure
        // fixed: Git still holds the first as registered, which the resume has to deal with.
        const first = join(workspace.path, 'sources', 'api')
        rmSync(first, { recursive: true, force: true })
        git(front, 'branch', '-D', BRANCH)
        const resumed = yield* preparation.resume(workspace.id)
        const afterResume = yield* stepsOf(workspace.id)
        const installs = readFileSync(count, 'utf8')

        // Once more, with every step done: the worktree is redone, the run is not.
        rmSync(first, { recursive: true, force: true })
        const again = yield* preparation.resume(workspace.id)
        const sql = yield* SqliteClient
        const events = yield* sql<{ type: string; payload: string }>`
          SELECT type, payload FROM domain_events WHERE type = 'workspace.resumed'
          ORDER BY sequence`
        const afterAgain = yield* stepsOf(workspace.id)
        return {
          resumed,
          afterResume,
          installs,
          again,
          afterAgain,
          events,
          first,
          runs: yield* runRows,
        }
      }),
    )

    expect(seen.resumed.state).toBe('ready')
    expect(shown(seen.afterResume)).toEqual([
      ['worktree', API, 'done'],
      ['worktree', FRONT, 'done'],
      ['run', 'install', 'done'],
    ])
    expect(seen.afterResume[2]?.message).toBe('exit 0')
    expect(git(seen.first, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH)
    expect(
      git(join(seen.resumed.path, 'sources', 'front'), 'rev-parse', '--abbrev-ref', 'HEAD'),
    ).toBe(BRANCH)
    expect(seen.installs).toBe('x')
    // The second resume redid the worktree and ran nothing.
    expect(seen.again.state).toBe('ready')
    expect(existsSync(join(seen.first, '.git'))).toBe(true)
    expect(readFileSync(count, 'utf8')).toBe('x')
    // The done run is the same run, the one row of it (Decided 11).
    expect(seen.runs.map((run) => run.id)).toEqual([seen.afterResume[2]?.runId])
    expect(seen.afterAgain[2]?.runId).toBe(seen.afterResume[2]?.runId)
    expect(seen.events.map((event) => JSON.parse(event.payload))).toEqual([
      { redone: 1, retried: 1 },
      { redone: 1, retried: 0 },
    ])
  })
})

describe('A link that the system refuses is a failed step', () => {
  it('fails naming the system’s message, stops there, and can be resumed', async () => {
    writeFileSync(join(main, 'CLAUDE.md'), '# Atlas\n')
    const refusing = Layer.succeed(Links, {
      link: () => Effect.fail(new LinkRefusedError({ message: 'EPERM: the system refused' })),
    })

    const refused = await workspaceEngine(
      folder,
      undefined,
      refusing,
    )(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([LINK_CLAUDE, { run: node('process.exit(0)') }])
        const prepared = yield* preparation.prepare(workspace.id)
        return { prepared, steps: yield* stepsOf(workspace.id) }
      }),
    )

    expect(shown(refused.steps)).toEqual([
      ['worktree', API, 'done'],
      ['worktree', FRONT, 'done'],
      ['link', './CLAUDE.md', 'failed'],
      ['run', 'install', 'pending'],
    ])
    expect(refused.steps[2]?.message).toBe('CLAUDE.md: EPERM: the system refused')
    expect(refused.prepared.state).toBe('failed')

    // The same data folder, on a system that makes links: the resume carries on from there.
    const resumed = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        return yield* preparation.resume(refused.prepared.id)
      }),
    )

    expect(resumed.state).toBe('ready')
    const link = join(resumed.path, 'CLAUDE.md')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(link, 'utf8')).toBe('# Atlas\n')
  })
})

describe('A link is a junction for a folder and a symbolic link for a file on Windows', () => {
  /** The reparse tag Windows gives a link: a junction is a mount point, a symbolic link its own. */
  const tagOf = (path: string) =>
    /Reparse Tag Value : (0x[0-9a-f]+)/i.exec(
      execFileSync('fsutil', ['reparsepoint', 'query', path], { encoding: 'utf8' }),
    )?.[1]

  it.runIf(process.platform === 'win32')(
    'links main’s folder as a junction and its file as a symbolic link, on Windows',
    async () => {
      writeFileSync(join(main, 'CLAUDE.md'), '# Atlas\n')
      mkdirSync(join(main, 'shared'))
      writeFileSync(join(main, 'shared', 'notes.md'), 'shared\n')

      const prepared = await workspaceEngine(folder)(
        Effect.gen(function* () {
          const preparation = yield* Preparation
          const workspace = yield* createdWith([
            LINK_CLAUDE,
            { kind: 'link', path: 'shared', scope: 'root', commandId: null },
          ])
          return yield* preparation.prepare(workspace.id)
        }),
      )

      expect(prepared.state).toBe('ready')
      const file = join(prepared.path, 'CLAUDE.md')
      const shared = join(prepared.path, 'shared')
      expect(tagOf(file)).toBe('0xa000000c')
      expect(tagOf(shared)).toBe('0xa0000003')
      expect(readFileSync(file, 'utf8')).toBe('# Atlas\n')
      expect(readFileSync(join(shared, 'notes.md'), 'utf8')).toBe('shared\n')
    },
  )
})

describe('A run step fails on a non-zero exit', () => {
  it('fails the step, keeps the output and the exit code on its run, and fails the Workspace', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([{ run: node("console.log('nope');process.exit(1)") }])
        const prepared = yield* preparation.prepare(workspace.id)
        return { prepared, steps: yield* stepsOf(workspace.id), runs: yield* runRows }
      }),
    )

    const install = seen.steps[2]
    expect(install?.state).toBe('failed')
    expect(install?.message).toBe('exit 1')
    expect(seen.prepared.state).toBe('failed')
    // The run is a real one, of no Session, in the Workspace: its output and its code are its
    // row's, and the step points at it (Decided 11).
    expect(seen.runs).toHaveLength(1)
    expect(seen.runs[0]).toMatchObject({
      id: install?.runId,
      session_id: null,
      workspace_id: seen.prepared.id,
      state: 'failed',
      exit_code: 1,
    })
    expect(seen.runs[0]?.output.trim()).toBe('nope')
  })
})

describe('A Session’s panel never lists a preparation run', () => {
  it('leaves the run out of what a Session of main and a Session of the Workspace read', async () => {
    const release = join(folder, 'release')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const sessions = yield* Sessions
        const workspace = yield* createdWith([{ run: heldUntil(release) }])
        const inMain = yield* sessions.create(workspace.projectId, 'claude')
        const preparing = yield* Effect.forkScoped(preparation.prepare(workspace.id))
        yield* until(stepsOf(workspace.id), (steps) => steps[2]?.runId !== null)
        const whileRunning = yield* runsOf(inMain.id)
        writeFileSync(release, '')
        const prepared = yield* Fiber.join(preparing)
        const inWorkspace = yield* sessions.create(workspace.projectId, 'claude', workspace.id)
        return {
          prepared,
          whileRunning,
          ofMain: yield* runsOf(inMain.id),
          ofWorkspace: yield* runsOf(inWorkspace.id),
          runs: yield* runRows,
        }
      }),
    )

    expect(seen.prepared.state).toBe('ready')
    expect(seen.runs).toHaveLength(1)
    expect(seen.whileRunning).toEqual([])
    expect(seen.ofMain).toEqual([])
    expect(seen.ofWorkspace).toEqual([])
  })
})

describe('A cleanup and a preparation never overlap', () => {
  it('refuses a cleanup asked during a run step, and the Workspace ends as the preparation does', async () => {
    const release = join(folder, 'release')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspaces = yield* Workspaces
        const workspace = yield* createdWith([{ run: heldUntil(release) }])
        const preparing = yield* Effect.forkScoped(preparation.prepare(workspace.id))
        const during = yield* until(stepsOf(workspace.id), (steps) => steps[2]?.state === 'running')
        const refused = yield* Effect.flip(workspaces.cleanup(workspace.id))
        writeFileSync(release, '')
        const prepared = yield* Fiber.join(preparing)
        return { during, refused, prepared, after: yield* workspaces.one(workspace.id) }
      }),
    )

    expect(seen.during[2]?.state).toBe('running')
    expect(seen.refused).toBeInstanceOf(CleanupRefusedError)
    expect(seen.refused.message).toBe('the Workspace login-form is being prepared')
    expect(seen.prepared.state).toBe('ready')
    expect(seen.after.state).toBe('ready')
    expect(existsSync(join(seen.after.path, 'sources', 'api', '.git'))).toBe(true)
  })

  it('writes nothing over a Workspace that was cleaned up while a step ran', async () => {
    const release = join(folder, 'release')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspaces = yield* Workspaces
        const workspace = yield* createdWith([{ run: heldUntil(release) }])
        const preparing = yield* Effect.forkScoped(preparation.prepare(workspace.id))
        yield* until(stepsOf(workspace.id), (steps) => steps[2]?.state === 'running')
        // Whatever cleaned it — another engine, a hand on the database — it is cleaned now.
        const sql = yield* SqliteClient
        yield* sql`UPDATE workspaces SET state = 'cleaned' WHERE id = ${workspace.id}`
        writeFileSync(release, '')
        yield* Fiber.join(preparing)
        const events = yield* sql<{ type: string }>`
          SELECT type FROM domain_events WHERE type = 'workspace.ready'`
        return { after: yield* workspaces.one(workspace.id), events }
      }),
    )

    expect(seen.after.state).toBe('cleaned')
    expect(seen.events).toEqual([])
  })
})

describe('One preparation of a Workspace runs at a time', () => {
  it('runs one of two resumes asked together, refuses the other, and installs once', async () => {
    const count = join(folder, 'installs')
    const front = join(main, 'sources', 'front')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([
          { run: node(`require('fs').appendFileSync('${quoted(count)}','x')`) },
        ])
        git(front, 'branch', BRANCH)
        yield* preparation.prepare(workspace.id)
        git(front, 'branch', '-D', BRANCH)
        const both = yield* Effect.all(
          [preparation.resume(workspace.id), preparation.resume(workspace.id)].map((one) =>
            Effect.result(one),
          ),
          { concurrency: 'unbounded' },
        )
        return { both, steps: yield* stepsOf(workspace.id) }
      }),
    )

    const ran = seen.both.filter(Result.isSuccess)
    const refused = seen.both.filter(Result.isFailure).map((one) => one.failure)
    expect(ran).toHaveLength(1)
    expect(ran[0]?.success.state).toBe('ready')
    expect(refused).toHaveLength(1)
    expect(refused[0]).toBeInstanceOf(PreparationRunningError)
    expect(readFileSync(count, 'utf8')).toBe('x')
    expect(shown(seen.steps).map((step) => step[2])).toEqual(['done', 'done', 'done'])
  })
})

describe('A step’s output stays off its Journal line', () => {
  /** The step events of the Workspace, as their payloads. */
  const stepEvents = Effect.gen(function* () {
    const sql = yield* SqliteClient
    const rows = yield* sql<{ payload: string }>`
      SELECT payload FROM domain_events WHERE type LIKE 'workspace.step_%' ORDER BY sequence`
    return rows.map((row) => JSON.parse(row.payload))
  })

  it('says a run that succeeded without what it printed', async () => {
    const events = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([{ run: node("console.log('TOKEN=secret-value')") }])
        yield* preparation.prepare(workspace.id)
        return yield* stepEvents
      }),
    )

    expect(events).toEqual([
      { kind: 'worktree', target: API, state: 'done', message: null },
      { kind: 'worktree', target: FRONT, state: 'done', message: null },
      { kind: 'run', target: 'install', state: 'done', message: null },
    ])
  })

  it('says a failure by the first line of its message, and keeps the output on the run', async () => {
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([
          { run: node("console.log('TOKEN=secret-value');process.exit(1)") },
        ])
        yield* preparation.prepare(workspace.id)
        return {
          events: yield* stepEvents,
          steps: yield* stepsOf(workspace.id),
          runs: yield* runRows,
        }
      }),
    )

    expect(seen.events.at(-1)).toEqual({
      kind: 'run',
      target: 'install',
      state: 'failed',
      message: 'exit 1',
    })
    // What it printed is its run's, where it is read (Decided 11).
    expect(seen.steps[2]?.message).toBe('exit 1')
    expect(seen.runs[0]?.output.trim()).toBe('TOKEN=secret-value')
  })
})

describe('A preparation interrupted by a quit can be resumed', () => {
  const release = () => join(folder, 'release')

  /**
   * A Workspace whose preparation was begun in the background and whose engine quit while its
   * `run` step held: the program ends, and the engine's scope closes under the step.
   */
  const interrupted = () =>
    workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspace = yield* createdWith([{ run: heldUntil(release()) }])
        yield* preparation.begin(workspace.id, false)
        yield* until(stepsOf(workspace.id), (steps) => steps[2]?.runId !== null)
        return workspace
      }),
    )

  it('finds the step pending and the Workspace not live at the next start, and resumes to ready', async () => {
    const workspace = await interrupted()
    // The command may end, once it is run again.
    writeFileSync(release(), '')
    const seen = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        const workspaces = yield* Workspaces
        const swept = yield* stepsOf(workspace.id)
        const before = yield* workspaces.one(workspace.id)
        const runs = yield* runRows
        const resumed = yield* preparation.resume(workspace.id)
        return { swept, before, runs, resumed, after: yield* stepsOf(workspace.id) }
      }),
    )

    expect(shown(seen.swept)).toEqual([
      ['worktree', API, 'done'],
      ['worktree', FRONT, 'done'],
      ['run', 'install', 'pending'],
    ])
    expect(seen.before).toMatchObject({ state: 'preparing', live: false })
    // The run the quit took down is over, with its end.
    expect(seen.runs).toHaveLength(1)
    expect(seen.runs[0]?.state).toBe('stopped')
    expect(seen.runs[0]?.ended_at).not.toBeNull()
    expect(seen.resumed).toMatchObject({ state: 'ready', live: false })
    expect(seen.after[2]).toMatchObject({ state: 'done', message: 'exit 0' })
  })

  it('lets that Workspace be cleaned up, since nothing prepares it any more', async () => {
    const workspace = await interrupted()
    const cleaned = await workspaceEngine(folder)(
      Effect.gen(function* () {
        const workspaces = yield* Workspaces
        return yield* workspaces.cleanup(workspace.id)
      }),
    )

    expect(cleaned).toMatchObject({ state: 'cleaned', live: false })
    expect(existsSync(cleaned.path)).toBe(false)
  })
})

describe('A run a dead engine left running is ended at the next start', () => {
  it('writes it stopped, with its end and one Journal line', async () => {
    // What an engine killed in the middle of a run leaves: a row still `running`.
    await workspaceEngine(folder)(
      Effect.gen(function* () {
        const project = yield* atlas(main, [])
        const sql = yield* SqliteClient
        yield* sql`INSERT INTO command_runs (id, session_id, name, line, type, cwd, state, started_by, started_at)
          VALUES ('left', NULL, 'dev', 'pnpm dev', 'serve', ${main}, 'running', 'user', '2026-09-24T08:00:00.000Z')`
        return project
      }),
    )
    const ended = Effect.gen(function* () {
      const sql = yield* SqliteClient
      const lines = yield* sql<{ count: number }>`
        SELECT count(*) AS count FROM domain_events WHERE type = 'command.run_ended'`
      return { runs: yield* runRows, lines: lines[0]?.count }
    })
    const first = await workspaceEngine(folder)(ended)
    const second = await workspaceEngine(folder)(ended)

    expect(first.runs[0]).toMatchObject({ id: 'left', state: 'stopped' })
    expect(first.runs[0]?.ended_at).not.toBeNull()
    expect(first.lines).toBe(1)
    // Written once: the next start finds nothing left running.
    expect(second.lines).toBe(1)
  })
})

describe('A preparation that fails in the background is told as no longer live', () => {
  it('tells the window after letting the Workspace go, and the Workspace reads failed', async () => {
    // At each notice, whether the Workspace was still held: what a page reading it then sees.
    const heldAtNotice: boolean[] = []
    let workspaces: WorkspacesService | null = null
    // Where the preparation's own notices begin: the creation was told before it.
    let from = 0
    const listening = Layer.succeed(AgentNotices, {
      wrote: () => undefined,
      changed: () => undefined,
      ran: () => undefined,
      workspace: (_projectId, workspaceId) => {
        if (workspaces === null) return
        const free = Effect.runSync(workspaces.hold(workspaceId))
        if (free) Effect.runSync(workspaces.release(workspaceId))
        heldAtNotice.push(!free)
      },
    })

    const seen = await workspaceEngine(
      folder,
      undefined,
      hostLinks,
      listening,
    )(
      Effect.gen(function* () {
        const preparation = yield* Preparation
        workspaces = yield* Workspaces
        const workspace = yield* createdWith([{ run: node('process.exit(1)') }])
        from = heldAtNotice.length
        yield* preparation.begin(workspace.id, false)
        yield* until(
          Effect.sync(() => heldAtNotice),
          (heard) => heard.length > 1 && heard.at(-1) === false,
        )
        return yield* workspaces.one(workspace.id)
      }),
    )

    expect(heldAtNotice.slice(from, -1).every((held) => held)).toBe(true)
    expect(heldAtNotice.at(-1)).toBe(false)
    expect(seen).toMatchObject({ state: 'failed', live: false })
  })
})
