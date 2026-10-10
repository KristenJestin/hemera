/**
 * The pre-launch check and the launch (#139): the check of a Ready mission against the code of
 * today (what moved since the Freeze, what the agent of the check says of the rest, the Builder's
 * model), its expiry, the launch on a valid check (the Workspace prepared from the base the check
 * read, the validation settings copied, Ready → Building and `BuildingStart` once), a failed
 * preparation and its Retry, a restart in the middle, and a dependency reaching Done.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent, a temporary data folder,
 * and Acme's real repositories with a bare remote on the same disk. Every wait is on state.
 */

import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MaskedText } from '@hemera/core/domain'
import { BuildingRefused, type CheckedBase, type Mission } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Predicate, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  backToPlanningFromCheck,
  checkMission,
  chooseBuilderModel,
  latestCheckOf,
} from '../src/engine/building/check.ts'
import { launchMission, preparationOf } from '../src/engine/building/launch.ts'
import { PRELAUNCH_ROLE } from '../src/engine/building/prelaunch-role.ts'
import { validationSettingsOf } from '../src/engine/building/validation.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { getMission, moveMission } from '../src/engine/missions.ts'
import { getNeed, retryNeed } from '../src/engine/needs.ts'
import { REGISTRY } from '../src/engine/notifications.ts'
import { decideDependency, dependenciesOf } from '../src/engine/planning/dependencies.ts'
import { PLANNER_TEMPLATE } from '../src/engine/planning/role.ts'
import { getProject } from '../src/engine/projects.ts'
import { saveRecipe } from '../src/engine/recipe.ts'
import { roleSettingAt } from '../src/engine/sessions/cascade.ts'
import { ROLES_REGISTERED } from '../src/engine/sessions/roles.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  domainEvents,
  missionTickets,
  missions,
  sessionDeliveries,
  specs,
  ticketVersions,
} from '../src/engine/storage/schema.ts'
import { getWorkspace } from '../src/engine/workspaces.ts'
import {
  INVOICES,
  PACKAGE,
  QUIET,
  READING,
  acmeAt,
  answered,
  buildingEngine,
  call,
  commandDraft,
  frozenIn,
  plannedIn,
  plannerTook,
  pushedOnRemote,
  reporting,
  settledAndFrozen,
} from './building-world.ts'
import { git } from './repositories.ts'
import { text, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building'))
  work = realpathSync.native(temporaryFolder('building-work'))
})
afterEach(removeFolders)

/** The cold reads first (one per Freeze), then the agents of the checks, each as given. */
const agents =
  (...checks: ReadonlyArray<typeof QUIET>) =>
  (index: number) =>
    index === 0 ? READING : (checks[index - 1] ?? READING)

const acme = () => acmeAt(work)

/** Waits until the mission's last check has ended (done or failed), and answers it. */
const checked = (missionId: string) =>
  Effect.gen(function* () {
    yield* until(
      Effect.map(latestCheckOf(missionId), (view) => view !== null && view.state !== 'running'),
    )
    const view = yield* latestCheckOf(missionId)
    if (view === null) return yield* Effect.die(new Error('no check'))
    return view
  })

/** Waits until the mission is in this stage. */
const inStage = (missionId: string, stage: Mission['stage']) =>
  until(Effect.map(getMission(missionId), (mission) => mission.stage === stage))

const eventsOf = (missionId: string, type: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select({ payload: domainEvents.payload })
      .from(domainEvents)
      .where(and(eq(domainEvents.entityId, missionId), eq(domainEvents.type, type)))
      .orderBy(asc(domainEvents.sequence))
  })

const refusedWith = (outcome: Result.Result<unknown, unknown>) =>
  Result.isFailure(outcome) && outcome.failure instanceof BuildingRefused
    ? outcome.failure.reasons
    : null

const FRESHNESS = ['FetchedNow', 'NotFetchedSince', 'LocalBranch'] as const

/** How fresh a base the check read is, by its tag. */
const freshnessOf = (base: CheckedBase) =>
  FRESHNESS.find((tag) => Predicate.isTagged(base.freshness, tag)) ?? null

const marksOf = (mission: Mission) => mission.marks.map((one) => one.sentence)

