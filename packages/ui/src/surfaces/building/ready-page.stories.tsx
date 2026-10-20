import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LONG_TITLE } from './building-fixtures.ts'
import { tabTo } from './building-play.ts'
import { ReadyScreen } from './building-screen-fixture.tsx'

/**
 * The Ready page of #149, recommended: the frozen Spec in summary in the middle, and at the top of
 * the rail the stage card common to every stage — the face, the line of where the launch stands,
 * the progress line, the step that runs as a chip — with right under it what the pre-launch check
 * found (one line per thing moved, unfolded on demand to the agent's verdict) and its choices, the
 * model the Planner recommends with its reason, and the preparation's steps. Launch sits in the
 * header while it can be pressed. The mission's dependencies, grants and budget end the rail.
 */
const meta = {
  title: 'Surfaces/Ready',
  component: ReadyScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'frozen',
    onLaunch: fn(),
    onLaunchAnyway: fn(),
    onBackToPlanning: fn(),
    onCheckAgain: fn(),
    onModel: fn(),
    onRevoke: fn(),
  },
} satisfies Meta<typeof ReadyScreen>

export default meta
type Story = StoryObj<typeof meta>

/** The card's line of where the launch stands: its last status, after the loading face's own. */
const statusOf = (canvasElement: HTMLElement): HTMLElement =>
  within(within(canvasElement).getByRole('region', { name: 'Ready' }))
    .getAllByRole('status')
    .at(-1)!

/** Frozen, nothing checked yet: Launch in the header, the model and its reason, three steps to do. */
export const Frozen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(statusOf(canvasElement)).toHaveTextContent(
      'Ready to launch · frozen yesterday at 17:02',
    )
    await expect(canvas.getByRole('button', { name: 'Launch' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Model of the Builder/ })).toBeVisible()
    const card = within(canvas.getByRole('region', { name: 'Ready' }))
    await expect(card.getByText('Launch')).toBeVisible()
    await expect(card.getByText('not checked yet')).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Requirements' }).children).toHaveLength(9)
  },
}

/** Launch pressed: the check starts in the card, and Launch leaves the header. */
export const Launching: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Launch' }))
    await expect(args.onLaunch).toHaveBeenCalled()
    await waitFor(() => {
      expect(statusOf(canvasElement)).toHaveTextContent('Checking what moved since the Freeze')
    })
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: 'Launch' })).toBeNull()
    })
  },
}

/** Blocked by a dependency not Done: said in the header and the card, and no Launch at all. */
export const BlockedByDependency: Story = {
  args: { moment: 'blocked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(statusOf(canvasElement)).toHaveTextContent('Blocked by ACME-10')
    await expect(canvas.queryByRole('button', { name: 'Launch' })).toBeNull()
    await expect(canvas.getByRole('button', { name: /Dependencies/ })).toHaveTextContent(
      /ACME-10 not done/,
    )
  },
}

/** The check runs: the face's loading state and what it does, no choice to make. */
export const Checking: Story = {
  args: { moment: 'checking' },
  play: async ({ canvasElement }) => {
    await expect(statusOf(canvasElement)).toHaveTextContent('Checking what moved')
    await expect(within(canvasElement).queryByRole('button', { name: /Launch/ })).toBeNull()
  },
}

/** Nothing moved: the launch goes on without asking, the preparation's steps under it. */
export const NothingMoved: Story = {
  args: { moment: 'clear' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(statusOf(canvasElement)).toHaveTextContent('Nothing moved since the Freeze')
    const preparation = canvas.getByRole('list', { name: 'Preparation' })
    await expect(within(preparation).getAllByRole('listitem')).toHaveLength(7)
    await expect(canvas.queryByRole('button', { name: 'Launch anyway' })).toBeNull()
  },
}

/** Things moved, mechanically, but the Spec holds: one line each, and the agent's verdict unfolded. */
export const MovedStillHolds: Story = {
  args: { moment: 'moved' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const moved = canvas.getByRole('list', { name: 'What moved since the Freeze' })
    await expect(within(moved).getAllByRole('listitem')).toHaveLength(3)
    await userEvent.click(within(moved).getByRole('button', { name: /invoices\.query\.ts/ }))
    await waitFor(() => {
      expect(canvas.getByText(/Only a column renamed/)).toBeVisible()
    })
  },
}

/**
 * Outdated: a moved file breaks the Spec. It comes first in the list; Back to Planning is the
 * primary choice, Launch anyway the other, both in the card.
 */
