/**
 * The Probes of Planning (#89), on the engine as it starts, with the fake agent of #32 scripting
 * the Planner's and the Probes' tool calls (never a real agent), a temporary data folder, and real
 * Git repositories: the Project Acme's `api`, with a bare repository on the same disk as its
 * remote.
 *
 * Every wait is on state (`until`, a file a test creates, a held turn), never on time. The one
 * bound the suite shortens is the stuck bound of #40, from 5 minutes to 400 ms: the engine's
 * fibers run on the real clock, so a `TestClock` given to the test does not reach them (see #85).
 *
 * Rewritten from `hemera-legacy` (`apps/desktop/tests/git.test.ts`, "A worktree is added, found
 * and removed with the machine's git"; `apps/desktop/tests/preparation.test.ts`, "Resuming
 * re-checks before retrying") against the Probe's detached worktree, its forced wipe, and its
 * preparation resumed after a restart.
 */

import { execFileSync } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_BASE_BRANCH, LIVE_RUN_STATES, type ProbeReport } from '@hemera/core/domain'
import type { CommandDraft, ResourceDraft } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import {
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
  Result,
  type Schema,
  Stream,
} from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeAgent, FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import { projectLimits, setProjectLimits } from '../src/engine/budget.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { createMission, getMission, moveMission } from '../src/engine/missions.ts'
import { Judge } from '../src/engine/permissions/ports.ts'
import { type CleanedProbe, ProbeCleanup, ProbeDesk } from '../src/engine/planning/probe-desk.ts'
import {
  listProbes,
  probeChanges,
  probeRowsOf,
  readProbe,
} from '../src/engine/planning/probe-store.ts'
import { createProject, getProject } from '../src/engine/projects.ts'
import { saveRecipe } from '../src/engine/recipe.ts'
import { saveResources } from '../src/engine/resources/declarations.ts'
import { ExclusiveResources } from '../src/engine/resources/reservations.ts'
import { Runs } from '../src/engine/runs.ts'
import { Cap } from '../src/engine/sessions/cap.ts'
import { listWorkspaces } from '../src/engine/workspaces.ts'
import { REPORTED_TURN_BOUND, RESTORED_PROBES, readFound } from '../src/engine/planning/probes.ts'
import { THROUGH_A_LINK } from '../src/engine/tools/judged.ts'
import { Git } from '../src/engine/git.ts'
import { Withholding } from '../src/engine/tools/withholding.ts'
import { openSession, sessionsIn, sessionsOfLineage } from '../src/engine/sessions/store.ts'
import { threadOf } from '../src/engine/sessions/thread.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  agentSessions,
  domainEvents,
  memoryJournal,
  missionSpent,
  missions,
  probeContents,
  probes,
  sessionDeliveries,
  workspaces,
} from '../src/engine/storage/schema.ts'
import { ToolAccess } from '../src/engine/tools/access.ts'
import { PermissionRequests, SensitivePlaces } from '../src/engine/tools/ports.ts'
import { STAYS_UP, nodeLine, script } from './commands-engine.ts'
import { commitOnRemote, git, remote, repository } from './repositories.ts'
import {
  SILENCE,
  type World,
  held,
  heldSweeps,
  sessionsEngine,
  text,
  until,
  within,
} from './sessions-world.ts'
import { observedProcesses } from './observed-processes.ts'
import { LARGE_TEXT, largeJson, watchedSecrets } from './paced-masking.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { callTool } from './tools-world.ts'

let data: string
let work: string
/** Waits until the file its argument names exists, then ends: a step a test holds. */
let waitsFor: string
/** Writes `prepared.txt` where it runs: a recipe step that leaves its mark. */
let marks: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('probes'))
  work = realpathSync.native(temporaryFolder('probes-work'))
  waitsFor = script(`
import { existsSync } from 'node:fs'
const timer = setInterval(() => { if (existsSync(process.argv[2])) clearInterval(timer) }, 20)
`)
  marks = script(`
import { writeFileSync } from 'node:fs'
writeFileSync('prepared.txt', 'ok')
`)
})
afterEach(removeFolders)

const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

const says = (words: string): FakeStep => ({ does: 'says', text: words })

const QUIET: FakeScript = { steps: [says('Nothing to do.')] }

const allows = Layer.succeed(Judge, {
  judge: () => Effect.succeed({ verdict: 'allow', reason: 'risk 0.1' }),
})

/** What the gate asked the user, refused at once: no approval is ever given in this suite. */
const asked: Array<{ readonly reason: string }> = []
const refusesAsking = Layer.succeed(PermissionRequests, {
  request: ({ reason }) =>
    Effect.sync(() => {
      asked.push({ reason })
      return { answer: 'refused: nobody approves in this suite' }
    }),
})

/** The engine, its agents scripted in their start order; the judge allows, nothing is approved. */
const probing = (
  scriptOf: (index: number) => FakeScript,
  options: Parameters<typeof sessionsEngine>[2] = {},
) => {
  asked.splice(0)
  const engine = sessionsEngine(data, scriptOf, {
    ...options,
    tools: { home: work, judge: allows, permissionRequests: refusesAsking, ...options.tools },
  })
  return {
    world: engine.world,
    run: <A, E>(program: Parameters<typeof engine.run<A, E>>[0]) =>
      engine.run((started) =>
        program(started).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (process.env['PROBES_DEBUG'] !== undefined)
                console.log(
                  started.lines.filter((line) => /probe|session|prepar/i.test(line)).join('\n'),
                )
            }),
          ),
        ),
      ),
  }
}

const draft = (name: string, line: string): CommandDraft => ({
  name,
  type: 'script',
  line,
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
})

const IMPORTER = 'export const importName = (name: string) => name.normalize("NFD")\n'

/**
 * Acme: its main checkout holding `api` on the default base branch, with its importer, a `.env`
 * that is not committed, and a bare repository as its remote, one commit ahead of what `api`
 * fetched last. The recipe copies the `.env` and runs `steps` after it.
 */
const acme = (
  steps: ReadonlyArray<{ readonly line: string }> = [],
  options: { readonly remoteGone?: boolean } = {},
) =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    const api = repository(join(main, 'api'), DEFAULT_BASE_BRANCH)
    writeFileSync(join(api, 'importer.ts'), IMPORTER)
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'importer')
    const bare = remote(api, join(work, 'remotes', 'api.git'))
    const fetchedBefore = git(api, 'rev-parse', `origin/${DEFAULT_BASE_BRANCH}`)
    const ahead = commitOnRemote(bare, DEFAULT_BASE_BRANCH, work)
    writeFileSync(join(api, '.env'), 'DATABASE_PASSWORD=hunter2-acme\n')
    if (options.remoteGone === true) git(api, 'remote', 'set-url', 'origin', join(work, 'nowhere'))
    const created = yield* createProject({
      name: 'Acme',
      mainCheckout: main,
      repositories: ['api'],
    })
    const apiId = created.repositories[0]?.id ?? null
    yield* saveRecipe({
      projectId: created.id,
      version: created.version,
      steps: [
        { kind: 'copy', repositoryId: apiId, path: '.env', commandId: null, line: null },
        ...steps.map((step) => ({
          kind: 'run' as const,
          repositoryId: apiId,
          path: null,
          commandId: null,
          line: step.line,
        })),
      ],
    })
    const project = yield* getProject(created.id)
    return { project, main, api, ahead, fetchedBefore }
  })

/** A mission of Acme in Planning, and a Planner session's grant on it, its token minted. */
const planningMission = (projectId: string, main: string, sentence = 'Import names as written') =>
  Effect.gen(function* () {
    const mission = yield* createMission({ projectId, idea: { sentence, ticket: null } })
    const grant = yield* plannerGrant(mission.id, main)
    return { mission, ...grant }
  })

/** A Planner session of a mission, its token minted: what its agent would be handed. */
const plannerGrant = (missionId: string, main: string) =>
  Effect.gen(function* () {
    const session = yield* openSession({
      provider: 'claude',
      owner: { kind: 'mission', missionId },
      role: 'planner',
      folder: main,
      parent: null,
      chosen: { model: null, effort: null, mode: null },
      modelLevel: null,
    })
    const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session.id))
    const grant = yield* ToolAccess.use((access) => access.byToken(token))
    if (grant === null) return yield* Effect.die(new Error('the token named no grant'))
    return { planner: session, grantId: grant.id }
  })

const launch = (grantId: string, question: string, more: Record<string, string> = {}) =>
  callTool(grantId, 'probe_launch', {
    question,
    brief: 'Look at api/importer.ts; start from a CSV with the name "Éloïse".',
    ...more,
  })

const rowsOf = (missionId: string) => probeRowsOf(missionId)

/** Waits until the mission's Probe numbered so is in one of the states, and answers its row. */
const probeIn = (missionId: string, number: number, states: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* until(
      Effect.map(rowsOf(missionId), (rows) =>
        rows.some((row) => row.number === number && states.includes(row.state)),
      ),
    )
    const row = (yield* rowsOf(missionId)).find((one) => one.number === number)
    if (row === undefined) return yield* Effect.die(new Error('no such Probe'))
    return row
  })

const eventsOf = (missionId: string, type: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.entityId, missionId), eq(domainEvents.type, type)))
  })

const journalOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select({ text: memoryJournal.text })
      .from(memoryJournal)
      .where(eq(memoryJournal.missionId, missionId))
    return rows.map((row) => row.text)
  })

const journalHas = (missionId: string, start: string) =>
  until(Effect.map(journalOf(missionId), (lines) => lines.some((line) => line.startsWith(start))))

const REPORT: ProbeReport = {
  outcome: 'reproduced',
  answer: 'The importer drops the accents of a name.',
  actions: ['Write api/tests/import-accents.test.ts', 'Run node api/tests/import-accents.test.ts'],
  starting_data: 'tests/fixtures/names.csv',
  command: 'node tests/import-accents.test.ts',
  expected: 'The name reads "Éloïse".',
  observed: 'Expected "Éloïse", received "Eloise"',
  key_line: 'Expected "Éloïse", received "Eloise"',
  test: { repository: 'api', path: 'tests/import-accents.test.ts', code: 'assert(…)' },
  base_commit: 'abc1234',
  neighbours: [],
  evidence: [],
}

/** A report as the tool takes it. */
const reported = (report: Partial<ProbeReport> = {}): Schema.JsonObject => ({
  ...REPORT,
  ...report,
})

const { observed: _observed, ...WITHOUT_OUTPUT } = REPORT

const answersOf = (agent: FakeAgent | undefined) =>
  agent?.answers.toolAnswers.map((one) => one.text) ?? []

/** Every content the Probes' captures kept, as stored. */
const keptContents = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database.select({ content: probeContents.content }).from(probeContents)
  return rows.map((row) => row.content)
})

/**
 * Rewrites a worktree's `.git` file to say `said`. It is removed first: Git for Windows makes it a
 * hidden file (`core.hideDotFiles`), and Windows refuses to write over a hidden file in place
 * (EPERM), where a new one is written on every system.
 */
const pointGitAt = (tree: string, said: string) => {
  rmSync(join(tree, '.git'))
  writeFileSync(join(tree, '.git'), said)
}

/** The key of a capture's keyed hashes, in the suite's reads of one file. */
const SUITE_KEY = randomBytes(32)

/** A capture's read of one file, for a Probe whose place holds no sensitive file. */
const found = (path: string) =>
  Effect.runPromise(
    Withholding.of({
      sessionId: 'probe-session',
      role: 'probe',
      projectId: 'acme',
      missionId: null,
      place: { kind: 'workspace', readOnly: false, root: work },
    }).pipe(
      Effect.provideService(SensitivePlaces, { sensitive: () => Effect.succeed(null) }),
      Effect.flatMap((withholding) => readFound(path, 1024, { withholding, key: SUITE_KEY })),
    ),
  )

/** The agents that were Probes, in the order they started: their brief names their question. */
const probeAgentsOf = (world: World) =>
  world.agents.filter((agent) => text(agent.answers.prompts[0] ?? []).includes('Question: '))

