import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ContentHeader } from './content-header.tsx'
import {
  CHATS,
  LONG_NAME,
  MANY_PROJECTS,
  MARKED_PROJECTS,
  MISSION,
  PROJECTS,
} from './shell-fixtures.tsx'
import {
  SIDEBAR_MISSIONS,
  type SidebarMissionEntry,
  SidebarMissionGroups,
} from './sidebar-shell-fixture.tsx'
import { Sidebar, SidebarChatRow, type SidebarChatRowProps, type SidebarPlace } from './sidebar.tsx'

/**
 * The sidebar alone, on the page surface it stands on: Hemera's head, Home and its count, the
 * Projects and the missions under each, Settings at the bottom; open, and folded to its rail.
 */
const UNDER_ACME = (
  <SidebarMissionGroups missions={SIDEBAR_MISSIONS} current={{ kind: 'home' }} onMission={fn()} />
)

const meta = {
  tags: ['autodocs'],
  title: 'Shell/Sidebar',
  component: Sidebar,
  parameters: { layout: 'fullscreen' },
  args: {
    folded: false,
    waiting: 2,
    projects: PROJECTS,
    opened: new Set<string>(),
    onOpen: fn(),
    current: { kind: 'home' },
    onHome: fn(),
    onProject: fn(),
    onAddProject: fn(),
    onSettings: fn(),
  },
  argTypes: {
    folded: { control: 'boolean' },
    waiting: { control: 'number' },
    loading: { control: 'boolean' },
    error: { control: 'text' },
    projects: { table: { disable: true } },
    opened: { table: { disable: true } },
    current: { table: { disable: true } },
  },
  render: (args) => {
    const [folded, setFolded] = useState(args.folded)
    const [opened, setOpened] = useState<ReadonlySet<string>>(args.opened)
    const [current, setCurrent] = useState<SidebarPlace>(args.current)
    return (
      <div className="flex h-screen bg-surface-page">
        <Sidebar
          {...args}
          folded={folded}
          opened={opened}
          onOpen={(id, open) => {
            setOpened((before) => {
              const next = new Set(before)
              if (open) next.add(id)
              else next.delete(id)
              return next
            })
            args.onOpen(id, open)
          }}
          current={current}
          onHome={() => {
            setCurrent({ kind: 'home' })
            args.onHome()
          }}
          onProject={(id) => {
            setCurrent({ kind: 'project', id })
            args.onProject(id)
          }}
          onSettings={() => {
            setCurrent({ kind: 'settings' })
            args.onSettings()
          }}
        />
        <div className="mt-2 flex flex-1 flex-col rounded-tl-lg border-t border-l border-border bg-surface-content">
          <ContentHeader
            folded={folded}
            onFold={setFolded}
            crumbs={[{ id: 'home', label: 'Home' }]}
          />
        </div>
      </div>
    )
  },
} satisfies Meta<typeof Sidebar>

export default meta
type Story = StoryObj<typeof meta>

/** Two Projects, closed: their names enter them. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Hemera' }))
    expect(args.onProject).toHaveBeenCalledWith('hemera')
    expect(canvas.getByRole('button', { name: 'Hemera' })).toHaveAttribute('aria-current', 'page')
  },
}

/**
 * A Project added while the window is open: its row grows in after the others and pushes Add a
 * Project down, rather than appearing in one frame. Add a Project plays it here.
 */
export const Arriving: Story = {
  args: { projects: [PROJECTS[0]!] },
  render: (args) => {
    const [projects, setProjects] = useState(args.projects)
    return (
      <div className="flex h-screen bg-surface-page">
        <Sidebar
          {...args}
          projects={projects}
          onAddProject={() => {
            setProjects(projects.length === 1 ? PROJECTS : [PROJECTS[0]!])
            args.onAddProject()
          }}
        />
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Hemera' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a Project' }))
    expect(await canvas.findByRole('button', { name: 'Hemera' })).toBeVisible()
  },
}

/**
 * A Project opened while its row is still growing in: the row lands whole and what stands under
 * it grows after, pushing Add a Project down. Add a Project plays it here, and again.
 */
