import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import {
  AGENTS,
  ARG_TYPES,
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  CLAUDE_MODES,
  Controlled,
  cutShort,
  panelBox,
  sameBox,
} from './agent-model-menu-fixtures.tsx'
import { AgentModelMenuStages } from './agent-model-menu-stages.tsx'

/**
 * **Variant A — the stages.** One list at a time: the agents, then the models of the one that
 * was picked, with the effort and the modes under them.
 *
 * It is the narrow panel — `w-menu` — and the one that asks the four questions in the order
 * they make sense in. The price is a stage change, and the stage change is the thing to judge:
 * the leaving list slides out by the width of the panel while the arriving one comes in from
 * the other side, and the box around them never moves a pixel. The way back is the line at the
 * top, which carries the agent it is leaving so the eye keeps its place.
 *
 * The agent stage has four rows and does not fill the panel. It is drawn at the top of it and
 * the room left under it is the panel's own surface: a panel that shrank to its rows and grew
 * again on the next stage would be a panel that jumps, and it opens upwards out of the foot of
 * a window, where a jump ends with the whole thing flipped to the other side under the hand.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/AgentModelMenu/Stages',
  component: AgentModelMenuStages,
  render: (args) => (
    <Controlled {...args} render={(props) => <AgentModelMenuStages {...props} />} />
  ),
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
  argTypes: ARG_TYPES,
} satisfies Meta<typeof AgentModelMenuStages>

export default meta
type Story = StoryObj<typeof meta>

/** Every prop as a control, and the four answers wired to a page that behaves like the engine. */
export const Playground: Story = {}

/**
 * Nothing chosen: the trigger says what to do rather than naming a model of nobody's.
 *
 * The panel opens on the agents, because the model of an agent nobody picked is not a question,
 * and the one that is signed out is drawn with what is the matter with it and cannot be picked.
 */
export const NoAgent: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const list = await screen.findByRole('listbox', { name: 'Agents' })
    const options = within(list).getAllByRole('option')
    await expect(options).toHaveLength(4)
    // Off, and still an entry of the list: whatever reads the page can reach it and say why,
    // which a button the browser disabled would be passed over without a word.
    await expect(options[3]).toHaveTextContent('gemini login')
    await expect(options[3]).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(options[3]!)
    await expect(args.onAgentChange).not.toHaveBeenCalled()

    // No model list and no effort row: there is no agent to have announced either.
    await expect(screen.queryByRole('listbox', { name: 'Models of this agent' })).toBeNull()
    await expect(screen.queryByRole('group', { name: 'Effort' })).toBeNull()
  },
}

/**
 * The agent's options being read, beside the same panel once they have landed.
 *
 * This is the one fact the three variants are judged on. The panel used to show a single
 * line — "Reading what this agent offers…" — in place of the whole list, which made it a
 * different panel from one second to the next; now the list that is there stays there and a
 * small indicator sits in the header beside the name of what is under it. The two panels are
 * opened in turn and measured: the same height and the same width, to the pixel.
 */
export const Loading: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center justify-center gap-6 p-6">
      <AgentModelMenuStages
        agents={AGENTS}
        agent="claude-code"
        onAgentChange={fn()}
        models={CLAUDE_MODELS}
        model="opus-4-5"
        onModelChange={fn()}
        efforts={CLAUDE_EFFORTS}
        effort="high"
        onEffortChange={fn()}
        modes={CLAUDE_MODES}
        mode="plan-only"
        onModeChange={fn()}
        loading
      />
      <AgentModelMenuStages
        agents={AGENTS}
        agent="claude-code"
        onAgentChange={fn()}
        models={CLAUDE_MODELS}
        model="opus-4-5"
        onModelChange={fn()}
        efforts={CLAUDE_EFFORTS}
        effort="high"
        onEffortChange={fn()}
        modes={CLAUDE_MODES}
        mode="plan-only"
        onModeChange={fn()}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [waiting, answered] = canvas.getAllByRole('button')

    await userEvent.click(waiting!)
    // The list is still the list: the models the agent announced before are readable while the
    // new ones are being read, and the indicator is what says so.
    const reading = await screen.findByRole('listbox', { name: 'Models of this agent' })
    await expect(within(reading).getAllByRole('option')).toHaveLength(5)
    await expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    await expect(screen.queryByText(/Reading what this agent offers/)).toBeNull()
    const waitingBox = panelBox()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    await userEvent.click(answered!)
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Models of this agent' })).toBeVisible()
    })
    const answeredBox = panelBox()

    // The whole point, to the pixel: what the agent answered changes what is inside the panel
    // and nothing about the panel.
    sameBox(answeredBox, waitingBox)
    await expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
  },
}

/**
 * The engine could not offer the agent, and says why in its own words.
 *
 * It is drawn in the panel, where the choice is, and it is an alert: a sentence about the agent
 * that never reaches whatever reads the page is a sentence half the readers never get. The way
 * back to the agents is still there, which is the only thing to do about it.
 */
export const Refusal: Story = {
  args: {
    agent: 'gemini',
    refusal: 'Gemini CLI answered nothing on initialize; it is installed and signed out.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Gemini CLI/ }))

    const said = await screen.findByRole('alert')
    await expect(said).toHaveTextContent('signed out')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Gemini CLI Change/ })).toBeVisible()
    })
  },
}

/**
 * The agent of a Session, which is the agent it was made with: no stage to leave it by.
 *
 * A Session runs one agent from end to end. The panel opens on that agent's models, the line
 * naming it is a line and not a press, and there is no way back to a list of agents — offering
 * a choice that would be refused after the fact is worse than not offering it.
 */
