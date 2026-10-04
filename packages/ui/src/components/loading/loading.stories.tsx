import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { Loading, Skeleton } from './loading.tsx'

/**
 * What stands in for something on its way: a skeleton when its shape is known, three dots going
 * round when it is not.
 */
const meta = {
  tags: ['autodocs'],
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

/**
 * The spinner, for what has no shape to draw: three dots a third of a turn apart, in the colour
 * of the text around them, at the three steps of the icon scale. Asked for less movement — as the
 * runner of these stories asks — the ring stands still.
 */
export const Spinner: Story = {
  render: (args) => (
    <div className="flex items-center gap-4 text-primary">
      <Loading {...args} size="sm" label="Loading, small" />
      <Loading {...args} size="md" />
      <Loading {...args} size="lg" label="Loading, large" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const spinners = within(canvasElement).getAllByRole('status')
    expect(spinners.map((one) => getComputedStyle(one).width)).toEqual(['16px', '18px', '22px'])
    for (const spinner of spinners) {
      const ring = spinner.firstElementChild!
      const dots = [...ring.children]
      expect(dots).toHaveLength(3)
      expect(getComputedStyle(dots[0]!).backgroundColor).toBe(getComputedStyle(spinner).color)
      expect(new Set(dots.map((dot) => getComputedStyle(dot).transform)).size).toBe(3)
      expect(getComputedStyle(ring).animationName).toBe(
        globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'turn',
      )
    }
  },
}

/**
 * The skeleton, for what has a shape: a title, a line, a square, each exactly the height of the
 * line of type that replaces it, and nothing of the content itself: no word shows through.
 */
export const Skeletons: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Skeleton shape="square" />
      <div className="flex flex-col">
        <Skeleton shape="title" />
        <Skeleton shape="line" />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent?.trim()).toBe('')
    const skeletons = [...canvasElement.querySelectorAll<HTMLElement>('[aria-hidden="true"]')]
    expect(skeletons).toHaveLength(3)
    for (const line of skeletons.slice(1)) {
      expect(`${String(line.getBoundingClientRect().height)}px`).toBe(
        getComputedStyle(line).lineHeight,
      )
    }
  },
}
