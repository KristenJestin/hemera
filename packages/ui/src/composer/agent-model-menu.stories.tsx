import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import {
  AgentModelMenu,
  type AgentModelMenuProps,
  type EffortChoice,
  type ModeChoice,
  type ModelChoice,
  type OfferedAgent,
} from './agent-model-menu.tsx'

/**
 * The agent, its model and its effort, behind one trigger (design D17-11, D17-14).
 *
 * Three questions that only make sense in that order, and one place to answer them. The trigger
 * says what is set — the agent's mark, the model, the effort behind a middle dot — and the panel
 * is where the choosing happens, so the row it sits in never changes height.
 *
 * Everything on offer is the engine's: the agents this machine has, whether each of them is
 * signed in, the models the chosen one announced and the groups it put them in, and the efforts
 * it can think with. Nothing here invents any of it, and an agent that announced no effort is
 * given no row rather than a row of one.
 */
const AGENTS: OfferedAgent[] = [
  { id: 'claude-code', name: 'Claude Code', available: true, signedIn: true },
  { id: 'codex', name: 'Codex', available: true, signedIn: true },
  { id: 'opencode', name: 'OpenCode', available: true, signedIn: true },
]

/** The same machine, told the truth about it: one agent missing, one signed out. */
const PARTLY: OfferedAgent[] = [
  { id: 'claude-code', name: 'Claude Code', available: true, signedIn: true },
  {
    id: 'codex',
    name: 'Codex',
    available: true,
    signedIn: false,
    hint: 'Signed out: run `codex login` to sign in',
  },
  { id: 'opencode', name: 'OpenCode', available: false, signedIn: false },
]

/**
 * What OpenCode announces, under the provider groups it announces them in.
 *
 * Two providers, so two headers. Claude Code and Codex publish one, hand over models with no
 * group at all, and the list is then drawn without a single header.
 */
const OPENCODE_MODELS: ModelChoice[] = [
  { id: 'go/grok-code', label: 'Grok Code Fast', group: 'OpenCode Go' },
  { id: 'go/qwen3-coder', label: 'Qwen3 Coder 480B', group: 'OpenCode Go' },
  { id: 'zen/deepseek-v4-1-flash', label: 'DeepSeek V4.1 Flash', group: 'OpenCode Zen' },
  { id: 'zen/kimi-k2', label: 'Kimi K2 Thinking', group: 'OpenCode Zen' },
]

const CLAUDE_MODELS: ModelChoice[] = [
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { id: 'claude-opus-4-1', label: 'Opus 4.1' },
]

const EFFORTS: EffortChoice[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
]

