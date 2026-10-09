import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../../components/button/button.tsx'
import {
  DENSE,
  FAILED,
  FILLED,
  HISTORY,
  JUST_READ,
  NONE,
  NO_MODEL,
  REREADING,
  RUNNING,
  WAITING,
} from './living-spec-fixtures.ts'
import { LivingSpecPage } from './living-spec-page.tsx'
import type { LivingSpecData } from './living-spec-types.ts'

/**
 * The living spec of a Project, domain by domain: the domains listed down the left, one open
 * beside them with Validate, Reject and Re-read at its head, and the limit of what Hemera sees
 * under it. A proposal is a dashed draft, never drawn like a validated requirement; a re-read
 * stands beside today's words. Before any domain, the page says where the reading stands.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Living spec',
  component: LivingSpecPage,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'Acme',
    data: FILLED,
    opened: null,
    histories: {},
    onOpenDomain: fn(),
    onHistory: fn(),
    onValidate: fn(),
    onReject: fn(),
    onDrop: fn(),
    onReread: fn(),
    onRead: fn(),
    onOrigin: fn(),
    onModels: fn(),
    onRetry: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen flex-col bg-surface-content">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LivingSpecPage>

export default meta
type Story = StoryObj<typeof meta>

/** The first read is on its way: skeletons where the domains will be. */
export const Loading: Story = {
  args: { data: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 1, name: 'Living spec' })).toBeVisible()
    await expect(canvas.getByLabelText('Domains')).toHaveAttribute('aria-busy', 'true')
  },
}

/** The living spec could not be read: why, in words, and Try again. */
export const Error: Story = {
  args: { data: null, error: 'The engine did not answer in time.' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('did not answer in time')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(args.onRetry).toHaveBeenCalled()
  },
}

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
 * keyboard goes to the domain's actions and validates it.
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
    await userEvent.click(canvas.getByRole('button', { name: 'Reject this domain' }))
    await expect(args.onReject).toHaveBeenCalledWith('accounts')
  },
}

/** A proposal is never drawn like a validated requirement: its name says so, and its outline is dashed. */
export const ProposedNeverLikeValidated: Story = {
  args: { data: JUST_READ, opened: 'checkout' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const proposed = canvas.getByRole('article', { name: 'LR1, proposed' })
    await expect(proposed).toHaveClass('border-dashed')
    await expect(canvas.queryByRole('article', { name: 'LR1, validated' })).toBeNull()
  },
}

/** A validated requirement: a solid card, History on it, never a Drop. */
export const ValidatedIsSolid: Story = {
  args: { opened: 'checkout' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const validated = canvas.getByRole('article', { name: 'LR1, validated' })
    await expect(validated).not.toHaveClass('border-dashed')
    await expect(canvas.queryByRole('button', { name: 'Drop LR1' })).toBeNull()
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
    await expect(args.onOrigin).toHaveBeenCalledWith({
      missionId: 'm12',
      key: 'ACME-12',
      round: 1,
    })
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
  args: { opened: 'checkout', histories: { LR3: HISTORY } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('button', { name: 'History of LR3' })
    await userEvent.click(toggle)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(args.onHistory).toHaveBeenCalledWith('LR3')
    await expect(canvas.getByRole('list', { name: 'History' })).toHaveTextContent('Changed')
    await userEvent.click(toggle)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('list', { name: 'History' })).toBeNull()
  },
}

/** A requirement's history being read: a word of waiting where it will unfold. */
export const HistoryLoading: Story = {
  args: { opened: 'checkout', histories: { LR3: 'loading' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'History of LR3' }))
    await expect(await canvas.findByRole('status', { name: 'Reading the history' })).toBeVisible()
    await expect(canvas.queryByRole('list', { name: 'History' })).toBeNull()
  },
}

/** A domain whose requirements are not read yet: skeleton rows under its head. */
export const RequirementsOnTheirWay: Story = {
  args: {
    data: { ...FILLED, requirements: { checkout: FILLED.requirements['checkout'] ?? [] } },
    opened: 'accounts',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('list', { name: 'Requirements of Accounts and sign-in' }),
    ).toHaveAttribute('aria-busy', 'true')
  },
}

/** A gesture on its way: its button works and keeps its place. */
export const Busy: Story = {
  args: { opened: 'accounts', busy: 'accounts' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /Validate this domain/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/** The last gesture was refused: why, in words, under the domain's head. */
export const Refusal: Story = {
  args: {
    opened: 'accounts',
    refused: 'LR6 changed while you were reading: read the domain again before validating it.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('read the domain again')
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

/** The laptop's size: the domains and the open one fit without a sideways scroll. */
export const Laptop: Story = {
  args: { data: DENSE, opened: 'd12' },
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
  },
}

/** The keyboard path: Tab reaches each domain in turn, Enter opens it. */
export const KeyboardThroughDomains: Story = {
  render: function Render(args) {
    const [opened, setOpened] = useState<string | null>(null)
    return (
      <LivingSpecPage
        {...args}
        opened={opened}
        onOpenDomain={(id) => {
          args.onOpenDomain(id)
          setOpened(id)
        }}
      />
    )
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Domains' })
    const buttons = within(nav).getAllByRole('button')
    buttons[0]?.focus()
    await userEvent.tab()
    await expect(buttons[1]).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onOpenDomain).toHaveBeenCalledWith('accounts')
    await waitFor(() => expect(buttons[1]).toHaveAttribute('aria-current', 'true'))
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Accounts and sign-in' }),
    ).toBeVisible()
  },
}

/** Validating a domain moves it from proposed to validated; the control plays it again. */
export const ProposedBecomesValidated: Story = {
  args: { opened: 'search' },
  render: function Render(args) {
    const [validated, setValidated] = useState(false)
    const data: LivingSpecData = validated
      ? {
          ...FILLED,
          domains: FILLED.domains.map((one) =>
            one.id === 'search'
              ? { ...one, state: 'validated', proposed: 0, validated: one.proposed }
              : one,
          ),
          requirements: {
            ...FILLED.requirements,
            search: (FILLED.requirements['search'] ?? []).map((one) => ({
              ...one,
              state: 'validated',
              uncertainty: '',
            })),
          },
        }
      : FILLED
    return (
      <>
        <LivingSpecPage
          {...args}
          data={data}
          onValidate={(id) => {
            args.onValidate(id)
            setValidated(true)
          }}
        />
        <div className="fixed right-4 bottom-4">
          <Button onClick={() => setValidated(!validated)}>
            {validated ? 'Play it again' : 'Validate it'}
          </Button>
        </div>
      </>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('article', { name: 'LR11, proposed' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Validate this domain' }))
    await waitFor(() =>
      expect(canvas.getByRole('article', { name: 'LR11, validated' })).toBeVisible(),
    )
    await expect(canvas.queryByRole('button', { name: 'Validate this domain' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Play it again' }))
    await expect(canvas.getByRole('article', { name: 'LR11, proposed' })).toBeVisible()
  },
}
