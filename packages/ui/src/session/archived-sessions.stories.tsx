import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ArchivedSessions } from './archived-sessions.tsx'
import type { ArchivedSession } from './model.ts'

/**
 * The archives of a Project, on fixtures (design D4b-06).
 *
 * Two stories and no third: a page with rows and a page with none. What is not here is a
 * deletion — archiving is reversible and nothing else ends a Session — and the empty state
 * says the list is empty rather than showing a row that stands for nothing.
 */
const ARCHIVED: ArchivedSession[] = [
  { id: 'billing', title: 'Old billing thoughts', archivedAt: '3 d ago', messages: 5 },
  { id: 'onboarding', title: 'Onboarding checklist', archivedAt: 'last month', messages: 1 },
  { id: 'untitled', title: '', archivedAt: 'last week' },
]

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Session/Archived',
  component: ArchivedSessions,
  parameters: { layout: 'fullscreen' },
  args: { sessions: ARCHIVED, onRestore: fn() },
  argTypes: {
    sessions: { control: 'object', description: 'The archived Sessions, in the caller’s order.' },
    onRestore: { action: 'restored' },
  },
} satisfies Meta<typeof ArchivedSessions>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Three archived Sessions, each with what it kept and the one press that brings it back. */
export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement, args }) => {
    args.onRestore.mockClear()
    const canvas = within(canvasElement)

    expect(canvas.getByText('Old billing thoughts')).toBeInTheDocument()
    expect(canvas.getByText('archived 3 d ago · 5 messages')).toBeInTheDocument()
    // One message is one message, and an archived Session nobody named is still called
    // something a reader can point at.
    expect(canvas.getByText('archived last month · 1 message')).toBeInTheDocument()
    expect(canvas.getByText('New session')).toBeInTheDocument()

    // Scenario « Aucune suppression proposée »: every row offers the way back and nothing else.
    const restores = canvas.getAllByRole('button', { name: 'Restore' })
    expect(restores).toHaveLength(3)
    expect(canvas.queryByRole('button', { name: /delete/i })).toBeNull()

    await userEvent.click(restores[0]!)
    expect(args.onRestore).toHaveBeenCalledWith('billing')
  },
}

/** Nothing archived: said in words, with no row standing in for it. */
export const States: Story = {
  args: { sessions: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/No archived Session/)).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: 'Restore' })).toBeNull()
  },
}
