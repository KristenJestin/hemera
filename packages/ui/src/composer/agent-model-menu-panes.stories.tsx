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
import { AgentModelMenuPanes } from './agent-model-menu-panes.tsx'

/**
 * **Variant B — the panes.** One wider panel, everything in sight: the agents on the left, the
 * models of the one that is picked on the right, the effort and the modes in a band across the
 * foot of both.
 *
 * Nothing is behind a stage, so there is no back arrow and nothing to remember. The price is
 * width — `w-menu-panel` rather than `w-menu` — and two columns that are each narrower than the
 * one list the other variants give the reader. What moves is only the right column: picking
 * another agent swaps it for that agent's models with a crossfade and a short slide, so the
 * change is read as a change rather than as a list that was there all along.
 *
 * The modes are folded two to a line here, because the band is as wide as the whole panel and
 * two of the agent's own sentences are read whole on one line of it.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/AgentModelMenu/Panes',
  component: AgentModelMenuPanes,
  render: (args) => <Controlled {...args} render={(props) => <AgentModelMenuPanes {...props} />} />,
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
} satisfies Meta<typeof AgentModelMenuPanes>

export default meta
type Story = StoryObj<typeof meta>

/** Every prop as a control, and the four answers wired to a page that behaves like the engine. */
export const Playground: Story = {}

/**
 * Nothing chosen: the agents stand on the left and the right column says what it is waiting for.
 *
 * The room the models will take is already taken, because the panel is one size from the moment
 * it opens; what stands in it is a sentence rather than an empty list, which would be a list
 * saying the agent announced nothing.
 */
export const NoAgent: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const list = await screen.findByRole('listbox', { name: 'Agents' })
    const options = within(list).getAllByRole('option')
    await expect(options).toHaveLength(4)
    await expect(options[3]).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(options[3]!)
    await expect(args.onAgentChange).not.toHaveBeenCalled()

    await expect(screen.getByText(/Choose an agent to see the models/)).toBeVisible()
    await expect(screen.queryByRole('listbox', { name: 'Models of this agent' })).toBeNull()
  },
}

/**
 * The agent's options being read, beside the same panel once they have landed.
 *
 * The models already on the right stay on the right while the new ones are read, and the
 * indicator sits in that column's header. The two panels are opened in turn and measured: the
 * same height and the same width, to the pixel.
 */
export const Loading: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center justify-center gap-6 p-6">
      <AgentModelMenuPanes
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
      <AgentModelMenuPanes
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
    sameBox(panelBox(), waitingBox)
    await expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
  },
}

/**
 * The engine could not offer the agent, and says why in its own words.
 *
 * The sentence is an alert at the top of the panel, over both columns, and the agents are still
 * on the left: here the way out of a refusal is the column that never went away.
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
      expect(screen.getByRole('listbox', { name: 'Agents' })).toBeVisible()
    })
  },
}

/**
 * The agent of a Session, which is the agent it was made with: the left column is gone.
 *
 * A column of agents none of which can be picked is a column that lies. The models take the
 * whole width instead, and the panel is the same box it always is.
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
    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeVisible()
    })
  },
}

/**
 * Thirty models under three providers, in the right-hand column.
 *
 * The column scrolls inside a panel that does not grow, and the field over it narrows the
 * thirty to the one that was meant.
 */
export const ManyModels: Story = {
  args: { agent: 'opencode' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /OpenCode/ }))

    const list = await screen.findByRole('listbox', { name: 'Models of this agent' })
    await expect(within(list).getAllByRole('option')).toHaveLength(30)
    await expect(within(list).getAllByRole('group')).toHaveLength(3)
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
    sameBox(panelBox(), box)

    await userEvent.keyboard('{Enter}')
    await expect(args.onModelChange).toHaveBeenCalledWith('opencode-zen-kimi-k2-thinking')
  },
}

/**
 * The five modes of Claude Code, two to a line and each read whole.
 *
 * The band is as wide as the panel, so folding them in two loses nothing: what is refused is a
 * label cut short, not a label sharing a line.
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
    await expect(list.querySelectorAll('svg')).toHaveLength(5)
    const effort = screen.getByRole('group', { name: 'Effort' })
    await expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      effort.getBoundingClientRect().bottom,
    )

    await userEvent.click(offered[4]!)
    await expect(args.onModeChange).toHaveBeenCalledWith('bypass-permissions')
  },
}

/**
 * The whole answer, given in one go: agent, model, effort, mode, and the panel closed.
 *
 * Every step is asserted, and so is the one thing that must never happen between two of them —
 * the panel changing size. The box is read before an agent is picked and again once its models
 * are in, and the two are the same.
 */
export const Walkthrough: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Choose an agent' })
    await userEvent.click(trigger)

    const agents = await screen.findByRole('listbox', { name: 'Agents' })
    const empty = panelBox()
    await userEvent.click(within(agents).getByRole('option', { name: /Claude Code/ }))
    await expect(args.onAgentChange).toHaveBeenCalledWith('claude-code')

    const models = await screen.findByRole('listbox', { name: 'Models of this agent' })
    await waitFor(() => {
      expect(models).toBeVisible()
    })
    // The agents never left: that is what this variant is for.
    await expect(screen.getByRole('listbox', { name: 'Agents' })).toBeVisible()
    sameBox(panelBox(), empty)

    const field = screen.getByRole('combobox', { name: 'Search the models of this agent' })
    await waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    await userEvent.type(field, 'haiku')
    await userEvent.keyboard('{Enter}')
    await expect(args.onModelChange).toHaveBeenCalledWith('haiku-4-5')

    const effort = await screen.findByRole('group', { name: 'Effort' })
    await userEvent.click(within(effort).getByRole('button', { name: 'Xhigh' }))
    await expect(args.onEffortChange).toHaveBeenCalledWith('xhigh')

    const modes = await screen.findByRole('listbox', { name: 'Mode' })
    await userEvent.click(within(modes).getByRole('option', { name: /Plan only/ }))
    await expect(args.onModeChange).toHaveBeenCalledWith('plan-only')
    await waitFor(() => {
      expect(within(modes).getByRole('option', { name: /Plan only/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
    sameBox(panelBox(), empty)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await expect(
      canvas.getByRole('button', { name: /Haiku 4\.5 · Xhigh · Plan only/ }),
    ).toHaveFocus()
  },
}
