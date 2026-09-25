import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../components/button/button.tsx'
import { CheckDialog, type CheckDialogProps } from './check-dialog.tsx'
import {
  CHECKS,
  COMMANDS,
  COVERAGE,
  E2E_WRITTEN,
  REPOSITORIES,
  TYPECHECK,
} from './check-fixtures.ts'

/**
 * The dialog a check of the build is added or edited in (D10-06), on fixtures: what it
 * runs — a command of the catalogue or a line of the user's — where and when, and the two optional
 * readings, a number its output has to show and the files its `{files}` stands for. The story
 * opens it at once, as a row's pencil or "Add check" would, and holds what the engine answers in
 * `refusal`.
 */

interface Extra {
  /** What the engine answers when the check is handed over: null, or a refusal. */
  refusal?: string | null
}

function Controlled({
  open,
  refusal = null,
  onOpenChange,
  onSubmit,
  ...rest
}: CheckDialogProps & Extra) {
  const [shown, setShown] = useState(open)
  return (
    <div className="flex h-screen flex-col items-start gap-2 p-6">
      <Button onClick={() => setShown(true)}>Open the dialog</Button>
      <CheckDialog
        {...rest}
        open={shown}
        onOpenChange={(next) => {
          setShown(next)
          onOpenChange(next)
        }}
        onSubmit={async (check) => {
          await onSubmit(check)
          return refusal
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Build/CheckDialog',
  component: CheckDialog,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    check: null,
    commands: COMMANDS,
    repositories: REPOSITORIES,
    takenNames: CHECKS.map((one) => one.name),
    refusal: null,
    onOpenChange: fn(),
    onSubmit: fn(async () => await Promise.resolve(null)),
  },
  argTypes: {
    open: { control: 'boolean', description: 'Whether the dialog is open.' },
    check: { control: 'object', description: 'The check edited; null adds one.' },
    commands: { control: 'object', description: 'The catalogue a command is picked from.' },
    repositories: { control: 'object', description: 'The repositories a check may run in.' },
    takenNames: { control: 'object', description: 'The names the other checks have.' },
    refusal: { control: 'text', description: 'What the engine answers; null accepts it.' },
    onOpenChange: { action: 'open changed' },
    onSubmit: { action: 'submitted' },
  },
} satisfies Meta<typeof Controlled>

export default meta

type Story = StoryObj<typeof meta>

/** The dialog, once it has risen into place. */
async function dialog() {
  const found = await waitFor(() => within(document.body).getByRole('dialog'))
  await waitFor(() => expect(found).toBeVisible())
  return within(found)
}

/** An option of an open select, which the page draws outside the dialog. */
async function pick(name: string) {
  await userEvent.click(await within(document.body).findByRole('option', { name }))
}

/**
 * Add: a command of the catalogue, where the command runs, after each task — the first command
 * of the catalogue picked, the name left to write.
 */
export const Add: Story = {
  play: async ({ args }) => {
    const inside = await dialog()
    await expect(inside.getByRole('heading', { name: 'Add check' })).toBeInTheDocument()
    await expect(inside.getByLabelText('Command')).toHaveTextContent('typecheck')
    await expect(inside.getByLabelText('Where')).toHaveTextContent('Where the command runs')
    await expect(inside.getByLabelText('When')).toHaveTextContent('After each task')
    await userEvent.type(inside.getByRole('textbox', { name: 'Name' }), 'types')
    await userEvent.click(inside.getByLabelText('Where'))
    await pick('Each repository the task changed')
    await userEvent.click(inside.getByRole('button', { name: 'Add check' }))
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'types',
        commandId: 'typecheck',
        line: null,
        where: 'changed',
        when: 'task',
        expect: null,
      }),
    )
  },
}

/** Edit: a line of the user's, with its expected number, in one repository, after each story. */
export const Edit: Story = {
  args: { check: COVERAGE },
  play: async () => {
    const inside = await dialog()
    await expect(inside.getByRole('heading', { name: 'Edit check' })).toBeInTheDocument()
    await expect(inside.getByRole('textbox', { name: 'Line' })).toHaveValue(
      'pnpm vitest run --coverage',
    )
    await expect(inside.getByLabelText('Where')).toHaveTextContent('In front')
    await expect(inside.getByRole('textbox', { name: 'Minimum' })).toHaveValue('70')
  },
}

/**
 * A line of the user's that runs only the tests the task wrote: at the Workspace root — a line has
 * no place of its own (D10-06) — with `{files}` and its filter.
 */
