import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../components/button/button.tsx'
import { CommandDialog, type CommandDialogProps } from './command-dialog.tsx'
import type { CommandLine, RepositoryLine } from './model.ts'

/**
 * The dialog a command of the catalogue is added or edited in, on fixtures (recette 1 of lot 20,
 * D8-07, D8-10).
 *
 * The story opens it at once, as the pencil of a row or the "Add command" of the section would,
 * and holds what the engine answers in `refusal`. Two repositories end in `api`, so the base
 * select names them with their path.
 */
const REPOSITORIES: RepositoryLine[] = [
  { path: './sources/api', branch: 'main', exists: true, includedByDefault: true, icon: null },
  { path: './sources/front', branch: 'develop', exists: true, includedByDefault: true, icon: null },
  { path: './legacy/api', branch: 'main', exists: true, includedByDefault: false, icon: null },
]

const DEV: CommandLine = {
  id: 'dev',
  name: 'dev',
  command: 'pnpm dev',
  lineWindows: null,
  lineLinux: null,
  type: 'serve',
  scope: 'workspace',
  portless: false,
  portlessName: null,
  folderBase: './sources/front',
  folder: '',
}

const TAKEN = 'a command named "check" is already declared'

interface Extra {
  /** What the engine answers when the command is handed over: null, or a refusal. */
  refusal?: string | null
}

function Controlled({
  open,
  refusal = null,
  onOpenChange,
  onSubmit,
  ...rest
}: CommandDialogProps & Extra) {
  const [shown, setShown] = useState(open)
  return (
    <div className="flex h-screen flex-col items-start gap-2 p-6">
      <Button onClick={() => setShown(true)}>Open the dialog</Button>
      <CommandDialog
        {...rest}
        open={shown}
        onOpenChange={(next) => {
          setShown(next)
          onOpenChange(next)
        }}
        onSubmit={async (command) => {
          await onSubmit(command)
          return refusal
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Workspace/CommandDialog',
  component: CommandDialog,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    command: DEV,
    repositories: REPOSITORIES,
    portlessInstalled: true,
    projectName: 'Atlas Web',
    refusal: null,
    onOpenChange: fn(),
    onSubmit: fn(async () => await Promise.resolve(null)),
  },
  argTypes: {
    open: { control: 'boolean', description: 'Whether the dialog is on screen.' },
    command: { control: 'object', description: 'The command edited, or null when one is added.' },
    repositories: {
      control: 'object',
      description: 'The repositories a command may run from.',
    },
    portlessInstalled: {
      control: 'boolean',
      description: 'Whether portless is on this machine; the option is hidden when it is not.',
    },
    projectName: { control: 'text', description: 'The Project, whose slug Portless is offered.' },
    refusal: { control: 'text', description: 'What the engine answers; null writes it.' },
    onOpenChange: { control: false, description: 'Opens or closes the dialog.' },
    onSubmit: { control: false, description: 'Writes the command.' },
  },
} satisfies Meta<typeof Controlled>

export default meta
type Story = StoryObj<typeof meta>

function dialog() {
  return within(within(document.body).getByRole('dialog'))
}

/** Opens a select of the dialog by its name and chooses one of its items, then waits it out. */
async function choose(label: string, option: RegExp): Promise<void> {
  await userEvent.click(dialog().getByLabelText(label))
  const list = await waitFor(() => within(document.body).getByRole('listbox'))
  await userEvent.click(within(list).getByRole('option', { name: option }))
  // The list is waited out: the accessibility pass runs on whatever is on the page at the end,
  // and a popup still leaving carries focus guards that read as an error.
  await waitFor(() => {
    expect(within(document.body).queryByRole('listbox')).toBeNull()
  })
}

/** Adding one: a name, a line, a type, and a folder under one of the repositories. */
export const Add: Story = {
  args: { command: null },
  play: async ({ args }) => {
    args.onSubmit.mockClear()
    const inside = dialog()
    await expect(inside.getByRole('button', { name: 'Add command' })).toBeDisabled()
    await userEvent.type(inside.getByRole('textbox', { name: 'Name' }), 'check')
    await userEvent.type(inside.getByRole('textbox', { name: 'Default line' }), 'pnpm check')
    await choose('Type', /^Test/)
    // Two repositories are called `api`: each is named with its path beside it.
    await choose('Runs from', /^api \(\.\/sources\/api\)/)
    await userEvent.type(inside.getByRole('textbox', { name: 'Folder' }), 'packages/core')
    // A scope and Portless are a server's alone.
    await expect(inside.queryByLabelText('Scope')).toBeNull()
    await userEvent.click(inside.getByRole('button', { name: 'Add command' }))
    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith({
        id: 'check',
        name: 'check',
        command: 'pnpm check',
        lineWindows: null,
        lineLinux: null,
        type: 'test',
        scope: 'workspace',
        portless: false,
        portlessName: null,
        folderBase: './sources/api',
        folder: 'packages/core',
      })
    })
  },
}

