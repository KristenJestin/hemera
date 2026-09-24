import type { Meta, StoryObj } from '@storybook/react-vite'
import { cn } from 'cn'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import {
  ArchivedSessions,
  SessionEmpty,
  SessionHeader,
  type SessionHeaderProps,
  SidebarSessionEntry,
} from './session.tsx'

/**
 * The Session, in the four places it is seen (design D4b-07, D4b-08).
 *
 * On fixtures, and on purpose: this lot draws the Session and nothing behind it. A title is
 * renamed, a Session is archived and restored, and no engine is asked for anything — what the
 * stories assert is what the page shows and what it says it will do, which is the whole of
 * what there is to check before the thread is persisted for real.
 *
 * This file, the page and the whole Session an agent fills are the single entry
 * `Surfaces/Session`. Three files under one title cannot each carry `Playground`, `Variants`
 * and `States` — Storybook refuses a story id twice — so those three stay with the page, which
 * is the screen itself, and what is shown here is named after the state it shows.
 */

/**
 * The page's half of the title: it holds the name and whether the field is open.
 *
 * Written out rather than hidden, because it is exactly what the application does with the
 * same component — keep the name, open the field, keep what comes back — and because a rename
 * that never reached the page would be a story that proves nothing about the page.
 */
function Harness({ title, editing = false, ...rest }: SessionHeaderProps) {
  const [name, setName] = useState(title)
  const [open, setOpen] = useState(editing)
  return (
    <SessionHeader
      {...rest}
      title={name}
      editing={open}
      onRename={(next) => {
        rest.onRename(next)
        setName(next)
        setOpen(false)
      }}
      onStartEditing={() => setOpen(true)}
      onCancelEditing={() => setOpen(false)}
    />
  )
}

/** What the page does with what it is told, on fixtures: one spy per act, cleared per story. */
const RESTORED = fn()
const SELECTED = fn()
const RENAMED_A_SESSION = fn()
const ARCHIVED_A_SESSION = fn()

const ARCHIVED_SESSIONS = [
  {
    id: 'billing',
    title: 'Old billing thoughts',
    archivedAt: '3 days ago',
    detail: '5 messages · last written 2 weeks ago',
  },
  {
    id: 'onboarding',
    title: 'Onboarding checklist',
    archivedAt: 'last month',
    detail: '1 message',
  },
]

