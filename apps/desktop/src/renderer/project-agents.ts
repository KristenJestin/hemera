/**
 * The agent and permission sections of a Project's settings (#53), as plain values and no React:
 * the commands never run (#36), the cap and the budget its new missions start with and the model
 * of each role at the Project's level (#41), and the instruction files of its repositories (#40).
 */

import {
  BUDGET_DEFAULTS,
  CAP,
  wordsOf,
  NeverProgram,
  type ModelSettingValue,
  type NeverEntry,
} from '@hemera/core/domain'
import type {
  AgentState,
  ModelMark,
  ProjectLimits,
  RepositoryInstructions,
  RoleModels,
} from '@hemera/ipc'
import { Predicate } from 'effect'
import {
  EFFORTS,
  type AgentInstructions,
  type BudgetLimit,
  type Effort,
  type ModelChoice,
  type NeverLine,
  type PickerAgent,
  type ProjectRoleModel,
  type RepositoryInstructions as RepositoryFiles,
} from '@hemera/ui'

import { pickerAgentsOf } from './chat-items.ts'

interface Named {
  readonly id: string
  readonly name: string
}

const lineOf = (entry: NeverEntry, catalogue: ReadonlyArray<Named>): string =>
  Predicate.isTagged(entry, 'Program')
    ? entry.words.join(' ')
    : (catalogue.find((one) => one.id === entry.commandId)?.name ?? entry.commandId)

/** The list's lines, each known by its place in the list. */
export const neverLinesOf = (
  entries: ReadonlyArray<NeverEntry>,
  catalogue: ReadonlyArray<Named>,
): NeverLine[] => entries.map((entry, at) => ({ id: String(at), line: lineOf(entry, catalogue) }))

/** What refuses a line before it is added: nothing written, or refused already. */
export function neverRefusalOf(
  line: string,
  entries: ReadonlyArray<NeverEntry>,
  catalogue: ReadonlyArray<Named>,
): string | undefined {
  const said = wordsOf(line).join(' ')
  if (said === '') return 'Write the command to refuse.'
  if (entries.some((entry) => lineOf(entry, catalogue) === said)) {
    return `“${said}” is already refused.`
  }
  return undefined
}

/** The list with a line added at its end, as a program and its words. */
export const withNever = (entries: ReadonlyArray<NeverEntry>, line: string): NeverEntry[] => {
  const [first, ...rest] = wordsOf(line)
  return first === undefined
    ? [...entries]
    : [...entries, NeverProgram.make({ words: [first, ...rest] })]
}

/** The list without the line of that row. */
export const withoutNever = (entries: ReadonlyArray<NeverEntry>, id: string): NeverEntry[] =>
  entries.filter((_, at) => String(at) !== id)

/** The limits as the section's fields, in its order. */
const LIMITS = [
  { id: 'cap', label: 'Sub-agents at once', fallback: CAP.initial },
  { id: 'launches', label: 'Launches', fallback: BUDGET_DEFAULTS.launches },
  { id: 'attempts', label: 'Automatic retries', fallback: BUDGET_DEFAULTS.attempts },
  { id: 'rounds', label: 'Automatic rounds', fallback: BUDGET_DEFAULTS.rounds },
] as const

type LimitId = (typeof LIMITS)[number]['id']

const valueOf = (limits: ProjectLimits, id: LimitId): number =>
  id === 'cap' ? limits.cap : limits.budget[id]

/** The cap, then the budget; a value equal to the application's reads as the field left empty. */
export const limitRowsOf = (limits: ProjectLimits): BudgetLimit[] =>
  LIMITS.map(({ id, label, fallback }) => {
    const value = valueOf(limits, id)
    return { id, label, value: value === fallback ? null : String(value), fallback }
  })

/** What refuses a field's value, in words; an empty field is the application's value. */
export function limitRefusal(id: string, value: string | null): string | undefined {
  if (value === null) return undefined
  const number = /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null
  if (id === 'cap') {
    return number !== null && number >= CAP.least && number <= CAP.most
      ? undefined
      : `Write a whole number from ${String(CAP.least)} to ${String(CAP.most)}.`
  }
  return number === null ? 'Write a whole number from 0 to 999.' : undefined
}

