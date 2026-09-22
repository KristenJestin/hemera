import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'

import { emulateReducedMotion } from '../../../.storybook/reduced-motion.ts'
import { StatusDot, type StatusTone } from './status-dot.tsx'

/**
 * Where something stands, said as a dot (design D17-04).
 *
 * Five states, five colours, and the word only for whoever cannot see them. It replaces the
 * `Done` / `Running` / `Queued` / `Failed` badges of a tool call: five words down one side of a
 * thread is a column of labels that says nothing the reader did not already know, and it steals
 * the eye from the one line that went wrong.
 */
const STATES: StatusTone[] = ['pending', 'running', 'success', 'failure', 'cancelled']

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Components/StatusDot',
  component: StatusDot,
  parameters: { layout: 'centered' },
  args: { status: 'running', label: 'Running' },
  argTypes: {
    status: {
      control: 'inline-radio',
      options: STATES,
      description: 'Where the work stands; the colour is what is read.',
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'md'],
      description: 'One of two steps; the dot sits beside text either way.',
      table: { defaultValue: { summary: 'md' } },
    },
    label: {
      control: 'text',
      description: 'What a screen reader hears. Left out, the dot is hidden from it.',
    },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof StatusDot>

export default meta
type Story = StoryObj<typeof meta>

/** One dot, in whichever state and at whichever size you ask for. */
export const Playground: Story = {}

/** The two sizes, and the two ways of announcing one: with a word, or not at all. */
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-4">
      <StatusDot status="running" size="sm" label="Running, small" />
      <StatusDot status="running" size="md" label="Running" />
      <StatusDot status="success" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const named = canvas.getAllByRole('img')
    expect(named).toHaveLength(2)
    expect(named.map((dot) => getComputedStyle(dot).width)).toEqual(['6px', '8px'])
    // A dot with nothing to say is hidden from whatever reads the page rather than announced as
    // an image with no name.
    const quiet = canvasElement.querySelectorAll('[aria-hidden="true"]')
    expect(quiet).toHaveLength(1)
  },
}

/** The five states side by side, which is the only way to check that five colours are five. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-2">
      {STATES.map((status) => (
        <span key={status} className="flex items-center gap-2 text-sm text-muted-foreground">
          <StatusDot status={status} label={status} />
          {status}
        </span>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const colours = STATES.map(
      (status) => getComputedStyle(canvas.getByRole('img', { name: status })).backgroundColor,
    )
    // Five states, five colours: a state that shared a colour with another would be a state the
    // eye cannot read at all.
    expect(new Set(colours).size).toBe(5)
    // One of them moves, and it is the one the reader is waiting on.
    expect(getComputedStyle(canvas.getByRole('img', { name: 'running' })).animationName).toBe(
      'breathe',
    )
    expect(getComputedStyle(canvas.getByRole('img', { name: 'success' })).animationName).toBe(
      'none',
    )
  },
}

/**
 * The running dot under a system that asked for less movement: its own colour, standing still.
 *
 * The preference is emulated in the browser, because that is where the media query is answered.
 * Opened in the catalogue by hand there is nothing to emulate with, and the reader sees the dot
 * their own system asked for.
 */
export const ReducedMotion: Story = {
  parameters: { controls: { disable: true } },
  render: () => <StatusDot status="running" label="Running" />,
  play: async ({ canvasElement }) => {
    const restore = await emulateReducedMotion()
    if (restore === null) return
    try {
      const dot = within(canvasElement).getByRole('img', { name: 'Running' })
      await waitFor(() => {
        expect(getComputedStyle(dot).animationName).toBe('none')
      })
      expect(getComputedStyle(dot).opacity).toBe('1')
    } finally {
      await restore()
    }
  },
}
