import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { PROPOSALS } from '../../blocks/setup/setup-fixtures.ts'
import { LiveChip } from '../../components/live-chip/live-chip.tsx'
import { ACME_LOGO } from '../../components/project-mark/project-mark-fixtures.ts'
import { IconFileText } from '../../icons.ts'
import { LONG_NAME, LONG_TITLE, REPOSITORIES } from '../../shell/shell-fixtures.tsx'
import { ProjectTasks, SetupTask } from '../project-setup/setup-task.tsx'
import { ProjectPage } from './project-page.tsx'
import {
  CANCELLED_GROUP,
  DONE_GROUP,
  PROJECT_CHATS,
  PROJECT_LIVING_SPEC,
  STAGE_GROUPS,
  manyGroups,
} from './project-shell-fixture.tsx'
import { ProjectStartSlot } from './project-start-slot.tsx'

/**
 * The Project page: two columns. On the left the start slot, the Project's tasks and its missions
 * by stage, each mission a two-line row, Done and Cancelled folded at the end. On the right a rail
 * with the living spec card and the Chats. The field itself is the start slot's; here it is
 * a stand-in of the same name.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Project page',
  component: ProjectPage,
  parameters: { layout: 'fullscreen' },
  args: {
    name: 'Acme',
    repositories: REPOSITORIES,
    start: <ProjectStartSlot name="Acme" />,
    groups: STAGE_GROUPS,
    livingSpec: PROJECT_LIVING_SPEC,
    chats: PROJECT_CHATS,
    onOpenMission: fn(),
    onOpenSettings: fn(),
    onOpenLivingSpec: fn(),
    onOpenChat: fn(),
    onNewChat: fn(),
    onRetry: fn(),
  },
  argTypes: {
    name: { control: 'text' },
    loading: { control: 'boolean' },
    error: { control: 'text' },
    repositories: { table: { disable: true } },
    groups: { table: { disable: true } },
    chats: { table: { disable: true } },
    livingSpec: { table: { disable: true } },
    start: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen flex-col bg-surface-content">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProjectPage>

export default meta
type Story = StoryObj<typeof meta>

/** A Project with no mission yet: the header, the field, and the empty state in the room below. */
export const Empty: Story = {
  args: { groups: [], chats: [], livingSpec: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('No mission yet')).toBeVisible()
    expect(canvas.getByText('api')).toBeInTheDocument()
    expect(canvas.getByText('No Chat yet.')).toBeVisible()
  },
}

/** One mission per stage, every mark once, Done folded, and the rail: the page as it is lived in. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const headings = canvas.getAllByRole('heading', { level: 2 }).map((head) => head.textContent)
    expect(headings.slice(0, 5)).toEqual([
      expect.stringMatching(/^Shipping/),
      expect.stringMatching(/^Review/),
      expect.stringMatching(/^Building/),
      expect.stringMatching(/^Planning/),
      expect.stringMatching(/^Ready/),
    ])
    expect(canvas.queryByRole('list', { name: 'Done missions' })).toBeNull()
    for (const words of [
      'Blocked by ACME-9',
      'Blocked by shared database · ACME-15',
      'Waiting on CI on acme/shop#52',
      'web changed outside Hemera',
      'Outdated',
      'Fixing',
    ]) {
      expect(
        canvas.queryAllByRole('img', { name: words }).length + canvas.queryAllByText(words).length,
      ).toBeGreaterThan(0)
    }
    expect(canvas.getByText('Round 1 addressed: 4 points, checks green')).toBeVisible()
    expect(canvas.getByText('60%')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /ACME-12/ }))
    expect(args.onOpenMission).toHaveBeenCalledWith('ACME-12')
    await userEvent.click(canvas.getByRole('button', { name: 'Settings of Acme' }))
    expect(args.onOpenSettings).toHaveBeenCalled()
  },
}

/** Thirty missions, every title and event long: the page scrolls and no row grows. */
export const Many: Story = {
  args: { groups: manyGroups() },
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getAllByText(/^Export invoices as CSV/)[0]!
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
    expect(canvas.getAllByRole('listitem').length).toBeGreaterThanOrEqual(30)
  },
}