/** The remote's `invoices.ts` changed by someone else: a file the task targets. */
const targetMoved = (bare: string) =>
  pushedOnRemote(work, bare, (clone) =>
    writeFileSync(join(clone, 'invoices.ts'), `${INVOICES}export const total = 0\n`),
  )

/** The remote's `package.json` changed by someone else: a manifest no task targets. */
const manifestMoved = (bare: string) =>
  pushedOnRemote(work, bare, (clone) =>
    writeFileSync(join(clone, 'package.json'), PACKAGE.replace('{}', '{ "csv": "1.0.0" }')),
  )

/** The mission's ticket, read twice: the base the Spec was built from, then a newer version. */
const ticketMoved = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const version = (id: string, description: string) => ({
      id,
      missionId,
      providerId: null,
      provider: 'github',
      reference: 'github:github.example/acme/shop#41',
      key: 'acme/shop#41',
      url: 'https://github.example/acme/shop/issues/41',
      title: MaskedText.make('Export invoices'),
      description: MaskedText.make(description),
      state: 'open',
      wording: 'Open',
      author: null,
      labels: '[]',
      comments: '[]',
      updatedAt: new Date().toISOString(),
      readAt: new Date().toISOString(),
      fingerprint: description,
    })
    yield* database
      .insert(ticketVersions)
      .values([version('v1', 'As CSV.'), version('v2', 'As CSV, with totals.')])
    yield* database
      .update(missions)
      .set({
        ticketReference: 'github:github.example/acme/shop#41',
        ticketKey: 'acme/shop#41',
        ticketUrl: 'https://github.example/acme/shop/issues/41',
      })
      .where(eq(missions.id, missionId))
    yield* database.insert(missionTickets).values({
      missionId,
      providerId: null,
      mode: 'linked',
      baseVersionId: 'v1',
      lastVersionId: 'v2',
      linkedAt: new Date().toISOString(),
    })
  })

