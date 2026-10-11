import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Slider, type SliderProps } from './slider.tsx'

/** A slider whose value the story keeps, so moving it in the canvas does what it says. */
function Kept(props: SliderProps) {
  const [value, setValue] = useState(props.value)
  return (
    <div className="w-need-title">
      <Slider
        {...props}
        value={value}
        onValueChange={(next) => {
          setValue(next)
          props.onValueChange(next)
        }}
      />
    </div>
  )
}

/** A thumb on a track to pick a number in a range, with the keyboard or the hand. */
const meta = {
  tags: ['autodocs'],
  title: 'Components/Slider',
  component: Slider,
  args: { label: 'Volume', value: 50, onValueChange: fn(), onValueCommitted: fn() },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
    label: { control: 'text' },
    disabled: { control: 'boolean' },
    className: { table: { disable: true } },
  },
  render: (args) => <Kept {...args} />,
} satisfies Meta<typeof Slider>

export default meta
type Story = StoryObj<typeof meta>

/** Half way: the thumb sits in the middle, and a screen reader hears the value in percent. */
export const Half: Story = {
  play: async ({ canvasElement }) => {
    const thumb = within(canvasElement).getByRole('slider', { name: 'Volume' })
    expect(thumb).toHaveValue('50')
    expect(thumb).toHaveAttribute('aria-valuetext', '50 %')
  },
}

/** The ends of the range: nothing, and everything. */
export const Ends: Story = {
  render: () => (
    <div className="flex w-need-title flex-col gap-4">
      <Slider label="Silent" value={0} onValueChange={fn()} />
      <Slider label="Full" value={100} onValueChange={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('slider', { name: 'Silent' })).toHaveValue('0')
    expect(canvas.getByRole('slider', { name: 'Full' })).toHaveValue('100')
  },
}

/** Refused: greyed, and out of the hand's reach. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('slider', { name: 'Volume' })).toBeDisabled()
  },
}

/** From the keyboard: Tab reaches the thumb, the arrows move it by one, Home and End to the ends. */
export const MovedByKeys: Story = {
  play: async ({ canvasElement, args }) => {
    const thumb = within(canvasElement).getByRole('slider', { name: 'Volume' })
    await userEvent.tab()
    expect(thumb).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(thumb).toHaveValue('51')
    expect(args.onValueChange).toHaveBeenLastCalledWith(51)
    await userEvent.keyboard('{Home}')
    expect(thumb).toHaveValue('0')
    await userEvent.keyboard('{End}')
    expect(thumb).toHaveValue('100')
    expect(args.onValueCommitted).toHaveBeenCalledWith(100)
  },
}
