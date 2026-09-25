import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../components/button/button.tsx'
import {
  CreateWorkspaceDialog,
  type CreateWorkspaceDialogProps,
} from './create-workspace-dialog.tsx'
import type { PlanRepositoryLine } from './model.ts'

/**
 * Creating the Workspace of Spec `HEM-7` from the plan the engine proposed (D8-04), on fixtures.
 *
 * The checks are the engine's, and the panel stands in for it: `refusal` is what
 * `workspaces.create` would have answered.
 */
const API: PlanRepositoryLine = {
  path: './sources/api',
  holdsRepository: true,
  base: '4f2c9a1',
  branch: 'hemera/HEM-7-login-form',
  included: true,
}

const FRONT: PlanRepositoryLine = {
  path: './sources/front',
  holdsRepository: true,
  base: '9b8a7c6',
  branch: 'hemera/HEM-7-login-form',
  included: true,
}

/** A location the Project declares where `main` holds no repository. */
const DOCS: PlanRepositoryLine = {
  path: './docs',
  holdsRepository: false,
  base: null,
  branch: 'hemera/HEM-7-login-form',
  included: false,
}

const TAKEN = 'a branch named hemera/HEM-7-login-form already exists in ./sources/api'

interface Extra {
  /** What the engine answers when the draft is handed over: null, or a refusal. */
  refusal?: string | null
}

