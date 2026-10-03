import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { StatusDot } from './status-dot.tsx'

/**
 * Where a piece of work stands, said as a dot: five states, five colours, and the word only for
 * whoever cannot see them. Only `running` moves: it breathes, and a ring leaves it.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/StatusDot',
  component: StatusDot,
  args: { status: 'pending', label: 'Waiting' },
  argTypes: {
    status: {
      control: 'inline-radio',
      options: ['pending', 'running', 'success', 'failure', 'cancelled'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    label: { control: 'text' },
    title: { control: 'text' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof StatusDot>

export default meta
type Story = StoryObj<typeof meta>

/** Reads the colour a theme class resolves to on this page, off a probe. */
function colourOf(room: HTMLElement, className: string): string {
  const probe = document.createElement('span')
  probe.className = className
  room.append(probe)
  const colour = getComputedStyle(probe).backgroundColor
  probe.remove()
  return colour
}

/** Queued: the muted ink, still. */
export const Pending: Story = {
  play: async ({ canvasElement }) => {
    const dot = within(canvasElement).getByRole('img', { name: 'Waiting' })
    expect(getComputedStyle(dot).backgroundColor).toBe(
      colourOf(canvasElement, 'bg-muted-foreground'),
    )
    expect(getComputedStyle(dot).animationName).toBe('none')
  },
}

/**
 * Running: the warning tone. It breathes and a ring leaves it; asked for less movement — as the
 * runner of these stories asks — it stands still and draws no ring.
 */
export const Running: Story = {
  args: { status: 'running', label: 'Running' },
  play: async ({ canvasElement }) => {
    const dot = within(canvasElement).getByRole('img', { name: 'Running' })
    expect(getComputedStyle(dot).backgroundColor).toBe(colourOf(canvasElement, 'bg-warning'))
    if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      expect(getComputedStyle(dot).animationName).toBe('none')
      expect(dot.parentElement!.children).toHaveLength(1)
    } else {
      expect(getComputedStyle(dot).animationName).toBe('breathe')
    }
  },
}

/** Done. */
export const Success: Story = {
  args: { status: 'success', label: 'Done', title: '12s' },
  play: async ({ canvasElement }) => {
    const dot = within(canvasElement).getByRole('img', { name: 'Done' })
    expect(getComputedStyle(dot).backgroundColor).toBe(colourOf(canvasElement, 'bg-success'))
    expect(dot).toHaveAttribute('title', '12s')
  },
}

/** Failed. */
export const Failure: Story = {
  args: { status: 'failure', label: 'Failed' },
  play: async ({ canvasElement }) => {
    const dot = within(canvasElement).getByRole('img', { name: 'Failed' })
    expect(getComputedStyle(dot).backgroundColor).toBe(colourOf(canvasElement, 'bg-destructive'))
  },
}

/** Nobody ran it: quieter than every other state, the colour of a line. */
export const Cancelled: Story = {
  args: { status: 'cancelled', label: 'Cancelled' },
  play: async ({ canvasElement }) => {
    const dot = within(canvasElement).getByRole('img', { name: 'Cancelled' })
    expect(getComputedStyle(dot).backgroundColor).toBe(colourOf(canvasElement, 'bg-border'))
  },
}

/** Beside a line that already says its state: no word, hidden from a screen reader. */
export const Unlabelled: Story = {
  args: { status: 'success', label: undefined, size: 'sm' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole('img')).toBeNull()
    expect(canvasElement.querySelector('[aria-hidden="true"]')).not.toBeNull()
  },
}
