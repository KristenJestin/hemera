/**
 * The documenter (#146): a fixed phase of Hemera at the end of a Building, a child of the mission
 * that writes only the files the mission's doc recipes name, attributed to the `end` attempt named
 * "documentation"; its report, or the reason nothing changed, kept as evidence and journalled; its
 * wait for a slot of the cap; its failure when it gives no report; the delta pass and the limit of
 * two passes.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent and the test driving the
 * Builder's and the documenter's tools through their grants; Acme's real repositories in temporary
 * folders as the Workspace; every call the local rules leave open is allowed. The documenter's
 * turns are held open unless a test wants it silent.
 */

import { realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_BASE_BRANCH,
  type DocRecipeDraft,
  ROOT_REPOSITORY,
  SESSION_STATES,
} from '@hemera/core/domain'
import { Effect, Fiber, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { setProjectLimits, projectLimits } from '../src/engine/budget.ts'
import { Documenter, type DocumenterMode } from '../src/engine/building/documenter.ts'
import {
  acceptDocRecipes,
  listDocRecipes,
  removeDocRecipe,
  saveDocRecipe,
} from '../src/engine/doc-recipes.ts'
import { listEvidence, readEvidence } from '../src/engine/memory/evidence.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { type RoleSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { createProject } from '../src/engine/projects.ts'
import { INVOICES, QUIET, READING, call, eventsOf, grantOf } from './building-world.ts'
import { PLAN, builderOf, buildingNow, launched } from './builder-world.ts'
import { git, repository } from './repositories.ts'
import { held, sessionsEngine, text, until, within } from './sessions-world.ts'
import { ALLOW, callTool, verdictsSaying } from './tools-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('documenter'))
  work = realpathSync.native(temporaryFolder('documenter-work'))
})
afterEach(removeFolders)

/**
 * The engine with this version's roles: the cold read first, then the Builder, quiet; every agent
 * after them (the documenter, the sessions a test fills the cap with) holds its turn open until
 * the test lets it go, or ends it at once when `quiet`.
 */
const documenting = (quiet = false) => {
  const hold = held()
  const working: FakeScript = quiet
    ? QUIET
    : { steps: [{ does: 'says', text: 'Working.' }], between: () => hold.promise }
  const first: ReadonlyArray<FakeScript> = [READING, QUIET]
  const engine = sessionsEngine(data, (index) => first[index] ?? working, {
    roles: [],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
  })
  return {
    world: engine.world,
    release: hold.release,
    run: <A, E>(program: Parameters<typeof engine.run<A, E>>[0]) =>
      engine.run(program).finally(hold.release),
  }
}

const README: DocRecipeDraft = {
  repository: 'api',
  path: 'README.md',
  purpose: 'What the api is, and how to export the invoices.',
  applies: 'always',
  words: [],
}

const CONTRACT: DocRecipeDraft = {
  repository: 'api',
  path: 'openapi.yaml',
  purpose: 'The HTTP API contract of the api.',
  applies: 'when_impact_names',
  words: ['API'],
}

/** A launch whose Project keeps these recipes. */
const withRecipes =
  (...recipes: ReadonlyArray<DocRecipeDraft>) =>
  (projectId: string) =>
    Effect.asVoid(acceptDocRecipes(projectId, recipes))

/** The Builder runs T1 (changes invoices.ts) and T2 (creates export.ts) to their end. */
const built = (grantId: string) =>
  Effect.gen(function* () {
    yield* call(grantId, 'task_start', { task: 'T1' })
    yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
    yield* call(grantId, 'fs_write', {
      repository: 'api',
      path: 'invoices.ts',
      content: 'export const invoices = ["csv"]\n',
    })
    yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
    yield* call(grantId, 'task_start', { task: 'T2' })
    yield* call(grantId, 'fs_write', {
      repository: 'api',
      path: 'export.ts',
      content: 'export const markdown = true\n',
    })
    yield* call(grantId, 'task_finished', { task: 'T2', summary: 'Markdown.' })
  })

