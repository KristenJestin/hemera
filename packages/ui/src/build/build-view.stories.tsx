import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

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
 * The build view (D10-12), alone: the head with the phase in plain words and what can be done
 * with the build, the agent's approach, the tasks grouped by state — what needs the user first —
 * and the stage of the one chosen. One story per state of the build `ATL-7` goes through; the
 * view in its Session, beside the chat, is `Surfaces/Session/Build`.
 */
const meta = {
  title: 'Blocks/Build/BuildView',
  component: BuildView,
  tags: ['autodocs'],
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
    selected: {
      control: 'text',
      description: 'The task on the stage, for a caller that keeps it.',
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

/** The names of the groups of the list, in the order they are drawn. */
function groupsOf(canvasElement: HTMLElement): string[] {
  const list = within(canvasElement).getByRole('navigation', { name: 'Tasks' })
  return within(list)
    .getAllByRole('group')
    .map((group) => group.getAttribute('aria-label') ?? '')
}

/**
 * Getting ready: the rows are there, T1 ready and the others waiting on it, and a line that waits
 * for the agent's approach — no task starts before it.
 */
export const GettingReady: Story = {
  args: { build: GETTING_READY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Getting ready')).toBeVisible()
    await expect(
      canvas.getByText("Waiting for the agent's approach: no task starts before it."),
    ).toBeVisible()
    await expect(groupsOf(canvasElement)).toEqual(['Ready, 1', 'Waiting, 3'])
    await expect(canvas.getByRole('button', { name: /^T2 .* after T1$/ })).toBeVisible()
  },
}

/**
 * Building: T1 done, T2 on its second try, T3 being checked and T4 waiting on both; the approach
 * folded now that tasks started, and T2 on the stage.
 */
export const Building: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Building')).toBeVisible()
    await expect(canvas.getByText('1 of 4 tasks done')).toBeVisible()
    await expect(groupsOf(canvasElement)).toEqual([
      'Working, 1',
      'Checking, 1',
      'Waiting, 1',
      'Done, 1',
    ])
    await expect(canvas.getByRole('button', { name: /^T2 / })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(canvas.getByRole('region', { name: 'Stage of T2' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Accept' })).toBeNull()
    await expect(canvas.getByRole('list', { name: 'Stories' })).toHaveTextContent('S1 · open')
    // The approach, folded once tasks started, opens on its note.
    await userEvent.click(canvas.getByRole('button', { name: 'Approach' }))
    await expect(await canvas.findByText(/the invoice query of/)).toBeVisible()
  },
}

/** The human task is ready: it is Yours, first in the list, on the stage with Done and Skip. */
export const Yours: Story = {
  args: { build: YOURS },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(groupsOf(canvasElement)[0]).toBe('Yours, 1')
    const stage = within(canvas.getByRole('region', { name: 'Stage of T4' }))
    await userEvent.click(stage.getByRole('button', { name: 'Done' }))
    await expect(args.onTaskDone).toHaveBeenCalledWith('bt-4')
  },
}

/** T2 came back after three red tries: its failures on top of its stage. */
export const ThreeRedTries: Story = {
  args: { build: THREE_RED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(groupsOf(canvasElement)[0]).toBe('Yours, 1')
    await expect(
      canvas.getByRole('group', { name: 'T2 came back to you after 3 red tries' }),
    ).toBeVisible()
  },
}

/**
 * The agent says T3 contradicts the Spec: T3 and T4 are blocked, T2 goes on; the blocker on T3's
 * stage, and T4 says what it waits on.
 */
export const Blocked: Story = {
  args: { build: BLOCKED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(groupsOf(canvasElement)).toEqual(['Blocked, 2', 'Working, 1', 'Done, 1'])
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }))
    await expect(args.onDismissBlocker).toHaveBeenCalledWith('blocker-1')
    await userEvent.click(canvas.getByRole('button', { name: /^T4 / }))
    await expect(
      canvas.getByText('Waits on T3, which the agent says contradicts the Spec.'),
    ).toBeVisible()
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

/** Final checks: every task done, the final checks on the stage, the first one green so far. */
export const FinalChecks: Story = {
  args: { build: FINAL_CHECKS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Final checks', { selector: 'span' })).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Stage of the final checks' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Tries of the final checks' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Stories' })).toHaveTextContent('S1 · verified')
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

/** Stopped: over and readable, why it stopped said, T3 skipped with its reason. */
export const Stopped: Story = {
  args: { build: STOPPED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('You stopped the build.')
    await expect(groupsOf(canvasElement)).toContain('Skipped, 1')
    await expect(canvas.queryByRole('button', { name: 'Resume' })).toBeNull()
  },
}

/**
 * The keyboard: the head's controls in order, then the list as one stop that the arrows walk and
 * Enter opens, then the stage; Stop asks first and gives the focus back.
 */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
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
    await userEvent.tab()
    // The list is one stop: the task on the stage.
    await expect(canvas.getByRole('button', { name: /^T2 / })).toHaveFocus()
    await userEvent.keyboard('{End}')
    const last = canvas.getByRole('button', { name: /^T1 / })
    await expect(last).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onSelect).toHaveBeenCalledWith('bt-1')
    await expect(canvas.getByRole('region', { name: 'Stage of T1' })).toBeVisible()
    await userEvent.tab()
    await expect(canvas.getByRole('region', { name: 'Stage of T1' })).toHaveFocus()
  },
}
