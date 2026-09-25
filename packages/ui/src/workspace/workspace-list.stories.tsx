import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CreateWorkspaceDialog } from './create-workspace-dialog.tsx'
import type { PlanRepositoryLine, WorkspaceRow } from './model.ts'
import { PreparationSteps } from './preparation-steps.tsx'
import { ServiceList } from './service-list.tsx'
import { VariablesEditor } from './variables-editor.tsx'
import { WorkspaceList, type WorkspaceListProps } from './workspace-list.tsx'
import { WorkspaceRepositories } from './workspace-repositories.tsx'

/**
 * The Workspaces card of a Project's settings (D8-02), on fixtures.
 *
 * The picker is the system's, and here it is a callback that answers a folder. What an open row
 * holds is the caller's: the stories draw what the settings draw there — the repositories with
 * their Git state, the preparation, the services and the Workspace's own variables.
 */
const MAIN: WorkspaceRow = {
  id: 'main',
  name: 'main',
  path: '/home/kris/Projects/atlas',
  state: 'ready',
  main: true,
  dedicated: false,
  summary: {
    branch: 'develop',
    commit: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    changes: '2 unstaged',
  },
}

const ROOT = '/home/kris/.local/share/hemera/workspaces/atlas'

const FILLED: WorkspaceRow[] = [
  MAIN,
  {
    id: 'login-form',
    name: 'login-form',
    path: `${ROOT}/login-form`,
    state: 'ready',
    main: false,
    dedicated: true,
    specKey: 'HEM-7',
  },
  {
    id: 'billing-export',
    name: 'billing-export',
    path: `${ROOT}/billing-export`,
    state: 'failed',
    main: false,
    dedicated: true,
    specKey: 'HEM-9',
  },
  {
    id: 'spike',
    name: 'spike',
    path: '/home/kris/Projects/spike',
    state: 'ready',
    main: false,
    dedicated: false,
  },
  {
    id: 'onboarding',
    name: 'onboarding',
    path: `${ROOT}/onboarding`,
    state: 'cleaned',
    main: false,
    dedicated: true,
    specKey: 'HEM-3',
  },
]

/** The plan a dedicated Workspace made from the settings starts from: no Spec, no name yet. */
const PLAN: PlanRepositoryLine[] = [
  {
    path: './sources/api',
    holdsRepository: true,
    branches: ['main', 'dev'],
    base: 'main',
    detachedCommit: null,
    branch: 'atlas/',
    included: true,
    reason: null,
  },
  {
    path: './sources/web',
    holdsRepository: true,
    branches: ['main'],
    base: 'main',
    detachedCommit: null,
    branch: 'atlas/',
    included: true,
    reason: null,
  },
]

/** What the settings draw under an open row: the Workspace's own blocks, on fixtures. */
function detailsOf(id: string) {
  const failed = id === 'billing-export'
  return (
    <>
      <WorkspaceRepositories
        name={id}
        repositories={[
          {
            path: './sources/api',
            git: {
              ok: true,
              branch: `atlas/${id}`,
              commit: '4f2c9a1e0b7d3c5a8e6f1d2b9c0a7e4f3d2c1b0a',
              staged: 0,
              unstaged: 1,
              untracked: 0,
            },
          },
        ]}
      />
      <PreparationSteps
        steps={[
          { id: 'w1', kind: 'worktree', target: './sources/api', state: 'done' },
          {
            id: 'r1',
            kind: 'run',
            target: 'install',
            state: failed ? 'failed' : 'done',
            message: failed ? 'exit 1' : undefined,
          },
        ]}
        onResume={fn()}
      />
      <ServiceList
        services={[
          {
            id: `dev-${id}`,
            name: 'dev',
            workspace: id,
            folder: './sources/web',
            scope: 'workspace',
            state: 'running',
            url: 'http://localhost:5173',
            readiness: 'ready',
            startedBy: 'user',
          },
        ]}
        onStop={fn()}
      />
      <VariablesEditor
        scope="workspace"
        name={id}
        variables={[
          { key: 'PORT', value: '3001', overrides: '3000' },
          { key: 'DATABASE_URL', value: 'postgres://localhost:5432/atlas', inherited: true },
        ]}
        onSet={fn(async () => await Promise.resolve(null))}
        onRemove={fn()}
      />
    </>
  )
}