/** A long name, long repository names, many long missions in one stage. */
export const Dense: Story = {
  args: {
    name: LONG_NAME,
    repositories: [
      { name: 'acme-platform-api-and-background-workers' },
      { name: 'acme-platform-web-customer-portal' },
      { name: 'shared' },
      { name: 'infrastructure' },
      { name: 'design-system' },
    ],
    groups: [
      {
        stage: 'Building',
        rows: Array.from({ length: 12 }, (_, index) => ({
          missionKey: `ACME-${String(100 + index)}`,
          title: LONG_TITLE,
          when: '09:02',
          ball: 'agent' as const,
          event: 'The agent wrote the tests of the export of every invoice of every customer',
        })),
      },
      {
        stage: 'Done',
        rows: Array.from({ length: 128 }, (_, index) => ({
          missionKey: `ACME-${String(index + 1)}`,
          title: LONG_TITLE,
          when: 'last week',
          ball: 'idle' as const,
        })),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { level: 1 })
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
    const rows = within(canvas.getByRole('list', { name: 'Building missions' }))
    expect(rows.getAllByRole('listitem')).toHaveLength(12)
  },
}

/** Done folded, as the page opens: its header says how many, and pressing it opens the list. */
export const DoneFolded: Story = {
  args: { groups: [...STAGE_GROUPS, CANCELLED_GROUP] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const header = canvas.getByRole('button', { name: /^Done/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(canvas.getByRole('button', { name: /^Cancelled/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(canvas.queryByRole('list', { name: 'Done missions' })).toBeNull()
    await userEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    const list = await canvas.findByRole('list', { name: 'Done missions' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    await userEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(canvas.queryByRole('list', { name: 'Done missions' })).toBeNull())
  },
}

/** Opened from the keyboard: Enter folds Done back, Space opens it, and a row opens its mission. */
export const DoneKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const header = canvas.getByRole('button', { name: /^Done/ })
    header.focus()
    await userEvent.keyboard(' ')
    expect(header).toHaveAttribute('aria-expanded', 'true')
    const list = await canvas.findByRole('list', { name: 'Done missions' })
    await userEvent.click(within(list).getByRole('button', { name: /ACME-9/ }))
    expect(args.onOpenMission).toHaveBeenCalledWith('ACME-9')
    header.focus()
    await userEvent.keyboard('{Enter}')
    expect(header).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(canvas.queryByRole('list', { name: 'Done missions' })).toBeNull())
  },
}

/** The living spec card: its domains, the one that waits marked, and the way into the page. */
export const LivingSpecCard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('complementary', { name: 'About Acme' })
    expect(within(rail).getByText('3 domains · updated yesterday')).toBeVisible()
    const domains = within(within(rail).getByRole('list', { name: 'Domains' }))
    expect(domains.getAllByRole('listitem')).toHaveLength(3)
    expect(domains.getByText('Waits for you')).toBeInTheDocument()
    await userEvent.click(within(rail).getByRole('button', { name: 'Open' }))
    expect(args.onOpenLivingSpec).toHaveBeenCalled()
  },
}

/** No living spec yet: the card says so, and still opens the page that writes it. */
export const LivingSpecNone: Story = {
  args: { livingSpec: null },
  play: async ({ canvasElement }) => {
    const rail = within(canvasElement).getByRole('complementary', { name: 'About Acme' })
    expect(within(rail).getByText('Not written yet.')).toBeVisible()
    expect(within(rail).getByRole('button', { name: 'Open' })).toBeVisible()
  },
}

/** The living spec on its way: the card's own shape, nothing to press. */
export const LivingSpecLoading: Story = {
  args: { livingSpec: null, loading: true },
  play: async ({ canvasElement }) => {
    const rail = within(canvasElement).getByRole('complementary', { name: 'About Acme' })
    expect(rail.querySelector('[data-living-spec-skeleton]')).not.toBeNull()
  },
}

/** The Chats in the rail: each opens, and New Chat starts one. */
export const Chats: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Chats' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(within(list).getByRole('button', { name: /Invoices export/ }))
    expect(args.onOpenChat).toHaveBeenCalledWith('invoices')
    await userEvent.click(canvas.getByRole('button', { name: 'New Chat' }))
    expect(args.onNewChat).toHaveBeenCalled()
  },
}