/** A pass of the documenter, in the background; its fiber answers its outcome. */
const pass = (buildingId: string, mode: DocumenterMode) =>
  Effect.forkChild(
    Documenter.use((documenter) => documenter.run(buildingId, mode)).pipe(Effect.result),
  )

/** The prompts each agent was sent, as text. */
type Agents = ReadonlyArray<{
  answers: { prompts: ReadonlyArray<ReadonlyArray<{ type: string; text?: string }>> }
}>

/** The `count`-th documenter's session once its agent read its brief, and a grant to drive it. */
const documenterOf = (world: { readonly agents: Agents }, missionId: string, count: number) =>
  Effect.gen(function* () {
    const briefs = () =>
      world.agents
        .map((agent) => text(agent.answers.prompts[0] ?? []))
        .filter((brief) => brief.includes('## Documenter · '))
    yield* until(Effect.sync(() => briefs().length >= count))
    // A pass that reported keeps its session until its held turn ends: the newest is this pass's.
    const opened = Effect.map(sessionsIn(SESSION_STATES, { kind: 'mission', missionId }), (rows) =>
      rows.filter((row) => row.role === 'documenter'),
    )
    yield* until(Effect.map(opened, (rows) => rows.length >= count))
    const session = (yield* opened)[count - 1]
    if (session === undefined) return yield* Effect.die(new Error('no documenter'))
    return { session, brief: briefs()[count - 1] ?? '', grantId: yield* grantOf(session.id) }
  })

const REASON = 'The export is internal: no reader of the README calls it.'

describe('A full pass of the documenter', () => {
  test('full: the brief lists the Building’s changed files and the recipes; a write to export.ts is refused by the guard; a write to README.md is accepted and appears in the Building’s diff, attributed to "documentation"', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(README))
          const builder = yield* builderOf(mission.id)
          yield* built(builder.grantId)
          const building = yield* buildingNow(mission.id)
          const fiber = yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          const code = yield* callTool(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'export.ts',
            content: 'export const markdown = false\n',
          })
          yield* call(documenter.grantId, 'fs_read', { repository: 'api', path: 'README.md' })
          const docs = yield* callTool(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'README.md',
            content: 'Acme api\n\nExport the invoices as CSV or Markdown.\n',
          })
          const report = yield* callTool(documenter.grantId, 'docs_report', {
            changed: [{ repository: 'api', path: 'README.md', why: 'The exports are new.' }],
          })
          const outcome = yield* Fiber.join(fiber)
          return {
            mission,
            documenter,
            code,
            docs,
            report,
            outcome,
            view: yield* buildingNow(mission.id),
            started: yield* eventsOf(mission.id, 'building.documenter_started'),
            documented: yield* eventsOf(mission.id, 'building.documented'),
          }
        }),
      ),
    )
    expect(seen.documenter.session).toMatchObject({ role: 'documenter', parent: null })
    expect(seen.documenter.session.folder).toBe(
      seen.view.repositories[0]?.folder.replace(/[\\/]api$/, ''),
    )
    const brief = seen.documenter.brief
    expect(brief).toContain(`Documenter · ${seen.mission.key} · Building · full`)
    expect(brief).toContain('- api/invoices.ts (M)')
    expect(brief).toContain('- api/export.ts (A)')
    expect(brief).toContain('- api: README.md: What the api is, and how to export the invoices.')
    expect(brief).toContain('spec_read (frozen)')
    expect(seen.code.ok).toBe(false)
    expect(seen.code.text).toContain(
      'api/export.ts is not documentation named by this Project’s doc recipes.',
    )
    expect(seen.docs.ok).toBe(true)
    expect(seen.report.ok).toBe(true)
    expect(Result.isSuccess(seen.outcome)).toBe(true)
    expect(Result.isSuccess(seen.outcome) ? seen.outcome.success : null).toEqual({
      outcome: 'documented',
      changed: [{ repository: 'api', path: 'README.md', why: 'The exports are new.' }],
    })
    const documentation = seen.view.scopes.find((one) => one.subject === 'documentation')
    expect(documentation).toMatchObject({ scope: 'end', outcome: 'documented' })
    expect(documentation?.files.map((one) => `${one.repository}/${one.path}`)).toEqual([
      'api/README.md',
    ])
    expect(seen.view.documenter).toEqual([
      expect.objectContaining({
        number: 1,
        mode: 'full',
        state: 'reported',
        changed: [{ repository: 'api', path: 'README.md', why: 'The exports are new.' }],
        noChangeReason: null,
        attemptId: documentation?.id,
      }),
    ])
    expect(seen.started.map((one) => JSON.parse(one.payload))).toEqual([
      expect.objectContaining({ mode: 'full', pass: 1 }),
    ])
    expect(seen.documented).toHaveLength(1)
  })

  test('a listed file that did not change is refused', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(README))
          const builder = yield* builderOf(mission.id)
          yield* built(builder.grantId)
          const building = yield* buildingNow(mission.id)
          yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          return yield* callTool(documenter.grantId, 'docs_report', {
            changed: [{ repository: 'api', path: 'README.md', why: 'The exports are new.' }],
          })
        }),
      ),
    )
    expect(seen.ok).toBe(false)
    expect(seen.text).toContain('refused: api/README.md did not change in this pass')
  })
})

