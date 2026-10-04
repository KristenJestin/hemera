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
 * What has no shape to draw: Hemera's face in its loading state — three dots going round, in the
 * colour of the text around them — at three steps. There is no other spinner in the catalogue.
 */
export const Indicator: Story = {
  render: (args) => (
    <div className="flex items-center gap-4 text-primary">
      <Loading {...args} size="sm" label="Loading, small" />
      <Loading {...args} size="md" />
      <Loading {...args} size="lg" label="Loading, large" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const indicators = within(canvasElement).getAllByRole('status')
    expect(indicators.map((one) => one.getAttribute('aria-label'))).toEqual([
      'Loading, small',
      'Loading',
      'Loading, large',
    ])
    for (const indicator of indicators) {
      const face = indicator.querySelector<HTMLElement>('[data-state="loading"]')
      expect(face, 'the face, loading').not.toBeNull()
      expect(face!.querySelector('svg')).not.toBeNull()
      expect(indicator.querySelector('.orbit-0')).toBeNull()
    }
    const widths = indicators.map((one) => one.getBoundingClientRect().width)
    expect(widths[0]).toBeLessThan(widths[1]!)
    expect(widths[1]).toBeLessThan(widths[2]!)
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
