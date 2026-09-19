import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import {
  NotificationBell,
  NotificationList,
  type NotificationLine,
  type NotificationListProps,
} from './notifications.tsx'

/**
 * The bell and its list, on fixtures (design D4-05, D4-07).
 *
 * The lines are every Project's, which is the whole point: the bell is the one place a Project
 * that is not in front can still say something happened.
 */
const opened = fn()

const ENTRIES: NotificationLine[] = [
  {
    sequence: 61,
    label: 'Repository ./sources/api added',
    projectName: 'Atlas',
    tone: 'primary',
    when: '2 min ago',
    onOpen: opened,
  },
  {
    sequence: 60,
    label: 'Project archived',
    projectName: 'Notes',
    tone: 'info',
    when: 'yesterday',
    onOpen: opened,
  },
  {
    sequence: 59,
    label: 'Profile migrated to 20260916_projects_and_journal',
    projectName: 'Hemera',
    tone: 'neutral',
    when: 'at start-up',
    onOpen: opened,
  },
]

/** The bell is the list's one trigger, so the story shows the two the way the bar wires them. */
function Controlled({ entries, onMarkAllRead }: NotificationListProps) {
  const [shown, setShown] = useState(entries)
  return (
    <div className="flex h-screen items-start justify-end p-6">
      <NotificationBell unseen={shown.length > 0}>
        <NotificationList
          entries={shown}
          onMarkAllRead={() => {
            setShown([])
            onMarkAllRead()
          }}
        />
      </NotificationBell>
    </div>
  )
}

/** Closed before a story ends: Base UI's focus guards are focusable and `aria-hidden`, and a
 * panel left open is a violation the accessibility pass is right to report. */
async function closed(): Promise<void> {
  await userEvent.keyboard('{Escape}')
  await waitFor(() => {
    expect(within(document.body).queryByRole('dialog')).toBeNull()
  })
}

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Notifications',
  component: NotificationList,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: { entries: ENTRIES, onMarkAllRead: fn() },
  argTypes: {
    entries: {
      control: 'object',
      description: 'The unseen events of every Project, newest first.',
    },
    onMarkAllRead: { action: 'marked all read' },
  },
} satisfies Meta<typeof NotificationList>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Scenario « La cloche liste tous les Projets » of `specs/domain-journal/spec.md`. */
export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Notifications, some unseen' }))

    const panel = await within(document.body).findByRole('dialog')
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3)
    // Every line names the Project it happened in.
    expect(within(panel).getByText(/Atlas ·/)).toBeInTheDocument()
    expect(within(panel).getByText(/Notes ·/)).toBeInTheDocument()

    await closed()
  },
}

/** Scenario « Marquer tout lu » of `specs/domain-journal/spec.md`. */
export const States: Story = {
  play: async ({ canvasElement, args }) => {
    args.onMarkAllRead.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Notifications, some unseen' }))
    const panel = await within(document.body).findByRole('dialog')

    await userEvent.click(within(panel).getByRole('button', { name: 'Mark all read' }))
    expect(args.onMarkAllRead).toHaveBeenCalled()
    await waitFor(() => {
      expect(within(panel).getByText(/Nothing to see/)).toBeInTheDocument()
    })
    // The bell loses its dot with the last unseen event, and says so by its name.
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    })

    await closed()
  },
}

/** Scenario « Rien à voir » of `specs/shell-navigation/spec.md`. */
export const NothingToSee: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bell = canvas.getByRole('button', { name: 'Notifications' })
    expect(canvas.queryByRole('button', { name: 'Notifications, some unseen' })).toBeNull()

    await userEvent.click(bell)
    const panel = await within(document.body).findByRole('dialog')
    expect(within(panel).getByText(/Nothing to see/)).toBeInTheDocument()

    await closed()
  },
}

/** Scenario « Ligne d'un autre Projet » of `specs/shell-navigation/spec.md`, as a panel. */
export const ALineOfAnotherProject: Story = {
  play: async ({ canvasElement }) => {
    opened.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Notifications, some unseen' }))

    const panel = await within(document.body).findByRole('dialog')
    await userEvent.click(within(panel).getByRole('button', { name: /Project archived/ }))
    expect(opened).toHaveBeenCalled()

    await closed()
  },
}

/** The bell opens, walks and closes from the keyboard alone. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bell = canvas.getByRole('button', { name: 'Notifications, some unseen' })

    bell.focus()
    await userEvent.keyboard('{Enter}')
    const panel = await within(document.body).findByRole('dialog')
    expect(panel).toBeInTheDocument()

    await closed()
    expect(document.activeElement).toBe(bell)
  },
}