describe('"No change" is accepted only with a reason specific to this change', () => {
  test('docs_report with no change and no reason, a five-character reason, or "nothing to document" is refused; with a real reason it is stored, journalled and readable as evidence', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(README))
          const builder = yield* builderOf(mission.id)
          yield* built(builder.grantId)
          const building = yield* buildingNow(mission.id)
          const fiber = yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          const report = (args: Parameters<typeof callTool>[2]) =>
            callTool(documenter.grantId, 'docs_report', args)
          const refused = [
            yield* report({ changed: [] }),
            yield* report({ changed: [], no_change_reason: 'fine.' }),
            yield* report({ changed: [], no_change_reason: 'Nothing to document.' }),
          ]
          const kept = yield* report({ changed: [], no_change_reason: REASON })
          const outcome = yield* Fiber.join(fiber)
          const view = yield* buildingNow(mission.id)
          const evidenceId = view.documenter[0]?.evidenceId ?? ''
          const journalled = Memory.use((memory) => memory.journal(mission.id, null))
          // The Journal is a projection of the committed events: it follows them, a moment later.
          yield* until(Effect.map(journalled, (page) => JSON.stringify(page).includes(REASON)))
          const journal = yield* journalled
          return {
            refused,
            kept,
            outcome,
            view,
            evidence: yield* listEvidence(mission.id, null),
            read: yield* readEvidence(mission.id, evidenceId),
            journal,
            noChange: yield* eventsOf(mission.id, 'building.no_doc_change'),
          }
        }),
      ),
    )
    expect(seen.refused.map((one) => [one.ok, one.text])).toEqual([
      [
        false,
        'refused: Name the files you changed, or say why this change needs no documentation: the user sees your reason.',
      ],
      [
        false,
        'refused: Say why this change needs no documentation, specifically: 20 characters at least.',
      ],
      [
        false,
        'refused: “Nothing to document.” says nothing about this change: say why it needs no documentation.',
      ],
    ])
    expect(seen.kept.ok).toBe(true)
    expect(Result.isSuccess(seen.outcome) ? seen.outcome.success : null).toEqual({
      outcome: 'no_change',
      reason: REASON,
    })
    expect(seen.view.documenter[0]).toMatchObject({ state: 'reported', noChangeReason: REASON })
    expect(seen.noChange.map((one) => JSON.parse(one.payload).reason)).toEqual([REASON])
    expect(JSON.stringify(seen.journal)).toContain(REASON)
    expect(seen.evidence.map((one) => one.name)).toContain('Documentation, pass 1')
    expect(new TextDecoder().decode(seen.read.bytes)).toContain(REASON)
  })
})