export const OpenedArriving: Story = {
  args: { projects: [PROJECTS[1]!] },
  render: (args) => {
    const [projects, setProjects] = useState(args.projects)
    const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
    return (
      <div className="flex h-screen bg-surface-page">
        <Sidebar
          {...args}
          projects={projects}
          opened={opened}
          onOpen={(id, open) => {
            setOpened(open ? new Set([id]) : new Set())
            args.onOpen(id, open)
          }}
          onAddProject={() => {
            setProjects(
              projects.length === 1
                ? [{ ...PROJECTS[0]!, under: UNDER_ACME }, PROJECTS[1]!]
                : [PROJECTS[1]!],
            )
            setOpened(new Set())
            args.onAddProject()
          }}
        />
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add a Project' }))
    // At once, while its row grows in: not once it has landed.
    await userEvent.click(canvas.getByRole('button', { name: 'Open the missions of Acme' }))
    await waitFor(() => {
      const acme = canvas.getByRole('button', { name: 'Acme' }).getBoundingClientRect()
      const last = canvas.getByRole('button', { name: /ACME-15/ }).getBoundingClientRect()
      const add = canvas.getByRole('button', { name: 'Add a Project' }).getBoundingClientRect()
      // The row whole, under the heading rather than slid up into it…
      expect(acme.top).toBeGreaterThanOrEqual(
        canvas.getByText('Projects').getBoundingClientRect().bottom,
      )
      // …every row under it shown, and what follows pushed past them.
      expect(canvas.getByRole('button', { name: /ACME-15/ })).toBeVisible()
      expect(add.top).toBeGreaterThanOrEqual(last.bottom)
    })
  },
}

/** No Project at all, and nothing waiting: Home without a count, and the way to add one. */
export const Empty: Story = {
  args: { projects: [], waiting: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Home' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Add a Project' })).toBeInTheDocument()
  },
}

/** A Project opened on its chevron: its missions grow under it, and fold away again. */
export const Opened: Story = {
  args: { projects: [{ ...PROJECTS[0]!, under: UNDER_ACME }, PROJECTS[1]!] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /ACME-12/ })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Open the missions of Acme' }))
    expect(args.onOpen).toHaveBeenCalledWith('acme', true)
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /ACME-12/ })).toBeVisible()
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Fold the missions of Acme' }))
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: /ACME-12/ })).toBeNull()
    })
  },
}

/** On a mission: its row under its Project is the current place. */
export const OnAMission: Story = {
  args: {
    projects: [
      {
        ...PROJECTS[0]!,
        under: (
          <SidebarMissionGroups
            missions={SIDEBAR_MISSIONS}
            current={{ kind: 'mission', key: MISSION.key }}
            onMission={fn()}
          />
        ),
      },
      PROJECTS[1]!,
    ],
    opened: new Set(['acme']),
    current: { kind: 'mission', key: MISSION.key },
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button', { name: /ACME-12/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
}

/** Twelve Projects, long names: each row ends in an ellipsis, the column scrolls, Settings stays. */
export const Dense: Story = {
  args: { projects: MANY_PROJECTS, waiting: 23 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = within(canvas.getByRole('button', { name: LONG_NAME })).getByText(LONG_NAME)
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    expect(canvas.getByRole('button', { name: 'Settings' })).toBeVisible()
  },
}

/** Folded: a rail of icons, the Projects as their letters, every place named beside it; and open again. */
export const Folded: Story = {
  args: { folded: true, projects: MANY_PROJECTS, waiting: 23 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Home, 23 waiting' })).toBeInTheDocument()
    expect(canvas.getByText('Projects')).not.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Open the sidebar' }))
    await waitFor(() => {
      expect(canvas.getByText('Projects')).toBeVisible()
    })
  },
}

/** The Projects on their way: their shape, and the list says it is busy. */
export const Loading: Story = {
  args: { projects: [], loading: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
    const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-project-skeleton]')]
    expect(rows).toHaveLength(3)
    // Each is a row of the sidebar's own height, never a block stretched down the list.
    const home = within(canvasElement).getByRole('button', { name: /^Home/ })
    for (const row of rows) {
      expect(row.getBoundingClientRect().height).toBe(home.getBoundingClientRect().height)
    }
  },
}

