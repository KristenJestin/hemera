import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { AgentModelMenu } from './agent-model-menu.tsx'
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

/**
 * **What the next turn runs on, asked in one place**: which agent, then which of the models
 * *that* agent announced, then how hard it should think and what it may do without asking.
 *
 * It is two stages. The agents are the first; picking one takes the panel to the second, where
 * the models are searched on the left and the effort and the modes stand in a column of their
 * own on the right, under the line that names the agent and is the way back. The two stages sit
 * side by side on one rail twice the panel's width, and going on moves the rail one panel to
 * the left, so the models are read as pushing the agents out of the way rather than as
 * replacing them.
 *
 * **The box never moves a pixel** — one height and one width, on both stages, while the agent's
 * options are being read and once they have landed. It opens upwards out of the foot of the
 * composer, where a panel that grew would be flipped to the other side under the hand that
 * opened it. The agent stage has four rows and does not fill that box: it is drawn at the top
 * of it, and what is left under it is the panel's own surface.
 */
const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Blocks/Composer/AgentModelMenu',
  component: AgentModelMenu,
  render: (args) => <Controlled {...args} render={(props) => <AgentModelMenu {...props} />} />,
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
} satisfies Meta<typeof AgentModelMenu>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The models of an agent that named the one it advises, which is what its `Default` became.
 *
 * The same five, with one of them carrying the agent's own recommendation and no `Default` row
 * anywhere: the two never stand in the same list.
 */
const ADVISED_MODELS: ModelChoice[] = CLAUDE_MODELS.map((one) =>
  one.id === 'opus-4-5' ? { id: one.id, label: one.label, recommended: true } : one,
)

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

/** The level the rule across the scale stands at, or `null` when there is no rule at all. */
function ruleOf(effort: HTMLElement): string | null {
  const rule = within(effort).queryByTestId('effort-rule')
  return rule?.closest('[data-step]')?.getAttribute('data-step') ?? null
}

/** Every prop as a control, and the four answers wired to a page that behaves like the engine. */
export const Playground: Story = {}

/**
 * Nothing chosen: the trigger says what to do rather than naming a model of nobody's.
 *
 * The panel opens on the agents, because the model of an agent nobody picked is not a question,
 * and there is nothing to say about an effort or a mode either until one of them has answered.
 */
export const NoAgent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const list = await screen.findByRole('listbox', { name: 'Agents' })
    await expect(within(list).getAllByRole('option')).toHaveLength(4)
    // No model list, no scale and no modes: there is no agent to have announced any of them.
    await expect(screen.queryByRole('listbox', { name: 'Models of this agent' })).toBeNull()
    await expect(screen.queryByRole('slider', { name: 'Effort' })).toBeNull()
    await expect(screen.queryByRole('listbox', { name: 'Mode' })).toBeNull()
  },
}

/**
 * An agent this machine has and nobody signed in to: drawn, said why, and not offered.
 *
 * It is `aria-disabled` and not `disabled`: it is still an entry of the list, and what is the
 * matter with it — with the command that fixes it, in the engine's own words — is the reason it
 * is off. A disabled button is skipped by the keyboard and by whatever reads the page, which is
 * the one reader who cannot see the sentence beside it.
 */
export const AgentNotSignedIn: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const list = await screen.findByRole('listbox', { name: 'Agents' })
    const signedOut = within(list).getByRole('option', { name: /Gemini CLI/ })
    await expect(signedOut).toHaveTextContent('gemini login')
    await expect(signedOut).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(signedOut)
    await expect(args.onAgentChange).not.toHaveBeenCalled()
    // And the panel stays where it was: a press that answers nothing must not look like one
    // that answered something. Waited out rather than read the moment it exists: the panel
    // comes down from its trigger in opacity, and nothing halfway through that is visible yet.
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Agents' })).toBeVisible()
    })
  },
}

/**
 * An agent this machine has and that cannot run here: drawn, off, and one line under its name.
 *
 * Its adapter's reason is a paragraph, and the menu is where an agent is picked rather than where
 * that paragraph is read: the entry says it is not available here and nothing more, and the
 * reason stays whole under the agent in the settings. Off the same way a signed-out agent is —
 * `aria-disabled`, still an entry of the list, and a press that answers nothing.
 */
export const AgentNotAvailableHere: Story = {
  args: {
    agents: AGENTS.map((one) =>
      one.id === 'codex' ? { ...one, available: false, hint: 'Not available here' } : one,
    ),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const list = await screen.findByRole('listbox', { name: 'Agents' })
    const off = within(list).getByRole('option', { name: /Codex/ })
    await expect(off).toHaveTextContent(/^Codex\s*Not available here$/)
    await expect(off).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(off)
    await expect(args.onAgentChange).not.toHaveBeenCalled()
  },
}

/**
 * The agent's options being read, beside the same panel once they have landed.
 *
 * The panel used to show a single line — "Reading what this agent offers…" — in place of the
 * whole list, which made it a different panel from one second to the next; now the list that is
 * there stays there and a small indicator sits in the header beside the name of what is under
 * it. The two panels are opened in turn and measured: the same height and the same width, to
 * the pixel.
 */