describe('The documenter waits for a slot of the cap', () => {
  test('with three sub-agents running, the phase waits, Now says so, and it starts when a slot frees', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work, withRecipes(README))
          const builder = yield* builderOf(mission.id)
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { ...limits, cap: 3 })
          const owner = { kind: 'mission' as const, missionId: mission.id }
          const helpers: RoleSession[] = []
          for (const _ of [1, 2, 3]) {
            helpers.push(
              yield* Sessions.use((sessions) =>
                sessions.open({
                  owner,
                  role: 'helper',
                  folder: builder.session.folder,
                  requestedBy: 'agent',
                }),
              ),
            )
          }
          yield* until(Effect.sync(() => world.agents.length === 5))
          const building = yield* buildingNow(mission.id)
          yield* pass(building.buildingId, { kind: 'full' })
          const now = Memory.use((memory) => memory.now(mission.id))
          yield* until(Effect.map(now, (state) => state.slotWait !== null))
          const waiting = yield* now
          const waitingView = yield* buildingNow(mission.id)
          const startedBefore = world.agents.length
          yield* Sessions.use((sessions) => sessions.end(helpers[0]?.lineage ?? '', 'done'))
          const documenter = yield* documenterOf(world, mission.id, 1)
          return {
            waiting,
            waitingView,
            startedBefore,
            documenter,
            after: yield* now,
            waited: yield* eventsOf(mission.id, 'building.documenter_waiting'),
            started: yield* eventsOf(mission.id, 'building.documenter_started'),
          }
        }),
      ),
    )
    expect(seen.waiting.slotWait).toBe('Documentation waits for a free agent slot (3 of 3 in use)')
    expect(seen.waitingView.documenter[0]).toMatchObject({ state: 'waiting_for_slot' })
    expect(seen.startedBefore).toBe(5)
    expect(seen.waited).toHaveLength(1)
    expect(seen.started).toHaveLength(1)
    expect(seen.documenter.session.role).toBe('documenter')
    expect(seen.after.slotWait).toBeNull()
  })
})

describe('A documenter that gives no report fails its pass', () => {
  test('a documenter silent twice fails the pass and the failure is reported to the caller', async () => {
    const { world, run } = documenting(true)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(README))
          const building = yield* buildingNow(mission.id)
          const outcome = yield* Fiber.join(yield* pass(building.buildingId, { kind: 'full' }))
          return {
            outcome,
            view: yield* buildingNow(mission.id),
            failed: yield* eventsOf(mission.id, 'building.documenter_failed'),
            prompts: world.agents.at(-1)?.answers.prompts.map((one) => text(one)) ?? [],
          }
        }),
      ),
    )
    expect(Result.isSuccess(seen.outcome) ? seen.outcome.success : null).toEqual({
      outcome: 'failed',
      why: 'the documenter gave no report',
    })
    expect(seen.prompts).toHaveLength(2)
    expect(seen.prompts[1]).toContain('End with docs_report')
    expect(seen.view.documenter[0]).toMatchObject({
      state: 'failed',
      failure: 'the documenter gave no report',
    })
    expect(seen.failed.map((one) => JSON.parse(one.payload).why)).toEqual([
      'the documenter gave no report',
    ])
  })
})

