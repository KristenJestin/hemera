import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { ChromeBar } from './chrome-bar.tsx'
import type { ShellProject } from './model.ts'

const PROJECTS: ShellProject[] = [
  { id: 'atlas', name: 'Atlas', tone: 'primary', pending: 5 },
  { id: 'notes', name: 'Notes', tone: 'info', pending: 0 },
  { id: 'docs', name: 'Hemera docs', tone: 'warning', pending: 1 },
]

const meta = {
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
  },
  argTypes: {
    projects: { table: { disable: true } },
    notifications: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="h-24">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChromeBar>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { collapsed: true },
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
