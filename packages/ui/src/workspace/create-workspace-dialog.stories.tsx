import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../components/button/button.tsx'
import {
  CreateWorkspaceDialog,
  type CreateWorkspaceDialogProps,
} from './create-workspace-dialog.tsx'
import type { PlanRepositoryLine, PlanRepositoryRead } from './model.ts'

/**
 * A location the engine has answered for: `read` is not null, so what it answered can be spread
 * into a variant of it (#110).
 */
type AnsweredLine = PlanRepositoryLine & { read: PlanRepositoryRead }

/**
 * Creating the Workspace of Spec `HEM-7` from the plan the engine proposed (D8-04), on fixtures.
 *
 * The checks are the engine's, and the panel stands in for it: `refusal` is what
 * `workspaces.create` would have answered.
 */
const API: AnsweredLine = {
  path: './sources/api',
  read: {
    holdsRepository: true,
    branches: ['main', 'dev'],
    base: 'main',
    detachedCommit: null,
    branch: 'hemera/HEM-7-login-form',
    included: true,
    reason: null,
  },
}

const FRONT: AnsweredLine = {
  path: './sources/front',
  read: {
    holdsRepository: true,
    branches: ['main', 'dev', 'release'],
    base: 'dev',
    detachedCommit: null,
    branch: 'hemera/HEM-7-login-form',
    included: true,
    reason: null,
  },
}

/** A location the Project declares where `main` holds no repository. */
const DOCS: AnsweredLine = {
  path: './docs',
  read: {
    holdsRepository: false,
    branches: [],
    base: null,
    detachedCommit: null,
    branch: 'hemera/HEM-7-login-form',
    included: false,
    reason: null,
  },
}

/**
 * A repository whose `main` is on no branch at all: the base is the commit it is on, and there is
 * no branch name to show in its place (D8-04).
 */
const DETACHED: AnsweredLine = {
  path: './sources/reports',
  read: {
    holdsRepository: true,
    branches: ['main', 'release'],
    base: '4f2c9a1f0a1e4f4f8a1c2f5b7d9e0a3b6c8d1e2f',
    detachedCommit: '4f2c9a1',
    branch: 'hemera/HEM-7-login-form',
    included: true,
    reason: null,
  },
}

/** A repository with nothing committed yet: it is in `main`, and has no base to start from. */
const EMPTY: AnsweredLine = {
  path: './sources/tools',
  read: {
    holdsRepository: true,
    branches: [],
    base: null,
    detachedCommit: null,
    branch: 'hemera/HEM-7-login-form',
    included: false,
    reason: null,
  },
}

/**
 * A repository Git refused to read: the plan keeps it, not ticked, and says what Git said where a
 * location that simply holds no repository says nothing of the sort (D8-04).
 */
const UNREAD: AnsweredLine = {
  path: './sources/billing',
  read: {
    holdsRepository: false,
    branches: [],
    base: null,
    detachedCommit: null,
    branch: 'hemera/HEM-7-login-form',
    included: false,
    reason: 'Git could not read this repository: fatal: not a git repository: /nowhere/billing',
  },
}

const TAKEN = 'a branch named hemera/HEM-7-login-form already exists in ./sources/api'

interface Extra {
  /** What the engine answers when the draft is handed over: null, or a refusal. */
  refusal?: string | null
  /**
   * The plan once Git has answered it (#110): the dialog opens on `repositories`, which is that
   * plan with nothing read of it yet, and is handed this one when it closes — so a story can open
   * the dialog twice, before and after the answers, and compare the two.
   */
  answered?: readonly PlanRepositoryLine[] | undefined
}

