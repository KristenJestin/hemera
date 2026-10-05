import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AGENTS, LONG_AGENTS } from './model-picker-fixtures.ts'
import { type ModelChoice, ModelPicker, type PickerAgent } from './model-picker.tsx'

/**
 * The model picker: one popover, the same in the app's settings, a Project's, the check before a
 * launch and the Chat. Agents as tabs, then their models with a search; effort as a gauge, the
 * mode and who judges permissions as compact marks whose words are the tooltip. It opens with the
 * focus in the search and updates in place: the list keeps its height whatever is typed.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/ModelPicker',
  component: ModelPicker,
  args: {
    label: 'Model of the Builder',
    agents: AGENTS,
    value: { agent: 'claude', model: 'sonnet' },
    onChange: fn(),
    onFavourite: fn(),
    onHide: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen items-start justify-center p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModelPicker>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** The trigger alone: the agent and the model, and no mark, since everything else is default. */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', {
      name: 'Model of the Builder: Claude Code · Sonnet',
    })
    await expect(trigger).toBeVisible()
  },
}

/** Every mark at once: effort as a gauge, a mode that is not the agent's own, Hemera Auto judging. */
export const Marks: Story = {
  args: {
    value: { agent: 'claude', model: 'opus', effort: 'high', mode: 'plan' },
    judge: 'auto',
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', {
        name: 'Model of the Builder: Claude Code · Opus · effort high · mode Plan · Hemera Auto judges permissions',
      }),
    ).toBeVisible()
  },
}

/** Open: the agents, the current one's models with the current one checked, its effort and mode. */
export const Open: Story = {
  args: { open: true, value: { agent: 'claude', model: 'opus', effort: 'high' } },
  play: async () => {
    await expect(await body().findByRole('option', { name: /Opus/, selected: true })).toBeVisible()
    await expect(body().getByRole('radio', { name: 'high' })).toBeChecked()
    await waitFor(() =>
      expect(body().getByRole('combobox', { name: 'Search models' })).toHaveFocus(),
    )
  },
}

/**
 * The keyboard path: open, the focus is in the search; type, Down, Enter picks; Tab reaches the
 * effort; Escape closes and the focus is back on the trigger.
 */
export const Picking: Story = {
  render: function Render(args) {
    const [value, setValue] = useState<ModelChoice | null>(args.value)
    return (
      <ModelPicker
        {...args}
        value={value}
        onChange={(next) => {
          setValue(next)
          args.onChange(next)
        }}
      />
    )
  },
  play: async ({ args, canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: /Model of the Builder/ })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const search = await body().findByRole('combobox', { name: 'Search models' })
    await waitFor(() => expect(search).toHaveFocus())
    await userEvent.keyboard('hai')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(args.onChange).toHaveBeenLastCalledWith({ agent: 'claude', model: 'haiku' })
    await expect(trigger).toHaveAccessibleName('Model of the Builder: Claude Code · Haiku')
    await userEvent.clear(search)
    await userEvent.type(search, 'opus')
    await userEvent.keyboard('{Enter}')
    await expect(args.onChange).toHaveBeenLastCalledWith({ agent: 'claude', model: 'opus' })
    await userEvent.tab()
    const effort = body().getByRole('radiogroup', { name: 'Effort' })
    await expect(within(effort).getByRole('radio', { name: 'Default' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect(args.onChange).toHaveBeenLastCalledWith({
      agent: 'claude',
      model: 'opus',
      effort: 'medium',
    })
    // The first Escape puts away the gauge's tooltip, the second the picker.
    await userEvent.keyboard('{Escape}{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

/** Another agent's tab: its own models, the search kept; the list does not change height. */
export const OtherAgent: Story = {
  args: { open: true },
  play: async () => {
    const list = await body().findByRole('listbox', { name: 'Models of Claude Code' })
    const before = list.getBoundingClientRect().height
    await userEvent.click(body().getByRole('tab', { name: 'Codex' }))
    const codex = await body().findByRole('listbox', { name: 'Models of Codex' })
    await expect(within(codex).getByRole('option', { name: /gpt-5-codex/ })).toBeVisible()
    await expect(codex.getBoundingClientRect().height).toBe(before)
  },
}

/** A search nothing matches: said once, in the list's own room. */
export const NoMatch: Story = {
  args: { open: true },
  play: async () => {
    const search = await body().findByRole('combobox', { name: 'Search models' })
    await userEvent.type(search, 'zzz')
    await expect(body().getByText('No model matches “zzz”')).toBeVisible()
  },
}

/** A Project or a mission: "Use the default" heads the list, and the default shows no mark. */
export const UsesTheDefault: Story = {
  args: {
    label: 'Model of the Reviewer',
    value: null,
    fallback: { agent: 'codex', model: 'gpt-large', effort: 'high' },
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', {
      name: 'Model of the Reviewer: Default (Codex · gpt-5)',
    })
    await userEvent.click(trigger)
    await expect(
      await body().findByRole(
        'option',
        { name: /Use the default/, selected: true },
        // The popover opens on a click under load too: given the time a busy runner takes.
        { timeout: 5000 },
      ),
    ).toBeVisible()
  },
}

/** The agent not installed: its tab says so, and its pane is its install command. */
export const AgentNotInstalled: Story = {
  args: { open: true },
  play: async () => {
    await userEvent.click(await body().findByRole('tab', { name: 'OpenCode' }))
    await expect(body().getByText('npm install -g opencode-ai')).toBeVisible()
    await expect(body().queryByRole('listbox', { name: 'Models of OpenCode' })).toBeNull()
  },
}

/** The model chosen is one the agent no longer offers: the trigger says so with its glyph. */
export const NoLongerOffered: Story = {
  args: { value: { agent: 'codex', model: 'gpt-retired' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', {
        name: 'Model of the Builder: Codex · gpt-retired · Codex no longer offers this model',
      }),
    ).toBeVisible()
  },
}

/** Favourites and hidden models: the list in its edit mode, every model with its two toggles. */
export const Editing: Story = {
  args: { open: true },
  play: async ({ args }) => {
    await userEvent.click(
      await body().findByRole('button', { name: 'Choose favourites and hidden models' }),
    )
    const hidden = body().getByRole('button', { name: 'Hide Opus (previous)' })
    await expect(hidden).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(body().getByRole('button', { name: 'Favourite Haiku' }))
    await expect(args.onFavourite).toHaveBeenCalledWith('claude', 'haiku', true)
    await userEvent.click(hidden)
    await expect(args.onHide).toHaveBeenCalledWith('claude', 'opus-legacy', false)
  },
}

/** A long model name and a long list: the name is cut, the list scrolls in its own height. */
export const LongText: Story = {
  args: {
    open: true,
    agents: LONG_AGENTS,
    value: { agent: 'claude', model: 'long', effort: 'low' },
  },
}

/** No agent installed at all: every tab is its install command. */
export const NothingInstalled: Story = {
  args: {
    open: true,
    value: null,
    fallback: undefined,
    agents: AGENTS.map((agent): PickerAgent =>
      agent.installed
        ? { id: agent.id, name: agent.name, installed: false, install: `install ${agent.id}` }
        : agent,
    ),
  },
}
