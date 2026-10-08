/**
 * Planning (#85): the Spec, the Planner and completeness, on the engine as it starts, with the
 * fake agent of #32 scripting the Planner's tool calls (never a real agent), a temporary data
 * folder, and a temporary Git repository as the Project's main checkout.
 *
 * Rewritten from `hemera-legacy` (`apps/desktop/tests/spec-tools.test.ts`: "A write on a frozen
 * Spec is refused through the tool", "A stale base version is refused and nothing changes", "The
 * define set excludes writing code"; `apps/desktop/tests/specs.test.ts`: "A Spec exists before any
 * Workspace") against the Planner, its role guard and the eight sections.
 */

import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SPEC_SECTIONS, toolsOf } from '@hemera/core/domain'
import { and, asc, eq } from 'drizzle-orm'
import { MissionTarget } from '@hemera/ipc'
import { Deferred, Effect, Exit, Fiber, Option, Predicate, type Schema, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { projectLimits, setProjectLimits } from '../src/engine/budget.ts'
import { createMission, getMission, moveMission } from '../src/engine/missions.ts'
import { listNeeds } from '../src/engine/needs.ts'
import { KINDS } from '../src/engine/notifications.ts'
import { SpecBoard } from '../src/engine/planning/board.ts'
import { giveVision, keepPlanning } from '../src/engine/planning/calls.ts'
import {
  changesSince,
  describeMission,
  markRead,
  readSpec,
  setSpecLanguage,
  specLanguageOf,
  writeSection,
} from '../src/engine/planning/store.ts'
import { PlannerWake } from '../src/engine/planning/wake.ts'
import { createProject } from '../src/engine/projects.ts'
import { setRoleSetting } from '../src/engine/sessions/cascade.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { type RoleSession, getSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { instructionsKept, threadOf } from '../src/engine/sessions/thread.ts'
import { DomainEvents } from '../src/engine/domain-events.ts'
import { betweenMutations } from '../src/engine/transaction.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  domainEvents,
  memoryJournal,
  memoryNext,
  missions,
  sessionDeliveries,
  specs,
  toolCalls,
} from '../src/engine/storage/schema.ts'
import { git, repository } from './repositories.ts'
import {
  BUILDER,
  HELPER,
  type World,
  held,
  sessionsEngine,
  text,
  until,
  within,
} from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('planning'))
  work = realpathSync.native(temporaryFolder('planning-work'))
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

/** The engine with the Planner starting on its own, its agents scripted in their start order. */
const planning = (
  scriptOf: (index: number) => FakeScript,
  options: Parameters<typeof sessionsEngine>[2] = {},
) =>
  sessionsEngine(data, scriptOf, {
    roles: [BUILDER, HELPER],
    ...options,
    sessions: { plannerStarts: true, ...options.sessions },
  })

/** Acme, its main checkout holding the repository `api` with its instruction file. */
const acme = Effect.suspend(() =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    const api = repository(join(main, 'api'))
    writeFileSync(join(api, 'CLAUDE.md'), 'api: run pnpm test before saying done.')
    writeFileSync(join(api, 'invoices.ts'), 'export const invoices = []\n')
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'invoices')
    const project = yield* createProject({
      name: 'Acme',
      mainCheckout: main,
      repositories: ['api'],
    })
    return { project, main, api }
  }),
)

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

const plannersOf = (missionId: string, states: ReadonlyArray<(typeof LIVE)[number]> = LIVE) =>
  Effect.map(sessionsIn(states, { kind: 'mission', missionId }), (rows) =>
    rows.filter((row) => row.role === 'planner'),
  )

/** Waits until the mission has a live Planner, and answers it. */
const plannerStarted = (missionId: string) =>
  Effect.gen(function* () {
    yield* until(Effect.map(plannersOf(missionId), (rows) => rows.length > 0))
    const [planner] = yield* plannersOf(missionId)
    if (planner === undefined) return yield* Effect.die(new Error('no Planner'))
    return planner
  })

/**
 * Waits until a session has nothing left to do. A session opens with a first message (a Planner's
 * brief, a Builder's), and one whose first turn has not begun yet counts as settled: wait for that
 * message in its thread, unless the session ended before it.
 */
const settled = (session: RoleSession) =>
  Effect.gen(function* () {
    yield* until(
      Effect.gen(function* () {
        const lines = yield* threadOf(session.id)
        if (lines.some((line) => line.kind === 'sent')) return true
        const now = yield* getSession(session.id)
        return !LIVE.some((state) => state === now.state)
      }),
    )
    yield* Sessions.use((sessions) => sessions.settled(session.id))
  })

/**
 * A mission of Acme, its Planner started on its own and its first turn over: the session is idle
 * once a turn ended (`settled` alone may answer before the brief's turn is handed over).
 */
const missionPlanned = (projectId: string, sentence = 'Export the invoices as CSV') =>
  Effect.gen(function* () {
    const mission = yield* createMission({ projectId, idea: { sentence, ticket: null } })
    const planner = yield* plannerStarted(mission.id)
    yield* until(
      Effect.map(plannersOf(mission.id, ['idle']), (rows) =>
        rows.some((row) => row.id === planner.id),
      ),
    )
    yield* settled(planner)
    return { mission, planner }
  })

/** Wakes the Planner with a delivery, and waits for the turn it starts to end. */
const delivered = (planner: RoleSession, kind: string, body: string) =>
  Effect.gen(function* () {
    yield* Sessions.use((sessions) =>
      sessions.deliver({
        owner: planner.owner,
        target: { lineage: planner.lineage },
        kind,
        body,
      }),
    )
    yield* settled(planner)
  })

