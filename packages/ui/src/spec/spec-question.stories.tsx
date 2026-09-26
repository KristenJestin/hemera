import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CREDIT_NOTES } from './spec-fixtures.ts'
import { SpecQuestion } from './spec-question.tsx'

/**
 * A question of the Spec asked in the thread: the options the agent offers, one recommended, and
 * a field of your own; folded to its answer once answered.
 */
const meta = {
  title: 'Blocks/Spec/SpecQuestion',
  component: SpecQuestion,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'padded' },
  args: { question: CREDIT_NOTES, onAnswer: fn() },
  argTypes: {
    question: { control: 'object', description: 'The question, its options and its answer.' },
    cancelled: { control: 'boolean', description: 'The turn was stopped before an answer.' },
    onAnswer: { description: 'An option pressed, or your own words.' },
  },
} satisfies Meta<typeof SpecQuestion>

export default meta

type Story = StoryObj<typeof meta>

/** Open: the question, `blocking` and its phase, the options, and a field of your own. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('blocking')).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Answers' })).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Something else' })).toBeVisible()
  },
}

/** The recommended option is marked, and pressing it is the answer. */
export const Recommended: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const recommended = canvas.getByRole('button', { name: /recommended/ })
    await expect(recommended).toHaveTextContent('Negative rows in the same file')
    recommended.focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith({ optionId: 'negative' })
  },
}

/** Something else: your own words, handed over by `Answer` once there are some. */
export const FreeText: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const answer = canvas.getByRole('button', { name: 'Answer' })
    await expect(answer).toBeDisabled()
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Something else' }),
      'Negative rows, marked by a type column.',
    )
    await userEvent.click(answer)
    await expect(args.onAnswer).toHaveBeenCalledWith({
      text: 'Negative rows, marked by a type column.',
    })
  },
}

/** Answered: folded to the question and the answer, in muted text. */
export const Answered: Story = {
  args: { question: { ...CREDIT_NOTES, answer: { optionId: 'negative' } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Negative rows in the same file')).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Cancelled: the turn was stopped; folded, and still open in the Spec's register. */
export const Cancelled: Story = {
  args: { cancelled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/the turn was stopped/)).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** The question as the agent wrote it, in Markdown: bold, code and a list read as the thread's. */
export const Markdown: Story = {
  args: {
    question: {
      ...CREDIT_NOTES,
      body: 'Credit notes: **where do they go** in the export?\n\n- `amount` stays signed\n- the `type` column is new',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('where do they go').tagName).toBe('STRONG')
    await expect(canvas.getByText('amount').tagName).toBe('CODE')
    const card = canvas.getByRole('group', { name: /^Question/ })
    await expect(canvas.getByText(/column is new/).tagName).toBe('LI')
    await expect(card).not.toHaveTextContent('**')
    await expect(card).not.toHaveTextContent('`')
  },
}

/** Answered, the question still reads its Markdown above the answer. */
export const MarkdownAnswered: Story = {
  args: {
    question: {
      ...CREDIT_NOTES,
      body: 'Credit notes: **where do they go** in the export?',
      answer: { optionId: 'negative' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('where do they go').tagName).toBe('STRONG')
    await expect(canvas.getByText('Negative rows in the same file')).toBeVisible()
  },
}
