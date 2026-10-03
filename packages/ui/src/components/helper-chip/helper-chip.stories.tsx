import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { HelperChip } from './helper-chip.tsx'

/**
 * A helper, and only the helper: its letter avatar, its name, a state dot. Nothing to press on
 * it and no ×: nobody stops a helper by hand. The dot's legend is a tooltip on the dot.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/HelperChip',
  component: HelperChip,
  args: { name: 'Reviewer', status: 'running' },
  argTypes: {
    name: { control: 'text' },
    status: {
      control: 'inline-radio',
      options: ['pending', 'running', 'success', 'failure', 'cancelled'],
    },
    others: { table: { disable: true } },
    tone: { table: { disable: true } },
  },
} satisfies Meta<typeof HelperChip>

export default meta
type Story = StoryObj<typeof meta>

/** At work: the avatar, the name, a running dot — and no control to stop it. */
export const Running: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chip = canvasElement.querySelector<HTMLElement>('[data-helper-chip]')!
    expect(chip).toHaveTextContent(/^RReviewer$/)
    expect(canvas.queryByRole('button')).toBeNull()
    expect(chip).not.toHaveTextContent('×')
    const dot = canvas.getByRole('img', { name: 'Running' })
    await userEvent.tab()
    expect(dot).toHaveFocus()
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Running')
    })
    await userEvent.tab()
  },
}

/** Waiting for its turn. */
export const Pending: Story = {
  args: { status: 'pending' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('img', { name: 'Waiting' })).toBeInTheDocument()
  },
}

/** Done. */
export const Done: Story = {
  args: { status: 'success' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('img', { name: 'Done' })).toBeInTheDocument()
  },
}

/** Failed. */
export const Failed: Story = {
  args: { status: 'failure' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('img', { name: 'Failed' })).toBeInTheDocument()
  },
}

/** Among helpers whose first letters collide: two letters each, as the avatar decides. */
export const Collision: Story = {
  render: (args) => {
    const set = ['Reviewer', 'Researcher']
    return (
      <div className="flex items-center gap-2">
        {set.map((name) => (
          <HelperChip
            {...args}
            key={name}
            name={name}
            others={set.filter((other) => other !== name)}
          />
        ))}
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const worn = [...canvasElement.querySelectorAll('[data-avatar]')].map(
      (avatar) => avatar.textContent,
    )
    expect(worn).toEqual(['RV', 'RS'])
  },
}
