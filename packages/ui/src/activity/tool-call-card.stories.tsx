import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { DiffBlock } from './diff-block.tsx'
import { ToolCallCard } from './tool-call-card.tsx'

/**
 * One tool call of a turn (design D17-04).
 *
 * The four states of the life of a call are the four stories: a call in flight, one that is
 * done and folded, the same one opened by the reader, and one that failed. What they are here
 * to show is what the thread does with each — the fold is a state of the card and not a corner
 * of it, and a failure is the one state nobody is allowed to fold away.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Components/ToolCallCard',
  component: ToolCallCard,
  parameters: { layout: 'padded' },
  args: {
    title: 'Read src/session/session.tsx',
    kind: 'read',
    status: 'completed',
    locations: [{ path: 'packages/ui/src/session/session.tsx', line: 42 }],
    onOpenLocation: fn(),
  },
  argTypes: {
    title: { control: 'text', description: 'What the call is called, as the agent wrote it.' },
    kind: {
      control: 'inline-radio',
      options: ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other'],
      description: 'The kind of the call, which decides the mark and nothing else.',
    },
    status: {
      control: 'inline-radio',
      options: ['pending', 'in_progress', 'completed', 'failed'],
      description: 'Where the call is in its life: running and failed are open, and stay open.',
    },
    locations: { control: false, description: 'The files the call touched, in the agent’s order.' },
    error: { control: 'text', description: 'What went wrong, when it did.' },
    onOpenLocation: { control: false, description: 'What a press on the file does.' },
    children: { control: false, description: 'What the call returned, handed over already drawn.' },
  },
} satisfies Meta<typeof ToolCallCard>

export default meta

type Story = StoryObj<typeof meta>

/** The state the four stories are read against: a call that is done, and folded. */
export const CompletedFolded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    // A finished call says so on its line and keeps its body shut: the parameters of a read are
    // noise once the read worked.
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.getByText('Done')).toBeVisible()
    await expect(canvas.getByText('packages/ui/src/session/session.tsx:42')).toBeVisible()
  },
}

/** A call in flight: open, and the reader cannot close it — the caller knows it is running. */
export const Running: Story = {
  args: { status: 'in_progress' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('Running')).toBeVisible()
    await userEvent.click(row)
    await expect(row, 'a call in flight folds under the reader’s hand').toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

/** What the reader finds when they ask: the same call, its body on screen. */
export const Expanded: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/export function SessionPage/)).toBeVisible()
    await userEvent.click(row)
    await expect(row, 'a finished call does not fold when the reader asks it to').toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
  render: (args) => (
    <ToolCallCard {...args}>
      <DiffBlock
        defaultOpen
        path="packages/ui/src/session/session.tsx"
        oldText={'export function SessionPage() {\n  return null\n}\n'}
        newText={
          'export function SessionPage() {\n  return <SessionThread />\n}\n\nfunction SessionThread() {\n  return null\n}\n'
        }
      />
    </ToolCallCard>
  ),
}

/** A call that failed: open, and it stays open — an error behind a fold is an unseen error. */
export const Failed: Story = {
  args: {
    title: 'Run pnpm check',
    kind: 'execute',
    status: 'failed',
    error: 'exit 1 · 3 tests failed in packages/ui/tests/stories.test.ts',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Run pnpm check/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('Failed')).toBeVisible()
    await userEvent.click(row)
    await expect(row, 'a failure folds away under the reader’s hand').toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(canvas.getByText(/3 tests failed/)).toBeVisible()
  },
}

/** The kinds, each on its own line: the mark is what tells a read from a command at a glance. */
export const EveryKind: Story = {
  args: { status: 'in_progress' },
  render: () => (
    <div className="flex flex-col gap-1">
      {(
        [
          ['read', 'Read AGENTS.md'],
          ['edit', 'Edit session.tsx'],
          ['delete', 'Delete draft.md'],
          ['move', 'Move notes.md'],
          ['search', 'Search for resumeSession'],
          ['execute', 'Run pnpm test'],
          ['think', 'Think about the migration'],
          ['fetch', 'Fetch the ACP schema'],
          ['other', 'Something else entirely'],
        ] as const
      ).map(([kind, title]) => (
        <ToolCallCard key={kind} kind={kind} title={title} status="in_progress" />
      ))}
    </div>
  ),
}
