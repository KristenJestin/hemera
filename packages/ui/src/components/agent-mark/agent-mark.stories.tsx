import type { Meta, StoryObj } from '@storybook/react-vite'

import { AgentMark } from './agent-mark.tsx'

/** The mark of an agent: its own logo in the text's colour, or its initials when it has none. */
const meta = {
  tags: ['autodocs'],
  title: 'Components/AgentMark',
  component: AgentMark,
  args: { id: 'claude', name: 'Claude Code' },
} satisfies Meta<typeof AgentMark>

export default meta
type Story = StoryObj<typeof meta>

export const Claude: Story = {}

export const Codex: Story = { args: { id: 'codex', name: 'Codex' } }

export const OpenCode: Story = { args: { id: 'opencode', name: 'OpenCode' } }

/** An agent with no mark of its own: its initials. */
export const Unknown: Story = { args: { id: 'gemini', name: 'Gemini CLI' } }

/** Every size, beside one another. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <AgentMark {...args} size="sm" />
      <AgentMark {...args} size="md" />
      <AgentMark {...args} size="lg" />
    </div>
  ),
}