const ALL_SECTIONS = SPEC_SECTIONS.map((section, at) =>
  uses(`toolu_section_${String(at)}`, 'spec_write_section', {
    section,
    content: `The ${section}.`,
    base_version: 0,
  }),
)

const R1 = uses('toolu_r1', 'requirement_write', {
  domain: 'invoices',
  delta: 'added',
  text: 'Invoices export as CSV.',
  scenarios: [{ when: 'the user exports the invoices', then: 'a CSV file is saved' }],
})

const answersOf = (world: World, at = 0) =>
  world.agents[at]?.answers.toolAnswers.map((one) => one.text) ?? []

/** Waits until the mission's Journal holds a line that starts so. */
const journalHas = (missionId: string, start: string) =>
  until(
    Effect.gen(function* () {
      const database = yield* Database
      const lines = yield* database
        .select({ text: memoryJournal.text })
        .from(memoryJournal)
        .where(eq(memoryJournal.missionId, missionId))
      return lines.some((line) => line.text.startsWith(start))
    }),
  )

describe('Creating a mission starts one Planner', () => {
  test('with the three layers and the brief; its model is the cascade’s; it is not counted in the cap', async () => {
    const { world, run } = planning(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          yield* setRoleSetting('project', project.id, 'planner', {
            agent: 'codex',
            model: null,
            effort: null,
          })
          // The Project's only slot is taken by a sub-agent: the Planner does not wait for it.
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { cap: 1, budget: limits.budget })
          const other = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Another mission', ticket: null },
          })
          const otherPlanner = yield* plannerStarted(other.id)
          yield* settled(otherPlanner)
          const helper = yield* Sessions.use((sessions) =>
            sessions.open({
              owner: { kind: 'mission', missionId: other.id },
              role: 'helper',
              provider: 'claude',
              folder: main,
            }),
          )
          yield* settled(helper)
          const { mission, planner } = yield* missionPlanned(project.id)
          const database = yield* Database
          const started = yield* database
            .select()
            .from(domainEvents)
            .where(
              and(eq(domainEvents.entityId, mission.id), eq(domainEvents.type, 'planning.started')),
            )
          const [next] = yield* database
            .select()
            .from(memoryNext)
            .where(eq(memoryNext.missionId, mission.id))
          return {
            planner,
            planners: yield* plannersOf(mission.id),
            instructions: yield* instructionsKept(planner.id),
            started,
            next,
            mission,
          }
        }),
      ),
    )
    expect(seen.planners).toHaveLength(1)
    expect(seen.planner).toMatchObject({
      role: 'planner',
      provider: 'codex',
      modelLevel: 'project',
      chosen: { model: null },
    })
    expect(seen.planner.folder).toBe(join(work, 'acme'))
    expect(seen.instructions).toContain('with the role **the Planner**')
    expect(seen.instructions).toContain('# Role: Planner')
    expect(seen.instructions).toContain('**Write in the Spec language** (English)')
    expect(seen.started).toHaveLength(1)
    expect(JSON.parse(seen.started[0]?.payload ?? '{}')).toMatchObject({
      agent: 'codex',
      model: null,
    })
    expect(seen.next?.text).toBe('Reading the code')
    // Agents 0 and 1 are the other mission's Planner and the helper; this Planner is the third.
    const brief = text(world.agents[2]?.answers.prompts[0] ?? [])
    expect(brief).toMatch(
      /^\[hemera:brief\]\n## Planner · ACME-2 · Export the invoices as CSV\n\nMode: draft/,
    )
    expect(brief).toContain('## Input\n\nExport the invoices as CSV')
    expect(brief).toContain('## Draft\n\nnone yet')
    expect(brief).toMatch(
      /## Languages\n\nSpec language: English · Your language with the user: \w/,
    )
    expect(brief).not.toContain('## Ticket')
    expect(brief).not.toContain('## Vision')
    expect(brief).not.toContain('## Triage')
    expect(brief).toContain('## Now')
  })

  test('a Spec exists before any Workspace, in the Project’s Spec language at its creation', async () => {
    const { run } = planning(() => QUIET, { sessions: { plannerStarts: false } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const kept = yield* setSpecLanguage(project.id, 'fr-fr')
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          yield* setSpecLanguage(project.id, 'de')
          return {
            kept,
            spec: yield* readSpec(mission.id),
            now: yield* specLanguageOf(project.id),
            planners: yield* plannersOf(mission.id),
            refused: yield* setSpecLanguage(project.id, 'not a tag').pipe(Effect.flip),
          }
        }),
      ),
    )
    expect(seen.kept).toBe('fr-FR')
    expect(seen.spec).toMatchObject({ language: 'fr-FR', version: 0, stage: 'planning' })
    expect(seen.spec.sections.map((one) => [one.name, one.state])).toEqual(
      SPEC_SECTIONS.map((name) => [name, 'empty']),
    )
    expect(seen.now).toBe('de')
    expect(Predicate.isTagged(seen.refused, 'InvalidSpecLanguage')).toBe(true)
    expect(seen.planners).toEqual([])
  })
})

describe('A mission’s sessions write in its own Spec language', () => {
  test('the Project’s language changed after the mission was created changes neither layer', async () => {
    const { run } = planning(() => QUIET, { sessions: { plannerStarts: false } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          yield* setSpecLanguage(project.id, 'de')
          const planner = yield* PlannerWake.use((wake) => wake.start(mission.id))
          if (planner === null) return yield* Effect.die(new Error('no Planner'))
          yield* settled(planner)
          return yield* instructionsKept(planner.id)
        }),
      ),
    )
    expect(seen).toContain('**Write in the Spec language** (English)')
    expect(seen).not.toContain('German')
  })
})