describe('probe_launch answers at once; the Probe is prepared in the background', () => {
  test('its worktree is detached at the fetched base under probes/<key>/<n>/, and the recipe ran', async () => {
    const gate = join(work, 'recipe-may-go')
    const hold = held()
    const { world, run } = probing(() => ({
      steps: [says('Reading.')],
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, ahead } = yield* acme([
            { line: nodeLine(waitsFor, gate) },
            { line: nodeLine(marks) },
          ])
          const { mission, grantId } = yield* planningMission(project.id, main)
          const answer = yield* launch(grantId, 'does the importer keep accents?', {
            scenario: 'R1.S1',
          })
          // Answered while the recipe still waits for the test: the launch did not wait for it.
          const whileHeld = (yield* rowsOf(mission.id))[0]?.state
          writeFileSync(gate, '')
          const row = yield* probeIn(mission.id, 1, ['running'])
          yield* until(Effect.sync(() => world.agents.length === 1))
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          const session = (yield* sessionsOfLineage(row.lineage))[0]
          const detail = yield* readProbe(row.id)
          const { key } = yield* getMission(mission.id)
          const listed = yield* listWorkspaces(project.id)
          return { answer, whileHeld, row, session, detail, ahead, key, mission, listed }
        }),
      ),
    )
    hold.release()
    expect(seen.answer.ok).toBe(true)
    expect(seen.answer.text).toMatch(/^Probe #1 launched/)
    expect(seen.whileHeld).toBe('preparing')
    const folder = join(data, 'probes', seen.key, '1')
    expect(seen.row.folder).toBe(folder)
    const tree = join(folder, 'api')
    expect(git(tree, 'rev-parse', 'HEAD')).toBe(seen.ahead)
    expect(() => git(tree, 'symbolic-ref', '-q', 'HEAD')).toThrow()
    expect(readFileSync(join(tree, 'prepared.txt'), 'utf8')).toBe('ok')
    expect(seen.detail.bases).toEqual([
      expect.objectContaining({ repository: 'api', commit: seen.ahead }),
    ])
    expect(Predicate.isTagged(seen.detail.bases[0]?.freshness, 'FetchedNow')).toBe(true)
    expect(seen.session).toMatchObject({ role: 'probe', folder, depth: 1 })
    // Its Workspace is the Probe's own: never one of the Project's to list.
    expect(seen.listed).toEqual([])
    const brief = text(world.agents[0]?.answers.prompts[0] ?? [])
    expect(brief).toContain('Question: does the importer keep accents?')
    expect(brief).toContain('Look at api/importer.ts')
    expect(brief).toContain(`detached at ${seen.ahead}`)
  })

  test('with the remote unreachable, the last tracking ref is used and "not fetched since" is recorded', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Reading.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, fetchedBefore } = yield* acme([], { remoteGone: true })
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          return { detail: yield* readProbe(row.id), row, fetchedBefore }
        }),
      ),
    )
    hold.release()
    expect(git(join(seen.row.folder, 'api'), 'rev-parse', 'HEAD')).toBe(seen.fetchedBefore)
    expect(Predicate.isTagged(seen.detail.bases[0]?.freshness, 'NotFetchedSince')).toBe(true)
  })

  test('outside Planning it is refused, and nothing is created', async () => {
    const { run } = probing(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* moveMission(mission.id, 'freeze', 'user')
          const answer = yield* launch(grantId, 'does the importer keep accents?')
          return { answer, rows: yield* rowsOf(mission.id) }
        }),
      ),
    )
    expect(seen.answer.ok).toBe(false)
    expect(seen.answer.text).toMatch(/^refused: a Probe is launched only in Planning/)
    expect(seen.rows).toEqual([])
    expect(existsSync(join(data, 'probes'))).toBe(false)
  })
})

describe('The cap and the launch budget (#41)', () => {
  test('a fourth launch while three sub-agents run is refused with the reason; nothing is created', async () => {
    const gate = join(work, 'never')
    const { run } = probing(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme([{ line: nodeLine(waitsFor, gate) }])
          const { mission, grantId } = yield* planningMission(project.id, main)
          for (const question of ['first?', 'second?', 'third?']) {
            yield* launch(grantId, question)
          }
          const fourth = yield* launch(grantId, 'fourth?')
          yield* journalHas(mission.id, 'A launch of a Probe was refused')
          const rows = yield* rowsOf(mission.id)
          writeFileSync(gate, '')
          return { fourth, rows, journal: yield* journalOf(mission.id), mission }
        }),
      ),
    )
    expect(seen.fourth.ok).toBe(false)
    expect(seen.fourth.text).toBe(
      'refused: 3 sub-agents already run in this Project (the cap is 3); do the work yourself or wait',
    )
    expect(seen.rows.map((row) => row.number)).toEqual([1, 2, 3])
    expect(existsSync(join(data, 'probes', 'ACME-1', '4'))).toBe(false)
    expect(seen.journal).toContain(
      'A launch of a Probe was refused: 3 sub-agents already run in this Project (the cap is 3); do the work yourself or wait',
    )
  })

  test('two launches at once for the last slot: one is launched, the other refused', async () => {
    const gate = join(work, 'never')
    const { run } = probing(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme([{ line: nodeLine(waitsFor, gate) }])
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 1, budget: limits.budget })
          const { mission, grantId } = yield* planningMission(project.id, main)
          const answers = yield* Effect.all([launch(grantId, 'left?'), launch(grantId, 'right?')], {
            concurrency: 'unbounded',
          })
          const rows = yield* rowsOf(mission.id)
          writeFileSync(gate, '')
          return { answers, rows }
        }),
      ),
    )
    expect(seen.answers.filter((one) => one.ok)).toHaveLength(1)
    expect(seen.answers.filter((one) => !one.ok)[0]?.text).toMatch(/sub-agents already run/)
    expect(seen.rows).toHaveLength(1)
  })

  test('a launch past the mission’s budget is refused with #41’s words, and frees its slot', async () => {
    const { run } = probing(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, {
            cap: 1,
            budget: { ...limits.budget, launches: 0 },
          })
          const { mission, grantId } = yield* planningMission(project.id, main)
          const first = yield* launch(grantId, 'spent?')
          const database = yield* Database
          const spent = yield* database
            .select()
            .from(missionSpent)
            .where(eq(missionSpent.missionId, mission.id))
          // Its slot went back: with the budget raised, the only slot of the cap is free.
          yield* database
            .update(probes)
            .set({ state: 'failed' })
            .where(eq(probes.missionId, mission.id))
          return { first, spent, rows: yield* rowsOf(mission.id) }
        }),
      ),
    )
    expect(seen.first.text).toBe('refused: the launches of this mission are spent (0 of 0)')
    expect(seen.rows).toEqual([])
    expect(seen.spent).toEqual([])
  })

  /** A launch held once its stage is checked, until the test lets it go on. */
  const heldAfterCheck = () => {
    const checked = held()
    const state = { reached: false }
    const hold = (at: string) =>
      at === 'checked'
        ? Effect.promise(() => {
            state.reached = true
            return checked.promise
          })
        : Effect.void
    return { state, release: checked.release, hold }
  }

  /** Whether the only slot of a Project whose cap is 1 is free: taken, then given back. */
  const slotFree = (projectId: string) =>
    Cap.use((cap) =>
      Effect.gen(function* () {
        const slot = yield* cap.acquire({
          projectId,
          lineage: 'checking-the-slot',
          missionId: null,
          requestedBy: 'agent',
        })
        yield* cap.release('checking-the-slot')
        return slot.held
      }),
    )

  test('a launch whose mission left Planning meanwhile spends no budget and frees its slot', async () => {
    const launchHeld = heldAfterCheck()
    const { run } = probing(() => QUIET, { probes: { hold: launchHeld.hold } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { ...limits, cap: 1 })
          const { mission, grantId } = yield* planningMission(project.id, main)
          const launching = yield* Effect.forkChild(launch(grantId, 'too late?'))
          yield* until(Effect.sync(() => launchHeld.state.reached))
          yield* moveMission(mission.id, 'cancel', 'user')
          launchHeld.release()
          const answer = yield* Fiber.join(launching)
          const database = yield* Database
          const spent = yield* database
            .select()
            .from(missionSpent)
            .where(eq(missionSpent.missionId, mission.id))
          return { answer, spent, free: yield* slotFree(project.id) }
        }),
      ),
    )
    expect(seen.answer.text).toMatch(/^refused: ACME-1 left Planning meanwhile/)
    expect(seen.spent).toEqual([])
    expect(seen.free).toBe(true)
  })

  test('a launch that fails once its slot is taken gives the slot back', async () => {
    const launchHeld = heldAfterCheck()
    const { run } = probing(() => QUIET, { probes: { hold: launchHeld.hold } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { ...limits, cap: 1 })
          const { mission, grantId, planner } = yield* planningMission(project.id, main)
          const launching = yield* Effect.forkChild(launch(grantId, 'and its Planner?'))
          yield* until(Effect.sync(() => launchHeld.state.reached))
          // Its Planner's session is gone: the launch can no longer name the Probe's parent.
          const database = yield* Database
          yield* database.delete(agentSessions).where(eq(agentSessions.id, planner.id))
          launchHeld.release()
          const answer = yield* Fiber.join(launching)
          return { answer, rows: yield* rowsOf(mission.id), free: yield* slotFree(project.id) }
        }),
      ),
    )
    expect(seen.answer.ok).toBe(false)
    expect(seen.rows).toEqual([])
    expect(seen.free).toBe(true)
  })
})

describe('The Probe’s place (#36)', () => {
  test('a write outside its folder, and a read of another Probe’s folder, are refused by the gate', async () => {
    const hold = held()
    const { world, run } = probing((index) =>
      index === 0
        ? { steps: [says('Waiting.')], between: () => hold.promise }
        : {
            turns: [
              [
                uses('toolu_outside', 'fs_write', {
                  path: join(work, 'acme', 'api', 'importer.ts'),
                  content: 'changed\n',
                }),
                uses('toolu_other', 'fs_read', {
                  path: join(data, 'probes', 'ACME-1', '1', 'api', 'importer.ts'),
                }),
                uses('toolu_own', 'fs_read', { repository: 'api', path: 'importer.ts' }),
              ],
            ],
            steps: [says('Waiting.')],
            between: () => hold.promise,
          },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'first?')
          yield* probeIn(mission.id, 1, ['running'])
          yield* launch(grantId, 'second?')
          yield* probeIn(mission.id, 2, ['running'])
          hold.release()
          yield* until(Effect.sync(() => (world.agents[1]?.answers.toolAnswers.length ?? 0) === 3))
          return { key: (yield* getMission(mission.id)).key }
        }),
      ),
    )
    expect(seen.key).toBe('ACME-1')
    const [outside, other, own] = answersOf(world.agents[1])
    expect(outside).toMatch(/^refused/)
    expect(other).toMatch(/^refused/)
    expect(own).toContain('normalize')
    expect(readFileSync(join(work, 'acme', 'api', 'importer.ts'), 'utf8')).toBe(IMPORTER)
    expect(asked.map((one) => one.reason)).toEqual([
      expect.stringMatching(/outside/),
      expect.stringMatching(/sensitive place: .*probes/),
    ])
  })
})