describe('The check lists what moved since the Freeze, and the choice stays the user’s', () => {
  test('a targeted file changed on the remote base is moved and marks the mission outdated; Launch anyway and Back to Planning are offered; Launch anyway launches', async () => {
    const { run, starts } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          targetMoved(bare)
          const started = yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          const marked = yield* getMission(mission.id)
          const refused = yield* Effect.result(launchMission(mission.id, view.id, 'launch'))
          yield* launchMission(mission.id, view.id, 'launch_anyway')
          yield* inStage(mission.id, 'building')
          return {
            started,
            view,
            marked,
            refused,
            launched: yield* eventsOf(mission.id, 'building.launched'),
          }
        }),
      ),
    )
    expect(seen.started.kind).toBe('full')
    expect(seen.view.state).toBe('done')
    expect(seen.view.moved).toContainEqual(
      expect.objectContaining({
        kind: 'target',
        repository: 'api',
        path: 'invoices.ts',
        status: 'M',
        added: 1,
        removed: 0,
      }),
    )
    // Nothing else changed: no agent to ask.
    expect(seen.view.handed).toEqual([])
    expect(seen.view.agent.state).toBe('skipped')
    expect(seen.view.verdict).toMatchObject({
      outdated: true,
      blockedBy: [],
      actions: ['launch_anyway', 'back_to_planning'],
    })
    expect(marksOf(seen.marked)).toContain('outdated')
    expect(refusedWith(seen.refused)?.join(' ')).toMatch(/Launch anyway/)
    expect(seen.launched).toHaveLength(1)
    expect(starts.missions).toHaveLength(1)
  })

  test('a test file named by a Proof block and a changed linked ticket are each listed as moved', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          pushedOnRemote(work, bare, (clone) => {
            mkdirSync(join(clone, 'tests'))
            writeFileSync(join(clone, 'tests', 'invoices.test.ts'), 'test("other", () => {})\n')
          })
          yield* ticketMoved(mission.id)
          yield* checkMission(mission.id)
          return yield* checked(mission.id)
        }),
      ),
    )
    expect(seen.moved).toContainEqual(
      expect.objectContaining({
        kind: 'proof',
        repository: 'api',
        path: 'tests/invoices.test.ts',
        status: 'A',
      }),
    )
    expect(seen.moved).toContainEqual(
      expect.objectContaining({ kind: 'ticket', repository: null, path: null }),
    )
    expect(seen.verdict.outdated).toBe(true)
  })

  test('nothing moved: Launch is offered, and the agent of the check is not asked', async () => {
    const { run, world } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          return { view: yield* checked(mission.id), mission: yield* getMission(mission.id) }
        }),
      ),
    )
    expect(seen.view.moved).toEqual([])
    expect(seen.view.agent).toMatchObject({ state: 'skipped' })
    expect(seen.view.agent.said).toMatch(/nothing else changed/i)
    expect(seen.view.verdict.actions).toEqual(['launch'])
    expect(seen.view.bases.map((base) => [base.repository, freshnessOf(base)])).toEqual([
      ['api', 'FetchedNow'],
      ['web', 'LocalBranch'],
    ])
    expect(marksOf(seen.mission)).not.toContain('outdated')
    // The cold read only: no agent was started for the check.
    expect(world.agents).toHaveLength(1)
  })

  test('a targeted file dirty at Freeze is signalled; the Workspace starts from the fetched base, not the dirty checkout', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          writeFileSync(join(api, 'invoices.ts'), `${INVOICES}// not committed\n`)
          const { mission } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          yield* launchMission(mission.id, view.id, 'launch_anyway')
          yield* inStage(mission.id, 'building')
          const preparation = yield* preparationOf(mission.id)
          const workspace = yield* getWorkspace(preparation?.workspaceId ?? '')
          return { view, workspace, head: git(api, 'rev-parse', 'HEAD') }
        }),
      ),
    )
    expect(seen.view.moved).toContainEqual(
      expect.objectContaining({
        kind: 'dirty',
        repository: 'api',
        path: 'invoices.ts',
        said: 'invoices.ts had uncommitted changes when the Spec was frozen: the Spec may describe code that is not in the base.',
      }),
    )
    const api = seen.workspace.repositories.find((one) => one.path === 'api')
    expect(api?.base.commit).toBe(seen.head)
    // Git may check the file out with CRLF (Windows): its lines are compared, not its line ends.
    const made = readFileSync(join(api?.worktree ?? '', 'invoices.ts'), 'utf8')
    expect(made.replaceAll('\r\n', '\n')).toBe(INVOICES)
  })

  test('offline, the check takes the last tracking ref and says "not fetched since", without blocking', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          git(api, 'remote', 'set-url', 'origin', join(work, 'nowhere'))
          yield* checkMission(mission.id)
          return yield* checked(mission.id)
        }),
      ),
    )
    const api = seen.bases.find((base) => base.repository === 'api')
    expect(api === undefined ? null : freshnessOf(api)).toBe('NotFetchedSince')
    expect(api?.commit).toBe(api?.frozen)
    expect(seen.steps.find((step) => step.step === 'base')?.said).toMatch(/not fetched since/)
    expect(seen.verdict.actions).toEqual(['launch'])
  })
})

