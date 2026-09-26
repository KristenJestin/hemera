import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { AgentReport } from './agent-report.tsx'

/**
 * What an agent said outside the conversation, or asked that Hemera cannot draw (issue #131):
 * the reason a turn went quiet, said where the turn is rather than left to a log.
 */
const meta = {
  title: 'Blocks/Session/AgentReport',
  component: AgentReport,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    title: 'The agent reported an error',
    detail: 'ERROR service=llm status=429 Too Many Requests: rate limit reached for this model',
    at: '14:07',
  },
  argTypes: {
    title: { control: 'text', description: 'What happened, in one sentence.' },
    detail: { control: 'text', description: 'What the agent wrote or asked, word for word.' },
    at: { control: 'text', description: 'When, already written for the platform.' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof AgentReport>

export default meta

type Story = StoryObj<typeof meta>

/** A line the agent wrote on its standard error while the turn ran, as OpenCode does a 429. */
export const ReportedError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('The agent reported an error')).toBeVisible()
    await expect(canvas.getByText(/status=429 Too Many Requests/)).toBeVisible()
    await expect(canvas.getByText('14:07')).toBeVisible()
  },
}

/** A request the agent is waiting on and no block of the thread draws, named by its method. */
export const WaitingForAnAnswer: Story = {
  args: {
    title: 'The agent is waiting for an answer Hemera cannot show',
    detail: 'elicitation/create',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('The agent is waiting for an answer Hemera cannot show'),
    ).toBeVisible()
    await expect(canvas.getByText('elicitation/create')).toBeVisible()
  },
}

/** A request Hemera refused because it does not answer that method, and what it answered. */
export const Refused: Story = {
  args: {
    title: 'The agent asked for something Hemera cannot answer',
    detail: '_zed/terminal_output: "Method not found": _zed/terminal_output',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/_zed\/terminal_output/)).toBeVisible()
  },
}

/** A report with nothing more to say than its sentence draws no empty line under it. */
export const WithoutDetail: Story = {
  args: { detail: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('The agent reported an error')).toBeVisible()
    await expect(canvasElement.querySelectorAll('p')).toHaveLength(1)
  },
}
