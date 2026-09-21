import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { EffortSelector } from './effort-selector.tsx'

/**
 * The efforts the agent announced. Three here, none for an agent that thinks at one speed.
 */
const meta = {
  title: 'Components/EffortSelector',
  component: EffortSelector,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    efforts: [
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' },
    ],
    value: 'medium',
    onValueChange: fn(),
  },
  argTypes: {
    efforts: { control: 'object', description: 'What the agent announced, in its own words.' },
    value: { control: 'text', description: 'The effort the next turn will run at.' },
    onValueChange: { description: 'Called with the id the agent knows, never with its name.' },
  },
} satisfies Meta<typeof EffortSelector>

export default meta

type Story = StoryObj<typeof meta>

/** What an agent that offers levels looks like. */
export const WhatTheAgentAnnounced: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Effort' })).toHaveTextContent('Medium')
  },
}

/** An agent with one speed is not given a control with one item in it. */
export const NothingAnnounced: Story = {
  args: { efforts: [], value: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** More thinking is asked for with the agent's own word for it. */
export const AskingForMore: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Effort' }))
    await userEvent.click(await screen.findByRole('option', { name: 'High' }))
    await expect(args.onValueChange).toHaveBeenCalledWith('high')
    // The list is waited out before the play ends: a popup on its way out is a focus guard still
    // in the document, and the accessibility check that runs after the play is right to name it.
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull()
    })
  },
}