/** The missions on their way: the two-line rows' own shape under the field. */
export const Loading: Story = {
  args: { loading: true, groups: [], chats: [], livingSpec: null },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('list', { busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
    expect(canvasElement.querySelectorAll('[data-row-event]').length).toBeGreaterThanOrEqual(3)
  },
}

/** The Project could not be read: said in the middle, in words, and Try again. */
export const Error: Story = {
  args: { groups: [], error: '/home/acme/work is not readable: permission denied.' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('Hemera could not read Acme')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(args.onRetry).toHaveBeenCalled()
  },
}

/** From the keyboard: the settings, then the field, then the first mission, then the rail. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Settings of Acme' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('textbox', { name: 'Start a mission in Acme' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: /ACME-18/ })).toHaveFocus()
    // The legends inside a row (its marks, its ball) are stops of their own before the next row.
    const next = canvas.getByRole('button', { name: /ACME-12/ })
    for (let stops = 0; stops < 4 && document.activeElement !== next; stops += 1) {
      await userEvent.tab()
    }
    expect(next).toHaveFocus()
  },
}

/** The 1366 by 768 laptop screen: the two columns side by side, the rail beside the missions. */
export const Laptop: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('complementary', { name: 'About Acme' })
    const list = canvas.getByRole('list', { name: 'Review missions' })
    expect(rail.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      list.getBoundingClientRect().right,
    )
  },
}

/** A Project marked with a logo of its own: the logo before its name, as in the sidebar. */
export const Marked: Story = {
  args: { identity: { image: ACME_LOGO } },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('header [data-mark-image]')).toHaveAttribute(
      'src',
      ACME_LOGO,
    )
  },
}

