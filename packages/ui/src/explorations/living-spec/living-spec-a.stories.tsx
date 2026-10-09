import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  DENSE,
  FAILED,
  FILLED,
  JUST_READ,
  NONE,
  NO_MODEL,
  REREADING,
  RUNNING,
  WAITING,
} from './living-spec-fixtures.ts'
import { LivingSpecA } from './proposal-a.tsx'

/**
 * The living spec, domain by domain: the domains listed down the left, one open
 * beside them with Validate, Reject and Re-read at its head; a proposal is a dashed draft, a
 * re-read stands beside today's words.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Living spec/Domain by domain',
  component: LivingSpecA,
  parameters: { layout: 'fullscreen' },
  args: {
    data: FILLED,
    onValidate: fn(),
    onReject: fn(),
    onDrop: fn(),
    onReread: fn(),
    onRead: fn(),
    onOrigin: fn(),
    onModels: fn(),
  },
} satisfies Meta<typeof LivingSpecA>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing read yet: what the page will hold, and the reading to start. */
export const NothingYet: Story = {
  args: { data: NONE },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Read the Project' }))
    await expect(args.onRead).toHaveBeenCalled()
  },
}

/** The first reading waits for a slot under the cap: what it waits for, in words. */
export const WaitingForASlot: Story = {
  args: { data: WAITING },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/3 agents of 3/)).toBeVisible()
  },
}

/** The first reading runs: its chip in the header, Hemera's face reading where domains will be. */
export const Reading: Story = {
  args: { data: RUNNING },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Reading Acme, running' })).toBeVisible()
  },
}

/** The first reading failed: why, in words, and Try again. */
export const ReadingFailed: Story = {
  args: { data: FAILED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('usage limit')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(args.onRead).toHaveBeenCalled()
  },
}

/** No model for the reading: a need of the Project, which opens Models by role. */
export const NoModel: Story = {
  args: { data: NO_MODEL },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Models by role/ }))
    await expect(args.onModels).toHaveBeenCalled()
  },
}

/** The first reading just ended: every domain proposed, its chip calls for a review. */
export const JustRead: Story = {
  args: { data: JUST_READ },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Reading Acme, done, waits for you' }),
    ).toBeVisible()
    await expect(canvas.getAllByRole('article', { name: /proposed$/ }).length).toBeGreaterThan(0)
  },
}

/**
 * Proposed and validated side by side in the list; a proposed domain open, its doubts said. The
 * keyboard goes from the list to the domain and validates it.
 */
export const ProposedDomain: Story = {
  args: { opened: 'accounts' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Domains' })
    await expect(
      within(nav).getByRole('button', { name: 'Checkout, validated' }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('article', { name: 'LR6, proposed' })).toHaveTextContent(
      'could not find',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Drop LR7' }))
    await expect(args.onDrop).toHaveBeenCalledWith('LR7')
    const validate = canvas.getByRole('button', { name: 'Validate this domain' })
    validate.focus()
    await expect(validate).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onValidate).toHaveBeenCalledWith('accounts')
  },
}

/** A validated domain: no Validate or Reject, Re-read and the limit of what Hemera sees. */
export const ValidatedDomain: Story = {
  args: { opened: 'checkout' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Validate this domain' })).toBeNull()
    await expect(canvas.getByText(/does not see behaviour changed outside a mission/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'ACME-12, round 1' }))
    await expect(args.onOrigin).toHaveBeenCalledWith('m12')
    await userEvent.click(canvas.getByRole('button', { name: 'Re-read this domain' }))
    await expect(args.onReread).toHaveBeenCalledWith('checkout')
  },
}

/** A re-read proposes a replacement and a removal: each beside what holds today. */
export const ReReadProposals: Story = {
  args: { opened: 'invoices' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('group', { name: 'LR8, a change proposed' })).toHaveTextContent(
      'Proposed instead',
    )
    await expect(canvas.getByRole('group', { name: 'LR10, a change proposed' })).toHaveTextContent(
      'Proposed for removal',
    )
  },
}

/** A requirement's history folded open under it, a mission's change linked to its mission. */
export const RequirementHistory: Story = {
  args: { opened: 'checkout', history: 'LR3' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('button', { name: 'History of LR3' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('list', { name: 'History' })).toHaveTextContent('Changed')
  },
}

/** A domain being re-read: its chip in the header, and no second Re-read offered. */
export const Rereading: Story = {
  args: { data: REREADING, opened: 'checkout' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Re-reading Checkout, running' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Re-read this domain' })).toBeNull()
  },
}

/** Fourteen domains, one of twenty-four requirements, a very long requirement and domain name. */
export const Dense: Story = {
  args: { data: DENSE, opened: 'd0' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Domains' })
    await expect(within(nav).getAllByRole('button')).toHaveLength(14)
    await expect(
      within(canvas.getByRole('list', { name: 'Requirements of Checkout' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(24)
  },
}