/** The Projects could not be read: said in words, where they would be. */
export const Error: Story = {
  args: { projects: [], error: 'Hemera could not read the Projects: the profile is locked.' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toHaveTextContent('could not read')
  },
}

/** From the keyboard: Home, each Project (its chevron after it when it has missions), Add a Project, Settings. */
export const Focused: Story = {
  args: { projects: [{ ...PROJECTS[0]!, under: UNDER_ACME }, PROJECTS[1]!] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Home, 2 waiting' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Acme' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Open the missions of Acme' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Hemera' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(args.onProject).toHaveBeenCalledWith('hemera')
    await userEvent.tab()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Settings' })).toHaveFocus()
  },
}

/**
 * Projects marked as their users chose: Hemera with an icon in a tone, Billing with a logo of its
 * own, the others with their letter in the tone of their name.
 */
export const Marked: Story = {
  args: { projects: MARKED_PROJECTS },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-mark-icon="rocket"]')).not.toBeNull()
    expect(canvasElement.querySelector('[data-mark-image]')).not.toBeNull()
  },
}

/** "New Chat" pressed: what the stories below check it was asked. */
const startChat = fn()

/** Acme's Chats under it, the latest first, then the row that starts a new one. */
const chatsOfAcme = (newChat: Partial<SidebarChatRowProps> = {}) => [
  {
    ...PROJECTS[0]!,
    under: (
      <>
        {CHATS.map((chat) => (
          <SidebarChatRow key={chat.id} id={chat.id} title={chat.title} onPress={fn()} />
        ))}
        <SidebarChatRow id="new:acme" title="New Chat" onPress={startChat} {...newChat} />
      </>
    ),
  },
  PROJECTS[1]!,
]

/** A Project opened on its Chats: each with the Chat's glyph and its title, then "New Chat". */
export const WithChats: Story = {
  args: { projects: chatsOfAcme(), opened: new Set(['acme']) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Invoices export' })).toBeVisible()
    startChat.mockClear()
    await userEvent.click(canvas.getByRole('button', { name: 'New Chat' }))
    expect(startChat).toHaveBeenCalledOnce()
  },
}

/** A Chat being started: "New Chat" takes no second press until the engine answers. */
export const NewChatStarting: Story = {
  args: { projects: chatsOfAcme({ pending: true }), opened: new Set(['acme']) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'New Chat' })).toBeDisabled()
    expect(canvas.getByRole('button', { name: 'New Chat' })).toHaveAttribute('aria-busy', 'true')
  },
}

/** A Chat the engine could not start: said in words under "New Chat", which can be pressed again. */
export const NewChatRefused: Story = {
  args: {
    projects: chatsOfAcme({
      error: 'The Chat could not be started: Hemera could not write to its profile.',
    }),
    opened: new Set(['acme']),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('could not be started')
    expect(canvas.getByRole('button', { name: 'New Chat' })).toBeEnabled()
  },
}

/** The missions under a Project by stage, in the stages' order, each group with its count. */
export const MissionsByStage: Story = {
  args: {
    projects: [{ ...PROJECTS[0]!, under: UNDER_ACME }, PROJECTS[1]!],
    opened: new Set(['acme']),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const groups = canvas.getAllByRole('group').map((group) => group.getAttribute('aria-label'))
    expect(groups).toEqual(['Review', 'Building', 'Planning', 'Done', 'Cancelled'])
    const review = within(canvas.getByRole('group', { name: 'Review' }))
    expect(review.getByText('1')).toBeVisible()
    expect(review.getByRole('button', { name: /ACME-12/ })).toBeVisible()
    // The row's second line: the last event in words.
    expect(canvas.getByText('T3 done in api, T4 started in web')).toBeVisible()
    expect(canvas.getByText('60%')).toBeVisible()
  },
}