describe('The delta pass and the limit of two passes', () => {
  test('deltaNeeded lists only files outside the recipes; a delta pass sees only them; a third pass is refused', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(README))
          const builder = yield* builderOf(mission.id)
          yield* built(builder.grantId)
          const building = yield* buildingNow(mission.id)
          const documenter = Documenter.use((one) => Effect.succeed(one))
          const before = yield* Effect.flatMap(documenter, (one) =>
            one.deltaNeeded(building.buildingId),
          )
          const full = yield* pass(building.buildingId, { kind: 'full' })
          const first = yield* documenterOf(world, mission.id, 1)
          yield* callTool(first.grantId, 'docs_report', { changed: [], no_change_reason: REASON })
          yield* Fiber.join(full)
          // What follows the first pass: T4 changes invoices.ts, and the README beside it.
          yield* call(builder.grantId, 'task_start', { task: 'T4' })
          yield* call(builder.grantId, 'fs_write', {
            repository: 'api',
            path: 'invoices.ts',
            content: 'export const invoices = ["csv", "named"]\n',
          })
          yield* call(builder.grantId, 'fs_read', { repository: 'api', path: 'README.md' })
          yield* call(builder.grantId, 'fs_write', {
            repository: 'api',
            path: 'README.md',
            content: 'Acme api, named invoices\n',
          })
          yield* call(builder.grantId, 'task_finished', { task: 'T4', summary: 'Named.' })
          const needed = yield* Effect.flatMap(documenter, (one) =>
            one.deltaNeeded(building.buildingId),
          )
          const delta = yield* pass(building.buildingId, { kind: 'delta', files: needed })
          const second = yield* documenterOf(world, mission.id, 2)
          yield* callTool(second.grantId, 'docs_report', { changed: [], no_change_reason: REASON })
          yield* Fiber.join(delta)
          const third = yield* Fiber.join(yield* pass(building.buildingId, { kind: 'full' }))
          return {
            before,
            needed,
            brief: second.brief,
            third,
            view: yield* buildingNow(mission.id),
          }
        }),
      ),
    )
    expect(seen.before).toEqual([])
    expect(seen.needed).toEqual([{ repository: 'api', path: 'invoices.ts' }])
    expect(seen.brief).toContain('· delta')
    expect(seen.brief).toContain('Changed by the special tasks')
    expect(seen.brief).toContain('- api/invoices.ts (M)')
    expect(seen.brief).not.toContain('api/export.ts')
    expect(Result.isFailure(seen.third)).toBe(true)
    expect(Result.isFailure(seen.third) ? seen.third.failure.message : '').toBe(
      'the documenter already ran twice in this Building',
    )
    expect(seen.view.documenter.map((one) => [one.number, one.mode, one.state])).toEqual([
      [1, 'full', 'reported'],
      [2, 'delta', 'reported'],
    ])
  })
})

describe('The recipes the documenter reads', () => {
  test('a recipe when_impact_names: API applies when the Impact says "API": the brief names it and its file may be written', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            withRecipes(README, CONTRACT),
            'The public API of the invoices changes.',
          )
          const building = yield* buildingNow(mission.id)
          yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          const write = yield* callTool(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'openapi.yaml',
            content: 'openapi: 3.1.0\n',
          })
          return { brief: documenter.brief, write }
        }),
      ),
    )
    expect(seen.brief).toContain('- api: openapi.yaml: The HTTP API contract of the api.')
    expect(seen.write.ok).toBe(true)
  })

  test('a recipe change after launch does not change the mission’s copy; a recipe when_impact_names: API does not apply when the Impact does not say it', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work, withRecipes(README, CONTRACT))
          // After the launch, the Project's recipes change: the README's goes, a docs folder comes.
          for (const one of yield* listDocRecipes(project.id)) {
            if (one.path === 'README.md') yield* removeDocRecipe(project.id, one.id)
          }
          yield* saveDocRecipe(project.id, null, {
            ...README,
            path: 'docs/**/*.md',
            purpose: 'The guides of the api.',
          })
          const building = yield* buildingNow(mission.id)
          yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          yield* call(documenter.grantId, 'fs_read', { repository: 'api', path: 'README.md' })
          const readmeWrite = yield* callTool(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'README.md',
            content: 'Acme api\n',
          })
          const docsWrite = yield* callTool(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'docs/guide.md',
            content: 'A guide\n',
          })
          const contractWrite = yield* callTool(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'openapi.yaml',
            content: 'openapi: 3.1.0\n',
          })
          return { brief: documenter.brief, readmeWrite, docsWrite, contractWrite }
        }),
      ),
    )
    expect(seen.brief).toContain(
      '- api: README.md: What the api is, and how to export the invoices.',
    )
    expect(seen.brief).not.toContain('docs/**/*.md')
    expect(seen.brief).not.toContain('openapi.yaml')
    expect(seen.readmeWrite.ok).toBe(true)
    expect(seen.docsWrite.ok).toBe(false)
    expect(seen.contractWrite.ok).toBe(false)
  })
})

/** A Project of one repository at the root of its main checkout, as Acme's api is. */
const soloAt = (at: string) =>
  Effect.gen(function* () {
    const main = repository(join(at, 'solo'), DEFAULT_BASE_BRANCH)
    writeFileSync(join(main, 'invoices.ts'), INVOICES)
    writeFileSync(join(main, 'README.md'), 'Solo\n')
    git(main, 'add', '.')
    git(main, 'commit', '-q', '-m', 'invoices')
    const project = yield* createProject({
      name: 'solo',
      mainCheckout: main,
      repositories: [ROOT_REPOSITORY],
    })
    return { project, main }
  })