/** What an agent says it may be told to do without asking, in its own words. */
const MODES: ModeChoice[] = [
  { id: 'ask', label: 'Ask before edits' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan only' },
]

/**
 * The menu holds nothing: what is chosen belongs to the page, which is what the engine answers
 * to. The story plays that page, so every control of the panel is a real prop of the component.
 */
function Controlled({
  agent,
  model,
  effort,
  mode,
  onAgentChange,
  onModelChange,
  onEffortChange,
  onModeChange,
  ...rest
}: AgentModelMenuProps) {
  const [picked, setPicked] = useState(agent)
  const [run, setRun] = useState(model)
  const [thinking, setThinking] = useState(effort)
  const [allowed, setAllowed] = useState(mode)
  return (
    <div className="flex justify-end p-6">
      <AgentModelMenu
        {...rest}
        agent={picked}
        onAgentChange={(id) => {
          setPicked(id)
          // The model, the effort and the mode belong to the agent that announced them:
          // carrying one across would ask an agent for a model it never published.
          setRun(null)
          setThinking(null)
          setAllowed(null)
          onAgentChange(id)
        }}
        model={run}
        onModelChange={(id) => {
          setRun(id)
          onModelChange(id)
        }}
        effort={thinking}
        onEffortChange={(id) => {
          setThinking(id)
          onEffortChange(id)
        }}
        mode={allowed}
        onModeChange={(id) => {
          setAllowed(id)
          onModeChange(id)
        }}
      />
    </div>
  )
}

/**
 * The box the panel is drawn in, read off the panel itself.
 *
 * The one fact this component is judged on since the trial of 22 September 2026: the panel is
 * the same size while it is waiting and once it has answered, so it never grows past the top of
 * the window and is never flipped to the other side under the hand that opened it.
 */
function panelBox(): DOMRect {
  const panel = document.querySelector('[role="dialog"]')
  expect(panel, 'the panel is not open').not.toBeNull()
  // SAFETY: a popup of this design system is a dialog element, and `querySelector` answers one.
  return (panel as HTMLElement).getBoundingClientRect()
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/AgentModelMenu',
  component: AgentModelMenu,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'padded' },
  args: {
    agents: AGENTS,
    agent: null,
    models: [],
    model: null,
    efforts: [],
    effort: null,
    modes: [],
    mode: null,
    onAgentChange: fn(),
    onModelChange: fn(),
    onEffortChange: fn(),
    onModeChange: fn(),
  },
  argTypes: {
    agents: { control: 'object', description: 'The agents the engine offered, in its order.' },
    agent: { control: 'text', description: 'The agent chosen so far, or null while none is.' },
    models: { control: 'object', description: "The chosen agent's models, in their groups." },
    model: { control: 'text', description: 'The model the next turn will use.' },
    efforts: { control: 'object', description: 'What the agent says it can think with.' },
    effort: { control: 'text', description: 'The effort the next turn will run at.' },
    modes: { control: 'object', description: 'What the agent says it may be told to do.' },
    mode: { control: 'text', description: 'What the next turn may do without asking.' },
    fixed: {
      control: 'boolean',
      description: 'Whether the agent is the Session’s own and cannot be changed.',
    },
    loading: { control: 'boolean', description: "Whether the agent's options are being read." },
    refusal: {
      control: 'text',
      description: 'Why the agent could not be offered, if it could not.',
    },
    disabled: { control: 'boolean' },
    onAgentChange: { action: 'agent chosen', description: 'Called with the id, never the name.' },
    onModelChange: { action: 'model chosen' },
    onEffortChange: { action: 'effort chosen' },
    onModeChange: { action: 'mode chosen' },
  },
} satisfies Meta<typeof AgentModelMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/**
 * Nothing chosen: the trigger says what to do rather than naming a model of nobody's.
 *
 * The panel opens on the agents, because the model of an agent nobody picked is not a question.
 */
export const NoAgent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Choose an agent' })

    await userEvent.click(trigger)

    const list = await screen.findByRole('listbox', { name: 'Agents' })
    await expect(within(list).getAllByRole('option')).toHaveLength(3)
    // No model list and no effort row: there is no agent to have announced either.
    await expect(screen.queryByRole('listbox', { name: 'Models of this agent' })).toBeNull()
    await expect(screen.queryByRole('group', { name: 'Effort' })).toBeNull()
  },
}

/**
 * An agent that is not signed in, and one this machine does not have.
 *
 * Both are drawn, with what is the matter with each, and neither can be picked: a choice that
 * would be refused after the fact is a choice that lied. The engine's own sentence is what says
 * what to do about it.
 */
export const AgentNotSignedIn: Story = {
  args: { agents: PARTLY },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const list = await screen.findByRole('listbox', { name: 'Agents' })
    const options = within(list).getAllByRole('option')
    await expect(options[1]).toHaveTextContent('codex login')
    // Off, and still an entry of the list: whatever reads the page can reach it and say why,
    // which a button the browser disabled would be passed over without a word.
    await expect(options[1]).toHaveAttribute('aria-disabled', 'true')
    await expect(options[2]).toHaveTextContent('Not installed on this machine')
    await expect(options[2]).toHaveAttribute('aria-disabled', 'true')

    // Pressed all the same, and nothing happens: the panel stays on the agents.
    await userEvent.click(options[1]!)
    await expect(args.onAgentChange).not.toHaveBeenCalled()
    await expect(screen.getByRole('listbox', { name: 'Agents' })).toBeInTheDocument()

    // The one agent that is both there and signed in is the one that can be taken.
    await expect(options[0]).not.toHaveAttribute('aria-disabled')
  },
}