export const Loading: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center justify-center gap-6 p-6">
      <AgentModelMenu
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
      <AgentModelMenu
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
 * The five modes of Claude Code, each read whole, under the effort in the column beside the
 * models.
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

    // The modes are under the effort, and the two of them stand beside the models rather than
    // under them: that is the column the maintainer kept on 22 September 2026.
    const effort = screen.getByRole('slider', { name: 'Effort' })
    const models = screen.getByRole('listbox', { name: 'Models of this agent' })
    await expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      effort.getBoundingClientRect().bottom,
    )
    await expect(effort.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      models.getBoundingClientRect().right,
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
 * **The default**, on the scale, beside what the agent advises in the list.
 *
 * There is no `Default` anywhere here. The agent named the model its default resolves to, so
 * that row is gone and `Opus 4.5` carries one quiet word at the end of its line instead. The
 * scale says the same thing its own way: the level the agent advises, `Medium`, is where the thin
 * accent rule across the track is, where the slider opens, and what `default` is said beside —
 * once, and never beside a second word of its own.
 */
export const DefaultOfTheModel: Story = {
  args: {
    agent: 'claude-code',
    model: 'fable',
    models: ADVISED_MODELS,
    efforts: CLAUDE_EFFORTS,
    modes: CLAUDE_MODES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Fable/ }))

    const list = await screen.findByRole('listbox', { name: 'Models of this agent' })
    // Never both: the row the agent resolved is gone, and only the model it named is marked.
    await expect(within(list).queryByRole('option', { name: /Default/ })).toBeNull()
    // Waited out rather than read the moment it exists: the panel comes down from its trigger
    // in opacity, and nothing drawn halfway through that is visible yet.
    await waitFor(() => {
      expect(within(list).getByRole('option', { name: 'Opus 4.5 recommended' })).toBeVisible()
    })
    await expect(within(list).getAllByText('recommended')).toHaveLength(1)

    // One rule across the track, at the level advised, which is the level the slider opens on
    // although nothing has been set.
    const effort = screen.getByRole('slider', { name: 'Effort' })
    await expect(within(effort).getAllByTestId('effort-rule')).toHaveLength(1)
    await expect(ruleOf(effort)).toBe('medium')
    await expect(effort).toHaveAttribute('aria-valuetext', 'Medium, default')
    // "Medium · default" over the track: the word beside the level's own name.
    await expect(within(effort).getByText('· default').parentElement).toHaveTextContent(
      'Medium · default',
    )
    await expect(within(effort).getByText('· default')).toBeVisible()
    await expect(within(effort).queryByText(/recommended/)).toBeNull()
  },
}

/**
 * **The rule follows the model's announcement, not the level it is on**: each model announces
 * its own efforts, and the rule stands at the one it advises, or nowhere when it advises none —
 * or the scale goes altogether with a model that announces no effort at all.
 *
 * The page answers like the engine: Claude Code is on `Xhigh`, because its own settings put
 * every model there (trial of 23 September 2026), and advises `Medium`. The rule never goes
 * where the agent is, nor where the reader clicked. And the thumb is on its notch the moment
 * the panel opens, which is the trial of 22 September 2026.
 */
