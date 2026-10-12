/**
 * The Prototyper in Planning (#222): the Planner launches it when the user asks for a prototype
 * and when the Spec changes the interface; it tries the approach in a throwaway folder of the
 * mission and never writes outside it; its result is kept with the mission, shown to the user,
 * judged, and frozen with the Spec.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent (a Planner started on its
 * own, the Prototyper, the cold read), a temporary data folder, and Acme's real repositories. The
 * Prototyper's turns are held open, so none of them ends on its own; the test drives its tools
 * through its grant. Every wait is on state, never on time.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PLANNER_PROTOTYPE_RULE } from '@hemera/core/domain'
import { PlanningRefused } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Effect, Option, Result, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import {
  helperChanges,
  helperRowsOf,
  listHelpers,
  readHelper,
} from '../src/engine/building/helper-store.ts'
import { listEvidence } from '../src/engine/memory/evidence.ts'
import { createMission, getMission } from '../src/engine/missions.ts'
import { freezeMission, freezeReadiness } from '../src/engine/planning/freeze.ts'
import { askPrototype, judgePrototype } from '../src/engine/planning/prototypes.ts'
import { PLANNER_TEMPLATE } from '../src/engine/planning/role.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { type RoleSession, sessionsIn, sessionsOfLineage } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { permissionRequests, sessionDeliveries } from '../src/engine/storage/schema.ts'
import {
  READING,
  acmeAt,
  call,
  frozenIn,
  grantOf,
  plannedIn,
  readCold,
  writeComplete,
} from './building-world.ts'
import { BUILDER, HELPER, held, sessionsEngine, text, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { callTool } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('prototyper'))
  work = realpathSync.native(temporaryFolder('prototyper-work'))
})
afterEach(removeFolders)

const uses = (id: string, tool: string, args: Record<string, string>): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

const says = (words: string): FakeStep => ({ does: 'says', text: words })

/**
 * The engine, its agents scripted in their start order by `first`; every other agent (null in
 * `first`, or after it) holds its turn open until the test lets it go.
 */
const prototyping = (
  first: ReadonlyArray<FakeScript | null>,
  options: Parameters<typeof sessionsEngine>[2] = {},
) => {
  const hold = held()
  const working: FakeScript = { steps: [says('Working.')], between: () => hold.promise }
  const engine = sessionsEngine(data, (index) => first[index] ?? working, {
    roles: [BUILDER, HELPER],
    ...options,
    tools: { home: work, ...options.tools },
  })
  return {
    world: engine.world,
    run: <A, E>(program: Parameters<typeof engine.run<A, E>>[0]) =>
      engine.run(program).finally(hold.release),
  }
}

/** The mission's helper of a number, once its session works, and a grant the test drives it with. */
const prototyperIn = (missionId: string, number: number) =>
  Effect.gen(function* () {
    const sessionOf = Effect.gen(function* () {
      const row = (yield* helperRowsOf(missionId)).find((one) => one.number === number)
      if (row === undefined) return null
      const live = (yield* sessionsOfLineage(row.lineage)).filter((one) =>
        ['working', 'idle'].includes(one.state),
      )
      const session = live.toSorted((a, b) => b.epoch - a.epoch).at(0)
      return session === undefined ? null : { row, session }
    })
    yield* until(Effect.map(sessionOf, (found) => found !== null))
    const found = yield* sessionOf
    if (found === null) return yield* Effect.die(new Error(`no helper H${String(number)}`))
    return { ...found, grantId: yield* grantOf(found.session.id) }
  })

/** The mission's live Planner, once it started. */
const plannerOf = (missionId: string) =>
  Effect.gen(function* () {
    const live = Effect.map(
      sessionsIn(['working', 'idle'], { kind: 'mission', missionId }),
      (rows) => rows.find((row) => row.role === 'planner'),
    )
    yield* until(Effect.map(live, (found) => found !== undefined))
    const planner = yield* live
    if (planner === undefined) return yield* Effect.die(new Error('no Planner'))
    return planner
  })