/** The limits with one field's value, the application's when it is emptied. */
export function limitsWith(limits: ProjectLimits, id: string, value: string | null): ProjectLimits {
  const limit = LIMITS.find((one) => one.id === id)
  if (limit === undefined) return limits
  const number = value === null ? limit.fallback : Number(value.trim())
  return limit.id === 'cap'
    ? { ...limits, cap: number }
    : { ...limits, budget: { ...limits.budget, [limit.id]: number } }
}

const isEffort = (effort: string | null): effort is Effort => EFFORTS.some((one) => one === effort)

/** A setting as the model picker holds it; the agent's own model is called "default". */
export const choiceOf = (setting: ModelSettingValue): ModelChoice => ({
  agent: setting.agent,
  model: setting.model ?? 'default',
  effort: isEffort(setting.effort) ? setting.effort : undefined,
})

/**
 * Each role's override in the Project, over the model the application gives it: read at the
 * application's level (`inApp`), since what the Project's role resolves to includes its override.
 */
export const projectRoleModelsOf = (
  roles: ReadonlyArray<RoleModels>,
  inApp: ReadonlyArray<RoleModels>,
): ProjectRoleModel[] =>
  roles.map((role) => {
    const app = inApp.find((one) => one.role === role.role)
    return {
      role: role.displayName,
      override: role.project === null ? null : choiceOf(role.project),
      appDefault: choiceOf(app?.resolved ?? role.app ?? role.resolved),
    }
  })

/** What the Instructions section shows. */
export interface InstructionsShown {
  readonly repositories: RepositoryFiles[]
  readonly agents: AgentInstructions[]
}

/** Each repository's instruction files, and the files each agent reads by itself. */
export function instructionsOf(
  rows: ReadonlyArray<RepositoryInstructions>,
  agents: ReadonlyArray<{ readonly id: string; readonly label: string }>,
): InstructionsShown {
  return {
    repositories: rows.map(({ repository, files }) => ({ repository, files: [...files] })),
    agents: agents.map(({ id, label }) => ({
      id,
      agent: label,
      reads: [
        ...new Set(
          rows.flatMap((row) =>
            row.agents.flatMap((one) =>
              one.agent === id && one.how === 'itself' && one.file !== null ? [one.file] : [],
            ),
          ),
        ),
      ],
    })),
  }
}

/** Runs a write; `kept` hears its answer, `refused` why the engine would not take it. */
export type LatestWrite = <A>(
  write: () => Promise<A>,
  kept: (answer: A) => void,
  refused: (failure: Error) => void,
) => void

/**
 * Writes one after the other: each starts once the one before has answered, so the engine takes
 * them in the order they were made. Only the latest one's answer is heard, the last change made
 * being the one shown; every refusal is heard, so none is dropped.
 */
export function latestWrites(): LatestWrite {
  let latest = 0
  let before: Promise<void> = Promise.resolve()
  return (write, kept, refused) => {
    latest += 1
    const mine = latest
    before = before.then(() =>
      write().then(
        (answer) => {
          if (mine === latest) kept(answer)
        },
        (failure: Error) => refused(failure),
      ),
    )
  }
}

/**
 * What the picker offers on the role rows: each agent's marked models, and the model every row
 * shows — a Project's override and the application's default — on its own agent, marked or not.
 */
export function rolePickerAgentsOf(
  agents: ReadonlyArray<Pick<AgentState, 'id' | 'label' | 'installed' | 'signedIn'>>,
  marks: ReadonlyArray<ModelMark>,
  roles: ReadonlyArray<RoleModels>,
  appRoles: ReadonlyArray<RoleModels>,
): PickerAgent[] {
  const settings = [
    ...roles.flatMap((role) => (role.project === null ? [] : [role.project])),
    ...appRoles.map((role) => role.resolved),
  ]
  // A setting with no model adds none: it only lists the agents when no row names a model.
  const plain = agents.slice(0, 1).map(({ id }) => ({ agent: id, model: null, effort: null }))
  const [first = [], ...rest] = [...settings, ...plain].map((setting) =>
    pickerAgentsOf(agents, marks, setting),
  )
  return first.map((agent, at) => ({
    id: agent.id,
    name: agent.name,
    unavailable: agent.unavailable,
    models: [
      ...new Map(
        [agent.models, ...rest.map((list) => list[at]?.models ?? [])]
          .flat()
          .map((model) => [model.id, model] as const),
      ).values(),
    ],
  }))
}
