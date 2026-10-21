/**
 * What the delivery's suites share (S1): fake step types over a world of the suite's own, Acme's
 * rules, a mission put in Shipping as Ship's transaction leaves it (its copies of the waves and
 * the End, its record with the repositories that changed, `mission.shipped`), and reading the
 * delivery, its needs and its Journal. No forge, no agent, no network.
 */

import type { DeliveryRulesDraft, RepositoryWaves } from '@hemera/core/domain'
import { ChosenAnswer, defaultDeliveryRules } from '@hemera/core/domain'
import type { DeliveryView, Need } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect, Predicate } from 'effect'

import { saveDeliveryRules, sectionCopier } from '../src/engine/delivery-rules.ts'
import { Deliveries } from '../src/engine/delivery/run.ts'
import {
  type StepAnswer,
  type StepAt,
  type StepType,
  done,
  notDone,
  waiting,
} from '../src/engine/delivery/steps.ts'
import { readEvents } from '../src/engine/journal.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { createMission } from '../src/engine/missions.ts'
import { answerNeed, pendingNeedsOf } from '../src/engine/needs.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import { deliveryPushes, missionShips, missions } from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { until } from './commands-engine.ts'

// ——— The fake steps and the world they read ———

/** What the fake steps find and do, by `repository/step`. */
export class World {
  /** What `check` and `watch` find; not there, a step is not done (`check`) or waits (`watch`). */
  readonly found = new Map<string, StepAnswer>()
  /** What `run` answers; `Done` by default, which the world then holds. */
  readonly answers = new Map<string, StepAnswer>()
  readonly checked: string[] = []
  readonly ran: string[] = []
  readonly watched: string[] = []
  /** What each run started and did not finish, the parallel runs a test holds. */
  readonly running = new Set<string>()
}

export const keyOf = (at: StepAt) => `${at.repository}/${at.step.id}`

export const fakeType = (world: World, options: Partial<StepType> = {}): StepType => ({
  postCondition: true,
  acts: true,
  forge: false,
  check: (at) =>
    Effect.sync(() => {
      world.checked.push(keyOf(at))
      return world.found.get(keyOf(at)) ?? notDone
    }),
  run: (at) =>
    Effect.sync(() => {
      world.ran.push(keyOf(at))
      const answer = world.answers.get(keyOf(at)) ?? done(`${at.step.id} of ${at.repository}`)
      if (Predicate.isTagged(answer, 'Done')) world.found.set(keyOf(at), answer)
      return answer
    }),
  watch: (at) =>
    Effect.sync(() => {
      world.watched.push(keyOf(at))
      return world.found.get(keyOf(at)) ?? waiting('Not there yet.')
    }),
  ...options,
})

/** The forge steps of the waves (S2 to S4's to come) as fake types over the world. */
export const typesOf = (world: World, over: ReadonlyArray<readonly [string, StepType]> = []) =>
  new Map<string, StepType>([
    ['merge', fakeType(world)],
    ['ci', fakeType(world)],
    ['published-version', fakeType(world)],
    ['bump', fakeType(world)],
    ...over,
  ])

// ——— Acme’s rules, a mission in Shipping ———

export interface Acme {
  readonly projectId: string
  readonly id: (path: string) => string
}

export const NO_CHANGE: RepositoryWaves['steps'] = { off: [], changed: [], added: [] }

export const repositoryWaves = (
  repositoryId: string,
  preset: RepositoryWaves['preset'],
  deliversAfter: ReadonlyArray<string> = [],
  steps: RepositoryWaves['steps'] = NO_CHANGE,
): RepositoryWaves => ({ repositoryId, preset, steps, deliversAfter })

/** The rules with these waves. */
export const rulesWith = (repositories: ReadonlyArray<RepositoryWaves>): DeliveryRulesDraft => {
  const base = defaultDeliveryRules()
  return { ...base, waves: { ...base.waves, repositories: [...repositories] } }
}

/**
 * A mission of Acme put in Shipping as Ship leaves it: its copies of the waves and the End, its
 * record with the repositories that changed, and `mission.shipped`, in one transaction.
 */