/** The plan, its targets in the root repository. */
const SOLO_PLAN = PLAN.map((task) =>
  Object.assign({}, task, {
    targets: task.targets.map((target) =>
      Object.assign({}, target, { repository: ROOT_REPOSITORY }),
    ),
  }),
)

/** The README of the Workspace root. */
const ROOT_README: DocRecipeDraft = { ...README, repository: ROOT_REPOSITORY }

describe('Where the documenter may write', () => {
  test('a Workspace reached through a symlinked parent: a write to a file no recipe names is refused, a recipe file accepted', async () => {
    const real = data
    data = join(temporaryFolder('documenter-link'), 'profile')
    symlinkSync(real, data, 'junction')
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(README))
          const building = yield* buildingNow(mission.id)
          yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          const code = yield* callTool(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'export.ts',
            content: 'export const markdown = false\n',
          })
          yield* call(documenter.grantId, 'fs_read', { repository: 'api', path: 'README.md' })
          const docs = yield* callTool(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'README.md',
            content: 'Acme api\n\nExport the invoices.\n',
          })
          return { folder: documenter.session.folder, code, docs }
        }),
      ),
    )
    expect(seen.folder.startsWith(data)).toBe(true)
    expect(seen.code.ok).toBe(false)
    expect(seen.code.text).toContain('is not documentation named by this Project’s doc recipes.')
    expect(seen.docs.ok).toBe(true)
  })

  test('a single-repository Project: README.md is written and reported', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            withRecipes(ROOT_README),
            'The impact.',
            SOLO_PLAN,
            soloAt,
          )
          const building = yield* buildingNow(mission.id)
          const fiber = yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          yield* call(documenter.grantId, 'fs_read', { path: 'README.md' })
          const docs = yield* callTool(documenter.grantId, 'fs_write', {
            path: 'README.md',
            content: 'Solo\n\nExport the invoices.\n',
          })
          const report = yield* callTool(documenter.grantId, 'docs_report', {
            changed: [{ repository: ROOT_REPOSITORY, path: 'README.md', why: 'The exports.' }],
          })
          return { brief: documenter.brief, docs, report, outcome: yield* Fiber.join(fiber) }
        }),
      ),
    )
    expect(seen.brief).toContain('- the Workspace root: README.md: ')
    expect(seen.docs.ok).toBe(true)
    expect(seen.report.ok).toBe(true)
    expect(Result.isSuccess(seen.outcome) ? seen.outcome.success : null).toEqual({
      outcome: 'documented',
      changed: [{ repository: ROOT_REPOSITORY, path: 'README.md', why: 'The exports.' }],
    })
  })

  test('a root recipe in a Workspace of several repositories: its file is written and reported', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(ROOT_README))
          const building = yield* buildingNow(mission.id)
          const fiber = yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          const code = yield* callTool(documenter.grantId, 'fs_write', {
            path: 'NOTES.md',
            content: 'Notes\n',
          })
          const docs = yield* callTool(documenter.grantId, 'fs_write', {
            path: 'README.md',
            content: 'Acme\n\nThe api exports the invoices.\n',
          })
          const report = yield* callTool(documenter.grantId, 'docs_report', {
            changed: [{ repository: ROOT_REPOSITORY, path: 'README.md', why: 'The exports.' }],
          })
          return { code, docs, report, outcome: yield* Fiber.join(fiber) }
        }),
      ),
    )
    expect(seen.code.ok).toBe(false)
    expect(seen.docs.ok).toBe(true)
    expect(seen.report.ok).toBe(true)
    expect(Result.isSuccess(seen.outcome) ? seen.outcome.success : null).toEqual({
      outcome: 'documented',
      changed: [{ repository: ROOT_REPOSITORY, path: 'README.md', why: 'The exports.' }],
    })
  })

  test('a write after the report is refused', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(README))
          const building = yield* buildingNow(mission.id)
          yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          yield* call(documenter.grantId, 'docs_report', { changed: [], no_change_reason: REASON })
          yield* call(documenter.grantId, 'fs_read', { repository: 'api', path: 'README.md' })
          return yield* callTool(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'README.md',
            content: 'Acme api, later\n',
          })
        }),
      ),
    )
    expect(seen.ok).toBe(false)
    expect(seen.text).toContain('your pass has ended')
  })
})