/**
 * The list as the settings hold it: one row open at a time, the creation dialog of a dedicated
 * Workspace held beside it, and a Workspace the engine accepted joining the list.
 */
function Held({
  workspaces,
  expanded,
  onExpandedChange,
  onCreateDedicated,
  onMapFolder,
  ...rest
}: WorkspaceListProps) {
  const [rows, setRows] = useState(workspaces)
  const [open, setOpen] = useState(expanded ?? null)
  const [creating, setCreating] = useState(false)
  return (
    <>
      <WorkspaceList
        {...rest}
        workspaces={rows}
        expanded={open}
        onExpandedChange={(id) => {
          onExpandedChange?.(id)
          setOpen(id)
        }}
        onCreateDedicated={() => {
          onCreateDedicated()
          setCreating(true)
        }}
        onMapFolder={async (path, name) => {
          const said = await onMapFolder(path, name)
          if (said === null) {
            setRows([
              ...rows,
              { id: name, name, path, state: 'ready', main: false, dedicated: false },
            ])
          }
          return said
        }}
      />
      <CreateWorkspaceDialog
        open={creating}
        onOpenChange={setCreating}
        root={ROOT}
        defaultName=""
        repositories={PLAN}
        branchOf={(name) => `atlas/${name}`}
        onCreate={async (draft) => {
          setRows([
            ...rows,
            {
              id: draft.name,
              name: draft.name,
              path: `${ROOT}/${draft.name}`,
              state: 'preparing',
              main: false,
              dedicated: true,
            },
          ])
          return await Promise.resolve(null)
        }}
      />
    </>
  )
}

const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Blocks/Workspace/WorkspaceList',
  component: WorkspaceList,
  render: (args) => <Held {...args} />,
  parameters: { layout: 'padded' },
  args: {
    workspaces: FILLED,
    onCreateDedicated: fn(),
    onBrowse: fn(async () => await Promise.resolve('/home/kris/Projects/spike')),
    onMapFolder: fn(async () => await Promise.resolve(null)),
    onCleanup: fn(),
    renderDetails: detailsOf,
    expanded: null,
    onExpandedChange: fn(),
  },
  argTypes: {
    workspaces: { control: 'object', description: 'The Workspaces of the Project, main first.' },
    onCreateDedicated: {
      control: false,
      description: 'Opens the creation dialog of a dedicated Workspace.',
    },
    onBrowse: { control: false, description: 'Asks the system for a folder.' },
    onMapFolder: {
      control: false,
      description: 'Maps a folder as a Workspace; answers the refusal, or null.',
    },
    onCleanup: { control: false, description: 'Asks to clean one up; the caller confirms.' },
    renderDetails: { control: false, description: 'What an open row shows under it.' },
    expanded: { control: 'text', description: 'The Workspace whose row is open.' },
    onExpandedChange: { control: false, description: 'Opens a row, or closes it with null.' },
    className: { control: false, description: 'Where the card sits; never how it looks.' },
  },
} satisfies Meta<typeof WorkspaceList>

export default meta
type Story = StoryObj<typeof meta>
type Context = Parameters<NonNullable<Story['play']>>[0]

/** The row of one Workspace, found by its name. */
function rowOf(canvasElement: HTMLElement, name: string) {
  const list = within(within(canvasElement).getByRole('list', { name: 'Workspaces' }))
  // The name comes first on its row; `main` is its badge as well, which comes after it.
  return within(list.getAllByText(name, { selector: 'span' })[0]!.closest('li')!)
}

/** The dialog on screen, once it is there. */
async function dialogShown() {
  return await waitFor(() => within(document.body).getByRole('dialog'))
}

/** Waits the dialog out: a popup still leaving is a popup the accessibility pass still reads. */
async function dialogGone() {
  await waitFor(() => {
    expect(within(document.body).queryByRole('dialog')).toBeNull()
  })
}

// Scenario "main cannot be cleaned up".
async function mainCannotBeCleanedUp({ canvasElement }: Context) {
  const canvas = within(canvasElement)
  const main = rowOf(canvasElement, 'main')
  await expect(main.getByText('/home/kris/Projects/atlas')).toBeVisible()
  // Its own folder's Git state, on its row: the branch, the short commit and the changes.
  await expect(main.getByText('develop')).toBeVisible()
  await expect(main.getByText('1a2b3c4')).toBeVisible()
  await expect(main.getByText('2 unstaged')).toBeVisible()
  await expect(main.getByText('Ready')).toBeVisible()
  await expect(canvas.queryByRole('button', { name: /Clean up/ })).toBeNull()
}

