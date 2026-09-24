import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { PreparationStepLine, StepState } from './model.ts'
import { PreparationSteps, type PreparationStepsProps } from './preparation-steps.tsx'

/**
 * The preparation of `login-form` (D8-05), on fixtures.
 *
 * The recipe is the Spec's own: `copy .env in repositories`, `link CLAUDE.md at root`,
 * `run install`, after one worktree per repository. Each story is the same five steps at
 * another point of their run.
 */
const RECIPE: PreparationStepLine[] = [
  { id: 'worktree-api', kind: 'worktree', target: './sources/api', state: 'pending' },
  { id: 'worktree-front', kind: 'worktree', target: './sources/front', state: 'pending' },
  { id: 'copy-env', kind: 'copy', target: '.env in repositories', state: 'pending' },
  { id: 'link-claude', kind: 'link', target: 'CLAUDE.md at root', state: 'pending' },
  { id: 'run-install', kind: 'run', target: 'install', state: 'pending' },
]

/** The recipe with each step in the state given, the message on the one that has one. */
function stepsAt(
  states: StepState[],
  message?: { at: number; text: string },
): PreparationStepLine[] {
  return RECIPE.map((step, index) => ({
    ...step,
    state: states[index] ?? 'pending',
    message: message?.at === index ? message.text : undefined,
  }))
}

const GIT_REFUSED =
  "fatal: '/home/kris/.local/share/hemera/workspaces/atlas/login-form/sources/front' already exists"

const LINK_REFUSED =
  "EPERM: operation not permitted, symlink '/home/kris/Projects/atlas/CLAUDE.md' -> '/home/kris/.local/share/hemera/workspaces/atlas/login-form/CLAUDE.md'"

const RUN_FAILED = [
  'install exited with code 1',
  '',
  ' ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with sources/api/package.json',
].join('\n')

/** `.env` is in `main/sources/api` and already in the Workspace's; `main/sources/front` has none. */
const COPY_KEPT = 'sources/api: kept as it was; sources/front: no source'

/** A second copy whose source is absent everywhere: nothing to copy, so the step is skipped. */
const COPY_NONE = 'sources/api: no source; sources/front: no source'

/** The recipe with one more copy, of a file `main` does not have at all. */
const WITH_A_MISSING_SOURCE = stepsAt(['done', 'done', 'done', 'done', 'done'], {
  at: 2,
  text: COPY_KEPT,
}).toSpliced(3, 0, {
  id: 'copy-env-local',
  kind: 'copy',
  target: '.env.local in repositories',
  state: 'skipped',
  message: COPY_NONE,
})

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Surfaces/Workspace/Preparation',
  component: PreparationSteps,
  parameters: { layout: 'padded' },
  args: {
    steps: RECIPE,
    onResume: fn(),
  },
  argTypes: {
    steps: { control: 'object', description: 'The steps, in the order they run.' },
    onResume: { control: false, description: 'Re-checks what was done, retries the failed step.' },
    interrupted: {
      control: 'boolean',
      description: 'Whether Hemera was closed before the preparation ended, no step failed.',
    },
    onShowRun: { control: false, description: 'Shows the details of the run a step started.' },
    shownRun: { control: 'text', description: 'The run whose details are shown.' },
    className: { control: false, description: 'Where the card sits; never how it looks.' },
  },
} satisfies Meta<typeof PreparationSteps>

export default meta
type Story = StoryObj<typeof meta>
type Context = Parameters<NonNullable<Story['play']>>[0]

