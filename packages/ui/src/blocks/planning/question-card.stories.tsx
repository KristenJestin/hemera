import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import { WAVES } from '../../surfaces/planning/planning-fixtures.ts'
import type { Question } from './planning-types.ts'
import { QuestionCard } from './question-card.tsx'

/**
 * A question of the Planner, as the rail of the Planning page holds it: its options by their
 * labels with the recommended one starred and why, answered by a press that leaves at once (there
 * is no Send), or in the user's own words; "I'm waiting on someone" with a note, and the Planner's
 * drafted message with Copy, never Send; the answer's state as a dot. A retired question stays
 * readable with its reason.
 */

const byId = (id: string): Question => {
  const found = WAVES.flatMap((wave) => wave.questions).find((question) => question.id === id)
  if (found === undefined) throw new Error(`No question ${id} in the fixtures`)
  return found
}

const OPEN = byId('Q5')

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/QuestionCard',
  component: QuestionCard,
  args: {
    question: OPEN,
    discussed: false,
    foldAnswered: true,
    mentionables: MENTIONABLES,
    onAnswer: fn(),
    onWaitOnSomeone: fn(),
    onCopyDraft: fn(),
    onAcceptProposed: fn(),
    onDismissProposed: fn(),
    onDiscuss: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-view-narrow">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QuestionCard>

export default meta
type Story = StoryObj<typeof meta>

/** Open: the options, the recommended one starred, why it is recommended. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByRole('article', { name: /Q5/ })
    await expect(within(card).getAllByRole('button', { pressed: false })).toHaveLength(3)
    await expect(
      within(card).getByRole('button', { name: /Anyone who can read it, recommended/ }),
    ).toBeVisible()
    await expect(card).toHaveTextContent('Recommended A')
    await expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull()
  },
}

/** A press answers at once: nothing else to confirm. */
export const Answering: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Only its owner/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith('Q5', { optionId: 'B' })
  },
}

/** The keyboard path: Tab reaches the options in order, Enter answers, the ring shows. */
export const AnsweringByKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const first = canvas.getByRole('button', { name: /Anyone who can read it/ })
    first.focus()
    await userEvent.tab()
    const second = canvas.getByRole('button', { name: /Only its owner/ })
    await expect(second).toHaveFocus()
    await expect(second.matches(':focus-visible')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith('Q5', { optionId: 'B' })
  },
}

/** In the user's own words, through the mention field that unfolds under the options. */
export const OwnWords: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const own = canvas.getByRole('button', { name: 'In my own words' })
    await userEvent.click(own)
    await expect(own).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Your answer to Q5' })).toBeVisible(),
    )
  },
}

/** An answer in the user's own words the engine refuses: the words stay, and why is said. */
export const OwnWordsRefused: Story = {
  args: { onAnswer: fn(() => Promise.reject(new Error('Q5 is no longer open.'))) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'In my own words' }))
    const field = await canvas.findByRole('textbox', { name: 'Your answer to Q5' })
    await userEvent.click(field)
    await userEvent.keyboard('Only the team{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith('Q5', { text: 'Only the team' })
    const why = await canvas.findByRole('alert')
    await expect(why).toHaveTextContent('Not sent: Q5 is no longer open.')
    await expect(field).toHaveTextContent('Only the team')
  },
}

/** "I'm waiting on someone": a note, optional, and the question waits. */
export const MarkingWaiting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'I’m waiting on someone' }))
    const note = await canvas.findByLabelText('Who, or what, it waits on')
    await userEvent.type(note, 'The legal team')
    await userEvent.click(canvas.getByRole('button', { name: 'Wait' }))
    await expect(args.onWaitOnSomeone).toHaveBeenCalledWith('Q5', 'The legal team')
  },
}

/** Waiting on someone: the glyph, the note, the drafted message with Copy and no Send. */
export const WaitingOnSomeone: Story = {
  args: { question: byId('Q6') },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Waiting on someone' })).toBeVisible()
    await expect(canvas.getByText(/Asked the support team/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Copy' }))
    await expect(args.onCopyDraft).toHaveBeenCalledWith(expect.stringMatching(/^Hello/))
    await expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'I’m waiting on someone' })).toBeNull()
  },
}