const settled = (session: RoleSession) => Sessions.use((sessions) => sessions.settled(session.id))

/** Each prompt an agent was sent, as text. */
const promptsOf = (
  agent:
    | { answers: { prompts: ReadonlyArray<ReadonlyArray<{ type: string; text?: string }>> } }
    | undefined,
) => agent?.answers.prompts.map((prompt) => text(prompt)) ?? []

/** The deliveries a session's lineage was handed, of a kind. */
const deliveriesTo = (lineage: string, kind: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(sessionDeliveries)
      .where(and(eq(sessionDeliveries.targetLineage, lineage), eq(sessionDeliveries.kind, kind)))
  })

const QUESTION = 'Does the invoice list read in two columns on a narrow window?'

const RESULT = {
  tried: 'A two-column invoice list in plain HTML.',
  works: ['The two columns hold at 480 pixels.'],
  does_not_work: ['The totals wrap under 360 pixels.'],
  files: ['list.html'],
}

describe('The user asks for a prototype and the Planner launches it', () => {
  test('the ask reaches the Planner as [hemera:prototype]; its helper_launch runs the Prototyper in missions/<key>/prototypes/1/, a child of the Planner', async () => {
    const planner: FakeScript = {
      turns: [
        [says('Reading the code.')],
        [
          uses('toolu_launch', 'helper_launch', { helper: 'prototyper', brief: QUESTION }),
          says('The Prototyper runs.'),
        ],
      ],
      steps: [says('Read.')],
    }
    const { world, run } = prototyping([planner], { sessions: { plannerStarts: true } })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acmeAt(work)
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'List the invoices', ticket: null },
          })
          const session = yield* plannerOf(mission.id)
          yield* settled(session)
          yield* askPrototype(mission.id, 'Show me the list in two columns before we decide.')
          const prototyper = yield* prototyperIn(mission.id, 1)
          yield* until(Effect.sync(() => promptsOf(world.agents[1]).length > 0))
          return {
            key: (yield* getMission(mission.id)).key,
            planner: session,
            prototyper,
            chips: yield* listHelpers(mission.id),
          }
        }),
      ),
    )
    const asked = promptsOf(world.agents[0])[1] ?? ''
    expect(asked).toContain('[hemera:prototype]')
    expect(asked).toContain('Show me the list in two columns before we decide.')
    expect(world.agents[0]?.answers.toolAnswers[0]?.text).toMatch(/^H1 launched: /)
    const folder = join(data, 'missions', seen.key, 'prototypes', '1')
    expect(seen.prototyper.session).toMatchObject({
      role: 'prototyper',
      folder,
      parent: seen.planner.lineage,
    })
    const brief = promptsOf(world.agents[1])[0] ?? ''
    expect(brief).toContain(`Helper H1 for the Planner of ${seen.key} · depth 1`)
    expect(brief).toContain(QUESTION)
    expect(brief).toContain('spec_read (being planned: it may still change)')
    expect(seen.chips).toEqual([
      expect.objectContaining({ label: 'H1', name: 'Prototyper', state: 'running', verdict: null }),
    ])
  })

  test('outside Planning the ask is refused, and the Planner is told nothing', async () => {
    const { run } = prototyping([READING])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission } = yield* frozenIn(project.id, main)
          const asked = yield* askPrototype(mission.id, 'Show me the list.').pipe(Effect.result)
          const database = yield* Database
          const told = yield* database
            .select()
            .from(sessionDeliveries)
            .where(eq(sessionDeliveries.kind, 'prototype'))
          return { asked, told, key: (yield* getMission(mission.id)).key }
        }),
      ),
    )
    expect(
      Result.isFailure(seen.asked) && seen.asked.failure instanceof PlanningRefused
        ? seen.asked.failure.reason
        : null,
    ).toBe(`${seen.key} is Ready: a prototype is asked for in Planning.`)
    expect(seen.told).toEqual([])
  })
})