export const Fixed: Story = {
  args: {
    agent: 'claude-code',
    model: 'sonnet-4-5',
    effort: 'high',
    mode: 'accept-edits',
    fixed: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Sonnet 4\.5 · High · Accept edits/ }))

    await expect(
      await screen.findByRole('listbox', { name: 'Models of this agent' }),
    ).toBeInTheDocument()
    await expect(screen.queryByRole('listbox', { name: 'Agents' })).toBeNull()
    // Waited out rather than read the moment it exists: the panel comes down from its trigger
    // in opacity, and nothing drawn halfway through that is visible yet.
    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeVisible()
    })
    await expect(screen.queryByText('Change')).toBeNull()
  },
}

/**
 * Thirty models under three providers, which is what a search field is for.
 *
 * The list scrolls inside a panel that does not grow, the groups are the agent's own and one
 * that nothing matches is gone rather than left standing empty, and the keys are read by the
 * field — the same contract as the composer's mention menu, because a list that took the caret
 * would stop the typing that is narrowing it.
 */
export const ManyModels: Story = {
  args: { agent: 'opencode' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /OpenCode/ }))

    const list = await screen.findByRole('listbox', { name: 'Models of this agent' })
    await expect(within(list).getAllByRole('option')).toHaveLength(30)
    await expect(within(list).getAllByRole('group')).toHaveLength(3)
    // Thirty rows in the room a handful fit in: the list scrolls, the panel does not grow.
    const box = panelBox()
    await expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom + 1)

    const field = screen.getByRole('combobox', { name: 'Search the models of this agent' })
    await waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    await userEvent.type(field, 'kimi')
    await waitFor(() => {
      expect(within(list).getAllByRole('option')).toHaveLength(1)
    })
    await expect(screen.queryByRole('group', { name: 'OpenRouter' })).toBeNull()
    sameBox(panelBox(), box)

    await userEvent.keyboard('{Enter}')
    await expect(args.onModelChange).toHaveBeenCalledWith('opencode-zen-kimi-k2-thinking')
  },
}

/**
 * The five modes of Claude Code, each read whole.
 *
 * They used to be a row of five steps, which cut every one of them short: "Ask before edits"
 * and "Bypass permissions" are the agent's own sentences, not the steps of a scale. They are a
 * list, one per line, each with the mark its own words earned — asking is a shield, editing a
 * pencil, planning a page — and the current one checked.
 */
export const Modes: Story = {
  args: { agent: 'claude-code', model: 'opus-4-5', effort: 'high' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Opus 4\.5 · High/ }))

    const list = await screen.findByRole('listbox', { name: 'Mode' })
    const offered = within(list).getAllByRole('option')
    await expect(offered).toHaveLength(5)
    // Whole, and not an ellipsis: every label is as wide as its own words in the room it has.
    await expect(cutShort(list)).toEqual([])
    // A row where every entry wore the same icon is a row read on its words alone.
    await expect(list.querySelectorAll('svg')).toHaveLength(5)
    // The modes are under the effort and never beside it.
    const effort = screen.getByRole('group', { name: 'Effort' })
    await expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      effort.getBoundingClientRect().bottom,
    )

    await userEvent.click(offered[4]!)
    await expect(args.onModeChange).toHaveBeenCalledWith('bypass-permissions')
    await waitFor(() => {
      expect(
        canvas.getByRole('button', { name: /Opus 4\.5 · High · Bypass permissions/ }),
      ).toBeVisible()
    })
  },
}

/**
 * The whole answer, given in one go: agent, model, effort, mode, and the panel closed.
 *
 * Every step is asserted, and so is the one thing that must never happen between two of them —
 * the panel changing size. The box is read on the agent stage and again on the model stage, and
 * the two are the same. The focus goes back to the trigger on the way out, because the trigger
 * is what opened it.
 */
export const Walkthrough: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Choose an agent' })
    await userEvent.click(trigger)

    // The agent stage, and the box it is drawn in.
    const agents = await screen.findByRole('listbox', { name: 'Agents' })
    const onAgents = panelBox()
    await userEvent.click(within(agents).getByRole('option', { name: /Claude Code/ }))
    await expect(args.onAgentChange).toHaveBeenCalledWith('claude-code')

    // The model stage, in the very same box.
    const models = await screen.findByRole('listbox', { name: 'Models of this agent' })
    await waitFor(() => {
      expect(models).toBeVisible()
    })
    sameBox(panelBox(), onAgents)

    // The field has the caret the moment the stage comes up, because it is the one thing here
    // that is typed into, and the arrows walk the list without the caret ever leaving it.
    const field = screen.getByRole('combobox', { name: 'Search the models of this agent' })
    await waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    await userEvent.type(field, 'haiku')
    await userEvent.keyboard('{Enter}')
    await expect(args.onModelChange).toHaveBeenCalledWith('haiku-4-5')
    await expect(document.activeElement).toBe(field)

    // The effort, as the agent's own scale.
    const effort = await screen.findByRole('group', { name: 'Effort' })
    await userEvent.click(within(effort).getByRole('button', { name: 'Xhigh' }))
    await expect(args.onEffortChange).toHaveBeenCalledWith('xhigh')

    // The mode, read whole, and checked once it is taken.
    const modes = await screen.findByRole('listbox', { name: 'Mode' })
    await userEvent.click(within(modes).getByRole('option', { name: /Plan only/ }))
    await expect(args.onModeChange).toHaveBeenCalledWith('plan-only')
    await waitFor(() => {
      expect(within(modes).getByRole('option', { name: /Plan only/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
    // The box has not moved once in the whole walk.
    sameBox(panelBox(), onAgents)

    // Escape closes it and hands the focus back to what opened it.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await expect(
      canvas.getByRole('button', { name: /Haiku 4\.5 · Xhigh · Plan only/ }),
    ).toHaveFocus()
  },
}