describe('The Planner writes the Spec on the version it read', () => {
  test('sections and requirements bump their versions; spec.md is rewritten; a stale base_version is refused with the current text and writes nothing', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [
          uses('toolu_why', 'spec_write_section', {
            section: 'why',
            content: 'Invoices are exported by hand.',
            base_version: 0,
          }),
          R1,
          uses('toolu_stale', 'spec_write_section', {
            section: 'why',
            content: 'Something else.',
            base_version: 0,
          }),
          uses('toolu_r1_again', 'requirement_write', {
            id: 'R1',
            domain: 'invoices',
            delta: 'added',
            text: 'Invoices export as CSV, one line per invoice.',
            scenarios: [
              { id: 'R1.S1', when: 'the user exports the invoices', then: 'a CSV file is saved' },
              { when: 'there is no invoice', then: 'the file holds the header only' },
            ],
            base_version: 1,
          }),
          uses('toolu_r1_stale', 'requirement_write', {
            id: 'R1',
            domain: 'invoices',
            delta: 'added',
            text: 'Stale.',
            scenarios: [],
            base_version: 1,
          }),
          uses('toolu_read', 'spec_read', { section: 'requirements' }),
        ],
      ],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          return {
            spec: yield* readSpec(mission.id),
            changes: yield* changesSince(mission.id, 0),
            file: readFileSync(join(data, 'missions', 'ACME-1', 'spec.md'), 'utf8'),
          }
        }),
      ),
    )
    const answers = answersOf(world)
    expect(answers[0]).toBe('Written: Why is at version 1; the Spec at version 1.')
    expect(answers[1]).toBe('Written: R1 is at version 1. Its scenarios: R1.S1 (version 1).')
    expect(answers[2]).toBe(
      'refused: why changed since version 0: it is at version 1. Nothing was written. Its text now:\n\nInvoices are exported by hand.',
    )
    expect(answers[3]).toBe(
      'Written: R1 is at version 2. Its scenarios: R1.S1 (version 1), R1.S2 (version 1).',
    )
    expect(answers[4]).toContain('refused: R1 changed since version 1: it is at version 2.')
    expect(answers[5]).toContain('### R1 · added · invoices (version 2)')
    expect(seen.spec.version).toBe(3)
    expect(seen.spec.sections.find((one) => one.name === 'why')).toMatchObject({
      body: 'Invoices are exported by hand.',
      version: 1,
      state: 'written',
    })
    expect(seen.spec.requirements).toEqual([
      expect.objectContaining({
        id: 'R1',
        text: 'Invoices export as CSV, one line per invoice.',
        version: 2,
        scenarios: [
          expect.objectContaining({ id: 'R1.S1', version: 1 }),
          expect.objectContaining({ id: 'R1.S2', then: 'the file holds the header only' }),
        ],
      }),
    ])
    expect(seen.changes.map((one) => [one.version, one.item])).toEqual([
      [1, 'why'],
      [2, 'R1'],
      [2, 'R1.S1'],
      [3, 'R1'],
      [3, 'R1.S2'],
    ])
    expect(seen.file).toContain('# ACME-1 · Export the invoices as CSV')
    expect(seen.file).toContain('## Why\n\nInvoices are exported by hand.')
    expect(seen.file).toContain(
      '- R1.S2: WHEN there is no invoice THEN the file holds the header only',
    )
  })

  test('a scenario left out is removed and its id is never reused; a removed requirement keeps its number', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [
          R1,
          uses('toolu_r1_drop', 'requirement_write', {
            id: 'R1',
            domain: 'invoices',
            delta: 'added',
            text: 'Invoices export as CSV.',
            scenarios: [{ when: 'the user exports again', then: 'the file is replaced' }],
            base_version: 1,
          }),
          uses('toolu_remove', 'requirement_remove', { id: 'R1', base_version: 2 }),
          uses('toolu_r2', 'requirement_write', {
            domain: 'invoices',
            delta: 'added',
            text: 'A second one.',
            scenarios: [{ when: 'a', then: 'b' }],
          }),
        ],
      ],
      steps: [says('Done.')],
    }))
    const spec = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          return yield* readSpec(mission.id)
        }),
      ),
    )
    expect(answersOf(world)[1]).toBe(
      'Written: R1 is at version 2. Its scenarios: R1.S2 (version 1).',
    )
    expect(answersOf(world)[2]).toBe('Removed: R1. Its id is never reused.')
    expect(spec.requirements.map((one) => [one.id, one.removed])).toEqual([
      ['R1', true],
      ['R2', false],
    ])
    expect(spec.requirements[1]?.scenarios.map((one) => one.id)).toEqual(['R2.S1'])
  })

  test('two writes of one section on one version at once: one is written, the other is stale', async () => {
    const { run } = planning(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const writer = { sessionId: planner.id, role: 'planner', missionId: mission.id }
          const both = yield* Effect.all(
            [
              writeSection(writer, 'goals', 'Export every invoice.', 0),
              writeSection(writer, 'goals', 'Export the paid invoices.', 0),
            ],
            { concurrency: 'unbounded' },
          )
          return { both, spec: yield* readSpec(mission.id) }
        }),
      ),
    )
    expect(seen.both.filter((one) => 'done' in one)).toHaveLength(1)
    expect(seen.both.filter((one) => 'refused' in one)).toHaveLength(1)
    expect(seen.spec.version).toBe(1)
    expect(seen.spec.sections.find((one) => one.name === 'goals')?.version).toBe(1)
  })

  test('a write whose readable file cannot be written is still written, and counts in the turn', async () => {
    const { run } = planning(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          // spec.md cannot be written: a folder stands where the file goes.
          mkdirSync(join(data, 'missions', 'ACME-1', 'spec.md'), { recursive: true })
          const writer = { sessionId: planner.id, role: 'planner', missionId: mission.id }
          const outcome = yield* Effect.exit(writeSection(writer, 'why', 'Invoices by hand.', 0))
          return {
            outcome,
            spec: yield* readSpec(mission.id),
            turn: yield* SpecBoard.use((board) => board.takeWrites(planner.id)),
          }
        }),
      ),
    )
    expect(Exit.isSuccess(seen.outcome)).toBe(true)
    if (Exit.isSuccess(seen.outcome)) expect('done' in seen.outcome.value).toBe(true)
    expect(seen.spec.version).toBe(1)
    expect(seen.turn?.items).toEqual([{ kind: 'section', name: 'why' }])
  })

  test('a write identical to the section changes nothing and is not in the turn’s line', async () => {
    const { run } = planning(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const writer = { sessionId: planner.id, role: 'planner', missionId: mission.id }
          yield* writeSection(writer, 'why', 'Invoices by hand.', 0)
          const first = yield* SpecBoard.use((board) => board.takeWrites(planner.id))
          const again = yield* writeSection(writer, 'why', 'Invoices by hand.', 1)
          return {
            first,
            again,
            turn: yield* SpecBoard.use((board) => board.takeWrites(planner.id)),
            spec: yield* readSpec(mission.id),
          }
        }),
      ),
    )
    expect(seen.first?.items).toEqual([{ kind: 'section', name: 'why' }])
    expect(seen.again).toEqual({ done: { version: 1, spec: 1 } })
    expect(seen.turn).toBeNull()
    expect(seen.spec.version).toBe(1)
  })

  test('concurrent writes leave spec.md at the last version', async () => {
    const { run } = planning(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const writer = { sessionId: planner.id, role: 'planner', missionId: mission.id }
          yield* Effect.forEach(
            SPEC_SECTIONS,
            (section) => writeSection(writer, section, `The ${section} at once.`, 0),
            { concurrency: 'unbounded', discard: true },
          )
          return {
            spec: yield* readSpec(mission.id),
            file: readFileSync(join(data, 'missions', 'ACME-1', 'spec.md'), 'utf8'),
          }
        }),
      ),
    )
    expect(seen.spec.version).toBe(SPEC_SECTIONS.length)
    for (const section of SPEC_SECTIONS) expect(seen.file).toContain(`The ${section} at once.`)
  })

  test('mission_describe sets the title and the type, and the search column follows the title', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [
          uses('toolu_describe', 'mission_describe', {
            title: 'Invoices as CSV files',
            type: 'maintenance',
          }),
        ],
      ],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          const database = yield* Database
          const [row] = yield* database
            .select({ searchText: missions.searchText })
            .from(missions)
            .where(eq(missions.id, mission.id))
          return { mission: yield* getMission(mission.id), searchText: row?.searchText ?? '' }
        }),
      ),
    )
    expect(answersOf(world)[0]).toBe('The mission is now “Invoices as CSV files”, a maintenance.')
    expect(seen.mission).toMatchObject({ title: 'Invoices as CSV files', type: 'maintenance' })
    expect(seen.searchText).toContain('files')
  })
})

