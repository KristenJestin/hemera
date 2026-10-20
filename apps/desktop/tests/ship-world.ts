/**
 * What the suites of Ship share (R9): the engine with the fake agent of #32 as every agent, Acme's
 * `api` and `web` in temporary folders, each with a bare repository on the same disk as its remote,
 * named on a forge host that never resolves (`url.<bare>.pushInsteadOf`), and `gh` a fake alone on a
 * `PATH` of its own whose pull requests live in a file, with their approvals and their CI. The
 * Project's checks are the test's (`TaskChecks`); the proofs run for real on `node --test`.
 *
 * A mission is launched into Building, its Building ended and the mission moved into Review the way
 * the end of a Building leaves it; its final check and its automated proof are recorded green on
 * the trees of the moment, as the end leaves them. No real forge, no network.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  DEFAULT_BASE_BRANCH,
  type DeliveryAction,
  type DeliveryRulesDraft,
  defaultDeliveryRules,
  maskText,
} from '@hemera/core/domain'
import type { RepositoryPush } from '@hemera/ipc'
import { and, asc, desc, eq } from 'drizzle-orm'
import { Deferred, Effect, Layer } from 'effect'

import { type CheckResult, TaskChecks } from '../src/engine/building/checks.ts'
import { OutsideChanges } from '../src/engine/building/outside.ts'
import { Snapshots } from '../src/engine/building/snapshots.ts'
import { missionCopies, saveDeliveryRules } from '../src/engine/delivery-rules.ts'
import { Pushes } from '../src/engine/delivery/pushes.ts'
import { ForgePort } from '../src/engine/forges/port.ts'
import { getMission, moveIn } from '../src/engine/missions.ts'
import { createProject, getProject } from '../src/engine/projects.ts'
import type { ShipMoment } from '../src/engine/review/ship.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingAttempts,
  buildingCheckResults,
  buildingLaunches,
  buildings,
  proofRuns,
  scenarioProofs,
  specProofs,
  workspaceRepositories,
} from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { builderAgents, builderOf, buildingNow, launched } from './builder-world.ts'
import { INVOICES, PACKAGE } from './building-world.ts'
import { type FakeForge, fakeForge, ghReady } from './fake-forge.ts'
import { git, remote, repository } from './repositories.ts'
import { HELPER, sessionsEngine, until } from './sessions-world.ts'
import { temporaryFolder } from './storage.ts'

/** The forge's host: `.test` never resolves, so nothing a remote names is ever reached. */
export const HOST = 'git.acme.test'

/** Every test runs a whole engine, Git, a Builder and a proof: far above its time alone. */
export const SLOW = 180_000

/** How long a step may take on a slow runner: never a measure of speed. */
export const LONG = 60_000

/**
 * The fake forge's pull requests, kept in a file beside it: `pr list` and `pr view` read them,
 * `pr create` adds one. A pull request's head is the branch's commit on the bare repository; its
 * approval and its CI (`checks`, GitHub's status check rollup) are what the test wrote on it.
 */
