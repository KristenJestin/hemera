import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import type { GitState, WorkspaceRepositoryLine } from './model.ts'
import { WorkspaceCard } from './workspace-card.tsx'

/**
 * One Workspace and what Git says about its repositories (D8-01, D8-15), on fixtures.
 *
 * `login-form` is the Workspace made for `HEM-7`: two worktrees on `hemera/HEM-7-login-form`.
 * What Git answers is handed in as it would arrive, so each story is one thing Git can say.
 */
const API: WorkspaceRepositoryLine = {
  path: './sources/api',
  git: {
    ok: true,
    branch: 'hemera/HEM-7-login-form',
    commit: '4f2c9a1e0b7d3c5a8e6f1d2b9c0a7e4f3d2c1b0a',
    staged: 1,
    unstaged: 1,
    untracked: 1,
  },
}

/** A worktree with nothing changed in it. */
const CLEAN: Extract<GitState, { ok: true }> = {
  ok: true,
  branch: 'hemera/HEM-7-login-form',
  commit: '9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
  staged: 0,
  unstaged: 0,
  untracked: 0,
}

const FRONT: WorkspaceRepositoryLine = { path: './sources/front', git: CLEAN }

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Surfaces/Workspace/Card',
  component: WorkspaceCard,
  parameters: { layout: 'padded' },
  args: {
    name: 'login-form',
    path: '/home/kris/.local/share/hemera/workspaces/atlas/login-form',
    state: 'ready',
    main: false,
    specKey: 'HEM-7',
    repositories: [API, FRONT],
    onOpenFolder: fn(),
    onCleanup: fn(),
    onResume: fn(),
  },
  argTypes: {
    name: { control: 'text', description: 'The name of the Workspace, unique in the Project.' },
    path: { control: 'text', description: 'Its folder, as the system writes it.' },
    state: {
      control: 'select',
      options: ['preparing', 'ready', 'failed', 'cleaned'],
      description: 'Where the Workspace stands.',
    },
    main: { control: 'boolean', description: 'Whether it is the Project’s own folder.' },
    specKey: { control: 'text', description: 'The key of the Spec it was made for.' },
    repositories: {
      control: 'object',
      description: 'Each repository with what Git answered; `git: null` while it is asked.',
    },
    cleanedAt: { control: 'text', description: 'When it was cleaned up, as a sentence.' },
    onOpenFolder: { control: false, description: 'Opens the folder in the file manager.' },
    onCleanup: { control: false, description: 'Asks to clean it up (dedicated only).' },
    onResume: { control: false, description: 'Resumes a failed preparation.' },
    className: { control: false, description: 'Where the card sits; never how it looks.' },
  },
} satisfies Meta<typeof WorkspaceCard>

export default meta
type Story = StoryObj<typeof meta>
type Context = Parameters<NonNullable<Story['play']>>[0]

/** The Project's own folder: `ready` from its creation, `main` beside it, never cleaned up. */
export const Main: Story = {
  args: {
    name: 'main',
    path: '/home/kris/Projects/atlas',
    main: true,
    specKey: undefined,
    repositories: [
      { path: './sources/api', git: { ...CLEAN, branch: 'develop' } },
      { path: './sources/front', git: { ...CLEAN, branch: 'develop', unstaged: 3 } },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Its name and its badge: the badge is what says it is the Project's own folder.
    await expect(canvas.getAllByText('main')).toHaveLength(2)
    await expect(canvas.getByText('Ready')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /Clean up/ })).toBeNull()
  },
}

/** Its steps are running: the worktrees are there, Git reads them already. */
export const Preparing: Story = {
  args: { state: 'preparing' },
}

// Scenario "Each repository shows its branch, commit and changes".
async function eachRepositoryShowsItsBranchCommitAndChanges({ canvasElement }: Context) {
  const canvas = within(canvasElement)
  const api = within(canvas.getByText('./sources/api').closest('li')!)
  await expect(api.getByText('hemera/HEM-7-login-form')).toBeVisible()
  await expect(api.getByText('4f2c9a1')).toBeVisible()
  await expect(api.getByText('1 staged, 1 unstaged, 1 untracked')).toBeVisible()
  const front = within(canvas.getByText('./sources/front').closest('li')!)
  await expect(front.getByText('clean')).toBeVisible()
}

/** Every repository read: its branch, its short commit, and what has changed in it. */
export const Ready: Story = {
  play: eachRepositoryShowsItsBranchCommitAndChanges,
}

/** A step failed: the Workspace offers to resume, and says nothing more than its state here. */
export const Failed: Story = {
  args: { state: 'failed' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Failed')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Resume' }))
    await expect(args.onResume).toHaveBeenCalled()
  },
}

/** Cleaned up: it says when, its worktrees are gone, and nothing is left to act on. */
export const Cleaned: Story = {
  args: {
    state: 'cleaned',
    repositories: [],
    cleanedAt: 'Cleaned up on 23 September 2026 at 16:40. Its branches are kept.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Cleaned up on 23 September 2026/)).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Git is being asked: each row says so until it answers. */
export const Loading: Story = {
  args: {
    repositories: [
      { path: './sources/api', git: null },
      { path: './sources/front', git: null },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('Reading Git…')).toHaveLength(2)
  },
}

/** The message Git gave for a broken worktree, in D8-15's words: as it is. */
const BROKEN =
  'fatal: not a git repository: /home/kris/Projects/atlas/sources/api/.git/worktrees/api'

// Scenario "A Git error is surfaced as is".
async function aGitErrorIsSurfacedAsIs({ canvasElement }: Context) {
  const canvas = within(canvasElement)
  const api = within(canvas.getByText('./sources/api').closest('li')!)
  await expect(api.getByText(BROKEN)).toBeVisible()
  await expect(api.getByText('Git error')).toBeVisible()
  const front = within(canvas.getByText('./sources/front').closest('li')!)
  await expect(front.getByText('hemera/HEM-7-login-form')).toBeVisible()
}

/** One worktree's `.git` is broken: that row says Git's message, the other its state. */
export const GitError: Story = {
  args: { repositories: [{ path: './sources/api', git: { ok: false, error: BROKEN } }, FRONT] },
  play: aGitErrorIsSurfacedAsIs,
}
