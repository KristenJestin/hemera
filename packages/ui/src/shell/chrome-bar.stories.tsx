import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { useState } from 'react'

import { ChromeBar, type ChromeBarProps } from './chrome-bar.tsx'
import type { ShellProject } from './model.ts'

const PROJECTS: ShellProject[] = [
  { id: 'atlas', name: 'Atlas', tone: 'primary', pending: 5 },
  { id: 'notes', name: 'Notes', tone: 'info', pending: 0 },
  { id: 'docs', name: 'Hemera docs', tone: 'warning', pending: 1 },
]

const meta = {
  tags: ['autodocs'],
  title: 'Shell/ChromeBar',
  component: ChromeBar,
  parameters: { layout: 'fullscreen' },
  args: {
    projects: PROJECTS,
    activeProjectId: 'atlas',
    onSelectProject: fn(),
    onAddProject: fn(),
    collapsed: false,
    onToggleCollapsed: fn(),
    collapseShortcut: 'Ctrl+B',
    notifications: <p className="text-muted-foreground">Notifications: lot 4.</p>,
    unseen: true,
  },
  argTypes: {
    projects: { table: { disable: true } },
    notifications: { table: { disable: true } },
  },
  decorators: [
    // With the sheet the bar sits on, because the bar is drawn against it: the active tab runs
    // a pixel past the bottom of the bar to cover that sheet's top edge, and its two flares are
    // the sheet's own surface reaching up to meet it. Shown over nothing, all of that is a white
    // shape floating on grey — which is the bar of a different application, not this one.
    (Story) => (
      <div className="flex h-24 flex-col bg-surface-page">
        <Story />
        <div className="mt-title-bar flex-1">
          <div className="content-area size-full bg-surface-content" />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof ChromeBar>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** More Projects than the bar is wide: the strip says where it continues, at the end it has. */
export const Crowded: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: {
    projects: Array.from({ length: 14 }, (_, index) => ({
      id: `project-${index}`,
      name: `Project number ${index + 1}`,
      tone: PROJECTS[index % PROJECTS.length]!.tone,
      pending: index % 3,
    })),
    // One of these fourteen, and not the Project the other stories use: a bar whose active
    // Project is not in its own strip is a bar with no active tab, which is a different story
    // from this one.
    activeProjectId: 'project-0',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Nothing to the left yet, and plenty to the right.
    expect(canvas.queryByRole('button', { name: 'Scroll left' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Scroll right' }))
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Scroll left' })).toBeInTheDocument()
    })
  },
}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { collapsed: true },
}

/** The bar of a first launch: the mark, the fold, and nothing that supposes a Project. */
export const WithoutAProject: Story = {
  parameters: { controls: { disable: true } },
  args: { projects: [], activeProjectId: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('navigation', { name: 'Projects' })).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Add a Project' })).toBeNull()
    expect(canvas.queryByRole('button', { name: /Notifications/ })).toBeNull()
    expect(canvas.getByRole('button', { name: 'Collapse the sidebar' })).toBeInTheDocument()
  },
}

/** Scenario « Déplacement par la barre » of `specs/window-shell/spec.md`. */
export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement }) => {
    const bar = canvasElement.querySelector('header')!
    const tab = within(canvasElement).getByRole('button', { name: /Atlas/ })
    const fold = within(canvasElement).getByRole('button', { name: 'Collapse the sidebar' })

    // The strip moves the window, and every control on it opts back out.
    expect(getComputedStyle(bar).getPropertyValue('app-region')).toBe('drag')
    expect(getComputedStyle(tab).getPropertyValue('app-region')).toBe('no-drag')
    expect(getComputedStyle(fold).getPropertyValue('app-region')).toBe('no-drag')
  },
}

/**
 * The mark crossing the strip (design D2-02).
 *
 * It stretches: one sheet opens over both the tab it leaves and the tab it is going to, holds,
 * then closes onto the second, the leading edge first. Press another Project to see it.
 */
export const SwitchingProject: Story = {
  // Held here, because a mark that travels needs something to travel between: the bar itself
  // holds nothing, and a story handing it a fixed Project would never move it.
  render: (args) => <Switching {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Notes/ }))
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Notes/ })).toHaveAttribute('aria-current', 'page')
    })
  },
}

function Switching({ activeProjectId, onSelectProject, ...rest }: ChromeBarProps) {
  const [active, setActive] = useState(activeProjectId)
  return (
    <ChromeBar
      {...rest}
      activeProjectId={active}
      onSelectProject={(id) => {
        setActive(id)
        onSelectProject(id)
      }}
    />
  )
}
