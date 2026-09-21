import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { AgentsSection } from './agents-section.tsx'

/**
 * The three answers this machine can give about an agent, drawn side by side.
 */
const meta = {
  title: 'Components/AgentsSection',
  component: AgentsSection,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    agents: [
      { id: 'claude', name: 'Claude Code', version: '2.0.31', standing: 'ready' },
      { id: 'codex', name: 'Codex', version: '0.9.4', standing: 'unauthenticated' },
      {
        id: 'opencode',
        name: 'OpenCode',
        standing: 'missing',
        hint: 'bun add -g opencode-ai',
      },
    ],
  },
  argTypes: {
    agents: { control: 'object', description: 'What this machine says about each agent.' },
  },
} satisfies Meta<typeof AgentsSection>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing is picked for the reader, and a missing agent is not replaced by another. */
export const FoundAndNot: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/nothing is picked for you/)).toBeVisible()
    await expect(canvas.getByText('Found')).toBeVisible()
    await expect(canvas.getByText('Not installed')).toBeVisible()
    await expect(canvas.getByText('Not signed in')).toBeVisible()
  },
}

/** An agent that is missing says how to get it, rather than being silently absent. */
export const MissingSaysHowToInstallIt: Story = {
  args: {
    agents: [
      { id: 'opencode', name: 'OpenCode', standing: 'missing', hint: 'bun add -g opencode-ai' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('bun add -g opencode-ai')).toBeVisible()
  },
}

/** Installed and not signed in, which is the reader's to fix and nobody else's. */
export const InstalledButNotSignedIn: Story = {
  args: {
    agents: [
      {
        id: 'codex',
        name: 'Codex',
        version: '0.9.4',
        standing: 'unauthenticated',
        hint: 'codex login',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('0.9.4')).toBeVisible()
    await expect(canvas.getByText('codex login')).toBeVisible()
  },
}