const FORGE_PROGRAM = String.raw`
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const config = JSON.parse(readFileSync(join(__dirname, 'forge.json'), 'utf8'))
const kept = join(__dirname, 'prs.json')
const read = () => (existsSync(kept) ? JSON.parse(readFileSync(kept, 'utf8')) : [])
const valueOf = (args, flag) => {
  const at = args.indexOf(flag)
  return at < 0 ? undefined : args[at + 1]
}
const headOf = (bare, branch) => {
  const loose = join(bare, 'refs', 'heads', ...branch.split('/'))
  if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
  const packed = join(bare, 'packed-refs')
  if (!existsSync(packed)) return ''
  const line = readFileSync(packed, 'utf8').split('\n').find((one) => one.endsWith(' refs/heads/' + branch))
  return line === undefined ? '' : line.split(' ')[0]
}
module.exports = (cli, args) => {
  const repo = (valueOf(args, '--repo') ?? '').split('/').slice(1).join('/')
  const bare = config.bares[repo]
  const prs = read()
  if (args[1] === 'list') {
    const found = prs.filter(
      (one) =>
        one.repo === repo &&
        one.head === valueOf(args, '--head') &&
        one.base === valueOf(args, '--base') &&
        one.state === 'OPEN',
    )
    return {
      stdout: JSON.stringify(
        found.map((one) => ({
          number: one.number,
          url: one.url,
          state: one.state,
          headRefOid: headOf(bare, one.head),
        })),
      ),
    }
  }
  if (args[1] === 'create') {
    const body = readFileSync(0, 'utf8')
    const number = prs.length + 1
    const created = {
      repo,
      number,
      url: 'https://' + config.host + '/' + repo + '/pull/' + String(number),
      head: valueOf(args, '--head'),
      base: valueOf(args, '--base'),
      title: valueOf(args, '--title'),
      body,
      state: 'OPEN',
      approved: false,
      checks: [],
    }
    writeFileSync(kept, JSON.stringify([...prs, created]))
    return { stdout: created.url + '\n' }
  }
  if (args[1] === 'view') {
    const one = prs.find((pr) => pr.repo === repo && pr.number === Number(args[2]))
    if (one === undefined) return { stderr: 'no pull requests found', code: 1 }
    if ((valueOf(args, '--json') ?? '') === 'statusCheckRollup') {
      return { stdout: JSON.stringify({ statusCheckRollup: one.checks }) }
    }
    return {
      stdout: JSON.stringify({
        number: one.number,
        url: one.url,
        state: one.state,
        headRefOid: headOf(bare, one.head),
        reviewDecision: one.approved ? 'APPROVED' : 'REVIEW_REQUIRED',
        latestReviews: one.approved ? [{ author: { login: 'grace' }, state: 'APPROVED' }] : [],
      }),
    }
  }
  return { stderr: 'fake forge: ' + args.join(' '), code: 1 }
}
`

/** A pull request of the fake forge, as its file keeps it. */
export interface FakePullRequest {
  readonly repo: string
  readonly number: number
  readonly head: string
  readonly approved: boolean
  readonly checks: ReadonlyArray<Readonly<Record<string, string>>>
}

export interface ShipWorld {
  readonly data: string
  readonly work: string
  readonly fake: FakeForge
  readonly pullRequests: () => ReadonlyArray<FakePullRequest>
  /** Changes a pull request of the fake forge, by its repository's name. */
  readonly setPullRequest: (name: string, change: Partial<FakePullRequest>) => void
  /** What the Project's final checks answer now, by check name. */
  readonly checks: Map<string, 'green' | 'red'>
  /** How many times the Project's final checks were asked. */
  readonly asked: { count: number }
}

export const shipWorld = (): ShipWorld => {
  const data = temporaryFolder('ship')
  const work = temporaryFolder('ship-work')
  const folder = temporaryFolder('ship-forge')
  const program = join(folder, 'forge.cjs')
  writeFileSync(program, FORGE_PROGRAM)
  writeFileSync(
    join(folder, 'forge.json'),
    JSON.stringify({
      host: HOST,
      bares: {
        'acme/api': join(work, 'remotes', 'api.git'),
        'acme/web': join(work, 'remotes', 'web.git'),
      },
    }),
  )
  const fake = fakeForge([...ghReady(HOST), { cli: 'gh', when: ['pr'], program }], ['gh'])
  const kept = join(folder, 'prs.json')
  const pullRequests = (): ReadonlyArray<FakePullRequest> =>
    existsSync(kept) ? JSON.parse(readFileSync(kept, 'utf8')) : []
  return {
    data,
    work,
    fake,
    pullRequests,
    setPullRequest: (name, change) =>
      writeFileSync(
        kept,
        JSON.stringify(
          pullRequests().map((one) =>
            one.repo === `acme/${name}` ? Object.assign({}, one, change) : one,
          ),
        ),
      ),
    checks: new Map([['test', 'green']]),
    asked: { count: 0 },
  }
}

/** The Project's final checks as the world answers them, each in `api`. */
const worldChecks = (world: ShipWorld) =>
  Layer.succeed(TaskChecks, {
    run: (asked) =>
      Effect.sync(() => {
        if (asked.scope !== 'end') return []
        world.asked.count += 1
        return [...world.checks].map(([name, verdict]): CheckResult => ({
          name,
          place: 'api',
          verdict,
          detail: verdict === 'red' ? 'it exited 1' : 'it exited 0',
          outputTail: verdict === 'red' ? `${name}: 1 failing` : `${name}: all passing`,
          runId: null,
        }))
      }),
  })

