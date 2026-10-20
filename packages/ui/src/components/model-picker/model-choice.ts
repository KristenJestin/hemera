/** What a model picker chooses among, and the words of a choice. */

export const EFFORTS = ['low', 'medium', 'high', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export interface PickerModel {
  id: string
  name: string
  /** The efforts the model accepts, lowest first; none when it takes no effort. */
  efforts?: readonly Effort[] | undefined
  /** The effort the model runs at when none is chosen, when the agent says which. */
  defaultEffort?: Effort | undefined
  favourite?: boolean | undefined
  hidden?: boolean | undefined
}

/** An agent this machine has, and the models it offers. */
export interface PickerAgent {
  id: string
  name: string
  models: readonly PickerModel[]
  /** Whether its models are still on their way: the list shows rows of their shape meanwhile. */
  loading?: boolean | undefined
  /** Why its models could not be read, in words: said in the list's room, beside Retry. */
  error?: string | undefined
  /** Why it cannot be chosen now (not signed in, say): its mark is there, disabled, this its tooltip. */
  unavailable?: string | undefined
}

export interface ModelChoice {
  agent: string
  model: string
  /** Left out: the model's own default. */
  effort?: Effort | undefined
}

/** Who answers the permissions an agent asks for: the user, or Hemera Auto. */
export type Judge = 'you' | 'auto'

/** The words of a choice, as the trigger's name and tooltip say them. */
export function choiceWords(
  agents: readonly PickerAgent[],
  choice: ModelChoice,
  judge: Judge = 'you',
): string {
  const agent = agents.find((one) => one.id === choice.agent)
  const model = agent?.models.find((one) => one.id === choice.model)
  return [
    agent?.name ?? choice.agent,
    model?.name ?? choice.model,
    choice.effort === undefined ? null : `effort ${choice.effort}`,
    judge === 'auto' ? 'Hemera Auto judges permissions' : null,
    agent !== undefined && model === undefined ? `${agent.name} no longer offers this model` : null,
  ]
    .filter((word) => word !== null)
    .join(' · ')
}