describe('A Spec change of the interface makes the Planner launch it', () => {
  test('the Planner is told to launch it when the Spec changes the interface, and its launch after such a change is taken', async () => {
    const { world, run } = prototyping([])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'spec_write_section', {
            section: 'decisions',
            content: 'The invoice list becomes two columns on every window.',
            base_version: 0,
          })
          const answer = yield* call(grantId, 'helper_launch', {
            helper: 'prototyper',
            brief: QUESTION,
          })
          yield* prototyperIn(mission.id, 1)
          yield* until(Effect.sync(() => promptsOf(world.agents[0]).length > 0))
          return { answer }
        }),
      ),
    )
    const words = (said: string) => said.replace(/\s+/g, ' ')
    expect(words(PLANNER_TEMPLATE)).toContain(words(PLANNER_PROTOTYPE_RULE))
    expect(words(PLANNER_PROTOTYPE_RULE)).toContain('when the Spec changes the interface')
    expect(seen.answer).toMatch(/^H1 launched: /)
    expect(promptsOf(world.agents[0])[0]).toContain(QUESTION)
  })

  test('the Planner launches only the Prototyper: a free helper is refused, naming the Probe', async () => {
    const { run } = prototyping([])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, grantId } = yield* plannedIn(project.id, main)
          const answer = yield* call(grantId, 'helper_launch', { brief: 'Write the list.' })
          return { answer, rows: yield* helperRowsOf(mission.id) }
        }),
      ),
    )
    expect(seen.answer).toBe(
      'refused: the Planner launches only the Prototyper; to run something, launch a Probe',
    )
    expect(seen.rows).toEqual([])
  })
})

describe('Its result is kept and shown, then frozen with the Spec', () => {
  test('its files land in evidence, its result reaches the Planner and the chip; running, then unjudged, it holds the Freeze; validated, it is frozen with the Spec', async () => {
    const { run } = prototyping([null, READING])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'helper_launch', { helper: 'prototyper', brief: QUESTION })
          const prototyper = yield* prototyperIn(mission.id, 1)
          yield* writeComplete(grantId)
          yield* call(grantId, 'declare_complete', { why: 'A Builder can build it.' })
          yield* readCold(mission.id, 1)
          const running = yield* freezeReadiness(mission.id)
          yield* callTool(prototyper.grantId, 'fs_write', {
            path: 'list.html',
            content: '<ul class="two-columns"></ul>\n',
          })
          const result = yield* call(prototyper.grantId, 'helper_result', RESULT)
          yield* until(
            Effect.map(
              deliveriesTo(prototyper.row.parentLineage, 'result'),
              (rows) => rows.length > 0,
            ),
          )
          const unjudged = yield* freezeReadiness(mission.id)
          const shown = yield* readHelper(prototyper.row.id, false)
          yield* judgePrototype(prototyper.row.id, 'validated', 'Keep the two columns.')
          const judged = yield* freezeReadiness(mission.id)
          const chips = yield* listHelpers(mission.id)
          const frozen = yield* freezeMission(mission.id, (yield* readSpec(mission.id)).version)
          return {
            running,
            result,
            delivered: yield* deliveriesTo(prototyper.row.parentLineage, 'result'),
            unjudged,
            shown,
            judged,
            chips,
            frozen,
            evidence: yield* listEvidence(mission.id, null),
          }
        }),
      ),
    )
    expect(seen.running.unsettled).toEqual([`Prototyper H1 runs: ${QUESTION}`])
    expect(seen.result).toBe('Your result is kept and handed to your parent. End your turn now.')
    expect(seen.delivered[0]?.body).toContain('H1 (Prototyper) handed back its result')
    expect(seen.evidence.map((one) => one.name)).toEqual(['H1/list.html'])
    expect(seen.unjudged.unsettled).toEqual([`Prototyper H1 waits for your verdict: ${QUESTION}`])
    expect(seen.shown).toMatchObject({ state: 'done', verdict: null })
    expect(seen.shown.result).toContain('The two columns hold at 480 pixels.')
    expect(seen.shown.result).toContain('H1/list.html')
    expect(seen.judged.ready).toBe(true)
    expect(seen.chips[0]).toMatchObject({ state: 'done', verdict: 'validated' })
    expect(seen.frozen.stage).toBe('ready')
    expect(seen.frozen.freeze?.prototypes).toEqual([
      {
        helper: 'H1',
        question: QUESTION,
        verdict: 'validated',
        note: 'Keep the two columns.',
        result: seen.shown.result,
      },
    ])
  })

  test('judged before it handed back its result, it is refused; set aside, it holds nothing and the latest verdict stands', async () => {
    const { run } = prototyping([])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'helper_launch', { helper: 'prototyper', brief: QUESTION })
          const prototyper = yield* prototyperIn(mission.id, 1)
          const early = yield* judgePrototype(prototyper.row.id, 'validated', null).pipe(
            Effect.result,
          )
          yield* callTool(prototyper.grantId, 'fs_write', { path: 'list.html', content: '<ul/>\n' })
          yield* call(prototyper.grantId, 'helper_result', RESULT)
          yield* until(Effect.map(listHelpers(mission.id), (chips) => chips[0]?.state === 'done'))
          yield* judgePrototype(prototyper.row.id, 'validated', null)
          yield* judgePrototype(prototyper.row.id, 'set-aside', 'Too narrow.')
          return {
            early,
            chips: yield* listHelpers(mission.id),
            shown: yield* readHelper(prototyper.row.id, false),
            readiness: yield* freezeReadiness(mission.id),
          }
        }),
      ),
    )
    expect(
      Result.isFailure(seen.early) && seen.early.failure instanceof PlanningRefused
        ? seen.early.failure.reason
        : null,
    ).toBe('H1 has no result to judge yet.')
    expect(seen.chips[0]).toMatchObject({ verdict: 'set-aside' })
    expect(seen.shown.verdictNote).toBe('Too narrow.')
    expect(seen.readiness.unsettled.filter((one) => one.includes('Prototyper'))).toEqual([])
  })
})

