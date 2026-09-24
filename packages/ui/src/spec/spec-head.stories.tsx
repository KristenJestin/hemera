import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { SpecHead } from './spec-head.tsx'

/**
 * The first line of the Spec panel: the key, the title, the type, the status, and — once there
 * is more than one revision — the picker of the revisions, with `Rework` on a `ready` Spec — and
 * at the very end the fold that takes the panel back to its band.
 */
const meta = {
  title: 'Blocks/Spec/SpecHead',
  component: SpecHead,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  args: {
    specKey: 'ATL-7',
    title: 'CSV invoice export',
    type: 'feature',
    status: 'draft',
    revision: 1,
    revisions: [{ number: 1, detail: 'Latest · draft' }],
    onPickRevision: fn(),
    onRework: fn(),
    onFold: fn(),
  },
  argTypes: {
    specKey: { control: 'text', description: 'The human key, `PREFIX-n`.' },
    title: { control: 'text' },
    type: { control: 'inline-radio', options: ['feature', 'bug', 'maintenance'] },
    status: { control: 'inline-radio', options: ['draft', 'ready'] },
    revision: { control: 'number', description: 'The revision shown.' },
    revisions: { control: 'object', description: 'Every revision, newest first.' },
    superseded: { control: 'boolean', description: 'Whether an older revision is shown.' },
    onPickRevision: { description: 'Shows another revision.' },
    onRework: { description: 'Opens the rework of a `ready` Spec.' },
    onFold: { description: 'Folds the panel to its band.' },
  },
} satisfies Meta<typeof SpecHead>

export default meta

type Story = StoryObj<typeof meta>

/** A first draft: no revision named, no picker, no Rework; the fold at the end of the line. */
export const Draft: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'CSV invoice export' })).toBeVisible()
    await expect(canvas.getByText('draft')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /rev/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Fold the Spec' }))
    await expect(args.onFold).toHaveBeenCalled()
  },
}

/** A `bug`: the type is a quiet chip, never a coloured one. */
export const Bug: Story = {
  args: {
    specKey: 'ATL-12',
    title: 'Totals off by a cent on multi-currency invoices',
    type: 'bug',
  },
}

/**
 * Frozen at revision 2: the picker lists the older one as read only, and `Rework` is the way
 * back to a draft.
 */
export const Ready: Story = {
  args: {
    status: 'ready',
    revision: 2,
    revisions: [
      { number: 2, detail: 'Latest · frozen' },
      { number: 1, detail: 'Frozen 22 Sep · read only' },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Latest' }))
    const older = await within(document.body).findByRole('menuitem', {
      name: 'Frozen 22 Sep · read only',
    })
    await userEvent.click(older)
    await expect(args.onPickRevision).toHaveBeenCalledWith(1)
    await userEvent.click(canvas.getByRole('button', { name: 'Rework' }))
    await expect(args.onRework).toHaveBeenCalled()
  },
}

/** An older revision picked: the picker to go back, and no `Rework` — it is not the current one. */
export const OlderRevision: Story = {
  args: {
    status: 'ready',
    revision: 1,
    superseded: true,
    revisions: [
      { number: 2, detail: 'Latest · frozen' },
      { number: 1, detail: 'Frozen 22 Sep · read only' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Earlier' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
  },
}

/** Reworked into revision 3: a draft again, with its older revisions in the picker. */
export const Reworked: Story = {
  args: {
    revision: 3,
    revisions: [
      { number: 3, detail: 'Latest · draft' },
      { number: 2, detail: 'Frozen 23 Sep · read only' },
      { number: 1, detail: 'Frozen 22 Sep · read only' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Latest' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
  },
}
