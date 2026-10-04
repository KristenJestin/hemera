import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  type RepositoryDraft,
  RepositoryForm,
  type RepositoryFormProps,
  RepositoriesSection,
} from './repositories.tsx'
import {
  DENSE_REPOSITORIES,
  HEMERA_REPOSITORIES,
  REMOTES,
  REPOSITORIES,
  UNREADABLE,
  branchRefusal,
} from './project-settings-fixtures.ts'

/**
 * The repositories of a Project, in its settings: the box that puts each in new Workspaces, its
 * path, its base — remote and branch — and when that base was last fetched; Git's own words for
 * one it cannot read. A line opens the repository's sheet, drawn here as its form.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Repositories',
  component: RepositoriesSection,
  parameters: { layout: 'fullscreen' },
  args: {
    repositories: REPOSITORIES,
    onInclude: fn(),
    onOpen: fn(),
    onAdd: fn(),
  },
  argTypes: { repositories: { table: { disable: true } }, footer: { table: { disable: true } } },
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RepositoriesSection>

export default meta
type Story = StoryObj<typeof meta>

/** Three repositories, `shared` not fetched since Monday; the box and the line are two controls. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Repositories' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Include web in new Workspaces' }))
    expect(args.onInclude).toHaveBeenCalledWith('web', false)
    await userEvent.click(canvas.getByRole('button', { name: /^shared/ }))
    expect(args.onOpen).toHaveBeenCalledWith('shared')
    expect(list).toHaveTextContent('not fetched since Monday')
  },
}

/** A folder that is not a repository and holds none: a Project all the same, and the way to add one. */
export const Empty: Story = {
  args: { repositories: [] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'No repository yet' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a repository' }))
    expect(args.onAdd).toHaveBeenCalled()
  },
}

/** Five: one left out of Workspaces, one with no remote, one Git cannot read. */
export const Dense: Story = {
  args: { repositories: DENSE_REPOSITORIES },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('listitem')).toHaveLength(5)
    expect(
      canvas.getByRole('checkbox', { name: 'Include packages/ui-kit in new Workspaces' }),
    ).not.toBeChecked()
    expect(canvas.getByRole('button', { name: /^packages\/ui-kit/ })).toHaveTextContent('no remote')
  },
}

/** On their way: the rows' own shape, the head of the columns in place. */
export const Loading: Story = {
  args: { repositories: [], loading: true },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('list', { busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
  },
}

/** A repository Git cannot read: its words where the base would be, in the destructive tone. */
export const Unreadable: Story = {
  args: { repositories: [...REPOSITORIES, UNREADABLE] },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector('[data-repository="billing"] [data-unreadable]')
    expect(row).toHaveTextContent('fatal: not a git repository')
  },
}

/** Hemera itself: the main checkout is its one repository, its base `origin/dev`. */
export const Hemera: Story = {
  args: { repositories: HEMERA_REPOSITORIES },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('list', { name: 'Repositories' })).toHaveTextContent(
      'origin/dev',
    )
  },
}

/** A long path, a long remote and a long branch: the path ends in an ellipsis in its column. */
export const LongText: Story = {
  args: {
    repositories: [
      ...REPOSITORIES,
      {
        id: 'long',
        path: 'services/platform-api-and-background-workers',
        includedByDefault: true,
        remote: 'upstream-platform-team',
        baseBranch: 'release/2026-10-platform-consolidation',
        freshness: { kind: 'old', since: 'last Thursday' },
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const path = within(canvasElement).getByText('services/platform-api-and-background-workers')
    expect(path.scrollWidth).toBeGreaterThan(path.clientWidth)
  },
}

/** From the keyboard: the box, then its line; Space ticks, Enter opens. */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Add a repository' })).toHaveFocus()
    await userEvent.tab()
    await userEvent.tab()
    const box = canvas.getByRole('checkbox', { name: 'Include api in new Workspaces' })
    expect(box).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(args.onInclude).toHaveBeenCalledWith('api', false)
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: /^api/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(args.onOpen).toHaveBeenCalledWith('api')
  },
}