export const RuleFollowsTheModel: Story = {
  args: { agent: 'claude-code', model: 'fable', effort: 'xhigh' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Fable · Xhigh/ }))

    const list = await screen.findByRole('listbox', { name: 'Models of this agent' })
    const effort = await screen.findByRole('slider', { name: 'Effort' })
    await expect(ruleOf(effort)).toBe('medium')
    await expect(effort).toHaveAttribute('aria-valuetext', 'Xhigh')
    // On its notch as soon as it is drawn, in a panel that has only just been laid out.
    const thumb = within(effort).getByTestId('effort-thumb').getBoundingClientRect()
    const notch = effort.querySelector('[data-step="xhigh"]')!.getBoundingClientRect()
    await expect(
      Math.abs(thumb.top + thumb.height / 2 - (notch.top + notch.height / 2)),
    ).toBeLessThan(1)

    // Opus: the agent stays on Xhigh, and the rule stays on the level advised.
    await userEvent.click(within(list).getByRole('option', { name: /Opus 4\.5/ }))
    await waitFor(() => {
      expect(within(list).getByRole('option', { name: /Opus 4\.5/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
    await expect(effort).toHaveAttribute('aria-valuetext', 'Xhigh')
    await expect(within(effort).getAllByTestId('effort-rule')).toHaveLength(1)
    await expect(ruleOf(effort)).toBe('medium')

    // Haiku announces no effort: no scale at all, rather than one left standing.
    await userEvent.click(within(list).getByRole('option', { name: /Haiku 4\.5/ }))
    await waitFor(() => {
      expect(screen.queryByRole('slider', { name: 'Effort' })).toBeNull()
    })

    // And back to Fable: the scale comes back with its rule.
    await userEvent.click(within(list).getByRole('option', { name: /Fable/ }))
    const again = await screen.findByRole('slider', { name: 'Effort' })
    await waitFor(() => {
      expect(ruleOf(again)).toBe('medium')
    })

    // Low is chosen: the thumb goes there and the rule stays where the agent advised.
    again.focus()
    await userEvent.keyboard('{Home}')
    await waitFor(() => {
      expect(again).toHaveAttribute('aria-valuetext', 'Low')
    })
    await expect(ruleOf(again)).toBe('medium')

    // Sonnet 3.7 advises nothing: the effort stays Low, and no rule claims a default.
    await userEvent.click(within(list).getByRole('option', { name: /Sonnet 3\.7/ }))
    await waitFor(() => {
      expect(ruleOf(again)).toBeNull()
    })
    await expect(again).toHaveAttribute('aria-valuetext', 'Low')
  },
}

/**
 * The whole answer, given in one go: agent, model, effort, mode, and the panel closed.
 *
 * Every step is asserted, and so are the two things that must never happen between them — the
 * panel changing size, and the stage being swapped rather than travelled. The rail is read
 * frame by frame on the way in and on the way back: what a swap looks like is a rail that was
 * at one rest position and then at the other with nothing in between, and the only way to
 * refuse that is to find the in between. The focus goes back to the trigger on the way out,
 * because the trigger is what opened it.
 */
export const Walkthrough: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Choose an agent' })
    await userEvent.click(trigger)

    // The agent stage, the box it is drawn in, and the rail at rest on it.
    const agents = await screen.findByRole('listbox', { name: 'Agents' })
    const onAgents = panelBox()
    const rail = await screen.findByTestId('stage-rail')
    const panel = rail.getBoundingClientRect().width
    await expect(panel).toBeGreaterThan(0)
    await waitFor(() => {
      expect(travelledBy(rail)).toBeCloseTo(0, 0)
    })

    await userEvent.click(within(agents).getByRole('option', { name: /Claude Code/ }))
    await expect(args.onAgentChange).toHaveBeenCalledWith('claude-code')
    // Caught on the way: at least one frame has the rail neither where it was nor where it is
    // going, which is the whole difference between travelling and being swapped.
    const onward = await travelOf(rail, 40)
    await expect(
      onward.some((x) => x < -1 && x > -panel + 1),
      'the stage was swapped instead of pushed',
    ).toBe(true)
    await waitFor(() => {
      expect(travelledBy(rail)).toBeCloseTo(-panel, 0)
    })
    // Both stages are drawn the whole way: the agents are still in the page, off to the left.
    await expect(agents).toBeInTheDocument()

    // The model stage, in the very same box.
    const models = await screen.findByRole('listbox', { name: 'Models of this agent' })
    await waitFor(() => {
      expect(models).toBeVisible()
    })
    sameBox(panelBox(), onAgents)

    // The field takes the caret once the travelling is over, and the arrows walk the list
    // without the caret ever leaving it.
    const field = screen.getByRole('combobox', { name: 'Search the models of this agent' })
    await waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    await userEvent.type(field, 'fable')
    await userEvent.keyboard('{Enter}')
    await expect(args.onModelChange).toHaveBeenCalledWith('fable')
    await expect(document.activeElement).toBe(field)

    // The effort, as the agent's own scale: opened on the level the agent advises while none
    // is set, and then walked to the top of it.
    const effort = await screen.findByRole('slider', { name: 'Effort' })
    await waitFor(() => {
      expect(effort).toHaveAttribute('aria-valuetext', 'Medium, default')
    })
    effort.focus()
    await userEvent.keyboard('{End}')
    await expect(args.onEffortChange).toHaveBeenCalledWith('max')

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

    // Escape closes it and hands the focus back to what opened it.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await expect(canvas.getByRole('button', { name: /Fable · Max · Plan only/ })).toHaveFocus()
  },
}

/**
 * The same panel for a reader who asked for less movement: the stage is there, and nothing
 * carried it.
 *
 * `MotionConfig` is the way the preference is said here rather than the browser's own media
 * query, for the reason the thread's own fold gives: the query is read once, when a component
 * mounts, and a story that emulates it afterwards is testing a tree that never heard. What is
 * proved is the rule — a panel told to move less does not travel faster, it arrives.
 */
export const ReducedMotion: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <Controlled {...args} render={(props) => <AgentModelMenu {...props} />} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an agent' }))

    const rail = await screen.findByTestId('stage-rail')
    const panel = rail.getBoundingClientRect().width
    const agents = await screen.findByRole('listbox', { name: 'Agents' })
    await userEvent.click(within(agents).getByRole('option', { name: /Claude Code/ }))

    // One panel to the left inside a frame, where the carousel would be a tenth of the way
    // across it: the models are simply there.
    await expect(travelledBy(rail)).toBeCloseTo(-panel, 0)
    await expect(screen.getByRole('listbox', { name: 'Models of this agent' })).toBeInTheDocument()
  },
}