/** Done and Cancelled are folded: their heading opens them, and folds them back. */
export const FoldedStages: Story = {
  args: {
    projects: [{ ...PROJECTS[0]!, under: UNDER_ACME }, PROJECTS[1]!],
    opened: new Set(['acme']),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const done = canvas.getByRole('button', { name: /^Done/ })
    expect(done).toHaveAttribute('aria-expanded', 'false')
    expect(canvas.getByRole('button', { name: /^Cancelled/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(canvas.queryByRole('button', { name: /ACME-9/ })).toBeNull()
    await userEvent.click(done)
    expect(done).toHaveAttribute('aria-expanded', 'true')
    expect(await canvas.findByRole('button', { name: /ACME-9/ })).toBeVisible()
    await userEvent.click(done)
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: /ACME-9/ })).toBeNull()
    })
  },
}

/** A mission that needs the user wears a dot in the warning tone, named for a screen reader. */
export const NeedsYou: Story = {
  args: {
    projects: [{ ...PROJECTS[0]!, under: UNDER_ACME }, PROJECTS[1]!],
    opened: new Set(['acme']),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /ACME-12/ })
    expect(within(row).getByRole('img', { name: 'Needs you' })).toBeInTheDocument()
    expect(
      within(canvas.getByRole('button', { name: /ACME-15/ })).queryByRole('img', {
        name: 'Needs you',
      }),
    ).toBeNull()
  },
}

/** A long title and a long event end in an ellipsis: the row keeps its two lines. */
export const LongTitles: Story = {
  args: {
    projects: [
      {
        ...PROJECTS[0]!,
        under: (
          <SidebarMissionGroups
            missions={SIDEBAR_MISSIONS.map((mission) => ({
              ...mission,
              title: `${mission.title}, with the customer filters kept and a progress for the long ones`,
              event: 'The agent wrote the tests of the export of every invoice of every customer',
            }))}
            current={{ kind: 'home' }}
            onMission={fn()}
          />
        ),
      },
      PROJECTS[1]!,
    ],
    opened: new Set(['acme']),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /ACME-12/ })
    const title = within(row).getByText(/^Export invoices as CSV/)
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
    expect(row.getBoundingClientRect().height).toBeLessThan(64)
  },
}

/**
 * A mission that changes stage moves to the other group: ACME-14 goes from Planning to Ready
 * when the control beside the sidebar says so, and the sidebar draws the new group in place.
 */
export const MovesStage: Story = {
  args: { projects: [PROJECTS[0]!, PROJECTS[1]!], opened: new Set(['acme']) },
  render: (args) => {
    const [stage, setStage] = useState<SidebarMissionEntry['stage']>('Planning')
    const missions = SIDEBAR_MISSIONS.map((mission) =>
      mission.missionKey === 'ACME-14' ? Object.assign({}, mission, { stage }) : mission,
    )
    return (
      <div className="flex h-screen bg-surface-page">
        <Sidebar
          {...args}
          projects={[
            {
              ...PROJECTS[0]!,
              under: (
                <SidebarMissionGroups
                  missions={missions}
                  current={{ kind: 'home' }}
                  onMission={fn()}
                />
              ),
            },
            PROJECTS[1]!,
          ]}
        />
        <div className="p-4">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => setStage(stage === 'Planning' ? 'Ready' : 'Planning')}
          >
            Move ACME-14 to {stage === 'Planning' ? 'Ready' : 'Planning'}
          </button>
        </div>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      within(canvas.getByRole('group', { name: 'Planning' })).getByRole('button', {
        name: /ACME-14/,
      }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Move ACME-14 to Ready' }))
    await waitFor(() => {
      expect(canvas.queryByRole('group', { name: 'Planning' })).toBeNull()
      expect(
        within(canvas.getByRole('group', { name: 'Ready' })).getByRole('button', {
          name: /ACME-14/,
        }),
      ).toBeVisible()
    })
  },
}

/** Folded to its rail, a Project keeps its missions out of the way: nothing of them is drawn. */
export const FoldedRail: Story = {
  args: {
    folded: true,
    projects: [{ ...PROJECTS[0]!, under: UNDER_ACME }, PROJECTS[1]!],
    opened: new Set(['acme']),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Home, 2 waiting' })).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: /ACME-12/ })).toBeNull()
    expect(canvas.queryByRole('group')).toBeNull()
  },
}
