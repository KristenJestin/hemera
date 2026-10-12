import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LONG_TITLE } from './fixtures.ts'
import { tabTo } from './play.ts'
import { BuildingScreen } from './screen.tsx'

/**
 * The Building page of #149, recommended: the spine of requirements in the middle, each with its
 * tasks and its proofs, and a rail that says top to bottom what happens (the Building card: the
 * percentage, the line of what happens now and next, who works beside the Builder, the two
 * measures and the time, the phases), the services, then one quiet line each for what no one
 * needs to watch — the checks, the changes, the journal — and the mission's own things. The needs
 * stand above the page, one row each, unfolded on demand. Nothing is open that does not call.
 */
const meta = {
  title: 'Explorations/Building/Building',
  component: BuildingScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'working',
    onOpenTask: fn(),
    onOpenDiff: fn(),
    onService: fn(),
    onRevoke: fn(),
  },
} satisfies Meta<typeof BuildingScreen>

export default meta
type Story = StoryObj<typeof meta>

const cardOf = (canvasElement: HTMLElement): HTMLElement =>
  within(canvasElement).getByRole('region', { name: /^Building/ })

/**
 * Halfway, at rest: the percentage counts the tasks done and verified only; the requirements with
 * a task at work stand open, the others are one line; checks, changes and journal are one quiet
 * line each.
 */
export const Working: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = within(cardOf(canvasElement))
    await expect(card.getByRole('status')).toHaveTextContent(/T8/)
    await expect(
      card.getByRole('img', { name: /^28% of the tasks done and verified/ }),
    ).toBeVisible()
    await expect(card.getByText('6 of 21')).toBeVisible()
    await expect(card.getByText('2 of 9')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /R4 / })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(canvas.getByRole('button', { name: /R1 / })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(canvas.getByRole('button', { name: /^Checks/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(canvas.getByRole('list', { name: 'Services' })).toBeVisible()
  },
}

/** Every task state, and every proof: done verified, done not verified, waiting, blocked, skipped. */
export const TaskStates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /R3 / }))
    await userEvent.click(canvas.getByRole('button', { name: /R7 / }))
    for (const state of [
      'Done',
      'Done, not verified',
      'Running',
      'Waiting for you',
      'Blocked',
      'Skipped',
      'To do',
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one state after the other, each in its own fold
      await waitFor(() => {
        expect(canvas.getAllByRole('img', { name: state }).length).toBeGreaterThan(0)
      })
    }
    await expect(canvas.getAllByRole('img', { name: 'To re-run' }).length).toBeGreaterThan(0)
    await expect(canvas.getAllByRole('img', { name: /^Red recorded at/ }).length).toBeGreaterThan(0)
  },
}

/** Just launched: each scenario's red being recorded, nothing done yet, nothing running beside. */
export const JustLaunched: Story = {
  args: { moment: 'starting' },
  play: async ({ canvasElement }) => {
    const card = within(cardOf(canvasElement))
    await expect(card.getByRole('status')).toHaveTextContent(/records each scenario’s red/)
    await expect(card.getByRole('img', { name: /^0%/ })).toBeVisible()
    await expect(within(canvasElement).queryByRole('list', { name: 'Services' })).toBeNull()
  },
}

/** The needs on top: one row each — a permission, a decision with its amendment, an error after three failures, something missing, a scenario that already passes, a red that differs. */
export const NeedsOnTop: Story = {
  args: { moment: 'needs' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('T11 cannot keep the amounts unrounded as written')).toBeVisible()
    await expect(canvas.getByText('T12 failed three times')).toBeVisible()
    await expect(canvas.getByText('S7 already passes before its code')).toBeVisible()
    await expect(canvas.getByText('BILLING_EXPORT_BUCKET is not set in web')).toBeVisible()
    await expect(canvas.getAllByRole('img', { name: 'Needs you' }).length).toBeGreaterThan(0)
  },
}

/** A red different from Planning's, unfolded: both outputs, one under the other, then the choices. */
export const RedDiffers: Story = {
  args: { moment: 'needs' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const answers = canvas.getAllByRole('button', { name: 'Answer here' })
    await userEvent.click(answers.at(-1)!)
    const outputs = await waitFor(() => canvas.getByRole('list', { name: 'Outputs to compare' }))
    await expect(within(outputs).getAllByRole('listitem')).toHaveLength(2)
    await expect(canvas.getByRole('button', { name: /Keep the new failure/ })).toBeVisible()
  },
}

/** A scenario that already passes, unfolded: its three choices. */
export const ScenarioAlreadyPasses: Story = {
  args: { moment: 'needs' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const answers = canvas.getAllByRole('button', { name: 'Answer here' })
    await userEvent.click(answers.at(-2)!)
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Mark S7 as proven/ })).toBeVisible()
    })
    await expect(canvas.getByRole('button', { name: 'Rewrite S7 so it fails first' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Back to Planning on S7' })).toBeVisible()
  },
}

/** A refusal said as a need: the budget spent, an agent's limit reached; the budget line calls. */
export const BudgetSpent: Story = {
  args: { moment: 'refused' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/budget is spent: \$40 of \$40/)).toBeVisible()
    await expect(canvas.getByText(/usage limit is reached until 14:00/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Budget/ })).toHaveTextContent('$40.00 of $40')
  },
}

