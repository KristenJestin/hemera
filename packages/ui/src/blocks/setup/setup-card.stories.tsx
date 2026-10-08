import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { Proposal } from './proposal.tsx'
import { type CardStatus, SetupCard, type SetupCardProps } from './setup-card.tsx'
import { LONG_PROPOSALS, NESTED_REPOSITORY, PROPOSALS, REFUSALS } from './setup-fixtures.ts'

/**
 * A card of the setup: what the setup agent proposes for one part of a new Project — its
 * repositories, its commands with their roles, its preparation, its variables, what it never
 * runs — and the answers to it: Accept, Edit in place, Discuss, Decline. One story per state; the
 * card is drawn alone, as wide as a column of the setup's grid.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Setup/Setup card',
  component: SetupCard,
  parameters: { layout: 'fullscreen' },
  args: {
    kind: 'commands',
    status: { state: 'proposed' },
    proposal: PROPOSALS.commands,
    onAccept: fn(),
    onEdit: fn(),
    onDiscuss: fn(),
    onDecline: fn(),
    onSave: fn(),
    onCancel: fn(),
    onSend: fn(),
    onProposeAgain: fn(),
  },
  argTypes: {
    proposal: { table: { disable: true } },
    draft: { table: { disable: true } },
  },
  render: (args) => <Held {...args} />,
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-view-wide flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SetupCard>

export default meta
type Story = StoryObj<typeof meta>

/** The card holding its answers as the setup page does; Accept refused when the engine says so. */
function Held(args: SetupCardProps) {
  const [status, setStatus] = useState<CardStatus>(args.status)
  const [proposal, setProposal] = useState<Proposal | null>(args.proposal)
  const [draft, setDraft] = useState<Proposal | undefined>(args.draft ?? args.proposal ?? undefined)
  const refusal = REFUSALS[args.kind]
  return (
    <SetupCard
      {...args}
      status={status}
      proposal={proposal}
      draft={draft}
      onDraft={setDraft}
      onAccept={() => {
        args.onAccept()
        setStatus(
          refusal === undefined ? { state: 'accepted' } : { state: 'proposed', refused: refusal },
        )
      }}
      onEdit={() => {
        args.onEdit?.()
        setDraft(proposal ?? undefined)
        setStatus({ state: 'editing' })
      }}
      onDiscuss={() => {
        args.onDiscuss?.()
        setStatus({ state: 'discussing' })
      }}
      onDecline={() => {
        args.onDecline()
        setStatus({ state: 'declined' })
      }}
      onSave={() => {
        args.onSave()
        if (draft !== undefined) setProposal(draft)
        setStatus({ state: 'proposed' })
      }}
      onCancel={() => {
        args.onCancel()
        setStatus({ state: 'proposed' })
      }}
      onSend={(note) => {
        args.onSend(note)
        setStatus({ state: 'discussed', note })
      }}
      onProposeAgain={() => {
        args.onProposeAgain?.()
        setStatus({ state: 'reading' })
      }}
    />
  )
}

/** The commands it proposes, each with its line and its roles as glyphs; the four answers. */
export const Commands: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Proposed commands' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(within(list).getByText('docker compose up db')).toBeVisible()
    for (const answer of ['Accept', 'Edit', 'Discuss', 'Decline']) {
      expect(canvas.getByRole('button', { name: answer })).toBeVisible()
    }
  },
}

/** The repositories it found, each with its base. */
export const Repositories: Story = {
  args: { kind: 'repositories', proposal: PROPOSALS.repositories },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list', { name: 'Proposed repositories' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  },
}

/**
 * No repository in the folder itself, and none found when it was chosen: the agent looked deeper
 * and found `services/billing`, marked as found by it.
 */
export const NoRepositoryInMain: Story = {
  args: { kind: 'repositories', proposal: NESTED_REPOSITORY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('services/billing')).toBeVisible()
    expect(
      canvas.getByRole('img', { name: 'Found by the setup agent, deeper than Hemera looked' }),
    ).toBeVisible()
  },
}

/** The preparation recipe, its steps numbered. */
export const Preparation: Story = {
  args: { kind: 'preparation', proposal: PROPOSALS.preparation },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list', { name: 'Proposed preparation' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  },
}

/** The variables, their values always masked. */
export const Variables: Story = {
  args: { kind: 'variables', proposal: PROPOSALS.variables },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('DATABASE_URL')).toBeVisible()
    expect(canvas.queryByText(/postgres:/)).toBeNull()
    expect(canvas.getAllByText('masked')).toHaveLength(3)
  },
}

/** The commands it would never run in this Project. */
export const NeverRun: Story = {
  args: { kind: 'never', proposal: PROPOSALS.never },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('git push --force')).toBeVisible()
  },
}

