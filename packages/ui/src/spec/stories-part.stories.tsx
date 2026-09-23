import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { STORIES } from './spec-fixtures.ts'
import { StoriesPart } from './stories-part.tsx'

const MARKS = ['empty', 'agent', 'human', 'stale', 'conflict', 'writing']

/** The stories of the Spec document, each with its ordered criteria, edited in place. */
const meta = {
  title: 'Blocks/Spec/StoriesPart',
  component: StoriesPart,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { stories: STORIES, mark: 'agent', editable: true, onSaveStory: fn() },
  argTypes: {
    stories: { control: 'object', description: 'The stories, in order, with their criteria.' },
    mark: { control: 'select', options: MARKS, description: 'The mark in the margin.' },
    editable: { control: 'boolean', description: 'A draft at its current revision.' },
    note: { control: 'text', description: 'What the facts add.' },
    onSaveStory: { description: 'A story, once, with what changed in it.' },
  },
} satisfies Meta<typeof StoriesPart>

export default meta

type Story = StoryObj<typeof meta>

/** A criterion edited in place: the story is handed over once, the order untouched. */
export const Editable: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Stories · 2/ })).toBeVisible()
    await expect(canvas.getByText('5 criteria')).toBeVisible()
    const third = canvas.getByRole('textbox', { name: 'Criterion 3 of S1' })
    await userEvent.clear(third)
    await userEvent.type(third, 'An empty month downloads a file with the header row only.')
    await userEvent.tab()
    await expect(args.onSaveStory).toHaveBeenCalledTimes(1)
    await expect(args.onSaveStory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'S1',
        criteria: [
          STORIES[0]!.criteria[0],
          STORIES[0]!.criteria[1],
          'An empty month downloads a file with the header row only.',
        ],
      }),
    )
  },
}

/** Read from a Session that does not write the draft: still yours to edit, and said so. */
export const Reading: Story = {
  args: { note: 'you can edit; the agent of the writer is told' },
}

/** Frozen: the sentences and the numbered criteria as text. */
export const Frozen: Story = {
  args: { editable: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.getByRole('list', { name: 'Criteria of S2' })).toBeVisible()
  },
}

/** No story: the Spec is verified as a whole. */
export const Empty: Story = {
  args: { stories: [], mark: 'empty' },
}
