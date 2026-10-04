import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  DEFAULT_FOLDER,
  DEFAULT_PREFIX,
  LONG_PATH,
  branchRefusal,
} from './project-settings-fixtures.ts'
import { WorkspacesSection, type WorkspacesSectionProps } from './workspaces.tsx'

/**
 * Where a Project's Workspaces are made, and what their branches start with. An empty field is
 * the default, and shows it in its quiet tone; a field written in carries the × that empties it.
 * Under them, the folder and the branch they make for one mission, as values.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Workspaces',
  component: WorkspacesSection,
  parameters: { layout: 'fullscreen' },
  args: {
    folder: null,
    defaultFolder: DEFAULT_FOLDER,
    onFolder: fn(),
    onChooseFolder: fn(),
    prefix: null,
    defaultPrefix: DEFAULT_PREFIX,
    onPrefix: fn(),
    example: 'ACME-12',
  },
  render: (args) => <Held {...args} />,
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkspacesSection>

export default meta
type Story = StoryObj<typeof meta>

/** The section, holding what is typed as the page does, and checking the prefix as Git would. */
function Held(args: WorkspacesSectionProps) {
  const [folder, setFolder] = useState(args.folder)
  const [prefix, setPrefix] = useState(args.prefix)
  return (
    <WorkspacesSection
      {...args}
      folder={folder}
      onFolder={(next) => {
        setFolder(next)
        args.onFolder(next)
      }}
      prefix={prefix}
      onPrefix={(next) => {
        setPrefix(next)
        args.onPrefix(next)
      }}
      prefixError={prefix === null ? undefined : branchRefusal(`${prefix}${args.example}`)}
    />
  )
}

/** Nothing chosen: both fields show what applies, and ACME-12's folder and branch follow. */
export const Defaults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const folder = canvas.getByRole('textbox', { name: 'Workspaces folder' })
    expect(folder).toHaveValue('')
    expect(folder).toHaveAttribute('placeholder', DEFAULT_FOLDER)
    expect(canvas.getByRole('textbox', { name: 'Branch prefix' })).toHaveAttribute(
      'placeholder',
      'acme/',
    )
    expect(canvasElement.querySelector('[data-example-folder]')).toHaveTextContent(
      '~/hemera-workspaces/acme/ACME-12',
    )
    expect(canvasElement.querySelector('[data-example-branch]')).toHaveTextContent('acme/ACME-12')
    expect(canvas.queryByRole('button', { name: /^Back to the default/ })).toBeNull()
  },
}

/** Both chosen: each field carries the × that takes it back to the default. */
export const Chosen: Story = {
  args: { folder: '/mnt/fast/acme-workspaces', prefix: 'team/acme-' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvasElement.querySelector('[data-example-folder]')).toHaveTextContent(
      '/mnt/fast/acme-workspaces/ACME-12',
    )
    expect(canvasElement.querySelector('[data-example-branch]')).toHaveTextContent(
      'team/acme-ACME-12',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Back to the default folder' }))
    expect(args.onFolder).toHaveBeenCalledWith(null)
    expect(canvas.getByRole('textbox', { name: 'Workspaces folder' })).toHaveValue('')
  },
}

/** A prefix Git would refuse: said under the field, in Git's rules, as it is typed. */
export const PrefixRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Branch prefix' }), 'acme team/')
    expect(
      await canvas.findByText(
        '“acme team/ACME-12” is not a branch name Git accepts: it holds a space or a control character.',
      ),
    ).toBeVisible()
  },
}

/** On their way: each field's own shape. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('[data-field-skeleton]')).toHaveLength(2)
  },
}

/** A long folder: the field holds it, cut at its end, the picker still beside it. */
export const LongText: Story = {
  args: { folder: LONG_PATH },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox', { name: 'Workspaces folder' })).toHaveValue(LONG_PATH)
    expect(canvas.getByRole('button', { name: 'Choose…' })).toBeVisible()
  },
}

/** From the keyboard: the folder, its picker, then the prefix. */
export const Focused: Story = {
  args: { folder: '/mnt/fast/acme-workspaces' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('textbox', { name: 'Workspaces folder' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Back to the default folder' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Choose…' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('textbox', { name: 'Branch prefix' })).toHaveFocus()
  },
}
