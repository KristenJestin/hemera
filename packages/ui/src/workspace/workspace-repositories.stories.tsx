import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import type { GitState, WorkspaceRepositoryLine } from './model.ts'
import { WorkspaceRepositories } from './workspace-repositories.tsx'

/**
 * What Git says about the repositories of a Workspace (D8-01, D8-15), on fixtures.
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
  tags: ['autodocs', 'updated'],
  title: 'Blocks/Workspace/WorkspaceRepositories',
  component: WorkspaceRepositories,
  parameters: { layout: 'padded' },
  args: {
    name: 'login-form',
    repositories: [API, FRONT],
  },
  argTypes: {
    name: { control: 'text', description: 'The name of the Workspace, which names the list.' },
    repositories: {
      control: 'object',
      description: 'Each repository with what Git answered; `git: null` while it is asked.',
    },
    cleanedAt: { control: 'text', description: 'When it was cleaned up, as a sentence.' },
    className: { control: false, description: 'Where the card sits; never how it looks.' },
  },
} satisfies Meta<typeof WorkspaceRepositories>

export default meta
type Story = StoryObj<typeof meta>
type Context = Parameters<NonNullable<Story['play']>>[0]

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

// Scenario "A dedicated Workspace assembles one worktree per repository".
async function aDedicatedWorkspaceAssemblesOneWorktreePerRepository({ canvasElement }: Context) {
  const canvas = within(canvasElement)
  const repositories = within(canvas.getByRole('list', { name: 'Repositories of login-form' }))
  await expect(repositories.getAllByRole('listitem')).toHaveLength(2)
  await expect(repositories.getAllByText('hemera/HEM-7-login-form')).toHaveLength(2)
}

/** Every repository read: its branch, its short commit, and what has changed in it. */
export const Ready: Story = {
  play: async (context) => {
    await aDedicatedWorkspaceAssemblesOneWorktreePerRepository(context)
    await eachRepositoryShowsItsBranchCommitAndChanges(context)
  },
}

/** A Workspace with no repository declared: the Workspace is its folder, and it says so. */
export const Empty: Story = {
  args: { name: 'spike', repositories: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('No repository is declared: the Workspace is its folder.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('list')).toBeNull()
  },
}

/** Cleaned up: it says when, and its worktrees are gone. */
export const Cleaned: Story = {
  args: {
    repositories: [],
    cleanedAt: 'Cleaned up on 23 September 2026 at 16:40. Its branches are kept.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Cleaned up on 23 September 2026/)).toBeVisible()
    await expect(canvas.queryByRole('list')).toBeNull()
  },
}

/**
 * Git is being asked: a row holds the line the answer will come in on and says so — in words
 * nobody sees, since what is drawn is the bar.
 *
 * The height is the point (issue #108): a row being read is exactly as tall as one Git has
 * answered, so what lands under it moves nothing and the card grows by what arrives.
 */
export const Loading: Story = {
  args: {
    repositories: [API, { path: './sources/front', git: null }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rows = canvas.getAllByRole('listitem')
    await expect(rows).toHaveLength(2)

    // The words are still there for whoever does not see the bar, and the row says it is busy.
    await expect(within(rows[1]!).getByText('Reading Git…')).toBeVisible()
    await expect(within(rows[1]!).getByRole('status')).toBeVisible()

    // And the row is already the size of the answer: nothing moves when it lands.
    await expect(rows[1]!.getBoundingClientRect().height).toBeCloseTo(
      rows[0]!.getBoundingClientRect().height,
      0,
    )
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
