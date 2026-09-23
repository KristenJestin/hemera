import type { ReactNode } from 'react'
import { useState } from 'react'
import { expect, within } from 'storybook/test'

import type {
  AgentModelMenuProps,
  EffortChoice,
  EffortProps,
  ModeChoice,
  ModeProps,
  ModelChoice,
  OfferedAgent,
} from './agent-model-menu-shared.tsx'

/**
 * The machine the agent menu and its two controls are shown on.
 *
 * One set of agents and one set of answers for all of them, because a panel and the controls
 * inside it shown on different data are three things nobody can compare. It is a plausible
 * machine rather than a small one: Claude Code with five models, five levels of effort and five
 * modes whose names are sentences; Codex with four models and no effort at all; OpenCode with
 * thirty models under three providers, which is where a list has to scroll and a search has to
 * earn its place; and one agent that is installed and signed out, which the panel has to draw
 * and refuse.
 *
 * Nothing here is a component of the design system: it is the story's own engine, and it lives
 * beside the story files instead of inside one of them so that they all show the same machine.
 */

export const AGENTS: OfferedAgent[] = [
  { id: 'claude-code', name: 'Claude Code', available: true, signedIn: true },
  { id: 'codex', name: 'Codex', available: true, signedIn: true },
  { id: 'opencode', name: 'OpenCode', available: true, signedIn: true },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    available: true,
    signedIn: false,
    hint: 'Signed out: run `gemini login` to sign in',
  },
]

/** An id of the shape an agent hands over, built from the words it named the thing with. */
function idOf(...words: string[]): string {
  return words
    .join('-')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
}

/** One provider's models, named as the provider names them and grouped under it. */
function grouped(group: string, labels: readonly string[]): ModelChoice[] {
  return labels.map((label) => ({ id: idOf(group, label), label, group }))
}

/** An agent that publishes one provider hands over models with no group at all. */
function ungrouped(labels: readonly string[]): ModelChoice[] {
  return labels.map((label) => ({ id: idOf(label), label }))
}

/** A scale, as the agent announced it. */
function scale(labels: readonly string[]): EffortChoice[] {
  return labels.map((label) => ({ id: idOf(label), label }))
}

/** What an agent says it may be told to do without asking, in its own words. */
function saying(labels: readonly string[]): ModeChoice[] {
  return labels.map((label) => ({ id: idOf(label), label }))
}

export const CLAUDE_MODELS = ungrouped([
  'Fable',
  'Opus 4.5',
  'Sonnet 4.5',
  'Haiku 4.5',
  'Sonnet 3.7',
])

/**
 * The five levels of Claude Code, with the one it advises marked — which is the shape an
 * announcement takes once the engine has resolved the agent's own `Default` (decision of
 * 22 September 2026). `UNRESOLVED_EFFORTS` is the other half of that rule, for the agent that
 * never said what its `Default` stood for. The level it advises is where the scale's rule is.
 */
export const CLAUDE_EFFORTS: EffortChoice[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium', recommended: true },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Xhigh' },
  { id: 'max', label: 'Max' },
]

/**
 * And what it announces for `Sonnet 3.7`: three levels and none of them advised, which is the
 * model the rule has to leave the scale for.
 */
export const SONNET_3_7_EFFORTS = scale(['Low', 'Medium', 'High'])

/**
 * And the announcement nobody could resolve: `Default` as a value like the others, and no level
 * named. It is the one case the scale draws no notch for, and the thumb waits at the foot of
 * the track until a level is chosen.
 */
export const UNRESOLVED_EFFORTS: EffortChoice[] = [
  { id: 'default', label: 'Default', description: 'Whatever the agent starts on' },
  ...scale(['Low', 'Medium', 'High', 'Xhigh']),
  { id: 'max', label: 'Max', description: 'Everything it has, for as long as it takes' },
]

/** Five sentences, and the reason the modes are a list: not one of them is a word. */
export const CLAUDE_MODES = saying([
  'Ask before edits',
  'Accept edits',
  'Plan only',
  'Auto',
  'Bypass permissions',
])

export const CODEX_MODELS = ungrouped([
  'GPT-5.2 Codex',
  'GPT-5.2 Codex mini',
  'GPT-5.2',
  'GPT-5.1 Codex',
])

export const CODEX_MODES = saying(['Ask before edits', 'Accept edits', 'Full access'])