describe('The agent of the check says whether what else changed matters', () => {
  test('a changed lockfile is handed to the prelaunch Planner; a report missing an item is refused; one saying it matters marks the mission outdated', async () => {
    const { run, world } = buildingEngine(
      data,
      work,
      agents(reporting([], [answered('package.json', true)])),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          manifestMoved(bare)
          const started = yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          const sessions = yield* sessionsIn(['ended', 'idle', 'working', 'starting', 'stuck'], {
            kind: 'mission',
            missionId: mission.id,
          })
          return { started, view, sessions, mission: yield* getMission(mission.id) }
        }),
      ),
    )
    expect(seen.started.agent.state).toMatch(/waiting_for_slot|running/)
    expect(seen.started.handed).toEqual([
      {
        repository: 'api',
        path: 'package.json',
        kind: 'manifest',
        status: 'M',
        answer: null,
      },
    ])
    const agent = world.agents[1]
    const brief = text(agent?.answers.prompts[0] ?? [])
    expect(brief).toContain('package.json')
    expect(brief).toContain('"csv": "1.0.0"')
    const answers = agent?.answers.toolAnswers.map((one) => one.text) ?? []
    expect(answers[0]).toContain('Your report misses api/package.json')
    expect(seen.sessions.map((one) => one.role)).toContain('prelaunch')
    expect(seen.view.agent).toMatchObject({ state: 'reported' })
    expect(seen.view.handed[0]?.answer).toEqual({ matters: true, why: 'The export reads it.' })
    expect(seen.view.moved).toContainEqual(
      expect.objectContaining({ kind: 'agent', repository: 'api', path: 'package.json' }),
    )
    expect(seen.view.verdict.actions).toEqual(['launch_anyway', 'back_to_planning'])
    expect(marksOf(seen.mission)).toContain('outdated')
  })

  test('an agent that never reports is reminded once, then the check says it did not answer and lists the files unchecked', async () => {
    const { run } = buildingEngine(data, work, agents(QUIET))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          manifestMoved(bare)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          const database = yield* Database
          const reminders = yield* database
            .select({ body: sessionDeliveries.body })
            .from(sessionDeliveries)
            .where(
              and(
                eq(sessionDeliveries.ownerId, mission.id),
                eq(sessionDeliveries.kind, 'reminder'),
              ),
            )
          return { view, reminders }
        }),
      ),
    )
    expect(seen.reminders).toHaveLength(1)
    expect(seen.view.agent).toMatchObject({
      state: 'unanswered',
      said: 'The agent did not answer: launch anyway or check again',
    })
    expect(seen.view.handed.map((one) => one.answer)).toEqual([null])
    expect(seen.view.verdict.actions).toEqual(['launch_anyway', 'check_again'])
  })

  test('the prelaunch role reads the frozen Spec and has no Spec writing tool; the Planner role holds the prelaunch paragraph', () => {
    expect(ROLES_REGISTERED.map((one) => one.id)).toContain('prelaunch')
    expect(PRELAUNCH_ROLE).toMatchObject({
      ownerKind: 'mission',
      placeKind: 'main-checkout',
      writes: false,
      countsInCap: true,
    })
    expect(PRELAUNCH_ROLE.template).toContain('## Pre-launch check (mode prelaunch)')
    expect(PLANNER_TEMPLATE).toContain(
      'The Spec is frozen. You read; you write nothing in it, and you have no tool that could.',
    )
  })
})

describe('A check holds only for what it read', () => {
  test('a base that moved after the check makes launch refuse, naming it', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          targetMoved(bare)
          const outcome = yield* Effect.result(launchMission(mission.id, view.id, 'launch'))
          return {
            outcome,
            expired: yield* eventsOf(mission.id, 'building.check_expired'),
            mission: yield* getMission(mission.id),
          }
        }),
      ),
    )
    const reasons = refusedWith(seen.outcome)
    expect(reasons?.[0]).toBe('Something moved since the check: check again')
    expect(reasons?.join('\n')).toMatch(/The base of api moved/)
    expect(seen.expired).toHaveLength(1)
    expect(seen.mission.stage).toBe('ready')
  })

  test('a Spec whose version changed after the check makes launch refuse the old check', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission, version } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          // A return to Planning and a new Freeze, as the check sees them: another version.
          const database = yield* Database
          yield* database
            .update(specs)
            .set({ version: version + 2 })
            .where(eq(specs.missionId, mission.id))
          return yield* Effect.result(launchMission(mission.id, view.id, 'launch'))
        }),
      ),
    )
    const reasons = refusedWith(seen)
    expect(reasons?.[0]).toBe('Something moved since the check: check again')
    expect(reasons?.join('\n')).toMatch(/The Spec changed since the check: version 11, now 13/)
  })

  test('a Project change of a catalogue line the proofs use makes launch refuse', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const command = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: commandDraft('test-invoices', 'node --test tests/invoices.test.ts'),
          })
          const { mission } = yield* frozenIn(project.id, main, { command: command.id })
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          yield* saveCommand({
            projectId: project.id,
            id: command.id,
            command: commandDraft(
              'test-invoices',
              'node --test --test-only tests/invoices.test.ts',
            ),
          })
          return yield* Effect.result(launchMission(mission.id, view.id, 'launch'))
        }),
      ),
    )
    const reasons = refusedWith(seen)
    expect(reasons?.[0]).toBe('Something moved since the check: check again')
    expect(reasons?.join('\n')).toMatch(/validation settings/)
  })
})

