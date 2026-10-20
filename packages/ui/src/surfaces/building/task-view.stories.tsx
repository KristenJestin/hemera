import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { BuildingScreen } from './building-screen-fixture.tsx'

/**
 * A task opened over the Building page (open question 76 is settled: a stacked view, the trail
 * `ACME-12 › Building › T8`): where it aims, its tries and who ran them, the files it touched, what
 * judged it with the end of what failed, the conflicts it met, and the decision that amended it.
 * Only the sections that have something to say are drawn.
 */
const meta = {
  title: 'Surfaces/Task view',
  component: BuildingScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'working',
    initial: { open: ['task:T8'], shown: 'task:T8' },
    onOpenTask: fn(),
    onOpenDiff: fn(),
    onService: fn(),
    onRevoke: fn(),
  },
} satisfies Meta<typeof BuildingScreen>

export default meta
type Story = StoryObj<typeof meta>

const viewOf = (canvasElement: HTMLElement, id: string): HTMLElement =>
  within(canvasElement).getByRole('region', { name: new RegExp(`^${id} · `) })

/** At work on its second try: the first failed, what judged it with the end of its output. */
export const SecondTry: Story = {
  play: async ({ canvasElement }) => {
    const view = within(await waitFor(() => viewOf(canvasElement, 'T8')))
    await expect(
      within(view.getByRole('region', { name: 'Tries' })).getAllByRole('listitem'),
    ).toHaveLength(2)
    await expect(view.getByText(/Unable to find role="progressbar"/)).toBeVisible()
    // Each target says whether the task creates it or changes it.
    await expect(view.getAllByRole('img', { name: 'Changed by the task' })).toHaveLength(2)
    await expect(view.getByRole('img', { name: 'Created by the task' })).toBeVisible()
    await expect(
      within(canvasElement).getByRole('navigation', { name: 'Where you are' }),
    ).toHaveTextContent(/ACME-12.*Building.*T8/)
  },
}

/** Amended by a decision, a file changed outside its targets, and a conflict settled with another task. */
export const AmendedWithConflict: Story = {
  args: { initial: { open: ['task:T6'], shown: 'task:T6' } },
  play: async ({ canvasElement }) => {
    const view = within(await waitFor(() => viewOf(canvasElement, 'T6')))
    await expect(view.getByRole('region', { name: 'Amended' })).toHaveTextContent(/midnight/)
    await expect(view.getByText('Files · 1 outside its targets')).toBeVisible()
    await expect(view.getByRole('img', { name: 'Changed outside its targets' })).toBeVisible()
    await expect(view.getByRole('region', { name: 'Conflicts' })).toHaveTextContent(/With T5/)
  },
}

/** Three tries failed: each with its runner, the last output kept. */
export const FailedThreeTimes: Story = {
  args: { initial: { open: ['task:T12'], shown: 'task:T12' } },
  play: async ({ canvasElement }) => {
    const view = within(await waitFor(() => viewOf(canvasElement, 'T12')))
    await expect(view.getAllByRole('img', { name: 'Failed' }).length).toBeGreaterThanOrEqual(3)
  },
}

/** A task not started: where it belongs, and nothing else to say. */
export const NotStarted: Story = {
  args: { initial: { open: ['task:T17'], shown: 'task:T17' } },
  play: async ({ canvasElement }) => {
    const view = within(await waitFor(() => viewOf(canvasElement, 'T17')))
    await expect(view.getByText('Not started yet.')).toBeVisible()
    await expect(view.queryByRole('region', { name: 'Files' })).toBeNull()
  },
}

/** The task's diff from its view: a view over the view, and Back finds the task again. */
export const DiffFromTheTask: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const view = within(await waitFor(() => viewOf(canvasElement, 'T8')))
    await userEvent.click(view.getByRole('button', { name: 'The task’s diff' }))
    await expect(args.onOpenDiff).toHaveBeenCalledWith('T8')
    await waitFor(() => {
      expect(canvas.getByRole('region', { name: 'Diff' })).toBeVisible()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(viewOf(canvasElement, 'T8')).toBeVisible()
    })
  },
}
