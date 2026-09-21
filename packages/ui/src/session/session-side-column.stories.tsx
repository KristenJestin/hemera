import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SessionSideColumn } from './session-side-column.tsx'

/**
 * The two things a reader checks on while an agent works, beside the thread rather than in it.
 */
const meta = {
  title: 'Blocks/Session/SessionSideColumn',
  component: SessionSideColumn,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    plan: [
      { content: 'Read the session page and the scroller', priority: 'high', status: 'completed' },
      { content: 'Draw the stopped turn line', priority: 'medium', status: 'in_progress' },
    ],
    files: [
      { path: 'packages/ui/src/session/plan-panel.tsx', added: 42, removed: 3 },
      { path: 'packages/ui/src/session/session-side-column.tsx', added: 61, removed: 0 },
    ],
    onSelectFile: fn(),
  },
  argTypes: {
    plan: { control: 'object', description: 'The plan as the agent last sent it.' },
    files: { control: 'object', description: 'The files the turn has touched.' },
    onSelectFile: { description: 'Opens a file, when the reader presses its path.' },
  },
} satisfies Meta<typeof SessionSideColumn>

export default meta

type Story = StoryObj<typeof meta>

/** A file is listed because a call named it, with what the change added up to. */
export const WhatTheTurnHasDone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const files = canvas.getByRole('button', { name: /Files/ })
    await userEvent.click(files)
    await expect(canvas.getByText('packages/ui/src/session/plan-panel.tsx')).toBeVisible()
    await expect(canvas.getByText('+42')).toBeVisible()
    await expect(canvas.getByText('-3')).toBeVisible()
  },
}

/** A turn that has touched nothing yet says so, rather than showing an empty list. */
export const NothingTouched: Story = {
  args: { files: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Files/ }))
    await expect(canvas.getByText('No file has been touched yet.')).toBeVisible()
  },
}

/** Pressing a path opens that file, which is the only thing this column does. */
export const OpeningAFile: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Files/ }))
    await userEvent.click(
      canvas.getByRole('button', { name: 'packages/ui/src/session/plan-panel.tsx' }),
    )
    await expect(args.onSelectFile).toHaveBeenCalledWith('packages/ui/src/session/plan-panel.tsx')
  },
}
