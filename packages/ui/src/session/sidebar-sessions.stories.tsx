import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { ShellSession } from '../shell/model.ts'
import { SidebarSessions } from './sidebar-sessions.tsx'

/**
 * The Sessions as the sidebar lists them, on fixtures (design D4b-04, D4b-06).
 *
 * Drawn on the panel's own surface, because that is the only surface these rows are ever seen
 * on: judged on the content surface they would be judged on a contrast they never have.
 *
 * The stories are the states the list has: five Sessions with one of them being read, none at
 * all, a row's menu open, and a row being renamed in place. The archived line appears with the
 * first archived Session and not before.
 */
const SESSIONS: ShellSession[] = [
  { id: 'csv', title: 'CSV invoice export', writtenAt: '12 min ago' },
  { id: 'search', title: 'Full-text search', writtenAt: 'yesterday' },
  { id: 'drizzle', title: 'Migrate to Drizzle 1.0', writtenAt: '3 d ago' },
  { id: 'imports', title: 'Bank imports', writtenAt: 'last week' },
  { id: 'fresh', title: '', writtenAt: 'just now' },
]

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Session/Sidebar',
  component: SidebarSessions,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="flex w-sidebar flex-col gap-1 rounded-lg bg-sidebar p-2 text-sidebar-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    sessions: SESSIONS,
    activeId: 'csv',
    archivedCount: 2,
    onSelect: fn(),
    onCreate: fn(),
    onRename: fn(),
    onArchive: fn(),
    onOpenArchived: fn(),
  },
  argTypes: {
    sessions: { control: 'object', description: 'Last written first; this list does not sort.' },
    activeId: { control: 'text' },
    archivedCount: { control: 'number' },
    collapsed: { control: 'boolean' },
    onSelect: { action: 'selected' },
    onCreate: { action: 'created' },
    onRename: { action: 'renamed' },
    onArchive: { action: 'archived' },
    onOpenArchived: { action: 'archives opened' },
  },
} satisfies Meta<typeof SidebarSessions>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Five Sessions, the one being read marked, and the line to the two that are archived. */
export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement, args }) => {
    args.onSelect.mockClear()
    args.onOpenArchived.mockClear()
    const canvas = within(canvasElement)

    // The Session being read is the one marked, and it is the only one.
    const marked = canvas
      .getAllByRole('button')
      .filter((one) => one.getAttribute('aria-current') === 'true')
    expect(marked).toHaveLength(1)
    expect(marked[0]).toHaveAccessibleName('CSV invoice export')

    // A Session no message has named yet is listed under the title it is drawn with.
    expect(canvas.getByText('New session')).toBeInTheDocument()
    expect(canvas.getByText('12 min ago')).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Full-text search' }))
    expect(args.onSelect).toHaveBeenCalledWith('search')

    await userEvent.click(canvas.getByRole('button', { name: '2 archived' }))
    expect(args.onOpenArchived).toHaveBeenCalled()
  },
}

/**
 * Scenario « Aucune Session »: the state is said, creation is offered, nothing is invented.
 *
 * The archived line goes with it: nothing archived, nothing to say about archives.
 */
export const States: Story = {
  args: { sessions: [], activeId: null, archivedCount: 0 },
  play: async ({ canvasElement, args }) => {
    args.onCreate.mockClear()
    const canvas = within(canvasElement)

    expect(canvas.getByText('No Session yet')).toBeInTheDocument()
    expect(canvas.queryByText(/archived/)).toBeNull()
    // Nothing stands in for a Session: the one control here is the one that creates one.
    expect(canvas.getAllByRole('button')).toHaveLength(1)

    await userEvent.click(canvas.getByRole('button', { name: 'New session' }))
    expect(args.onCreate).toHaveBeenCalled()
  },
}

/** A row's menu: renamed or archived, and nothing that takes a Session away. */
export const EntryMenu: Story = {
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement, args }) => {
    args.onArchive.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Actions for Full-text search' }))
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    expect(within(menu).getByRole('menuitem', { name: /^Rename/ })).toBeInTheDocument()
    // Scenario « Aucune suppression proposée », in the one place a row offers anything.
    expect(within(menu).queryByRole('menuitem', { name: /delete|remove/i })).toBeNull()

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }))
    expect(args.onArchive).toHaveBeenCalledWith('search')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
  },
}

/** Renamed where it is read: Enter keeps what was typed, Escape leaves the row alone. */
export const InlineRenaming: Story = {
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement, args }) => {
    args.onRename.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Actions for CSV invoice export' }))
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Rename/ }))

    const box = await waitFor(() =>
      canvas.getByRole('textbox', { name: 'Rename CSV invoice export' }),
    )
    await userEvent.clear(box)
    await userEvent.type(box, 'Invoices, HT and TTC{Enter}')
    expect(args.onRename).toHaveBeenCalledWith('csv', 'Invoices, HT and TTC')

    // And the same row, refused: Escape puts the title back and says nothing.
    args.onRename.mockClear()
    await userEvent.click(canvas.getByRole('button', { name: 'Actions for CSV invoice export' }))
    const again = await waitFor(() => within(document.body).getByRole('menu'))
    await userEvent.click(within(again).getByRole('menuitem', { name: /^Rename/ }))
    const box2 = await waitFor(() =>
      canvas.getByRole('textbox', { name: 'Rename CSV invoice export' }),
    )
    await userEvent.type(box2, ' again{Escape}')
    expect(args.onRename).not.toHaveBeenCalled()
    expect(canvas.getByRole('button', { name: 'CSV invoice export' })).toBeInTheDocument()
  },
}

/** The list at the keyboard: every row, and every row's menu, without a pointer. */
export const Keyboard: Story = {
  parameters: { controls: { disable: true } },
  args: { sessions: SESSIONS.slice(0, 2), archivedCount: 0 },
  play: async () => {
    // The creation of a Session first, then each row and the menu that belongs to it.
    await userEvent.tab()
    expect(document.activeElement).toHaveAccessibleName('New session')
    await userEvent.tab()
    expect(document.activeElement).toHaveAccessibleName('CSV invoice export')
    await userEvent.tab()
    expect(document.activeElement).toHaveAccessibleName('Actions for CSV invoice export')

    await userEvent.keyboard('{ArrowDown}')
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    expect(within(menu).getByRole('menuitem', { name: /^Rename/ })).toBeInTheDocument()

    // Closed, and the focus handed back to the control that opened it.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
    expect(document.activeElement).toHaveAccessibleName('Actions for CSV invoice export')
  },
}