const SESSIONS = [
  { id: 'csv', title: 'CSV invoice export' },
  { id: 'search', title: 'Full-text search' },
  { id: 'drizzle', title: 'Migrate to Drizzle 1.0' },
]

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Session',
  component: SessionHeader,
  render: (args) => <Harness {...args} />,
  parameters: { layout: 'padded' },
  args: {
    title: 'CSV invoice export',
    projectName: 'Atlas',
    meta: 'created 3 days ago · 5 messages',
    editing: false,
    archiveDisabled: false,
    onRename: fn(),
    onStartEditing: fn(),
    onCancelEditing: fn(),
    onArchive: fn(),
  },
  argTypes: {
    title: { control: 'text', description: 'What the Session is called.' },
    projectName: { control: 'text', description: 'The Project it belongs to.' },
    meta: {
      control: 'text',
      description: "The rest of the head's line, already written for the platform.",
    },
    editing: { control: 'boolean', description: 'Whether the title is being typed right now.' },
    archiveDisabled: {
      control: 'boolean',
      description: 'Whether there is anything to archive yet.',
    },
    onRename: { control: false, description: 'What the title becomes, on Enter.' },
    onStartEditing: { control: false, description: 'Opens the field.' },
    onCancelEditing: { control: false, description: 'Closes it without keeping what was typed.' },
    onArchive: { control: false, description: 'Takes the Session out of the sidebar.' },
    onOpenDetails: {
      control: false,
      description: 'Opens the Session details: its activity, its commands and its context.',
    },
  },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A Session with a name, a Project, and the menu that holds what can be done to it.
 *
 * The head is one line (review of #40, defect 4): the title, the Project it lives in, and the
 * `…` at the end of the same line. The title is itself the control that opens the field, because
 * the hand that wants the name changed is already on the words.
 */
export const Named: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('CSV invoice export')
    expect(canvas.getByText('Atlas · created 3 days ago · 5 messages')).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'CSV invoice export' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Commands for CSV invoice export' })).toBeEnabled()
    // Nothing is being typed, so there is no field: the title is a heading until it is not.
    expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/**
 * The head and the row in the shapes they are drawn in: the title read and the title typed
 * into, and a Session's line at the panel's width and folded to its rail.
 *
 * The two heads are the same head — only whether the name is being typed changes — and the two
 * panels are the same panel, so what a reader learns from one is true of the other.
 */
export const ReadAndTyped: Story = {
  parameters: { layout: 'padded', controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-8">
      <Harness
        title="CSV invoice export"
        projectName="Atlas"
        meta="created 3 days ago · 5 messages"
        onRename={fn()}
        onArchive={fn()}
      />
      <Harness
        title="CSV invoice export"
        projectName="Atlas"
        meta="created 3 days ago · 5 messages"
        editing
        onRename={fn()}
        onArchive={fn()}
      />
      <div className="flex items-start gap-4">
        <Panel active="search" onRename={RENAMED_A_SESSION} onArchive={ARCHIVED_A_SESSION} />
        <Panel collapsed />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // The title is read or it is typed into, and never both at once: while it is a field,
    // Rename is the field itself.
    expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(canvas.getAllByRole('textbox')).toHaveLength(1)
    expect(canvas.getByRole('textbox', { name: 'Title of the Session' })).toHaveValue(
      'CSV invoice export',
    )

    // A row is the same row at either width: the name is always there, and the two commands are
    // the part that goes with the room. The head carries one control of its own — the `…` at the
    // end of its line — and the row's two commands are still named by the Session they act on.
    expect(canvas.getAllByRole('button', { name: 'CSV invoice export' })).toHaveLength(3)
    expect(canvas.getAllByRole('button', { name: 'Commands for CSV invoice export' })).toHaveLength(
      2,
    )
    expect(canvas.getAllByRole('button', { name: /^Rename / })).toHaveLength(3)
    expect(canvas.getAllByRole('button', { name: /^Archive / })).toHaveLength(3)
  },
}

/**
 * The three states a Session is seen in, one under the other: nobody has written in it yet, it
 * has been named and written in, and it was taken out of the sidebar.
 *
 * A new Session has nothing to archive, and its Archive is drawn refused rather than hidden, so
 * the head is the same head before and after the first line is written. An archived Session is
 * kept whole and has one verb, because nothing in this lot is ever deleted.
 */
export const NewNamedAndArchived: Story = {
  parameters: { layout: 'padded', controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-10">
      <div className="flex flex-col gap-6">
        <Harness
          title="Untitled"
          projectName="Atlas"
          meta="just now"
          editing
          archiveDisabled
          onRename={fn()}
          onArchive={fn()}
        />
        <SessionEmpty />
      </div>
      <Harness
        title="CSV invoice export"
        projectName="Atlas"
        meta="created 3 days ago · 5 messages"
        onRename={fn()}
        onArchive={fn()}
      />
      <ArchivedSessions sessions={ARCHIVED_SESSIONS} onRestore={RESTORED} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    RESTORED.mockClear()
    const canvas = within(canvasElement)

    // New: the page says nothing has been written, and offers nothing to archive.
    expect(canvas.getByText('Nothing written yet')).toBeInTheDocument()
    // The command is refused rather than hidden, so the head is the same head before and after
    // the first line is written — it is drawn in the menu, and it does not act. A field being
    // typed into carries no Rename either: the field is the renaming.
    await userEvent.click(canvas.getByRole('button', { name: 'Commands for Untitled' }))
    const fresh = await waitFor(() => within(document.body).getByRole('menu'))
    expect(within(fresh).getByRole('menuitem', { name: /Archive/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    // And Rename is offered all the same: a Session with nothing written in it still has a name
    // to give, and the field is the only way to give it.
    expect(within(fresh).getByRole('menuitem', { name: /Rename/ })).toBeEnabled()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })

    // Named: the title is a heading again, over the Project it belongs to.
    expect(
      canvas.getByRole('heading', { level: 1, name: 'CSV invoice export' }),
    ).toBeInTheDocument()

    // Archived: kept whole, and one press brings it back.
    expect(
      canvas.getByText('archived 3 days ago · 5 messages · last written 2 weeks ago'),
    ).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Restore Old billing thoughts' }))
    expect(RESTORED).toHaveBeenCalledWith('billing')
  },
}

/**
 * Renaming: the title is edited where it stands, and it is kept when it is said so.
 *
 * Enter is the whole of the save. The field opens on the name it already had, the page is told
 * once, and the head goes back to a heading — which is what the story asserts, because a field
 * that stayed open after a save would be a field that never saved anything.
 */
export const Renaming: Story = {
  play: async ({ canvasElement, args }) => {
    args.onRename.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'CSV invoice export' }))
    const field = canvas.getByRole('textbox', { name: 'Title of the Session' })
    expect(field).toHaveValue('CSV invoice export')
    expect(canvas.getByText('Enter to save · Esc to cancel')).toBeInTheDocument()
    // While it is being typed, Rename is the field: the title is not a control, and a second
    // control for the same act would be a control that does nothing.
    expect(canvas.queryByRole('button', { name: 'CSV invoice export' })).toBeNull()

    await userEvent.clear(field)
    await userEvent.type(field, 'Invoices, one file a month')
    await userEvent.keyboard('{Enter}')

    expect(args.onRename).toHaveBeenCalledTimes(1)
    expect(args.onRename).toHaveBeenCalledWith('Invoices, one file a month')
    await waitFor(() => {
      expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Invoices, one file a month',
      )
    })
    // And the keyboard is back where it was: the title, which is the control that opened the
    // field, has it again — rather than the page dropping it at the top of everything.
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Invoices, one file a month' })).toHaveFocus()
    })
  },
}

