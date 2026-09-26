import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { type PathEntry, PathInput, type PathInputProps, type PathListing } from './path-input.tsx'

/**
 * A path typed under a base, offered one level at a time (#109), on a fixture tree.
 *
 * The listing is the story's own: a map from a folder under the base to what it holds, answered
 * the way the engine's `paths.entries` answers — one folder, its entries, folders first — and
 * nothing for a folder it does not hold.
 */
const TREE = new Map<string, PathEntry[]>([
  [
    '',
    [
      { name: 'packages', kind: 'folder' },
      { name: 'scripts', kind: 'folder' },
      { name: 'package.json', kind: 'file' },
    ],
  ],
  [
    'packages',
    [
      { name: 'core', kind: 'folder' },
      { name: 'ui', kind: 'folder' },
    ],
  ],
  [
    'packages/ui',
    [
      { name: 'src', kind: 'folder' },
      { name: 'package.json', kind: 'file' },
    ],
  ],
])

async function listing({ relative, kinds }: PathListing): Promise<readonly PathEntry[]> {
  const entries = TREE.get(relative) ?? []
  return await Promise.resolve(entries.filter((entry) => kinds.includes(entry.kind)))
}

/** The field with its value kept by the story, so what is typed and chosen stays in it. */
function Kept({ value = '', ...rest }: PathInputProps) {
  const [typed, setTyped] = useState(value)
  return (
    <div className="w-menu-wide">
      <PathInput {...rest} value={typed} onValueChange={setTyped} />
    </div>
  )
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Components/PathInput',
  component: PathInput,
  render: (args) => <Kept {...args} />,
  parameters: { layout: 'centered' },
  args: {
    label: 'Folder',
    placeholder: '.',
    description: 'Under where it runs from.',
    base: null,
    kinds: ['folder'],
    value: '',
    onList: fn(listing),
  },
  argTypes: {
    label: { control: 'text', description: 'What the field is called.' },
    placeholder: { control: 'text' },
    description: { control: 'text', description: 'A line under the field.' },
    error: { control: 'text', description: 'Why the typed path is refused, said by the caller.' },
    base: {
      control: 'text',
      description: 'The base the path is under, handed to the listing; null for the root.',
    },
    kinds: {
      control: 'check',
      options: ['folder', 'file'],
      description: 'What may be offered: folders, or files and folders.',
    },
    value: { control: 'text', description: 'The path typed.' },
    onList: { control: false, description: 'Lists one folder under the base.' },
    onValueChange: { control: false },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof PathInput>

export default meta
type Story = StoryObj<typeof meta>

function listbox() {
  return waitFor(() => within(document.body).getByRole('listbox'))
}

/** The field, and its suggestions as soon as it has the focus. */
export const Playground: Story = {}

/**
 * Folders, and files and folders: a copy takes either, a folder a command runs in takes the
 * first alone.
 */
export const Variants: Story = {
  args: { kinds: ['folder', 'file'], label: 'Source' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('textbox', { name: 'Source' }))
    const list = await listbox()
    await waitFor(() => {
      expect(within(list).getByRole('option', { name: 'packages/' })).toBeVisible()
    })
    await waitFor(() => {
      expect(within(list).getByRole('option', { name: 'package.json' })).toBeVisible()
    })
  },
}

/**
 * Two levels: the base's folders, then — a folder chosen — what that folder holds, asked of the
 * listing with the folder under the base. `..` is never among them.
 */
export const States: Story = {
  play: async ({ canvasElement, args }) => {
    args.onList.mockClear()
    const field = within(canvasElement).getByRole('textbox', { name: 'Folder' })
    await userEvent.click(field)
    const first = await listbox()
    await waitFor(() => {
      expect(within(first).getByRole('option', { name: 'packages/' })).toBeVisible()
    })
    await expect(within(first).queryByRole('option', { name: 'package.json' })).toBeNull()
    await expect(within(first).queryByRole('option', { name: /\.\./ })).toBeNull()
    await userEvent.click(within(first).getByRole('option', { name: 'packages/' }))
    await expect(field).toHaveValue('packages/')
    await waitFor(() => {
      expect(args.onList).toHaveBeenCalledWith({
        base: null,
        relative: 'packages',
        kinds: ['folder'],
      })
    })
    const second = await listbox()
    await waitFor(() => {
      expect(within(second).getByRole('option', { name: 'packages/ui/' })).toBeVisible()
    })
    await waitFor(() => {
      expect(within(second).getByRole('option', { name: 'packages/core/' })).toBeVisible()
    })
    // Typed above the base, nothing is asked and nothing is offered.
    args.onList.mockClear()
    await userEvent.clear(field)
    await userEvent.type(field, '../')
    await expect(within(document.body).queryByRole('option')).toBeNull()
    await expect(args.onList).not.toHaveBeenCalledWith(expect.objectContaining({ relative: '..' }))
  },
}

/** Down two levels with the keyboard alone: typed, Enter, typed again, Enter. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Folder' })
    field.focus()
    await listbox()
    await userEvent.keyboard('pa')
    await userEvent.keyboard('{Enter}')
    await expect(field).toHaveValue('packages/')
    await waitFor(() => {
      expect(within(document.body).getByRole('option', { name: 'packages/ui/' })).toBeVisible()
    })
    await userEvent.keyboard('u')
    await userEvent.keyboard('{Enter}')
    await expect(field).toHaveValue('packages/ui/')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
    await expect(field).toHaveFocus()
  },
}
