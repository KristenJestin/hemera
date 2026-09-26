import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CommandProposal } from './command-proposal.tsx'
import { COMMAND_TYPES } from './command-type.ts'

/**
 * A command the agent proposes for the catalogue, and the human's answer (D8-11).
 *
 * The scenario "A proposal enters the catalogue only when accepted": the agent proposes `seed`
 * and the user accepts it, then proposes `reset` and the user declines. The block is the same
 * in the three states; only the answer at the end of its line changes.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Activity/CommandProposal',
  component: CommandProposal,
  parameters: { layout: 'padded' },
  args: {
    name: 'seed',
    line: './scripts/seed.sh --fixtures login',
    type: 'script',
    folder: './sources/api',
    why: 'The login tests need a seeded database, and I have run this line three times in this Session.',
    state: 'pending',
    onAccept: fn(),
    onDecline: fn(),
  },
  argTypes: {
    name: { control: 'text', description: 'The name it would be kept under.' },
    line: { control: 'text', description: 'The line it would run, exactly as proposed.' },
    type: {
      control: 'select',
      options: COMMAND_TYPES,
      description: 'What the command is for, drawn with its fixed icon (D8-07).',
    },
    folder: { control: 'text', description: 'The folder it would run in.' },
    why: { control: 'text', description: 'Why the agent thinks it is worth keeping.' },
    state: {
      control: 'inline-radio',
      options: ['pending', 'accepted', 'declined'],
      description: 'Waiting for the human, or answered.',
    },
    onAccept: { control: false, description: 'Writes the command to the catalogue.' },
    onDecline: { control: false, description: 'Answers no; nothing is written.' },
    className: { control: false, description: 'Where the block sits; never how it looks.' },
  },
} satisfies Meta<typeof CommandProposal>

export default meta

type Story = StoryObj<typeof meta>

type StoryContext = Parameters<NonNullable<Story['play']>>[0]

/** A pending proposal offers both answers; an answered one says which, and offers nothing. */
async function aProposalEntersTheCatalogueOnlyWhenAccepted({ canvasElement, args }: StoryContext) {
  // "A proposal enters the catalogue only when accepted"
  const canvas = within(canvasElement)
  await expect(canvas.getByText(args.name)).toBeVisible()
  await expect(canvas.getByText(args.line)).toBeVisible()
  await expect(canvas.getByText(args.why)).toBeVisible()
  if (args.state === 'pending') {
    args.onAccept?.mockClear()
    args.onDecline?.mockClear()
    await expect(canvas.queryByText('Added to the catalogue')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Accept' }))
    await expect(args.onAccept).toHaveBeenCalledTimes(1)
    await expect(args.onDecline).not.toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Decline' }))
    await expect(args.onDecline).toHaveBeenCalledTimes(1)
    return
  }
  await expect(
    canvas.getByText(args.state === 'accepted' ? 'Added to the catalogue' : 'Declined'),
  ).toBeVisible()
  await expect(canvas.queryByRole('button')).toBeNull()
}

/** The agent proposed `seed`; the human has not answered yet. */
export const Pending: Story = {
  play: aProposalEntersTheCatalogueOnlyWhenAccepted,
}

/** Accepted: `seed` is in the catalogue now, and the entry says so. */
export const Accepted: Story = {
  args: { state: 'accepted' },
  play: aProposalEntersTheCatalogueOnlyWhenAccepted,
}

/** Declined: `reset` never enters the catalogue, and the entry keeps the answer. */
export const Declined: Story = {
  args: {
    name: 'reset',
    line: 'pnpm db:reset --force',
    type: 'configure',
    folder: '.',
    why: 'Resetting the database between two runs of the suite would make it faster to iterate.',
    state: 'declined',
  },
  play: aProposalEntersTheCatalogueOnlyWhenAccepted,
}

/** Decline, then Accept: the quiet answer first and the one that writes last, as in a dialog. */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    args.onAccept?.mockClear()
    const canvas = within(canvasElement)
    await userEvent.tab()
    await expect(document.activeElement).toBe(canvas.getByRole('button', { name: 'Decline' }))
    await userEvent.tab()
    await expect(document.activeElement).toBe(canvas.getByRole('button', { name: 'Accept' }))
    await userEvent.keyboard('{Enter}')
    await expect(args.onAccept).toHaveBeenCalledTimes(1)
  },
}