export const Outdated: Story = {
  args: { moment: 'outdated' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(statusOf(canvasElement)).toHaveTextContent('The Spec no longer holds')
    const moved = canvas.getByRole('list', { name: 'What moved since the Freeze' })
    await expect(within(moved).getAllByRole('button')[0]).toHaveTextContent('export.query.ts')
    await userEvent.click(canvas.getByRole('button', { name: 'Back to Planning' }))
    await expect(args.onBackToPlanning).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Launch anyway' }))
    await expect(args.onLaunchAnyway).toHaveBeenCalled()
  },
}

/** The remote could not be fetched: when it last was, what is known, Check again or Launch anyway. */
export const NotFetched: Story = {
  args: { moment: 'unfetched' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(statusOf(canvasElement)).toHaveTextContent('Not fetched since Monday at 18:20')
    await expect(canvas.getByRole('button', { name: 'Check again' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Launch anyway' })).toBeVisible()
  },
}

/** The agent did not answer: what moved without a verdict, Check again or Launch anyway. */
export const AgentDidNotAnswer: Story = {
  args: { moment: 'silent' },
  play: async ({ canvasElement }) => {
    await expect(statusOf(canvasElement)).toHaveTextContent('The agent did not answer')
    await expect(within(canvasElement).getByRole('button', { name: 'Check again' })).toBeVisible()
  },
}

/** The check expired: something moved since. Check again runs it anew. */
export const CheckExpired: Story = {
  args: { moment: 'expired' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(statusOf(canvasElement)).toHaveTextContent('Something moved since the check')
    await expect(canvas.queryByRole('button', { name: 'Launch anyway' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Check again' }))
    await expect(args.onCheckAgain).toHaveBeenCalled()
    await waitFor(() => {
      expect(statusOf(canvasElement)).toHaveTextContent('Checking what moved')
    })
  },
}

/** The budget unfolded: each limit of the mission, then the usage, marked as an estimate. */
export const BudgetEstimated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = canvas.getByRole('button', { name: /^Budget/ })
    await expect(line).toHaveTextContent('0 of 8 launches')
    await userEvent.click(line)
    await waitFor(() => {
      expect(canvas.getByText('≈ $3.10 · 900 k tokens')).toBeVisible()
    })
    await expect(canvas.getByText('0 of 30 tries')).toBeVisible()
    await expect(canvas.getByText(/^Estimated:/)).toBeVisible()
  },
}

/** The check could not finish: why, in words, and Check again; nothing launches. */
export const CheckFailed: Story = {
  args: { moment: 'failed' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(statusOf(canvasElement)).toHaveTextContent('The check could not finish')
    await expect(canvas.getByText(/could not be read/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Launch anyway' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Launch' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Check again' }))
    await expect(args.onCheckAgain).toHaveBeenCalled()
  },
}

/** A dependency went back from Done during the check: no launch, nothing to press. */
export const DependencyNotDone: Story = {
  args: { moment: 'dependency' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(statusOf(canvasElement)).toHaveTextContent('ACME-9 is not done')
    await expect(canvas.queryByRole('button', { name: /Launch/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Check again' })).toBeNull()
  },
}

/** Preparing: the recipe's steps and their state, the step that runs turning. */
export const Preparing: Story = {
  args: { moment: 'preparing' },
  play: async ({ canvasElement }) => {
    const preparation = within(canvasElement).getByRole('list', { name: 'Preparation' })
    await expect(within(preparation).getByRole('img', { name: 'Running' })).toBeInTheDocument()
    // The step under way is marked in its list; the card's chips are for agents only.
    const card = within(canvasElement).getByRole('region', { name: /^Ready/ })
    await expect(card.querySelector('[data-live-chip]')).toBeNull()
  },
}

/** A step failed: its line says why, and the need on top offers Retry, unfolded. */
export const PreparationFailed: Story = {
  args: { moment: 'preparationFailed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/no access to the private registry/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeVisible()
  },
}

/** The user changed the model: "Your choice", and the Planner's recommendation kept in words. */
export const ModelChanged: Story = {
  args: { moment: 'overridden' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Your choice for Building')).toBeVisible()
    await expect(canvas.getByText(/The Planner recommended Opus/)).toBeVisible()
  },
}

/** Long text in every field: the title, the goal, a requirement, the reason, a path. */
export const LongText: Story = {
  args: { moment: 'long', title: LONG_TITLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { level: 1 })
    await expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
    const main = canvasElement.querySelector<HTMLElement>('[data-base]')!
    await expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
  },
}

/** From the keyboard: Tab reaches Launch, which wears its focus ring; Enter starts the check. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const launch = canvas.getByRole('button', { name: 'Launch' })
    await tabTo(launch)
    await expect(launch.matches(':focus-visible')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(statusOf(canvasElement)).toHaveTextContent('Checking')
    })
  },
}