describe('mission_describe never stores a secret nor an empty title', () => {
  test('a known secret in the title is masked; a title of spaces is refused', async () => {
    const { run } = planning(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Secrets.useSync((secrets) => secrets.register('suite', ['tok-registered-77']))
          const writer = { sessionId: planner.id, role: 'planner', missionId: mission.id }
          const blank = yield* describeMission(writer, { title: '   ' })
          const afterBlank = yield* getMission(mission.id)
          const masked = yield* describeMission(writer, { title: 'Export with tok-registered-77' })
          return { blank, afterBlank, masked, mission: yield* getMission(mission.id) }
        }),
      ),
    )
    expect(seen.blank).toEqual({
      refused: 'The title is empty: name what the mission delivers.',
    })
    expect(seen.afterBlank.title).toBe('Export the invoices as CSV')
    expect(seen.mission.title).not.toContain('tok-registered-77')
    expect(seen.mission.title).toContain('Export with')
  })
})

describe('A write from anyone but the Planner of a mission in Planning is refused', () => {
  test('from another role: the tool is not offered, the call is recorded refused', async () => {
    const { world, run } = planning((index) =>
      index === 0
        ? QUIET
        : {
            steps: [
              uses('toolu_builder', 'spec_write_section', {
                section: 'why',
                content: 'Builders do not write the Spec.',
                base_version: 0,
              }),
            ],
          },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          const builder = yield* Sessions.use((sessions) =>
            sessions.open({
              owner: { kind: 'mission', missionId: mission.id },
              role: 'builder',
              provider: 'claude',
              folder: main,
            }),
          )
          yield* settled(builder)
          const database = yield* Database
          return {
            calls: yield* database
              .select()
              .from(toolCalls)
              .where(eq(toolCalls.sessionId, builder.id)),
            spec: yield* readSpec(mission.id),
          }
        }),
      ),
    )
    expect(answersOf(world, 1)[0]).toBe('refused: the Builder has no tool spec_write_section')
    expect(seen.calls.map((one) => [one.tool, one.outcome])).toEqual([
      ['spec_write_section', 'refused'],
    ])
    expect(seen.spec.version).toBe(0)
  })

  test('outside Planning and on a frozen Spec: refused with the sentence, recorded, nothing written', async () => {
    const write = uses('toolu_late', 'spec_write_section', {
      section: 'why',
      content: 'Too late.',
      base_version: 0,
    })
    const { world, run } = planning(() => ({
      turns: [[says('Reading.')], [write], [write]],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const frozen = yield* missionPlanned(project.id)
          // #92 freezes the Spec; here the flag is set as it will set it.
          const database = yield* Database
          yield* database
            .update(specs)
            .set({ frozen: true })
            .where(eq(specs.missionId, frozen.mission.id))
          yield* delivered(frozen.planner, 'update', 'Write the why.')
          const ready = yield* missionPlanned(project.id, 'Import the invoices')
          yield* moveMission(ready.mission.id, 'freeze', 'user')
          yield* delivered(ready.planner, 'update', 'Write the why.')
          return {
            calls: yield* database
              .select({
                tool: toolCalls.tool,
                outcome: toolCalls.outcome,
                reason: toolCalls.reason,
              })
              .from(toolCalls)
              .orderBy(asc(toolCalls.calledAt)),
            frozen: yield* readSpec(frozen.mission.id),
            ready: yield* readSpec(ready.mission.id),
          }
        }),
      ),
    )
    expect(answersOf(world, 0)[0]).toBe(
      'refused: The Spec of ACME-1 is frozen: nothing writes it until the user sends it back to Planning.',
    )
    expect(answersOf(world, 1)[0]).toBe(
      'refused: ACME-2 is Ready: the Spec is frozen and nothing writes it.',
    )
    expect(seen.calls.map((one) => [one.tool, one.outcome])).toEqual([
      ['spec_write_section', 'refused'],
      ['spec_write_section', 'refused'],
    ])
    expect(seen.frozen.version).toBe(0)
    expect(seen.ready.version).toBe(0)
  })

  test('the Planner holds no file-writing tool: a write is refused as not offered', async () => {
    expect(toolsOf('planner')).not.toContain('fs_write')
    expect(toolsOf('planner')).not.toContain('fs_edit')
    const { world, run } = planning(() => ({
      turns: [
        [
          uses('toolu_write', 'fs_write', {
            repository: 'api',
            path: 'notes.md',
            content: 'A Planner never writes the code.',
          }),
        ],
      ],
      steps: [says('Done.')],
    }))
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* missionPlanned(project.id)
        }),
      ),
    )
    expect(answersOf(world)[0]).toBe('refused: the Planner has no tool fs_write')
    expect(readdirSync(join(work, 'acme', 'api'))).not.toContain('notes.md')
  })
})

