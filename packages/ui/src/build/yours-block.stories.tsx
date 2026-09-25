import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { T2_THREE_RED, T4_YOURS } from './build-fixtures.ts'
import { YoursBlock } from './yours-block.tsx'

/**
 * A task that is the user's (D10-08, D10-03): the human task of the build, or the agent's task that
 * came back after three red tries. In the build view it says what is asked, or the three
 * failures; above the chat's composer it says it on one line. Both answer the same way: Done, or
 * Skip with a reason — and, when tasks depend on it, whether they go on without it.
 */
const meta = {
  title: 'Blocks/Build/YoursBlock',
  component: YoursBlock,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    task: T4_YOURS,
    variant: 'view',
    dependants: [],
    onDone: fn(),
    onSkip: fn(),
  },
  argTypes: {
    task: { control: 'object', description: 'The task that is the user’s.' },
    variant: {
      control: 'inline-radio',
      options: ['view', 'banner'],
      description: 'In the build view, or as the banner above the composer.',
    },
    dependants: { control: 'object', description: 'The labels of the tasks that depend on it.' },
    onDone: { action: 'done' },
    onSkip: { action: 'skipped' },
    onOpen: { action: 'opened' },
  },
} satisfies Meta<typeof YoursBlock>

export default meta

type Story = StoryObj<typeof meta>

/** The page the dialog opens over. */
function page() {
  return within(document.body)
}

/** The human task: what it delivers, how it is checked, Done and Skip. */
export const HumanTask: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('group', { name: 'Yours: the agent does not do this task' }),
    ).toBeVisible()
    await expect(canvas.getByText(/The September file imports without an error/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Skip…' })).toBeVisible()
  },
}

/** The agent's task back after three red tries, each with what was red and why. */
export const ThreeRedTries: Story = {
  args: { task: T2_THREE_RED, dependants: ['T4'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('group', { name: 'T2 came back to you after 3 red tries' }),
    ).toBeVisible()
    const failures = within(canvas.getByRole('list', { name: 'Failures of T2' }))
    await expect(failures.getAllByRole('listitem')).toHaveLength(3)
    await expect(failures.getByText('coverage on sources/front: 64.2 < 70')).toBeVisible()
  },
}

/** Above the composer: one line, a way to the task, and the same answers. */
export const Banner: Story = {
  args: { variant: 'banner', onOpen: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const banner = canvas.getByRole('group', {
      name: 'Yours: T4 · The file imports into the ledger',
    })
    await userEvent.click(within(banner).getByRole('button', { name: 'Open' }))
    await expect(args.onOpen).toHaveBeenCalled()
  },
}

/** The banner of a task that came back after three red tries. */
export const BannerThreeRedTries: Story = {
  args: { variant: 'banner', task: T2_THREE_RED, dependants: ['T4'], onOpen: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('group', { name: 'T2 came back to you after 3 red tries' }),
    ).toBeVisible()
  },
}

/**
 * Skip asked: a reason is required, and the tasks that depend on it wait unless the box is
 * ticked (D10-03). Skipped with both, the answer carries both.
 */
export const Skipping: Story = {
  args: { task: T2_THREE_RED, dependants: ['T4'] },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Skip…' }))
    const dialog = within(await waitFor(() => page().getByRole('dialog', { name: 'Skip T2?' })))
    const skip = dialog.getByRole('button', { name: 'Skip T2' })
    await expect(skip).toBeDisabled()
    // The dialog rises into place; what it asks is read once it has.
    await waitFor(() => expect(dialog.getByText(/Left unticked, T4 waits/)).toBeVisible())
    await userEvent.type(dialog.getByRole('textbox', { name: 'Reason' }), 'The ledger changes.')
    await userEvent.click(dialog.getByRole('checkbox', { name: /Let T4 go on without it/ }))
    await userEvent.click(skip)
    await expect(args.onSkip).toHaveBeenCalledWith('The ledger changes.', true)
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull())
  },
}

/**
 * The keyboard: Done then Skip in the tab order, the dialog opened from Skip walked field by
 * field, and the focus back on Skip once it is dismissed.
 */
export const Keyboard: Story = {
  args: { dependants: [] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const done = canvas.getByRole('button', { name: 'Done' })
    done.focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onDone).toHaveBeenCalled()
    await userEvent.tab()
    const skip = canvas.getByRole('button', { name: 'Skip…' })
    await expect(skip).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const dialog = within(await waitFor(() => page().getByRole('dialog', { name: 'Skip T4?' })))
    // A task nothing depends on asks for its reason only.
    await expect(dialog.queryByRole('checkbox')).toBeNull()
    dialog.getByRole('textbox', { name: 'Reason' }).focus()
    await userEvent.tab()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(skip).toHaveFocus())
  },
}
