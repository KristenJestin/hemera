import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LONG_TITLE } from './building-fixtures.ts'
import { tabTo } from './building-play.ts'
import { BuildingScreen } from './building-screen-fixture.tsx'

/**
 * The Building page of #149, recommended: the spine of requirements in the middle, each with its
 * tasks and its proofs, and a rail that says top to bottom what happens — the stage card common to
 * every stage (the face, the line of what happens or waits, the progress line, the chips of what
 * works: the agents beside the Builder, and nothing else) — then one quiet line each for what no
 * one needs to watch — the services, the checks, the changes, the journal — and the mission's own
 * things. The needs stand above the page, one row each, unfolded on demand.
 */
const meta = {
  title: 'Surfaces/Building',
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
    await expect(card.getByText('6 of 21 tasks done · 2 of 9 requirements proven')).toBeVisible()
    // The card's chips are the agents only: the helper, not the services.
    await expect(card.getByText('Helper')).toBeVisible()
    await expect(card.queryByText('api')).toBeNull()
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
    await expect(canvas.getByRole('button', { name: /^Services/ })).toHaveTextContent(
      'api, web running · 2 to start',
    )
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
    await expect(card.getByText('3 of 14 reds recorded')).toBeVisible()
    // Nothing runs yet: the services' line says how many wait to be started.
    await expect(
      within(canvasElement).getByRole('button', { name: /^Services/ }),
    ).toHaveTextContent('2 to start')
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

/**
 * The services, one folded line among the rail's folds: "api running · 2 to start". Unfolded, one
 * row per service — its mark, its address while it runs or its command, Stop or Start — and last
 * one quiet action, "Start a service from the catalogue…", whose picker the search narrows.
 * Choosing one starts it for this mission only.
 */
export const Services: Story = {
  args: { moment: 'services' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    // A service is not an agent: no chip of it on the card.
    await expect(within(cardOf(canvasElement)).queryByRole('button', { name: /^api,/ })).toBeNull()
    const line = canvas.getByRole('button', { name: /^Services/ })
    await expect(line).toHaveTextContent('api running · 2 to start')
    await expect(line).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(line)
    const rows = await waitFor(() => canvas.getByRole('list', { name: 'Services' }))
    await expect(within(rows).getByText('http://localhost:3012')).toBeVisible()
    await userEvent.click(within(rows).getByRole('button', { name: 'Stop api' }))
    await expect(args.onService).toHaveBeenCalledWith('api', 'stop')
    await userEvent.click(within(rows).getByRole('button', { name: 'Start worker' }))
    await expect(args.onService).toHaveBeenCalledWith('worker', 'start')
    await userEvent.click(
      canvas.getByRole('button', { name: 'Start a service from the catalogue…' }),
    )
    const body = within(document.body)
    const search = await waitFor(() => body.getByRole('combobox', { name: 'Search the catalogue' }))
    await expect(search).toHaveFocus()
    await userEvent.type(search, 'mail')
    const list = body.getByRole('listbox', { name: 'The catalogue' })
    await expect(within(list).getAllByRole('option')).toHaveLength(2)
    await userEvent.click(within(list).getByRole('option', { name: /^mailpit/ }))
    await expect(args.onService).toHaveBeenCalledWith('mailpit', 'start')
    await waitFor(() => expect(body.queryByRole('listbox')).toBeNull())
  },
}

/**
 * The catalogue's picker open on twenty services, the search narrowing it as one types: under its
 * action when there is room, else above it, always against the fold's edge and as wide as it.
 */
export const CataloguePicker: Story = {
  args: { moment: 'services' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Services/ }))
    await userEvent.click(
      await waitFor(() =>
        canvas.getByRole('button', { name: 'Start a service from the catalogue…' }),
      ),
    )
    const body = within(document.body)
    const list = await waitFor(() => body.getByRole('listbox', { name: 'The catalogue' }))
    await expect(within(list).getAllByRole('option')).toHaveLength(20)
    const search = body.getByRole('combobox', { name: 'Search the catalogue' })
    await userEvent.type(search, 'compose up m')
    await expect(within(list).getAllByRole('option')).toHaveLength(4)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(args.onService).toHaveBeenCalledWith('minio', 'start')
    const action = canvas.getByRole('button', { name: 'Start a service from the catalogue…' })
    await userEvent.click(action)
    await userEvent.type(
      await waitFor(() => body.getByRole('combobox', { name: 'Search the catalogue' })),
      'mail',
    )
    // It hangs against its action's edge, as wide as the fold: never shifted onto the spine.
    const panel = body.getByRole('dialog', { name: 'Start a service from the catalogue' })
    const fold = within(canvasElement)
      .getByRole('list', { name: 'Services' })
      .getBoundingClientRect()
    await waitFor(() => {
      const box = panel.getBoundingClientRect()
      expect(Math.abs(box.left - action.getBoundingClientRect().left)).toBeLessThanOrEqual(1)
      expect(box.right).toBeLessThanOrEqual(fold.right + 1)
    })
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
    const card = within(cardOf(canvasElement))
    await expect(card.getByText('Helper')).toBeVisible()
    await expect(card.getByText('Documenter')).toBeVisible()
    await expect(card.queryByRole('button', { name: /Stop|×/ })).toBeNull()
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
    await expect(card.getByText('Final checks')).toBeVisible()
    await expect(card.getByText('5 of 7')).toBeVisible()
    // A check is not an agent: the one under way is said in the Checks fold, not on the card.
    await expect(card.queryByText('web · lint')).toBeNull()
    await expect(canvas.getByRole('button', { name: /^Checks/ })).toHaveTextContent(
      'web · lint running',
    )
  },
}

/** Building · round 2: the round's points first, the requirements folded under them. */
export const RoundTwo: Story = {
  args: { moment: 'round' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = within(cardOf(canvasElement))
    await expect(card.getByText('Round 2')).toBeVisible()
    await expect(card.getByText('1 of 4 points done')).toBeVisible()
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
    await expect(within(cardOf(canvasElement)).getByRole('status')).toHaveTextContent(
      'Reading where Building stands',
    )
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