describe('The report names what the pass changed', () => {
  test('a no-change report is refused when the pass changed files; a file listed twice is kept once', async () => {
    const { world, run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(README))
          const building = yield* buildingNow(mission.id)
          const fiber = yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(world, mission.id, 1)
          yield* call(documenter.grantId, 'fs_read', { repository: 'api', path: 'README.md' })
          yield* call(documenter.grantId, 'fs_write', {
            repository: 'api',
            path: 'README.md',
            content: 'Acme api\n\nExport the invoices.\n',
          })
          const nothing = yield* callTool(documenter.grantId, 'docs_report', {
            changed: [],
            no_change_reason: REASON,
          })
          const twice = yield* callTool(documenter.grantId, 'docs_report', {
            changed: [
              { repository: 'api', path: 'README.md', why: 'The exports are new.' },
              { repository: 'api', path: 'README.md', why: 'Said again.' },
            ],
          })
          return { nothing, twice, outcome: yield* Fiber.join(fiber) }
        }),
      ),
    )
    expect(seen.nothing.ok).toBe(false)
    expect(seen.nothing.text).toContain('api/README.md changed in this pass')
    expect(seen.twice.ok).toBe(true)
    expect(Result.isSuccess(seen.outcome) ? seen.outcome.success : null).toEqual({
      outcome: 'documented',
      changed: [{ repository: 'api', path: 'README.md', why: 'The exports are new.' }],
    })
  })
})

describe('A pass whose caller or engine stops', () => {
  test('a caller that stops waiting while the pass waits for a slot fails the pass, and it leaves the queue', async () => {
    const { run } = documenting()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work, withRecipes(README))
          const builder = yield* builderOf(mission.id)
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { ...limits, cap: 1 })
          yield* Sessions.use((sessions) =>
            sessions.open({
              owner: { kind: 'mission', missionId: mission.id },
              role: 'helper',
              folder: builder.session.folder,
              requestedBy: 'agent',
            }),
          )
          const building = yield* buildingNow(mission.id)
          const fiber = yield* pass(building.buildingId, { kind: 'full' })
          const now = Memory.use((memory) => memory.now(mission.id))
          yield* until(Effect.map(now, (state) => state.slotWait !== null))
          yield* Fiber.interrupt(fiber)
          return { after: yield* now, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.after.slotWait).toBeNull()
    expect(seen.view.documenter[0]).toMatchObject({
      state: 'failed',
      failure: 'its caller stopped waiting',
    })
  })

  test('a pass running when Hemera stopped fails at the next start, and its session ends', async () => {
    const first = documenting()
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withRecipes(README))
          const building = yield* buildingNow(mission.id)
          yield* pass(building.buildingId, { kind: 'full' })
          const documenter = yield* documenterOf(first.world, mission.id, 1)
          return { missionId: mission.id, lineage: documenter.session.lineage }
        }),
      ),
    )
    const seen = await documenting().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const failed = Effect.map(
            buildingNow(before.missionId),
            (view) => view.documenter[0]?.state === 'failed',
          )
          yield* until(failed)
          const live = Effect.map(
            sessionsIn(['starting', 'working', 'idle', 'stuck'], {
              kind: 'mission',
              missionId: before.missionId,
            }),
            (rows) => rows.some((row) => row.lineage === before.lineage),
          )
          yield* until(Effect.map(live, (still) => !still))
          return { view: yield* buildingNow(before.missionId), live: yield* live }
        }),
      ),
    )
    expect(seen.view.documenter[0]).toMatchObject({
      state: 'failed',
      failure: 'Hemera stopped during the pass',
    })
    expect(seen.live).toBe(false)
  })
})
