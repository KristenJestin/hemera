import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { STORIES as SPEC_STORIES } from '../spec/spec-fixtures.ts'
import {
  ACCEPTED,
  BLOCKED,
  BUILDING,
  FINAL_CHECKS,
  FINAL_CHECKS_RED,
  GETTING_READY,
  NOW,
  PAUSED,
  READY_TO_ACCEPT,
  STOPPED,
  THREE_RED,
  YOURS,
} from './build-fixtures.ts'
import { BuildView } from './build-view.tsx'

/**
 * The build view (issue #116): the head with the phase in plain words and what can be done with
 * the build, the agent's approach, then the stories of the frozen Spec — each with the words it
 * was written with, the criteria it is judged on, and where it stands — with the build's tasks
 * unfolded under them, one stage at a time, and the final checks of the whole Spec. One story per
 * state of the build `ATL-7`; the view in its Session, beside the chat, is
 * `Surfaces/Session/Build`.
 */
const meta = {
  title: 'Blocks/Build/BuildView',
  component: BuildView,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
  args: {
    build: BUILDING,
    now: NOW,
    // The stories of the frozen Spec, which the build's own take their words from.
    stories: SPEC_STORIES,
    specOpen: false,
    onToggleSpec: fn(),
    onPause: fn(),
    onResume: fn(),
    onAccept: fn(),
    onStop: fn(),
    onTaskDone: fn(),
    onTaskSkip: fn(),
    onDismissBlocker: fn(),
    onSelect: fn(),
  },
  argTypes: {
    build: { control: 'object', description: 'The build, as the engine answers it.' },
    now: { control: 'text', description: 'The caller’s now, every time is said from.' },
    stories: { control: 'object', description: 'The stories of the frozen Spec, its own words.' },
    selected: {
      control: 'text',
      description: 'The task that is unfolded, by its build task id; for a caller that keeps it.',
    },
    specOpen: { control: 'boolean', description: 'Whether the frozen Spec is open beside it.' },
    onToggleSpec: { action: 'spec toggled' },
    onPause: { action: 'paused' },
    onResume: { action: 'resumed' },
    onAccept: { action: 'accepted' },
    onStop: { action: 'stopped' },
    onTaskDone: { action: 'task done' },
    onTaskSkip: { action: 'task skipped' },
    onDismissBlocker: { action: 'blocker dismissed' },
    onSelect: { action: 'task chosen' },
  },
} satisfies Meta<typeof BuildView>

export default meta

type Story = StoryObj<typeof meta>

/** The stories of the Spec as the view draws them, in the Spec's own order. */
function storiesList(canvasElement: HTMLElement): HTMLElement {
  return within(canvasElement).getByRole('list', { name: 'Stories of ATL-7' })
}

/** The one story of the Spec, by its title, with everything drawn under it. */
function storyOf(canvasElement: HTMLElement, title: string): HTMLElement {
  return within(storiesList(canvasElement)).getByRole('article', { name: title })
}

/**
 * Getting ready: the stories of the Spec with their words, T1 ready and the others waiting on it,
 * and a line that waits for the agent's approach — no task starts before it.
 */
export const GettingReady: Story = {
  args: { build: GETTING_READY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Getting ready')).toBeVisible()
    await expect(
      canvas.getByText("Waiting for the agent's approach: no task starts before it."),
    ).toBeVisible()
    await expect(storiesList(canvasElement).children).toHaveLength(2)
    await expect(storyOf(canvasElement, 'Export a month')).toHaveTextContent('to do')
    await expect(storyOf(canvasElement, 'Credit notes in the same file')).toHaveTextContent('to do')
    const one = storyOf(canvasElement, 'Export a month')
    await expect(within(one).getByRole('button', { name: /^T1\b/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(within(one).getByRole('button', { name: /^T1 / })).toHaveTextContent(
      'The invoice lines of the month',
    )
    await expect(
      within(storyOf(canvasElement, 'Credit notes in the same file')).getByRole('button', {
        name: 'Tasks · 1',
      }),
    ).toBeVisible()
  },
}

/**
 * Building: everything the panel holds at once — the phase, the stories with the words they were
 * written with and the criteria they are judged on, the task being worked on unfolded into its
 * stage, and the approach folded now that tasks started.
 */
export const Building: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Building')).toBeVisible()
    await expect(canvas.getByText('0 of 2 stories done')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'CSV invoice export' })).toBeVisible()
    const one = storyOf(canvasElement, 'Export a month')
    await expect(one).toHaveTextContent('in progress')
    await expect(within(one).getByText(/As an accountant closing a month/)).toBeVisible()
    await expect(within(one).getByRole('list', { name: 'Criteria of S1' })).toHaveTextContent(
      'An empty month downloads the header row only.',
    )
    // The task on the stage: its story is unfolded, and so is it.
    const on = within(one).getByRole('button', { name: /^T2\b/ })
    await expect(on).toHaveAttribute('aria-expanded', 'true')
    await expect(
      within(one).getByRole('region', { name: 'A CSV in the column order of the ledger' }),
    ).toBeVisible()
    // The approach: folded once tasks started, and it opens on the note.
    const approach = canvas.getByRole('button', { name: 'Approach' })
    await expect(approach).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(approach)
    await expect(await canvas.findByText(/the invoice query of/)).toBeVisible()
  },
}