describe('A Probe never shapes the engine’s Git through a Git folder (#448)', () => {
  /**
   * The command a Git configuration names, as Git runs it through its shell: a Node script that
   * writes `marker` when it runs. Forward slashes, so Git for Windows' shell reads it too.
   */
  const marking = (marker: string) => {
    const path = script(
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'ran')\n`,
    )
    return [process.execPath, path].map((word) => `"${word.replaceAll('\\', '/')}"`).join(' ')
  }

  /** Where the first Probe of Acme's first mission has its worktree of `api`, and `api` itself. */
  const places = () => ({
    tree: join(data, 'probes', 'ACME-1', '1', 'api'),
    api: join(work, 'acme', 'api'),
  })

  /**
   * A Probe of Acme, its recipe running `steps`, whose agent makes the writes `calls` names through
   * the gate, then `prepare` and the engine's next Git calls on its worktree and on `api`. Then
   * `control` writes as anything but the Probe's tools could, and the engine's Git runs on the
   * worktree again, then the machine's git alone. Answers what the gate said to each write and
   * run, the worktree's `.git`, and whether `marker` was written before the control, after the
   * engine's Git, and after the machine's git alone.
   */
  const probeWrites = (
    marker: string,
    calls: ReadonlyArray<Schema.JsonObject>,
    options: {
      /** The files the Probe reads first, as a write over an existing file requires. */
      readonly reads?: ReadonlyArray<Schema.JsonObject>
      readonly prepare?: (tree: string) => void
      readonly control?: (tree: string) => void
      readonly steps?: ReadonlyArray<{ readonly line: string }>
      /** The command lines the Probe runs after its writes. */
      readonly runs?: ReadonlyArray<Schema.JsonObject>
    } = {},
  ) => {
    const { reads = [], prepare = () => {}, control = () => {}, steps = [], runs = [] } = options
    const made = reads.length + calls.length + runs.length
    const hold = held()
    // The Planner's grant is the suite's own: the first agent started is the Probe.
    let taken = 0
    const { world, run } = probing(() => ({
      turns: [
        [
          ...reads.map((args, at) => uses(`toolu_read_${String(at)}`, 'fs_read', args)),
          ...calls.map((args, at) => uses(`toolu_git_${String(at)}`, 'fs_write', args)),
          ...runs.map((args, at) => uses(`toolu_run_${String(at)}`, 'commands_run', args)),
        ],
      ],
      steps: [says('Waiting.')],
      // Its writes go at once; what follows them waits for the test.
      between: () => {
        taken += 1
        return taken > made ? hold.promise : Promise.resolve()
      },
    }))
    return run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme(steps)
          const { tree, api } = places()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          yield* probeIn(mission.id, 1, ['running'])
          yield* until(
            Effect.sync(() => (world.agents[0]?.answers.toolAnswers.length ?? 0) === made),
          )
          prepare(tree)
          const engineStatus = (folder: string) =>
            Git.use((engineGit) => engineGit.status(folder)).pipe(Effect.ignore)
          yield* engineStatus(tree)
          yield* engineStatus(api)
          const before = existsSync(marker)
          const gitFile = readFileSync(join(tree, '.git'), 'utf8')
          control(tree)
          yield* engineStatus(tree)
          const afterEngine = existsSync(marker)
          // The same status run by the machine's git alone, as an agent's own command would.
          execFileSync('git', ['-C', tree, 'status', '--porcelain'], { stdio: 'ignore' })
          hold.release()
          const answers = answersOf(world.agents[0]).slice(reads.length)
          return { answers, gitFile, before, afterEngine, afterPlain: existsSync(marker) }
        }),
      ),
    )
  }

  test('a Probe that points its worktree’s .git at a Git folder of its own, with a core.fsmonitor, gets no command run by the engine’s next Git call', async () => {
    const marker = join(work, 'fsmonitor-ran')
    const seen = await probeWrites(
      marker,
      [{ repository: 'api', path: '.git', content: 'gitdir: shadow\n' }],
      {
        reads: [{ repository: 'api', path: '.git' }],
        prepare: (tree) => {
          // What the Probe may write in its own folder: a Git folder that is not named `.git`.
          const shadow = join(tree, 'shadow')
          git(tree, 'init', '-q', '--bare', shadow)
          git(tree, '--git-dir', shadow, 'config', 'core.bare', 'false')
          git(tree, '--git-dir', shadow, 'config', 'core.fsmonitor', marking(marker))
        },
        // The same .git written by anything but the Probe's tools: the engine's Git still runs
        // no core.fsmonitor; the machine's git alone does.
        control: (tree) => pointGitAt(tree, 'gitdir: shadow\n'),
      },
    )
    expect(seen.answers).toEqual([expect.stringMatching(/^refused/)])
    // The path as written is read from the Probe's folder, as it leads from its repository.
    expect(asked.map((one) => one.reason)).toEqual([
      expect.stringMatching(/sensitive place: .*[\\/]ACME-1[\\/]1[\\/](?:api[\\/])?\.git$/),
    ])
    expect(seen.gitFile).toMatch(/^gitdir: .*worktrees/)
    expect(seen.before).toBe(false)
    expect(seen.afterEngine).toBe(false)
    expect(seen.afterPlain).toBe(true)
  })

  test('a Probe that writes a core.fsmonitor or a filter into the repository’s Git folder, or its worktree’s, is asked as a sensitive place, never written', async () => {
    const marker = join(work, 'git-folder-ran')
    const { api } = places()
    const config = `[core]\n\tfsmonitor = ${marking(marker)}\n[filter "x"]\n\tclean = ${marking(marker)}\n`
    const seen = await probeWrites(
      marker,
      [
        { path: join(api, '.git', 'config'), content: config },
        { path: join(api, '.git', 'info', 'attributes'), content: '* filter=x\n' },
        { path: join(api, '.git', 'hooks', 'post-checkout'), content: '#!/bin/sh\n' },
        { path: join(api, '.git', 'worktrees', 'api', 'config.worktree'), content: config },
      ],
      {
        // The last one is the worktree's own administrative folder.
        prepare: (tree) =>
          expect(
            realpathSync.native(git(tree, 'rev-parse', '--path-format=absolute', '--git-dir')),
          ).toBe(realpathSync.native(join(api, '.git', 'worktrees', 'api'))),
      },
    )
    expect(seen.answers).toEqual(Array.from({ length: 4 }, () => expect.stringMatching(/^refused/)))
    for (const reason of asked.map((one) => one.reason)) {
      expect(reason).toMatch(/sensitive place: .*[\\/]api[\\/]\.git/)
    }
    expect(readFileSync(join(api, '.git', 'config'), 'utf8')).not.toContain('fsmonitor')
    expect(existsSync(join(api, '.git', 'info', 'attributes'))).toBe(false)
    expect(existsSync(join(api, '.git', 'worktrees', 'api', 'config.worktree'))).toBe(false)
    expect(seen.before).toBe(false)
  })

  test('a Probe whose command runs git config to set a core.fsmonitor is asked as the repository’s configuration, never written, whatever the judge says', async () => {
    const { api } = places()
    const marker = join(work, 'never-written')
    const seen = await probeWrites(marker, [], {
      runs: [
        { line: 'git config core.fsmonitor ./tools/watch.sh', repository: 'api' },
        { line: 'git config --worktree core.fsmonitor ./tools/watch.sh', repository: 'api' },
      ],
    })
    expect(seen.answers).toEqual([
      expect.stringMatching(/^refused/),
      expect.stringMatching(/^refused/),
    ])
    expect(asked.map((one) => one.reason)).toEqual([
      expect.stringMatching(/^sensitive place: .*[\\/]api[\\/]\.git[\\/]config$/),
      expect.stringMatching(/^sensitive place: .*[\\/]api[\\/]\.git[\\/]config$/),
    ])
    expect(readFileSync(join(api, '.git', 'config'), 'utf8')).not.toContain('fsmonitor')
    expect(existsSync(join(api, '.git', 'worktrees', 'api', 'config.worktree'))).toBe(false)
  })

  test('a .git spelled in another case, or reached through a link, is the same sensitive place', async () => {
    const seen = await probeWrites(
      join(work, 'never-written'),
      [
        { repository: 'api', path: '.GIT', content: 'gitdir: shadow\n' },
        { repository: 'api', path: 'gitlink', content: 'gitdir: shadow\n' },
      ],
      {
        reads: [{ repository: 'api', path: 'gitlink' }],
        // The recipe leaves a link to the worktree's .git, as a command of the Probe's could.
        steps: [
          {
            line: nodeLine(
              script(
                `import { symlinkSync } from 'node:fs'\nsymlinkSync('.git', 'gitlink', 'file')\n`,
              ),
            ),
          },
        ],
      },
    )
    expect(seen.answers).toEqual([
      expect.stringMatching(/^refused/),
      expect.stringMatching(/^refused/),
    ])
    expect(asked.map((one) => one.reason)).toEqual([
      expect.stringMatching(/sensitive place: .*[\\/]1[\\/](?:api[\\/])?\.GIT$/),
      expect.stringMatching(/sensitive place: .*[\\/]api[\\/]\.git$/),
    ])
    expect(seen.gitFile).toMatch(/^gitdir: .*worktrees/)
  })
})

/**
 * A Planner that launches one Probe, and a Probe that reports, then keeps its turn going until
 * `hold` is released.
 */
const workingOn =
  (hold: { readonly promise: Promise<void> }) =>
  (index: number): FakeScript => {
    let steps = 0
    return index === 0
      ? {
          turns: [
            [
              uses('toolu_launch', 'probe_launch', {
                question: 'does the importer keep accents?',
                brief: 'Look at api/importer.ts.',
              }),
            ],
          ],
          steps: [says('Noted.')],
        }
      : {
          turns: [[uses('toolu_report', 'probe_report', reported()), says('Done.')]],
          between: () => {
            steps += 1
            return steps === 2 ? hold.promise : Promise.resolve()
          },
        }
  }

describe('probe_report ends the Probe', () => {
  test('its session ends once its last turn is over: the agent hears its report kept, and nothing cancels it', async () => {
    const hold = held()
    const { world, run } = probing(workingOn(hold), { sessions: { plannerStarts: true } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Import names as written', ticket: null },
          })
          const row = yield* probeIn(mission.id, 1, ['done'])
          // Whatever follows the report has had its moment; the turn is still the agent's.
          yield* until(Effect.sync(() => answersOf(world.agents[1]).length === 1))
          hold.release()
          yield* until(
            Effect.map(sessionsOfLineage(row.lineage), (rows) =>
              rows.every((one) => one.state === 'ended'),
            ),
          )
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) >= 2))
          return { row }
        }),
      ),
    )
    expect(answersOf(world.agents[1])[0]).toMatch(/^Kept: Probe #1 ended/)
    expect(world.agents[1]?.answers.cancels).toBe(0)
    expect(seen.row.number).toBe(1)
  })

  test('a Probe that keeps working after its report: its Planner hears it at once', async () => {
    const hold = held()
    const { world, run } = probing(workingOn(hold), { sessions: { plannerStarts: true } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Import names as written', ticket: null },
          })
          const row = yield* probeIn(mission.id, 1, ['done'])
          // The Probe's turn is still held: the Planner's next turn carries the report all the same.
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) >= 2))
          const live = yield* sessionsOfLineage(row.lineage)
          hold.release()
          yield* until(
            Effect.map(sessionsOfLineage(row.lineage), (rows) =>
              rows.every((one) => one.state === 'ended'),
            ),
          )
          return { live }
        }),
      ),
    )
    expect(text(world.agents[0]?.answers.prompts[1] ?? [])).toContain('[hemera:probe]')
    expect(seen.live.some((one) => one.state !== 'ended')).toBe(true)
    expect(world.agents[1]?.answers.cancels).toBe(0)
  })

  test('a Probe whose turn never settles after its report is ended past the bound', async () => {
    const hold = held()
    // The engine on a test clock: the bound passes when the test says; its sweeps every minute.
    const { world, run } = probing(workingOn(hold), {
      sessions: { plannerStarts: true },
      testClock: true,
      timings: { sweepEvery: Duration.minutes(1), notePickup: Duration.minutes(1) },
    })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { row, live } = yield* TestClock.withLive(
            Effect.gen(function* () {
              const { project } = yield* acme()
              const mission = yield* createMission({
                projectId: project.id,
                idea: { sentence: 'Import names as written', ticket: null },
              })
              const done = yield* probeIn(mission.id, 1, ['done'])
              yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) >= 2))
              return { row: done, live: yield* sessionsOfLineage(done.lineage) }
            }),
          )
          yield* TestClock.adjust(REPORTED_TURN_BOUND)
          yield* TestClock.withLive(
            until(
              Effect.map(sessionsOfLineage(row.lineage), (rows) =>
                rows.every((one) => one.state === 'ended'),
              ),
            ),
          )
          hold.release()
          return { live, ended: yield* sessionsOfLineage(row.lineage) }
        }),
      ),
    )
    expect(seen.live.some((one) => one.state !== 'ended')).toBe(true)
    expect(seen.ended.map((one) => one.stateReason)).toContain('it reported')
    // Ended under its turn: the agent heard the cancel.
    expect(world.agents[1]?.answers.cancels).toBe(1)
  })

  test('reproduced without observed is refused; a valid one is stored, the worktree captured, and delivered to the Planner', async () => {
    const { world, run } = probing(
      (index) =>
        index === 0
          ? {
              turns: [
                [
                  uses('toolu_launch', 'probe_launch', {
                    question: 'does the importer keep accents?',
                    brief: 'Look at api/importer.ts.',
                  }),
                ],
              ],
              steps: [says('Noted.')],
            }
          : {
              turns: [
                [
                  uses('toolu_read', 'fs_read', { repository: 'api', path: 'importer.ts' }),
                  uses('toolu_edit', 'fs_write', {
                    repository: 'api',
                    path: 'importer.ts',
                    content: `${IMPORTER}// probed\n`,
                  }),
                  uses('toolu_fixture', 'fs_write', {
                    repository: 'api',
                    path: 'tests/fixtures/names.csv',
                    content: 'name\nÉloïse\n',
                  }),
                  uses('toolu_no_output', 'probe_report', { ...WITHOUT_OUTPUT }),
                  uses(
                    'toolu_escapes',
                    'probe_report',
                    reported({ test: { repository: 'api', path: '../../escape.ts', code: 'x' } }),
                  ),
                  uses('toolu_report', 'probe_report', reported()),
                ],
              ],
              steps: [says('Done.')],
            },
      { sessions: { plannerStarts: true } },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Import names as written', ticket: null },
          })
          const row = yield* probeIn(mission.id, 1, ['done'])
          // The Planner's next turn carries the report.
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) >= 2))
          yield* until(
            Effect.map(sessionsOfLineage(row.lineage), (rows) =>
              rows.every((one) => one.state === 'ended'),
            ),
          )
          return {
            detail: yield* readProbe(row.id),
            row,
            journal: yield* journalOf(mission.id),
          }
        }),
      ),
    )
    const [, , , noOutput, escapes, kept] = answersOf(world.agents[1])
    expect(noOutput).toBe(
      'refused: a reproduced behaviour needs the observed output of a real run, quoted verbatim in `observed`',
    )
    expect(escapes).toMatch(/^refused: the test must be inside your worktree/)
    expect(kept).toMatch(/^Kept: Probe #1 ended/)
    expect(seen.detail).toMatchObject({
      state: 'done',
      outcome: 'reproduced',
      answer: 'The importer drops the accents of a name.',
      report: expect.objectContaining({ observed: 'Expected "Éloïse", received "Eloise"' }),
    })
    const files = new Map(seen.detail.files.map((file) => [file.path, file]))
    // The `.env` the preparation copied is the preparation's, not the Probe's.
    expect([...files.keys()].toSorted()).toEqual(['importer.ts', 'tests/fixtures/names.csv'])
    expect(files.get('tests/fixtures/names.csv')).toMatchObject({
      repository: 'api',
      status: 'new',
      content: 'name\nÉloïse\n',
      withheld: null,
    })
    expect(files.get('importer.ts')).toMatchObject({ status: 'modified' })
    expect(files.get('importer.ts')?.patch).toContain('+// probed')
    const delivered = text(world.agents[0]?.answers.prompts[1] ?? [])
    expect(delivered).toContain('[hemera:probe]')
    expect(delivered).toContain('Probe #1: does the importer keep accents?')
    expect(delivered).toContain('Outcome: reproduced')
    // The worktree stays until the mission leaves Planning.
    expect(existsSync(join(seen.row.folder, 'api', 'tests', 'fixtures', 'names.csv'))).toBe(true)
    expect(seen.journal).toContain(
      'Probe #1 ended, reproduced: The importer drops the accents of a name.',
    )
  })

  test('an agent that ends its turn without probe_report is told once; a second silent end fails the Probe', async () => {
    const { world, run } = probing(() => ({ steps: [says('I looked around.')] }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['failed'])
          return { row, failed: yield* eventsOf(mission.id, 'probe.failed') }
        }),
      ),
    )
    expect(seen.row.failure).toBe('ended without a report')
    expect(seen.failed).toHaveLength(1)
    const prompts = world.agents[0]?.answers.prompts ?? []
    expect(prompts).toHaveLength(2)
    expect(text(prompts[1] ?? [])).toContain('End with probe_report')
  })

  test('the same Probe reporting twice at once: one report is kept, the other refused', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Waiting.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          const [session] = yield* sessionsOfLineage(row.lineage)
          if (session === undefined) return yield* Effect.die(new Error('no session'))
          const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session.id))
          const probeGrant = yield* ToolAccess.use((access) => access.byToken(token))
          const answers = yield* Effect.all(
            [
              callTool(probeGrant?.id ?? '', 'probe_report', reported()),
              callTool(probeGrant?.id ?? '', 'probe_report', reported({ answer: 'Another.' })),
            ],
            { concurrency: 'unbounded' },
          )
          hold.release()
          return { answers, ended: yield* eventsOf(mission.id, 'probe.ended') }
        }),
      ),
    )
    expect(seen.answers.filter((one) => one.ok)).toHaveLength(1)
    expect(seen.answers.filter((one) => !one.ok)[0]?.text).toMatch(
      /^refused: Probe #1 already ended/,
    )
    expect(seen.ended).toHaveLength(1)
  })

  test('a link the Probe left is kept as where it leads, never followed out of its worktree', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Waiting.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const secret = join(work, 'outside.txt')
          writeFileSync(secret, 'not the Probe’s to keep\n')
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          symlinkSync(secret, join(row.folder, 'api', 'notes.txt'))
          const [session] = yield* sessionsOfLineage(row.lineage)
          const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session?.id ?? ''))
          const probeGrant = yield* ToolAccess.use((access) => access.byToken(token))
          yield* callTool(probeGrant?.id ?? '', 'probe_report', reported())
          hold.release()
          return { detail: yield* readProbe(row.id), api }
        }),
      ),
    )
    const linked = seen.detail.files.find((file) => file.path === 'notes.txt')
    expect(linked).toMatchObject({
      status: 'new',
      content: null,
      withheld: 'content withheld: a link',
    })
    expect(JSON.stringify(seen.detail)).not.toContain('not the Probe’s to keep')
  })

  /** Reports for the Probe of a mission once it runs, after `leave` wrote in its worktree. */
  const reportedAfter = (
    steps: ReadonlyArray<{ readonly line: string }>,
    leave: (tree: string) => void,
    options: Parameters<typeof sessionsEngine>[2] = {},
  ) => {
    const hold = held()
    const { run } = probing(
      () => ({ steps: [says('Waiting.')], between: () => hold.promise }),
      options,
    )
    return run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme(steps)
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          leave(join(row.folder, 'api'))
          const [session] = yield* sessionsOfLineage(row.lineage)
          const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session?.id ?? ''))
          const probeGrant = yield* ToolAccess.use((access) => access.byToken(token))
          const answer = yield* callTool(probeGrant?.id ?? '', 'probe_report', reported())
          hold.release()
          return { answer, detail: yield* readProbe(row.id), kept: yield* keptContents }
        }),
      ),
    )
  }

  test('a probe file hard-linked to a file outside the worktree is not saved, and the probe names it', async () => {
    const secret = join(work, 'outside.txt')
    writeFileSync(secret, 'not the Probe’s to keep\n')
    const seen = await reportedAfter([], (tree) => linkSync(secret, join(tree, 'notes.txt')))
    expect(seen.answer.text).toMatch(/^Kept: Probe #1 ended/)
    expect(seen.detail.files.find((file) => file.path === 'notes.txt')).toMatchObject({
      status: 'new',
      content: null,
      withheld:
        'content withheld: it has more than one name on the disk (a hard link), and its other name may be a file outside the Workspace: it is never kept in a Probe’s capture',
    })
    expect(JSON.stringify(seen.detail)).not.toContain('not the Probe’s to keep')
    expect(seen.kept.join('\n')).not.toContain('not the Probe’s to keep')
  })

  test('a second name of a sensitive file of the worktree is withheld as that sensitive place', async () => {
    const seen = await reportedAfter([], (tree) =>
      linkSync(join(tree, '.env'), join(tree, 'notes.txt')),
    )
    expect(seen.detail.files.find((file) => file.path === 'notes.txt')).toMatchObject({
      status: 'new',
      content: null,
      withheld: expect.stringMatching(
        /^content withheld: sensitive place: .+, through a hard link$/,
      ),
    })
    expect(JSON.stringify(seen.detail)).not.toContain('hunter2-acme')
    expect(seen.kept.join('\n')).not.toContain('hunter2-acme')
  })

  test('ordinary files are still captured when the data folder is reached through a link', async () => {
    const linked = join(work, 'data-link')
    symlinkSync(data, linked, process.platform === 'win32' ? 'junction' : 'dir')
    data = linked
    const seen = await reportedAfter([], (tree) => {
      writeFileSync(join(tree, 'fixture.csv'), 'name\nÉloïse\n')
    })
    expect(seen.detail.files.find((file) => file.path === 'fixture.csv')).toMatchObject({
      status: 'new',
      content: 'name\nÉloïse\n',
      withheld: null,
    })
  })

  test('ordinary files are still captured', async () => {
    const seen = await reportedAfter([], (tree) => {
      mkdirSync(join(tree, 'tests', 'fixtures'), { recursive: true })
      writeFileSync(join(tree, 'tests', 'fixtures', 'names.csv'), 'name\nÉloïse\n')
      writeFileSync(join(tree, 'importer.ts'), `${IMPORTER}// probed\n`)
    })
    const files = new Map(seen.detail.files.map((file) => [file.path, file]))
    expect([...files.keys()].toSorted()).toEqual(['importer.ts', 'tests/fixtures/names.csv'])
    expect(files.get('tests/fixtures/names.csv')).toMatchObject({
      status: 'new',
      content: 'name\nÉloïse\n',
      withheld: null,
    })
    expect(files.get('importer.ts')).toMatchObject({
      status: 'modified',
      content: `${IMPORTER}// probed\n`,
      withheld: null,
    })
    expect(files.get('importer.ts')?.patch).toContain('+// probed')
  })

  test('what the preparation wrote is not captured; what the Probe changed of it is', async () => {
    const seen = await reportedAfter([{ line: nodeLine(marks) }], (tree) => {
      writeFileSync(join(tree, 'fixture.csv'), 'name\nÉloïse\n')
      // The recipe copied the `.env` and wrote `prepared.txt`: the Probe changes only the `.env`.
      writeFileSync(join(tree, '.env'), 'DATABASE_PASSWORD=changed-by-the-probe\n')
    })
    const files = new Map(seen.detail.files.map((file) => [file.path, file]))
    expect([...files.keys()].toSorted()).toEqual(['.env', 'fixture.csv'])
    expect(files.get('.env')).toMatchObject({
      status: 'new',
      content: null,
      withheld: 'content withheld: a sensitive place',
    })
    expect(files.get('.env')?.sha256).toMatch(/^keyed:[0-9a-f]{64}$/)
  })

  test('a sensitive file the Probe rewrote to the same size and times is still told changed', async () => {
    // The preparation leaves the `.env` at a whole second, a time Node sets back exactly.
    const settles = script(`
import { utimesSync } from 'node:fs'
utimesSync('.env', 1000000000, 1000000000)
`)
    const seen = await reportedAfter([{ line: nodeLine(settles) }], (tree) => {
      const env = join(tree, '.env')
      const before = statSync(env, { bigint: true })
      writeFileSync(env, 'DATABASE_PASSWORD=hunter3-acme\n')
      utimesSync(env, 1000000000, 1000000000)
      const after = statSync(env, { bigint: true })
      expect([after.size, after.mtimeNs]).toEqual([before.size, before.mtimeNs])
    })
    expect(seen.detail.files.find((file) => file.path === '.env')).toMatchObject({
      content: null,
      withheld: 'content withheld: a sensitive place',
    })
  })

  test('a withheld file is told by a keyed hash of its content, its key kept outside the database', async () => {
    const seen = await reportedAfter([], (tree) => {
      writeFileSync(join(tree, '.env'), 'DATABASE_PASSWORD=changed-by-the-probe\n')
    })
    const key = readFileSync(join(data, 'capture.key'))
    expect(key).toHaveLength(32)
    const keyed = createHmac('sha256', key)
      .update('DATABASE_PASSWORD=changed-by-the-probe\n')
      .digest('hex')
    expect(seen.detail.files.find((file) => file.path === '.env')?.sha256).toBe(`keyed:${keyed}`)
    // Nothing of the profile but the key's own file holds the key, the database least of all.
    const holding = readdirSync(data, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== 'capture.key')
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => {
        const bytes = readFileSync(path)
        return bytes.includes(key) || bytes.includes(Buffer.from(key.toString('hex')))
      })
    expect(holding).toEqual([])
  })

  test('a withheld file only touched or given another mode is not told changed', async () => {
    const seen = await reportedAfter([], (tree) => {
      const env = join(tree, '.env')
      utimesSync(env, 2000000000, 2000000000)
      if (process.platform !== 'win32') chmodSync(env, 0o600)
      writeFileSync(join(tree, 'fixture.csv'), 'name\nÉloïse\n')
    })
    expect(seen.detail.files.map((file) => file.path)).toEqual(['fixture.csv'])
  })

  test('what the preparation wrote is not captured when the data folder is reached through a link', async () => {
    const linked = join(work, 'data-link')
    symlinkSync(data, linked, process.platform === 'win32' ? 'junction' : 'dir')
    data = linked
    const seen = await reportedAfter([{ line: nodeLine(marks) }], (tree) => {
      writeFileSync(join(tree, 'fixture.csv'), 'name\nÉloïse\n')
    })
    expect(seen.detail.files.map((file) => file.path)).toEqual(['fixture.csv'])
  })

  test('a file of exactly the room left is kept whole', async () => {
    const whole = 'x'.repeat(5 * 1024 * 1024)
    const seen = await reportedAfter([], (tree) => writeFileSync(join(tree, 'whole.txt'), whole))
    const file = seen.detail.files.find((one) => one.path === 'whole.txt')
    expect(file?.withheld).toBeNull()
    expect(file?.content?.length).toBe(whole.length)
  })

  test('a .git that leads to another repository refuses the report, and nothing of the other work tree is kept', async () => {
    const seen = await reportedAfter([], (tree) => {
      const out = (...args: string[]) => git(tree, ...args)
      const commit = out('rev-parse', 'HEAD')
      const common = out('rev-parse', '--path-format=absolute', '--git-common-dir')
      const other = join(work, 'other.git')
      const elsewhere = join(work, 'elsewhere')
      mkdirSync(elsewhere)
      git(work, 'init', '-q', '--bare', other)
      writeFileSync(join(other, 'objects', 'info', 'alternates'), `${join(common, 'objects')}\n`)
      git(work, '--git-dir', other, 'config', 'core.bare', 'false')
      git(work, '--git-dir', other, 'config', 'core.worktree', elsewhere)
      git(work, '--git-dir', other, '--work-tree', elsewhere, 'read-tree', commit)
      writeFileSync(join(elsewhere, 'importer.ts'), `${IMPORTER}not the Probe’s to keep\n`)
      writeFileSync(join(tree, 'importer.ts'), `${IMPORTER}// probed\n`)
      // Even leading back to the worktree, as an administrative folder of Git's does.
      writeFileSync(join(other, 'gitdir'), `${join(tree, '.git')}\n`)
      pointGitAt(tree, `gitdir: ${other}\n`)
    })
    expect(seen.answer.text).toBe(
      'refused: your worktree of api no longer leads to the repository Hemera made it from (its .git was changed), so nothing of it can be kept: put its .git back and report again',
    )
    expect(seen.detail.state).toBe('running')
    expect(JSON.stringify(seen.detail)).not.toContain('not the Probe’s to keep')
    expect(seen.kept.join('\n')).not.toContain('not the Probe’s to keep')
  })

  /** The refusal of a report whose worktree of `api` is no longer the one Hemera made. */
  const NOT_ITS_OWN =
    'refused: your worktree of api no longer leads to the repository Hemera made it from (its .git was changed), so nothing of it can be kept: put its .git back and report again'

  test('a .git that leads to another worktree of the same repository refuses the report', async () => {
    const seen = await reportedAfter([], (tree) => {
      const other = join(work, 'other-tree')
      git(tree, 'worktree', 'add', '-q', '--detach', other, 'HEAD')
      const admin = git(other, 'rev-parse', '--path-format=absolute', '--git-dir')
      writeFileSync(join(tree, 'fixture.csv'), 'name\nÉloïse\n')
      pointGitAt(tree, `gitdir: ${admin}\n`)
    })
    expect(seen.answer.text).toBe(NOT_ITS_OWN)
    expect(seen.detail.state).toBe('running')
  })

  test('a worktree moved aside and put back as a link refuses the report', async () => {
    const seen = await reportedAfter([], (tree) => {
      renameSync(tree, `${tree}-moved`)
      symlinkSync(`${tree}-moved`, tree, process.platform === 'win32' ? 'junction' : 'dir')
    })
    expect(seen.answer.text).toBe(NOT_ITS_OWN)
  })

  test('a .git changed once the worktree was found its own does not choose what is listed', async () => {
    let worktree = ''
    const seen = await reportedAfter(
      [],
      (tree) => {
        worktree = tree
        writeFileSync(join(tree, 'fixture.csv'), 'name\nÉloïse\n')
      },
      {
        probes: {
          hold: (at) =>
            at === 'listing'
              ? Effect.sync(() => {
                  const other = join(work, 'other.git')
                  const elsewhere = join(work, 'elsewhere')
                  mkdirSync(elsewhere)
                  git(work, 'init', '-q', '--bare', other)
                  git(work, '--git-dir', other, 'config', 'core.bare', 'false')
                  git(work, '--git-dir', other, 'config', 'core.worktree', elsewhere)
                  pointGitAt(worktree, `gitdir: ${other}\n`)
                })
              : Effect.void,
        },
      },
    )
    expect(seen.detail.files.map((file) => file.path)).toEqual(['fixture.csv'])
  })

  test.skipIf(process.platform === 'win32')(
    'the patch of a file the Probe made executable says so, as Git says it',
    async () => {
      let expected = ''
      const seen = await reportedAfter([], (tree) => {
        writeFileSync(join(tree, 'importer.ts'), `${IMPORTER}// probed\n`)
        chmodSync(join(tree, 'importer.ts'), 0o755)
        expected = git(
          tree,
          'diff',
          '--no-color',
          '--no-ext-diff',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          'HEAD',
          '--',
          'importer.ts',
        )
      })
      expect(expected).toContain('new mode 100755')
      expect(seen.detail.files.find((file) => file.path === 'importer.ts')?.patch?.trim()).toBe(
        expected,
      )
    },
  )

  test('a hard link swapped in between the read and the patch never reaches the patch', async () => {
    const secret = join(work, 'outside.txt')
    writeFileSync(secret, `${IMPORTER}not the Probe’s to keep\n`)
    let worktree = ''
    const seen = await reportedAfter(
      [],
      (tree) => {
        worktree = tree
        writeFileSync(join(tree, 'importer.ts'), `${IMPORTER}// probed\n`)
      },
      {
        probes: {
          hold: (at) =>
            at === 'patching'
              ? Effect.sync(() => {
                  rmSync(join(worktree, 'importer.ts'))
                  linkSync(secret, join(worktree, 'importer.ts'))
                })
              : Effect.void,
        },
      },
    )
    const importer = seen.detail.files.find((file) => file.path === 'importer.ts')
    expect(importer).toMatchObject({ content: `${IMPORTER}// probed\n`, withheld: null })
    expect(importer?.patch).toContain('+// probed')
    expect(JSON.stringify(seen.detail)).not.toContain('not the Probe’s to keep')
  })

  test('the capture keeps at most 200 files and 5 MiB of content; the rest is listed, withheld', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024)
    const seen = await reportedAfter([], (tree) => {
      mkdirSync(join(tree, 'fixtures'))
      for (let index = 0; index < 205; index += 1) {
        writeFileSync(join(tree, 'fixtures', `${String(index).padStart(3, '0')}.csv`), 'name\n')
      }
      writeFileSync(join(tree, 'big-1.txt'), big)
      writeFileSync(join(tree, 'big-2.txt'), big)
    })
    expect(seen.answer.text).toMatch(/^Kept: Probe #1 ended/)
    const kept = seen.detail.files.filter((file) => file.content !== null)
    const withheld = seen.detail.files.filter(
      (file) => file.withheld === 'content withheld: past the capture’s limit (200 files, 5 MiB)',
    )
    expect(seen.detail.files).toHaveLength(207)
    expect(kept).toHaveLength(200)
    expect(withheld).toHaveLength(7)
    const bytes = kept.reduce((sum, file) => sum + Buffer.byteLength(file.content ?? ''), 0)
    expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect(withheld.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true)
    // Hashed whole, a chunk at a time, through the handle that was proven.
    expect(seen.detail.files.find((file) => file.path === 'big-2.txt')?.sha256).toBe(
      createHash('sha256').update(big).digest('hex'),
    )
  })

  test('a large JSON file and the large patch the Probe left are kept masked as the whole mask gives them, while another fiber keeps its turns (#402)', async () => {
    const value = 'variable-value-8812'
    const json = largeJson(4 * LARGE_TEXT, value)
    const { secrets, watch, unwatched } = watchedSecrets((registry) =>
      registry.register('project-variables:acme', [value]),
    )
    let patch = ''
    const seen = await reportedAfter(
      [],
      (tree) => {
        writeFileSync(join(tree, 'lock.json'), json)
        writeFileSync(join(tree, 'importer.ts'), json)
        patch = execFileSync(
          'git',
          [
            'diff',
            '--no-color',
            '--no-ext-diff',
            '--no-textconv',
            '--src-prefix=a/',
            '--dst-prefix=b/',
            '--end-of-options',
            'HEAD',
            '--',
            'importer.ts',
          ],
          { cwd: tree, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        )
      },
      { secrets },
    )
    const files = new Map(seen.detail.files.map((file) => [file.path, file]))
    expect(patch.length).toBeGreaterThan(LARGE_TEXT)
    expect(files.get('lock.json')?.content).toBe(unwatched.mask(json))
    expect(files.get('importer.ts')?.content).toBe(unwatched.mask(json))
    expect(files.get('importer.ts')?.patch).toBe(unwatched.mask(patch))
    expect(unwatched.mask(patch)).not.toContain(value)
    expect(watch.syncOnLarge).toBe(0)
    expect(watch.pacedTurns).toHaveLength(3)
    for (const turns of watch.pacedTurns) expect(turns).toBeGreaterThan(0)
  })

  test('what the Probe committed in its worktree is captured against its base commit', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Waiting.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          const tree = join(row.folder, 'api')
          mkdirSync(join(tree, 'tests'), { recursive: true })
          writeFileSync(join(tree, 'tests', 'import-accents.test.ts'), 'assert(…)\n')
          writeFileSync(join(tree, 'importer.ts'), `${IMPORTER}// probed\n`)
          git(tree, 'add', '.')
          git(tree, 'commit', '-q', '-m', 'probe')
          const [session] = yield* sessionsOfLineage(row.lineage)
          const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session?.id ?? ''))
          const probeGrant = yield* ToolAccess.use((access) => access.byToken(token))
          yield* callTool(probeGrant?.id ?? '', 'probe_report', reported())
          hold.release()
          return yield* readProbe(row.id)
        }),
      ),
    )
    const files = new Map(seen.files.map((file) => [file.path, file]))
    expect(files.get('tests/import-accents.test.ts')).toMatchObject({
      status: 'new',
      content: 'assert(…)\n',
    })
    expect(files.get('importer.ts')).toMatchObject({ status: 'modified' })
    expect(files.get('importer.ts')?.patch).toContain('+// probed')
  })

  test('a nested repository is kept as withheld, and a deleted file as deleted', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Waiting.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          const tree = join(row.folder, 'api')
          // Git lists a repository inside the worktree as one entry, a folder.
          repository(join(tree, 'vendor', 'lib'), DEFAULT_BASE_BRANCH)
          rmSync(join(tree, 'importer.ts'))
          const [session] = yield* sessionsOfLineage(row.lineage)
          const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session?.id ?? ''))
          const probeGrant = yield* ToolAccess.use((access) => access.byToken(token))
          const answer = yield* callTool(probeGrant?.id ?? '', 'probe_report', reported())
          hold.release()
          return { answer, detail: yield* readProbe(row.id) }
        }),
      ),
    )
    expect(seen.answer.text).toMatch(/^Kept: Probe #1 ended/)
    expect(seen.detail.state).toBe('done')
    const files = new Map(seen.detail.files.map((file) => [file.path, file]))
    expect(files.get('vendor/lib/')).toMatchObject({
      status: 'new',
      content: null,
      withheld: 'content withheld: a nested repository',
    })
    expect(files.get('importer.ts')).toMatchObject({
      status: 'deleted',
      content: null,
      withheld: 'deleted by the Probe',
    })
  })

  test('a file gone between Git’s list and its reading is skipped, never a failure', async () => {
    const gone = join(work, 'gone.txt')
    expect(await found(gone)).toBeNull()
    writeFileSync(gone, 'here\n')
    expect(await found(gone)).toMatchObject({ withheld: null })
    expect(await found(join(gone, 'under.txt'))).toBeNull()
  })

  test('a symbolic link out of the worktree is not followed', async () => {
    const tree = join(work, 'tree')
    const outside = join(work, 'outside')
    mkdirSync(tree)
    mkdirSync(outside)
    writeFileSync(join(outside, 'notes.txt'), 'not the Probe’s to keep\n')
    // Git listed `notes/notes.txt` while `notes` was a folder; it is a link out when it is read.
    symlinkSync(outside, join(tree, 'notes'), process.platform === 'win32' ? 'junction' : 'dir')
    const read = await found(join(tree, 'notes', 'notes.txt'))
    expect(read).toMatchObject({
      sha256: 'unopened',
      bytes: null,
      withheld: `content withheld: ${THROUGH_A_LINK}`,
    })
  })

  test.skipIf(process.platform === 'win32')(
    'a pipe in the worktree is refused, never waited on',
    async () => {
      const pipe = join(work, 'pipe')
      execFileSync('mkfifo', [pipe])
      expect(await found(pipe)).toMatchObject({
        bytes: null,
        sha256: 'unopened',
        withheld: 'content withheld: it is not a regular file (a pipe, a device or a folder)',
      })
    },
  )
})

