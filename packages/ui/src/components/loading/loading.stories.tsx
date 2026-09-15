import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'

import { emulateReducedMotion } from '../../../.storybook/reduced-motion.ts'
import { Loading } from './loading.tsx'

const meta = {
  title: 'Components/Loading',
  component: Loading,
  args: { label: 'Loading' },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    label: { control: 'text' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Loading>

export default meta
type Story = StoryObj<typeof meta>

/** The grid on its own, at whichever step of the icon scale you ask for. */
export const Playground: Story = {
  args: { size: 'md' },
}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-center gap-4">
      <Loading {...args} size="sm" label="Loading, small" />
      <Loading {...args} size="md" label="Loading" />
      <Loading {...args} size="lg" label="Loading, large" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const grids = within(canvasElement).getAllByRole('status')
    expect(grids).toHaveLength(3)
    for (const grid of grids) {
      const dots = [...grid.firstElementChild!.children]
      expect(dots).toHaveLength(3)
      // The dots are drawn in the colour of the text around them and nothing else.
      expect(getComputedStyle(dots[0]!).backgroundColor).toBe(getComputedStyle(grid).color)
      // They sit a third of a turn apart on the ring they orbit.
      expect(new Set(dots.map((dot) => getComputedStyle(dot).transform)).size).toBe(3)
    }
    expect(grids.map((grid) => getComputedStyle(grid).width)).toEqual(['14px', '16px', '20px'])
  },
}

/** Running in the colour of whatever text it sits in: the indicator names no colour of its own. */
export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-center gap-4">
      <Loading {...args} />
      <span className="text-primary">
        <Loading {...args} label="Loading in the primary colour" />
      </span>
      <span className="text-destructive">
        <Loading {...args} label="Loading in the destructive colour" />
      </span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const [plain, coloured] = within(canvasElement).getAllByRole('status')
    const dotOf = (grid: HTMLElement): Element => grid.firstElementChild!.firstElementChild!
    expect(getComputedStyle(dotOf(plain!)).backgroundColor).not.toBe(
      getComputedStyle(dotOf(coloured!)).backgroundColor,
    )
    // One element turns and the dots ride it; no dot animates anything of its own.
    expect(getComputedStyle(plain!.children[0]!).animationName).toBe('turn')
    expect(getComputedStyle(dotOf(plain!)).animationName).toBe('none')
  },
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
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement }) => {
    const restore = await emulateReducedMotion()
    if (restore === null) return
    try {
      const ring = within(canvasElement).getByRole('status').children[0]!
      await waitFor(() => {
        expect(getComputedStyle(ring).animationName).toBe('none')
      })
      // Still turning nothing, and still three dots to read.
      expect(ring.children).toHaveLength(3)
    } finally {
      await restore()
    }
  },
}
