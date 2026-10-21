/**
 * The Agent step of the delivery (S1): one fresh session of the Delivery role in the repository's
 * worktree, its brief, its report, and the frozen tree it may not change behind the user's back.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent: Acme's `api` and `web`
 * launched into Building, the Building's sessions stopped, then the mission put in Shipping as
 * Ship's transaction leaves it. The forge steps around the Agent step are fake types; no forge,
 * no real agent, no network.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { DeliveryAction } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { DISCARD, KEEP } from '../src/engine/delivery/agent-step.ts'
import { Diffs } from '../src/engine/review/diffs.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { deliverySteps } from '../src/engine/storage/schema.ts'
import { builderOf, launched } from './builder-world.ts'
import { QUIET, READING, says, uses } from './building-world.ts'
import {
  type Acme,
  NO_CHANGE,
  World,
  answer,
  delivered,
  deliveryUntil,
  isDecision,
  needUntil,
  repositoryWaves,
  rulesWith,
  shipped,
  statusOf,
  typesOf,
} from './delivery-world.ts'
import { until } from './commands-engine.ts'
import { HELPER, held, sessionsEngine, text, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = temporaryFolder('delivery-agent')
  work = temporaryFolder('delivery-agent-work')
})
afterEach(removeFolders)

/** Every test runs a whole engine, Git, a Builder and a Delivery agent: far above its time alone. */
const SLOW = 180_000

const NOTES: DeliveryAction = {
  id: 'notes',
  kind: 'agent',
  mode: 'auto',
  task: 'Write the release notes in the pull request description',
}

/** The Agent step first in `api`'s steps, then the preset's merge and CI. */
const withAgent = (company: Acme) =>
  rulesWith([
    repositoryWaves(company.id('api'), 'application', [], {
      ...NO_CHANGE,
      added: [{ after: null, step: NOTES }],
    }),
    repositoryWaves(company.id('web'), 'application'),
  ])

interface Delivering {
  /** The agents after this one are the Delivery agent's: it reports what the test says. */
  readonly from: (index: number) => void
}

/**
 * The engine with the cold read reading, every other agent quiet until the test says the next one
 * is the Delivery agent's: that one holds its turn until the test lets it go, then reports.
 */
const deliveryEngine = (
  world: World,
  report: { readonly outcome: 'done' | 'failed'; readonly summary: string } | null,
) => {
  const turn = held()
  let first = Number.POSITIVE_INFINITY
  const script = (index: number): FakeScript =>
    index === 0
      ? READING
      : index < first
        ? QUIET
        : {
            turns: [
              report === null
                ? [says('I looked at it.')]
                : [uses('toolu_report', 'delivery_step_report', { ...report }), says('Reported.')],
            ],
            steps: [says('Done.')],
            between: () => turn.promise,
          }
  const engine = sessionsEngine(data, script, {
    roles: [HELPER],
    tools: { home: work },
    deliveries: { types: typesOf(world), pollEvery: '1 hour' },
  })
  const delivering: Delivering = { from: (index) => (first = index) }
  return { engine, release: turn.release, delivering }
}

/**
 * Acme's mission launched into Building, its sessions stopped, then shipped with these rules,
 * `api` changed: the mission's id, `api`'s worktree, and the Delivery agent's session once it runs.
 */
const shippedWithAgent = (engine: ReturnType<typeof sessionsEngine>, delivering: Delivering) =>
  Effect.gen(function* () {
    const { project, mission } = yield* launched(work)
    yield* builderOf(mission.id)
    yield* Sessions.use((sessions) =>
      sessions.stopTree({ kind: 'mission', missionId: mission.id }, 'the Building ended'),
    )
    const company: Acme = {
      projectId: project.id,
      id: (path) => project.repositories.find((one) => one.path === path)?.id ?? path,
    }
    delivering.from(engine.world.agents.length)
    yield* shipped(company, withAgent(company), ['api'], [], mission.id)
    const places = yield* Diffs.use((diffs) => diffs.places(mission.id))
    const api = places?.find((one) => one.name === 'api')?.folder ?? ''
    const session = yield* Effect.map(
      until(
        sessionsIn(['starting', 'working', 'idle'], { kind: 'mission', missionId: mission.id }),
        (rows) => rows.some((row) => row.role === 'delivery'),
        60_000,
      ),
      (rows) => rows.find((row) => row.role === 'delivery'),
    )
    return { missionId: mission.id, api, session }
  })

const stepRow = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(deliverySteps)
      .where(eq(deliverySteps.missionId, missionId))
      .pipe(Effect.orDie)
    return rows.find((row) => row.stepId === 'notes')
  })

