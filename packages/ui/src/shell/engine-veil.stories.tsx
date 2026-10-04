import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { EngineVeil } from './engine-veil.tsx'

/**
 * The engine's state over the sheet: starting, late, stopped. Alone here, on the sheet's own
 * surface; the window's stories show each inside the window.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Shell/Engine',
  component: EngineVeil,
  parameters: { layout: 'fullscreen' },
  args: { state: 'starting', maxDelay: 10, onRestart: fn(), onShowLog: fn() },
  argTypes: {
    state: { control: 'inline-radio', options: ['starting', 'late', 'stopped'] },
    maxDelay: { control: 'number' },
    reason: { control: 'text' },
  },
  decorators: [
    (Story) => (
      <div className="relative h-screen bg-surface-content">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EngineVeil>

export default meta
type Story = StoryObj<typeof meta>

/** Coming up: Hemera's face, large, loading; nothing else to do. */
export const Starting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('status', { name: 'Starting Hemera' })).toBeInTheDocument()
    expect(canvasElement.querySelector('[data-state="thinking"]')).not.toBeNull()
    expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Past its delay: the delay named, Try again first, the log second. */
export const Late: Story = {
  args: { state: 'late' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('no sign within 10 seconds')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(args.onRestart).toHaveBeenCalled()
  },
}

/** Stopped, with the reason the engine gave: Restart Hemera. */
export const Stopped: Story = {
  args: { state: 'stopped', reason: 'The engine process exited with code 1.' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('exited with code 1')
    await userEvent.click(canvas.getByRole('button', { name: 'Show the log' }))
    expect(args.onShowLog).toHaveBeenCalled()
  },
}