describe('A file read in the main checkout says when it has an uncommitted change', () => {
  test('a modified file and an untracked one carry the sentence; a clean one does not', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [
          uses('toolu_modified', 'fs_read', { repository: 'api', path: 'invoices.ts' }),
          uses('toolu_untracked', 'fs_read', { repository: 'api', path: 'draft.ts' }),
          uses('toolu_clean', 'fs_read', { repository: 'api', path: 'CLAUDE.md' }),
        ],
      ],
      steps: [says('Done.')],
    }))
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, api } = yield* acme
          writeFileSync(join(api, 'invoices.ts'), 'export const invoices = [1]\n')
          writeFileSync(join(api, 'draft.ts'), 'export {}\n')
          yield* missionPlanned(project.id)
        }),
      ),
    )
    const [modified, untracked, clean] = answersOf(world)
    expect(modified).toContain('export const invoices = [1]')
    expect(modified).toContain('This file has an uncommitted change in the main checkout.')
    expect(untracked).toContain('This file has an uncommitted change in the main checkout.')
    expect(clean).toContain('api: run pnpm test before saying done.')
    expect(clean).not.toContain('uncommitted change')
  })
})

describe('Completeness, checked by Hemera', () => {
  test('an incomplete Spec lists every failure and records nothing; a complete one records its version and emits spec.declared_complete', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [uses('toolu_early', 'declare_complete', { why: 'It looks done.' })],
        [
          ...ALL_SECTIONS,
          R1,
          uses('toolu_describe', 'mission_describe', { title: 'Invoices as CSV', type: 'feature' }),
          // #90: the scenario's proof, the task graph and the recommended model.
          uses('toolu_proof', 'proof_write', {
            scenario: 'R1.S1',
            proof: {
              mode: 'by_hand',
              actions: ['Export the invoices'],
              starting_data: 'None.',
              expected: 'A CSV file is saved.',
              seen_today: false,
            },
            base_version: 0,
          }),
          uses('toolu_tasks', 'tasks_write', {
            tasks: [
              {
                title: 'Export as CSV',
                result: 'The invoices export as CSV.',
                requirements: ['R1'],
                scenarios: ['R1.S1'],
                targets: [],
                depends_on: [],
              },
            ],
            base_version: 0,
          }),
          uses('toolu_model', 'model_recommend', {
            agent: 'codex',
            model: 'gpt-large',
            reason: 'A small change.',
          }),
          uses('toolu_done', 'declare_complete', { why: 'A Builder can build it.' }),
          uses('toolu_again', 'declare_complete', { why: 'Still done.' }),
        ],
      ],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.scoped(
          Effect.gen(function* () {
            const declarations = yield* SpecBoard.use((board) => board.declarations)
            const first = yield* declarations.pipe(Stream.runHead, Effect.forkScoped)
            const { project } = yield* acme
            const { mission, planner } = yield* missionPlanned(project.id)
            const before = yield* readSpec(mission.id)
            yield* delivered(planner, 'update', 'Write the Spec.')
            const declared = yield* Fiber.join(first)
            const database = yield* Database
            return {
              before,
              after: yield* readSpec(mission.id),
              declared,
              events: yield* database
                .select({ type: domainEvents.type })
                .from(domainEvents)
                .where(eq(domainEvents.entityId, mission.id))
                .orderBy(asc(domainEvents.sequence)),
            }
          }),
        ),
      ),
    )
    const answers = answersOf(world)
    expect(answers[0]?.split('\n')).toEqual([
      'refused: the Spec is not complete, and nothing was recorded. Fix each of these, then declare again:',
      ...SPEC_SECTIONS.map((section) => expect.stringContaining(`- ${section}: `)),
      '- requirements: The Spec has no requirement.',
      '- mission: The mission has no title and type of yours: set them with mission_describe.',
      '- model: No model is recommended for Building: give one with model_recommend.',
    ])
    expect(seen.before.declaredCompleteVersion).toBeNull()
    expect(answers.at(-2)).toBe(
      'Declared complete at version 11. The user is told, with your reason.',
    )
    expect(answers.at(-1)).toBe('Already declared complete at version 11: nothing changed since.')
    expect(seen.after.declaredCompleteVersion).toBe(11)
    expect(seen.declared).toEqual(
      Option.some({ missionId: seen.after.missionId, version: 11, first: true }),
    )
    const types = seen.events.map((one) => one.type)
    expect(types.filter((type) => type === 'planning.completeness_refused')).toHaveLength(1)
    expect(types.filter((type) => type === 'planning.declared_complete')).toHaveLength(1)
  })
})