/**
 * Escape: what was typed is let go, and the Session keeps the name it had.
 *
 * A name is not a thing to lose to a keystroke pressed by accident, so the way out of the
 * field is a way out and not a save.
 */
export const EscapingTheField: Story = {
  play: async ({ canvasElement, args }) => {
    args.onRename.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'CSV invoice export' }))
    const field = canvas.getByRole('textbox', { name: 'Title of the Session' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Something I thought better of')
    await userEvent.keyboard('{Escape}')

    expect(args.onRename).not.toHaveBeenCalled()
    expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('CSV invoice export')
    expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/**
 * A name is not empty: Enter on a field nobody typed in is the way out, not a Session that has
 * lost the name it had.
 */
export const AnEmptyTitleIsNoName: Story = {
  play: async ({ canvasElement, args }) => {
    args.onRename.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'CSV invoice export' }))
    const field = canvas.getByRole('textbox', { name: 'Title of the Session' })
    await userEvent.clear(field)
    await userEvent.keyboard('{Enter}')

    expect(args.onRename).not.toHaveBeenCalled()
    expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('CSV invoice export')
  },
}

/**
 * Leaving the field is an ending like any other (recette of 20 September).
 *
 * The field closes when the caret leaves it: a question left open in the head of a page is a
 * question asked again every time the eye passes over it, and a field that stays open after the
 * person is done with it never got its answer. What was typed is kept, because whoever typed it
 * meant it — and leaving it without having typed anything is not a renaming, so the name the
 * Project derived is still the name it derived.
 */
