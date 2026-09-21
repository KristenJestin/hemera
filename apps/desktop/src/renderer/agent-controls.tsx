import type { ReactNode } from 'react'

import type { ConfigOption } from '@hemera/ipc'
import { EffortSelector, ModeSelector, ModelSelector, type AgentChoice } from '@hemera/ui'

/**
 * The agent's own controls, in the words it announced them (design D5-13, D17-11).
 *
 * Both composers that carry them read this: the foot of a Session, where the agent is the one the
 * Session was made with, and the composer of a Project's Home, where the agent is being chosen and
 * what it offers is what the choice is about (D5-17). Which of the three exists is the agent's
 * answer rather than a rule here — an agent that announced no models has nothing to choose, and a
 * control drawn empty would promise a choice that does not exist.
 *
 * The value is read through `valueOf` and not off the option, because the two pages keep it
 * differently: a Session asks the agent what it is on, and the Home holds what was picked against
 * the Session that does not exist yet.
 */

/** The option an agent offers under one of its own names, or nothing when it has no such one. */
export function choicesOf(
  options: readonly ConfigOption[],
  names: readonly string[],
): ConfigOption | null {
  for (const option of options) {
    if (names.includes(option.category ?? '') || names.includes(option.id)) return option
  }
  return null
}

/** One of an agent's options, as the three selectors read their own. */
export function asChoices(option: ConfigOption | null): readonly AgentChoice[] {
  if (option === null) return []
  return option.values.map((value) => ({ id: value.value, name: value.name }))
}

/**
 * The model, the effort and the mode of one agent, ready to be handed to a composer.
 *
 * `agent` names the agent the models belong to and is only ever used for its mark. `valueOf` is
 * what the control shows, and `choose` is told which of the agent's own options was moved to
 * which of its own values — never a sentence Hemera wrote.
 */
export function controlsOf(
  agent: string,
  options: readonly ConfigOption[],
  valueOf: (option: ConfigOption) => string,
  choose: (optionId: string, value: string) => void,
): ReactNode {
  const model = choicesOf(options, ['model'])
  const effort = choicesOf(options, ['thought_level', 'effort', 'reasoning'])
  const mode = choicesOf(options, ['mode'])
  return (
    <>
      {model === null ? null : (
        <ModelSelector
          agent={agent}
          models={asChoices(model)}
          value={valueOf(model)}
          onValueChange={(chosen) => choose(model.id, chosen)}
        />
      )}
      {effort === null ? null : (
        <EffortSelector
          efforts={asChoices(effort)}
          value={valueOf(effort)}
          onValueChange={(chosen) => choose(effort.id, chosen)}
        />
      )}
      {mode === null ? null : (
        <ModeSelector
          modes={asChoices(mode)}
          value={valueOf(mode)}
          onValueChange={(chosen) => choose(mode.id, chosen)}
        />
      )}
    </>
  )
}