/**
 * The models of the agent that was picked, under the groups the agent announced, and the field
 * that narrows them.
 *
 * The keys are read by the field and the list beside it only says where they would land — the
 * same contract as the composer's mention menu, and for the same reason: a list that took the
 * caret would stop the typing that is narrowing it.
 */
export const Models: Story = {
  args: { agent: 'opencode', models: OPENCODE_MODELS },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /OpenCode/ }))

    const list = await screen.findByRole('listbox', { name: 'Models of this agent' })
    await expect(within(list).getAllByRole('option')).toHaveLength(4)
    // Two providers, so two groups, each named as the agent named it.
    await expect(screen.getByRole('group', { name: 'OpenCode Go' })).toBeInTheDocument()
    await expect(screen.getByRole('group', { name: 'OpenCode Zen' })).toBeInTheDocument()

    // The field has the caret the moment the stage comes up, because it is the one thing here
    // that is typed into.
    const field = screen.getByRole('combobox', { name: 'Search the models of this agent' })
    await waitFor(() => {
      expect(document.activeElement).toBe(field)
    })

    await userEvent.type(field, 'deep')
    await waitFor(() => {
      expect(within(list).getAllByRole('option')).toHaveLength(1)
    })
    // What is left is one group, and the other is gone rather than left standing empty.
    await expect(screen.queryByRole('group', { name: 'OpenCode Go' })).toBeNull()

    // The arrows walk it and Enter takes it, without the caret ever leaving the field.
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(args.onModelChange).toHaveBeenCalledWith('zen/deepseek-v4-1-flash')
    await expect(document.activeElement).toBe(field)
    await waitFor(() => {
      expect(within(list).getByRole('option')).toHaveAttribute('aria-selected', 'true')
    })
  },
}

/**
 * The effort, as one row at the foot of the panel, and the trigger reading the whole answer.
 *
 * An agent that announced no effort is given no row at all: a scale of one level is a control
 * that promises a choice which does not exist.
 */
export const Efforts: Story = {
  args: {
    agent: 'opencode',
    models: OPENCODE_MODELS,
    model: 'zen/deepseek-v4-1-flash',
    efforts: EFFORTS,
    effort: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    // Nothing is set beyond the model, so the trigger reads the model alone.
    await userEvent.click(canvas.getByRole('button', { name: 'DeepSeek V4.1 Flash' }))

    const row = await screen.findByRole('group', { name: 'Effort' })
    const levels = within(row).getAllByRole('button')
    await expect(levels).toHaveLength(3)
    await expect(levels[0]).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(levels[0]!)
    await expect(args.onEffortChange).toHaveBeenCalledWith('low')
    await waitFor(() => {
      expect(within(row).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true')
    })

    // And the trigger now reads the whole answer, in the order a reader asks it.
    await expect(canvas.getByRole('button', { name: /DeepSeek V4\.1 Flash · Low/ })).toBeVisible()
  },
}

/**
 * The mode, as a second row under the effort, with the agent's own marks on it.
 *
 * It used to be a selector of its own beside this trigger, which made two controls asking about
 * one agent in a row that must not wrap. It is the same question as the effort — what the next
 * turn is allowed to do — so it is a row of the same panel, and the trigger reads the whole
 * answer at once.
 */
export const Modes: Story = {
  args: {
    agent: 'opencode',
    models: OPENCODE_MODELS,
    model: 'zen/deepseek-v4-1-flash',
    efforts: EFFORTS,
    effort: 'low',
    modes: MODES,
    mode: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /DeepSeek V4\.1 Flash · Low/ }))

    const row = await screen.findByRole('group', { name: 'Mode' })
    const offered = within(row).getAllByRole('button')
    await expect(offered).toHaveLength(3)
    // Each mode wears the mark its own words earned: asking is a shield, editing a pencil,
    // planning a page. A row where every entry wore the same icon is a row read on its words.
    await expect(row.querySelectorAll('svg')).toHaveLength(3)
    // It is its own row, under the effort and never beside it.
    const effort = screen.getByRole('group', { name: 'Effort' })
    await expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      effort.getBoundingClientRect().bottom,
    )

    await userEvent.click(offered[2]!)
    await expect(args.onModeChange).toHaveBeenCalledWith('plan')
    // And the trigger reads all four answers, in the order a reader asks them.
    await waitFor(() => {
      expect(
        canvas.getByRole('button', { name: /DeepSeek V4\.1 Flash · Low · Plan only/ }),
      ).toBeVisible()
    })
  },
}

