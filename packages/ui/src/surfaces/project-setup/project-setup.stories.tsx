import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { SetupFixture } from './setup-fixture.tsx'

/**
 * A new Project, set up from its folder: what the setup agent proposes, a card per part, and the
 * answers to each — Accept, Edit in place, Discuss, Decline — or to all at once. Under the window's
 * header. Each story is the page full-bleed; the toolbar's viewports give its two sizes.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/New Project',
  component: SetupFixture,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SetupFixture>

export default meta
type Story = StoryObj<typeof meta>

const card = (canvasElement: HTMLElement, name: string): HTMLElement =>
  within(canvasElement).getByRole('region', { name })

/** Every card proposed: Accept all at the end of the header, beside the agent's chip, done. */
export const Proposed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1, name: 'New Project' })).toBeVisible()
    expect(canvas.getByText('~/work/acme')).toBeVisible()
    for (const name of ['Repositories', 'Commands', 'Preparation', 'Variables', 'Never run']) {
      expect(card(canvasElement, name)).toBeVisible()
    }
    expect(canvas.getByRole('button', { name: 'Setup agent, done' })).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Accept all' })).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Create the Project' })).toBeNull()
  },
}

/** The agent waits for a free slot: its glyph in the header, every card its own shape. */
export const Waiting: Story = {
  args: {
    agent: 'waiting',
    states: {
      repositories: { state: 'reading' },
      commands: { state: 'reading' },
      preparation: { state: 'reading' },
      variables: { state: 'reading' },
      never: { state: 'reading' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('img', { name: 'Setup agent, waiting for a free slot' })).toBeVisible()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(15)
    expect(canvas.queryByRole('button', { name: 'Accept all' })).toBeNull()
  },
}

/** The agent at work: its chip running; the cards arrive in batches, the others their own shape. */
export const Reading: Story = {
  args: { agent: 'working', arriving: ['preparation', 'variables', 'never'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Setup agent, running' })).toBeVisible()
    expect(card(canvasElement, 'Preparation')).toHaveAttribute('aria-busy', 'true')
    expect(
      within(card(canvasElement, 'Commands')).getByRole('button', { name: 'Accept' }),
    ).toBeVisible()
    await waitFor(
      () => {
        expect(card(canvasElement, 'Never run')).toHaveAttribute('aria-busy', 'false')
      },
      { timeout: 5000 },
    )
    expect(await canvas.findByRole('button', { name: 'Setup agent, done' })).toBeVisible()
  },
}

/** A card edited in place: its lines as fields, Save and Cancel; the other cards as they were. */
export const Editing: Story = {
  args: { states: { commands: { state: 'editing' } } },
  play: async ({ canvasElement }) => {
    const commands = card(canvasElement, 'Commands')
    expect(within(commands).getByRole('textbox', { name: 'Line of dev' })).toHaveValue(
      'pnpm --filter web dev',
    )
    expect(within(commands).getByRole('button', { name: 'Save' })).toBeVisible()
    expect(
      within(card(canvasElement, 'Variables')).getByRole('button', { name: 'Accept' }),
    ).toBeVisible()
  },
}

/** A card discussed: the user's words under it while the agent writes another proposal. */
export const Discussed: Story = {
  play: async ({ canvasElement }) => {
    const variables = card(canvasElement, 'Variables')
    await userEvent.click(within(variables).getByRole('button', { name: 'Discuss' }))
    await userEvent.type(
      within(variables).getByRole('textbox', { name: 'What should change in Variables' }),
      'API_PORT should follow the Workspace, and SMTP_URL is not ours.',
    )
    await userEvent.click(within(variables).getByRole('button', { name: 'Send' }))
    expect(
      await within(variables).findByRole('status', {
        name: 'The setup agent is writing another proposal',
      }),
    ).toBeInTheDocument()
    await waitFor(
      () => {
        expect(within(variables).getAllByRole('listitem')).toHaveLength(2)
      },
      { timeout: 5000 },
    )
    expect(within(variables).getByRole('button', { name: 'Accept' })).toBeVisible()
  },
}

/** Accept refused by the engine: its sentence on the card, the card still waiting for an answer. */
export const Refused: Story = {
  play: async ({ canvasElement }) => {
    const preparation = card(canvasElement, 'Preparation')
    await userEvent.click(within(preparation).getByRole('button', { name: 'Accept' }))
    expect(await within(preparation).findByRole('alert')).toHaveTextContent(
      'api/.env.local is not in the main checkout: the copy would stop the preparation.',
    )
    expect(within(preparation).getByRole('button', { name: 'Accept' })).toBeVisible()
  },
}

/**
 * Accept all stops at the first refusal: Repositories and Commands accepted, Preparation refused
 * with its sentence, Variables and Never run still waiting.
 */
export const AcceptAllStopped: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept all' }))
    expect(
      await within(card(canvasElement, 'Repositories')).findByRole('img', { name: 'Accepted' }),
    ).toBeVisible()
    expect(
      within(card(canvasElement, 'Commands')).getByRole('img', { name: 'Accepted' }),
    ).toBeVisible()
    expect(within(card(canvasElement, 'Preparation')).getByRole('alert')).toBeVisible()
    expect(
      within(card(canvasElement, 'Variables')).queryByRole('img', { name: 'Accepted' }),
    ).toBeNull()
    expect(canvas.getByRole('button', { name: 'Accept all' })).toBeVisible()
  },
}