/** The engine of a Ship suite, held where the test says. */
export const shipEngine = (
  world: ShipWorld,
  hold: (at: ShipMoment) => Effect.Effect<void> = () => Effect.void,
) =>
  sessionsEngine(world.data, builderAgents, {
    roles: [HELPER],
    tools: { home: world.work },
    building: {
      outside: { compareEveryMillis: 3_600_000, baseEveryMillis: 3_600_000 },
      checks: worldChecks(world),
    },
    forge: { env: world.fake.env },
    ship: { hold },
  })

/** A hold that stops a Ship at one moment, for good, and says it did. */
export const stopAt = (moment: ShipMoment) => {
  const reached = Effect.runSync(Deferred.make<void>())
  return {
    reached: Deferred.await(reached),
    hold: (at: ShipMoment) =>
      at === moment
        ? Effect.andThen(Deferred.succeed(reached, undefined), Effect.never)
        : Effect.void,
  }
}

/** A hold that waits at one moment until the test lets it go. */
export const pauseAt = (moment: ShipMoment) => {
  const reached = Effect.runSync(Deferred.make<void>())
  const go = Effect.runSync(Deferred.make<void>())
  return {
    reached: Deferred.await(reached),
    release: Deferred.succeed(go, undefined),
    hold: (at: ShipMoment) =>
      at === moment
        ? Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(go))
        : Effect.void,
  }
}

/** Every action of the preparation automatic: Hemera commits, pushes, opens the pull request. */
const PUSH_STACK: ReadonlyArray<DeliveryAction> = [
  { id: 'commit', kind: 'commit-by-hemera', mode: 'auto' },
  { id: 'push', kind: 'push', mode: 'auto' },
  { id: 'pull-request', kind: 'pull-request', mode: 'auto' },
]

/** The Project's rules, written once its repositories have ids: `idOf` names one by its path. */
export type RulesFor = (idOf: (path: string) => string) => DeliveryRulesDraft

/** The Project's rules: the pushes automatic, the rest as the test changes it. */
export const rulesWith =
  (
    change: (draft: DeliveryRulesDraft, idOf: (path: string) => string) => DeliveryRulesDraft = (
      draft,
    ) => draft,
  ): RulesFor =>
  (idOf) => {
    const draft = defaultDeliveryRules()
    return change(
      {
        ...draft,
        preparation: {
          ...draft.preparation,
          presets: { ...draft.preparation.presets, application: PUSH_STACK },
        },
      },
      idOf,
    )
  }

/** Acme's `api` and `web`, each on its bare remote under the forge's name, the user's identity set. */
const acmeOnForge = (work: string) => (at: string) =>
  Effect.gen(function* () {
    const main = join(at, 'acme')
    for (const name of ['api', 'web']) {
      const folder = repository(join(main, name), DEFAULT_BASE_BRANCH)
      writeFileSync(join(folder, 'README.md'), `Acme ${name}\n`)
      writeFileSync(join(folder, '.gitignore'), '*.log\n')
      if (name === 'api') {
        writeFileSync(join(folder, 'invoices.ts'), INVOICES)
        writeFileSync(join(folder, 'package.json'), PACKAGE)
      }
      git(folder, 'add', '.')
      git(folder, 'commit', '-q', '-m', 'readme')
      const bare = remote(folder, join(work, 'remotes', `${name}.git`))
      const named = `https://${HOST}/acme/${name}.git`
      git(folder, 'remote', 'set-url', 'origin', named)
      git(folder, 'config', `url.${bare.replaceAll('\\', '/')}.pushInsteadOf`, named)
      git(folder, 'config', 'user.name', 'Ada Lovelace')
      git(folder, 'config', 'user.email', 'ada@example.com')
    }
    const project = yield* createProject({
      name: 'acme',
      mainCheckout: main,
      repositories: ['api', 'web'],
    })
    return { project, main }
  })

