import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SpecHead } from './spec-head.tsx'

/**
 * The first line of the Spec panel: the key, the title, the type, the status, and — once there
 * is more than one revision — the picker of the revisions, with `Rework` on a `ready` Spec.
 */
const meta = {
  title: 'Blocks/Spec/SpecHead',
  component: SpecHead,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    specKey: 'ATL-7',
    title: 'CSV invoice export',
    type: 'feature',
    status: 'draft',
    revision: 1,
    revisions: [{ number: 1, detail: 'current, draft' }],
    onPickRevision: fn(),
    onRework: fn(),
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
  },
} satisfies Meta<typeof SpecHead>

export default meta

type Story = StoryObj<typeof meta>

/** A first draft: no revision named, no picker, no Rework. */
export const Draft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'CSV invoice export' })).toBeVisible()
    await expect(canvas.getByText('draft')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /rev/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
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
      { number: 2, detail: 'current, frozen' },
      { number: 1, detail: 'read only · 22 Sep' },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'rev 2' }))
    const older = await within(document.body).findByRole('menuitem', {
      name: 'rev 1 · read only · 22 Sep',
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
      { number: 2, detail: 'current, frozen' },
      { number: 1, detail: 'read only · 22 Sep' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'rev 1' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
  },
}

/** Reworked into revision 3: a draft again, with its older revisions in the picker. */
export const Reworked: Story = {
  args: {
    revision: 3,
    revisions: [
      { number: 3, detail: 'current, draft' },
      { number: 2, detail: 'read only · frozen 23 Sep' },
      { number: 1, detail: 'read only · 22 Sep' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'rev 3' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
  },
}