/** The human task is ready: it is Yours, its stage unfolded with Done and Skip. */
export const Yours: Story = {
  args: { build: YOURS },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('region', { name: 'The file imports into the ledger' }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Done' }))
    await expect(args.onTaskDone).toHaveBeenCalledWith('bt-4')
  },
}

/** T2 came back after three red tries: its failures on top of its stage. */
export const ThreeRedTries: Story = {
  args: { build: THREE_RED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('group', { name: 'T2 came back to you after 3 red tries' }),
    ).toBeVisible()
  },
}

/**
 * The agent says T3 contradicts the Spec: T3 and T4 are blocked, T2 goes on; the blocker stands on
 * T3's story, and T4 says what it waits on.
 */
export const Blocked: Story = {
  args: { build: BLOCKED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('The agent says this task contradicts the Spec')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }))
    await expect(args.onDismissBlocker).toHaveBeenCalledWith('blocker-1')
    const one = storyOf(canvasElement, 'Export a month')
    await userEvent.click(within(one).getByRole('button', { name: 'Tasks · 3' }))
    await userEvent.click(within(one).getByRole('button', { name: /^T4 / }))
    await expect(canvas.getByText(/Waits on T3/)).toBeVisible()
  },
}

/** Paused: the band says nothing new starts, and Resume stands where Pause was. */
export const Paused: Story = {
  args: { build: PAUSED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Paused', { selector: 'span' })).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent(/nothing new starts/)
    await expect(canvas.queryByRole('button', { name: 'Pause' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Resume' }))
    await expect(args.onResume).toHaveBeenCalled()
  },
}

/** Final checks: every task done, the checks of the whole Spec drawn under the stories. */
export const FinalChecks: Story = {
  args: { build: FINAL_CHECKS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Final checks', { selector: 'span' })).toBeVisible()
    await expect(canvas.getByText('final checks on try 1 of 3')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Final checks' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Tries of the final checks' })).toBeVisible()
    await expect(storyOf(canvasElement, 'Export a month')).toHaveTextContent('done')
  },
}

/** Final checks red: the e2e failed its first try, and the agent is on its second. */
export const FinalChecksRed: Story = {
  args: { build: FINAL_CHECKS_RED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('final checks on try 2 of 3')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /^Try 1 of 3/ }))
    await expect(await canvas.findByText('exited with 1')).toBeVisible()
  },
}

/** Green and nothing waiting: Accept is offered, and it is the one thing to press. */
export const ReadyToAccept: Story = {
  args: { build: READY_TO_ACCEPT },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('final checks green')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Pause' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Accept' }))
    await expect(args.onAccept).toHaveBeenCalled()
  },
}

/** Accepted: over and readable; only the Spec button is left. */
export const Accepted: Story = {
  args: { build: ACCEPTED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent(/stay in the Workspace/)
    await expect(canvas.queryByRole('button', { name: 'Stop build' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Spec' })).toBeVisible()
  },
}

/** Stopped: over and readable, why it stopped said, T3 skipped with its reason on its row. */
export const Stopped: Story = {
  args: { build: STOPPED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('You stopped the build.')
    await expect(canvas.queryByRole('button', { name: 'Resume' })).toBeNull()
    const two = storyOf(canvasElement, 'Credit notes in the same file')
    await userEvent.click(within(two).getByRole('button', { name: 'Tasks · 1' }))
    await expect(within(two).getAllByRole('button', { name: /^T3\b/ })[0]).toHaveTextContent(
      'Skipped',
    )
  },
}

/**
 * The keyboard: the head's controls in order, Stop asking first and giving the focus back, then
 * the approach, then the fold of a story's tasks and the stage of a task.
 */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const spec = canvas.getByRole('button', { name: 'Spec' })
    spec.focus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Pause' })).toHaveFocus()
    await userEvent.tab()
    const stop = canvas.getByRole('button', { name: 'Stop build' })
    await expect(stop).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('dialog')).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(stop).toHaveFocus())
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Approach' })).toHaveFocus()
  },
}
