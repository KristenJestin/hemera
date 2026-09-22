import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { onOneLine } from '../../.storybook/one-line.ts'
import {
  AgentModelMenu,
  type EffortChoice,
  type ModelChoice,
  type OfferedAgent,
} from '../composer/agent-model-menu.tsx'
import { Composer } from '../composer/composer.tsx'
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

/** The agents this machine has, as the engine would have offered them. */
const AGENTS: OfferedAgent[] = [
  { id: 'claude-code', name: 'Claude Code', available: true, signedIn: true },
  { id: 'codex', name: 'Codex', available: true, signedIn: true },
  {
    id: 'opencode',
    name: 'OpenCode',
    available: true,
    signedIn: false,
    hint: 'Signed out: run `opencode auth login` to sign in',
  },
]

const MODELS: ModelChoice[] = [
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { id: 'claude-opus-4-1', label: 'Opus 4.1' },
]

const EFFORTS: EffortChoice[] = [
  { id: 'low', label: 'Low' },
  { id: 'high', label: 'High' },
]

/**
 * The box a Session is started from, as the Home hands it over (design D4b-02, D17-14).
 *
 * The Home is where an agent is chosen, because a Session is made with the agent it will run:
 * nothing has been picked yet, so the send is off and says why on itself. There is no paragraph
 * above the box any more — it moved the whole frame down the moment it appeared — and the agent,
 * its model and its effort are one control at the end of the box's own row, where they cannot
 * wrap onto a line the frame would have to grow for.
 */
function Writing(): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [agent, setAgent] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [effort, setEffort] = useState<string | null>(null)
  return (
    <Composer
      value={value}
      onValueChange={setValue}
      files={files}
      onFilesChange={setFiles}
      onSearchFiles={() => Promise.resolve([])}
      onSend={() => Promise.resolve(null)}
      sendDisabledReason={agent === null ? 'Choose an agent first' : undefined}
      agentMenu={
        <AgentModelMenu
          agents={AGENTS}
          agent={agent}
          onAgentChange={(id) => {
            setAgent(id)
            setModel(null)
            setEffort(null)
          }}
          models={agent === null ? [] : MODELS}
          model={model}
          onModelChange={setModel}
          efforts={agent === null ? [] : EFFORTS}
          effort={effort}
          onEffortChange={setEffort}
        />
      }
    />
  )
}

const meta = {
  tags: ['autodocs', 'updated'],
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
      <Writing />
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

    /*
     * The box, as the trial of 22 September 2026 settled it. No agent is chosen, so the send is
     * off and carries the reason itself — no paragraph above the frame, which is what used to
     * push the whole page down the moment it appeared. The one control for the agent, its model
     * and its effort is at the end of the box's own row, and the foot is the Workspace and the
     * two buttons: nothing wraps, and the frame does not grow when a choice is made.
     */
    const send = canvas.getByRole('button', { name: /Start chat/ })
    expect(send).toHaveAttribute('title', 'Choose an agent first')
    expect(canvas.queryByText('Choose an agent first')).toBeNull()

    const menu = canvas.getByRole('button', { name: 'Choose an agent' })
    const at = canvas.getByRole('button', { name: 'Mention a file of the Project' })
    expect(onOneLine(at, menu), 'the agent menu left the box’s own row').toBe(true)
    expect(
      onOneLine(canvas.getByRole('combobox', { name: 'Workspace' }), send),
      'the foot of the composer wrapped',
    ).toBe(true)

    // The agent that is signed out is drawn with what is the matter with it, and cannot be
    // picked: a choice that would be refused after the fact is a choice that lied.
    await userEvent.click(menu)
    const agents = await screen.findByRole('listbox', { name: 'Agents' })
    const options = within(agents).getAllByRole('option')
    expect(options[2]).toHaveTextContent('opencode auth login')
    expect(options[2]).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(options[0]!)
    // The agent is taken, the send comes alive, and nothing above the box appeared to say so.
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Claude Code' })).toBeVisible()
    })
    expect(canvas.getByRole('button', { name: /Start chat/ })).not.toHaveAttribute('title')
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