describe('The Planning page shows it as it shows a Probe', () => {
  test('a running Prototyper’s chip carries its latest step; once it ended, none', async () => {
    const hold = held()
    let between = 0
    const trying: FakeScript = {
      turns: [
        [{ does: 'calls', call: { id: 'toolu_try', title: 'Write list.html' } }, says('Trying.')],
      ],
      steps: [says('Working.')],
      // Its first call goes; the turn is then held, so its step stays the latest.
      between: () => (between++ === 0 ? Promise.resolve() : hold.promise),
    }
    const { run } = prototyping([trying])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'helper_launch', { helper: 'prototyper', brief: QUESTION })
          const prototyper = yield* prototyperIn(mission.id, 1)
          yield* until(
            Effect.map(listHelpers(mission.id), (chips) => chips[0]?.step === 'Write list.html'),
          )
          const changed = yield* helperChanges(mission.id).pipe(Stream.runHead)
          yield* callTool(prototyper.grantId, 'fs_write', { path: 'list.html', content: '<ul/>\n' })
          yield* call(prototyper.grantId, 'helper_result', RESULT)
          return { changed, ended: yield* listHelpers(mission.id) }
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => hold.release()))),
    )
    expect(Option.getOrNull(seen.changed)?.[0]).toMatchObject({
      name: 'Prototyper',
      state: 'running',
      step: 'Write list.html',
    })
    expect(seen.ended[0]).toMatchObject({ state: 'done', step: null })
  })
})

