import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { Journal, type JournalFilter, type JournalLine, type JournalProps } from './journal.tsx'

/**
 * The Journal of one Project, on fixtures (design D4-05, D4-07).
 *
 * The filters are answered the way the engine answers them — by handing back a shorter page —
 * so the story narrows the fixtures rather than the component hiding rows it was given.
 */
const opened = fn()

const ENTRIES: JournalLine[] = [
  {
    sequence: 64,
    kind: 'session',
    label: 'Message added',
    day: 'Today',
    time: '14:02',
    author: 'human',
    target: { label: 'CSV invoice export', onOpen: opened },
  },
  {
    sequence: 63,
    kind: 'session',
    label: 'Session renamed “Untitled” → “CSV invoice export”',
    day: 'Today',
    time: '13:58',
    author: 'human',
    target: { label: 'CSV invoice export', onOpen: opened },
  },
  {
    sequence: 62,
    kind: 'project',
    label: 'Repository ./sources/front added',
    day: 'Today',
    time: '10:42',
    author: 'human',
  },
  {
    sequence: 61,
    kind: 'project',
    label: 'Repository ./sources/api added',
    day: 'Today',
    time: '10:41',
    author: 'human',
  },
  {
    sequence: 60,
    kind: 'project',
    label: 'Renamed “Atlas” → “Atlas II”',
    day: 'Today',
    time: '09:12',
    author: 'human',
  },
  {
    sequence: 59,
    kind: 'profile',
    label: 'Profile opened by 0.4.0-beta.3',
    day: 'Today',
    time: '09:10',
    author: 'hemera',
  },
  {
    sequence: 58,
    kind: 'project',
    label: 'Main Workspace moved to D:\\Projects\\atlas',
    day: 'Yesterday',
    time: '18:30',
    author: 'human',
    target: { label: 'Project settings', onOpen: opened },
  },
  {
    sequence: 57,
    kind: 'profile',
    label: 'Profile migrated to 20260916_projects_and_journal',
    day: 'Yesterday',
    time: '18:29',
    author: 'hemera',
  },
  {
    sequence: 56,
    kind: 'project',
    label: 'Project created',
    day: '12 September',
    time: '11:02',
    author: 'human',
  },
]

/** The page the engine would answer for a filter, which is what the story hands back. */
function matching(entries: JournalLine[], filter: JournalFilter, byYou: boolean): JournalLine[] {
  return entries.filter(
    (entry) => (filter === 'all' || entry.kind === filter) && (!byYou || entry.author === 'human'),
  )
}

function Controlled({
  entries,
  filter,
  byYou,
  hasEarlier,
  onFilterChange,
  onByYouChange,
  onLoadEarlier,
  ...rest
}: JournalProps) {
  const [chosen, setChosen] = useState(filter)
  const [mine, setMine] = useState(byYou)
  const [earlier, setEarlier] = useState(hasEarlier)
  return (
    <div className="mx-auto flex max-w-3xl flex-col p-6">
      <Journal
        {...rest}
        entries={matching(entries, chosen, mine)}
        filter={chosen}
        onFilterChange={(next) => {
          setChosen(next)
          onFilterChange(next)
        }}
        byYou={mine}
        onByYouChange={(next) => {
          setMine(next)
          onByYouChange(next)
        }}
        hasEarlier={earlier}
        onLoadEarlier={() => {
          setEarlier(false)
          onLoadEarlier()
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Journal',
  component: Journal,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'Atlas',
    entries: ENTRIES,
    filter: 'all',
    byYou: false,
    hasEarlier: true,
    loading: false,
    onFilterChange: fn(),
    onByYouChange: fn(),
    onLoadEarlier: fn(),
  },
  argTypes: {
    projectName: { control: 'text', description: 'Whose Journal this is.' },
    entries: { control: 'object', description: 'The page as it stands, newest first.' },
    filter: {
      control: 'inline-radio',
      options: ['all', 'project', 'session', 'profile'],
      description: 'Which entity is wanted.',
    },
    byYou: { control: 'boolean', description: 'Whether only what the user did is wanted.' },
    hasEarlier: { control: 'boolean', description: 'Whether there is an older page to ask for.' },
    loading: { control: 'boolean', description: 'Whether that page is on its way.' },
    onFilterChange: { action: 'filter changed' },
    onByYouChange: { action: 'by you changed' },
    onLoadEarlier: { action: 'earlier entries asked for' },
  },
} satisfies Meta<typeof Journal>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** One page: the days are named once above their entries, newest first. */
export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Today')).toBeInTheDocument()
    expect(canvas.getByText('Yesterday')).toBeInTheDocument()
    expect(canvas.getByText('12 September')).toBeInTheDocument()
    expect(canvas.getAllByRole('listitem')).toHaveLength(ENTRIES.length)
    // What Hemera did is there, told apart by its author rather than hidden.
    expect(canvas.getByText('Profile opened by 0.4.0-beta.3')).toBeInTheDocument()
    expect(canvas.getAllByText('by Hemera')).toHaveLength(2)
  },
}