function Controlled({
  open,
  refusal = null,
  answered,
  onOpenChange,
  onCreate,
  ...rest
}: CreateWorkspaceDialogProps & Extra) {
  const [shown, setShown] = useState(open)
  const [read, setRead] = useState<readonly PlanRepositoryLine[] | undefined>(undefined)
  return (
    <div className="flex h-screen flex-col items-start gap-2 p-6">
      <Button onClick={() => setShown(true)}>New Workspace</Button>
      <CreateWorkspaceDialog
        {...rest}
        repositories={read ?? rest.repositories}
        open={shown}
        onOpenChange={(next) => {
          setShown(next)
          // Git answered every location before the dialog was closed (#110): the next opening is
          // the same plan, read.
          if (!next && answered !== undefined) setRead(answered)
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
      description:
        'The plan: each repository with its branches, its base, its branch and whether it is in.',
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
  return within(lineOf(dialog, path))
}

/** The row itself, which is where what a row takes rather than says is read (#110). */
function lineOf(dialog: HTMLElement, path: string): HTMLElement {
  return within(dialog).getByRole('checkbox', { name: path }).closest('li')!
}

/**
 * Choosing a base, the way a hand does: the trigger, then the option. The list is waited out — a
 * popup still leaving carries focus guards the accessibility pass reads as an error.
 */
async function chooseBase(row: ReturnType<typeof rowOf>, option: RegExp | string): Promise<void> {
  await userEvent.click(row.getByRole('combobox', { name: 'Base' }))
  const list = await waitFor(() => within(document.body).getByRole('listbox'))
  await userEvent.click(within(list).getByRole('option', { name: option }))
  await waitFor(() => {
    expect(within(document.body).queryByRole('listbox')).toBeNull()
  })
}

/** The plan as proposed: the Spec's slug, both repositories in, each on its own branch. */
export const Proposed: Story = {
  play: async () => {
    const dialog = within(document.body).getByRole('dialog')
    await expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('login-form')
    await expect(
      within(dialog).getByText('/home/kris/.local/share/hemera/workspaces/atlas/login-form'),
    ).toBeVisible()
    // The base proposed is the branch each repository's `main` is checked out on, read as it is:
    // a branch name, never the sha it points at (D8-04).
    await expect(
      rowOf(dialog, './sources/api').getByRole('combobox', { name: 'Base' }),
    ).toHaveTextContent('main')
    await expect(
      rowOf(dialog, './sources/front').getByRole('combobox', { name: 'Base' }),
    ).toHaveTextContent('dev')
    await expect(within(dialog).getByRole('button', { name: 'Create' })).toBeEnabled()
  },
}

/**
 * A repository whose `main` is on no branch: its base is the commit it is on, said as such beside
 * its short hash, and the branches it has are still there to choose instead (D8-04).
 */
export const DetachedHead: Story = {
  args: { repositories: [DETACHED, FRONT] },
  play: async () => {
    const dialog = within(document.body).getByRole('dialog')
    const reports = rowOf(dialog, './sources/reports')
    await expect(reports.getByRole('combobox', { name: 'Base' })).toHaveTextContent(
      'The current commit',
    )
    await expect(reports.getByText('4f2c9a1')).toBeVisible()
    // The list holds the commit it is on and the branches it has here, and one of them is chosen:
    // a repository on a branch is the ordinary case, and this one can become it.
    await userEvent.click(reports.getByRole('combobox', { name: 'Base' }))
    const list = await waitFor(() => within(document.body).getByRole('listbox'))
    await expect(within(list).getAllByRole('option')).toHaveLength(3)
    await expect(
      within(list).getByRole('option', { name: 'The current commit' }),
    ).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
    await chooseBase(reports, 'release')
    await expect(reports.getByRole('combobox', { name: 'Base' })).toHaveTextContent('release')
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
      repositories: [{ path: './sources/api', base: 'main', branch: 'hemera/HEM-7-login-form' }],
    })
  })
}

/**
 * The dialog just opened on a plan whose locations Git has not answered for yet (#110): each row
 * is there and says it is being read, and Create waits for the last of them. The name is typed
 * while the plan is still out: the dialog answers the hand before Git answers anything.
 */
export const Reading: Story = {
  args: { repositories: [API, { path: './sources/front', read: null }, DOCS] },
  play: aNameIsTypedBeforeThePlanArrives,
}

