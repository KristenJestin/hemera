import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { HelperChip } from './helper-chip.tsx'

/**
 * A helper's chip is a live chip: the same chip, breath and sweeps, whose icon slot holds the
 * helper's letter avatar and which shows no seconds — only the helper, its avatar and its name.
 * Its tooltip says the helper's name and its state. No ×: nobody stops a helper by hand.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/HelperChip',
  component: HelperChip,
  args: { name: 'Reviewer', state: 'running', onPress: fn() },
  argTypes: {
    name: { control: 'text' },
    state: {
      control: 'inline-radio',
      options: ['running', 'stuck', 'finished', 'failed', 'stopped'],
    },
    others: { table: { disable: true } },
    tone: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HelperChip>

export default meta
type Story = StoryObj<typeof meta>

/** The live chip of a helper: its avatar in the slot, its name, no seconds and no ×. */
function chipOf(canvasElement: HTMLElement, words: string): HTMLElement {
  const chip = within(canvasElement).getByRole('button', { name: `Reviewer, ${words}` })
  expect(chip.dataset.liveChip).toBe('')
  expect(chip.querySelector('[data-avatar]')).not.toBeNull()
  expect(chip).not.toHaveTextContent(/\d+s/)
  expect(chip).not.toHaveTextContent('×')
  return chip
}

/** Hovers the chip and reads its legend. */
async function legendOf(chip: HTMLElement): Promise<string> {
  await userEvent.hover(chip)
  const tip = await waitFor(() => within(document.body).getByRole('tooltip'))
  const said = tip.textContent ?? ''
  await userEvent.unhover(chip)
  await waitFor(() => {
    expect(within(document.body).queryByRole('tooltip')).toBeNull()
  })
  return said
}

/** At work: the live chip's breath, in the running tone. */
export const Running: Story = {
  play: async ({ canvasElement }) => {
    const chip = chipOf(canvasElement, 'running')
    expect(chip.querySelector('[data-breath]')).not.toBeNull()
    expect(await legendOf(chip)).toBe('Reviewer · running')
  },
}

/** No activity for five minutes: the breath stops, the paused clock takes the avatar's place. */
export const Stuck: Story = {
  args: { state: 'stuck' },
  play: async ({ canvasElement }) => {
    const chip = chipOf(canvasElement, 'no activity')
    expect(chip.querySelector('[data-breath]')).toBeNull()
    expect(chip.querySelector('[data-end="stuck"]')).not.toBeNull()
  },
}

/** Done: neutral again, a ✓ in the avatar's place. */
export const Finished: Story = {
  args: { state: 'finished' },
  play: async ({ canvasElement }) => {
    const chip = chipOf(canvasElement, 'done')
    expect(chip.querySelector('[data-end="finished"]')).not.toBeNull()
    expect(await legendOf(chip)).toBe('Reviewer · done')
  },
}

/** Failed: a ✕ in the avatar's place. */
export const Failed: Story = {
  args: { state: 'failed' },
  play: async ({ canvasElement }) => {
    expect(chipOf(canvasElement, 'failed').querySelector('[data-end="failed"]')).not.toBeNull()
  },
}

/** Stopped. */
export const Stopped: Story = {
  args: { state: 'stopped' },
  play: async ({ canvasElement }) => {
    expect(chipOf(canvasElement, 'stopped').querySelector('[data-end="stopped"]')).not.toBeNull()
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
