import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { ModelSelector } from './model-selector.tsx'

/**
 * The model the agent announced, drawn as a control and nothing more: no list of Hemera's own,
 * no model the agent behind it cannot run.
 */
const meta = {
  title: 'Components/ModelSelector',
  component: ModelSelector,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    agent: 'Claude Code',
    models: [
      { id: 'claude-opus-4-5', name: 'Opus 4.5' },
      { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
      { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
    ],
    value: 'claude-opus-4-5',
    onValueChange: fn(),
  },
  argTypes: {
    agent: { control: 'text', description: 'The agent whose models these are.' },
    models: { control: 'object', description: 'What the agent announced, in its own words.' },
    value: { control: 'text', description: 'The model the next turn will use.' },
    onValueChange: { description: 'Called with the id the agent knows, never with its name.' },
  },
} satisfies Meta<typeof ModelSelector>

export default meta

type Story = StoryObj<typeof meta>

/** The models the agent announced, with the one it opened on. */
export const WhatTheAgentAnnounced: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Opus 4.5')
    // An agent the icon catalogue does not carry is drawn as its own initials, not as
    // somebody else's logo and not as a generic robot.
    await expect(canvas.getByText('CC')).toBeVisible()
  },
}

/** The one agent the catalogue does carry a mark for. */
export const AnAgentTheCatalogueHas: Story = {
  args: {
    agent: 'Codex',
    models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }],
    value: 'gpt-5-codex',
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.size-icon-md')).not.toBeNull()
  },
}

/** An agent that announced no model is not handed a control to guess with. */
export const NothingAnnounced: Story = {
  args: { models: [], value: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Choosing is the user's, and what goes back is the id — the name is the reader's, not the
 * agent's. */
export const ChoosingAModel: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Model' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Haiku 4.5' }))
    await expect(args.onValueChange).toHaveBeenCalledWith('claude-haiku-4-5')
    // The list is waited out before the play ends: a popup on its way out is a focus guard still
    // in the document, and the accessibility check that runs after the play is right to name it.
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull()
    })
  },
}
