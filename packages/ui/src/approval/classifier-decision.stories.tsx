import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  ClassifierDecision,
  type ClassifierDecisionProps,
  type ClassifierDecisionState,
} from './classifier-decision.tsx'

const meta = {
  title: 'Blocks/Session/ClassifierDecision',
  component: ClassifierDecision,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    state: 'evaluating',
    call: 'Run command',
    target: 'pnpm test',
    reason: 'Checking the resolved command against the current Session request.',
    policyVersion: 'hemera-auto-v1',
    model: 'jev-1.13.0',
    onDecide: fn(),
  },
} satisfies Meta<typeof ClassifierDecision>

export default meta
type Story = StoryObj<typeof meta>

export const Evaluating: Story = {}

export const Allowed: Story = {
  args: {
    state: 'allowed',
    reason: 'The command matches the requested test run.',
    by: 'judge',
    scores: 'risk 0.4 · approval 0.2',
  },
}

export const Confirmation: Story = {
  args: {
    state: 'ask',
    reason: 'The request does not clearly authorize this command.',
    by: 'judge',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('group', { name: 'Permission for Run command' })).toBeVisible()
    expect(canvas.queryByRole('button', { name: /always/i })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Allow once' }))
    expect(args.onDecide).toHaveBeenCalledWith('allow')
  },
}

export const Denied: Story = {
  args: {
    state: 'denied',
    target: 'rm -rf .git',
    reason: 'The command would delete repository history.',
    by: 'rules',
    model: undefined,
  },
}

export const Unavailable: Story = {
  args: {
    state: 'unavailable',
    reason: 'Jev could not be reached. Decide this call yourself.',
    by: undefined,
  },
}

export const Cancelled: Story = {
  args: {
    state: 'cancelled',
    reason: 'The turn stopped before a decision was used.',
    by: undefined,
  },
}

function Journey(args: ClassifierDecisionProps) {
  const [state, setState] = useState<ClassifierDecisionState>('ask')
  return (
    <ClassifierDecision
      {...args}
      state={state}
      onDecide={(answer) => {
        setState(answer === 'allow' ? 'allowed' : 'denied')
        args.onDecide?.(answer)
      }}
      by={state === 'ask' ? 'judge' : 'user'}
      reason={
        state === 'ask'
          ? 'The request does not clearly authorize this command.'
          : 'You answered this exact call.'
      }
    />
  )
}

export const AnswerJourney: Story = {
  render: (args) => <Journey {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Refuse' }))
    await waitFor(() => expect(canvas.getByText('Refused')).toBeVisible())
    expect(canvas.queryByRole('group', { name: 'Permission for Run command' })).toBeNull()
  },
}
