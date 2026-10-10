import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { PROPOSALS } from '../../blocks/setup/setup-fixtures.ts'
import type { SetupCardEntry } from './project-setup.tsx'
import { SetupFixture } from './setup-fixture.tsx'
import { ProjectTasks, SetupTask, type SetupTaskProps } from './setup-task.tsx'

/**
 * A Project's setup as a task of the Project, launched whenever the user chooses: what the setup agent
 * proposes, a card per part, unfolded in place, and the answers to each — Accept, Edit in place,
 * Discuss, Decline — or to all at once. Each story is the page full-bleed under the window's
 * header; the toolbar's viewports give its two sizes.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Project tasks/Setup',
  component: SetupFixture,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SetupFixture>

export default meta
type Story = StoryObj<typeof meta>

const card = (canvasElement: HTMLElement, name: string): HTMLElement =>
  within(canvasElement).getByRole('region', { name })

/** Every card proposed: Accept all on the task's line, beside the agent's chip, done. */
export const Proposed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('region', { name: 'Tasks' })).toBeVisible()
    for (const name of ['Repositories', 'Commands', 'Preparation', 'Variables', 'Never run']) {
      expect(card(canvasElement, name)).toBeVisible()
    }
    expect(
      canvas.getByRole('button', { name: /^Setup agent, done(, waits for you)?$/ }),
    ).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Accept all' })).toBeVisible()
  },
}

/** The agent's chip opens its glance: who it is, where it stands, and the step it is on. */
export const AgentGlance: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: /^Setup agent, done(, waits for you)?$/ }),
    )
    const glance = await within(document.body).findByRole('dialog', { name: /^Setup/ })
    // The glance rises in: what it says is read once it has.
    await waitFor(() => expect(within(glance).getByText('Agent · Claude Code')).toBeVisible())
    expect(within(glance).getByText('Proposed the setup of 5 parts')).toBeVisible()
  },
}

/** The agent waits for a free slot: its glyph on the task, nothing to review yet. */
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
    for (const name of ['Repositories', 'Commands', 'Preparation', 'Variables', 'Never run']) {
      expect(card(canvasElement, name)).toHaveAttribute('aria-busy', 'true')
    }
    // Nothing to review while every card is still read.
    expect(canvas.queryByRole('button', { name: 'Accept all' })).toBeNull()
    expect(canvas.queryByRole('button', { name: /^(Review|Hide)$/ })).toBeNull()
  },
}

