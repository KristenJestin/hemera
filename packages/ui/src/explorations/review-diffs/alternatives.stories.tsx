import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { REVIEWING } from './fixtures.ts'
import { commentOf } from './play.ts'
import { DiffScreen } from './screen.tsx'

/**
 * The alternatives to the recommended diff view, one per open question, drawn so the two can be
 * compared side by side. Removed before the merge once the maintainer chooses.
 */
const meta = {
  title: 'Explorations/Review diffs/Alternatives',
  component: DiffScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: REVIEWING,
    onComment: fn(),
    onAction: fn(),
    onOpenForge: fn(),
    onOpenVersion: fn(),
  },
} satisfies Meta<typeof DiffScreen>

export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

/**
 * Open question 33, the alternative: the diff lists its comments again in a column of its own,
 * each sending to its lines, as a pull request's conversation does. Two lists of the same
 * remarks — this one and the Review page's — and a third column in a sheet that already holds
 * two; it only reads once the sheet is grown, which this story does first.
 */
export const CommentsInAColumn: Story = {
  args: { column: true },
  play: async ({ canvasElement }) => {
    const page = body(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'Expand Diff' }))
    const column = within(page.getByRole('list', { name: 'Comments of the diff' }))
    await userEvent.click(column.getByRole('button', { name: /^F8/ }))
    await expect(column.getByRole('button', { name: /^F8/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(await commentOf(canvasElement, 'F8')).toHaveAttribute('data-lit', 'true')
  },
}

/**
 * Open question 76, the alternative: the diff is the one view that opens grown, the whole width
 * of the frame, since a diff is read side by side. Same stack, same crumb, same Back; the shell's
 * rule (no view opens grown, the Diff included) is the one it breaks.
 */
export const DiffOpensGrown: Story = {
  args: { layout: 'split' },
  play: async ({ canvasElement }) => {
    const page = body(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'Expand Diff' }))
    await waitFor(() => expect(page.getByRole('button', { name: 'Collapse Diff' })).toBeVisible())
  },
}
