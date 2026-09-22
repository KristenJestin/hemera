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

/**
 * A turn that has touched nothing yet draws no Files section (review of #40, defect 3).
 *
 * A section with nothing to show is not drawn: what is left is the plan, and the files are not a
 * section until one of them is named.
 */
export const NothingTouched: Story = {
  args: { files: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /Files/ })).toBeNull()
    // What is left is the plan, folded: its count and the step it is on are what a folded plan
    // still says.
    await expect(canvas.getByText('Plan')).toBeVisible()
    await expect(canvas.getByText('1 of 2')).toBeVisible()
    await expect(canvas.getByText('Draw the stopped turn line')).toBeVisible()
  },
}

/**
 * A Session with neither a plan nor a file draws no column at all (review of #40, defect 3).
 *
 * An empty `Plan 0 of 0` and an empty Files section take the width of the thread beside them to
 * say nothing, so the column is not there and the width is the thread's.
 */
export const NothingToStandBeside: Story = {
  args: { plan: [], files: [] },
  play: async ({ canvasElement }) => {
    expect(canvasElement).toBeEmptyDOMElement()
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
