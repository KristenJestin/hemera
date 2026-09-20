import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { Button } from '../components/button/button.tsx'
import {
  IconCommand,
  IconLayoutSidebar,
  IconPlus,
  IconSettings,
  IconSun,
  IconTimelineEvent,
} from '../icons.ts'
import { sessionCommands } from '../session/commands.tsx'
import { CommandPalette, type CommandGroup } from './command-palette.tsx'

/**
 * The palette, on fixtures (design D4-07).
 *
 * Everything it can do is handed to it: the stories write the entries a Project offers, and the
 * ones every Project offers, exactly as the application will. What is under test here is the
 * palette itself — what it shows, what it narrows to, and what the keyboard does to it.
 */
const switched = fn()

/** What the Session commands report, so a play can read what a chosen entry did. */
const openedSession = fn()

function projectsOf(names: [string, string][]): CommandGroup {
  return {
    label: 'Projects',
    entries: names.map(([id, name], index) => ({
      id: `switch-${id}`,
      label: `Switch to ${name}`,
      keys: `Ctrl+${index + 2}`,
      tone: 'info' as const,
      onSelect: () => switched(name),
    })),
  }
}

const SCOPED: CommandGroup[] = [
  {
    label: 'Go to',
    entries: [
      { id: 'home', label: 'Home', icon: <IconCommand size="sm" />, onSelect: fn() },
      { id: 'journal', label: 'Journal', icon: <IconTimelineEvent size="sm" />, onSelect: fn() },
      {
        id: 'project-settings',
        label: 'Project settings',
        icon: <IconSettings size="sm" />,
        onSelect: fn(),
      },
      {
        id: 'settings',
        label: 'Settings',
        keys: 'Ctrl+,',
        icon: <IconSettings size="sm" />,
        onSelect: fn(),
      },
    ],
  },
  projectsOf([
    ['notes', 'Notes'],
    ['docs', 'Hemera docs'],
  ]),
  {
    label: 'Appearance',
    entries: [
      { id: 'theme', label: 'Use the light theme', icon: <IconSun size="sm" />, onSelect: fn() },
      {
        id: 'fold',
        label: 'Fold the sidebar',
        keys: 'Ctrl+B',
        icon: <IconLayoutSidebar size="sm" />,
        onSelect: fn(),
      },
    ],
  },
]

/** What `>` widens to: the same places, named with the Project they belong to. */
const EVERYWHERE: CommandGroup[] = [
  {
    label: 'Journals',
    entries: [
      {
        id: 'journal-atlas',
        label: 'Journal',
        hint: 'Atlas',
        icon: <IconTimelineEvent size="sm" />,
        onSelect: fn(),
      },
      {
        id: 'journal-notes',
        label: 'Journal',
        hint: 'Notes',
        icon: <IconTimelineEvent size="sm" />,
        onSelect: fn(),
      },
    ],
  },
]

/** The two entries a window with no Project at all can honestly offer. */
const WITHOUT_A_PROJECT: CommandGroup[] = [
  {
    label: 'Projects',
    entries: [{ id: 'new', label: 'New Project…', icon: <IconPlus size="sm" />, onSelect: fn() }],
  },
  {
    label: 'Appearance',
    entries: [
      { id: 'theme', label: 'Use the light theme', icon: <IconSun size="sm" />, onSelect: fn() },
      {
        id: 'settings',
        label: 'Settings',
        keys: 'Ctrl+,',
        icon: <IconSettings size="sm" />,
        onSelect: fn(),
      },
    ],
  },
]

interface HarnessProps {
  scope?: string | null
  groups?: CommandGroup[]
  everywhere?: CommandGroup[]
  /** Whether it comes up already open, which is how every story but the playground shows it. */
  open?: boolean
}

