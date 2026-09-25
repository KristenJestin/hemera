import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../components/button/button.tsx'
import type { RepositoryLine } from './model.ts'
import { RepositoryDialog, type RepositoryDialogProps } from './repository-dialog.tsx'

/**
 * The dialog a repository of a Project is added or edited in, on fixtures (recette 1 of lot 20).
 *
 * The story opens it at once, as the pencil of a row or the "Add repository" of the section
 * would, and holds what the engine answers in `refusal`.
 */
const API: RepositoryLine = {
  path: './sources/api',
  branch: 'main',
  exists: true,
  includedByDefault: true,
  icon: 'server',
}

/** The folders under the Workspace not declared yet, which the path field offers. */
const SPARE: RepositoryLine[] = [
  { path: './sources/worker', branch: 'main', exists: true, includedByDefault: true, icon: null },
  { path: './scripts', branch: null, exists: true, includedByDefault: true, icon: null },
]

const TAKEN = 'the repository location "./sources/api" is already declared'

interface Extra {
  /** What the engine answers when the draft is handed over: null, or a refusal. */
  refusal?: string | null
}

function Controlled({
  open,
  refusal = null,
  onOpenChange,
  onSubmit,
  ...rest
}: RepositoryDialogProps & Extra) {
  const [shown, setShown] = useState(open)
  return (
    <div className="flex h-screen flex-col items-start gap-2 p-6">
      <Button onClick={() => setShown(true)}>Open the dialog</Button>
      <RepositoryDialog
        {...rest}
        open={shown}
        onOpenChange={(next) => {
          setShown(next)
          onOpenChange(next)
        }}
        onSubmit={async (draft) => {
          await onSubmit(draft)
          return refusal
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Workspace/RepositoryDialog',
  component: RepositoryDialog,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    repository: API,
    folders: SPARE,
    refusal: null,
    onOpenChange: fn(),
    onSubmit: fn(async () => await Promise.resolve(null)),
  },
  argTypes: {
    open: { control: 'boolean', description: 'Whether the dialog is on screen.' },
    repository: {
      control: 'object',
      description: 'The repository edited, or null when one is added.',
    },
    folders: { control: 'object', description: 'The folders offered while a path is typed.' },
    refusal: { control: 'text', description: 'What the engine answers; null writes it.' },
    onOpenChange: { control: false, description: 'Opens or closes the dialog.' },
    onSubmit: { control: false, description: 'Writes the repository from the draft.' },
  },
} satisfies Meta<typeof Controlled>

export default meta
type Story = StoryObj<typeof meta>

function dialog() {
  return within(within(document.body).getByRole('dialog'))
}

/** Adding one: the path offered from what the Workspace holds, the icon, the inclusion. */
export const Add: Story = {
  args: { repository: null },
  play: async ({ args }) => {
    args.onSubmit.mockClear()
    const inside = dialog()
    await expect(inside.getByText('Add repository', { selector: 'h2' })).toBeVisible()
    const path = inside.getByRole('textbox', { name: 'Path' })
    await userEvent.type(path, 'work')
    await waitFor(() => {
      expect(
        within(document.body).getByRole('option', { name: /\.\/sources\/worker/ }),
      ).toBeVisible()
    })
    await userEvent.keyboard('{Enter}')
    await expect(path).toHaveValue('./sources/worker')
    await userEvent.click(inside.getByRole('radio', { name: 'Package' }))
    await expect(
      inside.getByRole('checkbox', { name: /Include in every new Workspace/ }),
    ).toBeChecked()
    await userEvent.click(inside.getByRole('button', { name: 'Add repository' }))
    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith({
        path: './sources/worker',
        icon: 'package',
        includedByDefault: true,
      })
    })
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** Editing one: its path, its icon chosen, and whether a new Workspace takes it. */
export const Edit: Story = {
  play: async ({ args }) => {
    args.onSubmit.mockClear()
    const inside = dialog()
    await expect(inside.getByRole('textbox', { name: 'Path' })).toHaveValue('./sources/api')
    await expect(inside.getByRole('radio', { name: 'Server' })).toBeChecked()
    const include = inside.getByRole('checkbox', { name: /Include in every new Workspace/ })
    await userEvent.click(include)
    await expect(include).not.toBeChecked()
    await userEvent.click(inside.getByRole('radio', { name: /Automatic/ }))
    await userEvent.click(inside.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith({
        path: './sources/api',
        icon: null,
        includedByDefault: false,
      })
    })
  },
}

/** A path the field refuses on its own, before anybody is asked. */
export const Invalid: Story = {
  play: async ({ args }) => {
    args.onSubmit.mockClear()
    const inside = dialog()
    const path = inside.getByRole('textbox', { name: 'Path' })
    await userEvent.clear(path)
    await userEvent.type(path, '../elsewhere')
    await waitFor(() => {
      expect(inside.getByText('That path climbs out of the Workspace.')).toHaveStyle({
        opacity: '1',
      })
    })
    await expect(inside.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.clear(path)
    await userEvent.type(path, '/tmp/x')
    await waitFor(() => {
      expect(inside.getByText('That path is absolute.')).toHaveStyle({ opacity: '1' })
    })
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}

/** The engine refused: the dialog stays open on what was typed, and says why. */
export const Refused: Story = {
  args: { refusal: TAKEN },
  play: async () => {
    const inside = dialog()
    await userEvent.click(inside.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(inside.getByRole('alert')).toHaveTextContent(TAKEN)
    })
    await expect(within(document.body).getByRole('dialog')).toBeInTheDocument()
    await expect(inside.getByRole('textbox', { name: 'Path' })).toHaveValue('./sources/api')
    await waitFor(() => {
      expect(inside.getByRole('button', { name: 'Save' })).toHaveStyle({ opacity: '1' })
    })
  },
}

/**
 * The path, the icons as one stop walked by the arrows, the box, Save, Cancel; Escape closes it
 * and gives the focus back to what opened it.
 */
export const Keyboard: Story = {
  args: { open: false },
  play: async ({ canvasElement, args }) => {
    const opener = within(canvasElement).getByRole('button', { name: 'Open the dialog' })
    opener.focus()
    await userEvent.keyboard('{Enter}')
    const inside = await waitFor(() => dialog())
    // The focus is taken inside the dialog as it opens; the walk starts from its first field.
    await waitFor(() => {
      expect(within(document.body).getByRole('dialog')).toContainElement(
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
      )
    })
    inside.getByRole('textbox', { name: 'Path' }).focus()
    await userEvent.tab()
    await expect(inside.getByRole('radio', { name: 'Server' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(inside.getByRole('radio', { name: 'Browser' })).toHaveFocus()
    await expect(inside.getByRole('radio', { name: 'Browser' })).toBeChecked()
    await userEvent.tab()
    const include = inside.getByRole('checkbox', { name: /Include in every new Workspace/ })
    await expect(include).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect(include).not.toBeChecked()
    await userEvent.tab()
    await expect(inside.getByRole('button', { name: 'Save' })).toHaveFocus()
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
