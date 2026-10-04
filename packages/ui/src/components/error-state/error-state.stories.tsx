import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ErrorState } from './error-state.tsx'

/**
 * What an area says when what it shows could not be had: the same shape as `Empty` — centred, an
 * icon or Hemera's face, a title, one line saying what went wrong in words — and "Try again".
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/ErrorState',
  component: ErrorState,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Projects could not be read',
    description: 'The Profile folder cannot be opened: permission denied.',
    onRetry: fn(),
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    face: { control: false },
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen w-full" data-area="">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ErrorState>

export default meta
type Story = StoryObj<typeof meta>

/** It failed: said in words, as an alert, with "Try again", which asks again. */
export const Failed: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const alert = canvas.getByRole('alert')
    expect(alert).toHaveTextContent('Projects could not be read')
    expect(alert).toHaveTextContent('permission denied')
    expect(alert.querySelector('[data-empty]')).not.toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(args.onRetry).toHaveBeenCalled()
  },
}

/** Asked again: the button says it is working and keeps its place. */
export const Retrying: Story = {
  args: { retrying: true },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: /Try again/ })
    expect(button).toHaveAttribute('aria-disabled', 'true')
  },
}

/** Hemera's own failure: its face, in its error state, in place of the icon. */
export const WithFace: Story = {
  args: {
    face: true,
    title: 'Hemera could not start its engine',
    description: 'The engine stopped after 3 tries. Its log says: port 6140 in use.',
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-empty-media="face"] svg')).not.toBeNull()
  },
}