/** Thirty models under three providers: the list that has to scroll and be searched. */
export const OPENCODE_MODELS: ModelChoice[] = [
  ...grouped('OpenCode Zen', [
    'Grok Code Fast',
    'Qwen3 Coder 480B',
    'DeepSeek V4.1 Flash',
    'Kimi K2 Thinking',
    'GLM 4.7',
    'MiniMax M2.1',
    'Devstral Medium',
    'Codestral 25.10',
    'GPT OSS 120B',
    'Llama 4 Maverick',
  ]),
  ...grouped('Anthropic', [
    'Claude Opus 4.5',
    'Claude Sonnet 4.5',
    'Claude Haiku 4.5',
    'Claude Opus 4.1',
    'Claude Sonnet 4',
    'Claude Haiku 3.5',
    'Claude Opus 3',
    'Claude Sonnet 3.7',
    'Claude Sonnet 3.5',
    'Claude Haiku 3',
  ]),
  ...grouped('OpenRouter', [
    'Gemini 3 Pro',
    'Gemini 3 Flash',
    'GPT-5.2',
    'GPT-5.2 mini',
    'o4',
    'o4 mini',
    'Grok 5',
    'Grok 4 Fast',
    'Mistral Large 3',
    'Command A',
  ]),
]

export const OPENCODE_EFFORTS = scale(['Low', 'Medium', 'High'])

export const OPENCODE_MODES = saying(['Build', 'Plan'])

/** Everything one agent announced, which is what the engine answers one agent at a time. */
export interface Offer {
  models: ModelChoice[]
  efforts: EffortChoice[]
  modes: ModeChoice[]
}

const NOTHING: Offer = { models: [], efforts: [], modes: [] }

/**
 * The levels Claude Code announces on a model, which is an answer of that model and not of the
 * agent: the engine hands the options over again every time the model is set.
 */
function claudeEffortsOn(model: string | null): EffortChoice[] {
  if (model === 'haiku-4-5') return []
  if (model === 'sonnet-3-7') return SONNET_3_7_EFFORTS
  return CLAUDE_EFFORTS
}

/** What an agent announced on that model, or nothing at all for one that never answered. */
export function offerOf(agent: string | null, model: string | null = null): Offer {
  if (agent === 'claude-code') {
    return {
      models: CLAUDE_MODELS,
      efforts: claudeEffortsOn(model),
      modes: CLAUDE_MODES,
    }
  }
  if (agent === 'codex') {
    return { models: CODEX_MODELS, efforts: [], modes: CODEX_MODES }
  }
  if (agent === 'opencode') {
    return { models: OPENCODE_MODELS, efforts: OPENCODE_EFFORTS, modes: OPENCODE_MODES }
  }
  return NOTHING
}

/**
 * The page the menu sits on, which is the one that knows what was chosen.
 *
 * The menu holds nothing: what is chosen belongs to the page, and the page is what the engine
 * answers to. This one answers like the engine — pick an agent and that agent's models, efforts
 * and modes are what the panel is handed next, and pick a model and the efforts that model
 * announces are — so a story is walked end to end rather than posed. A story that pins its own models wins over it, which is how `Loading`, `ManyModels`
 * and `Refusal` say what they are about.
 *
 * Changing the agent clears the model, the effort and the mode: a model id belongs to the agent
 * that announced it, and carrying one across would ask an agent for a model it never published.
 * Changing the model leaves the effort where it was, as Claude Code does when its own settings
 * set one (trial of 23 September 2026). The rule across the scale is where the page puts it:
 * at the level the efforts on offer mark as advised, and nowhere when none of them is.
 */
export function Controlled({
  render,
  agent,
  model,
  effort,
  effortDefault,
  mode,
  onAgentChange,
  onModelChange,
  onEffortChange,
  onModeChange,
  ...rest
}: AgentModelMenuProps & { render: (props: AgentModelMenuProps) => ReactNode }): ReactNode {
  const [picked, setPicked] = useState(agent)
  const [run, setRun] = useState(model)
  const [thinking, setThinking] = useState(effort)
  const [allowed, setAllowed] = useState(mode)

  const offer = offerOf(picked, run)
  const efforts = rest.efforts.length > 0 ? rest.efforts : offer.efforts
  return (
    <div className="flex justify-end p-6">
      {render({
        ...rest,
        models: rest.models.length > 0 ? rest.models : offer.models,
        efforts,
        modes: rest.modes.length > 0 ? rest.modes : offer.modes,
        effortDefault: effortDefault ?? efforts.find((one) => one.recommended === true)?.id ?? null,
        agent: picked,
        onAgentChange: (id) => {
          setPicked(id)
          setRun(null)
          setThinking(null)
          setAllowed(null)
          onAgentChange(id)
        },
        model: run,
        onModelChange: (id) => {
          setRun(id)
          onModelChange(id)
        },
        effort: thinking,
        onEffortChange: (id) => {
          setThinking(id)
          onEffortChange(id)
        },
        mode: allowed,
        onModeChange: (id) => {
          setAllowed(id)
          onModeChange(id)
        },
      })}
    </div>
  )
}