describe('Triage', () => {
  test('the answer is stored, creates no need, notifies, and the ball waits on the user; keeping it delivers [hemera:triage-kept] once, even asked twice at once', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [
          uses('toolu_triage', 'triage_answer', {
            kind: 'existing_mission',
            ref: 'ACME-1',
            text: 'ACME-1 already exports the invoices.',
          }),
        ],
      ],
      steps: [says('Planning it.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.scoped(
          Effect.gen(function* () {
            const committed = yield* DomainEvents.use((events) => events.subscribe)
            const told = yield* committed.pipe(
              Stream.filter((event) => event.type === 'planning.triaged'),
              Stream.runHead,
              Effect.forkScoped,
            )
            const { project } = yield* acme
            const { mission, planner } = yield* missionPlanned(project.id)
            const triaged = yield* getMission(mission.id)
            const needs = yield* listNeeds
            const database = yield* Database
            const event = yield* Fiber.join(told)
            const kind = KINDS.find((one) => one.id === 'triage-answer')
            const notice =
              kind === undefined || Option.isNone(event)
                ? Option.none()
                : yield* kind.notice(event.value, (words) => words)
            yield* Effect.all([keepPlanning(mission.id), keepPlanning(mission.id)], {
              concurrency: 'unbounded',
            })
            yield* settled(planner)
            const kept = yield* database
              .select()
              .from(sessionDeliveries)
              .where(eq(sessionDeliveries.kind, 'triage-kept'))
            return {
              triaged,
              needs,
              notice,
              kept,
              after: yield* getMission(mission.id),
              projectId: project.id,
            }
          }),
        ),
      ),
    )
    expect(answersOf(world)[0]).toContain('Your answer is kept')
    expect(seen.triaged.triage).toMatchObject({
      kind: 'existing_mission',
      ref: 'ACME-1',
      text: 'ACME-1 already exports the invoices.',
      state: 'pending',
    })
    expect(Predicate.isTagged(seen.triaged.ball, 'WaitingOnYou')).toBe(true)
    expect(seen.triaged.needs).toEqual([])
    expect(seen.needs.flatMap((group) => group.needs)).toEqual([])
    expect(Option.getOrNull(seen.notice)).toMatchObject({
      kind: 'triage-answer',
      missionKey: 'ACME-1',
      target: MissionTarget.make({ projectId: seen.projectId, missionKey: 'ACME-1' }),
    })
    expect(seen.kept).toHaveLength(1)
    expect(seen.after.triage?.state).toBe('kept')
    expect(Predicate.isTagged(seen.after.ball, 'WaitingOnYou')).toBe(false)
    expect(text(world.agents[0]?.answers.prompts[1] ?? [])).toContain('[hemera:triage-kept]')
  })
})

describe('The vision reaches the Planner as [hemera:vision]', () => {
  test('to an idle Planner at once', async () => {
    const { world, run } = planning(() => QUIET)
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* giveVision(mission.id, 'One file per month.')
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 2))
          yield* settled(planner)
        }),
      ),
    )
    const second = text(world.agents[0]?.answers.prompts[1] ?? [])
    expect(second).toMatch(/^\[hemera:vision\]\nI1 · The user's vision, given /)
    expect(second).toContain('One file per month.')
  })

  test('to a Planner in a turn at its next safe point, never in the middle of the turn', async () => {
    const turn = held()
    const { world, run } = planning(() => ({
      turns: [[says('Reading.'), says('Still reading.')]],
      steps: [says('Done.')],
      between: () => turn.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          const planner = yield* plannerStarted(mission.id)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          yield* giveVision(mission.id, 'One file per month.')
          const during = world.agents[0]?.answers.prompts.length ?? 0
          turn.release()
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 2))
          yield* settled(planner)
          return { during }
        }),
      ),
    )
    expect(seen.during).toBe(1)
    expect(text(world.agents[0]?.answers.prompts[1] ?? [])).toContain('[hemera:vision]')
  })

  test('with no live Planner, a fresh one starts with its brief and the vision', async () => {
    const { world, run } = planning(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          yield* giveVision(mission.id, 'One file per month.')
          const fresh = yield* plannerStarted(mission.id)
          yield* settled(fresh)
          return { fresh, planner }
        }),
      ),
    )
    expect(seen.fresh.id).not.toBe(seen.planner.id)
    const first = text(world.agents[1]?.answers.prompts[0] ?? [])
    expect(first).toMatch(/^\[hemera:brief\]/)
    expect(first).toContain('## Vision\n\n- ')
    expect(first).toContain('[hemera:vision]')
  })

  test('outside Planning a vision is refused and no Planner starts', async () => {
    const { world, run } = planning(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* moveMission(mission.id, 'cancel', 'user')
          yield* until(Effect.map(plannersOf(mission.id), (rows) => rows.length === 0))
          const refused = yield* giveVision(mission.id, 'Too late.').pipe(Effect.flip)
          const woken = yield* PlannerWake.use((wake) => wake.deliver(mission.id, 'vision', 'x'))
          return { refused, woken, planner, planners: yield* plannersOf(mission.id) }
        }),
      ),
    )
    expect(Predicate.isTagged(seen.refused, 'PlanningRefused')).toBe(true)
    expect(seen.woken).toBe(false)
    expect(seen.planners).toEqual([])
    expect(world.agents).toHaveLength(1)
  })
})

