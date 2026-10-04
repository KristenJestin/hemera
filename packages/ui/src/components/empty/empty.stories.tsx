import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { IconFolder, IconPlus } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { Empty } from './empty.tsx'

/**
 * What an area says when it has nothing to show yet: centred in the area, an icon or Hemera's
 * face, a title, one line, and the action that fills it. Never a sentence against the left edge
 * and a lone button under it.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/Empty',
  component: Empty,
  parameters: { layout: 'fullscreen' },
  args: {
    icon: <IconFolder size="md" />,
    title: 'No Project yet',
    description: 'A Project is a folder of repositories Hemera works in.',
    action: (
      <Button variant="primary" onClick={fn()}>
        <IconPlus size="sm" />
        Add a Project
      </Button>
    ),
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    icon: { control: false },
    face: { control: false },
    action: { control: false },
  },
  decorators: [
    (Story) => (
      <div className="flex h-dvh w-full" data-area="">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Empty>

export default meta
type Story = StoryObj<typeof meta>

/** Where the middle of a box is, to the pixel. */
function middleOf(box: DOMRect): [number, number] {
  return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)]
}

/** An empty area with an icon: centred, its title a heading, its one line, its action. */
export const WithIcon: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { name: 'No Project yet' })
    const empty = title.closest<HTMLElement>('[data-empty]')!
    const area = canvasElement.querySelector<HTMLElement>('[data-area]')!
    const content = empty.querySelector<HTMLElement>('[data-empty-content]')!
    expect(middleOf(content.getBoundingClientRect())).toEqual(
      middleOf(area.getBoundingClientRect()),
    )
    expect(getComputedStyle(title).textAlign).toBe('center')
    expect(canvas.getByText(/folder of repositories/)).toBeVisible()
    expect(empty.querySelector('[data-empty-media="icon"]')).not.toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a Project' }))
  },
}

/** An empty area that is Hemera's to fill: its face, asleep, in place of an icon. */
export const WithFace: Story = {
  args: {
    icon: undefined,
    face: 'asleep',
    title: 'Nothing running',
    description: 'Start a mission and Hemera wakes up.',
    action: <Button onClick={fn()}>Start a mission</Button>,
  },
  play: async ({ canvasElement }) => {
    const empty = canvasElement.querySelector<HTMLElement>('[data-empty]')!
    expect(empty.querySelector('[data-empty-media="face"] svg')).not.toBeNull()
    expect(empty.querySelector('[data-empty-media="icon"]')).toBeNull()
  },
}

/** Nothing to do about it: no action, the rest unchanged. */
export const WithoutAction: Story = {
  args: { action: undefined, title: 'No run yet', description: 'Runs of this mission show here.' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole('button')).toBeNull()
    expect(within(canvasElement).getByRole('heading', { name: 'No run yet' })).toBeVisible()
  },
}