describe('The launch prepares the Workspace, then moves the mission to Building', () => {
  test('the Workspace is made on the mission’s branch from the base the check read; Ready → Building with building.launched; the validation settings are copied; BuildingStart is called once', async () => {
    const { run, starts } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const command = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: commandDraft('test-invoices', 'node --test tests/invoices.test.ts', {
              lineWindows: 'node --test tests\\invoices.test.ts',
              writeGlobs: ['coverage/**'],
            }),
          })
          const { mission } = yield* frozenIn(project.id, main, { command: command.id })
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          const preparing = yield* launchMission(mission.id, view.id, 'launch')
          yield* inStage(mission.id, 'building')
          const done = yield* preparationOf(mission.id)
          const workspace = yield* getWorkspace(done?.workspaceId ?? '')
          const copy = yield* validationSettingsOf(mission.id)
          // The Project changes afterwards: the mission's copy does not.
          yield* saveCommand({
            projectId: project.id,
            id: command.id,
            command: commandDraft('test-invoices', 'node --test --watch tests/invoices.test.ts'),
          })
          return {
            view,
            preparing,
            done,
            workspace,
            copy,
            after: yield* validationSettingsOf(mission.id),
            launched: yield* eventsOf(mission.id, 'building.launched'),
            ready: yield* eventsOf(mission.id, 'building.workspace_ready'),
            mission: yield* getMission(mission.id),
          }
        }),
      ),
    )
    expect(seen.preparing.state).toBe('preparing')
    expect(seen.done?.state).toBe('launched')
    expect(seen.workspace.name).toBe('acme-1-invoices-as-csv')
    expect(seen.workspace.branch).toBe('acme/acme-1-invoices-as-csv')
    expect(seen.workspace.repositories.map((one) => one.path)).toEqual(['api'])
    expect(seen.workspace.repositories[0]?.base.commit).toBe(seen.view.bases[0]?.commit)
    expect(seen.mission.stage).toBe('building')
    expect(seen.launched).toHaveLength(1)
    expect(JSON.parse(seen.launched[0]?.payload ?? '{}')).toMatchObject({
      workspaceId: seen.workspace.id,
      branches: ['acme/acme-1-invoices-as-csv'],
    })
    expect(seen.ready).toHaveLength(1)
    expect(starts.missions).toEqual([seen.mission.id])
    expect(seen.copy?.version).toBe(1)
    expect(seen.copy?.sections['catalogue']).toEqual([
      {
        id: expect.any(String),
        name: 'test-invoices',
        line: 'node --test tests/invoices.test.ts',
        lineWindows: 'node --test tests\\invoices.test.ts',
        lineLinux: null,
        writeGlobs: ['coverage/**'],
      },
    ])
    expect(seen.copy?.sections['commits']).toBe('Hemera does not commit during Building')
    // The safety rules are never copied: they always apply in their current version.
    expect(Object.keys(seen.copy?.sections ?? {}).sort()).toEqual([
      'catalogue',
      'commits',
      'resources',
    ])
    expect(seen.after).toEqual(seen.copy)
  })

  test('a second launch while one is under way, or once the mission builds, is refused', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          const [one, other] = yield* Effect.all(
            [
              Effect.result(launchMission(mission.id, view.id, 'launch')),
              Effect.result(launchMission(mission.id, view.id, 'launch')),
            ],
            { concurrency: 'unbounded' },
          )
          yield* inStage(mission.id, 'building')
          const again = yield* Effect.result(launchMission(mission.id, view.id, 'launch'))
          return { one, other, again }
        }),
      ),
    )
    expect([seen.one, seen.other].filter(Result.isSuccess)).toHaveLength(1)
    expect([seen.one, seen.other].map(refusedWith).find((one) => one !== null)?.[0]).toMatch(
      /already being launched/,
    )
    expect(refusedWith(seen.again)?.[0]).toMatch(/Building/)
  })

  test('a failed preparation step is an environment need with Retry; Retry resumes and the mission moves to Building', async () => {
    const { run, starts } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acme()
          const fresh = yield* getProject(project.id)
          const apiId = fresh.repositories.find((one) => one.path === 'api')?.id ?? null
          // The recipe copies `.env`, which is gone by the launch: its step fails.
          writeFileSync(join(api, '.env'), 'TOKEN=local\n')
          yield* saveRecipe({
            projectId: project.id,
            version: fresh.version,
            steps: [
              { kind: 'copy', repositoryId: apiId, path: '.env', commandId: null, line: null },
            ],
          })
          rmSync(join(api, '.env'))
          const { mission } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          yield* launchMission(mission.id, view.id, 'launch')
          yield* until(Effect.map(preparationOf(mission.id), (one) => one?.state === 'failed'))
          const failed = yield* preparationOf(mission.id)
          const need = yield* getNeed(failed?.needId ?? '')
          const stayed = yield* getMission(mission.id)
          writeFileSync(join(api, '.env'), 'TOKEN=local\n')
          yield* retryNeed(need.id)
          yield* inStage(mission.id, 'building')
          return {
            failed,
            need,
            stayed,
            after: yield* getNeed(need.id),
            workspaceFailed: yield* eventsOf(mission.id, 'building.workspace_failed'),
            launched: yield* eventsOf(mission.id, 'building.launched'),
          }
        }),
      ),
    )
    const { fields } = seen.need
    expect(Predicate.isTagged(fields, 'Environment')).toBe(true)
    const environment = Predicate.isTagged(fields, 'Environment') ? fields : null
    expect(environment?.missing).toMatch(/Step 2 of 2 failed/)
    expect(environment?.action).toMatch(/Retry/)
    // What is left on disk is said: the worktree made before the step that failed.
    expect(environment?.missing).toMatch(/Left as made: the worktree of api/)
    expect(seen.stayed.stage).toBe('ready')
    expect(seen.failed?.now).toBe('Preparation failed: step 2 of 2')
    expect(seen.workspaceFailed).toHaveLength(1)
    expect(seen.after.state).toBe('withdrawn')
    expect(seen.launched).toHaveLength(1)
    expect(starts.missions).toHaveLength(1)
  })

  test('a restart in the middle of the preparation resumes it, and the mission starts once', async () => {
    const recipeHeld = join(work, 'held')
    const first = buildingEngine(data, work, agents())
    const ids = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const fresh = yield* getProject(project.id)
          const apiId = fresh.repositories.find((one) => one.path === 'api')?.id ?? null
          // A step that waits until the test lets it go: the engine stops while it runs.
          writeFileSync(
            join(work, 'wait.mjs'),
            `import { existsSync } from 'node:fs'\nconst wait = () => existsSync(${JSON.stringify(recipeHeld)}) ? process.exit(0) : setTimeout(wait, 20)\nwait()\n`,
          )
          yield* saveRecipe({
            projectId: project.id,
            version: fresh.version,
            steps: [
              {
                kind: 'run',
                repositoryId: apiId,
                path: null,
                commandId: null,
                line: `node ${join(work, 'wait.mjs')}`,
              },
            ],
          })
          const { mission } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          yield* launchMission(mission.id, view.id, 'launch')
          yield* until(
            Effect.map(preparationOf(mission.id), (one) =>
              (one?.steps ?? []).some((step) => step.kind === 'run' && step.state === 'running'),
            ),
          )
          return { missionId: mission.id }
        }),
      ),
    )
    writeFileSync(recipeHeld, '')
    const second = buildingEngine(data, work, agents(), first.starts)
    const seen = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* inStage(ids.missionId, 'building')
          return {
            launched: yield* eventsOf(ids.missionId, 'building.launched'),
            mission: yield* getMission(ids.missionId),
          }
        }),
      ),
    )
    expect(seen.mission.stage).toBe('building')
    expect(seen.launched).toHaveLength(1)
    expect(first.starts.missions).toEqual([ids.missionId])
  })

  test('two notification kinds tell how the preparation ended', () => {
    const kinds = REGISTRY.kinds.map((one) => [one.id, one.byDefault])
    expect(kinds).toContainEqual(['workspace-prepared', true])
    expect(kinds).toContainEqual(['workspace-preparation-failed', true])
  })
})

