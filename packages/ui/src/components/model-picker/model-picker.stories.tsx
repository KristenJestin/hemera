import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  AGENTS,
  AGENTS_FAILED,
  AGENTS_LOADING,
  AGENTS_SIGNED_OUT,
  LONG_AGENTS,
} from './model-picker-fixtures.ts'
import { type ModelChoice, ModelPicker } from './model-picker.tsx'

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

/** Every mark at once: the agent's mark, effort as a gauge, Hemera Auto judging. */
export const Marks: Story = {
  args: {
    value: { agent: 'claude', model: 'opus', effort: 'high' },
    judge: 'auto',
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', {
        name: 'Model of the Builder: Claude Code · Opus · effort high · Hemera Auto judges permissions',
      }),
    ).toBeVisible()
  },
}

/**
 * Open: the agents as their marks, the current one's models with the current one checked, and
 * under them its effort, the model's default marked with a dot.
 */
export const Open: Story = {
  args: { open: true, value: { agent: 'claude', model: 'opus', effort: 'max' } },
  play: async () => {
    await expect(await body().findByRole('option', { name: /Opus/, selected: true })).toBeVisible()
    const effort = body().getByRole('radiogroup', { name: 'Effort' })
    await expect(within(effort).getByRole('radio', { name: 'Max' })).toBeChecked()
    await expect(
      within(effort).getByRole('radio', { name: "High, the model's default" }),
    ).not.toBeChecked()
    await waitFor(() =>
      expect(body().getByRole('combobox', { name: 'Search models' })).toHaveFocus(),
    )
  },
}

/**
 * The keyboard path: open, the focus is in the search; type, Down, Enter picks; Tab reaches the
 * effort (after the edit toggle) on the model's default, the arrows walk it, and back on the
 * default no effort is chosen; Escape closes and the focus is back on the trigger.
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
    // Past the edit toggle beside the search, the effort.
    await userEvent.tab()
    await userEvent.tab()
    const fallback = body().getByRole('radio', { name: "High, the model's default" })
    await expect(fallback).toHaveFocus()
    await expect(fallback).toBeChecked()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(args.onChange).toHaveBeenLastCalledWith({
      agent: 'claude',
      model: 'opus',
      effort: 'medium',
    })
    await expect(body().getByRole('radio', { name: 'Medium' })).toBeChecked()
    await userEvent.keyboard('{ArrowRight}')
    await expect(args.onChange).toHaveBeenLastCalledWith({
      agent: 'claude',
      model: 'opus',
      effort: undefined,
    })
    await userEvent.keyboard('{Escape}')
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

/** An agent with no model to offer: said as such, never as a search that found nothing. */
export const NoModel: Story = {
  args: {
    open: true,
    agents: [{ id: 'claude', name: 'Claude Code', models: [] }],
    value: { agent: 'claude', model: 'sonnet' },
  },
  play: async () => {
    await expect(await body().findByText('No model to choose yet')).toBeVisible()
    await expect(body().queryByText(/No model matches/)).toBeNull()
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
    // Visible once the popover has finished coming in, which a busy runner can take a while to do.
    await waitFor(
      () =>
        expect(
          body().getByRole('option', { name: /Use the default/, selected: true }),
        ).toBeVisible(),
      { timeout: 5000 },
    )
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

/** No agent on this machine: said once, in the panel's room. */
export const NoAgent: Story = { args: { open: true, agents: [], value: null } }

/** Set in another box, as in the composer: no frame of its own, and it opens upwards. */
export const Bare: Story = {
  args: { bare: true, value: { agent: 'codex', model: 'gpt-codex', effort: 'medium' } },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen items-end p-8">
        <Story />
      </div>
    ),
  ],
}

/** A model whose agent does not say its default effort: "Default" comes first among the levels. */
export const NoKnownDefault: Story = {
  args: { open: true, value: { agent: 'claude', model: 'sonnet-1m' } },
  play: async () => {
    const effort = await body().findByRole('radiogroup', { name: 'Effort' })
    await expect(within(effort).getByRole('radio', { name: 'Default' })).toBeChecked()
    await expect(within(effort).getAllByRole('radio')).toHaveLength(4)
  },
}

/** An agent installed but not signed in: its mark is there, not choosable, why in its tooltip. */
export const NotSignedIn: Story = {
  args: { open: true, agents: AGENTS_SIGNED_OUT },
  play: async () => {
    const codex = await body().findByRole('tab', { name: 'Codex · Not signed in' })
    await expect(codex).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(codex)
    await expect(body().getByRole('tab', { name: 'Claude Code' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

/** The models on their way: skeleton rows of a model's shape in the list's own room. */
export const ModelsLoading: Story = {
  args: { open: true, value: null, agents: AGENTS_LOADING },
  play: async () => {
    const list = await body().findByRole('listbox', { name: 'Models of Claude Code' })
    await expect(list).toHaveAttribute('aria-busy', 'true')
    await expect(within(list).queryAllByRole('option')).toHaveLength(0)
  },
}

/**
 * The models landing while the picker is open: the popover keeps its box, the list its height,
 * from the skeleton rows to the models.
 */
export const ModelsLanding: Story = {
  args: { open: true, value: null, agents: AGENTS_LOADING },
  render: function Render(args) {
    const [agents, setAgents] = useState(args.agents)
    useEffect(() => {
      const landing = setTimeout(() => setAgents(AGENTS), 600)
      return () => clearTimeout(landing)
    }, [])
    return <ModelPicker {...args} agents={agents} />
  },
  play: async () => {
    const panel = await body().findByRole('dialog', { name: 'Model of the Builder' })
    await body().findByRole('listbox', { name: 'Models of Claude Code', busy: true })
    const before = panel.getBoundingClientRect()
    await body().findByRole('option', { name: /Opus/ }, { timeout: 5000 })
    const after = panel.getBoundingClientRect()
    await expect([after.width, after.height]).toEqual([before.width, before.height])
  },
}

/** The models could not be read: said in words in the list's room, with Retry. */
export const ModelsFailed: Story = {
  args: { open: true, value: null, agents: AGENTS_FAILED, onRetry: fn() },
  play: async ({ args }) => {
    await expect(
      await body().findByText('Claude Code did not list its models in time.'),
    ).toBeVisible()
    await userEvent.click(body().getByRole('button', { name: 'Retry' }))
    await expect(args.onRetry).toHaveBeenCalledWith('claude')
  },
}