/** The agent at work: its chip running; the cards arrive in batches, the others their own shape. */
export const Reading: Story = {
  args: { agent: 'working', arriving: ['preparation', 'variables', 'never'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The batches arrive on a timer started with the story, which a slow machine may have passed,
    // in part or whole, before the play begins. What holds whenever it is read, in one go: the
    // cards still read are the last batches, in order, and while one is the agent is running.
    const busy = ['Preparation', 'Variables', 'Never run'].map(
      (name) => card(canvasElement, name).getAttribute('aria-busy') === 'true',
    )
    expect(busy).toEqual(busy.toSorted())
    const running = canvas.queryByRole('button', {
      name: /^Setup agent, running(, waits for you)?$/,
    })
    if (busy.includes(true)) expect(running).toBeVisible()
    expect(
      within(card(canvasElement, 'Commands')).getByRole('button', { name: 'Accept' }),
    ).toBeVisible()
    await waitFor(
      () => {
        expect(card(canvasElement, 'Never run')).toHaveAttribute('aria-busy', 'false')
      },
      { timeout: 5000 },
    )
    expect(
      await canvas.findByRole('button', { name: /^Setup agent, done(, waits for you)?$/ }),
    ).toBeVisible()
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

/** Every card answered: the cards quiet with their check, every mark filled; the page then lets it go. */
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
    expect(canvas.getByRole('img', { name: '5 of 5 proposals answered' })).toBeVisible()
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
 * The agent stopped: its chip says so, its glance why, with Try again; the cards it had written
 * stay, the others are not drawn.
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
    // Why it stopped is the chip's glance's to say.
    await userEvent.click(canvas.getByRole('button', { name: /^Setup agent, failed/ }))
    const glance = await within(document.body).findByRole('dialog')
    await waitFor(() =>
      expect(within(glance).getByText(/usage limit of this account/)).toBeVisible(),
    )
    expect(
      canvas.getByRole('button', { name: /^Setup agent, failed(, waits for you)?$/ }),
    ).toBeVisible()
    expect(canvas.queryByRole('region', { name: 'Preparation' })).toBeNull()
    expect(card(canvasElement, 'Commands')).toBeVisible()
    await userEvent.click(within(glance).getByRole('button', { name: 'Try again' }))
    expect(
      await canvas.findByRole('button', { name: /^Setup agent, running(, waits for you)?$/ }),
    ).toBeVisible()
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
    expect(card(canvasElement, 'Commands')).toBeVisible()
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

const entry = (kind: SetupCardEntry['kind'], state: 'proposed' | 'accepted'): SetupCardEntry => ({
  kind,
  status: { state },
  proposal: PROPOSALS[kind],
})

const CARDS: readonly SetupCardEntry[] = [
  entry('repositories', 'accepted'),
  entry('commands', 'proposed'),
  entry('preparation', 'proposed'),
]

const HANDLERS = {
  onAcceptAll: fn(),
  onRetry: fn(),
  onAccept: fn(),
  onDraft: fn(),
  onDecline: fn(),
  onSave: fn(),
  onCancel: fn(),
  onSend: fn(),
}

/** The task alone, on a page's column, holding whether its details are open. */
function Held(args: SetupTaskProps) {
  const [open, setOpen] = useState(args.open)
  return (
    <div className="mx-auto flex w-full max-w-page flex-col p-8">
      <ProjectTasks>
        <SetupTask {...args} open={open} onOpenChange={setOpen} />
      </ProjectTasks>
    </div>
  )
}

const BASE: SetupTaskProps = {
  project: 'Acme',
  agent: 'done',
  about: 'Agent · Claude Code · opus',
  messages: [
    'Read the repositories, their package.json and the README',
    'Found pnpm workspaces in api and web',
    'Proposed the commands, the preparation and the variables',
  ],
  startedAt: 0,
  endedAt: 42_000,
  cards: CARDS,
  open: false,
  onOpenChange: fn(),
  ...HANDLERS,
}

const chipOf = (canvasElement: HTMLElement, state: string): HTMLElement =>
  within(canvasElement).getByRole('button', {
    name: new RegExp(`^Setup agent, ${state}(, waits for you)?$`),
  })

/** The agent reads the Project: its chip; its menu, what it does and its last messages, and ⓘ. */
export const TaskReading: Story = {
  render: () => (
    <Held {...BASE} agent="working" startedAt={Date.now() - 12_000} endedAt={null} cards={[]} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chip = canvas.getByRole('button', { name: 'Setup agent, running' })
    expect(chip.querySelector('[data-calls]')).toBeNull()
    await userEvent.click(chip)
    const menu = await within(document.body).findByRole('dialog', { name: 'Setup agent' })
    await waitFor(() => expect(within(menu).getByText('Agent · Claude Code · opus')).toBeVisible())
    expect(within(menu).getByText('Found pnpm workspaces in api and web')).toBeVisible()
    expect(within(menu).queryByRole('button', { name: /^Review/ })).toBeNull()
    expect(within(menu).getByRole('button', { name: 'Details' })).toBeVisible()
  },
}

/**
 * Proposals wait: the chip wears the dot of what waits for you, and nothing beside it. Its menu's
 * main button is what it asks, "Review 2 proposals": the details, as ⓘ opens them, where the
 * proposals are answered. The page does not move.
 */
export const TaskProposed: Story = {
  render: () => <Held {...BASE} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tasks = canvas.getByRole('region', { name: 'Tasks' })
    expect(within(tasks).getAllByRole('button')).toHaveLength(1)
    const chip = canvas.getByRole('button', { name: 'Setup agent, done, waits for you' })
    expect(chip.querySelector('[data-calls]')).not.toBeNull()
    await userEvent.click(chip)
    const menu = await within(document.body).findByRole('dialog', { name: 'Setup agent' })
    await userEvent.click(within(menu).getByRole('button', { name: 'Review 2 proposals' }))
    const details = await within(document.body).findByRole('dialog', { name: 'Setup of Acme' })
    // The dialog fades in from nothing: what it holds is visible once its entrance has played.
    await waitFor(() => {
      expect(within(details).getByRole('region', { name: 'Commands' })).toBeVisible()
    })
    expect(within(details).getByText('Found pnpm workspaces in api and web')).toBeVisible()
    await userEvent.click(within(details).getByRole('button', { name: 'Accept all' }))
    expect(HANDLERS.onAcceptAll).toHaveBeenCalled()
    // Nothing unfolded on the page itself.
    expect(within(tasks).queryByRole('region', { name: 'Commands' })).toBeNull()
  },
}

/** The agent stopped: the dot; its menu says why, with Try again, and ⓘ. */
export const TaskStopped: Story = {
  render: () => <Held {...BASE} agent="failed" failure="Claude Code is not signed in" cards={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tasks = canvas.getByRole('region', { name: 'Tasks' })
    expect(within(tasks).queryByText('Claude Code is not signed in')).toBeNull()
    await userEvent.click(chipOf(canvasElement, 'failed'))
    const menu = await within(document.body).findByRole('dialog', { name: 'Setup agent' })
    await waitFor(() =>
      expect(within(menu).getByText('Claude Code is not signed in')).toBeVisible(),
    )
    await userEvent.click(within(menu).getByRole('button', { name: 'Try again' }))
    expect(HANDLERS.onRetry).toHaveBeenCalled()
  },
}
