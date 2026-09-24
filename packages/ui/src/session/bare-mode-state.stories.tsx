import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { BareModeState, type BareModeEntry } from './bare-mode-state.tsx'

/**
 * Whether each agent can run bare, and what it would take (design D6-15).
 *
 * The stories are the three answers an adapter gives: qualified, not qualified with the reason
 * and the one thing that would change it, and an answer nobody has checked yet. The date is on
 * every line, because a qualification without a date is a promise nobody can check.
 */
const QUALIFIED: BareModeEntry[] = [
  {
    agent: 'opencode',
    qualified: true,
    reason: 'its tools are off and it works through the ones Hemera lends it',
    checkedAt: '21 Sep 2026',
  },
  {
    agent: 'claude-code',
    qualified: true,
    reason: 'its tools are off and it works through the ones Hemera lends it',
    checkedAt: '21 Sep 2026',
  },
  {
    agent: 'codex',
    qualified: true,
    reason: 'its tools are off and it works through the ones Hemera lends it',
    checkedAt: '21 Sep 2026',
  },
]

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Session/BareModeState',
  component: BareModeState,
  parameters: { layout: 'padded' },
  args: { entries: QUALIFIED },
  argTypes: {
    entries: { control: 'object', description: 'The agents of this machine, one line each.' },
  },
} satisfies Meta<typeof BareModeState>

export default meta

type Story = StoryObj<typeof meta>

/** The three agents running bare: one line each, and the date it was last true. */
export const Qualified: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('Bare')).toHaveLength(3)
    await expect(canvas.getByText('opencode')).toBeVisible()
    await expect(canvas.getByText('codex')).toBeVisible()
    await expect(canvas.getAllByText('21 Sep 2026')).toHaveLength(3)
  },
}

/** An agent that is not qualified: it runs with its own tools, and the line says what would change it. */
export const NotQualified: Story = {
  args: {
    entries: [
      QUALIFIED[0]!,
      {
        agent: 'codex',
        qualified: false,
        reason: 'it still offers its own shell, so a call cannot be accounted for',
        remedy: 'its adapter qualifies once its own tools can be switched off at start-up',
        checkedAt: '21 Sep 2026',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Not bare')).toBeVisible()
    await expect(canvas.getByText(/it still offers its own shell/)).toBeVisible()
    await expect(canvas.getByText(/once its own tools can be switched off/)).toBeVisible()
  },
}

/** An adapter nobody has checked yet: it says so rather than claiming an answer. */
export const Unchecked: Story = {
  args: {
    entries: [
      {
        agent: 'claude-code',
        qualified: false,
        reason: 'its adapter has not answered for bare mode yet',
        remedy: 'the adapter is qualified once its own tools are known to be switchable',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Not bare')).toBeVisible()
    await expect(canvas.queryByText('21 Sep 2026')).toBeNull()
  },
}
