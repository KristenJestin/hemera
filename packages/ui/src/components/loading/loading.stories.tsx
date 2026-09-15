import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'

import { emulateReducedMotion } from '../../../.storybook/reduced-motion.ts'
import { Loading } from './loading.tsx'

const meta = {
  title: 'Components/Loading',
  component: Loading,
} satisfies Meta<typeof Loading>

export default meta
type Story = StoryObj<typeof meta>

/** One of every step of the icon scale, which is every size the indicator comes in. */
export const Variants: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Loading size="sm" label="Loading, small" />
      <Loading size="md" label="Loading" />
      <Loading size="lg" label="Loading, large" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const grids = within(canvasElement).getAllByRole('status')
    expect(grids).toHaveLength(3)
    for (const grid of grids) {
      expect(grid.children).toHaveLength(25)
      expect(getComputedStyle(grid.children[0]!).backgroundColor).toBe(getComputedStyle(grid).color)
    }
  },
}

/** Running in the colour of whatever text it sits in: the indicator names no colour of its own. */
export const States: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Loading label="Loading" />
      <span className="text-primary">
        <Loading label="Loading in the primary colour" />
      </span>
      <span className="text-destructive">
        <Loading label="Loading in the destructive colour" />
      </span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const [plain, coloured] = within(canvasElement).getAllByRole('status')
    expect(getComputedStyle(plain!.children[0]!).backgroundColor).not.toBe(
      getComputedStyle(coloured!.children[0]!).backgroundColor,
    )
    expect(getComputedStyle(plain!.children[0]!).animationName).toBe('wave')
  },
}

export const Light: Story = {
  args: { label: 'Loading' },
  globals: { theme: 'light' },
}

export const Dark: Story = {
  args: { label: 'Loading' },
  globals: { theme: 'dark' },
}

/**
 * The same grid under a system that asked for less movement: drawn at its resting opacity and
 * standing still. The preference is emulated in the browser itself, because that is where the
 * media query is answered — a story cannot decide it from the inside.
 *
 * Opened in the catalogue rather than run by the test runner, there is nothing to emulate
 * with: the reader sees the grid their own system asked for, and the story says so.
 */
export const ReducedMotion: Story = {
  args: { label: 'Loading' },
  play: async ({ canvasElement }) => {
    const restore = await emulateReducedMotion()
    if (restore === null) return
    try {
      const dot = within(canvasElement).getByRole('status').children[0]!
      await waitFor(() => {
        expect(getComputedStyle(dot).animationName).toBe('none')
      })
      expect(getComputedStyle(dot).opacity).toBe('0.2')
    } finally {
      await restore()
    }
  },
}
