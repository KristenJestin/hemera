import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { BallMark } from '../blocks/ball/ball-mark.tsx'
import { ContentHeader } from './content-header.tsx'
import { LONG_NAME, MANY_PROJECTS, MARKED_PROJECTS, MISSION, PROJECTS } from './shell-fixtures.tsx'
import { Sidebar, type SidebarPlace, SidebarRow } from './sidebar.tsx'

/**
 * The sidebar alone, on the page surface it stands on: Hemera's head, Home and its count, the
 * Projects and the missions under each, Settings at the bottom; open, and folded to its rail.
 */
const UNDER_ACME = (
  <>
    <SidebarRow
      missionKey={MISSION.key}
      title={MISSION.title}
      trailing={<BallMark ball="you" />}
      onPress={fn()}
    />
    <SidebarRow
      missionKey="ACME-15"
      title="Retry a failed webhook from its row"
      trailing={<BallMark ball="agent" />}
      onPress={fn()}
    />
  </>
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
          <SidebarRow
            missionKey={MISSION.key}
            title={MISSION.title}
            trailing={<BallMark ball="you" />}
            current
            onPress={fn()}
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
    expect(canvasElement.querySelectorAll('[data-project-skeleton]')).toHaveLength(2)
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