// Scenario "The dialog opens at once, and fills in as Git answers" (#110).
async function aNameIsTypedBeforeThePlanArrives(): Promise<void> {
  const dialog = within(document.body).getByRole('dialog')
  // The row nothing is known about yet is on screen with the others, and says as much.
  const front = rowOf(dialog, './sources/front')
  front.getByText('being read')
  // And it is already the height of the row it becomes: what Git has not answered for yet is
  // reserved at the size the fields take, so the dialog never moves under the answers (#110).
  await expect(lineOf(dialog, './sources/front').getBoundingClientRect().height).toBeCloseTo(
    lineOf(dialog, './sources/api').getBoundingClientRect().height,
    0,
  )
  await expect(front.getByRole('checkbox', { name: './sources/front' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  // The name is typed while the plan is still out.
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  await userEvent.type(name, ' at once')
  await expect(name).toHaveValue('login-form at once')
  // And the folder follows it, before Git has said anything of any repository.
  within(dialog).getByText('/home/kris/.local/share/hemera/workspaces/atlas/login-form at once')
  // Create waits for the last location to be read.
  await expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled()
}

/**
 * The dialog opened before Git has answered anything, and opened again once every location is
 * read: the same plan, and the same height (#110). This is the pair the rows are held to — the
 * first opening is what the dialog looks like while the answers are still coming, and the second
 * is where they land.
 */
export const Answered: Story = {
  args: {
    repositories: [API, { path: './sources/front', read: null }, DOCS],
    answered: [API, FRONT, DOCS],
  },
  play: theDialogIsTheSameHeightBeforeAndAfterTheAnswers,
}

// Scenario "The dialog opens at once, and fills in as Git answers" (#110).
async function theDialogIsTheSameHeightBeforeAndAfterTheAnswers(): Promise<void> {
  const before = within(document.body).getByRole('dialog')
  await expect(within(before).getByText('being read')).toBeVisible()
  // Its layout height, which the rise into place does not change: what is compared is where the
  // dialog sits on the screen, not what it is drawn from.
  const height = before.offsetHeight
  await userEvent.click(within(before).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => {
    expect(within(document.body).queryByRole('dialog')).toBeNull()
  })
  // Git has answered every location by now: it opens read, and what was reserved while it was
  // being read is exactly what the fields take.
  await userEvent.click(within(document.body).getByRole('button', { name: 'New Workspace' }))
  const after = within(document.body).getByRole('dialog')
  await expect(within(after).queryByText('being read')).toBeNull()
  await expect(
    rowOf(after, './sources/front').getByRole('combobox', { name: 'Base' }),
  ).toHaveTextContent('dev')
  expect(after.offsetHeight).toBe(height)
}

/** One repository left out, and a declared location with no repository in `main`. */
export const RepositoryLeftOut: Story = {
  args: { repositories: [API, { ...FRONT, read: { ...FRONT.read, included: false } }, DOCS] },
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
        { path: './sources/api', base: 'main', branch: 'hemera/HEM-7-login-form' },
        { path: './sources/front', base: 'dev', branch: 'hemera/HEM-7-login-form' },
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

  await userEvent.clear(api.getByRole('textbox', { name: 'Branch' }))
  await waitFor(() => {
    expect(api.getByText('An included repository needs a branch.')).toHaveStyle({ opacity: '1' })
  })
  await expect(create).toBeDisabled()

  // A base is chosen from the branches the repository has, so a repository with nothing committed
  // yet is one that is in with no base to start on — and Create waits for it all the same.
  const tools = rowOf(dialog, './sources/tools')
  await userEvent.click(tools.getByRole('checkbox'))
  await expect(tools.getByText('An included repository needs a base.')).toBeVisible()
  await expect(create).toBeDisabled()

  await userEvent.click(api.getByRole('checkbox'))
  await userEvent.click(rowOf(dialog, './sources/front').getByRole('checkbox'))
  await userEvent.click(tools.getByRole('checkbox'))
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
  args: { repositories: [API, FRONT, EMPTY] },
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
      { ...API, read: { ...API.read, branch: 'atlas/' } },
      { ...FRONT, read: { ...FRONT.read, branch: 'atlas/' } },
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
    // No name, no Workspace: the folder it will be is shown once the name makes one, and not
    // before, when the line would read as the Project's own folder (D8-04).
    await expect(inside.queryByText(/Folder/)).toBeNull()
    await expect(inside.getByRole('button', { name: 'Create' })).toBeDisabled()
    await userEvent.type(name, 'spike')
    await expect(
      inside.getByText('/home/kris/.local/share/hemera/workspaces/atlas/spike'),
    ).toBeVisible()
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
          { path: './sources/api', base: 'main', branch: 'atlas/spike-auth' },
          { path: './sources/front', base: 'dev', branch: 'kris/front-spike' },
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
  await expect(row.getByRole('combobox', { name: 'Base' })).toHaveFocus()
  await userEvent.tab()
  await expect(row.getByRole('textbox', { name: 'Branch' })).toHaveFocus()
}

/** The name, then each repository's box, its base, its branch, then Create, then Cancel. */
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

// Scenario "A repository Git keeps refusing is shown with its reason, not ticked".
async function aRepositoryGitKeepsRefusingIsShownWithItsReason() {
  const dialog = within(document.body).getByRole('dialog')
  // What Git said is what the row says, where a location that holds no repository says so: the two
  // are read differently, and neither can be ticked (D8-04).
  const row = rowOf(dialog, './sources/billing')
  await expect(row.getByText(/Git could not read this repository/)).toBeVisible()
  await expect(row.queryByText('no repository in main')).toBeNull()
  await expect(row.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true')
  await expect(row.getByRole('checkbox')).not.toBeChecked()
  await expect(row.queryByRole('textbox')).toBeNull()
}

/** A repository Git would not read: its refusal is shown, and it is not ticked. */
export const Unread: Story = {
  args: { repositories: [API, UNREAD] },
  play: aRepositoryGitKeepsRefusingIsShownWithItsReason,
}
