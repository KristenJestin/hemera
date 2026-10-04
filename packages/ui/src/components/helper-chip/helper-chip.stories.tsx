import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { HelperChip } from './helper-chip.tsx'

/**
 * A helper, and only the helper: its letter avatar and its name. No dot: its state is the chip's
 * own background, as on the live chip — a tint breathing while it works, one sweep in the colour
 * of the state it changes to. Nothing to press on it and no ×: nobody stops a helper by hand. The
 * state in words is a tooltip on the avatar.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/HelperChip',
  component: HelperChip,
  args: { name: 'Reviewer', state: 'running' },
  argTypes: {
    name: { control: 'text' },
    state: {
      control: 'inline-radio',
      options: ['running', 'stuck', 'finished', 'failed', 'stopped'],
    },
    others: { table: { disable: true } },
    tone: { table: { disable: true } },
  },
} satisfies Meta<typeof HelperChip>

export default meta
type Story = StoryObj<typeof meta>

/** The chip of a helper, its avatar and its name and nothing else: no dot, no button, no ×. */
function bare(canvasElement: HTMLElement): HTMLElement {
  const chip = canvasElement.querySelector<HTMLElement>('[data-helper-chip]')!
  expect(chip).toHaveTextContent(/^R\s*Reviewer$/)
  expect(chip.querySelectorAll('[role="img"]')).toHaveLength(1)
  expect(within(canvasElement).queryByRole('button')).toBeNull()
  expect(chip).not.toHaveTextContent('×')
  return chip
}

/** At work: its background breathes, and the avatar's legend says so. */
export const Running: Story = {
  play: async ({ canvasElement }) => {
    const chip = bare(canvasElement)
    expect(chip.querySelector('[data-breath]')).not.toBeNull()
    const avatar = within(canvasElement).getByRole('img', { name: 'Reviewer, running' })
    await userEvent.tab()
    expect(avatar).toHaveFocus()
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Reviewer, running')
    })
    await userEvent.tab()
  },
}

/** No activity for five minutes: the breath stops. */
export const Stuck: Story = {
  args: { state: 'stuck' },
  play: async ({ canvasElement }) => {
    const chip = bare(canvasElement)
    expect(chip.querySelector('[data-breath]')).toBeNull()
    expect(within(canvasElement).getByRole('img', { name: 'Reviewer, no activity' })).toBeVisible()
  },
}

/** Done: neutral again. */
export const Finished: Story = {
  args: { state: 'finished' },
  play: async ({ canvasElement }) => {
    expect(bare(canvasElement).querySelector('[data-breath]')).toBeNull()
    expect(within(canvasElement).getByRole('img', { name: 'Reviewer, done' })).toBeVisible()
  },
}

/** Failed. */
export const Failed: Story = {
  args: { state: 'failed' },
  play: async ({ canvasElement }) => {
    bare(canvasElement)
    expect(within(canvasElement).getByRole('img', { name: 'Reviewer, failed' })).toBeVisible()
  },
}

/** Stopped. */
export const Stopped: Story = {
  args: { state: 'stopped' },
  play: async ({ canvasElement }) => {
    bare(canvasElement)
    expect(within(canvasElement).getByRole('img', { name: 'Reviewer, stopped' })).toBeVisible()
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