/** The Project's forge forced to GitHub on the fake's host, and its rules saved. */
const onForge = (rules: RulesFor) => (projectId: string) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const port = yield* ForgePort
    for (const one of project.repositories) {
      yield* port.setForced(project.id, one.id, 'github', HOST)
    }
    const idOf = (path: string) => project.repositories.find((one) => one.path === path)?.id ?? path
    yield* saveDeliveryRules(project.id, rules(idOf), 0)
  }).pipe(Effect.orDie)

/** The scenario whose proof is automated: R1.S2, its test a file of `api`. */
export const SCENARIO = 'R1.S2'
export const TEST_PATH = 'tests/ship.test.mjs'

/** R1.S2's test: green while `api/broken.txt` does not exist. */
const TEST_CODE = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { existsSync } from 'node:fs'",
  '',
  "test('the scenario holds', () => {",
  "  assert.equal(existsSync(new URL('../broken.txt', import.meta.url)), false, 'broken.txt is there')",
  '})',
  '',
].join('\n')

const PROOF = {
  mode: 'automated',
  actions: ['Run the test'],
  starting_data: 'None.',
  expected: 'The assertion of the test holds.',
  test: {
    repository: 'api',
    path: TEST_PATH,
    code: TEST_CODE,
    insertion: 'new_file',
    command: `"${process.execPath}" --test --test-reporter=tap ${TEST_PATH}`,
  },
  seen_today: false,
}

export interface InReview {
  readonly missionId: string
  readonly projectId: string
  readonly api: string
  readonly web: string
  readonly branch: string
}

/** The folder of a repository of the mission's Workspace. */
const foldersOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [launch] = yield* database
      .select({ workspaceId: buildingLaunches.workspaceId })
      .from(buildingLaunches)
      .where(eq(buildingLaunches.missionId, missionId))
      .orderBy(desc(buildingLaunches.startedAt))
    const rows = yield* database
      .select()
      .from(workspaceRepositories)
      .where(eq(workspaceRepositories.workspaceId, launch?.workspaceId ?? ''))
      .orderBy(asc(workspaceRepositories.position))
    return (path: string) => {
      const found = rows.find((row) => row.path === path)?.worktree
      if (found === undefined) throw new Error(`no ${path} in the Workspace`)
      return found
    }
  })

/** The tree of each repository now, recorded as the current one (#140). */
export const treesNow = (mission: InReview) =>
  Effect.gen(function* () {
    const snapshots = yield* Snapshots
    const trees: Array<{ readonly repository: string; readonly tree: string }> = []
    for (const [name, folder] of [
      ['api', mission.api],
      ['web', mission.web],
    ] as const) {
      const tree = yield* snapshots.take(
        { name, folder },
        { kind: 'run', missionId: mission.missionId, runId: crypto.randomUUID(), side: 'after' },
      )
      trees.push({ repository: name, tree })
    }
    return trees
  }).pipe(Effect.orDie)

/** Waits until a repository's push stands in a state. */
export const pushedIn = (missionId: string, name: string, state: RepositoryPush['state']) =>
  until(
    Effect.map(
      Pushes.use((pushes) => pushes.pushes(missionId)),
      (pushes) => pushes.repositories.find((one) => one.repository === name)?.state === state,
    ),
    LONG,
  )

/**
 * Acme's mission launched over `api` and `web`, R1.S2 proven by its test: its Building ended as
 * the end of a Building leaves it, the mission in Review with its pushes done (unless the rules
 * push nothing: `pushed` false), its final check
 * `test` and its proof green on the trees of the moment.
 */
