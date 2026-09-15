import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { JOURNAL_ENTRY, SIDEBAR_DEFAULT, type ShellSession } from './model.ts'
import { Sidebar } from './sidebar.tsx'

const SESSIONS: ShellSession[] = [
  { id: 'csv', title: 'CSV invoice export' },
  { id: 'search', title: 'Full-text search' },
  { id: 'drizzle', title: 'Migrate to Drizzle 1.0' },
]

interface HarnessProps {
  collapsed?: boolean
  sessions?: ShellSession[]
}

function Harness({ collapsed = false, sessions = SESSIONS }: HarnessProps) {
  const [activeEntryId, setActiveEntryId] = useState(sessions[0]?.id ?? JOURNAL_ENTRY)
  return (
    <TooltipProvider>
      <div className="flex h-screen">
        <Sidebar
          collapsed={collapsed}
          width={SIDEBAR_DEFAULT}
          dragging={false}
          onWidth={() => undefined}
          sessions={sessions}
          activeEntryId={activeEntryId}
          onSelectEntry={setActiveEntryId}
          onOpenCommand={fn()}
          commandShortcut="Ctrl+K"
          theme="light"
          onToggleTheme={fn()}
          onOpenSettings={fn()}
        />
      </div>
    </TooltipProvider>
  )
}

const meta = {
  title: 'Shell/Sidebar',
  component: Harness,
  parameters: { layout: 'fullscreen' },
  argTypes: { sessions: { table: { disable: true } } },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { collapsed: true },
}

/** A sidebar shorter than its own list says so at each end, and the arrows move it. */
export const Scrolling: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  // More Sessions than the panel is tall, which is the case the arrows exist for.
  args: {
    sessions: Array.from({ length: 30 }, (_, index) => ({
      id: `session-${index}`,
      title: `Session number ${index + 1}`,
    })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Nothing above to reach yet, and something below.
    expect(canvas.queryByRole('button', { name: 'Scroll the list up' })).toBeNull()
    const down = canvas.getByRole('button', { name: 'Scroll the list down' })

    await userEvent.click(down)
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Scroll the list up' })).toBeInTheDocument()
    })

    // The two ends of the panel never move: the command and the settings stay where they are.
    expect(canvas.getByRole('button', { name: 'Command' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  },
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { sessions: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The places of the product, in the order the core puts them, and nothing beside them.
    expect(canvas.getByRole('button', { name: 'Command' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Journal' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Project settings' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    // The keystroke that opens the command is drawn beside it, as keys.
    expect(canvas.getByText('Ctrl')).toBeInTheDocument()
  },
}
