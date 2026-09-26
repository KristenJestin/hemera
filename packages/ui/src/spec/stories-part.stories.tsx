import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { STORIES } from './spec-fixtures.ts'
import { StoriesPart } from './stories-part.tsx'

const MARKS = ['empty', 'agent', 'human', 'stale', 'writing']

/** The stories of the Spec document, each with its ordered criteria, read (issue #135). */
const meta = {
  title: 'Blocks/Spec/StoriesPart',
  component: StoriesPart,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'padded' },
  args: { stories: STORIES, mark: 'agent', type: 'feature' },
  argTypes: {
    stories: { control: 'object', description: 'The stories, in order, with their criteria.' },
    mark: {
      control: 'select',
      options: MARKS,
      description: 'The state, said to a screen reader in the heading.',
    },
    type: {
      control: 'inline-radio',
      options: ['feature', 'bug', 'maintenance'],
      description: 'The type of the Spec, which says what an empty list means.',
    },
  },
} satisfies Meta<typeof StoriesPart>

export default meta

type Story = StoryObj<typeof meta>

/** Written: the sentences and the numbered criteria as text, and nothing to edit. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Stories · 2/ })).toBeVisible()
    await expect(canvas.getByText('5 criteria')).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.getByRole('list', { name: 'Criteria of S2' })).toBeVisible()
    await expect(canvas.getByText(STORIES[0]!.criteria[2]!)).toBeVisible()
  },
}

/** No story on a `bug` or a `maintenance`: the Spec is verified as a whole. */
export const Empty: Story = {
  args: { stories: [], mark: 'empty', type: 'bug' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/verified as a whole, by its verification/)).toBeVisible()
    await expect(canvas.queryByText(/needs at least one user story/)).toBeNull()
  },
}

/**
 * No story on a `feature`: it is not verified as a whole — it needs at least one user story, with
 * a criterion, before it can be ready, and says so plainly.
 */
export const FeatureEmpty: Story = {
  args: { stories: [], mark: 'empty', type: 'feature' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        'No story yet: a feature needs at least one user story, with a criterion, before it can be ready.',
      ),
    ).toBeVisible()
    await expect(canvas.queryByText(/verified as a whole/)).toBeNull()
  },
}