/** Each row of the list, top to bottom, as the reader reads it. */
function rowsIn(canvasElement: HTMLElement): HTMLElement[] {
  return within(within(canvasElement).getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
}

/** The state word of a row, which is what it says it is at, colour aside. */
function stateOf(row: HTMLElement): string | null {
  return within(row).getByText(/^(Pending|Running|Done|Failed|Skipped)$/).textContent
}

// Scenario "The steps follow the recipe in order".
async function theStepsFollowTheRecipeInOrder({ canvasElement }: Context) {
  const rows = rowsIn(canvasElement)
  const labels = [
    'worktree ./sources/api',
    'worktree ./sources/front',
    'copy .env in repositories',
    'link CLAUDE.md at root',
    'run install',
  ]
  await expect(rows.map((row) => row.textContent)).toEqual(
    labels.map((label) => expect.stringContaining(label)),
  )
  await expect(rows.map(stateOf)).toEqual(labels.map(() => 'Pending'))
  await expect(within(canvasElement).queryByRole('button', { name: 'Resume' })).toBeNull()
}

/** Just created: the worktrees, then the recipe, all waiting. */
export const Pending: Story = {
  play: theStepsFollowTheRecipeInOrder,
}

/** The first worktree is there, the second is being made. */
export const Running: Story = {
  args: { steps: stepsAt(['done', 'running']) },
  play: async ({ canvasElement }) => {
    const rows = rowsIn(canvasElement)
    await expect(rows[0]).toHaveTextContent('Done')
    await expect(rows[1]).toHaveTextContent('Running')
    await expect(rows[2]).toHaveTextContent('Pending')
  },
}

/** Every step done: the Workspace is ready. */
export const Done: Story = {
  args: { steps: stepsAt(['done', 'done', 'done', 'done', 'done']) },
}

// Scenario "A copy never overwrites and skips a missing source".
async function aCopyNeverOverwritesAndSkipsAMissingSource({ canvasElement }: Context) {
  const rows = rowsIn(canvasElement)
  // `.env`: the existing file kept, the missing source passed over, and the step done.
  await expect(rows[2]).toHaveTextContent('copy .env in repositories')
  await expect(stateOf(rows[2]!)).toBe('Done')
  await expect(within(rows[2]!).getByText(COPY_KEPT)).toBeVisible()
  // `.env.local`: no source anywhere, so nothing was copied and the step is skipped.
  await expect(rows[3]).toHaveTextContent('copy .env.local in repositories')
  await expect(stateOf(rows[3]!)).toBe('Skipped')
  await expect(within(rows[3]!).getByText(COPY_NONE)).toBeVisible()
  await expect(within(canvasElement).queryByText('Failed')).toBeNull()
}

/** A copy that kept what was there and skipped a missing source, and one with no source at all. */
export const Skipped: Story = {
  args: { steps: WITH_A_MISSING_SOURCE },
  play: aCopyNeverOverwritesAndSkipsAMissingSource,
}

// Scenario "A failed step keeps what succeeded".
async function aFailedStepKeepsWhatSucceeded({ canvasElement, args }: Context) {
  const rows = rowsIn(canvasElement)
  await expect(rows[0]).toHaveTextContent('Done')
  await expect(rows[1]).toHaveTextContent('Failed')
  await expect(within(rows[1]!).getByText(GIT_REFUSED)).toBeVisible()
  await expect(rows.slice(2).map(stateOf)).toEqual(['Pending', 'Pending', 'Pending'])
  await expect(
    within(canvasElement).getByText(/checked again against the disk before anything is retried/),
  ).toBeVisible()
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Resume' }))
  await expect(args.onResume).toHaveBeenCalled()
}

/** Git refused the second worktree: the first stays, the rest waits, and Resume is offered. */
export const Failed: Story = {
  args: { steps: stepsAt(['done', 'failed'], { at: 1, text: GIT_REFUSED }) },
  play: aFailedStepKeepsWhatSucceeded,
}

// Scenario "A link that the system refuses is a failed step".
async function aLinkThatTheSystemRefusesIsAFailedStep({ canvasElement }: Context) {
  const rows = rowsIn(canvasElement)
  await expect(rows[3]).toHaveTextContent('Failed')
  await expect(within(rows[3]!).getByText(LINK_REFUSED)).toBeVisible()
  await expect(rows[4]).toHaveTextContent('Pending')
  await expect(within(canvasElement).getByRole('button', { name: 'Resume' })).toBeVisible()
}

/** The system refused the link: the step names its message, and the list stops there. */
export const LinkRefused: Story = {
  args: { steps: stepsAt(['done', 'done', 'done', 'failed'], { at: 3, text: LINK_REFUSED }) },
  play: aLinkThatTheSystemRefusesIsAFailedStep,
}

// Scenario "A run step fails on a non-zero exit".
async function aRunStepFailsOnANonZeroExit({ canvasElement }: Context) {
  const run = rowsIn(canvasElement)[4]!
  await expect(run).toHaveTextContent('Failed')
  await expect(within(run).getByText(/install exited with code 1/)).toBeVisible()
  await expect(within(canvasElement).getByRole('button', { name: 'Resume' })).toBeVisible()
}

/** `install` exited with code 1: the step fails with what it printed. */
export const RunFailed: Story = {
  args: {
    steps: stepsAt(['done', 'done', 'done', 'done', 'failed'], { at: 4, text: RUN_FAILED }),
  },
  play: aRunStepFailsOnANonZeroExit,
}

/**
 * Before: the run was done in an earlier pass, the first worktree's folder has since been
 * removed by hand, and Git refused the second. After Resume, the engine's re-check turns the
 * missing one back to `pending`, retries the failed one, and keeps the others (D8-05).
 */
const BEFORE_RESUME = stepsAt(['done', 'failed', 'done', 'done', 'done'], {
  at: 1,
  text: GIT_REFUSED,
})

const AFTER_RESUME = stepsAt(['pending', 'pending', 'done', 'done', 'done'])

/** The steps as the engine hands them back: what it answers once Resume is pressed. */
function Resuming({ steps, onResume, ...rest }: PreparationStepsProps) {
  const [shown, setShown] = useState(steps)
  return (
    <PreparationSteps
      {...rest}
      steps={shown}
      onResume={() => {
        onResume?.()
        setShown(AFTER_RESUME)
      }}
    />
  )
}

// Scenario "Resuming re-checks before retrying".
async function resumingReChecksBeforeRetrying({ canvasElement, args }: Context) {
  args.onResume?.mockClear()
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Resume' }))
  await expect(args.onResume).toHaveBeenCalledTimes(1)
  await waitFor(() => {
    expect(rowsIn(canvasElement).map(stateOf)).toEqual([
      'Pending',
      'Pending',
      'Done',
      'Done',
      'Done',
    ])
  })
  // The run that was done stays done: it is not run again.
  await expect(rowsIn(canvasElement)[4]).toHaveTextContent('run install')
  await expect(within(canvasElement).queryByRole('button', { name: 'Resume' })).toBeNull()
}

/** Resume pressed: the removed worktree is redone, the failed one retried, the run kept. */
export const Resumed: Story = {
  args: { steps: BEFORE_RESUME },
  render: (args) => <Resuming {...args} />,
  play: resumingReChecksBeforeRetrying,
}

// Scenario "A preparation interrupted by a quit can be resumed".
async function aPreparationInterruptedByAQuitCanBeResumed({ canvasElement, args }: Context) {
  args.onResume?.mockClear()
  const canvas = within(canvasElement)
  // The step that was running when Hemera was closed is waiting again, and nothing failed.
  await expect(rowsIn(canvasElement).map(stateOf)).toEqual([
    'Done',
    'Done',
    'Pending',
    'Pending',
    'Pending',
  ])
  await expect(canvas.queryByText('Failed')).toBeNull()
  await expect(canvas.getByText(/Hemera was closed before the preparation ended/)).toBeVisible()
  await userEvent.click(canvas.getByRole('button', { name: 'Resume' }))
  await expect(args.onResume).toHaveBeenCalledTimes(1)
}

/**
 * Hemera was closed while the copy ran: the copy is `pending` again, the Workspace still says it
 * is being prepared, and nothing prepares it. Resume is offered all the same.
 */
export const Interrupted: Story = {
  args: { steps: stepsAt(['done', 'done', 'pending']), interrupted: true },
  play: aPreparationInterruptedByAQuitCanBeResumed,
}

/** `install` failed and its run is there: the step sums it up, and its details are offered. */
const FAILED_INSTALL = stepsAt(['done', 'done', 'done', 'done', 'failed'], {
  at: 4,
  text: 'exit 1',
})

const WITH_ITS_RUN = FAILED_INSTALL.toSpliced(4, 1, { ...FAILED_INSTALL[4]!, runId: 'run-install' })

// Scenario "A run step fails on a non-zero exit": its run keeps the output and the exit code.
async function aRunStepShowsItsRun({ canvasElement, args }: Context) {
  const run = rowsIn(canvasElement)[4]!
  await expect(within(run).getByText('exit 1')).toBeVisible()
  // Only the step that started a run offers one.
  await expect(within(canvasElement).getAllByRole('button', { name: /^Details of/ })).toHaveLength(
    1,
  )
  await userEvent.click(within(run).getByRole('button', { name: 'Details of run install' }))
  await expect(args.onShowRun).toHaveBeenCalledWith('run-install')
}

/** The run of `install` is shown beside the list: its step's button is pressed. */
export const RunShown: Story = {
  args: { steps: WITH_ITS_RUN, onShowRun: fn(), shownRun: 'run-install' },
  play: async (context) => {
    await expect(
      within(context.canvasElement).getByRole('button', { name: 'Details of run install' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await aRunStepShowsItsRun(context)
  },
}

/** The list's controls by the keyboard: a run's Details, then Resume, in reading order. */
export const Keyboard: Story = {
  args: { steps: WITH_ITS_RUN, onShowRun: fn() },
  play: async ({ canvasElement, args }) => {
    args.onResume?.mockClear()
    const canvas = within(canvasElement)
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Details of run install' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onShowRun).toHaveBeenCalledWith('run-install')
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Resume' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onResume).toHaveBeenCalledTimes(1)
  },
}
