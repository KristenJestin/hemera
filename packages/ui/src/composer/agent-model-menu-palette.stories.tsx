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
import { AgentModelMenuPalette } from './agent-model-menu-palette.tsx'

/**
 * **Variant C — the palette.** One field over one list, and no stages at all.
 *
 * Every row is an agent and a model at once, grouped under the agent that announced it, and
 * typing narrows across all of them: a reader who knows the name of the model goes straight to
 * it and never chooses an agent as a separate act. The effort and the modes are under the list,
 * exactly where the other two variants put them.
 *
 * The honest limit of it: the engine answers one agent at a time, so the models of the agents
 * that are not the current one are not known yet. Those agents are one row each — picking it is
 * what asks — and their models join the list when they land. What this variant is being judged
 * on is whether that reads as a palette or as a list with a hole in it.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/AgentModelMenu/Palette',
  component: AgentModelMenuPalette,
  render: (args) => (
    <Controlled {...args} render={(props) => <AgentModelMenuPalette {...props} />} />
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
} satisfies Meta<typeof AgentModelMenuPalette>

export default meta
type Story = StoryObj<typeof meta>

/** Every prop as a control, and the four answers wired to a page that behaves like the engine. */
export const Playground: Story = {}

/**
 * Nothing chosen: one row per agent, each under its own mark, and the field over all of them.
 *
 * No agent has been asked yet, so no model is known of any of them: the list says exactly that
 * rather than showing rows nobody can honour.
 */
export const NoAgent: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const list = await screen.findByRole('listbox', { name: 'Agents and their models' })
    await expect(within(list).getAllByRole('option')).toHaveLength(4)
    await expect(within(list).getAllByRole('group')).toHaveLength(4)

    const signedOut = within(list).getByRole('option', { name: /Gemini CLI/ })
    await expect(signedOut).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(signedOut)
    await expect(args.onAgentChange).not.toHaveBeenCalled()
  },
}

/**
 * The agent's options being read, beside the same panel once they have landed.
 *
 * The list stays the list and the indicator sits in the header. The two panels are opened in
 * turn and measured: the same height and the same width, to the pixel.
 */
export const Loading: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center justify-center gap-6 p-6">
      <AgentModelMenuPalette
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
      <AgentModelMenuPalette
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
    const reading = await screen.findByRole('listbox', { name: 'Agents and their models' })
    // Five models of the agent that answered, and one row for each of the three that have not.
    await expect(within(reading).getAllByRole('option')).toHaveLength(8)
    await expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    await expect(screen.queryByText(/Reading what this agent offers/)).toBeNull()
    const waitingBox = panelBox()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    await userEvent.click(answered!)
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Agents and their models' })).toBeVisible()
    })
    sameBox(panelBox(), waitingBox)
    await expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
  },
}

/**
 * The engine could not offer the agent, and says why in its own words.
 *
 * The sentence is an alert at the top of the panel, and the list under it is the whole machine
 * again: the way out of a refusal is the next agent down.
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
    const list = await screen.findByRole('listbox', { name: 'Agents and their models' })
    await expect(within(list).getAllByRole('option')).toHaveLength(4)
  },
}

/**
 * The agent of a Session, which is the agent it was made with: its models, and nothing else.
 *
 * A palette that offered the other agents to a Session that cannot change its own would be a
 * palette offering something that would be refused after the fact.
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

    const list = await screen.findByRole('listbox', { name: 'Agents and their models' })
    await expect(within(list).getAllByRole('option')).toHaveLength(5)
    await expect(within(list).getAllByRole('group')).toHaveLength(1)
    await expect(within(list).queryByRole('option', { name: /Codex/ })).toBeNull()
  },
}

/**
 * Thirty models under one agent, and the three others one row each.
 *
 * This is where the palette is at its longest, and where the field it is built around has to
 * do the work: typing four letters is the whole distance between opening it and being done.
 */
export const ManyModels: Story = {
  args: { agent: 'opencode' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /OpenCode/ }))

    const list = await screen.findByRole('listbox', { name: 'Agents and their models' })
    await expect(within(list).getAllByRole('option')).toHaveLength(33)
    const box = panelBox()
    await expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom + 1)

    const field = screen.getByRole('combobox', { name: 'Search every agent and model' })
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
 * The five modes of Claude Code, each read whole, under the list.
 *
 * The palette has no stage to put them behind, so they are the last thing in the panel and the
 * list above them is what gives way — which is the trade this variant is offering.
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
 * The agent is a row of the same list as the models, so the walk has no stage in it at all —
 * and the box is measured before and after all the same, because a list that grows a group is
 * still a list inside a panel that does not move.
 */
export const Walkthrough: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const list = await screen.findByRole('listbox', { name: 'Agents and their models' })
    const empty = panelBox()
    await userEvent.click(within(list).getByRole('option', { name: /Claude Code/ }))
    await expect(args.onAgentChange).toHaveBeenCalledWith('claude-code')

    await waitFor(() => {
      expect(within(list).getAllByRole('option')).toHaveLength(8)
    })
    sameBox(panelBox(), empty)

    const field = screen.getByRole('combobox', { name: 'Search every agent and model' })
    await userEvent.type(field, 'haiku')
    await waitFor(() => {
      expect(within(list).getAllByRole('option')).toHaveLength(1)
    })
    await userEvent.keyboard('{Enter}')
    await expect(args.onModelChange).toHaveBeenCalledWith('haiku-4-5')
    await expect(document.activeElement).toBe(field)

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