/** The last page: nothing older to ask for, and the Journal says so. */
export const States: Story = {
  args: { hasEarlier: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /Earlier entries/ })).toBeNull()
    expect(canvas.getByText(/the whole Journal of Atlas/)).toBeInTheDocument()
  },
}

/** Scenario « Filtres » of `specs/domain-journal/spec.md`. */
export const Filters: Story = {
  play: async ({ canvasElement, args }) => {
    args.onFilterChange.mockClear()
    const canvas = within(canvasElement)

    // Counted from the fixtures rather than written down: a page that gains an entry is not a
    // filter that stopped working.
    const ofKind = (kind: JournalLine['kind']) => ENTRIES.filter((one) => one.kind === kind).length

    await userEvent.click(canvas.getByRole('button', { name: 'Profile' }))
    await waitFor(() => {
      expect(canvas.getAllByRole('listitem')).toHaveLength(ofKind('profile'))
    })
    expect(args.onFilterChange).toHaveBeenCalledWith('profile')
    expect(canvas.queryByText('Repository ./sources/api added')).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: 'All' }))
    await waitFor(() => {
      expect(canvas.getAllByRole('listitem')).toHaveLength(ENTRIES.length)
    })

    // « by you » keeps what the user did, in the same order.
    await userEvent.click(canvas.getByRole('button', { name: /by you/ }))
    await waitFor(() => {
      expect(canvas.queryByText('Profile opened by 0.4.0-beta.3')).toBeNull()
    })
    expect(canvas.getAllByRole('listitem')).toHaveLength(
      ENTRIES.filter((one) => one.author === 'human').length,
    )
  },
}

/** Nothing yet: a Journal that has not been written into says so without inventing a line. */
export const Empty: Story = {
  args: { entries: [], hasEarlier: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Nothing here yet/)).toBeInTheDocument()
    expect(canvas.queryAllByRole('listitem')).toHaveLength(0)
  },
}

/** Scenario « Pages successives » of `specs/domain-journal/spec.md`, as far as a page goes. */
export const EarlierEntries: Story = {
  play: async ({ canvasElement, args }) => {
    args.onLoadEarlier.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Earlier entries/ }))
    expect(args.onLoadEarlier).toHaveBeenCalled()
    await waitFor(() => {
      expect(canvas.getByText(/the whole Journal of Atlas/)).toBeInTheDocument()
    })
  },
}

/** An entry that names somewhere goes there, and says where it is going. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    opened.mockClear()
    const canvas = within(canvasElement)
    const target = canvas.getByRole('button', { name: 'Project settings' })

    target.focus()
    await userEvent.keyboard('{Enter}')
    expect(opened).toHaveBeenCalled()
  },
}