/** Answered before the page opened: one line, its answer and its dot, and Change. */
export const AnsweredFolded: Story = {
  args: { question: byId('Q1') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('A · As links')).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Integrated in the Spec' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Change the answer to Q1' }))
    await waitFor(() => expect(canvas.getAllByRole('button', { pressed: true })).toHaveLength(1))
  },
}

/** A changed answer, said as the change it is; the new one delivered, not integrated yet. */
export const ChangedAnswer: Story = {
  args: { question: byId('Q2'), foldAnswered: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Now B, before A')).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Delivered to the Planner' })).toBeVisible()
  },
}

/** Withdrawn by the Planner: kept, with its reason. */
export const Withdrawn: Story = {
  args: { question: byId('Q3') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Withdrawn: comments are not part of a note/)).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Replaced by a later question: kept, with the link. */
export const Replaced: Story = {
  args: { question: byId('Q4') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Replaced by Q6')).toBeVisible()
  },
}

/** Made moot by a decision: kept, with the decision. */
export const Moot: Story = {
  args: { question: byId('Q7') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Moot: D2/)).toBeVisible()
  },
}

/** Made moot by the decision of its discussion: the discussion is read again from it. */
export const MootAfterDiscussion: Story = {
  args: { question: byId('Q7'), discussed: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Moot: D2/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Open the discussion' }))
    await expect(args.onDiscuss).toHaveBeenCalledWith({ kind: 'question', id: 'Q7' })
  },
}

const PROPOSED: Question = {
  ...byId('Q6'),
  proposals: [
    {
      id: 'pa1',
      author: 'support-team',
      comment: 'The largest workspace holds 41 000 notes; the ten largest hold about 9 000 each.',
      text: 'B, 5 000 notes: the largest workspaces are well above it, most never reach it.',
    },
  ],
}

/** The ticket answered it: the Planner proposes the answer; Accept, Edit or Dismiss. */
export const ProposedFromTicket: Story = {
  args: { question: PROPOSED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const proposal = canvas.getByRole('group', { name: 'Proposed from the ticket' })
    await expect(proposal).toHaveTextContent('support-team')
    await expect(proposal).toHaveTextContent('41 000 notes')
    await userEvent.click(within(proposal).getByRole('button', { name: 'Accept' }))
    await expect(args.onAcceptProposed).toHaveBeenCalledWith('pa1', null)
    await userEvent.click(within(proposal).getByRole('button', { name: 'Dismiss' }))
    await expect(args.onDismissProposed).toHaveBeenCalledWith('pa1')
  },
}

/** Edit: the proposed answer in the field, to change before it is accepted. */
export const ProposedEdited: Story = {
  args: { question: PROPOSED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const proposal = canvas.getByRole('group', { name: 'Proposed from the ticket' })
    await userEvent.click(within(proposal).getByRole('button', { name: 'Edit' }))
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Your answer to Q6' })).toHaveTextContent(
        /5 000 notes/,
      ),
    )
  },
}

/** A discussion is open on it: Discuss opens it again. */
export const Discussed: Story = {
  args: { discussed: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open the discussion' }))
    await expect(args.onDiscuss).toHaveBeenCalledWith({ kind: 'question', id: 'Q5' })
  },
}

const LONG =
  'When the user exports a note whose title is a whole sentence written by someone who pasted the first paragraph of a meeting into the title field, '

/** Long text in every field: it wraps, nothing overflows the rail. */
export const LongText: Story = {
  args: {
    question: {
      ...OPEN,
      text: `${LONG}${OPEN.text}`,
      recommendedReason: `${LONG}${OPEN.recommendedReason}`,
      options: OPEN.options.map((option) =>
        Object.assign({}, option, { label: `${option.label}, ${LONG}` }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole('article', { name: /Q5/ })
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
  },
}