/**
 * The box the panel is drawn in, read off the panel itself.
 *
 * The one fact all three variants are judged on since the trial of 22 September 2026: the panel
 * is the same size while it is waiting and once it has answered, and the same on every stage,
 * so it never grows past the top of the window and is never flipped to the other side under the
 * hand that opened it.
 */
export function panelBox(): DOMRect {
  const panel = document.querySelector('[role="dialog"]')
  expect(panel, 'the panel is not open').not.toBeNull()
  // SAFETY: a popup of this design system is a dialog element, and `querySelector` answers one.
  return (panel as HTMLElement).getBoundingClientRect()
}

/** Two boxes that have to be the same one, to the pixel. */
export function sameBox(after: DOMRect, before: DOMRect): void {
  expect(after.height).toBeCloseTo(before.height, 1)
  expect(after.width).toBeCloseTo(before.width, 1)
}

/**
 * The modes of Claude Code that the panel cut short, which has to be none of them.
 *
 * A label wider than the room it is drawn in is an ellipsis, and an ellipsis on "Bypass
 * permissions" is the reader guessing at what the next turn is allowed to do. Measured rather
 * than eyeballed: the words are wider than the box or they are not.
 */
export function cutShort(list: HTMLElement): string[] {
  return CLAUDE_MODES.filter((one) => {
    const written = within(list).getByText(one.label)
    return written.scrollWidth > written.clientWidth + 1
  }).map((one) => one.label)
}

/**
 * The page one effort control sits on, which is the one that keeps what was set.
 *
 * The three controls hold nothing, exactly as the three panels hold nothing: the answer belongs
 * to whatever drew them. One board for all three, so a comparison is three controls on one
 * machine rather than three stories that happen to look alike.
 */
export function SetEffort({
  render,
  effort,
  onEffortChange,
  ...rest
}: EffortProps & { render: (props: EffortProps) => ReactNode }): ReactNode {
  const [level, setLevel] = useState(effort)
  return (
    <div className="flex justify-center p-6">
      {render({
        ...rest,
        effort: level,
        onEffortChange: (id) => {
          setLevel(id)
          onEffortChange(id)
        },
      })}
    </div>
  )
}

/** The same board for one mode control. */
export function SetMode({
  render,
  mode,
  onModeChange,
  ...rest
}: ModeProps & { render: (props: ModeProps) => ReactNode }): ReactNode {
  const [allowed, setAllowed] = useState(mode)
  return (
    <div className="flex justify-center p-6">
      {render({
        ...rest,
        mode: allowed,
        onModeChange: (id) => {
          setAllowed(id)
          onModeChange(id)
        },
      })}
    </div>
  )
}

/** What the effort slider shows as controls in the catalogue. */
export const EFFORT_ARG_TYPES = {
  efforts: { control: 'object', description: 'What the agent says it can think with.' },
  effort: { control: 'text', description: 'The effort the next turn will run at.' },
  defaultId: { control: 'text', description: 'The level the agent recommends.' },
  disabled: { control: 'boolean' },
  onEffortChange: { action: 'effort chosen', description: 'Called with the id, never the label.' },
} as const

/** And what the mode list shows. */
export const MODE_ARG_TYPES = {
  modes: { control: 'object', description: 'What the agent says it may be told to do.' },
  mode: { control: 'text', description: 'What the next turn may do without asking.' },
  disabled: { control: 'boolean' },
  onModeChange: { action: 'mode chosen', description: 'Called with the id, never the label.' },
} as const

/** And the controls of the panel itself. */
export const ARG_TYPES = {
  agents: { control: 'object', description: 'The agents the engine offered, in its order.' },
  agent: { control: 'text', description: 'The agent chosen so far, or null while none is.' },
  models: { control: 'object', description: "The chosen agent's models, in their groups." },
  model: { control: 'text', description: 'The model the next turn will use.' },
  efforts: { control: 'object', description: 'What the agent says it can think with.' },
  effort: { control: 'text', description: 'The effort the next turn will run at.' },
  effortDefault: {
    control: 'text',
    description: 'The level the agent recommends, which the scale marks.',
  },
  modes: { control: 'object', description: 'What the agent says it may be told to do.' },
  mode: { control: 'text', description: 'What the next turn may do without asking.' },
  fixed: {
    control: 'boolean',
    description: 'Whether the agent is the Session’s own and cannot be changed.',
  },
  loading: { control: 'boolean', description: "Whether the agent's options are being read." },
  refusal: { control: 'text', description: 'Why the agent could not be offered, if it could not.' },
  disabled: { control: 'boolean' },
  onAgentChange: { action: 'agent chosen', description: 'Called with the id, never the name.' },
  onModelChange: { action: 'model chosen' },
  onEffortChange: { action: 'effort chosen' },
  onModeChange: { action: 'mode chosen' },
} as const