export const LeavingTheField: Story = {
  play: async ({ canvasElement, args }) => {
    args.onRename.mockClear()
    const canvas = within(canvasElement)

    // Typed, then left: kept, and the field is gone.
    await userEvent.click(canvas.getByRole('button', { name: 'CSV invoice export' }))
    const field = canvas.getByRole('textbox', { name: 'Title of the Session' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Invoices, quarterly')
    await userEvent.click(document.body)
    await waitFor(() => {
      expect(canvas.queryByRole('textbox')).toBeNull()
    })
    expect(args.onRename).toHaveBeenCalledWith('Invoices, quarterly')

    // Opened and left without a word: the field closes, and nothing was renamed.
    args.onRename.mockClear()
    await userEvent.click(canvas.getByRole('button', { name: 'Invoices, quarterly' }))
    await userEvent.click(document.body)
    await waitFor(() => {
      expect(canvas.queryByRole('textbox')).toBeNull()
    })
    expect(args.onRename).not.toHaveBeenCalled()
  },
}

/**
 * A new Session, empty, with its title open (the prototype's screen 5).
 *
 * The field has the caret, because the name is the one thing this Session has to say about
 * itself, and Archive is drawn refused: there is nothing written to keep, and a row in a list
 * of things the user never meant to make is a row that has to be tidied away afterwards. The
 * head and the empty thread are the whole page — no entry is faked to fill it.
 */
export const NewAndEmpty: Story = {
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  args: { title: 'Untitled', meta: 'just now', editing: true, archiveDisabled: true },
  render: (args) => (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <Harness {...args} />
      <SessionEmpty />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const field = canvas.getByRole('textbox', { name: 'Title of the Session' })
    expect(field).toHaveValue('Untitled')
    await waitFor(() => {
      expect(field).toHaveFocus()
    })
    // Archive is drawn refused rather than hidden, so the head is the same head before and after
    // the first line is written.
    await userEvent.click(canvas.getByRole('button', { name: 'Commands for Untitled' }))
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    expect(within(menu).getByRole('menuitem', { name: /Archive/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
    expect(canvas.getByText('Nothing written yet')).toBeInTheDocument()
  },
}

/**
 * The head's two commands, behind one menu at the end of its line (review of #40, defect 4).
 *
 * The menu is reached by the keyboard like any other control: the title comes first in the tab
 * order, and the `…` after it opens on an arrow and hands the focus back on Escape. Rename is not
 * an act of its own — it opens the field — so having read the menu renames nothing, and Archive
 * is the one command that does something.
 */
export const TheHeadCommands: Story = {
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement, args }) => {
    args.onRename.mockClear()
    args.onArchive?.mockClear()
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Commands for CSV invoice export' })

    // The title is the first control of the page: the hand that wants the name changed is on it.
    await userEvent.tab()
    expect(document.activeElement).toBe(canvas.getByRole('button', { name: 'CSV invoice export' }))

    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    await userEvent.keyboard('{ArrowDown}')
    const menu = await waitFor(() => within(document.body).getByRole('menu'))

    await userEvent.click(within(menu).getByRole('menuitem', { name: /Rename/ }))
    const field = canvas.getByRole('textbox', { name: 'Title of the Session' })
    expect(field).toHaveValue('CSV invoice export')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(canvas.queryByRole('textbox')).toBeNull()
    })
    expect(args.onRename).not.toHaveBeenCalled()

    // Archive is the command that acts, once.
    await userEvent.click(trigger)
    const again = await waitFor(() => within(document.body).getByRole('menu'))
    await userEvent.click(within(again).getByRole('menuitem', { name: /Archive/ }))
    expect(args.onArchive).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
  },
}

/**
 * The Session's details are one press away, at the end of the head's line, before the `…`: what
 * the turn has done, what the Session runs and what its agent works from.
 */
export const DetailsWithinReach: Story = {
  parameters: { controls: { disable: true } },
  args: { onOpenDetails: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const details = canvas.getByRole('button', { name: 'Session details' })
    const menu = canvas.getByRole('button', { name: 'Commands for CSV invoice export' })
    expect(details.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(details)
    expect(args.onOpenDetails).toHaveBeenCalledTimes(1)
  },
}

/** What a thread says before anything is written in it. */
export const NothingWrittenYet: Story = {
  parameters: { controls: { disable: true } },
  render: () => <SessionEmpty />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Nothing written yet')).toBeInTheDocument()
    expect(canvas.getByText(/names the Session for you/)).toBeInTheDocument()
    // Nothing under it stands in for a message: no group, no line, no list of them.
    expect(canvasElement.querySelectorAll('[role="group"]')).toHaveLength(0)
    expect(canvas.queryAllByRole('listitem')).toHaveLength(0)
  },
}

/**
 * What was taken out of the sidebar, and the one way back.
 *
 * Nothing is deleted in this lot, so the page has one verb per row and no second control to
 * delete anything with — and an archived Session is restored whole, which is why the row says
 * what it holds rather than only when it left.
 */
export const Archives: Story = {
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  render: () => <ArchivedSessions sessions={ARCHIVED_SESSIONS} onRestore={RESTORED} />,
  play: async ({ canvasElement }) => {
    RESTORED.mockClear()
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Archived Sessions')
    expect(
      canvas.getByText('archived 3 days ago · 5 messages · last written 2 weeks ago'),
    ).toBeInTheDocument()
    expect(canvas.getByText('archived last month · 1 message')).toBeInTheDocument()
    // One way back per row, and each of them says which Session it brings back.
    expect(canvas.getAllByRole('button', { name: /^Restore / })).toHaveLength(2)
    expect(canvas.queryByRole('button', { name: /Delete|Remove/ })).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: 'Restore Old billing thoughts' }))
    expect(RESTORED).toHaveBeenCalledWith('billing')
  },
}