describe('Dependencies, the model, and the return to Planning', () => {
  test('launch while a dependency is not Done is refused; when it reaches Done the mechanical check runs at once and marks the mission outdated when its merge touched a targeted file', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acme()
          const two = yield* plannedIn(project.id, main, 'Totals on invoices')
          const one = yield* plannedIn(project.id, main)
          yield* call(one.grantId, 'dependency_propose', {
            mission: 'ACME-1',
            reason: 'It exports the totals ACME-1 adds.',
          })
          const [dependency] = (yield* dependenciesOf(one.mission.id)).dependsOn
          yield* decideDependency(dependency?.id ?? '', true)
          yield* plannerTook(one.mission.id)
          yield* call(one.grantId, 'input_integrated', { id: 'I1', where: 'decisions' })
          yield* settledAndFrozen(one.mission.id, one.grantId)
          yield* checkMission(one.mission.id)
          const blocked = yield* checked(one.mission.id)
          const refused = yield* Effect.result(launchMission(one.mission.id, blocked.id, 'launch'))
          // ACME-1 is built and delivered: its merge changed the file ACME-2's task targets.
          yield* moveMission(two.mission.id, 'freeze', 'user')
          yield* moveMission(two.mission.id, 'launch', 'user')
          yield* moveMission(two.mission.id, 'endBuilding', 'hemera')
          yield* moveMission(two.mission.id, 'ship', 'user')
          targetMoved(bare)
          yield* moveMission(two.mission.id, 'complete', 'hemera')
          yield* until(
            Effect.map(
              latestCheckOf(one.mission.id),
              (view) => view !== null && view.kind === 'mechanical' && view.state === 'done',
            ),
          )
          return {
            blocked,
            refused,
            mechanical: yield* latestCheckOf(one.mission.id),
            mission: yield* getMission(one.mission.id),
          }
        }),
      ),
    )
    expect(seen.blocked.verdict).toMatchObject({
      blockedBy: ['ACME-1'],
      actions: ['back_to_planning'],
    })
    expect(seen.blocked.verdict.said).toContain('blocked by ACME-1')
    expect(refusedWith(seen.refused)?.join(' ')).toContain('blocked by ACME-1')
    expect(seen.mechanical?.agent.state).toBe('skipped')
    expect(seen.mechanical?.moved).toContainEqual(
      expect.objectContaining({ kind: 'target', path: 'invoices.ts' }),
    )
    expect(seen.mechanical?.verdict.actions).toEqual([])
    expect(marksOf(seen.mission)).toContain('outdated')
  })

  test('a model override is stored at the mission level, beside the Planner’s recommendation', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          yield* checkMission(mission.id)
          const before = (yield* checked(mission.id)).model
          const chosen = yield* chooseBuilderModel(mission.id, {
            agent: 'codex',
            model: 'gpt-large',
            effort: 'high',
          })
          return {
            before,
            chosen,
            stored: yield* roleSettingAt('mission', mission.id, 'builder'),
            events: yield* eventsOf(mission.id, 'building.model_chosen'),
          }
        }),
      ),
    )
    expect(seen.before.recommendation).toEqual({
      agent: 'codex',
      model: 'gpt-large',
      effort: null,
      reason: 'A small change.',
    })
    expect(seen.before.level).toBe('app')
    expect(seen.chosen).toMatchObject({ level: 'mission', setting: { model: 'gpt-large' } })
    expect(seen.stored).toEqual({ agent: 'codex', model: 'gpt-large', effort: 'high' })
    expect(seen.events).toHaveLength(1)
  })

  test('Back to Planning hands the check’s report to the Planner as the reason', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acme()
          const { mission } = yield* frozenIn(project.id, main)
          targetMoved(bare)
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          const back = yield* backToPlanningFromCheck(mission.id, view.id)
          const database = yield* Database
          const updates = yield* database
            .select({ body: sessionDeliveries.body })
            .from(sessionDeliveries)
            .where(
              and(eq(sessionDeliveries.ownerId, mission.id), eq(sessionDeliveries.kind, 'update')),
            )
          return { back, updates }
        }),
      ),
    )
    expect(seen.back.stage).toBe('planning')
    expect(seen.updates.at(-1)?.body).toContain('invoices.ts')
  })
})
