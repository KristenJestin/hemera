import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import { DISCUSSION } from '../../surfaces/planning/planning-fixtures.ts'
import { DiscussionThread } from './discussion-thread.tsx'
import { EDITOR_LOADED, writeAndSend } from './planning-play.ts'

/**
 * A Discuss conversation with the Planner on one question, opened as a view over the Planning
 * page: the messages at a reading measure, the agent's proposed decision with Accept, a decision
 * the user writes, and Close without a decision. Only the user closes it; a closed one is read
 * again from its question.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/DiscussionThread',
  component: DiscussionThread,
  args: {
    discussion: DISCUSSION,
    on: 'Q5',
    mentionables: MENTIONABLES,
    onSay: fn(() => Promise.resolve()),
    onAccept: fn(),
    onClose: fn(() => Promise.resolve()),
  },
  decorators: [
    (Story) => (
      <div className="w-view-narrow p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DiscussionThread>

export default meta
type Story = StoryObj<typeof meta>

/** Not opened yet: the field, whose first message opens it. */
export const Starting: Story = {
  args: { discussion: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Your first message on Q5' })).toBeVisible(),
    )
    await expect(canvas.queryByRole('button', { name: 'Close without a decision' })).toBeNull()
  },
}

/** A first message the engine refuses: it stays in the field, and why is said under it. */
export const FirstMessageRefused: Story = {
  loaders: EDITOR_LOADED,
  args: {
    discussion: null,
    onSay: fn(() => Promise.reject(new Error('A discussion is already open on Q5.'))),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const field = await canvas.findByRole('textbox', { name: 'Your first message on Q5' })
    await writeAndSend(field, 'Who reads it?')
    const why = await canvas.findByRole('alert')
    await expect(why).toHaveTextContent('Not sent: A discussion is already open on Q5.')
    await expect(field).toHaveTextContent('Who reads it?')
  },
}

/** Open, the agent's decision proposed: Accept closes it on that decision. */
export const Proposed: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2)
    const proposal = canvas.getByRole('group', { name: 'Proposed decision' })
    await userEvent.click(within(proposal).getByRole('button', { name: 'Accept' }))
    await expect(args.onAccept).toHaveBeenCalled()
  },
}

/** The user writes the decision instead. */
export const WritingADecision: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const write = canvas.getByRole('button', { name: 'Write a decision' })
    await userEvent.click(write)
    await expect(write).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Your decision on #1' })).toBeVisible(),
    )
  },
}

/** Closed without a decision, from the user's press. */
export const ClosingWithoutDecision: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Close without a decision' }))
    await expect(args.onClose).toHaveBeenCalledWith(null)
  },
}

/** Hemera answers: said with its face, the field stays. */
export const AgentAnswering: Story = {
  args: { discussion: { ...DISCUSSION, proposal: null, waitsOn: 'agent' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('status', { name: 'Hemera answers' }),
    ).toBeVisible()
  },
}

/** The Planner failed to answer: why, in words. */
export const PlannerFailed: Story = {
  args: {
    discussion: {
      ...DISCUSSION,
      proposal: null,
      plannerFailed: 'The Planner stopped before it answered: its provider refused the request.',
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/its provider refused the request/)).toBeVisible()
  },
}

/** Closed on a decision: read again, nothing to add. */
export const Closed: Story = {
  args: {
    discussion: {
      ...DISCUSSION,
      state: 'closed',
      outcome: 'decision',
      decision: DISCUSSION.proposal?.text ?? null,
      proposal: null,
      waitsOn: null,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Closed on a decision: Anyone who can read/)).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
  },
}