function Harness({
  scope = 'Atlas',
  groups = SCOPED,
  everywhere = EVERYWHERE,
  open: opened = true,
}: HarnessProps) {
  const [open, setOpen] = useState(opened)
  return (
    <div className="flex h-screen flex-col items-start gap-2 p-6">
      <Button onClick={() => setOpen(true)}>Open the palette</Button>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        scope={scope}
        groups={groups}
        everywhere={everywhere}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Shell/CommandPalette',
  component: Harness,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    groups: { table: { disable: true } },
    everywhere: { table: { disable: true } },
  },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = { args: { open: false } }

/** Open on nothing typed: every group it has, in the order the caller handed them. */
export const Variants: Story = {
  play: async () => {
    const palette = within(document.body).getByRole('dialog', { name: 'Command palette' })
    expect(within(palette).getByText('Go to')).toBeInTheDocument()
    expect(within(palette).getByText('Projects')).toBeInTheDocument()
    // The first result is the one Enter would run, and it says so.
    expect(within(palette).getByRole('option', { name: /Home/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

/** What a query does: the groups that have nothing left go with their entries. */
export const States: Story = {
  play: async () => {
    const palette = within(document.body).getByRole('dialog', { name: 'Command palette' })
    const query = within(palette).getByRole('combobox')

    await userEvent.type(query, 'journ')
    await waitFor(() => {
      expect(within(palette).getByRole('option', { name: /Journal/ })).toBeInTheDocument()
    })
    expect(within(palette).queryByText('Appearance')).toBeNull()

    await userEvent.clear(query)
    await userEvent.type(query, 'nothing like this')
    await waitFor(() => {
      expect(within(palette).getByText(/Nothing matches/)).toBeInTheDocument()
    })
  },
}

/** Scenario « Changer de Projet par la palette » of `specs/shell-navigation/spec.md`. */
export const SwitchToAnotherProject: Story = {
  play: async () => {
    switched.mockClear()
    const palette = within(document.body).getByRole('dialog', { name: 'Command palette' })

    await userEvent.type(within(palette).getByRole('combobox'), 'Notes')
    await userEvent.click(await within(palette).findByRole('option', { name: /Switch to Notes/ }))

    expect(switched).toHaveBeenCalledWith('Notes')
    // Choosing closes it: a palette left open over the Project it just switched to is a page
    // the user has to dismiss before they can look at what they asked for.
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    })
  },
}

/** The `>` prefix: the header says so, and the results are every Project's. */
export const EveryProject: Story = {
  play: async () => {
    const palette = within(document.body).getByRole('dialog', { name: 'Command palette' })

    await userEvent.type(within(palette).getByRole('combobox'), '>')
    await waitFor(() => {
      expect(within(palette).getByText('Every Project')).toBeInTheDocument()
    })
    expect(within(palette).getAllByRole('option', { name: /Journal/ })).toHaveLength(2)
    expect(within(palette).queryByText('Go to')).toBeNull()
  },
}

/** Scenario « Palette sans Projet » of `specs/shell-navigation/spec.md`. */
export const WithoutAProject: Story = {
  args: { scope: null, groups: WITHOUT_A_PROJECT, everywhere: [] },
  play: async () => {
    const palette = within(document.body).getByRole('dialog', { name: 'Command palette' })

    expect(within(palette).getByRole('option', { name: /New Project/ })).toBeInTheDocument()
    expect(within(palette).getByRole('option', { name: /Settings/ })).toBeInTheDocument()
    expect(within(palette).getByRole('option', { name: /light theme/ })).toBeInTheDocument()
    // Nothing that supposes a Project: no Journal, no Project settings, and no scope to widen.
    expect(within(palette).queryByRole('option', { name: /Journal/ })).toBeNull()
    expect(within(palette).queryByText(/Scoped to/)).toBeNull()
    expect(within(palette).getByText('Hemera')).toBeInTheDocument()
  },
}

/** Scenario « Clavier » of `specs/shell-navigation/spec.md`. */
export const Keyboard: Story = {
  args: { open: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const opener = canvas.getByRole('button', { name: 'Open the palette' })
    opener.focus()
    await userEvent.keyboard('{Enter}')

    const palette = await within(document.body).findByRole('dialog', {
      name: 'Command palette',
    })
    const query = within(palette).getByRole('combobox')
    await waitFor(() => {
      expect(document.activeElement).toBe(query)
    })

    // Down moves the selection, and the field says which entry it is on.
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(within(palette).getByRole('option', { name: /Journal/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => {
      expect(within(palette).getByRole('option', { name: /Home/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })

    // Escape closes it, and the focus goes back where it was.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(opener)
    })
  },
}

/**
 * The Sessions in the palette: created, opened by title, archived, restored (design D4b-06).
 *
 * The groups come from `sessionCommands`, which is where the wording of a Session lives; the
 * palette itself is handed lists and callbacks and knows none of it. Opening one is not a
 * command that then asks which — every Session is an entry, so typing part of a title narrows
 * to it the way typing part of any other command does. Nothing here deletes anything.
 */
export const SessionCommands: Story = {
  args: {
    groups: [
      ...sessionCommands({
        sessions: [
          { id: 'csv', title: 'CSV invoice export', writtenAt: '12 min ago' },
          { id: 'search', title: 'Full-text search', writtenAt: 'yesterday' },
        ],
        archived: [{ id: 'billing', title: 'Old billing thoughts', archivedAt: '3 d ago' }],
        current: { id: 'csv', title: 'CSV invoice export' },
        newSessionKeys: 'Ctrl+N',
        onNewSession: fn(),
        onOpenSession: openedSession,
        onArchiveSession: fn(),
        onRestoreSession: fn(),
      }),
      ...SCOPED,
    ],
  },
  play: async () => {
    openedSession.mockClear()
    const palette = within(document.body).getByRole('dialog', { name: 'Command palette' })
    const inside = within(palette)

    expect(inside.getByRole('option', { name: /New session/ })).toBeInTheDocument()
    expect(inside.getByRole('option', { name: /Archive current session/ })).toBeInTheDocument()
    expect(inside.getByRole('option', { name: /Restore Old billing thoughts/ })).toBeInTheDocument()
    // Scenario « Aucune suppression proposée », here as everywhere else.
    expect(inside.queryByRole('option', { name: /Delete/ })).toBeNull()

    // Scenario « Travaux parallèles », from the palette: a Session is reached by its title.
    await userEvent.type(inside.getByRole('combobox'), 'full')
    await userEvent.click(await inside.findByRole('option', { name: /Full-text search/ }))
    expect(openedSession).toHaveBeenCalledWith('search')
  },
}