/** A Project with its own folder only: nothing to clean up, two ways to add one. */
export const MainOnly: Story = {
  args: { workspaces: [MAIN] },
  play: mainCannotBeCleanedUp,
}

/**
 * `main`, two Workspaces made for Specs, a mapped folder, and one cleaned up: each row says where
 * it stands, and only a dedicated one not cleaned up yet offers to be.
 */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    args.onCleanup.mockClear()
    const canvas = within(canvasElement)
    await expect(rowOf(canvasElement, 'login-form').getByText('HEM-7')).toBeVisible()
    await expect(rowOf(canvasElement, 'login-form').getByText('dedicated')).toBeVisible()
    await expect(rowOf(canvasElement, 'billing-export').getByText('Failed')).toBeVisible()
    await expect(rowOf(canvasElement, 'onboarding').getByText('Cleaned up')).toBeVisible()
    // A mapped folder is not Hemera's: it is not dedicated, and it is never cleaned up (D8-14).
    const spike = rowOf(canvasElement, 'spike')
    await expect(spike.getByText('/home/kris/Projects/spike')).toBeVisible()
    await expect(spike.queryByText('dedicated')).toBeNull()
    await expect(canvas.getAllByRole('button', { name: /^Clean up/ })).toHaveLength(2)
    await expect(canvas.queryByRole('button', { name: 'Clean up onboarding' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Clean up spike' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Clean up login-form' }))
    await expect(args.onCleanup).toHaveBeenCalledWith('login-form')
  },
}

/**
 * One row open in place: its repositories, its preparation, its services and its own variables
 * under it. Opening another folds the first.
 */
export const Expanded: Story = {
  args: { expanded: 'login-form' },
  play: async ({ canvasElement, args }) => {
    const loginForm = rowOf(canvasElement, 'login-form')
    const disclosure = loginForm.getByRole('button', { name: 'Details of login-form' })
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    // Everything of the Workspace is inside its own row: the variables are its, not a card below.
    await expect(loginForm.getByRole('list', { name: 'Repositories of login-form' })).toBeVisible()
    await expect(loginForm.getByRole('list', { name: 'Steps' })).toBeVisible()
    await expect(loginForm.getByRole('list', { name: 'Services' })).toBeVisible()
    await expect(loginForm.getByRole('list', { name: 'Variables of login-form' })).toBeVisible()
    await expect(within(canvasElement).queryByRole('button', { name: /^Show/ })).toBeNull()

    await userEvent.click(
      rowOf(canvasElement, 'billing-export').getByRole('button', {
        name: 'Details of billing-export',
      }),
    )
    await expect(args.onExpandedChange).toHaveBeenCalledWith('billing-export')
    await waitFor(() => {
      expect(loginForm.queryByRole('list', { name: 'Steps' })).toBeNull()
    })
    const billing = rowOf(canvasElement, 'billing-export')
    await expect(billing.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    // The room has finished opening before the colours are judged.
    const room = billing
      .getByRole('button', { name: 'Details of billing-export' })
      .getAttribute('aria-controls')!
    await waitFor(() => {
      expect(document.getElementById(room)).toHaveStyle({ filter: 'opacity(1)' })
    })
  },
}

/**
 * New Workspace: the creation dialog of a dedicated Workspace, from the settings, with no Spec —
 * no name proposed, the branches following the name.
 */
export const NewWorkspace: Story = {
  args: { workspaces: [MAIN] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'New Workspace' }))
    await expect(args.onCreateDedicated).toHaveBeenCalled()
    const dialog = within(await dialogShown())
    const name = dialog.getByRole('textbox', { name: 'Name' })
    await expect(name).toHaveValue('')
    await userEvent.type(name, 'spike-auth')
    await expect(dialog.getAllByRole('textbox', { name: 'Branch' })[0]).toHaveValue(
      'atlas/spike-auth',
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }))
    await dialogGone()
    const created = rowOf(canvasElement, 'spike-auth')
    await expect(created.getByText('Preparing')).toBeVisible()
    await expect(created.getByText('dedicated')).toBeVisible()
  },
}

