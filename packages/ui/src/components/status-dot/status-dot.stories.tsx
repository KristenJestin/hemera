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
 *
 * One of the five moves, and it moves twice: the running dot breathes, and a ring leaves it on
 * the same beat — the `ping` kind of the preset. The breath is read once the eye is on the dot;
 * the ring is what is read from the corner of it.
 */
const STATES: StatusTone[] = ['pending', 'running', 'success', 'failure', 'cancelled']

/**
 * How far out of the dot a ring has travelled, read off the matrix the browser computed.
 *
 * An element that has not been given a transform yet reads `none`, which is a matrix nobody
 * can build: that is the ring standing exactly where the dot is, which is a spread of one.
 */
function spreadOf(ring: Element): number {
  const written = getComputedStyle(ring).transform
  return written === 'none' ? 1 : new DOMMatrixReadOnly(written).a
}

/** The role each state is drawn in, which is the token and never a colour of its own. */
const TONES: Record<StatusTone, string> = {
  pending: 'bg-muted-foreground',
  running: 'bg-warning',
  success: 'bg-success',
  failure: 'bg-destructive',
  cancelled: 'bg-border',
}

const meta = {
  tags: ['autodocs'],
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
    title: {
      control: 'text',
      description: 'A detail beside the state, on hover and in the description: how long it took.',
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
    // And each of them is a role of the theme rather than a colour of the component's own.
    for (const status of STATES) {
      expect([...canvas.getByRole('img', { name: status }).classList]).toContain(TONES[status])
    }
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
 * The one state the reader is waiting on, and the ring that says so from the corner of the eye.
 *
 * The ring is drawn behind the dot, exactly its size, and travels out of it: it is the `ping`
 * kind of the preset — a scale and an opacity, repeating on the theme's own `turn`, which is
 * the beat the dot breathes on. It is decoration and announces nothing: the dot already carries
 * the word.
 */
export const Running: Story = {
  parameters: { controls: { disable: true } },
  render: () => <StatusDot status="running" label="Running" />,
  play: async ({ canvasElement }) => {
    const dot = within(canvasElement).getByRole('img', { name: 'Running' })
    // Behind the dot, so it is the element drawn before it, and it wears the running tone.
    const ring = dot.previousElementSibling
    expect(ring, 'the running dot has no ring behind it').not.toBeNull()
    if (ring === null) return
    expect([...ring.classList]).toContain('bg-warning')
    expect(ring).not.toHaveAttribute('aria-label')
    // It leaves: the ring passes well outside the dot it came from, which a ring standing at
    // the dot's own size never would.
    await waitFor(() => {
      expect(spreadOf(ring)).toBeGreaterThan(1.2)
    })
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
      // And no ring either: one repeating for ever with no time to travel in would be a ring
      // parked at full size, which is worse than none. The stylesheet is what takes it out —
      // the same media query that takes the breath out — so it is read as not drawn rather
      // than as not there.
      const ring = dot.previousElementSibling
      if (ring !== null) {
        await waitFor(() => {
          expect(ring).not.toBeVisible()
        })
      }
    } finally {
      await restore()
    }
  },
}

/**
 * A dot that says how long the work took (recette 4 of 23 September 2026): on hover, and to
 * whatever reads the page after the state, and nowhere on the line itself.
 */
export const Timed: Story = {
  args: { status: 'success', label: 'Done', title: '1301 ms' },
  play: async ({ canvasElement }) => {
    const dot = within(canvasElement).getByRole('img', { name: 'Done' })
    await expect(dot).toHaveAttribute('title', '1301 ms')
    await expect(dot).toHaveAccessibleDescription('1301 ms')
    await expect(within(canvasElement).queryByText('1301 ms')).toBeNull()
  },
}
