import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { QuestionsStage } from './questions-stage.tsx'
import { QUESTIONS } from './spec-fixtures.ts'

/**
 * The questions of a Spec, each with the agent's recommendation, its phase and `blocking` when
 * it stops the Spec from being ready; the answer field appears when it is asked for.
 */
const meta = {
  title: 'Blocks/Spec/QuestionsStage',
  component: QuestionsStage,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { questions: QUESTIONS, editable: true, onAnswer: fn() },
  argTypes: {
    questions: { control: 'object', description: 'The questions, open and answered.' },
    editable: { control: 'boolean', description: 'A draft at its current revision.' },
    onAnswer: { description: 'An answer, once, when the caret leaves its field.' },
  },
} satisfies Meta<typeof QuestionsStage>

export default meta

type Story = StoryObj<typeof meta>

/** One open and blocking, one answered and quiet. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('1 open')).toBeVisible()
    await expect(canvas.getByText('blocking')).toBeVisible()
    await expect(canvas.getByText('Issue date · you, 10:36')).toBeVisible()
    // No field until one is asked for.
    await expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/** The answer field on click, and the answer handed over when the caret leaves it. */
export const Answering: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Answer…' }))
    const field = canvas.getByRole('textbox', { name: /Answer to: Credit notes/ })
    await expect(field).toHaveFocus()
    await userEvent.keyboard('Negative rows, marked by a type column.')
    await userEvent.tab()
    await expect(args.onAnswer).toHaveBeenCalledWith(
      'q-credit-notes',
      'Negative rows, marked by a type column.',
    )
  },
}

/** Nothing left to decide. */
export const None: Story = {
  args: { questions: [] },
}

/** Frozen: the questions are read, not answered. */
export const Frozen: Story = {
  args: { editable: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Answer…' })).toBeNull()
  },
}
