import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { QuestionsPart } from './questions-part.tsx'
import { QUESTIONS } from './spec-fixtures.ts'

const MARKS = ['empty', 'agent', 'human', 'stale', 'conflict', 'writing']

/**
 * The register of the questions: each one, open or answered, with its answer once there is one.
 * Nothing is answered here: an open question links to where it is asked, in the chat.
 */
const meta = {
  title: 'Blocks/Spec/QuestionsPart',
  component: QuestionsPart,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { questions: QUESTIONS, mark: 'agent', onGoToQuestion: fn() },
  argTypes: {
    questions: { control: 'object', description: 'The questions, open and answered.' },
    mark: {
      control: 'select',
      options: MARKS,
      description: 'The state, said to a screen reader in the heading.',
    },
    onGoToQuestion: { description: 'Takes the thread to where an open question is asked.' },
  },
} satisfies Meta<typeof QuestionsPart>

export default meta

type Story = StoryObj<typeof meta>

/**
 * One open and blocking, one answered and quiet; no answer field, and `answer in the chat`
 * takes the thread to the block.
 */
export const Register: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Questions · 1 open/ })).toBeVisible()
    await expect(canvas.getByText('blocking')).toBeVisible()
    await expect(canvas.getByText('The issue date')).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /^Answer in the chat: Credit notes/ }))
    await expect(args.onGoToQuestion).toHaveBeenCalledWith('q-credit-notes')
  },
}

/** Every question answered: the register is a record, and nothing links anywhere. */
export const AllAnswered: Story = {
  args: {
    questions: [
      { ...QUESTIONS[0]!, answer: { text: 'Negative rows, marked by a type column.' } },
      QUESTIONS[1]!,
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Negative rows, marked by a type column.')).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Nothing left to decide. */
export const None: Story = {
  args: { questions: [], mark: 'empty' },
}
