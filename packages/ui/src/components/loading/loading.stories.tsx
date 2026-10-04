import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { Button } from '../button/button.tsx'
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
 * The skeleton, for what has a shape: a component draws it over its own parts in its loading mode,
 * so it is exactly the size of what replaces it — a title, a line, a control — and no word of the
 * content shows through.
 */
export const Skeletons: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <div className="flex flex-col">
        <span className="text-base font-semibold">
          <Skeleton>shared</Skeleton>
        </span>
        <span className="text-sm">
          <Skeleton>release · up to date</Skeleton>
        </span>
      </div>
      <Skeleton shape="block">
        <Button size="sm">Restore</Button>
      </Skeleton>
      <div className="flex flex-col">
        <span className="text-base font-semibold" data-shown="">
          shared
        </span>
        <span className="text-sm" data-shown="">
          release · up to date
        </span>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const [title, line, control] = [
      ...canvasElement.querySelectorAll<HTMLElement>('[data-skeleton]'),
    ]
    // Nothing it stands for is seen, and it takes exactly the room of what replaces it.
    for (const skeleton of [title!, line!, control!]) {
      expect(getComputedStyle(skeleton.firstElementChild!).visibility).toBe('hidden')
    }
    const [shownTitle, shownLine] = [...canvasElement.querySelectorAll<HTMLElement>('[data-shown]')]
    /** How wide a text is drawn, whatever box holds it. */
    const textWidth = (holder: HTMLElement): number => {
      const range = document.createRange()
      range.selectNodeContents(holder)
      return range.getBoundingClientRect().width
    }
    expect(title!.getBoundingClientRect().width).toBeCloseTo(textWidth(shownTitle!), 0)
    expect(title!.parentElement!.getBoundingClientRect().height).toBe(
      shownTitle!.getBoundingClientRect().height,
    )
    expect(line!.getBoundingClientRect().width).toBeCloseTo(textWidth(shownLine!), 0)
    expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}
