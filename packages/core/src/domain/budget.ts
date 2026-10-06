/**
 * Which agent and model a role gets, how many sub-agents a Project runs at once, and how much a
 * mission may spend (#41): the cascade's rule, the cap's bounds, the budget's first guesses, the
 * counters, and the sentences an agent and the user read.
 */

import { Schema } from 'effect'

import { AgentProvider } from './agents.ts'

/** A role's setting at one level: an agent, a model, an effort (none when the agent has none). */
export const ModelSettingValue = Schema.Struct({
  agent: AgentProvider,
  /** Null: the agent's own default model. */
  model: Schema.NullOr(Schema.String),
  /** Null: the model's own default effort, or one that takes none. */
  effort: Schema.NullOr(Schema.String),
})
export type ModelSettingValue = typeof ModelSettingValue.Type

/** The levels of the cascade, the least precise first. */
export const SETTING_LEVELS = ['app', 'project', 'mission'] as const
export const SettingLevel = Schema.Literals(SETTING_LEVELS)
export type SettingLevel = typeof SettingLevel.Type

/**
 * The setting a role's next session gets: the most precise level that is set wins; an unset level
 * (null) inherits. The app level always holds one.
 */
export const resolveSetting = (
  app: ModelSettingValue,
  project: ModelSettingValue | null,
  mission: ModelSettingValue | null,
): ModelSettingValue & { readonly level: SettingLevel } =>
  mission !== null
    ? { ...mission, level: 'mission' }
    : project !== null
      ? { ...project, level: 'project' }
      : { ...app, level: 'app' }

/** The Project's cap of simultaneous sub-agents: its bounds and its default (open point 68). */
export const CAP = { least: 1, most: 6, initial: 3 } as const

export const CapValue = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: CAP.least, maximum: CAP.most }),
)

/** What a mission's budget counts (CT-13, CT-14). */
export const BUDGET_COUNTERS = ['launches', 'attempts', 'rounds'] as const
export const BudgetCounter = Schema.Literals(BUDGET_COUNTERS)
export type BudgetCounter = typeof BudgetCounter.Type

/**
 * The limits of a mission, copied from its Project at its creation: a first guess, to revisit once
 * real missions have run (open point 68).
 */
export const BUDGET_DEFAULTS: Readonly<Record<BudgetCounter, number>> = {
  launches: 8,
  attempts: 30,
  rounds: 3,
}

export const BudgetLimits = Schema.Struct({
  launches: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  attempts: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  rounds: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
export type BudgetLimits = typeof BudgetLimits.Type

/** What an agent reads when its launch is above the cap. */
export const capRefusal = (running: number, cap: number): string =>
  `${String(running)} sub-agents already run in this Project (the cap is ${String(cap)}); do the work yourself or wait`

/** What Now says of a Hemera phase waiting for a slot. */
export const slotWaitSentence = (inUse: number, cap: number): string =>
  `waiting for a free slot (${String(inUse)} of ${String(cap)} in use)`

/** What an agent reads when a counter of its mission is spent. */
export const budgetSpentSentence = (counter: BudgetCounter, spent: number, limit: number): string =>
  `the ${counter} of this mission are spent (${String(spent)} of ${String(limit)})`

/** How many replacements of one lineage within the window make an error need (CT-14). */
export const REPLACEMENTS_ALLOWED = 2
export const REPLACEMENT_WINDOW_MINUTES = 30

/** The question of the decision a spent counter makes: "The launches budget of ACME-12 is spent". */
export const budgetQuestion = (counter: BudgetCounter, missionKey: string): string =>
  `The ${counter} budget of ${missionKey} is spent`

/** The counter a budget decision is about, read back from its question; null for another one. */
export const counterAsked = (question: string): BudgetCounter | null =>
  BUDGET_COUNTERS.find((counter) => question.startsWith(`The ${counter} budget of `)) ?? null

/** The recommended answer: raise the counter by `by` for this mission only. */
export const raiseOption = (by: number): string => `Raise it by ${String(by)} for this mission`

export const KEEP_THE_LIMIT = 'Keep the limit'

/** How much an answer raises the counter by; null for "Keep the limit" or any other answer. */
export const raisedBy = (option: string): number | null => {
  const match = /^Raise it by (\d+) for this mission$/.exec(option)
  return match?.[1] === undefined ? null : Number(match[1])
}