describe('an Agent step', () => {
  test(
    'an Agent step runs one fresh Delivery session in the repository’s worktree, with its brief, and is done once it reports done',
    async () => {
      const world = new World()
      const { engine, release, delivering } = deliveryEngine(world, {
        outcome: 'done',
        summary: 'Release notes written; not verified on the forge.',
      })
      const seen = await engine.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api, session } = yield* shippedWithAgent(engine, delivering)
            release()
            const view = yield* deliveryUntil(
              missionId,
              (one) => statusOf(one, 'api') === 'delivered',
            )
            const ended = yield* until(
              sessionsIn(['starting', 'working', 'idle'], { kind: 'mission', missionId }),
              (rows) => rows.every((row) => row.role !== 'delivery'),
            )
            return { view, api, session, ended }
          }),
        ),
      )
      expect(seen.session?.folder).toBe(seen.api)
      const prompt = text(engine.world.agents.at(-1)?.answers.prompts[0] ?? [])
      expect(prompt).toContain('Delivery · ')
      expect(prompt).toContain(`Step: notes · ${NOTES.kind === 'agent' ? NOTES.task : ''}`)
      expect(prompt).toContain(`Repository: api · worktree ${seen.api}`)
      expect(prompt).toContain('The tree was frozen at Ship (')
      expect(prompt).toContain('Spec: frozen; spec_read for the full text.')
      const notes = seen.view?.repositories.find((one) => one.repository === 'api')?.steps[0]
      expect(notes?.outcome).toBe('Release notes written; not verified on the forge.')
      // Its session ended with the step.
      expect(seen.ended.some((row) => row.role === 'delivery')).toBe(false)
    },
    SLOW,
  )

  test(
    'an Agent step that reports failed fails with its summary',
    async () => {
      const world = new World()
      const { engine, release, delivering } = deliveryEngine(world, {
        outcome: 'failed',
        summary: 'The pull request has no description field I can write.',
      })
      const view = await engine.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* shippedWithAgent(engine, delivering)
            release()
            return yield* deliveryUntil(missionId, (one) => statusOf(one, 'api') === 'failed')
          }),
        ),
      )
      const notes = view?.repositories.find((one) => one.repository === 'api')?.steps[0]
      expect(notes?.message).toBe('The pull request has no description field I can write.')
      expect(world.ran.filter((key) => key.startsWith('api/'))).toEqual([])
    },
    SLOW,
  )

  test(
    'an Agent step whose session ends its turn without a report fails',
    async () => {
      const world = new World()
      const { engine, release, delivering } = deliveryEngine(world, null)
      const view = await engine.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* shippedWithAgent(engine, delivering)
            release()
            return yield* deliveryUntil(missionId, (one) => statusOf(one, 'api') === 'failed')
          }),
        ),
      )
      const notes = view?.repositories.find((one) => one.repository === 'api')?.steps[0]
      expect(notes?.message).toBe('The session ended its turn without delivery_step_report.')
    },
    SLOW,
  )

  test(
    'an Agent step that changes a file opens the frozen-tree decision need; Discard restores the tree it started from',
    async () => {
      const world = new World()
      const { engine, release, delivering } = deliveryEngine(world, {
        outcome: 'done',
        summary: 'Release notes written.',
      })
      const seen = await engine.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* shippedWithAgent(engine, delivering)
            const readme = readFileSync(join(api, 'README.md'), 'utf8')
            writeFileSync(join(api, 'README.md'), `${readme}Released.\n`)
            writeFileSync(join(api, 'RELEASE.md'), 'Release notes\n')
            release()
            const need = yield* needUntil(missionId, isDecision(DISCARD))
            const ranBefore = [...world.ran]
            yield* answer(need, DISCARD)
            const view = yield* deliveryUntil(missionId, delivered)
            return { need, ranBefore, view, api, readme }
          }),
        ),
      )
      const fields = seen.need?.fields
      expect(Predicate.isTagged(fields, 'Decision') && fields.options).toEqual([DISCARD, KEEP])
      expect(Predicate.isTagged(fields, 'Decision') && fields.recommended?.option).toBe(DISCARD)
      const question = Predicate.isTagged(fields, 'Decision') ? fields.question : ''
      expect(question).toContain('README.md')
      expect(question).toContain('+ Released.')
      expect(question).toContain('RELEASE.md')
      // Nothing after the Agent step ran while the user had not decided.
      expect(seen.ranBefore).toEqual([])
      expect(readFileSync(join(seen.api, 'README.md'), 'utf8')).toBe(seen.readme)
      expect(existsSync(join(seen.api, 'RELEASE.md'))).toBe(false)
      const notes = seen.view?.repositories.find((one) => one.repository === 'api')?.steps[0]
      expect(notes?.outcome).toBe('changes discarded')
    },
    SLOW,
  )

  test(
    'Keep them and push them to the pull request keeps the changed tree as the accepted one',
    async () => {
      const world = new World()
      const { engine, release, delivering } = deliveryEngine(world, {
        outcome: 'done',
        summary: 'Release notes written.',
      })
      const seen = await engine.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* shippedWithAgent(engine, delivering)
            writeFileSync(join(api, 'RELEASE.md'), 'Release notes\n')
            release()
            const need = yield* needUntil(missionId, isDecision(KEEP))
            yield* answer(need, KEEP)
            yield* deliveryUntil(missionId, delivered)
            return { row: yield* stepRow(missionId), api }
          }),
        ),
      )
      expect(existsSync(join(seen.api, 'RELEASE.md'))).toBe(true)
      expect(seen.row?.acceptedTree).not.toBeNull()
      expect(seen.row?.acceptedTree).not.toBe(seen.row?.startTree)
      expect(seen.row?.outcome).toBe('changes kept: Release notes written.')
    },
    SLOW,
  )
})