describe('The complete wipe', () => {
  test('kills the process tree, calls the cleanup hook, removes with --force, prunes, and checks git worktree list', async () => {
    const hold = held()
    const pidFile = join(work, 'serve.pid')
    const serves = script(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv[2], String(process.pid))
${STAYS_UP}`)
    let serveId = ''
    const cleaned: Array<{
      readonly probe: CleanedProbe
      readonly sessionLive: boolean
      readonly runsLive: number
    }> = []
    let watch: (
      probe: CleanedProbe,
    ) => Effect.Effect<{ sessionLive: boolean; runsLive: number }> = () =>
      Effect.succeed({ sessionLive: false, runsLive: 0 })
    const cleanup = Layer.succeed(ProbeCleanup, {
      run: (probe) =>
        Effect.flatMap(
          Effect.suspend(() => watch(probe)),
          (state) => Effect.sync(() => void cleaned.push({ probe, ...state })),
        ),
    })
    const observed = observedProcesses()
    const { world, run } = probing(
      () => ({
        turns: [
          [
            uses('toolu_serve', 'commands_run', { command: serveId, timeout: 1 }),
            uses('toolu_write', 'fs_write', {
              repository: 'api',
              path: 'scratch.txt',
              content: 'left behind\n',
            }),
          ],
        ],
        steps: [says('Waiting.')],
        between: () => hold.promise,
      }),
      { children: true, probes: { cleanup }, hostProcesses: observed.layer },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const serve = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: draft('serve', nodeLine(serves, pidFile)),
          })
          serveId = serve.id
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          hold.release()
          yield* until(Effect.sync(() => (world.agents[0]?.answers.toolAnswers.length ?? 0) === 2))
          yield* until(Effect.sync(() => existsSync(pidFile)))
          const servePid = Number(readFileSync(pidFile, 'utf8'))
          const runs = yield* Runs
          const database = yield* Database
          watch = () =>
            Effect.gen(function* () {
              const sessions = yield* sessionsIn(['starting', 'working', 'idle', 'stuck'])
              return {
                sessionLive: sessions.some((one) => one.lineage === row.lineage),
                runsLive: [...runs.live.values()].filter((live) =>
                  LIVE_RUN_STATES.some((state) => state === live.run.state),
                ).length,
              }
            }).pipe(Effect.orDie, Effect.provideService(Database, database))
          yield* ProbeDesk.use((desk) => desk.wipe(row.id))
          const [after] = yield* database.select().from(probes).where(eq(probes.id, row.id))
          return {
            row,
            after,
            servePid,
            listed: git(api, 'worktree', 'list', '--porcelain'),
            wiped: yield* eventsOf(mission.id, 'probe.wiped'),
            workspaceRows: yield* database
              .select()
              .from(workspaces)
              .where(eq(workspaces.id, row.workspaceId ?? '')),
          }
        }),
      ),
    )
    expect(seen.after?.state).toBe('wiped')
    expect(existsSync(seen.row.folder)).toBe(false)
    expect(seen.listed).not.toContain(seen.row.folder)
    expect(seen.wiped).toHaveLength(1)
    expect(seen.workspaceRows).toEqual([])
    expect(cleaned).toEqual([
      {
        probe: { probeId: seen.row.id, missionId: seen.row.missionId, folder: seen.row.folder },
        sessionLive: false,
        runsLive: 0,
      },
    ])
    // Each process's end as the supervisor saw it: a freed pid may already be another's.
    expect(world.pids.length).toBeGreaterThan(0)
    for (const pid of [seen.servePid, ...world.pids]) expect(observed.ended(pid)).toBe(true)
  })

  // Git for Windows writes `gitdir: C:/…/.git/worktrees/<name>`, and `worktree.useRelativePaths`
  // writes a path relative to the worktree: the repository is asked to Git, never read from it.
  test('a worktree whose .git names its repository by a relative path is removed by Git', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Waiting.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          git(api, 'config', 'worktree.useRelativePaths', 'true')
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          const pointer = readFileSync(join(row.folder, 'api', '.git'), 'utf8')
          const wiped = yield* ProbeDesk.use((desk) => desk.wipe(row.id)).pipe(Effect.result)
          hold.release()
          return { row, pointer, wiped, after: yield* readProbe(row.id), api }
        }),
      ),
    )
    expect(seen.pointer).toMatch(/^gitdir: \.\.\//)
    expect(Result.isSuccess(seen.wiped)).toBe(true)
    expect(seen.after.state).toBe('wiped')
    expect(existsSync(seen.row.folder)).toBe(false)
    expect(git(seen.api, 'worktree', 'list', '--porcelain')).not.toContain(seen.row.folder)
  })

  test('a worktree the Probe locked is removed by Git with --force, which a prune alone never does', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Waiting.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          git(api, 'worktree', 'lock', '--reason', 'held by the Probe', join(row.folder, 'api'))
          const wiped = yield* ProbeDesk.use((desk) => desk.wipe(row.id)).pipe(Effect.result)
          hold.release()
          return { row, wiped, after: yield* readProbe(row.id), api }
        }),
      ),
    )
    expect(Result.isSuccess(seen.wiped)).toBe(true)
    expect(seen.after.state).toBe('wiped')
    expect(existsSync(seen.row.folder)).toBe(false)
    expect(git(seen.api, 'worktree', 'list', '--porcelain')).not.toContain(seen.row.folder)
  })

  test('a wipe that fails (a locked file) stays wiping with its error, and succeeds at the next start', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Waiting.')], between: () => hold.promise }))
    let locked = ''
    const first = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          locked = join(row.folder, 'api', 'locked')
          mkdirSync(locked)
          writeFileSync(join(locked, 'held.txt'), 'held\n')
          chmodSync(locked, 0o555)
          const wiped = yield* ProbeDesk.use((desk) => desk.wipe(row.id)).pipe(Effect.result)
          const database = yield* Database
          const [after] = yield* database.select().from(probes).where(eq(probes.id, row.id))
          hold.release()
          return { row, wiped, after, failed: yield* eventsOf(mission.id, 'probe.wipe_failed') }
        }),
      ),
    )
    chmodSync(locked, 0o755)
    expect(Result.isFailure(first.wiped)).toBe(true)
    expect(first.after?.state).toBe('wiping')
    expect(first.after?.wipeError).toMatch(/\w/)
    expect(first.failed).toHaveLength(1)
    const second = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const row = yield* probeIn(first.row.missionId, 1, ['wiped'])
          return { row }
        }),
      ),
    )
    expect(second.row.wipeAttempts).toBe(2)
    expect(existsSync(first.row.folder)).toBe(false)
  })

  test('a Probe’s report racing its wipe: never wiped before its capture, never a report after', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Waiting.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          writeFileSync(join(row.folder, 'api', 'fixture.csv'), 'name\n')
          const [session] = yield* sessionsOfLineage(row.lineage)
          const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session?.id ?? ''))
          const probeGrant = yield* ToolAccess.use((access) => access.byToken(token))
          const [answer] = yield* Effect.all(
            [
              callTool(probeGrant?.id ?? '', 'probe_report', reported()),
              ProbeDesk.use((desk) => desk.wipe(row.id)),
            ],
            { concurrency: 'unbounded' },
          )
          hold.release()
          const ended = yield* eventsOf(mission.id, 'probe.ended')
          const wiped = yield* eventsOf(mission.id, 'probe.wiped')
          return { answer, ended, wiped, detail: yield* readProbe(row.id) }
        }),
      ),
    )
    expect(seen.wiped).toHaveLength(1)
    expect(seen.detail.state).toBe('wiped')
    if (seen.answer.ok) {
      // Reported first: its capture was taken before the wipe.
      expect(seen.ended[0]?.sequence ?? 0).toBeLessThan(seen.wiped[0]?.sequence ?? 0)
      expect(seen.detail.files.map((file) => file.path)).toContain('fixture.csv')
    } else {
      expect(seen.answer.text).toMatch(/^refused: Probe #1 /)
      expect(seen.ended).toEqual([])
      expect(seen.detail.report).toBeNull()
    }
  })

  test('two wipes at once wipe once', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Waiting.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          yield* Effect.all(
            [
              ProbeDesk.use((desk) => desk.wipe(row.id)),
              ProbeDesk.use((desk) => desk.wipeAll(mission.id)),
            ],
            { concurrency: 'unbounded' },
          )
          hold.release()
          return { wiped: yield* eventsOf(mission.id, 'probe.wiped'), row }
        }),
      ),
    )
    expect(seen.wiped).toHaveLength(1)
    expect(existsSync(seen.row.folder)).toBe(false)
  })
})

describe('A Probe exists only while its mission is in Planning', () => {
  test('a Cancel while a Probe is being prepared wipes it: no session, no run, no folder', async () => {
    const gate = join(work, 'never')
    const { world, run } = probing(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme([{ line: nodeLine(waitsFor, gate) }])
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['preparing'])
          const runs = yield* Runs
          yield* until(Effect.sync(() => runs.live.size === 1))
          yield* moveMission(mission.id, 'cancel', 'user')
          const after = yield* probeIn(mission.id, 1, ['wiped'])
          return { row, after, live: runs.live.size }
        }),
      ),
    )
    expect(seen.after.state).toBe('wiped')
    expect(seen.live).toBe(0)
    expect(existsSync(seen.row.folder)).toBe(false)
    expect(world.agents).toHaveLength(0)
  })

  test('a Cancel between a launch’s record and its start leaves no worktree and runs no recipe', async () => {
    const recorded = held()
    let reached = false
    const { world, run } = probing(() => QUIET, {
      probes: {
        hold: (at) =>
          at === 'recorded'
            ? Effect.promise(() => {
                reached = true
                return recorded.promise
              })
            : Effect.void,
      },
    })
    const seen = await run(({ profile, lines }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme([{ line: nodeLine(marks) }])
          const { mission, grantId } = yield* planningMission(project.id, main)
          const launching = yield* Effect.forkChild(
            launch(grantId, 'does the importer keep accents?'),
          )
          yield* until(Effect.sync(() => reached))
          yield* moveMission(mission.id, 'cancel', 'user')
          const row = yield* probeIn(mission.id, 1, ['wiped'])
          recorded.release()
          const answer = yield* Fiber.join(launching)
          // Either the start declined it, or a Workspace was made and prepared in its folder.
          const database = yield* Database
          const madeIn = database.select().from(workspaces).where(eq(workspaces.folder, row.folder))
          yield* until(
            Effect.gen(function* () {
              if (lines.some((line) => line.includes(`Probe ${row.id} is not started`))) return true
              const ended = yield* database
                .select()
                .from(domainEvents)
                .where(eq(domainEvents.type, 'workspace.preparation_ended'))
              return ended.length > 0
            }),
          )
          const runs = yield* Runs
          return { row, answer, made: yield* madeIn, live: runs.live.size }
        }),
      ),
    )
    expect(seen.answer.ok).toBe(true)
    expect(seen.made).toEqual([])
    expect(seen.live).toBe(0)
    expect(existsSync(seen.row.folder)).toBe(false)
    expect(world.agents).toHaveLength(0)
  })

  test('a Freeze while a Probe runs wipes it; a done Probe keeps its capture', async () => {
    const hold = held()
    const { run } = probing((index) =>
      index === 0
        ? { turns: [[uses('toolu_report', 'probe_report', reported())]], steps: [says('Done.')] }
        : { steps: [says('Waiting.')], between: () => hold.promise },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'first?')
          yield* probeIn(mission.id, 1, ['done'])
          yield* launch(grantId, 'second?')
          yield* probeIn(mission.id, 2, ['running'])
          yield* moveMission(mission.id, 'freeze', 'user')
          yield* probeIn(mission.id, 1, ['wiped'])
          yield* probeIn(mission.id, 2, ['wiped'])
          hold.release()
          const [done] = yield* rowsOf(mission.id)
          return { done: yield* readProbe(done?.id ?? '') }
        }),
      ),
    )
    expect(seen.done.outcome).toBe('reproduced')
    expect(seen.done.report).not.toBeNull()
  })
})

describe('Reconciliation at every start, both ways', () => {
  test('a running Probe is relaunched with the same brief in the same folder; it counts nowhere', async () => {
    let hold = held()
    const { world, run } = probing(() => ({
      steps: [says('Reading.')],
      between: () => hold.promise,
    }))
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          yield* until(Effect.sync(() => probeAgentsOf(world).length === 1))
          writeFileSync(join(row.folder, 'api', 'kept.csv'), 'name\n')
          return { row, mission }
        }),
      ),
    )
    hold.release()
    hold = held()
    const after = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const row = yield* probeIn(before.mission.id, 1, ['running'])
          yield* until(Effect.sync(() => probeAgentsOf(world).length === 2))
          const database = yield* Database
          const spent = yield* database
            .select()
            .from(missionSpent)
            .where(eq(missionSpent.missionId, before.mission.id))
          const sessions = yield* sessionsOfLineage(row.lineage)
          return {
            row,
            spent,
            sessions,
            interrupted: yield* eventsOf(before.mission.id, 'probe.interrupted'),
            rows: yield* rowsOf(before.mission.id),
          }
        }),
      ),
    )
    hold.release()
    expect(after.rows).toHaveLength(1)
    expect(after.row.folder).toBe(before.row.folder)
    expect(after.row.workspaceId).toBe(before.row.workspaceId)
    expect(existsSync(join(after.row.folder, 'api', 'kept.csv'))).toBe(true)
    expect(after.interrupted).toHaveLength(1)
    expect(after.spent.find((one) => one.counter === 'launches')?.spent).toBe(1)
    expect(
      after.sessions.filter((one) => ['starting', 'working', 'idle'].includes(one.state)),
    ).toHaveLength(1)
    const brief = text(probeAgentsOf(world)[1]?.answers.prompts[0] ?? [])
    expect(brief).toContain('Question: does the importer keep accents?')
    expect(brief).toContain(before.row.folder)
  })

  test('a Probe interrupted while it was prepared resumes its preparation (#6) at the next start', async () => {
    const gate = join(work, 'recipe-may-go')
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Reading.')], between: () => hold.promise }))
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme([
            { line: nodeLine(waitsFor, gate) },
            { line: nodeLine(marks) },
          ])
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const runs = yield* Runs
          yield* until(Effect.sync(() => runs.live.size === 1))
          return { row: yield* probeIn(mission.id, 1, ['preparing']), mission }
        }),
      ),
    )
    writeFileSync(gate, '')
    const after = await run(({ profile }) =>
      within(profile, probeIn(before.mission.id, 1, ['running'])),
    )
    hold.release()
    expect(after.folder).toBe(before.row.folder)
    expect(readFileSync(join(after.folder, 'api', 'prepared.txt'), 'utf8')).toBe('ok')
  })

  test('a Probe of a Ready mission is wiped, and an unknown folder under probes/ is wiped', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Reading.')], between: () => hold.promise }))
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          // The mission left Planning while nothing followed it: an engine that stopped at once.
          const database = yield* Database
          yield* database
            .update(missions)
            .set({ stage: 'ready' })
            .where(eq(missions.id, mission.id))
          const unknown = join(data, 'probes', 'ACME-9', '7')
          git(api, 'worktree', 'add', '--detach', join(unknown, 'api'), 'HEAD')
          mkdirSync(join(data, 'probes', 'ACME-9', '8'), { recursive: true })
          return { row, mission, api, unknown }
        }),
      ),
    )
    hold.release()
    const after = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const row = yield* probeIn(before.mission.id, 1, ['wiped'])
          yield* until(Effect.sync(() => !existsSync(join(data, 'probes', 'ACME-9'))))
          return { row }
        }),
      ),
    )
    expect(after.row.state).toBe('wiped')
    expect(existsSync(before.row.folder)).toBe(false)
    const listed = git(before.api, 'worktree', 'list', '--porcelain')
    expect(listed).not.toContain(before.unknown)
    expect(listed).not.toContain(before.row.folder)
  })

  test('a Probe launched while the start sweeps unknown folders keeps its folder', async () => {
    const hold = held()
    const sweeping = held()
    let armed = false
    let reached = false
    const { run } = probing(() => ({ steps: [says('Reading.')], between: () => hold.promise }), {
      probes: {
        hold: (at) =>
          armed && at === 'sweeping'
            ? Effect.promise(() => {
                reached = true
                return sweeping.promise
              })
            : Effect.void,
      },
    })
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission } = yield* planningMission(project.id, main)
          mkdirSync(join(data, 'probes', 'ACME-9', '7'), { recursive: true })
          return { mission, main }
        }),
      ),
    )
    armed = true
    const after = await run(({ profile, lines }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(Effect.sync(() => reached))
          const { grantId } = yield* plannerGrant(before.mission.id, before.main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(before.mission.id, 1, ['running'])
          sweeping.release()
          yield* until(Effect.sync(() => lines.some((line) => line.includes('probes: reconciled'))))
          return { row, after: yield* readProbe(row.id) }
        }),
      ),
    )
    hold.release()
    expect(after.after.state).toBe('running')
    expect(existsSync(join(after.row.folder, 'api', 'importer.ts'))).toBe(true)
    expect(existsSync(join(data, 'probes', 'ACME-9'))).toBe(false)
  })

  test('a stray file under probes/ does not stop the reconciliation', async () => {
    let hold = held()
    const { world, run } = probing(() => ({
      steps: [says('Reading.')],
      between: () => hold.promise,
    }))
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          yield* probeIn(mission.id, 1, ['running'])
          yield* until(Effect.sync(() => probeAgentsOf(world).length === 1))
          writeFileSync(join(data, 'probes', 'notes.txt'), 'not a Probe\n')
          mkdirSync(join(data, 'probes', 'ACME-9'))
          writeFileSync(join(data, 'probes', 'ACME-9', '7'), 'not a Probe either\n')
          return { mission }
        }),
      ),
    )
    hold.release()
    hold = held()
    const after = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(Effect.sync(() => probeAgentsOf(world).length === 2))
          return yield* probeIn(before.mission.id, 1, ['running'])
        }),
      ),
    )
    hold.release()
    expect(after.state).toBe('running')
  })
})

describe('A restored Profile’s Probes (#4’s registry)', () => {
  test('the reconciliation step interrupts what the backup held running, and only advances', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Reading.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          yield* probeIn(mission.id, 1, ['running'])
          const recorded = yield* RESTORED_PROBES.recorded('profile')
          yield* RESTORED_PROBES.advance('profile', 'interrupted')
          const after = yield* RESTORED_PROBES.recorded('profile')
          hold.release()
          return { recorded, after, rows: yield* rowsOf(mission.id) }
        }),
      ),
    )
    expect(RESTORED_PROBES.states).toEqual(['live', 'interrupted'])
    expect(seen.recorded).toBe('live')
    expect(seen.after).toBe('interrupted')
    expect(seen.rows.map((row) => row.state)).toEqual(['interrupted'])
  })
})

describe('Stuck (#40’s rule)', () => {
  test('a Probe silent in a turn past the bound is stuck, its Planner told; not while its command runs', async () => {
    const hold = held()
    const sweeps = heldSweeps()
    let longId = ''
    const { world, run } = probing(
      (index) => {
        if (index === 0) {
          return {
            turns: [[uses('toolu_long', 'commands_run', { command: longId, timeout: 600 })]],
            steps: [says('Waiting.')],
          }
        }
        if (index === 1) return { steps: [says('Silent.')], between: () => hold.promise }
        return { steps: [says('Back.')] }
      },
      // Its agents start slower than the bound, as under load: the start is part of the turn.
      { ...sweeps, starting: () => Effect.sleep(SILENCE.stuckAfter) },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const long = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: draft('long tests', nodeLine(script(STAYS_UP))),
          })
          longId = long.id
          const { mission, grantId, planner } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'how long do the tests take?')
          yield* probeIn(mission.id, 1, ['running'])
          const runs = yield* Runs
          yield* until(Effect.sync(() => runs.live.size === 1))
          yield* launch(grantId, 'does the importer keep accents?')
          yield* probeIn(mission.id, 2, ['running'])
          // Its turn begun, silent past the bound, its sibling's command running all along: looked at.
          yield* until(Effect.sync(() => (world.agents[1]?.answers.prompts.length ?? 0) > 0))
          yield* Effect.sleep(SILENCE.stuckAfter)
          yield* sweeps.swept
          // Stuck is told by its event: the fresh session may speak before a row is read.
          yield* until(Effect.map(eventsOf(mission.id, 'probe.stuck'), (rows) => rows.length > 0))
          const database = yield* Database
          const toPlanner = database
            .select()
            .from(sessionDeliveries)
            .where(eq(sessionDeliveries.targetLineage, planner.lineage))
          yield* until(Effect.map(toPlanner, (rows) => rows.some((one) => /stuck/.test(one.body))))
          const told = yield* toPlanner
          // The fresh session of its lineage speaks: it is no longer stuck.
          yield* until(Effect.map(eventsOf(mission.id, 'probe.unstuck'), (rows) => rows.length > 0))
          return {
            told,
            stuck: yield* eventsOf(mission.id, 'probe.stuck'),
            rows: yield* rowsOf(mission.id),
          }
        }),
      ),
    )
    hold.release()
    // Only the silent one: the other one's command ran all along, past the same bound.
    expect(seen.stuck.map((event) => JSON.parse(event.payload).number)).toEqual([2])
    expect(seen.rows.map((row) => row.stuck)).toEqual([false, false])
    expect(seen.told.map((one) => one.body).join('\n')).toMatch(/stuck/)
    expect(world.agents.length).toBeGreaterThanOrEqual(3)
  })
})

describe('The reservation of an exclusive resource (#88)', () => {
  test('a Probe running a declared command waits while another mission holds it, and releases it when it ends', async () => {
    let testId = ''
    const { run } = probing(() => ({
      turns: [
        [
          uses('toolu_test', 'commands_run', { command: testId, timeout: 600 }),
          uses('toolu_report', 'probe_report', reported({ outcome: 'answered', observed: 'ok' })),
        ],
      ],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const writes = script(`console.log('ok')`)
          const tests = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: draft('test', nodeLine(writes)),
          })
          const migrate = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: draft('migrate', nodeLine(writes)),
          })
          const declared: ResourceDraft = {
            name: 'shared database',
            description: 'The development database of Acme',
            uses: [tests.id],
            changes: [migrate.id],
            resetCommandId: migrate.id,
          }
          yield* saveResources(project.id, [declared])
          const other = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          const reservations = yield* ExclusiveResources
          yield* reservations.acquire('shared database', other.id)
          return { project, main, tests, other, reservations }
        }).pipe(
          Effect.flatMap(({ project, main, tests, other, reservations }) =>
            Effect.gen(function* () {
              const { mission, grantId } = yield* planningMission(project.id, main)
              // The Probe's script names the command by the id the catalogue gave it.
              testId = tests.id
              yield* launch(grantId, 'does the importer keep accents?')
              yield* probeIn(mission.id, 1, ['running'])
              yield* until(
                Effect.map(getMission(mission.id), (now) =>
                  now.marks.some((mark) => mark.sentence.includes('shared database')),
                ),
              )
              const blocked = (yield* getMission(mission.id)).marks.map((mark) => mark.sentence)
              yield* reservations.release('shared database', other.id, 'its work is done')
              yield* probeIn(mission.id, 1, ['done'])
              yield* until(
                Effect.map(reservations.holders, (all) => all.every((one) => one.holder === null)),
              )
              return {
                blocked,
                acquired: (yield* (yield* Database)
                  .select()
                  .from(domainEvents)
                  .where(eq(domainEvents.type, 'resource.acquired'))).filter((event) =>
                  event.payload.includes(mission.id),
                ),
                holders: yield* reservations.holders,
              }
            }),
          ),
        ),
      ),
    )
    expect(seen.blocked.some((sentence) => sentence.includes('shared database'))).toBe(true)
    expect(seen.acquired).toHaveLength(1)
    expect(seen.holders.every((one) => one.holder === null)).toBe(true)
  })
})

describe('Two Probes at once', () => {
  test('two launches at once are two Probes, each in its own folder, each running', async () => {
    const hold = held()
    const { run } = probing(() => ({ steps: [says('Reading.')], between: () => hold.promise }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          const answers = yield* Effect.all([launch(grantId, 'left?'), launch(grantId, 'right?')], {
            concurrency: 'unbounded',
          })
          yield* probeIn(mission.id, 1, ['running'])
          yield* probeIn(mission.id, 2, ['running'])
          hold.release()
          return { answers, rows: yield* rowsOf(mission.id) }
        }),
      ),
    )
    expect(seen.answers.every((one) => one.ok)).toBe(true)
    expect(seen.rows.map((row) => row.number)).toEqual([1, 2])
    expect(new Set(seen.rows.map((row) => row.folder)).size).toBe(2)
    expect(new Set(seen.rows.map((row) => row.lineage)).size).toBe(2)
  })
})

describe('What the Planner and the Planning page read', () => {
  test('probe_read gives the state, then the report; the chips follow each change; there is no stop', async () => {
    const hold = held()
    const { run } = probing(() => ({
      turns: [[uses('toolu_report', 'probe_report', reported())]],
      steps: [says('Done.')],
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          // Followed from before the launch: its first element says it is subscribed.
          const subscribed = yield* Deferred.make<void>()
          const changes = yield* probeChanges(mission.id).pipe(
            Stream.tap(() => Deferred.succeed(subscribed, undefined)),
            Stream.takeUntil((chips) => chips[0]?.state === 'done'),
            Stream.runCollect,
            Effect.forkChild,
          )
          yield* Deferred.await(subscribed)
          yield* launch(grantId, 'does the importer keep accents?')
          yield* probeIn(mission.id, 1, ['running'])
          const running = yield* callTool(grantId, 'probe_read', { probe: '#1' })
          hold.release()
          yield* probeIn(mission.id, 1, ['done'])
          const done = yield* callTool(grantId, 'probe_read', { probe: '1' })
          const unknown = yield* callTool(grantId, 'probe_read', { probe: '#9' })
          const seenChanges = yield* Fiber.join(changes)
          return { running, done, unknown, seenChanges, chips: yield* listProbes(mission.id) }
        }),
      ),
    )
    expect(seen.running.text).toMatch(/^Probe #1 is running: does the importer keep accents\?/)
    expect(seen.done.text).toContain('Outcome: reproduced')
    expect(seen.unknown.text).toBe('refused: this mission has no Probe #9')
    const states = [...seen.seenChanges].map((chips) => chips[0]?.state ?? 'none')
    expect(states[0]).toBe('none')
    expect(states).toContain('preparing')
    expect(states).toContain('running')
    expect(states.at(-1)).toBe('done')
    expect(seen.chips).toEqual([
      expect.objectContaining({
        label: '#1',
        question: 'does the importer keep accents?',
        state: 'done',
        stuck: false,
        outcome: 'reproduced',
      }),
    ])
    expect(Option.isNone(Option.fromNullishOr(seen.chips[0]?.endedAt ?? null))).toBe(false)
  })
})

const calls = (id: string, title: string, status?: 'completed'): FakeStep => ({
  does: 'calls',
  call: status === undefined ? { id, title } : { id, title, status },
})

/** A turn held before each of its steps until the test lets it take the next, or frees it. */
const paced = () => {
  let reached = 0
  let free = false
  let waiting: (() => void) | null = null
  const next = () => {
    const go = waiting
    waiting = null
    go?.()
  }
  return {
    between: () => {
      reached += 1
      return free ? Promise.resolve() : new Promise<void>((resolve) => (waiting = resolve))
    },
    /** The step it is held before, counting from one. */
    reached: (step: number) => Effect.sync(() => reached >= step),
    next,
    free: () => {
      free = true
      next()
    },
  }
}

const stepOf = (missionId: string, number: number) =>
  Effect.map(
    listProbes(missionId),
    (chips) => chips.find((chip) => chip.number === number)?.step ?? null,
  )

const stepIs = (missionId: string, number: number, step: string) =>
  until(Effect.map(stepOf(missionId, number), (seen) => seen === step))

describe('A running Probe’s step (#206)', () => {
  test('a Probe’s step follows its latest call, on its chip as it changes', async () => {
    const pace = paced()
    const { run } = probing(() => ({
      turns: [
        [
          calls('toolu_read', 'Read api/importer.ts'),
          calls('toolu_run', 'Run node tests/import-accents.test.ts'),
          uses('toolu_report', 'probe_report', reported()),
        ],
      ],
      steps: [says('Done.')],
      between: pace.between,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          const subscribed = yield* Deferred.make<void>()
          const changes = yield* probeChanges(mission.id).pipe(
            Stream.tap(() => Deferred.succeed(subscribed, undefined)),
            Stream.takeUntil((chips) => chips[0]?.state === 'done'),
            Stream.runCollect,
            Effect.forkChild,
          )
          yield* Deferred.await(subscribed)
          yield* launch(grantId, 'does the importer keep accents?')
          yield* until(pace.reached(1))
          pace.next()
          yield* until(pace.reached(2))
          yield* stepIs(mission.id, 1, 'Read api/importer.ts')
          pace.next()
          yield* until(pace.reached(3))
          yield* stepIs(mission.id, 1, 'Run node tests/import-accents.test.ts')
          const detail = yield* readProbe((yield* rowsOf(mission.id))[0]?.id ?? '')
          pace.free()
          yield* probeIn(mission.id, 1, ['done'])
          return { detail, changes: yield* Fiber.join(changes) }
        }),
      ),
    )
    expect(seen.detail.step).toBe('Run node tests/import-accents.test.ts')
    const steps = [...seen.changes].map((chips) => chips[0]?.step ?? null)
    expect(steps).toContain('Read api/importer.ts')
    expect(steps.indexOf('Run node tests/import-accents.test.ts')).toBeGreaterThan(
      steps.indexOf('Read api/importer.ts'),
    )
  })

  test('a running Probe that has not called a tool yet shows no step', async () => {
    const pace = paced()
    const { run } = probing(() => ({
      turns: [
        [
          calls('toolu_read', 'Read api/importer.ts'),
          uses('toolu_report', 'probe_report', reported()),
        ],
      ],
      steps: [says('Done.')],
      between: pace.between,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          const row = yield* probeIn(mission.id, 1, ['running'])
          // Held before its first step: its agent has its brief and has done nothing yet.
          yield* until(pace.reached(1))
          const chips = yield* listProbes(mission.id)
          const detail = yield* readProbe(row.id)
          pace.free()
          yield* probeIn(mission.id, 1, ['done'])
          return { chips, detail }
        }),
      ),
    )
    expect(seen.chips[0]?.state).toBe('running')
    expect(seen.chips[0]?.step).toBeNull()
    expect(seen.detail.step).toBeNull()
  })

  test('an ended Probe keeps no step, even for a call made after its report', async () => {
    const pace = paced()
    const { run } = probing(() => ({
      turns: [
        [
          calls('toolu_read', 'Read api/importer.ts'),
          uses('toolu_report', 'probe_report', reported()),
          calls('toolu_after', 'List the worktree', 'completed'),
          says('Done.'),
        ],
      ],
      between: pace.between,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'does the importer keep accents?')
          yield* until(pace.reached(1))
          pace.next()
          yield* until(pace.reached(2))
          yield* stepIs(mission.id, 1, 'Read api/importer.ts')
          pace.next()
          const row = yield* probeIn(mission.id, 1, ['done'])
          // Its call after the report is heard: its session's thread has it.
          yield* until(pace.reached(3))
          pace.next()
          yield* until(pace.reached(4))
          const [session] = yield* sessionsOfLineage(row.lineage)
          yield* until(
            Effect.map(threadOf(session?.id ?? ''), (lines) =>
              lines.some((line) => line.text.startsWith('List the worktree')),
            ),
          )
          const chips = yield* listProbes(mission.id)
          const detail = yield* readProbe(row.id)
          pace.free()
          return { chips, detail }
        }),
      ),
    )
    expect(seen.chips[0]?.state).toBe('done')
    expect(seen.chips[0]?.step).toBeNull()
    expect(seen.detail.step).toBeNull()
  })

  test('two Probes keep their own steps', async () => {
    const paces = [paced(), paced()]
    const { run } = probing((index) => ({
      turns: [
        [
          ...(index === 0
            ? [calls('toolu_left_1', 'Read left.ts'), calls('toolu_left_2', 'Run left.test.ts')]
            : [calls('toolu_right_1', 'Read right.ts')]),
          uses('toolu_report', 'probe_report', reported()),
        ],
      ],
      steps: [says('Done.')],
      between: paces[index]?.between ?? (() => Promise.resolve()),
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, grantId } = yield* planningMission(project.id, main)
          yield* launch(grantId, 'left?')
          yield* launch(grantId, 'right?')
          const [left, right] = paces
          if (left === undefined || right === undefined) return yield* Effect.die('no pace')
          // Each held before its report: the left one after two calls, the right one after one.
          yield* until(left.reached(1))
          left.next()
          yield* until(left.reached(2))
          left.next()
          yield* until(left.reached(3))
          yield* until(right.reached(1))
          right.next()
          yield* until(right.reached(2))
          const wanted = ['Read right.ts', 'Run left.test.ts']
          yield* until(
            Effect.map(listProbes(mission.id), (chips) =>
              wanted.every((step) => chips.some((chip) => chip.step === step)),
            ),
          )
          const chips = yield* listProbes(mission.id)
          left.free()
          right.free()
          yield* probeIn(mission.id, 1, ['done'])
          yield* probeIn(mission.id, 2, ['done'])
          return { chips }
        }),
      ),
    )
    expect(seen.chips.map((chip) => chip.step).toSorted()).toEqual([
      'Read right.ts',
      'Run left.test.ts',
    ])
  })
})