describe('A cancel racing the Planner’s first start leaves nothing running', () => {
  test('a Planner opened once its mission was cancelled is stopped', async () => {
    const { run } = planning(() => QUIET, { sessions: { plannerStarts: false } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          // While the test holds the writes, the cancel waits to write first, and the start reads
          // the mission still in Planning, then waits to open its session after the cancel.
          const go = yield* Deferred.make<void>()
          const holding = yield* betweenMutations(Deferred.await(go)).pipe(Effect.forkChild)
          const cancelling = yield* moveMission(mission.id, 'cancel', 'user').pipe(Effect.forkChild)
          yield* Effect.yieldNow
          const starting = yield* PlannerWake.use((wake) => wake.start(mission.id)).pipe(
            Effect.forkChild,
          )
          yield* Effect.yieldNow
          yield* Deferred.succeed(go, undefined)
          yield* Fiber.join(holding)
          yield* Fiber.join(cancelling)
          const session = yield* Fiber.join(starting)
          return { session, planners: yield* plannersOf(mission.id) }
        }),
      ),
    )
    expect(seen.planners).toEqual([])
    expect(seen.session).toBeNull()
  })
})

describe('Nothing wakes the Planner but a delivery', () => {
  test('no file of Planning holds a timer', () => {
    const folder = join(import.meta.dirname, '..', 'src', 'engine', 'planning')
    for (const file of readdirSync(folder)) {
      const source = readFileSync(join(folder, file), 'utf8')
      expect(source, file).not.toMatch(/Schedule\.|Effect\.sleep|setTimeout|setInterval/)
    }
  })

  test('a Planner that ended is not started again, by a restart or a second mission.started', async () => {
    const first = planning(() => QUIET)
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          return { mission }
        }),
      ),
    )
    const second = planning(() => QUIET)
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* profile.gate
          const again = yield* PlannerWake.use((wake) => wake.start(before.mission.id))
          return {
            again,
            planners: yield* plannersOf(before.mission.id),
          }
        }),
      ),
    )
    expect(after.again).toBeNull()
    expect(after.planners).toEqual([])
    expect(second.world.agents).toHaveLength(0)
  })
})

describe('At its start, the engine picks up the missions in Planning', () => {
  test('a mission created while no Planner started gets one; a live Planner is rebuilt, never doubled', async () => {
    const quiet = planning(() => QUIET, { sessions: { plannerStarts: false } })
    const before = await quiet.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const waiting = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Waiting for its Planner', ticket: null },
          })
          return { waiting }
        }),
      ),
    )
    const restarted = planning(() => QUIET)
    const after = await restarted.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const planner = yield* plannerStarted(before.waiting.id)
          yield* settled(planner)
          // Asked again, the start finds the one it made.
          const twice = yield* Effect.all(
            [
              PlannerWake.use((wake) => wake.start(before.waiting.id)),
              PlannerWake.use((wake) => wake.start(before.waiting.id)),
            ],
            { concurrency: 'unbounded' },
          )
          return { twice, planners: yield* plannersOf(before.waiting.id) }
        }),
      ),
    )
    expect(after.twice).toEqual([null, null])
    expect(after.planners).toHaveLength(1)
    const rebuilt = planning(() => QUIET)
    const third = await rebuilt.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(plannersOf(before.waiting.id), (rows) =>
              rows.some((row) => row.epoch === 1),
            ),
          )
          const started = yield* PlannerWake.use((wake) => wake.start(before.waiting.id))
          return { started, planners: yield* plannersOf(before.waiting.id) }
        }),
      ),
    )
    expect(third.started).toBeNull()
    expect(third.planners.map((one) => one.epoch)).toEqual([1])
  })

  test('mission.started and a vision at once open one Planner', async () => {
    const { run } = planning(() => QUIET)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          // mission.started starts it on its own while a vision and a second start race it.
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          yield* Effect.all(
            [
              giveVision(mission.id, 'One file.'),
              PlannerWake.use((wake) => wake.start(mission.id)),
            ],
            { concurrency: 'unbounded' },
          )
          const planner = yield* plannerStarted(mission.id)
          yield* settled(planner)
          const database = yield* Database
          return {
            planners: yield* plannersOf(mission.id, ['starting', 'working', 'idle', 'stuck']),
            started: yield* database
              .select()
              .from(domainEvents)
              .where(
                and(
                  eq(domainEvents.entityId, mission.id),
                  eq(domainEvents.type, 'planning.started'),
                ),
              ),
          }
        }),
      ),
    )
    expect(seen.planners).toHaveLength(1)
    expect(seen.started).toHaveLength(1)
  })
})

