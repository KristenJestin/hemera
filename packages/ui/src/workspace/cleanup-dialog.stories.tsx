import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../components/button/button.tsx'
import { CleanupDialog, type CleanupDialogProps } from './cleanup-dialog.tsx'

/**
 * Cleaning up `login-form` (D8-14), on fixtures.
 *
 * The refusals are the engine's, and each story hands in one as it would have said it.
 */
const BRANCHES = [
  'hemera/HEM-7-login-form in ./sources/api',
  'hemera/HEM-7-login-form in ./sources/front',
]

const SERVICE_RUNNING = 'Clean up is refused: the service dev of login-form is running'

const GIT_REFUSED =
  "fatal: '/home/kris/.local/share/hemera/workspaces/atlas/login-form/sources/api' contains modified or untracked files, use --force to delete it"

const BUILD_SESSION = 'Clean up is refused: the build Session of HEM-7 is not archived'

function Controlled({ open, onOpenChange, ...rest }: CleanupDialogProps) {
  const [shown, setShown] = useState(open)
  return (
    <div className="flex h-screen flex-col items-start gap-2 p-6">
      <Button onClick={() => setShown(true)}>Clean up login-form</Button>
      <CleanupDialog
        {...rest}
        open={shown}
        onOpenChange={(next) => {
          setShown(next)
          onOpenChange(next)
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Workspace/CleanupDialog',
  component: CleanupDialog,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    name: 'login-form',
    branches: BRANCHES,
    refusal: null,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  argTypes: {
    open: { control: 'boolean', description: 'Whether the dialog is on screen.' },
    name: { control: 'text', description: 'The Workspace being cleaned up.' },
    branches: { control: 'object', description: 'The branches its worktrees are on, all kept.' },
    refusal: { control: 'text', description: 'Why the engine refused; null asks to confirm.' },
    onOpenChange: { control: false, description: 'Opens or closes the dialog.' },
    onConfirm: { control: false, description: 'The click that cleans it up.' },
  },
} satisfies Meta<typeof CleanupDialog>

export default meta
type Story = StoryObj<typeof meta>
type Context = Parameters<NonNullable<Story['play']>>[0]

// Scenario "Cleanup removes the worktrees and keeps the branches".
async function cleanupRemovesTheWorktreesAndKeepsTheBranches({ args }: Context) {
  const dialog = within(within(document.body).getByRole('dialog'))
  await expect(
    dialog.getByText(/Its worktrees are removed and its folder is deleted/),
  ).toBeVisible()
  const kept = dialog.getByRole('list', { name: 'Branches kept' })
  await expect(
    within(kept)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(BRANCHES)
  await userEvent.click(dialog.getByRole('button', { name: 'Clean up' }))
  await expect(args.onConfirm).toHaveBeenCalled()
}

/** The question: what goes, and the branches that stay. */
export const Confirm: Story = {
  play: cleanupRemovesTheWorktreesAndKeepsTheBranches,
}

// Scenario "Cleanup is refused while a service runs or Git refuses".
async function cleanupIsRefusedWhileAServiceRunsOrGitRefuses({ args }: Context) {
  const dialog = within(within(document.body).getByRole('dialog'))
  await expect(dialog.getByRole('alert')).toHaveTextContent(args.refusal ?? '')
  await expect(dialog.getByText('Nothing was removed.')).toBeVisible()
  await expect(dialog.queryByRole('button', { name: 'Clean up' })).toBeNull()
  // The footer's own Close, which says it in words: the corner's cross is named Close too.
  const close = dialog.getByText('Close', { selector: 'button' })
  await userEvent.click(close)
  await expect(args.onOpenChange).toHaveBeenCalledWith(false)
}

/** Refused while a service of the Workspace runs: the reason, and Close. */
export const RefusedRunningService: Story = {
  args: { refusal: SERVICE_RUNNING },
  play: cleanupIsRefusedWhileAServiceRunsOrGitRefuses,
}

/** Refused by Git, whose message is shown as it is: uncommitted changes stop it. */
export const RefusedGit: Story = {
  args: { refusal: GIT_REFUSED },
  play: cleanupIsRefusedWhileAServiceRunsOrGitRefuses,
}

/** Refused while the Workspace's `build` Session is not archived. */
export const RefusedBuildSession: Story = {
  args: { refusal: BUILD_SESSION },
  play: async () => {
    const dialog = within(within(document.body).getByRole('dialog'))
    await expect(dialog.getByRole('alert')).toHaveTextContent(BUILD_SESSION)
    await expect(dialog.queryByRole('button', { name: 'Clean up' })).toBeNull()
  },
}

/** Cancel, then Clean up; Escape closes and leaves everything as it was. */
export const Keyboard: Story = {
  play: async ({ args }) => {
    args.onConfirm.mockClear()
    const dialog = within(within(document.body).getByRole('dialog'))
    const cancel = dialog.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    await userEvent.tab()
    await expect(dialog.getByRole('button', { name: 'Clean up' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(args.onOpenChange).toHaveBeenCalledWith(false)
    })
    await expect(args.onConfirm).not.toHaveBeenCalled()
  },
}
