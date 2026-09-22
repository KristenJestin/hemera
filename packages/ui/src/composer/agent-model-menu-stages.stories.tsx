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
import type { ModelChoice } from './agent-model-menu-shared.tsx'
import { AgentModelMenuStages } from './agent-model-menu-stages.tsx'

/**
 * The models of an agent that named the one it advises, which is what its `Default` became.
 *
 * The same five, with one of them carrying the agent's own recommendation and no `Default` row
 * anywhere: the two never stand in the same list.
 */
const ADVISED_MODELS: ModelChoice[] = CLAUDE_MODELS.map((one) =>
  one.id === 'opus-4-5' ? { id: one.id, label: one.label, recommended: true } : one,
)

/**
 * **Variant A — the stages.** One list at a time: the agents, then the models of the one that
 * was picked, with the effort and the modes under them.
 *
 * It is the narrow panel — `w-menu` — and the one that asks the four questions in the order
 * they make sense in. The price is a stage change, and the stage change is the thing to judge:
 * the two stages sit side by side on one rail twice the panel's width, and going on moves the
 * rail one panel to the left, so the models are read as pushing the agents out of the way
 * rather than as replacing them. The box around them never moves a pixel. The way back is the
 * line at the top, which carries the agent it is leaving so the eye keeps its place.
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

/** How far the rail has been carried from where it started, in pixels. */
function travelledBy(rail: Element): number {
  const written = getComputedStyle(rail).transform
  return written === 'none' ? 0 : new DOMMatrixReadOnly(written).m41
}

/** Where the rail sat, frame by frame, for as long as a stage takes to cross. */
function travelOf(rail: Element, frames: number): Promise<number[]> {
  const seen: number[] = []
  return new Promise((settle) => {
    const look = (): void => {
      seen.push(travelledBy(rail))
      if (seen.length >= frames) settle(seen)
      else requestAnimationFrame(look)
    }
    look()
  })
}

/**
 * The stage change as a carousel: the models push the agents out, and the agents push back.
 *
 * It used to be two absolutely positioned surfaces entering and leaving in the same place, and
 * the maintainer read it as a swap rather than as travel — the leaving one was drawn over the
 * arriving one, and neither pushed anything. The two stages sit side by side on one rail twice
 * the panel's width now, and the rail is what moves: one panel to the left on the way on, the
 * same panel back on the way in reverse. Nothing is unmounted, so both stages are fully drawn
 * the whole way across and there is never a blank edge behind the one that is leaving.
 *
 * Read over the frames rather than at one moment, for the reason the thread's fold gives: what
 * a swap looks like is a rail that was at one rest position and then at the other with nothing
 * in between, and the only way to refuse that is to find the in between.
 */
export const ACarousel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const rail = await screen.findByTestId('stage-rail')
    const agents = await screen.findByRole('listbox', { name: 'Agents' })
    // One panel is what the rail travels, and the rail's own box is exactly one panel wide.
    const panel = rail.getBoundingClientRect().width
    await expect(panel).toBeGreaterThan(0)
    // At rest on the agents: nothing is carrying the rail anywhere.
    await waitFor(() => {
      expect(travelledBy(rail)).toBeCloseTo(0, 0)
    })

    await userEvent.click(within(agents).getByRole('option', { name: /Claude Code/ }))
    const onward = await travelOf(rail, 40)
    // Caught on the way: at least one frame has it neither where it was nor where it is going,
    // which is the whole difference between travelling and being swapped.
    await expect(
      onward.some((x) => x < -1 && x > -panel + 1),
      'the stage was swapped instead of pushed',
    ).toBe(true)
    // And at rest on the models: exactly one panel to the left, so the model block fills the box.
    await waitFor(() => {
      expect(travelledBy(rail)).toBeCloseTo(-panel, 0)
    })
    // Both blocks are drawn the whole way: the agents are still in the page, off to the left.
    await expect(agents).toBeInTheDocument()

    // The caret is handed to the search field once the travelling is over, and not before.
    const searching = screen.getByRole('combobox', { name: 'Search the models of this agent' })
    await waitFor(() => {
      expect(document.activeElement).toBe(searching)
    })

    // And back the other way, which is the same movement mirrored.
    await userEvent.click(screen.getByRole('button', { name: /Claude Code Change/ }))
    const back = await travelOf(rail, 40)
    await expect(
      back.some((x) => x < -1 && x > -panel + 1),
      'the way back was a swap rather than the same travel mirrored',
    ).toBe(true)
    await waitFor(() => {
      expect(travelledBy(rail)).toBeCloseTo(0, 0)
    })
  },
}

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

    // Straight onto the models, with no stage before them, and the panel named for what it
    // holds: there is no agent stage here, so there is no agent in its name either.
    await expect(
      await screen.findByRole('listbox', { name: 'Models of this agent' }),
    ).toBeInTheDocument()
    await expect(screen.getByRole('dialog', { name: 'Model, effort and mode' })).toBeInTheDocument()
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
 * **The model the agent advises**, which is what its `Default` row becomes once it says what
 * that row stood for (decision of 22 September 2026).
 *
 * There is no `Default` in this list. The agent named the model its default resolves to, so the
 * row is gone and `Opus 4.5` is named as the recommendation in its place — one quiet word at
 * the end of its line, which is a word about that model rather than a model of its own. A list
 * holding both would be offering the same model twice under two names.
 */
export const WithRecommended: Story = {
  args: {
    agent: 'claude-code',
    models: ADVISED_MODELS,
    efforts: CLAUDE_EFFORTS,
    modes: CLAUDE_MODES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Claude Code/ }))

    const list = await screen.findByRole('listbox', { name: 'Models of this agent' })
    // Never both: the row the agent resolved is gone, and only the model it named is marked.
    await expect(within(list).queryByRole('option', { name: /Default/ })).toBeNull()
    // Waited out rather than read the moment it exists: the panel comes down from its trigger
    // in opacity, and nothing drawn halfway through that is visible yet.
    await waitFor(() => {
      expect(within(list).getByRole('option', { name: 'Opus 4.5 recommended' })).toBeVisible()
    })
    await expect(within(list).getAllByText('recommended')).toHaveLength(1)
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
