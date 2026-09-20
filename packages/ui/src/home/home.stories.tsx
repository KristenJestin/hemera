import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconMessages, IconTimelineEvent } from '../icons.ts'
import type { JournalLine } from '../journal/journal.tsx'
import {
  ActivityFrame,
  EmptyProject,
  FirstLaunch,
  Greeting,
  QuickActions,
  SessionsFrame,
  type HomeSession,
} from './home.tsx'

/**
 * The pieces the Home of a Project is made of (design D4-07).
 *
 * There is no `Home` component: the page that assembles these lives in the application, beside
 * the composer it hands over. What is shown here is each piece on its own, and one story that
 * puts them in the order the page does — which is the only thing a reader needs to judge them.
 */
const ENTRIES: JournalLine[] = [
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
]

const SESSIONS: HomeSession[] = [
  {
    id: 'csv',
    title: 'CSV invoice export',
    meta: '5 messages · last written 2 weeks ago',
  },
  { id: 'search', title: 'Full-text search', meta: '2 messages · last written last month' },
  { id: 'drizzle', title: 'Migrate to Drizzle 1.0', meta: 'No message yet · created 2 months ago' },
]

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Home',
  component: ActivityFrame,
  parameters: { layout: 'padded' },
  args: { entries: ENTRIES, onOpenJournal: fn() },
  argTypes: {
    entries: { control: 'object', description: 'The last entries of the Journal, newest first.' },
    onOpenJournal: { action: 'journal opened' },
  },
} satisfies Meta<typeof ActivityFrame>

export default meta
type Story = StoryObj<typeof meta>

/** The Activity frame on its own, which is the one piece with anything to configure. */
export const Playground: Story = {}

/** Every piece, in the order the page puts them in. */
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Greeting
        projectName="Atlas"
        note="Write freely. It becomes a Session the moment you send."
      />
      <QuickActions
        actions={[
          {
            id: 'resume',
            label: 'Resume “CSV invoice export”',
            icon: <IconMessages size="sm" />,
            onSelect: args.onOpenJournal,
          },
          {
            id: 'journal',
            label: 'Open the Journal',
            icon: <IconTimelineEvent size="sm" />,
            onSelect: args.onOpenJournal,
          },
        ]}
      />
      <SessionsFrame sessions={SESSIONS} onOpenSession={args.onOpenJournal} />
      <ActivityFrame entries={args.entries} onOpenJournal={args.onOpenJournal} />
      <EmptyProject projectName="Atlas" onOpenJournal={args.onOpenJournal} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => {
      expect(canvas.getByRole('heading', { level: 1 }).parentElement).toHaveStyle({ opacity: '1' })
    })
    expect(canvas.getByRole('heading', { name: 'What are we doing in Atlas?' })).toBeInTheDocument()
    expect(canvas.getByText('Repository ./sources/api added')).toBeInTheDocument()
    expect(canvas.getByText('No Session in Atlas')).toBeInTheDocument()
  },
}

/** A Project nothing has happened in yet: the frame says so without inventing an entry. */
export const States: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Nothing has happened here yet/)).toBeInTheDocument()
  },
}

/** Scenario « Aucun Projet au démarrage » of `specs/project-workspaces/spec.md`, as a page. */
export const FirstLaunchPage: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => <FirstLaunch onCreateProject={args.onOpenJournal} commandShortcut="Ctrl+K" />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await waitFor(() => {
      expect(canvas.getByRole('heading', { level: 1 }).parentElement).toHaveStyle({ opacity: '1' })
    })

    expect(canvas.getByRole('heading', { name: 'Welcome to Hemera' })).toBeInTheDocument()
    // One action, and the palette said to be there too.
    expect(canvas.getAllByRole('button')).toHaveLength(1)
    expect(canvas.getByText(/opens the command palette/)).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Create your first Project' }))
    expect(args.onOpenJournal).toHaveBeenCalled()
  },
}

/** Every way to the Journal from the Home is one press. */
export const ToTheJournal: Story = {
  play: async ({ canvasElement, args }) => {
    args.onOpenJournal.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Journal' }))
    expect(args.onOpenJournal).toHaveBeenCalled()
  },
}

/**
 * The last Sessions of the Project, and the one press that resumes the most recent.
 *
 * The order is the engine's — most recently written first — so the row at the top is the one
 * `Resume` opens, and a Session that has never been written into is still a Session.
 */
export const TheLastSessions: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <SessionsFrame sessions={SESSIONS} onOpenSession={args.onOpenJournal} />
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    args.onOpenJournal.mockClear()
    const canvas = within(canvasElement)

    const rows = canvas.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('CSV invoice export')
    expect(rows[0]).toHaveTextContent('5 messages · last written 2 weeks ago')
    // A Session nothing was written into says so instead of pretending to hold a thread.
    expect(rows[2]).toHaveTextContent('No message yet')

    await userEvent.click(canvas.getByRole('button', { name: /CSV invoice export/ }))
    expect(args.onOpenJournal).toHaveBeenCalledWith('csv')
  },
}