export const shipReady = (world: ShipWorld, rules: RulesFor = rulesWith(), pushed = true) =>
  Effect.gen(function* () {
    const { mission, project } = yield* launched(
      world.work,
      onForge(rules),
      'It touches api and web, nothing else.',
      undefined,
      acmeOnForge(world.work),
    )
    // The Builder's first turn ended: its Building and its Workspace are there, and it is quiet.
    yield* builderOf(mission.id)
    const building = yield* buildingNow(mission.id)
    const folderOf = yield* foldersOf(mission.id)
    const api = folderOf('api')
    const ready: InReview = {
      missionId: mission.id,
      projectId: project.id,
      api,
      web: folderOf('web'),
      branch: git(api, 'rev-parse', '--abbrev-ref', 'HEAD'),
    }
    // What the tasks built: the test of R1.S2 and a change in each repository.
    writeFileSync(join(api, 'export.ts'), 'export const toMarkdown = () => ""\n')
    writeFileSync(join(ready.web, 'page.ts'), 'export const page = 1\n')
    yield* writeFile(api, TEST_PATH, TEST_CODE)
    // What the tasks built is found now, so a later compare finds only what the test changes.
    yield* OutsideChanges.use((outside) => outside.compare(mission.id, null))
    yield* proofGreen(ready, building.buildingId)
    yield* finalCheckGreen(ready, building.buildingId)
    const now = new Date().toISOString()
    const current = yield* getMission(mission.id)
    yield* mutate('ending the Building', (transaction) =>
      Effect.gen(function* () {
        yield* transaction
          .update(buildings)
          .set({ state: 'ended', phase: 'ended', endedAt: now })
          .where(eq(buildings.id, building.buildingId))
        const moved = yield* moveIn(
          transaction,
          { id: mission.id, stage: current.stage, round: current.round },
          'endBuilding',
          'hemera',
        )
        return { result: undefined, events: [moved] }
      }).pipe(Effect.orDie),
    )
    if (pushed) {
      yield* pushedIn(mission.id, 'api', 'done')
      yield* pushedIn(mission.id, 'web', 'done')
    } else {
      // Review's entry copies the preparation even when it pushes nothing: once, then quiet.
      yield* until(
        Effect.map(missionCopies(mission.id), (copies) =>
          copies.some((one) => one.section === 'preparation'),
        ),
        LONG,
      )
    }
    return ready
  })

/** A file written into a repository of the Workspace, its folders made. */
export const writeFile = (folder: string, path: string, content: string) =>
  Effect.sync(() => {
    const target = join(folder, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  })

/** R1.S2 automated, with its test, and green on the trees of now. */
const proofGreen = (mission: InReview, buildingId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const trees = yield* treesNow(mission)
    const at = new Date().toISOString()
    const runId = crypto.randomUUID()
    yield* database
      .update(specProofs)
      .set({ block: maskText(JSON.stringify(PROOF), []) })
      .where(and(eq(specProofs.missionId, mission.missionId), eq(specProofs.scenarioId, SCENARIO)))
    yield* database.insert(proofRuns).values({
      id: runId,
      missionId: mission.missionId,
      buildingId,
      scenario: SCENARIO,
      phase: 'green',
      line: maskText(PROOF.test.command, []),
      testPath: `api/${TEST_PATH}`,
      testSha256: null,
      exitCode: 0,
      classification: 'passed',
      failingTest: null,
      assertion: null,
      keyLineMatched: null,
      outputTail: maskText('ok 1 - the scenario holds', []),
      evidenceId: null,
      testEvidenceId: null,
      runId: null,
      trees: JSON.stringify(trees.filter((one) => one.repository === 'api')),
      at,
    })
    yield* database
      .update(scenarioProofs)
      .set({ mode: 'automated', state: 'green', greenRunId: runId, updatedAt: at })
      .where(and(eq(scenarioProofs.buildingId, buildingId), eq(scenarioProofs.scenario, SCENARIO)))
  }).pipe(Effect.orDie)

/** The end's final check `test` green in `api`, on the trees of now. */
const finalCheckGreen = (mission: InReview, buildingId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const trees = yield* treesNow(mission)
    const at = new Date().toISOString()
    const attemptId = crypto.randomUUID()
    yield* database.insert(buildingAttempts).values({
      id: attemptId,
      buildingId,
      taskId: null,
      number: 1,
      runner: 'builder',
      epoch: 0,
      starts: '[]',
      startedAt: at,
      endedAt: at,
      outcome: 'green',
      outside: '[]',
      scope: 'end',
      subject: null,
      verdict: 'green',
    })
    yield* database.insert(buildingCheckResults).values({
      id: crypto.randomUUID(),
      attemptId,
      name: maskText('test', []),
      place: 'api',
      verdict: 'green',
      detail: maskText('it exited 0', []),
      outputTail: maskText('test: all passing', []),
      runId: null,
      at,
      line: maskText('pnpm test', []),
      exitCode: 0,
      value: null,
      trees: JSON.stringify(trees),
      evidenceId: null,
    })
  }).pipe(Effect.orDie)