describe('A replaced Planner gets the draft, the Memory and the resume block', () => {
  test('in the brief of its fresh session', async () => {
    const { world, run } = planning((index) =>
      index === 0
        ? {
            turns: [
              [
                uses('toolu_why', 'spec_write_section', {
                  section: 'why',
                  content: 'Invoices are exported by hand.',
                  base_version: 0,
                }),
              ],
            ],
            steps: [says('Done.')],
          }
        : QUIET,
    )
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* journalHas(mission.id, 'Spec: Wrote Why')
          const next = yield* Sessions.use((sessions) =>
            sessions.replace(planner.id, 'its agent stopped'),
          )
          if (next === null) return yield* Effect.die(new Error('not replaced'))
          yield* settled(next)
          return mission
        }),
      ),
    )
    const brief = text(world.agents[1]?.answers.prompts[0] ?? [])
    expect(brief).toContain('## Draft\n\n# ACME-1 · Export the invoices as CSV')
    expect(brief).toContain('## Why (version 1)\n\nInvoices are exported by hand.')
    expect(brief).toContain('## Now')
    expect(brief).toContain('Spec: Wrote Why')
    expect(brief).toContain('[hemera:resume]')
  })
})

describe('What changed since the user last read', () => {
  test('changesSince lists exactly what changed after a version; markRead moves it', async () => {
    const { run } = planning(() => ({
      turns: [
        [
          uses('toolu_why', 'spec_write_section', {
            section: 'why',
            content: 'By hand.',
            base_version: 0,
          }),
          uses('toolu_goals', 'spec_write_section', {
            section: 'goals',
            content: 'Export.',
            base_version: 0,
          }),
          uses('toolu_why_again', 'spec_write_section', {
            section: 'why',
            content: 'By hand, monthly.',
            base_version: 1,
          }),
        ],
      ],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          yield* journalHas(mission.id, 'Spec:')
          yield* markRead(mission.id, 1)
          const read = yield* readSpec(mission.id)
          const since = yield* changesSince(mission.id, read.readVersion ?? 0)
          yield* markRead(mission.id, 3)
          const refused = yield* markRead(mission.id, 4).pipe(Effect.flip)
          const database = yield* Database
          const lines = yield* database
            .select({ text: memoryJournal.text })
            .from(memoryJournal)
            .where(eq(memoryJournal.missionId, mission.id))
          return { read, since, after: yield* readSpec(mission.id), refused, lines }
        }),
      ),
    )
    expect(seen.read.readVersion).toBe(1)
    expect(seen.since).toEqual([
      expect.objectContaining({ version: 2, item: 'goals', before: null, after: 'Export.' }),
      expect.objectContaining({
        version: 3,
        item: 'why',
        before: 'By hand.',
        after: 'By hand, monthly.',
      }),
    ])
    expect(seen.after.readVersion).toBe(3)
    expect(Predicate.isTagged(seen.refused, 'PlanningRefused')).toBe(true)
    // One line for the turn that wrote, not one per call.
    expect(seen.lines.map((one) => one.text).filter((line) => line.startsWith('Spec:'))).toEqual([
      'Spec: Wrote Why, Goals / Non-goals',
    ])
  })
})

describe('A section is being written while its call runs', () => {
  test('from the agent’s live tool-call events', async () => {
    const turn = held()
    let step = 0
    const { run } = planning(() => ({
      turns: [
        [
          {
            does: 'calls',
            call: { id: 'toolu_live', title: 'mcp__hemera__spec_write_section', status: 'pending' },
          },
          // Its arguments come in an update of the call, as Claude Code streams them.
          {
            does: 'calls',
            call: {
              id: 'toolu_live',
              title: 'Write a section',
              status: 'in_progress',
              rawInput: { section: 'risks' },
            },
          },
          says('Writing.'),
          { does: 'updates', call: { id: 'toolu_live', status: 'completed' } },
        ],
      ],
      steps: [says('Done.')],
      between: () => {
        step += 1
        return step === 3 ? turn.promise : Promise.resolve()
      },
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          const planner = yield* plannerStarted(mission.id)
          const stateOf = Effect.map(
            readSpec(mission.id),
            (spec) => spec.sections.find((one) => one.name === 'risks')?.state,
          )
          yield* until(Effect.map(stateOf, (state) => state === 'being_written'))
          turn.release()
          yield* settled(planner)
          yield* until(Effect.map(stateOf, (state) => state === 'empty'))
          return yield* stateOf
        }),
      ),
    )
    expect(seen).toBe('empty')
  })
})

describe('A call that never completes leaves no section being written', () => {
  const calling = (between: () => Promise<void>): FakeScript => ({
    turns: [
      [
        {
          does: 'calls',
          call: {
            id: 'toolu_lost',
            title: 'mcp__hemera__spec_write_section',
            status: 'in_progress',
            rawInput: { section: 'risks' },
          },
        },
        says('Writing.'),
      ],
    ],
    steps: [says('Done.')],
    between,
  })

  const risksOf = (missionId: string) =>
    Effect.map(
      readSpec(missionId),
      (spec) => spec.sections.find((one) => one.name === 'risks')?.state,
    )

  test('when its turn ends', async () => {
    const { run } = planning(() => calling(() => Promise.resolve()))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          yield* until(Effect.map(risksOf(mission.id), (state) => state === 'empty'))
          return yield* risksOf(mission.id)
        }),
      ),
    )
    expect(seen).toBe('empty')
  })

  test('when its session ends', async () => {
    const turn = held()
    let step = 0
    const { run } = planning(() =>
      calling(() => {
        step += 1
        return step === 2 ? turn.promise : Promise.resolve()
      }),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          const planner = yield* plannerStarted(mission.id)
          yield* until(Effect.map(risksOf(mission.id), (state) => state === 'being_written'))
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          turn.release()
          yield* until(Effect.map(risksOf(mission.id), (state) => state === 'empty'))
          return yield* risksOf(mission.id)
        }),
      ),
    )
    expect(seen).toBe('empty')
  })
})