/** The form of a repository's sheet, holding its draft as the sheet does. */
function Sheet(
  props: Omit<RepositoryFormProps, 'draft' | 'onChange' | 'branchError'> & {
    draft: RepositoryDraft
  },
) {
  const [draft, setDraft] = useState(props.draft)
  return (
    <div className="mx-auto flex w-full max-w-view-narrow flex-col gap-5 p-4">
      <RepositoryForm
        {...props}
        draft={draft}
        onChange={setDraft}
        branchError={branchRefusal(draft.baseBranch)}
      />
    </div>
  )
}

const API: RepositoryDraft = {
  path: 'api',
  includedByDefault: true,
  remote: 'origin',
  baseBranch: 'main',
}

/** The sheet of `api`: its path, its inclusion, the remote chosen among its own, its base. */
export const SheetEdit: Story = {
  render: () => (
    <Sheet
      draft={API}
      remotes={REMOTES.get('api')}
      freshness={{ kind: 'fetched', when: '09:02' }}
      onChooseFolder={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox', { name: 'Path in the main checkout' })).toHaveValue('api')
    expect(canvas.getByText('git@forge.acme.test:acme/api.git')).toBeVisible()
    await userEvent.click(canvas.getByRole('combobox', { name: 'Remote' }))
    await userEvent.click(await within(document.body).findByRole('option', { name: 'upstream' }))
    expect(await canvas.findByText('git@forge.acme.test:platform/api.git')).toBeVisible()
  },
}

/** A base branch Git would refuse: said under the field, in Git's rules, as it is typed. */
export const SheetBranchRefused: Story = {
  render: () => (
    <Sheet
      draft={API}
      remotes={REMOTES.get('api')}
      freshness={{ kind: 'fetched', when: '09:02' }}
      onChooseFolder={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const branch = canvas.getByRole('textbox', { name: 'Base branch' })
    await userEvent.clear(branch)
    await userEvent.type(branch, 'release..1')
    expect(
      await canvas.findByText('“release..1” is not a branch name Git accepts: it holds “..”.'),
    ).toBeVisible()
    expect(branch).toHaveAttribute('aria-invalid', 'true')
  },
}

/** The sheet of a base not fetched since Monday: when, and Git's reason. */
export const SheetNotFetched: Story = {
  render: () => (
    <Sheet
      draft={{ ...API, path: 'shared' }}
      remotes={REMOTES.get('shared')}
      freshness={{
        kind: 'old',
        since: 'Monday',
        reason: 'Could not resolve host: forge.acme.test',
      }}
      onChooseFolder={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByText(/not fetched since Monday: Could not resolve host/),
    ).toBeVisible()
  },
}

/** The sheet of a repository Git cannot read: Git's words whole, at its head. */
export const SheetUnreadable: Story = {
  render: () => (
    <Sheet
      draft={{ ...API, path: 'billing' }}
      remotes={REMOTES.get('billing')}
      freshness={{ kind: 'never' }}
      unreadable={UNREADABLE.unreadable}
      onChooseFolder={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'fatal: not a git repository (or any of the parent directories): .git',
    )
  },
}

/** A repository being added: its path, typed or chosen, and whether Workspaces take it. */
export const SheetNew: Story = {
  render: () => (
    <Sheet
      draft={{ path: '', includedByDefault: true, remote: null, baseBranch: 'main' }}
      onChooseFolder={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('textbox', { name: 'Base branch' })).toBeNull()
    expect(canvas.getByRole('button', { name: 'Choose…' })).toBeVisible()
  },
}

/** The icon a repository wears, chosen in its sheet among the short set; a folder until it is. */
export const SheetIcon: Story = {
  render: () => (
    <Sheet
      draft={API}
      remotes={REMOTES.get('api')}
      freshness={{ kind: 'fetched', when: '09:02' }}
      onChooseFolder={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const icon = canvas.getByRole('combobox', { name: 'Icon' })
    expect(icon).toHaveTextContent('Folder')
    await userEvent.click(icon)
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Server' }))
    expect(icon).toHaveTextContent('Server')
  },
}
