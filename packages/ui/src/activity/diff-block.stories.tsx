import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { DiffBlock } from './diff-block.tsx'

/**
 * One file’s change (design D17-07).
 *
 * Three changes: a file that did not exist, a paragraph that was rewritten in place, and a file
 * long enough that the box has to scroll. The counts are on the folded line because that is what
 * the block is asked — how far did this go — and the lines are behind it for when the answer is
 * “show me”.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Components/DiffBlock',
  component: DiffBlock,
  parameters: { layout: 'padded' },
  args: {
    path: 'packages/ui/src/session/session.tsx',
    oldText: 'export function SessionPage() {\n  return null\n}\n',
    newText: 'export function SessionPage() {\n  return <SessionThread />\n}\n',
    defaultOpen: true,
  },
  argTypes: {
    path: { control: 'text', description: 'The absolute path, as the agent reported it.' },
    oldText: { control: 'text', description: 'What the file held, or null when it was created.' },
    newText: { control: 'text', description: 'What the file holds now.' },
    defaultOpen: { control: 'boolean', description: 'Whether it starts open.' },
  },
} satisfies Meta<typeof DiffBlock>

export default meta

type Story = StoryObj<typeof meta>

/** A changed line, counted on both sides. */
export const Changed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('+1')).toBeVisible()
    await expect(canvas.getByText('-1')).toBeVisible()
    await expect(canvas.getByText('return <SessionThread />')).toBeVisible()
    await expect(canvas.getByText('return null')).toBeVisible()
  },
}

/** A file the call created: nothing left, and no minus to read. */
export const Created: Story = {
  args: {
    path: 'packages/ui/src/session/stopped-turn.tsx',
    oldText: null,
    newText: 'export function StoppedTurn() {\n  return null\n}\n',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('+3')).toBeVisible()
    await expect(canvas.queryByText(/^-\d+$/), 'a created file has no minus').toBeNull()
  },
}

/** A long file whose only change is at one end: the box takes a height and scrolls inside it. */
export const Long: Story = {
  args: {
    path: 'packages/ui/src/session/session-page.stories.tsx',
    oldText: Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n'),
    newText: Array.from({ length: 30 }, (_, index) =>
      index === 12 ? 'line 12, rewritten' : `line ${index}`,
    ).join('\n'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('+1')).toBeVisible()
    await expect(canvas.getByText('line 12, rewritten')).toBeVisible()
    // The thread keeps its height and the file scrolls inside it, which is the whole reason the
    // block has a box of its own: a thirty-line file in the thread is a turn nobody reads.
    const box = canvas.getByText('line 0').parentElement?.parentElement?.parentElement
    await expect(box?.scrollHeight ?? 0).toBeGreaterThan(box?.clientHeight ?? 0)
  },
}
