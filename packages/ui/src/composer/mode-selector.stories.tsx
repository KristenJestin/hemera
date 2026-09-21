import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { ModeSelector } from './mode-selector.tsx'

/**
 * What the agent may do without asking. The value drawn is the mode the agent last reported, so
 * a mode it refused to take is never drawn as taken.
 */
const meta = {
  title: 'Blocks/Composer/ModeSelector',
  component: ModeSelector,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    modes: [
      { id: 'ask', name: 'Ask before edits' },
      { id: 'accept-edits', name: 'Accept edits' },
      { id: 'plan', name: 'Plan only' },
    ],
    value: 'ask',
    onValueChange: fn(),
  },
  argTypes: {
    modes: { control: 'object', description: 'What the agent announced, in its own words.' },
    value: { control: 'text', description: 'The mode the agent last reported.' },
    onValueChange: { description: 'Called with the id the agent knows, never with its name.' },
  },
} satisfies Meta<typeof ModeSelector>

export default meta

type Story = StoryObj<typeof meta>

/** The mode the agent is in, as the agent said it. */
export const WhatTheAgentReported: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Mode' })).toHaveTextContent(
      'Ask before edits',
    )
    await expect(canvasElement.querySelector('.size-icon-sm')).not.toBeNull()
  },
}

/** An agent that announced no mode cannot be put in one. */
export const NothingAnnounced: Story = {
  args: { modes: [], value: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Changing the mode is a request: what the control shows is still the last thing the agent
 * reported, and the story says so rather than pretending the change took. */
export const AskingForAnotherMode: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Mode' }))
    const choices = await screen.findAllByRole('option')
    await expect(choices).toHaveLength(3)
    // Every mode of the list wears the mark of the control, not only the chosen one.
    await expect(choices.map((choice) => choice.querySelector('.size-icon-sm'))).not.toContain(null)
    await userEvent.click(await screen.findByRole('option', { name: 'Plan only' }))
    await expect(args.onValueChange).toHaveBeenCalledWith('plan')
    await expect(canvas.getByRole('combobox', { name: 'Mode' })).toHaveTextContent(
      'Ask before edits',
    )
    // The list is waited out before the play ends: a popup on its way out is a focus guard still
    // in the document, and the accessibility check that runs after the play is right to name it.
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull()
    })
  },
}