describe('The Prototyper never writes outside its folder', () => {
  test('it writes only in missions/<key>/prototypes/1/, reads the main checkout, and leaves it unchanged', async () => {
    const { run } = prototyping([])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acmeAt(work)
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'helper_launch', { helper: 'prototyper', brief: QUESTION })
          const prototyper = yield* prototyperIn(mission.id, 1)
          const own = yield* callTool(prototyper.grantId, 'fs_write', {
            path: 'list.html',
            content: '<ul class="two-columns"></ul>\n',
          })
          const checkout = yield* callTool(prototyper.grantId, 'fs_write', {
            repository: 'api',
            path: 'invoices.ts',
            content: 'overwritten\n',
          })
          const read = yield* callTool(prototyper.grantId, 'fs_read', {
            repository: 'api',
            path: 'README.md',
          })
          const database = yield* Database
          return {
            key: (yield* getMission(mission.id)).key,
            api,
            own,
            checkout,
            read,
            requests: yield* database.select().from(permissionRequests),
          }
        }),
      ),
    )
    const folder = join(data, 'missions', seen.key, 'prototypes', '1')
    expect(seen.own.ok).toBe(true)
    expect(readFileSync(join(folder, 'list.html'), 'utf8')).toBe('<ul class="two-columns"></ul>\n')
    expect(seen.checkout.text).toBe(
      `refused: the Prototyper writes only in its own folder, ${folder}: the Workspace is read-only to it`,
    )
    expect(seen.read.ok).toBe(true)
    expect(seen.read.text).toContain('Acme api')
    expect(seen.requests).toEqual([])
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: seen.api, encoding: 'utf8' })
    expect(status.stdout).toBe('')
    expect(existsSync(folder)).toBe(true)
  })

  test('a symlink in its folder to a file outside is refused, naming it, and nothing is copied', async () => {
    const { run } = prototyping([])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'helper_launch', { helper: 'prototyper', brief: QUESTION })
          const prototyper = yield* prototyperIn(mission.id, 1)
          // What a command run in its folder could make: a link to a key outside it.
          const outside = join(work, 'key.pem')
          writeFileSync(outside, 'not-a-real-key')
          symlinkSync(outside, join(prototyper.row.folder, 'link.txt'))
          const answer = yield* call(prototyper.grantId, 'helper_result', {
            ...RESULT,
            files: ['link.txt'],
          })
          return {
            answer,
            evidence: yield* listEvidence(mission.id, null),
            rows: yield* helperRowsOf(mission.id),
          }
        }),
      ),
    )
    expect(seen.answer).toBe('refused: link.txt is not a file of your folder')
    expect(seen.evidence).toEqual([])
    expect(seen.rows.map((row) => row.state)).toEqual(['running'])
  })

  test('an absolute path outside its folder is refused, and nothing is copied', async () => {
    const { run } = prototyping([])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'helper_launch', { helper: 'prototyper', brief: QUESTION })
          const prototyper = yield* prototyperIn(mission.id, 1)
          const outside = join(work, 'notes.txt')
          writeFileSync(outside, 'outside')
          const answer = yield* call(prototyper.grantId, 'helper_result', {
            ...RESULT,
            files: [outside],
          })
          return { answer, outside, evidence: yield* listEvidence(mission.id, null) }
        }),
      ),
    )
    expect(seen.answer).toBe(`refused: ${seen.outside} is not a file of your folder`)
    expect(seen.evidence).toEqual([])
  })

  test('a result missing a field is refused naming it', async () => {
    const { run } = prototyping([])
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, grantId } = yield* plannedIn(project.id, main)
          yield* call(grantId, 'helper_launch', { helper: 'prototyper', brief: QUESTION })
          const prototyper = yield* prototyperIn(mission.id, 1)
          const missing = yield* call(prototyper.grantId, 'helper_result', {
            tried: 'A list.',
            works: [],
            files: [],
          })
          return { missing, rows: yield* helperRowsOf(mission.id) }
        }),
      ),
    )
    expect(seen.missing).toMatch(/^refused: the result does not read: /)
    expect(seen.missing).toContain('does_not_work')
    expect(seen.rows.map((row) => row.state)).toEqual(['running'])
  })
})