/**
 * The agent of a Session, which is the agent it was made with: no stage to leave it by.
 *
 * A Session runs one agent from end to end. The panel opens on that agent's models, the line
 * naming it is a line and not a press, and there is no way back to a list of agents — offering a
 * choice that would be refused after the fact is worse than not offering it.
 */
export const Fixed: Story = {
  args: {
    agent: 'claude-code',
    models: CLAUDE_MODELS,
    model: 'claude-sonnet-4-5',
    efforts: EFFORTS,
    effort: 'high',
    modes: MODES,
    mode: 'acceptEdits',
    fixed: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Sonnet 4\.5 · High · Accept edits/ }))

    // Straight onto the models, with no stage before them.
    await expect(
      await screen.findByRole('listbox', { name: 'Models of this agent' }),
    ).toBeInTheDocument()
    await expect(screen.queryByRole('listbox', { name: 'Agents' })).toBeNull()
    // The agent is named and cannot be left: no "Change", no back arrow, nothing to press.
    // Waited out rather than read the moment it exists: the panel comes down from its trigger in
    // opacity, and nothing drawn halfway through that is visible yet.
    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeVisible()
    })
    await expect(screen.queryByText('Change')).toBeNull()
    await expect(screen.queryByRole('button', { name: /Claude Code/ })).toBeNull()
  },
}

/**
 * The agent's options being read: the trigger says so where it stands, and the panel is already
 * the panel it will be.
 *
 * This is the one fact the component is judged on. The panel used to show a single line —
 * "Reading what this agent offers…" — and then swap it for a search field, a list and two rows,
 * which made it grow upwards out of a composer at the foot of a window until the positioner gave
 * up and flipped it to the other side, under the hand that had just opened it. One height and
 * one width, for every stage and every state: the field is there while the answer is coming, the
 * list area holds the indicator instead of the models, and nothing moves when they land.
 *
 * An empty list while the answer is in flight would still be wrong for its own reason: it is a
 * list saying the agent announced nothing, which is a different fact and one that would send a
 * reader off to another agent.
 */
export const Loading: Story = {
  args: { agent: 'claude-code', models: [], loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: /Claude Code/ })
    await expect(
      within(trigger).getByRole('status', { name: 'Reading what the agent offers' }),
    ).toBeInTheDocument()

    await userEvent.click(trigger)

    // Waited out rather than read the moment it exists: the panel comes down from its trigger
    // in opacity, and a colour read halfway through that is a colour nothing is wearing yet.
    await waitFor(() => {
      expect(screen.getByText(/Reading what this agent offers/)).toBeVisible()
    })
    // The field is drawn while the answer is coming, because the panel is one shape.
    const field = screen.getByRole('combobox', { name: 'Search the models of this agent' })
    // No list at all, so the field points at nothing rather than at an id nothing answers.
    await expect(screen.queryByRole('listbox', { name: 'Models of this agent' })).toBeNull()
    await expect(field).toHaveAttribute('aria-expanded', 'false')
  },
}

