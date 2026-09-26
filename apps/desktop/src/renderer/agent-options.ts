import type { ComposerChoice, ConfigOption } from '@hemera/ipc'
import { nativePermissionMode } from '@hemera/core'
import type { EffortChoice, ModeChoice, ModelChoice } from '@hemera/ui'

/**
 * What an agent announced, read as the one menu reads it (design D5-13, D17-11).
 *
 * Both composers carry the same control — the foot of a Session, where the agent is the one the
 * Session was made with, and the composer of a Project's Home, where the agent is being chosen
 * (D5-17) — and both are handed the same list: the options the agent itself published, under the
 * words it published them with. Which of them exists is the agent's answer rather than a rule
 * here, and a stage nothing was announced for is no stage at all.
 *
 * What an option is on is read off the option and never remembered: the engine answers the list
 * again after every choice, and the effort a model only publishes once it has been picked is in
 * that answer and nowhere else.
 */

/** The agent's own word for the models it offers, or the id when it names no category. */
const MODEL = ['model']

/** The three words the agents use for how hard they are asked to think. */
const EFFORT = ['thought_level', 'effort', 'reasoning']

/** The agent's own word for what it may do without asking. */
const MODE = ['mode']

/** What separates a provider from its model in a label like `OpenCode Go/DeepSeek V4.1 Flash`. */
const GROUPED = '/'

/**
 * One stage of the menu: the option it sets, what it offers, and what the agent is on.
 *
 * The option's own id travels with it because that is what a choice is sent back under: the
 * agent names its options, and a control that sent `model` to an agent that called it something
 * else would be a control setting nothing.
 */
export interface Stage<Choice> {
  optionId: string
  choices: Choice[]
  /** What the agent says it is on, or null when it says nothing. */
  current: string | null
}

/** The option an agent offers under one of its own names, or nothing when it offers none. */
function optionOf(options: readonly ConfigOption[], names: readonly string[]): ConfigOption | null {
  for (const option of options) {
    if (names.includes(option.category ?? '') || names.includes(option.id)) return option
  }
  return null
}

/** What the agent is on, or null when it answered nothing at all. */
function currentOf(option: ConfigOption): string | null {
  return option.current === '' ? null : option.current
}

/**
 * One model, under the provider the agent named it with.
 *
 * An agent that publishes several providers writes them into the label — `OpenCode
 * Go/DeepSeek V4.1 Flash` — and the menu groups by what stands before the first slash. One that
 * publishes its own models alone writes no slash, and the list is then drawn without a header.
 */
function modelOf(value: ConfigOption['values'][number]): ModelChoice {
  const cut = value.name.indexOf(GROUPED)
  if (cut === -1) {
    return {
      id: value.value,
      label: value.name,
      description: value.description,
      recommended: value.recommended,
    }
  }
  return {
    id: value.value,
    group: value.name.slice(0, cut).trim(),
    label: value.name.slice(cut + GROUPED.length).trim(),
    description: value.description,
    recommended: value.recommended,
  }
}

export function modelStage(options: readonly ConfigOption[]): Stage<ModelChoice> | null {
  const option = optionOf(options, MODEL)
  if (option === null) return null
  return { optionId: option.id, choices: option.values.map(modelOf), current: currentOf(option) }
}

export function effortStage(options: readonly ConfigOption[]): Stage<EffortChoice> | null {
  const option = optionOf(options, EFFORT)
  if (option === null) return null
  return {
    optionId: option.id,
    choices: option.values.map((value) => ({
      id: value.value,
      label: value.name,
      // The agent's own sentence about the level and the level it advises, both as they came:
      // what `Default` stands for is the agent's to say, and the menu's to draw (D17-11).
      description: value.description,
      recommended: value.recommended,
    })),
    current: currentOf(option),
  }
}

export function modeStage(options: readonly ConfigOption[]): Stage<ModeChoice> | null {
  const option = optionOf(options, MODE)
  if (option === null) return null
  return {
    optionId: option.id,
    choices: option.values.map((value) => ({
      id: value.value,
      label: value.name,
      permission: nativePermissionMode(option, value.value),
    })),
    current: currentOf(option),
  }
}

/**
 * The level the effort scale marks as the default: the one the agent recommends, or null when
 * it recommends none, and then the scale draws no rule.
 *
 * Read off the recommendation and never off the level the agent announces it is on. That level
 * is not the model's: Claude Code announces the effort its own settings set for every model it
 * is switched to, and a rule drawn there marks that setting as each model's default (trial of
 * 23 September 2026). The recommendation comes with the effort option, which the agent
 * announces again after every choice, so the rule is always the one of the model on screen.
 */
export function effortDefaultOf(options: readonly ConfigOption[]): string | null {
  return effortStage(options)?.choices.find((choice) => choice.recommended === true)?.id ?? null
}

/**
 * The effort to put the agent on once its model has changed, or null when it stays where it is.
 *
 * While nobody has chosen an effort, a new model takes the level it recommends: an agent left to
 * itself keeps whatever its own settings say — Claude Code stays on the effort its settings set
 * for every model — and a thumb left there reads as the new model's default when it is not
 * (decided 23 September 2026). An effort chosen is kept across the models, and a model that
 * recommends no level, or announces no effort at all, leaves the agent where it is.
 */
export function effortToLand(
  options: readonly ConfigOption[],
  chosen: boolean,
): { optionId: string; value: string } | null {
  if (chosen) return null
  const stage = effortStage(options)
  const advised = effortDefaultOf(options)
  if (stage === null || advised === null || stage.current === advised) return null
  return { optionId: stage.optionId, value: advised }
}

/**
 * Which agent a Home's composer stands on: the one picked in it, or the one the Project was
 * left on (design D5-17).
 *
 * A pick wins over the preference and never the other way round. The preferences are read while
 * the window is opening, so the answer can arrive after the Home is on screen — and a preference
 * landing on a menu the reader is already using would move it under their hand.
 *
 * The agent alone is read from it. The model, the effort and the mode of that agent are the
 * agent's own answer: the engine seeds the agent it starts from this same preference, so what
 * the menu shows under the agent is what the agent announces it is on, which is what was chosen
 * in this Project last time.
 */
export function openingAgentOf(
  choice: ComposerChoice | null,
  picked: string | null,
): string | null {
  return picked ?? choice?.provider ?? null
}
