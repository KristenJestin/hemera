import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import {
  NOW,
  T1_DONE,
  T1_NOT_VERIFIED,
  T2_WORKING,
  T3_CHECKING_TASK,
  T3_SKIPPED,
  T4,
} from './build-fixtures.ts'
import { TaskStage } from './task-stage.tsx'

/**
 * The stage of one task of a build (D10-05, D10-12): what the Spec asks of it, then its tries,
 * newest first and the newest open, each with its checks — where they ran, their verdict, the
 * engine's short reason, their output folded under them — and the files it changed per
 * repository. The blocks a task that needs the user wears on top are stories of their own.
 */
const meta = {
  title: 'Blocks/Build/TaskStage',
  component: TaskStage,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { task: T2_WORKING, now: NOW },
  argTypes: {
    task: { control: 'object', description: 'The task, with its tries.' },
    now: { control: 'text', description: 'The caller’s now, every time is said from.' },
    attention: { control: false, description: 'The block on top when the task needs the user.' },
  },
} satisfies Meta<typeof TaskStage>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Working on its second try: the first was red, its failing test open with the output's last
 * lines, the second has no check yet.
 */
export const Working: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Working')).toBeVisible()
    await expect(canvas.getByText('Try 2 of 3 · for 28 min')).toBeVisible()
    const tries = within(canvas.getByRole('list', { name: 'Tries of T2' }))
    // Newest first.
    await expect(tries.getAllByText(/^Try \d of 3$/).map((line) => line.textContent)).toEqual([
      'Try 2 of 3',
      'Try 1 of 3',
    ])
    await expect(canvas.getByText('The checks run once the agent says it finished.')).toBeVisible()
    // The older try is folded: its checks show once it is opened.
    await userEvent.click(canvas.getByRole('button', { name: /^Try 1 of 3/ }))
    await expect(await canvas.findByText('exited with 1')).toBeVisible()
    // A check folds its output under its line.
    await userEvent.click(canvas.getByRole('button', { name: /unit tests/ }))
    await expect(
      canvas.getByRole('log', { name: 'Output of unit tests on sources/front' }),
    ).toHaveTextContent('AssertionError')
    await expect(canvas.getByRole('heading', { name: 'Files changed · 5' })).toBeVisible()
  },
}

/** Finished by the agent a minute ago, its checks answering one by one. */
export const Checking: Story = {
  args: { task: T3_CHECKING_TASK },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Checking', { selector: 'span' })).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Green' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Files changed in sources/api' })).toBeVisible()
  },
}

/**
 * Done on its first try: every check green, the files filter of the written e2e matching
 * nothing, and the files it changed, with the lines added and removed.
 */
export const Done: Story = {
  args: { task: T1_DONE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('took 9 min')).toBeVisible()
    await expect(canvas.getAllByRole('img', { name: 'Green' })).toHaveLength(4)
    await expect(canvas.getByRole('img', { name: 'Skipped' })).toBeVisible()
    await expect(canvas.getByText('no changed file matched e2e/**/*.e2e.ts')).toBeVisible()
    const files = within(canvas.getByRole('list', { name: 'Files changed in sources/api' }))
    await expect(files.getAllByRole('listitem')).toHaveLength(3)
    await expect(files.getByText('+48')).toBeVisible()
  },
}

/** Done with no check configured: the badge says nothing judged it. */
export const DoneNotVerified: Story = {
  args: { task: T1_NOT_VERIFIED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Done, not verified')).toBeVisible()
    await expect(canvas.getByText('No check is configured: nothing judged this try.')).toBeVisible()
  },
}

/** The user's task, waiting on two others: no try, and nothing the agent runs. */
export const Waiting: Story = {
  args: { task: T4 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('after T2, T3')).toBeVisible()
    await expect(
      canvas.getByText('Yours to do: the agent does not work on it and no check runs.'),
    ).toBeVisible()
    await expect(canvas.getByText('You')).toBeVisible()
  },
}

/** Skipped by the user, with the reason, and its dependants let go on. */
export const Skipped: Story = {
  args: { task: T3_SKIPPED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/^Skipped: Credit notes wait/)).toBeVisible()
    await expect(canvas.getByText('The tasks that depend on it go on without it.')).toBeVisible()
  },
}