/**
 * The same panel waiting and answered, side by side: the one box, measured twice.
 *
 * Two menus on one row, the same agent, one still reading and one with everything the agent
 * announced — four models, three efforts and three modes. Each is opened in turn and its popup
 * measured: the height and the width are the same to the pixel, which is what stops the panel
 * growing past the top of the window and being flipped under the reader's hand.
 */
export const SameSizeWhileLoading: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center justify-center gap-6 p-6">
      <AgentModelMenu
        agents={AGENTS}
        agent="opencode"
        onAgentChange={fn()}
        models={[]}
        model={null}
        onModelChange={fn()}
        efforts={[]}
        effort={null}
        onEffortChange={fn()}
        modes={[]}
        mode={null}
        onModeChange={fn()}
        loading
      />
      <AgentModelMenu
        agents={AGENTS}
        agent="opencode"
        onAgentChange={fn()}
        models={OPENCODE_MODELS}
        model="zen/kimi-k2"
        onModelChange={fn()}
        efforts={EFFORTS}
        effort="high"
        onEffortChange={fn()}
        modes={MODES}
        mode="plan"
        onModeChange={fn()}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [waiting, answered] = canvas.getAllByRole('button')

    await userEvent.click(waiting!)
    await waitFor(() => {
      expect(screen.getByText(/Reading what this agent offers/)).toBeVisible()
    })
    const reading = panelBox()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    await userEvent.click(answered!)
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Models of this agent' })).toBeVisible()
    })
    const loaded = panelBox()

    // The whole point, to the pixel: what the agent answered changes what is inside the panel
    // and nothing about the panel.
    expect(loaded.height).toBeCloseTo(reading.height, 1)
    expect(loaded.width).toBeCloseTo(reading.width, 1)
    // And the models scroll inside it rather than making it taller: eleven rows of choices in
    // the room four fit in.
    const list = screen.getByRole('listbox', { name: 'Models of this agent' })
    expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(loaded.bottom + 1)
  },
}

/**
 * The engine could not offer the agent, and says why in its own words.
 *
 * It is drawn in the panel, where the choice is, and it is an alert: a sentence about the agent
 * that never reaches whatever reads the page is a sentence half the readers never get.
 */
export const Refusal: Story = {
  args: {
    agent: 'codex',
    models: [],
    refusal: 'Codex answered nothing on initialize; the version on this machine is too old.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Codex/ }))

    const said = await screen.findByRole('alert')
    await expect(said).toHaveTextContent('too old')
    // The way back to the agents is still there, which is the only thing to do about it.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Codex Change/ })).toBeVisible()
    })
  },
}

/**
 * The agent that is picked, and what picking another one does to the two answers below it.
 *
 * A model id belongs to the agent that announced it, so changing the agent clears the model and
 * the effort rather than carrying an id the next agent never published.
 */
export const ChangingTheAgent: Story = {
  args: {
    agent: 'claude-code',
    models: CLAUDE_MODELS,
    model: 'claude-sonnet-4-5',
    efforts: EFFORTS,
    effort: 'high',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Sonnet 4\.5 · High/ }))

    // One provider, so no header over the list at all.
    const list = await screen.findByRole('listbox', { name: 'Models of this agent' })
    await expect(within(list).getAllByRole('option')).toHaveLength(2)
    await expect(screen.queryAllByRole('group', { name: /OpenCode/ })).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: /Claude Code Change/ }))
    await userEvent.click(
      within(await screen.findByRole('listbox', { name: 'Agents' })).getByRole('option', {
        name: /Codex/,
      }),
    )

    await expect(args.onAgentChange).toHaveBeenCalledWith('codex')
    // The trigger falls back to the agent's own name: the model and the effort went with the
    // agent that announced them.
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Codex/ })).toBeVisible()
    })
    await expect(canvas.queryByRole('button', { name: /Sonnet/ })).toBeNull()
  },
}
