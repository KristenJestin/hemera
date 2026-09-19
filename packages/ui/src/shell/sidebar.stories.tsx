import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
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
  /** Whether the window is on the settings of the application, which are not one of the entries. */
  settingsActive?: boolean
}

function Harness({ collapsed = false, sessions = SESSIONS, settingsActive = false }: HarnessProps) {
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
          activeEntryId={settingsActive ? null : activeEntryId}
          onSelectEntry={setActiveEntryId}
          onOpenCommand={fn()}
          commandShortcut="Ctrl+K"
          onOpenSettings={fn()}
          settingsActive={settingsActive}
        />
      </div>
    </TooltipProvider>
  )
}

const meta = {
  tags: ['autodocs'],
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

/**
 * On the settings of the application: the foot of the panel is the one thing marked.
 *
 * The entry the window was on before is not where it is now, and a panel marking both is a
 * panel saying the window is in two places at once.
 */
export const OnTheSettings: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { settingsActive: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const marked = canvas
      .getAllByRole('button')
      .filter((one) => one.getAttribute('aria-current') === 'true')

    expect(marked).toHaveLength(1)
    expect(marked[0]).toHaveAccessibleName('Settings')
  },
}