/** The agent is still reading: the card's head, and the proposal's own shape; no answer yet. */
export const Reading: Story = {
  args: { status: { state: 'reading' }, proposal: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('region', { name: 'Commands', busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
    expect(canvas.queryByRole('button', { name: 'Accept' })).toBeNull()
  },
}

/** Accepted: the answers leave, the words go quiet, a check at the end of the head. */
export const Accepted: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept' }))
    expect(args.onAccept).toHaveBeenCalled()
    expect(await canvas.findByRole('img', { name: 'Accepted' })).toBeVisible()
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: 'Edit' })).toBeNull()
    })
  },
}

/** Accept refused by the engine: its sentence above the answers; the card stays as it was. */
export const Refused: Story = {
  args: { kind: 'preparation', proposal: PROPOSALS.preparation },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept' }))
    expect(await canvas.findByRole('alert')).toHaveTextContent(
      'api/.env.local is not in the main checkout',
    )
    expect(canvas.getByRole('button', { name: 'Accept' })).toBeVisible()
  },
}

/** Edit: the proposal's lines become fields in place; a line removed, the edit saved. */
export const Editing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Edit' }))
    const line = await canvas.findByRole('textbox', { name: 'Line of test' })
    expect(line).toHaveValue('pnpm test')
    await userEvent.clear(line)
    await userEvent.type(line, 'pnpm test --run')
    await userEvent.click(canvas.getByRole('button', { name: 'Remove db' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    const list = await canvas.findByRole('list', { name: 'Proposed commands' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('pnpm test --run')).toBeVisible()
  },
}

/** A variable's value is written over in the editor, never shown. */
export const EditingVariables: Story = {
  args: { kind: 'variables', proposal: PROPOSALS.variables },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Edit' }))
    const value = await canvas.findByLabelText('Value of DATABASE_URL')
    expect(value).toHaveAttribute('type', 'password')
  },
}

/** Discuss: what should change, in the user's words; Send only once something is written. */
export const Discussing: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Discuss' }))
    const field = await canvas.findByRole('textbox', { name: 'What should change in Commands' })
    expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull()
    await userEvent.type(field, 'db is a service of the main checkout, not of each Workspace.')
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }))
    expect(args.onSend).toHaveBeenCalledWith(
      'db is a service of the main checkout, not of each Workspace.',
    )
  },
}

/** Discussed: the user's words under the proposal while the agent writes another. */
export const Discussed: Story = {
  args: {
    kind: 'variables',
    proposal: PROPOSALS.variables,
    status: { state: 'discussed', note: 'SMTP_URL belongs to the mail service, not to Acme.' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('SMTP_URL belongs to the mail service, not to Acme.')).toBeVisible()
    expect(
      canvas.getByRole('status', { name: 'The setup agent is writing another proposal' }),
    ).toBeInTheDocument()
    expect(canvas.getByRole('img', { name: 'Discussed with the setup agent' })).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Accept' })).toBeNull()
  },
}

/** Declined: quiet, its glyph, and one answer left: Propose again, which sets the agent reading. */
export const Declined: Story = {
  args: { kind: 'never', proposal: PROPOSALS.never },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Decline' }))
    expect(await canvas.findByRole('img', { name: 'Declined' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Propose again' }))
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
    })
  },
}

/** A long path, a long line and a long name: each ends in an ellipsis, the roles stay in sight. */
export const LongText: Story = {
  args: { proposal: LONG_PROPOSALS.commands },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByText(/--reporter=verbose/)
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
  },
}

/** From the keyboard: Accept, Edit, Discuss, Decline in order; Edit puts the focus in the first field. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const accept = canvas.getByRole('button', { name: 'Accept' })
    accept.focus()
    await userEvent.tab()
    const edit = canvas.getByRole('button', { name: 'Edit' })
    expect(edit).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Discuss' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Decline' })).toHaveFocus()
    edit.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(canvas.getByRole('textbox', { name: 'Name of dev' })).toHaveFocus()
    })
  },
}

/**
 * A card whose agent takes no edit, no discussion and no new proposal (#44's engine): Accept and
 * Decline only, and nothing once declined.
 */
export const AcceptAndDeclineOnly: Story = {
  render: (args) => {
    const { onEdit: _edit, onDiscuss: _discuss, onProposeAgain: _again, ...answers } = args
    return <SetupCard {...answers} />
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Accept' })).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Decline' })).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Discuss' })).toBeNull()
  },
}

/** Declined on such a card: nothing more to offer. */
export const DeclinedWithNoNewProposal: Story = {
  args: { status: { state: 'declined' } },
  render: (args) => {
    const { onEdit: _edit, onDiscuss: _discuss, onProposeAgain: _again, ...answers } = args
    return <SetupCard {...answers} />
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Propose again' })).toBeNull()
  },
}
