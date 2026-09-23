import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import type { PreparationStepLine, StepState } from './model.ts'
import { PreparationSteps } from './preparation-steps.tsx'

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

const COPY_SKIPPED =
  'Nothing copied: ./sources/api already has a .env, left as it is; main has no .env in ./sources/front.'

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
  const copy = rowsIn(canvasElement)[2]!
  await expect(copy).toHaveTextContent('Skipped')
  await expect(within(copy).getByText(COPY_SKIPPED)).toBeVisible()
  await expect(within(canvasElement).queryByText('Failed')).toBeNull()
}

/** The copy found nothing to write: an existing file is left alone, a missing source skipped. */
export const Skipped: Story = {
  args: {
    steps: stepsAt(['done', 'done', 'skipped', 'done', 'done'], { at: 2, text: COPY_SKIPPED }),
  },
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