/** The Project's tasks under the field that starts a mission, while one runs: here, the setup. */
export const WithTasks: Story = {
  args: {
    groups: [],
    tasks: (
      <ProjectTasks>
        <SetupTask
          project="Acme"
          agent="working"
          startedAt={Date.now() - 12_000}
          endedAt={null}
          cards={[]}
          open={false}
          onOpenChange={fn()}
          onAcceptAll={fn()}
          onRetry={fn()}
          onAccept={fn()}
          onDraft={fn()}
          onDecline={fn()}
          onSave={fn()}
          onCancel={fn()}
          onSend={fn()}
        />
      </ProjectTasks>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tasks = canvas.getByRole('region', { name: 'Tasks' })
    expect(within(tasks).getByRole('button', { name: 'Setup agent, running' })).toBeVisible()
    // Under the field that starts a mission.
    const field = canvas.getByRole('textbox', { name: 'Start a mission in Acme' })
    expect(field.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  },
}

/**
 * The setup's task as the window holds it, done with two proposals waiting: its chip's menu opens
 * them in its details.
 */
function SetupProposalsWaiting() {
  const [open, setOpen] = useState(false)
  const [startedAt] = useState(() => Date.now() - 42_000)
  return (
    <SetupTask
      project="Acme"
      agent="done"
      startedAt={startedAt}
      endedAt={startedAt + 38_000}
      cards={[
        { kind: 'repositories', status: { state: 'accepted' }, proposal: PROPOSALS.repositories },
        { kind: 'commands', status: { state: 'proposed' }, proposal: PROPOSALS.commands },
        { kind: 'variables', status: { state: 'proposed' }, proposal: PROPOSALS.variables },
      ]}
      open={open}
      onOpenChange={setOpen}
      onAcceptAll={fn()}
      onRetry={fn()}
      onAccept={fn()}
      onDraft={fn()}
      onDecline={fn()}
      onSave={fn()}
      onCancel={fn()}
      onSend={fn()}
    />
  )
}

/**
 * A Project lived in, with tasks running for it: the setup's proposals waiting, and another task at
 * work beside it. The row stands between the field and the missions; what a task asks unfolds there,
 * pushing the missions down.
 */
export const WithTasksAndMissions: Story = {
  render: (args) => (
    <ProjectPage
      {...args}
      tasks={
        <ProjectTasks>
          <SetupProposalsWaiting />
          <LiveChip
            name="Living spec"
            icon={<IconFileText size="sm" />}
            state="running"
            startedAt={Date.now() - 95_000}
            endedAt={null}
          />
        </ProjectTasks>
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tasks = canvas.getByRole('region', { name: 'Tasks' })
    expect(within(tasks).getByRole('button', { name: 'Living spec, running' })).toBeVisible()
    // The missions under the row, which the details never push.
    expect(canvas.getByRole('button', { name: /ACME-12/ })).toBeInTheDocument()
    await userEvent.click(
      within(tasks).getByRole('button', { name: 'Setup agent, done, waits for you' }),
    )
    const menu = await within(document.body).findByRole('dialog', { name: 'Setup agent' })
    await userEvent.click(within(menu).getByRole('button', { name: 'Review 2 proposals' }))
    const details = await within(document.body).findByRole('dialog', { name: 'Setup of Acme' })
    // The dialog fades in: visible once its entrance has played.
    await waitFor(() => {
      expect(within(details).getByRole('region', { name: 'Commands' })).toBeVisible()
    })
  },
}

/**
 * The setup as the window holds it once its last proposal is answered in its details: the details
 * close first, the focus goes to the field that starts a mission, then the task leaves the row.
 */
function SetupAnsweredLast() {
  const [open, setOpen] = useState(false)
  /** Whether its details are open or still closing: the task stays until they have closed. */
  const [held, setHeld] = useState(false)
  const [answered, setAnswered] = useState(false)
  const [startedAt] = useState(() => Date.now() - 42_000)
  if (answered && !held) return null
  return (
    <SetupTask
      project="Acme"
      agent="done"
      startedAt={startedAt}
      endedAt={startedAt + 38_000}
      cards={[
        {
          kind: 'commands',
          status: answered ? { state: 'accepted' } : { state: 'proposed' },
          proposal: PROPOSALS.commands,
        },
      ]}
      leaving={answered}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setHeld(true)
      }}
      onClosed={() => setHeld(false)}
      onAcceptAll={() => setAnswered(true)}
      onRetry={fn()}
      onAccept={fn()}
      onDraft={fn()}
      onDecline={fn()}
      onSave={fn()}
      onCancel={fn()}
      onSend={fn()}
    />
  )
}

/** The last proposal answered in the details: they close, and the focus lands on the field. */
export const LastProposalAnswered: Story = {
  render: (args) => (
    <ProjectPage
      {...args}
      tasks={
        <ProjectTasks>
          <SetupAnsweredLast />
        </ProjectTasks>
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tasks = canvas.getByRole('region', { name: 'Tasks' })
    await userEvent.click(
      within(tasks).getByRole('button', { name: 'Setup agent, done, waits for you' }),
    )
    const menu = await within(document.body).findByRole('dialog', { name: 'Setup agent' })
    await userEvent.click(within(menu).getByRole('button', { name: 'Review 1 proposal' }))
    const details = await within(document.body).findByRole('dialog', { name: 'Setup of Acme' })
    await waitFor(() => {
      expect(within(details).getByRole('button', { name: 'Accept all' })).toBeVisible()
    })
    await userEvent.click(within(details).getByRole('button', { name: 'Accept all' }))
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog', { name: 'Setup of Acme' })).toBeNull()
    })
    await waitFor(() => {
      expect(canvas.getByRole('textbox', { name: 'Start a mission in Acme' })).toHaveFocus()
    })
    expect(within(tasks).queryByRole('button', { name: /^Setup agent/ })).toBeNull()
  },
}