function Controlled({
  open,
  refusal = null,
  onOpenChange,
  onCreate,
  ...rest
}: CreateWorkspaceDialogProps & Extra) {
  const [shown, setShown] = useState(open)
  return (
    <div className="flex h-screen flex-col items-start gap-2 p-6">
      <Button onClick={() => setShown(true)}>New Workspace</Button>
      <CreateWorkspaceDialog
        {...rest}
        open={shown}
        onOpenChange={(next) => {
          setShown(next)
          onOpenChange(next)
        }}
        onCreate={async (draft) => {
          await onCreate(draft)
          return refusal
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Workspace/CreateWorkspaceDialog',
  component: CreateWorkspaceDialog,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    root: '/home/kris/.local/share/hemera/workspaces/atlas',
    defaultName: 'login-form',
    repositories: [API, FRONT],
    gitMissing: false,
    refusal: null,
    onOpenChange: fn(),
    onCreate: fn(async () => await Promise.resolve(null)),
  },
  argTypes: {
    open: { control: 'boolean', description: 'Whether the dialog is on screen.' },
    root: { control: 'text', description: 'Where the dedicated Workspaces of the Project live.' },
    defaultName: { control: 'text', description: 'The name proposed: the Spec’s slug.' },
    repositories: {
      control: 'object',
      description: 'The plan: each repository with its base, its branch and whether it is in.',
    },
    branchOf: { control: false, description: 'The branch a name makes, while it follows it.' },
    gitMissing: { control: 'boolean', description: 'Whether git is missing on this machine.' },
    refusal: { control: 'text', description: 'What the engine answers; null creates it.' },
    onOpenChange: { control: false, description: 'Opens or closes the dialog.' },
    onCreate: { control: false, description: 'Creates the Workspace from the draft.' },
  },
} satisfies Meta<typeof Controlled>

export default meta
type Story = StoryObj<typeof meta>
type Context = Parameters<NonNullable<Story['play']>>[0]

/** The row of one repository, found by the path its checkbox is named after. */
function rowOf(dialog: HTMLElement, path: string) {
  return within(within(dialog).getByRole('checkbox', { name: path }).closest('li')!)
}

/** The plan as proposed: the Spec's slug, both repositories in, on the Spec's branch. */
export const Proposed: Story = {
  play: async () => {
    const dialog = within(document.body).getByRole('dialog')
    await expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('login-form')
    await expect(
      within(dialog).getByText('/home/kris/.local/share/hemera/workspaces/atlas/login-form'),
    ).toBeVisible()
    await expect(rowOf(dialog, './sources/api').getByRole('textbox', { name: 'Base' })).toHaveValue(
      '4f2c9a1',
    )
    await expect(within(dialog).getByRole('button', { name: 'Create' })).toBeEnabled()
  },
}

// Scenario "A location without a repository gets no worktree".
async function aLocationWithoutARepositoryGetsNoWorktree({ args }: Context) {
  args.onCreate.mockClear()
  const dialog = within(document.body).getByRole('dialog')
  // The location is shown, says why, and cannot be ticked: no base, no branch, no worktree.
  const docs = within(dialog).getByRole('checkbox', { name: /\.\/docs/ })
  const docsRow = within(docs.closest('li')!)
  await expect(docsRow.getByText('./docs')).toBeVisible()
  await expect(docsRow.getByText('no repository in main')).toBeVisible()
  await expect(docs).toHaveAttribute('aria-disabled', 'true')
  await expect(docs).not.toBeChecked()
  await expect(docsRow.queryByRole('textbox')).toBeNull()
  // The front was left out by hand: its base and branch go quiet, and it is not handed over.
  await expect(
    rowOf(dialog, './sources/front').getByRole('textbox', { name: 'Branch' }),
  ).toBeDisabled()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
  await waitFor(() => {
    expect(args.onCreate).toHaveBeenCalledWith({
      name: 'login-form',
      repositories: [{ path: './sources/api', base: '4f2c9a1', branch: 'hemera/HEM-7-login-form' }],
    })
  })
}

/** One repository left out, and a declared location with no repository in `main`. */
export const RepositoryLeftOut: Story = {
  args: { repositories: [API, { ...FRONT, included: false }, DOCS] },
  play: aLocationWithoutARepositoryGetsNoWorktree,
}

// Scenario "A failed check refuses the whole creation".
async function aFailedCheckRefusesTheWholeCreation({ args }: Context) {
  args.onCreate.mockClear()
  const dialog = within(document.body).getByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
  await waitFor(() => {
    expect(args.onCreate).toHaveBeenCalledWith({
      name: 'login-form',
      repositories: [
        { path: './sources/api', base: '4f2c9a1', branch: 'hemera/HEM-7-login-form' },
        { path: './sources/front', base: '9b8a7c6', branch: 'hemera/HEM-7-login-form' },
      ],
    })
  })
  await waitFor(() => {
    expect(within(dialog).getByRole('alert')).toHaveTextContent(TAKEN)
  })
  // Nothing typed is lost: the dialog is still open on the same plan.
  await expect(within(document.body).getByRole('dialog')).toBeInTheDocument()
  await expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('login-form')
  await expect(rowOf(dialog, './sources/api').getByRole('textbox', { name: 'Branch' })).toHaveValue(
    'hemera/HEM-7-login-form',
  )
  // The button comes back from its own quiet before the colours are judged.
  await waitFor(() => {
    expect(within(dialog).getByRole('button', { name: 'Create' })).toHaveStyle({ opacity: '1' })
  })
}

/** The engine refused one check: the message is shown as it was said, the form stays filled. */
export const Refused: Story = {
  args: { refusal: TAKEN },
  play: aFailedCheckRefusesTheWholeCreation,
}

// Scenario "A missing git is a named refusal".
async function aMissingGitIsANamedRefusal() {
  const dialog = within(document.body).getByRole('dialog')
  await expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'git was not found on this machine',
  )
  await expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled()
}

/** `git` is not on the PATH: the dialog says so, and nothing can be created. */
export const GitMissing: Story = {
  args: { gitMissing: true },
  play: aMissingGitIsANamedRefusal,
}

// Scenario "A failed check refuses the whole creation", for what the form checks on its own.
async function theDialogRefusesWhatCannotBeCreated({ args }: Context) {
  args.onCreate.mockClear()
  const dialog = within(document.body).getByRole('dialog')
  const inside = within(dialog)
  const create = inside.getByRole('button', { name: 'Create' })
  const name = inside.getByRole('textbox', { name: 'Name' })
  const api = rowOf(dialog, './sources/api')

  await userEvent.clear(name)
  await userEvent.type(name, '../login-form')
  await waitFor(() => {
    expect(inside.getByText('A Workspace name is one folder name.')).toHaveStyle({ opacity: '1' })
  })
  await expect(create).toBeDisabled()
  await userEvent.clear(name)
  await userEvent.type(name, 'login-form')

  await userEvent.clear(api.getByRole('textbox', { name: 'Base' }))
  await userEvent.clear(api.getByRole('textbox', { name: 'Branch' }))
  await waitFor(() => {
    expect(api.getByText('An included repository needs a base.')).toHaveStyle({ opacity: '1' })
  })
  await expect(api.getByText('An included repository needs a branch.')).toBeInTheDocument()
  await expect(create).toBeDisabled()

  await userEvent.click(api.getByRole('checkbox'))
  await userEvent.click(rowOf(dialog, './sources/front').getByRole('checkbox'))
  await expect(inside.getByRole('alert')).toHaveTextContent('Include at least one repository.')
  await expect(create).toBeDisabled()
  await expect(args.onCreate).not.toHaveBeenCalled()
  // The messages of the fields left out are gone before the colours are judged.
  await waitFor(() => {
    expect(inside.queryByText(/An included repository needs/)).toBeNull()
  })
}

/** What cannot be created is refused before the engine is asked, and Create waits. */
export const Invalid: Story = {
  play: theDialogRefusesWhatCannotBeCreated,
}

/**
 * Opened from the settings, with no Spec: no name proposed, and each branch follows the name as
 * it is typed until it is written by hand.
 */
export const FromSettings: Story = {
  args: {
    defaultName: '',
    repositories: [
      { ...API, branch: 'atlas/' },
      { ...FRONT, branch: 'atlas/' },
    ],
    branchOf: (name) => `atlas/${name}`,
  },
  play: async ({ args }) => {
    args.onCreate.mockClear()
    const dialog = within(document.body).getByRole('dialog')
    const inside = within(dialog)
    const name = inside.getByRole('textbox', { name: 'Name' })
    const api = rowOf(dialog, './sources/api')
    const front = rowOf(dialog, './sources/front')
    // Nothing is proposed, and nothing is said wrong before anything was typed.
    await expect(name).toHaveValue('')
    await expect(inside.queryByText('A Workspace needs a name.')).toBeNull()
    await expect(inside.getByRole('button', { name: 'Create' })).toBeDisabled()
    await userEvent.type(name, 'spike')
    await expect(api.getByRole('textbox', { name: 'Branch' })).toHaveValue('atlas/spike')
    await expect(front.getByRole('textbox', { name: 'Branch' })).toHaveValue('atlas/spike')
    // The front's branch written by hand stops following the name; the api's goes on.
    const frontBranch = front.getByRole('textbox', { name: 'Branch' })
    await userEvent.clear(frontBranch)
    await userEvent.type(frontBranch, 'kris/front-spike')
    await userEvent.type(name, '-auth')
    await expect(api.getByRole('textbox', { name: 'Branch' })).toHaveValue('atlas/spike-auth')
    await expect(frontBranch).toHaveValue('kris/front-spike')
    await userEvent.click(inside.getByRole('button', { name: 'Create' }))
    await waitFor(() => {
      expect(args.onCreate).toHaveBeenCalledWith({
        name: 'spike-auth',
        repositories: [
          { path: './sources/api', base: '4f2c9a1', branch: 'atlas/spike-auth' },
          { path: './sources/front', base: '9b8a7c6', branch: 'kris/front-spike' },
        ],
      })
    })
  },
}

/** One repository with the keyboard: its box, its base, its branch. */
async function walkRow(row: ReturnType<typeof rowOf>) {
  await userEvent.tab()
  await expect(row.getByRole('checkbox')).toHaveFocus()
  await userEvent.tab()
  await expect(row.getByRole('textbox', { name: 'Base' })).toHaveFocus()
  await userEvent.tab()
  await expect(row.getByRole('textbox', { name: 'Branch' })).toHaveFocus()
}

/** The name, then each repository's box, base and branch, then Create, then Cancel. */
export const Keyboard: Story = {
  play: async ({ args }) => {
    const dialog = within(document.body).getByRole('dialog')
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    name.focus()
    await walkRow(rowOf(dialog, './sources/api'))
    await walkRow(rowOf(dialog, './sources/front'))
    await userEvent.tab()
    await expect(within(dialog).getByRole('button', { name: 'Create' })).toHaveFocus()
    await userEvent.tab()
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    // The space leaves a repository out, and Escape closes the dialog.
    rowOf(dialog, './sources/front').getByRole('checkbox').focus()
    await userEvent.keyboard(' ')
    await expect(rowOf(dialog, './sources/front').getByRole('checkbox')).not.toBeChecked()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(args.onOpenChange).toHaveBeenCalledWith(false)
    })
  },
}
