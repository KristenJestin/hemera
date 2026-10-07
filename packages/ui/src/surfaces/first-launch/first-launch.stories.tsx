import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconHome } from '../../icons.ts'
import { ContentHeader } from '../../shell/content-header.tsx'
import { SystemControls } from '../../shell/shell-fixtures.tsx'
import { FirstLaunch, type FirstLaunchProps } from './first-launch.tsx'

/**
 * The window the first time Hemera opens: no Project yet, the empty state and the two ways in. The
 * settings have nothing to do here (the maintainer, 7 October). What stops everything — Git
 * missing, no agent installed — is an app need above it. Each story is the page full-bleed under
 * the window's header; the toolbar's viewports give its two sizes.
 */
function Window(args: FirstLaunchProps) {
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={() => {}}
        crumbs={[{ id: 'home', label: 'Home', icon: <IconHome size="sm" /> }]}
        controls={<SystemControls />}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <FirstLaunch {...args} />
      </div>
    </main>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/First launch',
  component: FirstLaunch,
  parameters: { layout: 'fullscreen' },
  args: {
    git: true,
    noAgent: false,
    onCheck: fn(),
    onCheckGit: fn(),
    onAddFolder: fn(),
    onCreate: fn(),
  },
  render: (args) => <Window {...args} />,
} satisfies Meta<typeof FirstLaunch>

export default meta
type Story = StoryObj<typeof meta>

/** No Project yet: Hemera asleep, and the two ways in, the folder first. No settings here. */
export const Empty: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('No Project yet')).toBeVisible()
    expect(canvas.queryByText('Agents on this machine')).toBeNull()
    expect(canvas.queryByText('Hemera Auto')).toBeNull()
    expect(canvas.queryByRole('article')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a Project folder…' }))
    expect(args.onAddFolder).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Create a new Project' }))
    expect(args.onCreate).toHaveBeenCalled()
  },
}

/** No agent installed: the need above, and the ways in still there. */
export const NoAgent: Story = {
  args: { noAgent: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('article', { name: 'Something missing: No agent is installed' }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Check again' }))
    expect(args.onCheck).toHaveBeenCalled()
    expect(canvas.getByRole('button', { name: 'Add a Project folder…' })).toBeVisible()
  },
}

/** Git missing: the need above, and no way in until it answers. */
export const GitMissing: Story = {
  args: { git: false },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('article', { name: 'Something missing: Git is not installed' }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Check again' }))
    expect(args.onCheckGit).toHaveBeenCalled()
    expect(canvas.queryByRole('button', { name: 'Add a Project folder…' })).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Create a new Project' })).toBeNull()
  },
}

/** From the keyboard: the two ways in, the folder first, each with its ring. */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const folder = canvas.getByRole('button', { name: 'Add a Project folder…' })
    folder.focus()
    await waitFor(() => {
      expect(getComputedStyle(folder, '::after').opacity).toBe('1')
    })
    await userEvent.keyboard('{Enter}')
    expect(args.onAddFolder).toHaveBeenCalled()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Create a new Project' })).toHaveFocus()
  },
}

/** Asked for less movement: nothing on this page moves, the need is there at once. */
export const ReducedMotion: Story = {
  args: { git: false },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <Window {...args} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('article', {
        name: 'Something missing: Git is not installed',
      }),
    ).toBeVisible()
  },
}
