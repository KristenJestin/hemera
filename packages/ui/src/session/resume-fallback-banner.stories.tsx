import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ResumeFallbackBanner } from './resume-fallback-banner.tsx'

/**
 * A thread that looks resumed and was rebuilt: the one case where saying nothing would be a lie.
 */
const meta = {
  title: 'Blocks/Session/ResumeFallbackBanner',
  component: ResumeFallbackBanner,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { agent: 'Codex', session: 'codex-4f21', kept: 'the last 40 entries', onDismiss: fn() },
  argTypes: {
    agent: { control: 'text', description: 'The agent that could not take its session up.' },
    session: { control: 'text', description: 'The session that was rebuilt.' },
    kept: { control: 'text', description: 'What was kept, as a bound and not a promise.' },
    onDismiss: { description: 'Dismisses the banner once it has been read.' },
  },
} satisfies Meta<typeof ResumeFallbackBanner>

export default meta

type Story = StoryObj<typeof meta>

/** The bound is said out loud: what is below is what Hemera had, not what the agent had. */
export const CouldNotResume: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Codex could not resume its own session.')).toBeVisible()
    await expect(canvas.getByText(/the last 40 entries/)).toBeVisible()
    await expect(canvas.getByText(/does not remember it/)).toBeVisible()
  },
}

/** Without a bound to report, the banner says what it can and invents nothing. */
export const NothingKeptToSay: Story = {
  args: { kept: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/rebuilt from what Hemera kept/)).toBeVisible()
  },
}

/** A reader who has read it puts it away. */
export const Dismissed: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }))
    await expect(args.onDismiss).toHaveBeenCalled()
  },
}