/** Editing one: its name is fixed, and its line, its systems and its folder are rewritten. */
export const Edit: Story = {
  play: async ({ args }) => {
    args.onSubmit.mockClear()
    const inside = dialog()
    const name = inside.getByRole('textbox', { name: 'Name' })
    await expect(name).toHaveValue('dev')
    await expect(name).toBeDisabled()
    const line = inside.getByRole('textbox', { name: 'Default line' })
    await userEvent.clear(line)
    await userEvent.type(line, 'pnpm dev --host')
    await userEvent.type(inside.getByRole('textbox', { name: 'Windows line' }), 'pnpm dev:win')
    await choose('Runs from', /^Workspace root/)
    await userEvent.click(inside.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith({
        ...DEV,
        command: 'pnpm dev --host',
        lineWindows: 'pnpm dev:win',
        folderBase: null,
      })
    })
  },
}

/** A server: its scope, and Portless offered, named after the Project, with its addresses. */
export const Portless: Story = {
  play: async ({ args }) => {
    args.onSubmit.mockClear()
    const inside = dialog()
    await expect(inside.getByLabelText('Scope')).toBeInTheDocument()
    const box = inside.getByRole('checkbox', { name: /Serve through Portless/ })
    await expect(box).not.toBeChecked()
    await expect(inside.queryByRole('textbox', { name: 'Portless name' })).toBeNull()
    await userEvent.click(box)
    const name = inside.getByRole('textbox', { name: 'Portless name' })
    await expect(name).toHaveValue('atlas-web')
    await expect(inside.getByText('https://atlas-web.localhost')).toBeVisible()
    await expect(inside.getByText('https://atlas-web-<workspace>.localhost')).toBeVisible()
    await userEvent.clear(name)
    await userEvent.type(name, 'front')
    await expect(inside.getByText('https://front.localhost')).toBeVisible()
    await choose('Scope', /^One instance, run in main/)
    await userEvent.click(inside.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith({
        ...DEV,
        scope: 'project',
        portless: true,
        portlessName: 'front',
      })
    })
  },
}

/** A Portless name that cannot be the first label of an address is refused on the spot. */
export const PortlessNameInvalid: Story = {
  args: { command: { ...DEV, portless: true, portlessName: 'front' } },
  play: async () => {
    const inside = dialog()
    const name = inside.getByRole('textbox', { name: 'Portless name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Front App')
    await waitFor(() => {
      expect(inside.getByText('Lowercase letters, digits and single dashes only.')).toHaveStyle({
        opacity: '1',
      })
    })
    await expect(inside.getByRole('button', { name: 'Save' })).toBeDisabled()
  },
}

/** Portless is not on this machine: the option is not drawn at all. */
export const PortlessMissing: Story = {
  args: { portlessInstalled: false },
  play: async () => {
    const inside = dialog()
    await expect(inside.getByLabelText('Scope')).toBeInTheDocument()
    await expect(inside.queryByRole('checkbox', { name: /Portless/ })).toBeNull()
  },
}

/** The line already calls portless: it runs as it is written, and the option is not drawn. */
export const PortlessInLine: Story = {
  args: { command: { ...DEV, command: 'portless front pnpm dev' } },
  play: async ({ args }) => {
    args.onSubmit.mockClear()
    const inside = dialog()
    await expect(inside.queryByRole('checkbox', { name: /Portless/ })).toBeNull()
    await userEvent.click(inside.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith({
        ...DEV,
        command: 'portless front pnpm dev',
        portless: false,
        portlessName: null,
      })
    })
  },
}

/** The engine refused: the dialog stays open on what was typed, and says why. */
export const Refused: Story = {
  args: { command: null, refusal: TAKEN },
  play: async () => {
    const inside = dialog()
    await userEvent.type(inside.getByRole('textbox', { name: 'Name' }), 'check')
    await userEvent.type(inside.getByRole('textbox', { name: 'Default line' }), 'pnpm check')
    await userEvent.click(inside.getByRole('button', { name: 'Add command' }))
    await waitFor(() => {
      expect(inside.getByRole('alert')).toHaveTextContent(TAKEN)
    })
    await expect(inside.getByRole('textbox', { name: 'Default line' })).toHaveValue('pnpm check')
    await waitFor(() => {
      expect(inside.getByRole('button', { name: 'Add command' })).toHaveStyle({ opacity: '1' })
    })
  },
}

/**
 * Every field in order, then Save and Cancel; Escape closes it and gives the focus back to what
 * opened it.
 */
export const Keyboard: Story = {
  args: { open: false, command: null },
  play: async ({ canvasElement, args }) => {
    const opener = within(canvasElement).getByRole('button', { name: 'Open the dialog' })
    opener.focus()
    await userEvent.keyboard('{Enter}')
    const inside = await waitFor(() => dialog())
    inside.getByRole('textbox', { name: 'Name' }).focus()
    await userEvent.keyboard('dev')
    await userEvent.tab()
    await expect(inside.getByLabelText('Type')).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByRole('textbox', { name: 'Default line' })).toHaveFocus()
    await userEvent.keyboard('pnpm dev')
    await userEvent.tab()
    await expect(inside.getByRole('textbox', { name: 'Windows line' })).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByRole('textbox', { name: 'Linux line' })).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByLabelText('Runs from')).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByRole('textbox', { name: 'Folder' })).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByRole('button', { name: 'Add command' })).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(args.onOpenChange).toHaveBeenCalledWith(false)
    })
    await waitFor(() => {
      expect(opener).toHaveFocus()
    })
  },
}
