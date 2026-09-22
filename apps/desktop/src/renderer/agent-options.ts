import type { ComposerChoice, ConfigOption } from '@hemera/ipc'
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
    choices: option.values.map((value) => ({ id: value.value, label: value.name })),
    current: currentOf(option),
  }
}

/**
 * The effort each model puts a composer on by itself, which is that model's own default.
 *
 * It is not what the agent advises. Claude announces one `recommended` effort for every model —
 * `Medium`, a generic advice — while the effort it lands on when the model changes is the
 * model's own: `Xhigh` for Opus, `High` for Fable (probe of 22 September 2026).
 *
 * Only while nothing is pinned, though. Once an effort has been chosen, Claude Code pins it and
 * keeps it across model changes, so the effort it announces after a model change is then the
 * user's pin and not the model's default (its adapter, `effortPinnedLevel`). A model visited
 * before the first choice teaches its default and keeps it; a model first visited after it
 * teaches nothing, and the scale draws no rule for it rather than one where the user clicked.
 * Read off the announcements and kept nowhere else: nothing of it is persisted.
 */
export interface ModelDefaults {
  /** The effort each model landed on by itself, per model id. */
  byModel: ReadonlyMap<string, string>
  /** Whether an effort was chosen in this composer, which it never stops being. */
  pinned: boolean
}

/** What a composer knows before the agent has announced anything: no default, nothing pinned. */
export const NO_DEFAULTS: ModelDefaults = { byModel: new Map(), pinned: false }

/**
 * What the composer knows of its models' defaults once the agent has answered, from what it
 * knew before and the option that answer is to — `null` for an answer to no choice at all (an
 * offer, a Session opened, a list read again).
 *
 * - The effort was set: it is pinned from now on, and the answer teaches nothing.
 * - Something else was set, or nothing, while nothing is pinned: the effort the agent announces
 *   is where the model it announces puts a composer by itself — that model's default. A model
 *   that announces no effort teaches nothing.
 * - Anything at all once pinned: the effort announced is the pin, and teaches nothing.
 */
export function modelDefaultsAfter(
  held: ModelDefaults,
  options: readonly ConfigOption[],
  setOptionId: string | null,
): ModelDefaults {
  const effort = effortStage(options)
  if (setOptionId !== null && setOptionId === effort?.optionId) {
    return held.pinned ? held : { byModel: held.byModel, pinned: true }
  }
  if (held.pinned) return held
  const model = modelStage(options)
  if (model?.current == null || effort?.current == null) return held
  if (held.byModel.get(model.current) === effort.current) return held
  const byModel = new Map(held.byModel)
  byModel.set(model.current, effort.current)
  return { byModel, pinned: false }
}

/** The effort the model on screen defaults to, or null where the composer never learned it. */
export function effortDefaultOf(held: ModelDefaults, model: string | null): string | null {
  return model === null ? null : (held.byModel.get(model) ?? null)
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
