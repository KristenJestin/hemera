import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { EMPTY_DRAFT, ProjectDialog, type ProjectDialogProps } from './project-dialog.tsx'

/**
 * Creating a Project, on fixtures (design D4-07).
 *
 * The dialog validates nothing: what refuses a name or a folder is the domain, and the panel
 * stands in for it — `refusal` is what `projectName` would have said. The folder picker is the
 * system's, and here it is a callback that answers a path.
 */
interface Extra {
  /** What the caller answers when the draft is handed over: null, or a refusal. */
  refusal?: string | null
}

function Controlled({
  open,
  refusal = null,
  onSubmit,
  onOpenChange,
  ...rest
}: ProjectDialogProps & Extra) {
  const [shown, setShown] = useState(open)
  return (
    <div className="flex h-screen flex-col items-start gap-2 p-6">
      <Button onClick={() => setShown(true)}>New Project</Button>
      <ProjectDialog
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
  title: 'Surfaces/Project/Dialog',
  component: ProjectDialog,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    draft: EMPTY_DRAFT,
    action: 'Create Project',
    refusal: null,
    onOpenChange: fn(),
    onBrowse: fn(async () => await Promise.resolve('D:\\Projects\\atlas')),
    onSubmit: fn(async () => await Promise.resolve(null)),
  },
  argTypes: {
    open: { control: 'boolean', description: 'Whether the dialog is on screen.' },
    draft: { control: 'object', description: 'What the fields open on.' },
    action: {
      control: 'text',
      description: 'The word on the button that validates.',
      table: { defaultValue: { summary: 'Create Project' } },
    },
    refusal: { control: 'text', description: 'What the caller answers; null accepts the draft.' },
    onOpenChange: { action: 'open changed' },
    onBrowse: { action: 'folder picked' },
    onSubmit: { action: 'submitted' },
  },
} satisfies Meta<typeof Controlled>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Empty: nothing has been typed, and the button that creates waits rather than refusing. */
export const Variants: Story = {
  play: async () => {
    const dialog = within(document.body).getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Create Project' })).toBeDisabled()
    // The first tone is the one offered, and the group says which is chosen.
    expect(within(dialog).getByRole('radio', { name: 'Pink' })).toBeChecked()
  },
}

/** Filled in and validated: what the caller is handed, and the dialog closing behind it. */
export const States: Story = {
  play: async ({ args }) => {
    args.onSubmit.mockClear()
    const dialog = within(document.body).getByRole('dialog')

    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Atlas')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Blue' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Browse…' }))

    await waitFor(() => {
      expect(within(dialog).getByRole('textbox', { name: /Folder/ })).toHaveValue(
        'D:\\Projects\\atlas',
      )
    })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create Project' }))
    await waitFor(() => {
      expect(args.onSubmit).toHaveBeenCalledWith({
        name: 'Atlas',
        tone: 'info',
        mainPath: 'D:\\Projects\\atlas',
        // A new Project makes its dedicated Workspaces in Hemera's own folder, on its slug.
        workspacesRoot: null,
        branchPrefix: null,
      })
    })
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/**
 * Refused by the domain: the message is shown, the dialog stays open, and what was typed stays
 * in it. Scenario « Nom refusé » of `specs/project-workspaces/spec.md`, as the eye sees it —
 * the rule itself is checked in `packages/core/tests/project.test.ts`.
 */
export const Refused: Story = {
  args: { refusal: 'the project name is refused: it is longer than 120 characters' },
  play: async () => {
    const dialog = within(document.body).getByRole('dialog')

    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'A very long name')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Folder/ }), 'D:\\atlas')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create Project' }))

    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('the project name is refused')
    })
    expect(within(document.body).getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /Folder/ })).toHaveValue('D:\\atlas')

    // The button comes back from its own quiet, and the story waits for it: a colour caught
    // halfway through a fade is a contrast the accessibility pass is right to refuse.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Create Project' })).toHaveStyle({
        opacity: '1',
      })
    })
  },
}

/** Scenario « Le dossier vient du système » of `specs/project-workspaces/spec.md`. */
export const TheFolderComesFromTheSystem: Story = {
  play: async ({ args }) => {
    args.onBrowse.mockClear()
    const dialog = within(document.body).getByRole('dialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Browse…' }))
    expect(args.onBrowse).toHaveBeenCalled()
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox', { name: /Folder/ })).toHaveValue(
        'D:\\Projects\\atlas',
      )
    })
  },
}

/** Every field, and the tones, walked with the keyboard alone. */
export const Keyboard: Story = {
  play: async () => {
    const dialog = within(document.body).getByRole('dialog')
    const name = within(dialog).getByRole('textbox', { name: 'Name' })

    name.focus()
    await userEvent.keyboard('Atlas')
    expect(name).toHaveValue('Atlas')

    await userEvent.tab()
    // The tones are one stop, and the arrows move inside them.
    expect(within(dialog).getByRole('radio', { name: 'Pink' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(within(dialog).getByRole('radio', { name: 'Blue' })).toHaveFocus()
    })
  },
}