export const shipped = (
  world: Acme,
  rules: DeliveryRulesDraft,
  changed: ReadonlyArray<string>,
  /** The repositories whose push (#464) Ship hands in and that has not ended yet. */
  pushing: ReadonlyArray<string> = [],
  /** The mission shipped, when it exists already; a new one of Acme's otherwise. */
  existing: string | null = null,
) =>
  Effect.gen(function* () {
    yield* saveDeliveryRules(world.projectId, rules, 0)
    const mission =
      existing === null
        ? yield* createMission({
            projectId: world.projectId,
            idea: { sentence: 'Export the ledger as CSV', ticket: null },
          })
        : { id: existing }
    const copyIn = yield* sectionCopier(mission.id)
    const at = new Date().toISOString()
    yield* mutate('shipping a mission in a suite', (transaction) =>
      Effect.gen(function* () {
        const waves = yield* copyIn(transaction, 'waves')
        const end = yield* copyIn(transaction, 'end')
        yield* transaction
          .update(missions)
          .set({ stage: 'shipping' })
          .where(eq(missions.id, mission.id))
          .pipe(Effect.orDie)
        yield* transaction
          .insert(missionShips)
          .values({
            missionId: mission.id,
            checkpointId: 'checkpoint',
            trees: '[]',
            versions: '{}',
            confirmation: secretsRegistry().mask('{}'),
            changed: JSON.stringify(changed.map(world.id)),
            shippedAt: at,
            deliveredAt: null,
          })
          .pipe(Effect.orDie)
        for (const path of pushing) {
          yield* transaction
            .insert(deliveryPushes)
            .values({
              missionId: mission.id,
              repositoryId: world.id(path),
              repository: path,
              round: 1,
              state: 'waiting',
              updatedAt: at,
            })
            .pipe(Effect.orDie)
        }
        return {
          result: undefined,
          events: [
            ...waves.events,
            ...end.events,
            {
              type: 'mission.shipped',
              entityKind: 'mission',
              entityId: mission.id,
              source: 'ui',
              author: 'human',
              payload: {},
            } as const,
          ],
        }
      }),
    )
    return mission.id
  })

// ——— Reading the delivery ———

export const deliveryOf = (missionId: string) => Deliveries.use((one) => one.get(missionId))

export const stateOf = (view: DeliveryView | null, repository: string, step: string) =>
  view?.repositories
    .find((one) => one.repository === repository)
    ?.steps.find((one) => one.id === step)?.state

export const statusOf = (view: DeliveryView | null, repository: string) =>
  view?.repositories.find((one) => one.repository === repository)?.status

/** Reads the delivery until it is as asked; bounded, so a delivery that never gets there fails. */
export const deliveryUntil = (missionId: string, ready: (view: DeliveryView | null) => boolean) =>
  until(deliveryOf(missionId), ready)

export const needsOf = (missionId: string) =>
  Effect.map(pendingNeedsOf([missionId]), (all) => all.get(missionId) ?? [])

export const needUntil = (missionId: string, ready: (need: Need) => boolean) =>
  Effect.map(
    until(needsOf(missionId), (needs) => needs.some(ready)),
    (needs) => needs.find(ready),
  )

export const answer = (need: Need | undefined, option: string) =>
  need === undefined
    ? Effect.die(new Error('no need to answer'))
    : answerNeed({ id: need.id, key: `answer-${need.id}`, answer: ChosenAnswer.make({ option }) })

export const isDecision = (option: string) => (need: Need) =>
  Predicate.isTagged(need.fields, 'Decision') && need.fields.options.includes(option)

export const journalOf = (missionId: string, type: string) =>
  Effect.map(readEvents({ entity: { kind: 'mission', id: missionId }, limit: 1000 }), (page) =>
    page.events.filter((event) => event.type === type),
  )

export const delivered = (view: DeliveryView | null) => view?.status === 'delivered'
/** The delivery's lines of the mission's Journal, as the Memory wrote them. */
export const memoryLines = (missionId: string) =>
  Effect.gen(function* () {
    const memory = yield* Memory
    yield* memory.catchUp
    return (yield* memory.journal(missionId, null)).lines
      .filter((line) => line.kind === 'delivery' && !line.text.startsWith('Hemera copied'))
      .map((line) => line.text)
  })