export const LineWithFiles: Story = {
  args: { check: E2E_WRITTEN },
  play: async () => {
    const inside = await dialog()
    await expect(inside.getByLabelText('Where')).toHaveTextContent('Workspace root')
    await expect(inside.getByRole('textbox', { name: 'Files' })).toHaveValue('e2e/**/*.e2e.ts')
    await expect(inside.getByText(/becomes the files the task changed that match/)).toBeVisible()
  },
}

/** An expected result asked for: the pattern and the minimum, and how they are read (D10-06). */
export const ExpectedResult: Story = {
  play: async ({ args }) => {
    const inside = await dialog()
    await userEvent.type(inside.getByRole('textbox', { name: 'Name' }), 'coverage floor')
    await userEvent.click(inside.getByRole('checkbox', { name: /Expect a number/ }))
    await expect(
      inside.getByText(/The first number the pattern captures is compared/),
    ).toBeVisible()
    await userEvent.type(inside.getByRole('textbox', { name: 'Pattern' }), 'All files ([[\\d.]+)')
    await userEvent.type(inside.getByRole('textbox', { name: 'Minimum' }), '70')
    await userEvent.click(inside.getByRole('button', { name: 'Add check' }))
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ expect: { pattern: 'All files ([\\d.]+)', minimum: 70 } }),
    )
  },
}

/**
 * Refused before it is sent: a name taken, a pattern that captures nothing, a minimum that is not
 * a number, a filter for a line with no `{files}` — each said under its field.
 */
export const Invalid: Story = {
  play: async ({ args }) => {
    const inside = await dialog()
    await userEvent.type(inside.getByRole('textbox', { name: 'Name' }), 'lint')
    await userEvent.click(inside.getByLabelText('Runs'))
    await pick('A line of yours')
    await userEvent.type(inside.getByRole('textbox', { name: 'Line' }), 'pnpm vitest run')
    await userEvent.click(inside.getByRole('checkbox', { name: /Expect a number/ }))
    await userEvent.type(inside.getByRole('textbox', { name: 'Pattern' }), 'coverage')
    await userEvent.type(inside.getByRole('textbox', { name: 'Minimum' }), 'most')
    await userEvent.type(inside.getByRole('textbox', { name: 'Files' }), 'src/**/*.test.ts')
    await userEvent.click(inside.getByRole('button', { name: 'Add check' }))
    // Each refusal rises under its field; what it says is read once it has.
    await waitFor(() => {
      for (const said of [
        'A check named “lint” already exists.',
        /Capture the number in parentheses/,
        'A number, such as 70.',
        'The line has no {files} for the files to take the place of.',
      ]) {
        expect(inside.getByText(said)).toHaveStyle({ opacity: '1' })
      }
    })
    await expect(inside.getByRole('button', { name: 'Add check' })).toBeDisabled()
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}

/** The engine refused it: said under the form, and the dialog stays open on what was typed. */
export const Refused: Story = {
  args: { check: TYPECHECK, refusal: 'the command “typecheck” is no longer in the catalogue' },
  play: async () => {
    const inside = await dialog()
    await userEvent.click(inside.getByRole('button', { name: 'Save' }))
    await expect(await inside.findByRole('alert')).toHaveTextContent('no longer in the catalogue')
    await expect(inside.getByRole('textbox', { name: 'Name' })).toHaveValue('typecheck')
    // The button comes back from its wait before the page is read.
    await waitFor(() => {
      expect(inside.getByRole('button', { name: 'Save' })).toHaveStyle({ opacity: '1' })
    })
  },
}

/** The keyboard walks the form in the order it is read, and Escape gives the focus back. */
export const Keyboard: Story = {
  args: { open: false },
  play: async ({ canvasElement, args }) => {
    const opener = within(canvasElement).getByRole('button', { name: 'Open the dialog' })
    opener.focus()
    await userEvent.keyboard('{Enter}')
    const inside = await dialog()
    inside.getByRole('textbox', { name: 'Name' }).focus()
    await userEvent.tab()
    await expect(inside.getByLabelText('Runs')).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByLabelText('Command')).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByLabelText('Where')).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByLabelText('When')).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByRole('checkbox', { name: /Expect a number/ })).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByRole('textbox', { name: 'Files' })).toHaveFocus()
    await userEvent.tab()
    await expect(inside.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
    await waitFor(() => expect(opener).toHaveFocus())
  },
}
