import type { Meta, StoryObj } from '@storybook/react-vite'
import { cn } from 'cn'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { OVER_MARK, SlidingMark } from './sliding-mark.tsx'

/**
 * The mark of the chosen item of a list, on a list of its own: what the tabs and every list that
 * marks a choice draw with. One mark, owned by the list, crossing the items and never under one.
 */
const PLACES = ['api', 'web', 'shared']

const LIST = {
  vertical: 'relative isolate flex w-24 flex-col gap-1',
  horizontal: 'relative isolate flex items-stretch gap-1',
} as const

const ITEM =
  'relative flex h-control-md items-center rounded-md px-3 text-sm text-muted-foreground outline-none select-none focus-ring hover:bg-muted'

/** The chosen item: over the mark, which is its fill, and with no fill of its own. */
const CHOSEN = 'z-1 text-foreground hover:bg-transparent'

const FILL = 'absolute inset-0 rounded-md bg-accent'

interface HarnessProps {
  /** Which way the list runs. */
  orientation: 'vertical' | 'horizontal'
  /** The item chosen first, or none. */
  initial: string | null
}

function Harness({ orientation, initial }: HarnessProps) {
  const [chosen, setChosen] = useState(initial)
  return (
    <div role="listbox" aria-label="Repositories of Acme" className={LIST[orientation]}>
      {PLACES.map((place) => (
        <button
          key={place}
          type="button"
          role="option"
          aria-selected={place === chosen}
          data-mark={place}
          className={cn(ITEM, place === chosen && CHOSEN)}
          onClick={() => setChosen(place)}
        >
          <span className={OVER_MARK}>{place}</span>
        </button>
      ))}
      <SlidingMark target={chosen} shape={FILL} />
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Components/SlidingMark',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { orientation: 'vertical', initial: 'api' },
  argTypes: {
    orientation: { control: 'inline-radio', options: ['vertical', 'horizontal'] },
    initial: { control: 'text' },
  },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

/** Where the mark is drawn, against the box of an item. */
async function standsOn(canvasElement: HTMLElement, name: string): Promise<void> {
  const item = within(canvasElement).getByRole('option', { name })
  const mark = canvasElement.querySelector<HTMLElement>('[data-sliding-mark]')!
  await waitFor(() => {
    expect(mark.dataset['slidingMark']).toBe(name)
    const at = mark.getBoundingClientRect()
    const box = item.getBoundingClientRect()
    expect(at.top).toBeCloseTo(box.top, 0)
    expect(at.left).toBeCloseTo(box.left, 0)
    expect(at.width).toBeCloseTo(box.width, 0)
  })
}

/** Down a column: the mark is the chosen item's fill, and goes where the next choice is. */
export const Vertical: Story = {
  play: async ({ canvasElement }) => {
    await standsOn(canvasElement, 'api')
    await userEvent.click(within(canvasElement).getByRole('option', { name: 'shared' }))
    await standsOn(canvasElement, 'shared')
  },
}

/** Along a row: the same mark, the other way. */
export const Horizontal: Story = {
  args: { orientation: 'horizontal' },
  play: async ({ canvasElement }) => {
    await standsOn(canvasElement, 'api')
    await userEvent.click(within(canvasElement).getByRole('option', { name: 'web' }))
    await standsOn(canvasElement, 'web')
  },
}

/** Nothing chosen: no mark at all, rather than one lying at the list's corner. */
export const Empty: Story = {
  args: { initial: null },
  play: async ({ canvasElement }) => {
    const mark = canvasElement.querySelector('[data-sliding-mark]')!
    expect(getComputedStyle(mark).visibility).toBe('hidden')
  },
}
