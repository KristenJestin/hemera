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

/**
 * The mode the agent is in, as the agent said it — and the mark of *that* mode on the trigger.
 *
 * One shield over the whole list said "this control is about permissions" three times over and
 * never which of the three was chosen. The trigger wears the mark of what is set, so the mode
 * is read off it without opening anything.
 */
export const WhatTheAgentReported: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: 'Mode' })
    await expect(trigger).toHaveTextContent('Ask before edits')
    await expect(trigger.querySelector('.size-icon-sm')).not.toBeNull()

    // The mark of the mode and not of the control: asking is a shield, and the shield is what
    // the chevron beside it is not.
    const marks = trigger.querySelectorAll('svg')
    await expect(marks).toHaveLength(2)
    await expect(marks[0]!.innerHTML).not.toBe(marks[1]!.innerHTML)
  },
}

/** A mode the catalogue has no word for is drawn as a setting of the agent, not guessed at. */
export const AModeNobodyKnows: Story = {
  args: { modes: [{ id: 'yolo', name: 'Bypass everything' }], value: 'yolo' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: 'Mode' })
    await expect(trigger).toHaveTextContent('Bypass everything')
    await expect(trigger.querySelector('svg')).not.toBeNull()
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
    // Every mode wears a mark of its own, and no two of them are the same: asking is a shield,
    // editing a pencil, planning a sheet. Compared as drawings rather than by class name —
    // what the catalogue calls an icon is its business, what it draws is the reader's.
    const marks = choices.map((choice) => choice.querySelector('svg')?.innerHTML)
    await expect(marks).not.toContain(undefined)
    await expect(new Set(marks).size).toBe(3)
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