/** Nothing archived yet, which is the usual state of a Project and not a page that failed. */
export const NoArchive: Story = {
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  render: () => <ArchivedSessions sessions={[]} onRestore={RESTORED} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByText('No Session has been archived. Nothing is ever deleted.'),
    ).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: /^Restore / })).toBeNull()
  },
}

/**
 * The panel's column of Sessions, as the sidebar draws it.
 *
 * The panel around the entries is the story's own: what is under test is the row, and the row
 * is the same at either width — which is why the rail is a story of its own rather than a
 * control on this one.
 */
function Panel({
  collapsed = false,
  active = 'csv',
  onRename,
  onArchive,
}: {
  collapsed?: boolean
  active?: string
  onRename?: (id: string) => void
  onArchive?: (id: string) => void
}) {
  return (
    <TooltipProvider>
      <div
        className={cn(
          'flex flex-col gap-1 bg-sidebar p-2',
          collapsed ? 'w-sidebar-rail' : 'w-sidebar',
        )}
      >
        {SESSIONS.map((session) => (
          <SidebarSessionEntry
            key={session.id}
            title={session.title}
            active={session.id === active}
            collapsed={collapsed}
            onSelect={SELECTED}
            onRename={onRename === undefined ? undefined : () => onRename(session.id)}
            onArchive={onArchive === undefined ? undefined : () => onArchive(session.id)}
          />
        ))}
      </div>
    </TooltipProvider>
  )
}

/** One Session is the one being looked at, and the mark says which. */
export const InTheSidebar: Story = {
  parameters: { layout: 'padded', controls: { disable: true } },
  render: () => <Panel active="search" />,
  play: async ({ canvasElement }) => {
    SELECTED.mockClear()
    const canvas = within(canvasElement)
    const marked = canvas
      .getAllByRole('button')
      .filter((one) => one.getAttribute('aria-current') === 'true')

    // One filled surface and not three: a panel marking two entries is a panel saying the
    // window is in two places.
    expect(marked).toHaveLength(1)
    expect(marked[0]).toHaveAccessibleName('Full-text search')

    await userEvent.click(canvas.getByRole('button', { name: 'Migrate to Drizzle 1.0' }))
    expect(SELECTED).toHaveBeenCalled()
  },
}

/**
 * Folded to the rail, a row is its icon and nothing else.
 *
 * The two commands of the row go with the name: there is no room for them beside an icon, and
 * a control drawn over the icon of the row it acts on is a control nobody can read. The name
 * is still the row's own, which is what the tooltip and the screen reader both say.
 */
export const FoldedToTheRail: Story = {
  parameters: { layout: 'padded', controls: { disable: true } },
  render: () => <Panel collapsed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'CSV invoice export' })).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: /^Rename / })).toBeNull()
    expect(canvas.queryByRole('button', { name: /^Archive / })).toBeNull()
  },
}

/**
 * The row's own two commands, under the hand that is on it.
 *
 * They are siblings of the row and never inside it — a button in a button is not a row anybody
 * can press — and they are named by the Session they act on, since a column of Rename buttons
 * is a column a screen reader cannot tell one row of from the next.
 */
export const TheRowCommands: Story = {
  parameters: { layout: 'padded', controls: { disable: true } },
  render: () => (
    <Panel active="search" onRename={RENAMED_A_SESSION} onArchive={ARCHIVED_A_SESSION} />
  ),
  play: async ({ canvasElement }) => {
    RENAMED_A_SESSION.mockClear()
    ARCHIVED_A_SESSION.mockClear()
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: 'Full-text search' })

    await userEvent.hover(row)
    await userEvent.click(canvas.getByRole('button', { name: 'Rename Full-text search' }))
    expect(RENAMED_A_SESSION).toHaveBeenCalledWith('search')

    await userEvent.hover(row)
    await userEvent.click(canvas.getByRole('button', { name: 'Archive Full-text search' }))
    expect(ARCHIVED_A_SESSION).toHaveBeenCalledWith('search')
  },
}
