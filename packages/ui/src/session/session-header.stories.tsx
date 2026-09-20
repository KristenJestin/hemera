import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Badge } from '../components/badge/badge.tsx'
import { IconMessage } from '../icons.ts'
import { SessionEmpty } from './session-empty.tsx'
import { SessionHeader } from './session-header.tsx'

/**
 * The head of a Session, on fixtures (design D4b-03, D4b-06).
 *
 * Every state it has is a story: the title as it is read, the title as it is typed, and a
 * Session that has been archived — which is the one state where the menu offers `Restore`
 * instead of `Archive`. What none of them has is a way to delete a Session, and one of the
 * plays below is there to say so out loud.
 */
const SUBTITLE = (
  <>
    <Badge tone="free" icon={<IconMessage size="sm" />}>
      free
    </Badge>
    <span>Atlas · created 3 d ago · 5 messages</span>
  </>
)

/** Held here rather than read back off the args: `onRestore` is optional, and a play is not. */
const restored = fn()

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Session/Header',
  component: SessionHeader,
  parameters: { layout: 'padded' },
  args: {
    title: 'CSV invoice export',
    subtitle: SUBTITLE,
    onRename: fn(),
    onArchive: fn(),
    onRestore: restored,
  },
  argTypes: {
    title: { control: 'text', description: 'Empty until a first message names the Session.' },
    archived: { control: 'boolean' },
    subtitle: { table: { disable: true } },
    onRename: { action: 'renamed' },
    onArchive: { action: 'archived' },
    onRestore: { action: 'restored' },
  },
} satisfies Meta<typeof SessionHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Read, archived, and never yet written in: the three shapes the same head takes. */
export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex flex-col gap-8">
      <SessionHeader {...args} />
      <SessionHeader {...args} title="Old billing thoughts" archived />
      <SessionHeader {...args} title="" subtitle="Atlas · just now" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Archived')).toBeInTheDocument()
    // Scenario « Session sans message »: the default title is shown, and it is a control.
    expect(canvas.getByRole('button', { name: 'Rename New session' })).toBeInTheDocument()
  },
}

/**
 * The title being typed: Enter keeps it, Escape leaves the Session called what it was called.
 *
 * Scenario « Renommage conservé », at the level this package answers for: what the header
 * reports is what was typed, and nothing else writes over it.
 */
export const States: Story = {
  play: async ({ canvasElement, args }) => {
    args.onRename.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Rename CSV invoice export' }))
    const box = await waitFor(() => canvas.getByRole('textbox', { name: 'Session title' }))
    expect(canvas.getByText('Enter to save · Esc to cancel')).toBeInTheDocument()

    await userEvent.clear(box)
    await userEvent.type(box, 'Invoices, HT and TTC{Enter}')
    expect(args.onRename).toHaveBeenCalledWith('Invoices, HT and TTC')

    // And Escape puts the title back without saying anything about it.
    args.onRename.mockClear()
    await userEvent.click(canvas.getByRole('button', { name: /^Rename/ }))
    const again = await waitFor(() => canvas.getByRole('textbox', { name: 'Session title' }))
    await userEvent.type(again, ' and more{Escape}')
    expect(args.onRename).not.toHaveBeenCalled()
    expect(canvas.getByRole('button', { name: 'Rename CSV invoice export' })).toBeInTheDocument()
  },
}

/** A Session nothing has been written in: it says so, and invents no first message. */
export const EmptySession: Story = {
  parameters: { controls: { disable: true } },
  args: { title: '', subtitle: 'Atlas · just now' },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <SessionHeader {...args} />
      <SessionEmpty />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Rename New session' })).toBeInTheDocument()
    expect(canvas.getByText('Nothing written yet')).toBeInTheDocument()
    expect(canvas.getByText(/Your first message names the Session/)).toBeInTheDocument()
  },
}

/**
 * Scenario « Aucune suppression proposée »: archiving is the whole end of a Session's life.
 *
 * Played on an archived Session as well as on a live one, because the menu is not the same
 * list in the two states and a deletion could only have crept into one of them.
 */
export const NoDeletion: Story = {
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Session actions' }))
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    expect(within(menu).getByRole('menuitem', { name: /^Rename/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /delete|remove/i })).toBeNull()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
  },
}

/** An archived Session: the badge says so, and the menu offers the way back. */
export const Archived: Story = {
  parameters: { controls: { disable: true } },
  args: { title: 'Old billing thoughts', archived: true, subtitle: 'Atlas · archived 3 d ago' },
  play: async ({ canvasElement }) => {
    restored.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Session actions' }))
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).toBeNull()

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Restore' }))
    expect(restored).toHaveBeenCalled()
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
  },
}

/** The head at the keyboard: the title renames, and the menu opens without a pointer. */
export const Keyboard: Story = {
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement, args }) => {
    args.onRename.mockClear()
    const canvas = within(canvasElement)
    const title = canvas.getByRole('button', { name: 'Rename CSV invoice export' })

    await userEvent.tab()
    expect(document.activeElement).toBe(title)

    // F2 is what the rest of the desktop renames with, and Enter is the button's own.
    await userEvent.keyboard('{F2}')
    const box = await waitFor(() => canvas.getByRole('textbox', { name: 'Session title' }))
    expect(document.activeElement).toBe(box)
    await userEvent.keyboard('{Escape}')

    // The menu is the next stop after the title, and it opens on its own key.
    const more = canvas.getByRole('button', { name: 'Session actions' })
    more.focus()
    await userEvent.keyboard('{ArrowDown}')
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    expect(within(menu).getByRole('menuitem', { name: /^Rename/ })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
    expect(document.activeElement).toBe(more)
  },
}