/** An intermediate check failed: the checks' line calls and opens, the failure's output under it. */
export const CheckFailed: Story = {
  args: { moment: 'checkFailed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^Checks/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(canvas.getByText(/Unable to find role="progressbar"/)).toBeVisible()
  },
}

/** A repository changed outside Hemera: the header's mark, and the changes open on it. */
export const ChangedOutsideHemera: Story = {
  args: { moment: 'outside' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^Changes/ })).toHaveTextContent(
      'web changed outside Hemera',
    )
    await expect(
      canvas.getAllByRole('img', { name: /changed outside Hemera/i }).length,
    ).toBeGreaterThan(1)
    await userEvent.click(canvas.getByRole('button', { name: 'Diff of web' }))
    await waitFor(() => {
      expect(canvas.getByRole('region', { name: 'Diff' })).toBeVisible()
    })
  },
}

/** A helper with no activity: its chip says so; nobody stops it by hand, so there is no ×. */
export const HelperStuck: Story = {
  args: { moment: 'stuck' },
  play: async ({ canvasElement }) => {
    const chips = within(canvasElement).getByRole('list', { name: 'Working beside the Builder' })
    await expect(within(chips).getAllByRole('listitem')).toHaveLength(3)
    await expect(within(chips).queryByRole('button', { name: /Stop|×/ })).toBeNull()
  },
}

/**
 * The end phases: the tasks done, the documentation written, the final checks in full, the
 * reviewers at work, and the special tasks `RV1…` apart, counted apart.
 */
export const EndPhases: Story = {
  args: { moment: 'endPhases' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Special tasks' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Checks/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    const card = within(cardOf(canvasElement))
    await expect(card.getByRole('img', { name: /^100%/ })).toBeVisible()
    await expect(card.getByRole('listitem', { name: 'Final checks' })).toHaveTextContent('5 of 7')
  },
}

/** Building · round 2: the round's points first, the requirements folded under them. */
export const RoundTwo: Story = {
  args: { moment: 'round' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(cardOf(canvasElement)).toHaveAccessibleName('Building · round 2')
    await expect(canvas.getByRole('region', { name: 'Round 2' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Requirements/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}

/** The journal unfolded: its meaningful events only, the newest first. */
export const JournalOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Journal/ }))
    const journal = await waitFor(() => canvas.getByRole('list', { name: 'Journal' }))
    await expect(within(journal).getAllByRole('listitem')[0]).toHaveTextContent('10:58')
  },
}

/** What was allowed for this mission, unfolded: each grant in words, who, when, how often, and Revoke. */
export const AllowedForThisMission: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Allowed for this mission/ }))
    const grants = await waitFor(() =>
      canvas.getByRole('list', { name: 'Allowed for this mission' }),
    )
    await expect(within(grants).getByText(/used 4 times/)).toBeVisible()
    await userEvent.click(within(grants).getAllByRole('button', { name: /^Revoke/ })[0]!)
    await expect(args.onRevoke).toHaveBeenCalledWith('g1')
  },
}

/** A task opened from its row: a sheet over the page, the trail `ACME-12 › Building › T8`. */
export const TaskOpened: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /T8 / }))
    await expect(args.onOpenTask).toHaveBeenCalledWith('T8')
    await waitFor(() => {
      expect(canvas.getByRole('region', { name: /^T8 · / })).toBeVisible()
    })
    await expect(canvas.getByRole('navigation', { name: 'Where you are' })).toHaveTextContent(
      /ACME-12.*Building.*T8/,
    )
  },
}

/** The first read on its way: the rows of known shape are skeletons, the percentage waits. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('list', { name: 'Requirements' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    await expect(within(cardOf(canvasElement)).queryByRole('img', { name: /%/ })).toBeNull()
  },
}

/** Long text in every field: the title, the line of what happens, a requirement, a task, the branch, the Workspace. */
export const LongText: Story = {
  args: { moment: 'long', title: LONG_TITLE },
  play: async ({ canvasElement }) => {
    const base = canvasElement.querySelector<HTMLElement>('[data-base]')!
    await expect(base.scrollWidth).toBeLessThanOrEqual(base.clientWidth)
  },
}

/**
 * From the keyboard: Tab reaches a requirement, Enter folds it; a task takes Enter and its view the
 * focus; Escape closes it and gives the focus back to the row.
 */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const requirement = canvas.getByRole('button', { name: /R4 / })
    await tabTo(requirement)
    await expect(requirement.matches(':focus-visible')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect(requirement).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{Enter}')
    const row = await waitFor(() => canvas.getByRole('button', { name: /T8 / }))
    await tabTo(row)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(canvas.getByRole('heading', { name: /^T8/, level: 2 })).toHaveFocus()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(row).toHaveFocus()
    })
  },
}