// Scenario "A Workspace on a chosen folder takes the folder's name".
async function aWorkspaceOnAChosenFolderTakesTheFoldersName({ canvasElement, args }: Context) {
  args.onMapFolder.mockClear()
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: 'Other ways to add a Workspace' }))
  const item = await waitFor(() =>
    within(document.body).getByRole('menuitem', { name: 'Map an existing folder' }),
  )
  await userEvent.click(item)
  const dialog = within(await dialogShown())
  // One sentence says what mapping a folder is, and what it is not.
  await expect(
    dialog.getByText(
      'Hemera uses this folder as it is: no worktree is made and no preparation runs.',
    ),
  ).toBeInTheDocument()
  await userEvent.click(dialog.getByRole('button', { name: 'Browse' }))
  await expect(args.onBrowse).toHaveBeenCalled()
  await waitFor(() => {
    expect(dialog.getByRole('textbox', { name: 'Folder' })).toHaveValue('/home/kris/Projects/spike')
  })
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('spike')
  await userEvent.click(dialog.getByRole('button', { name: 'Map' }))
  await waitFor(() => {
    expect(args.onMapFolder).toHaveBeenCalledWith('/home/kris/Projects/spike', 'spike')
  })
  await dialogGone()
  // Mapped: `spike` is a Workspace of the list, ready, on that folder, and not a dedicated one.
  const spike = rowOf(canvasElement, 'spike')
  await expect(spike.getByText('/home/kris/Projects/spike')).toBeVisible()
  await expect(spike.getByText('Ready')).toBeVisible()
  await expect(spike.queryByText('dedicated')).toBeNull()
}

/** Map an existing folder, from the menu beside New Workspace: a folder Hemera uses as it is. */
export const MapFolder: Story = {
  args: { workspaces: [MAIN] },
  play: aWorkspaceOnAChosenFolderTakesTheFoldersName,
}

/**
 * By the keyboard: New Workspace, the menu beside it, then each row's disclosure and its Clean
 * up in reading order; the menu opened with Enter, the dialog walked field by field, and the
 * focus back on the menu once it closes.
 */
export const Keyboard: Story = {
  args: { workspaces: FILLED.slice(0, 3) },
  play: async ({ canvasElement, args }) => {
    args.onMapFolder.mockClear()
    const canvas = within(canvasElement)
    const menu = canvas.getByRole('button', { name: 'Other ways to add a Workspace' })
    const order = [
      canvas.getByRole('button', { name: 'New Workspace' }),
      menu,
      canvas.getByRole('button', { name: 'Details of main' }),
      canvas.getByRole('button', { name: 'Details of login-form' }),
      canvas.getByRole('button', { name: 'Clean up login-form' }),
      canvas.getByRole('button', { name: 'Details of billing-export' }),
      canvas.getByRole('button', { name: 'Clean up billing-export' }),
    ]
    for (const next of order) {
      // oxlint-disable-next-line no-await-in-loop -- one key, then where it landed: the order is the point
      await userEvent.tab()
      expect(document.activeElement).toBe(next)
    }

    // Enter opens a row in place, and Enter again folds it.
    const details = canvas.getByRole('button', { name: 'Details of login-form' })
    details.focus()
    await userEvent.keyboard('{Enter}')
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Enter}')
    await expect(details).toHaveAttribute('aria-expanded', 'false')

    menu.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(
        within(document.body).getByRole('menuitem', { name: 'Map an existing folder' }),
      ).toHaveFocus()
    })
    await userEvent.keyboard('{Enter}')
    const shown = await dialogShown()
    await waitFor(() => {
      expect(shown.contains(document.activeElement)).toBe(true)
    })
    const dialog = within(shown)
    dialog.getByRole('textbox', { name: 'Folder' }).focus()
    await userEvent.tab()
    await expect(dialog.getByRole('button', { name: 'Browse' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('spike')
    })
    await userEvent.tab()
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await userEvent.tab()
    await expect(dialog.getByRole('button', { name: 'Map' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(args.onMapFolder).toHaveBeenCalledWith('/home/kris/Projects/spike', 'spike')
    })
    await dialogGone()
    await waitFor(() => {
      expect(menu).toHaveFocus()
    })
  },
}
