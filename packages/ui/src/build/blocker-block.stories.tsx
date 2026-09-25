import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { BlockerBlock } from './blocker-block.tsx'
import { BLOCKER, NOW } from './build-fixtures.ts'

/**
 * The agent saying a task contradicts the Spec (D10-08): its reason whole in the build view, one
 * line above the chat's composer. The task and its dependants wait, the others go on; the user
 * dismisses it — the Spec stands, the task goes back to ready — or stops the build, which asks
 * first.
 */
const meta = {
  title: 'Blocks/Build/BlockerBlock',
  component: BlockerBlock,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    blocker: BLOCKER,
    specKey: 'ATL-7',
    now: NOW,
    variant: 'view',
    suspended: ['T4'],
    onDismiss: fn(),
    onStop: fn(),
  },
  argTypes: {
    blocker: { control: 'object', description: 'What the agent raised, and why.' },
    specKey: { control: 'text', description: 'The Spec the build is of.' },
    now: { control: 'text', description: 'The caller’s now, the time is said from.' },
    variant: {
      control: 'inline-radio',
      options: ['view', 'banner'],
      description: 'In the build view, or as the banner above the composer.',
    },
    suspended: { control: 'object', description: 'The tasks that wait with it.' },
    onDismiss: { action: 'dismissed' },
    onStop: { action: 'stopped' },
    onOpen: { action: 'opened' },
  },
} satisfies Meta<typeof BlockerBlock>

export default meta

type Story = StoryObj<typeof meta>

/** In the view: the agent's reason whole, what waits with it, Dismiss and Stop build. */
export const InTheView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const block = within(
      canvas.getByRole('group', { name: /The agent says this task contradicts the Spec/ }),
    )
    await expect(block.getByText(/the ledger refuses two rows/)).toBeVisible()
    await expect(block.getByText('6 min ago')).toBeVisible()
    await expect(block.getByText(/T4 waits with it; the other tasks go on/)).toBeVisible()
  },
}

/** Above the composer: one line, a way to the task, and the same answers. */
export const Banner: Story = {
  args: { variant: 'banner', onOpen: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const banner = within(
      canvas.getByRole('group', { name: 'T3: the agent says this task contradicts the Spec' }),
    )
    await expect(banner.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    await expect(banner.getByRole('button', { name: 'Stop build' })).toBeVisible()
  },
}

/** Dismissed: the Spec stands, and the answer goes out at once. */
export const Dismissed: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Dismiss' }))
    await expect(args.onDismiss).toHaveBeenCalled()
  },
}

/**
 * The keyboard: Dismiss then Stop build; Stop asks first, and dismissing the question gives the
 * focus back to Stop build without stopping anything.
 */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Dismiss' }).focus()
    await userEvent.tab()
    const stop = canvas.getByRole('button', { name: 'Stop build' })
    await expect(stop).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const page = within(document.body)
    await waitFor(() =>
      expect(page.getByRole('dialog', { name: 'Stop the build of ATL-7?' })).toBeVisible(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(stop).toHaveFocus())
    await expect(args.onStop).not.toHaveBeenCalled()
  },
}
