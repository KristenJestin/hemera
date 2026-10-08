/**
 * A mission's budget (#41, CT-13, CT-14): its limits on launches (the sessions agents ask for),
 * business attempts and automatic rounds, copied from its Project when it was made, and what it
 * has spent of each. Every launch an agent asks for, every business attempt and every automatic
 * round spends first; past a limit the call is refused with a sentence the agent reads, a Journal
 * line is written, and the mission gets one decision need: raise the counter for this mission
 * (recommended) or keep the limit. The answer applies once. Never an overrun.
 */

import {
  BUDGET_COUNTERS,
  type BudgetCounter,
  type BudgetLimits,
  DecisionFields,
  KEEP_THE_LIMIT,
  MissionOwner,
  budgetQuestion,
  budgetSpentSentence,
  counterAsked,
  missionKey,
  raiseOption,
  raisedBy,
} from '@hemera/core/domain'
import { UnknownMission, UnknownProject } from '@hemera/ipc'
import { and, eq, sql } from 'drizzle-orm'
import { Effect, Predicate } from 'effect'

import type { NewEvent } from './journal.ts'
import { Cap } from './sessions/cap.ts'
import { missionUsage } from './sessions/usage.ts'
import { type NeedHandler, createNeedIn, needService } from './needs.ts'
import { Database, type EngineTransaction, refusedWhile } from './storage/database.ts'
import { missionSpent, missions, needs, projects, taskAttempts } from './storage/schema.ts'
import { type Mutation, mutate } from './transaction.ts'

/** The budget owns the decisions a spent counter makes: their answers come back here. */
export const BUDGET_NEEDS = needService('budget')

/** A mission's own limit of a counter, as the column that holds it. */
const missionLimit = (counter: BudgetCounter, limit: number) => {
  if (counter === 'launches') return { budgetLaunches: limit }
  return counter === 'attempts' ? { budgetAttempts: limit } : { budgetRounds: limit }
}

/**
 * A mission's limits and its key: its own, or its Project's for a mission made before the budget
 * existed. Read inside the transaction that spends.
 */
const limitsIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select({
        projectId: missions.projectId,
        keyPrefix: missions.keyPrefix,
        keyNumber: missions.keyNumber,
        launches: sql<number>`coalesce(${missions.budgetLaunches}, ${projects.budgetLaunches})`,
        attempts: sql<number>`coalesce(${missions.budgetAttempts}, ${projects.budgetAttempts})`,
        rounds: sql<number>`coalesce(${missions.budgetRounds}, ${projects.budgetRounds})`,
        projectLaunches: projects.budgetLaunches,
        projectAttempts: projects.budgetAttempts,
        projectRounds: projects.budgetRounds,
      })
      .from(missions)
      .innerJoin(projects, eq(projects.id, missions.projectId))
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission’s budget')))
    if (row === undefined) return yield* new UnknownMission({ id: missionId })
    const limits: BudgetLimits = {
      launches: row.launches,
      attempts: row.attempts,
      rounds: row.rounds,
    }
    const project: BudgetLimits = {
      launches: row.projectLaunches,
      attempts: row.projectAttempts,
      rounds: row.projectRounds,
    }
    return {
      projectId: row.projectId,
      key: missionKey(row.keyPrefix, row.keyNumber),
      limits,
      project,
    }
  })

const spentIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select()
      .from(missionSpent)
      .where(eq(missionSpent.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission’s budget'))),
    (rows) =>
      new Map(
        BUDGET_COUNTERS.map((counter) => [
          counter,
          rows.find((row) => row.counter === counter)?.spent ?? 0,
        ]),
      ),
  )

/** What a mission has spent of each counter, and its limits. */
export const budgetOf = (missionId: string) =>
  mutate('reading the mission’s budget', (transaction) =>
    Effect.gen(function* () {
      const { limits } = yield* limitsIn(transaction, missionId)
      const spent = yield* spentIn(transaction, missionId)
      return {
        result: BUDGET_COUNTERS.map((counter) => ({
          counter,
          spent: spent.get(counter) ?? 0,
          limit: limits[counter],
        })),
        events: [],
      }
    }),
  )

/** Whether a pending decision already asks about this counter of the mission. */
const askedAlready = (transaction: EngineTransaction, missionId: string, counter: BudgetCounter) =>
  Effect.map(
    transaction
      .select({ fields: needs.fields })
      .from(needs)
      .where(
        and(
          eq(needs.missionId, missionId),
          eq(needs.service, BUDGET_NEEDS),
          eq(needs.state, 'pending'),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the mission’s needs'))),
    (rows) => rows.some((row) => row.fields.includes(`"The ${counter} budget of `)),
  )

export type Spent = { readonly spent: true } | { readonly spent: false; readonly sentence: string }

/**
 * Spends one of a counter of a mission, or refuses: the sentence the agent reads, a Journal line,
 * and one decision need for the user, however many calls are refused before the answer.
 */
export const spendBudget = (missionId: string, counter: BudgetCounter) =>
  mutate('spending the mission’s budget', (transaction) =>
    spendBudgetIn(transaction, missionId, counter),
  )

/**
 * The same as `spendBudget`, inside a transaction a caller holds: what it spends, refuses and
 * asks is written with the caller's own change, or not at all.
 */
export const spendBudgetIn = (
  transaction: EngineTransaction,
  missionId: string,
  counter: BudgetCounter,
) =>
  Effect.gen(function* () {
    const decision = (key: string, by: number) =>
      DecisionFields.make({
        question: budgetQuestion(counter, key),
        options: [raiseOption(by), KEEP_THE_LIMIT],
        recommended: {
          option: raiseOption(by),
          reason: 'The mission stops short otherwise; the raise holds for this mission only.',
        },
      })
    const { projectId, key, limits, project } = yield* limitsIn(transaction, missionId)
    const spent = (yield* spentIn(transaction, missionId)).get(counter) ?? 0
    const limit = limits[counter]
    if (spent < limit) {
      yield* transaction
        .insert(missionSpent)
        .values({ missionId, counter, spent: 1 })
        .onConflictDoUpdate({
          target: [missionSpent.missionId, missionSpent.counter],
          set: { spent: sql`${missionSpent.spent} + 1` },
        })
        .pipe(Effect.mapError(refusedWhile('spending the mission’s budget')))
      const spentOne: Mutation<Spent> = { result: { spent: true }, events: [] }
      return spentOne
    }
    const sentence = budgetSpentSentence(counter, spent, limit)
    const refusedEvent: NewEvent = {
      type: 'budget.refused',
      entityKind: 'mission',
      entityId: missionId,
      source: 'system',
      author: 'hemera',
      payload: { missionId, counter, sentence },
    }
    const events: NewEvent[] = [refusedEvent]
    if (!(yield* askedAlready(transaction, missionId, counter))) {
      const owner = MissionOwner.make({ projectId, missionId, taskId: null })
      const write = yield* createNeedIn(
        BUDGET_NEEDS,
        owner,
        decision(key, Math.max(1, project[counter])),
      )
      const written = yield* write(transaction)
      events.push(...written.events)
    }
    const refusal: Mutation<Spent> = { result: { spent: false, sentence }, events }
    return refusal
  })

/**
 * A business attempt on a task (CT-14): counted per task whoever ran it, and spent from the
 * mission's attempts. The rule "three reds make an error need" is the verdict loop's (B4).
 */
export const recordAttempt = (taskId: string, missionId: string) =>
  Effect.gen(function* () {
    const verdict = yield* spendBudget(missionId, 'attempts')
    if (!verdict.spent) return { count: yield* attemptsOf(taskId), ...verdict }
    const count = yield* mutate('counting a task’s attempt', (transaction) =>
      transaction
        .insert(taskAttempts)
        .values({ taskId, missionId, count: 1 })
        .onConflictDoUpdate({
          target: taskAttempts.taskId,
          set: { count: sql`${taskAttempts.count} + 1` },
        })
        .returning({ count: taskAttempts.count })
        .pipe(
          Effect.mapError(refusedWhile('counting a task’s attempt')),
          Effect.map(([row]) => ({ result: row?.count ?? 1, events: [] })),
        ),
    )
    return { count, spent: true as const }
  })

/** How many business attempts a task has had. */
export const attemptsOf = (taskId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ count: taskAttempts.count })
      .from(taskAttempts)
      .where(eq(taskAttempts.taskId, taskId))
      .pipe(Effect.mapError(refusedWhile('reading a task’s attempts')))
    return row?.count ?? 0
  })

/** The answer to a spent counter: a raise, written in the answer's own transaction, once. */
export const budgetHandler: NeedHandler = {
  deliver: (need, transaction) =>
    Effect.gen(function* () {
      if (!Predicate.isTagged(need.fields, 'Decision')) return []
      if (!Predicate.isTagged(need.owner, 'Mission')) return []
      const counter = counterAsked(need.fields.question)
      const by = Predicate.isTagged(need.answer, 'Chosen') ? raisedBy(need.answer.option) : null
      if (counter === null || by === null) return []
      const missionId = need.owner.missionId
      const found = yield* limitsIn(transaction, missionId).pipe(
        Effect.catchTag('UnknownMission', () => Effect.succeed(null)),
      )
      if (found === null) return []
      const limit = found.limits[counter] + by
      yield* transaction
        .update(missions)
        .set(missionLimit(counter, limit))
        .where(eq(missions.id, missionId))
        .pipe(Effect.mapError(refusedWhile('raising the mission’s budget')))
      const raised: NewEvent = {
        type: 'budget.raised',
        entityKind: 'mission',
        entityId: missionId,
        source: 'ui',
        author: 'human',
        payload: { missionId, counter, limit },
      }
      return [raised]
    }),
}

/** A Project's cap and the budget its new missions start with. */
export const projectLimits = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .pipe(Effect.mapError(refusedWhile('reading the Project’s limits')))
    if (row === undefined) return yield* new UnknownProject({ id: projectId })
    return {
      cap: row.subAgentCap,
      budget: {
        launches: row.budgetLaunches,
        attempts: row.budgetAttempts,
        rounds: row.budgetRounds,
      },
    }
  })

/**
 * Sets a Project's cap and budget. A mission already made keeps the budget it started with; the
 * phases waiting for a slot take the ones a higher cap frees.
 */
export const setProjectLimits = (
  projectId: string,
  limits: { readonly cap: number; readonly budget: BudgetLimits },
) =>
  Effect.gen(function* () {
    const database = yield* Database
    const written = yield* database
      .update(projects)
      .set({
        subAgentCap: limits.cap,
        budgetLaunches: limits.budget.launches,
        budgetAttempts: limits.budget.attempts,
        budgetRounds: limits.budget.rounds,
      })
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id })
      .pipe(Effect.mapError(refusedWhile('writing the Project’s limits')))
    if (written.length === 0) return yield* new UnknownProject({ id: projectId })
    yield* Cap.use((cap) => cap.wake(projectId))
    return yield* projectLimits(projectId)
  })

/** A mission's budget, counter by counter, and its usage. */
export const missionBudget = (missionId: string) =>
  Effect.gen(function* () {
    const counters = yield* budgetOf(missionId)
    return { counters, usage: yield* missionUsage(missionId) }
  })