/** Every card answered: the cards quiet with their check, Create the Project at the header's end. */
export const AllAccepted: Story = {
  args: {
    states: {
      repositories: { state: 'accepted' },
      commands: { state: 'accepted' },
      preparation: { state: 'accepted' },
      variables: { state: 'accepted' },
      never: { state: 'declined' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('img', { name: 'Accepted' })).toHaveLength(4)
    expect(canvas.queryByRole('button', { name: 'Accept all' })).toBeNull()
    const create = canvas.getByRole('button', { name: 'Create the Project' })
    await userEvent.click(create)
    expect(await within(create).findByRole('status', { name: 'Working' })).toBeInTheDocument()
  },
}

/** A card declined: quiet, Propose again; asked, the agent reads again and proposes anew. */
export const ProposeAgain: Story = {
  args: { states: { never: { state: 'declined' } } },
  play: async ({ canvasElement }) => {
    const never = card(canvasElement, 'Never run')
    expect(within(never).getByRole('img', { name: 'Declined' })).toBeVisible()
    await userEvent.click(within(never).getByRole('button', { name: 'Propose again' }))
    await waitFor(() => {
      expect(never).toHaveAttribute('aria-busy', 'true')
    })
    expect(
      await within(never).findByRole('button', { name: 'Accept' }, { timeout: 5000 }),
    ).toBeVisible()
  },
}

/**
 * The folder is not a repository and held none Hemera found: the agent looked deeper and proposes
 * `services/billing`, marked as found by it.
 */
export const NoRepositoryInMain: Story = {
  args: { nested: true, folder: '~/work/acme-services' },
  play: async ({ canvasElement }) => {
    const repositories = card(canvasElement, 'Repositories')
    expect(within(repositories).getByText('services/billing')).toBeVisible()
    expect(
      within(repositories).getByRole('img', {
        name: 'Found by the setup agent, deeper than Hemera looked',
      }),
    ).toBeVisible()
  },
}

/**
 * The agent stopped: a Project need above the cards, with Try again; the cards it had written stay,
 * the others are not drawn.
 */
export const Failed: Story = {
  args: {
    agent: 'failed',
    failure: 'Claude Code exited: the usage limit of this account is reached until 14:00.',
    states: {
      preparation: { state: 'reading' },
      variables: { state: 'reading' },
      never: { state: 'reading' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('article', { name: 'Something missing: The setup agent stopped' }),
    ).toHaveTextContent('usage limit')
    expect(canvas.getByRole('button', { name: 'Setup agent, failed' })).toBeVisible()
    expect(canvas.queryByRole('region', { name: 'Preparation' })).toBeNull()
    expect(card(canvasElement, 'Commands')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(await canvas.findByRole('button', { name: 'Setup agent, running' })).toBeVisible()
  },
}

/** A long folder, path, line and name: each ends in an ellipsis, nothing pushes a card wider. */
export const LongText: Story = {
  args: { long: true },
  play: async ({ canvasElement }) => {
    const line = within(card(canvasElement, 'Commands')).getByText(/--reporter=verbose/)
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
    const key = within(card(canvasElement, 'Variables')).getByText(/QUEUE_CONNECTION_STRING/)
    expect(getComputedStyle(key).textOverflow).toBe('ellipsis')
  },
}

/** Hemera itself, set up from its own folder. */
export const Hemera: Story = {
  args: { folder: '~/work/hemera' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('~/work/hemera')).toBeVisible()
  },
}

/**
 * From the keyboard: the agent's chip, Accept all, then each card's answers in order — Accept,
 * Edit, Discuss, Decline — each with its ring; Edit puts the caret in the first field.
 */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const all = canvas.getByRole('button', { name: 'Accept all' })
    all.focus()
    await userEvent.tab()
    const repositories = card(canvasElement, 'Repositories')
    const accept = within(repositories).getByRole('button', { name: 'Accept' })
    expect(accept).toHaveFocus()
    await waitFor(() => {
      expect(getComputedStyle(accept, '::after').opacity).toBe('1')
    })
    await userEvent.tab()
    const edit = within(repositories).getByRole('button', { name: 'Edit' })
    expect(edit).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(within(repositories).getByRole('textbox', { name: 'Path of api' })).toHaveFocus()
    })
    await userEvent.keyboard('{Escape}')
  },
}

/** Asked for less movement: a card answered goes quiet at once, its answers gone without folding. */
export const ReducedMotion: Story = {
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <SetupFixture {...args} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const never = card(canvasElement, 'Never run')
    await userEvent.click(within(never).getByRole('button', { name: 'Accept' }))
    expect(within(never).getByRole('img', { name: 'Accepted' })).toBeVisible()
    expect(within(never).queryByRole('button', { name: 'Edit' })).toBeNull()
  },
}
