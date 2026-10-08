import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LONG_NEVER, NEVER_LINES, neverRefusal } from './agent-settings-fixtures.ts'
import { NeverForm, type NeverLine, NeverSection, type NeverSectionProps } from './never.tsx'
import { Dialog } from '../../components/dialog/dialog.tsx'
import { FormFoot } from './parts.tsx'
import { IconBan } from '../../icons.ts'

/**
 * The commands never run in a Project: whoever asks, an agent or Hemera Auto, they are refused
 * without asking the user. A line per command, in the mono face, its bin at its end; a command is
 * added in a dialog, and a line already refused is said so under its field.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Never run',
  component: NeverSection,
  parameters: { layout: 'fullscreen' },
  args: { lines: NEVER_LINES, onAdd: fn(), onRemove: fn() },
  argTypes: { lines: { table: { disable: true } } },
  render: (args) => <Held {...args} />,
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NeverSection>

export default meta
type Story = StoryObj<typeof meta>

/** The section holding its lines as the page does, with the dialog that adds one. */
function Held(args: NeverSectionProps) {
  const [lines, setLines] = useState<readonly NeverLine[]>(args.lines)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [tried, setTried] = useState(false)
  const error = tried ? neverRefusal(draft, lines) : undefined
  const close = (): void => {
    setAdding(false)
    setDraft('')
    setTried(false)
  }
  return (
    <>
      <NeverSection
        {...args}
        lines={lines}
        onAdd={() => {
          setAdding(true)
          args.onAdd()
        }}
        onRemove={(id) => {
          setLines((before) => before.filter((one) => one.id !== id))
          args.onRemove(id)
        }}
      />
      <Dialog
        title="Never run"
        lead={
          <span className="flex text-muted-foreground">
            <IconBan size="sm" />
          </span>
        }
        open={adding}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        actions={
          <FormFoot
            save="Add"
            onCancel={close}
            onSave={() => {
              setTried(true)
              if (neverRefusal(draft, lines) !== undefined) return
              setLines((before) => [
                ...before,
                { id: `n${String(before.length + 1)}`, line: draft.trim() },
              ])
              close()
            }}
          />
        }
      >
        <NeverForm value={draft} onChange={setDraft} error={error} />
      </Dialog>
    </>
  )
}

/** Acme's refusals: a force push, a publish, a prune, an apply. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Never run' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(within(list).getByText('git push --force')).toBeVisible()
  },
}

/** Nothing refused yet: the section says so, and offers the first line. */
export const Empty: Story = {
  args: { lines: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Nothing refused' })).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Refuse a command' })).toBeVisible()
  },
}

/** The lines on their way: each holds a line's own shape. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('list', { busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
    expect(canvas.queryByRole('button', { name: 'Refuse a command' })).toBeNull()
  },
}

/** A command added from the dialog joins the list; one already refused is said so. */
export const Adding: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Refuse a command' }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'Never run' })
    const field = within(dialog).getByRole('textbox', { name: 'Command' })
    await userEvent.type(field, 'pnpm publish')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(await within(dialog).findByText('“pnpm publish” is already refused.')).toBeVisible()
    await userEvent.clear(field)
    await userEvent.type(field, 'kubectl delete namespace acme')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    const list = canvas.getByRole('list', { name: 'Never run' })
    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    })
  },
}

/** A line removed by its bin leaves the list. */
export const Removing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remove pnpm publish' }))
    await waitFor(() => {
      expect(canvas.queryByText('pnpm publish')).toBeNull()
    })
    expect(
      within(canvas.getByRole('list', { name: 'Never run' })).getAllByRole('listitem'),
    ).toHaveLength(3)
  },
}

/** A long line ends in an ellipsis; its bin stays in sight. */
export const LongText: Story = {
  args: { lines: [...NEVER_LINES, LONG_NEVER] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = canvas.getByText(/prisma migrate reset/)
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
    expect(canvas.getByRole('button', { name: `Remove ${LONG_NEVER.line}` })).toBeVisible()
  },
}

/** From the keyboard: Add, then each line's bin in order, its ring in sight. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const add = canvas.getByRole('button', { name: 'Refuse a command' })
    add.focus()
    await userEvent.tab()
    const first = canvas.getByRole('button', { name: 'Remove git push --force' })
    expect(first).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Remove pnpm publish' })).toHaveFocus()
    add.focus()
    await userEvent.keyboard('{Enter}')
    const dialog = await within(document.body).findByRole('dialog', { name: 'Never run' })
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    expect(add).toHaveFocus()
  },
}

/** A change the engine refused: the list is back as the engine keeps it, and why is said. */
export const ChangeRefused: Story = {
  args: { error: 'The list could not be changed: Hemera could not write to its profile.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'The list could not be changed',
    )
  },
}
