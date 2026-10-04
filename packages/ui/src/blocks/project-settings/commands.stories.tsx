import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { type CommandDraft, CommandForm, CommandsSection, NEW_COMMAND } from './commands.tsx'
import { COMMANDS, DENSE_COMMANDS, LONG_LINE, shellRefusal } from './project-settings-fixtures.ts'

/**
 * A Project's command catalogue: one line per command — its type, its name, its line, where it
 * runs — and its roles read down the columns, each named by its glyph at the head. A line opens
 * the command's sheet, drawn here as its form, where shell syntax is refused as it is typed.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Commands',
  component: CommandsSection,
  parameters: { layout: 'fullscreen' },
  args: { commands: COMMANDS, onOpen: fn(), onAdd: fn() },
  argTypes: { commands: { table: { disable: true } } },
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommandsSection>

export default meta
type Story = StoryObj<typeof meta>

/** Nine commands; a line says its roles in words to a screen reader. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(
      within(canvas.getByRole('list', { name: 'Commands' })).getAllByRole('listitem'),
    ).toHaveLength(9)
    const db = canvas.getByRole('button', { name: /^db\b/ })
    expect(db).toHaveAccessibleName(
      /a service of the main checkout, runs at each opening, asks before running/,
    )
    await userEvent.click(db)
    expect(args.onOpen).toHaveBeenCalledWith('db')
  },
}

/** No command yet: Hemera asleep, and the way to add one. */
export const Empty: Story = {
  args: { commands: [] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'No command yet' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a command' }))
    expect(args.onAdd).toHaveBeenCalled()
  },
}

/** Twenty commands: the columns hold, every line the same height. */
export const Dense: Story = {
  args: { commands: DENSE_COMMANDS },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByRole('listitem')
    expect(rows).toHaveLength(20)
    const lines = rows.map((row) => within(row).getByRole('button'))
    const height = lines[0]!.getBoundingClientRect().height
    for (const line of lines) expect(line.getBoundingClientRect().height).toBe(height)
  },
}

/** On their way: the rows' own shape under the head of the columns. */
export const Loading: Story = {
  args: { commands: [], loading: true },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('list', { busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(4)
  },
}

/** A long line: it ends in an ellipsis in its column, and the roles stay in theirs. */
export const LongText: Story = {
  args: {
    commands: [
      ...COMMANDS,
      { ...COMMANDS[3]!, id: 'long', name: 'integration-tests-of-the-platform', line: LONG_LINE },
    ],
  },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByText(LONG_LINE)
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
    expect(line.scrollWidth).toBeGreaterThan(line.clientWidth)
  },
}

/** The head of the columns: each glyph says what its column means. */
export const Legends: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const legend of [
      'Used as a check',
      'Service, with its address',
      'Runs at each opening',
      'Asks before running',
      'What it may write',
      'Its own line on Linux, macOS or Windows',
    ]) {
      expect(canvas.getByRole('img', { name: legend })).toBeInTheDocument()
    }
    await userEvent.hover(canvas.getByRole('img', { name: 'Asks before running' }))
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Asks before running')
    })
  },
}

/** From the keyboard: Add, then the legends, then the lines; Enter opens one. */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Add a command' })).toHaveFocus()
    canvas.getByRole('button', { name: /^api-dev\b/ }).focus()
    await userEvent.tab()
    const web = canvas.getByRole('button', { name: /^web-dev\b/ })
    expect(web).toHaveFocus()
    await waitFor(() => {
      expect(getComputedStyle(web, '::after').opacity).toBe('1')
    })
    await userEvent.keyboard('{Enter}')
    expect(args.onOpen).toHaveBeenCalledWith('web-dev')
  },
}

/** The form of a command's sheet, holding its draft and checking its lines as the engine would. */
function Sheet({ draft: first }: { draft: CommandDraft }) {
  const [draft, setDraft] = useState(first)
  return (
    <div className="mx-auto flex w-full max-w-view-narrow flex-col gap-5 p-4">
      <CommandForm
        draft={draft}
        onChange={setDraft}
        places={['api', 'web', 'shared']}
        refusalOf={shellRefusal}
      />
    </div>
  )
}

const { id: _test, ...TEST } = COMMANDS[3]!
const { id: _build, ...BUILD } = COMMANDS[6]!
const { id: _db, ...DB } = COMMANDS[2]!

/** The sheet of `test`: its type, its line, where it runs, its roles, the files it may write. */
export const SheetEdit: Story = {
  render: () => <Sheet draft={TEST} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox', { name: 'Line' })).toHaveValue('pnpm --filter api test')
    expect(canvas.getByRole('checkbox', { name: 'Used as a check' })).toBeChecked()
    expect(canvas.getByRole('textbox', { name: 'Files it may write' })).toHaveValue('coverage/**')
  },
}

/** Shell syntax typed in a line: refused at once, the token named; the line is kept as typed. */
export const SheetShellSyntax: Story = {
  render: () => <Sheet draft={TEST} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = canvas.getByRole('textbox', { name: 'Line' })
    await userEvent.type(line, ' | tee out.log')
    expect(await canvas.findByText(/“\|” is shell syntax/)).toBeVisible()
    expect(line).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(line, '{Backspace>14/}')
    await waitFor(() => {
      expect(canvas.queryByText(/is shell syntax/)).toBeNull()
    })
  },
}

/** A line of its own for Windows: the fold opens on it, the common line as each one's placeholder. */
export const SheetPerSystem: Story = {
  render: () => <Sheet draft={BUILD} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('button', { name: 'Lines for Linux, macOS and Windows' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(canvas.getByRole('textbox', { name: 'Line on Windows' })).toHaveValue(
      'pnpm build:windows',
    )
    expect(canvas.getByRole('textbox', { name: 'Line on macOS' })).toHaveAttribute(
      'placeholder',
      'pnpm build',
    )
    expect(canvas.getByRole('textbox', { name: 'Line on Linux' })).toHaveAttribute(
      'placeholder',
      'pnpm build',
    )
  },
}

/** A service: where it runs once — per Workspace, or in the main checkout — and its roles. */
export const SheetService: Story = {
  render: () => <Sheet draft={DB} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('combobox', { name: 'Runs' })).toHaveTextContent(
      'Once, in the main checkout',
    )
    expect(canvas.getByRole('checkbox', { name: 'Asks before running' })).toBeChecked()
  },
}

/** The names Hemera fills, offered by the braces at the end of a line. */
export const SheetTemplateNames: Story = {
  render: () => (
    <Sheet draft={{ ...NEW_COMMAND, name: 'reset-db', line: 'pnpm db:reset --name acme_' }} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Insert a name in Line' }))
    await userEvent.click(
      await within(document.body).findByRole('menuitem', {
        name: /\{workspace\}\s*Workspace name/,
      }),
    )
    expect(canvas.getByRole('textbox', { name: 'Line' })).toHaveValue(
      'pnpm db:reset --name acme_{workspace}',
    )
  },
}

/** A command not written yet. */
export const SheetNew: Story = {
  render: () => <Sheet draft={NEW_COMMAND} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox', { name: 'Name' })).toHaveValue('')
    expect(canvas.getByRole('combobox', { name: 'Type' })).toHaveTextContent('Script')
  },
}
