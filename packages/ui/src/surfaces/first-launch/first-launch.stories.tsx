import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { AgentRow } from '../../blocks/app-settings/app-sections.tsx'
import { IconHome } from '../../icons.ts'
import { ContentHeader } from '../../shell/content-header.tsx'
import { SystemControls } from '../../shell/shell-fixtures.tsx'
import { FirstLaunch, type FirstLaunchProps } from './first-launch.tsx'

/**
 * The window the first time Hemera opens: no Project yet; the agents on this machine, Hemera Auto
 * as it stands, and the two ways in. What stops everything — Git missing, no agent installed — is an
 * app need above the rest. Each story is the page full-bleed under the window's header; the
 * toolbar's viewports give its two sizes.
 */
const AGENTS: readonly AgentRow[] = [
  {
    name: 'Claude Code',
    state: {
      installed: true,
      version: '2.1.280',
      installer: 'npm',
      signedIn: true,
      signIn: 'claude /login',
    },
  },
  {
    name: 'Codex',
    state: {
      installed: true,
      version: '0.154.0',
      installer: 'brew',
      signedIn: false,
      signIn: 'codex login',
    },
  },
  { name: 'OpenCode', state: { installed: false, install: 'npm install -g opencode-ai' } },
]

const NONE: readonly AgentRow[] = [
  {
    name: 'Claude Code',
    state: { installed: false, install: 'npm install -g @anthropic-ai/claude-code' },
  },
  { name: 'Codex', state: { installed: false, install: 'npm install -g @openai/codex' } },
  { name: 'OpenCode', state: { installed: false, install: 'npm install -g opencode-ai' } },
]

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
    agents: AGENTS,
    onCheck: fn(),
    onUpdate: fn(),
    onCopy: fn(),
    git: true,
    onCheckGit: fn(),
    jevKey: 'missing',
    onAddKey: fn(),
    onAddFolder: fn(),
    onCreate: fn(),
  },
  argTypes: { agents: { table: { disable: true } } },
  render: (args) => <Window {...args} />,
} satisfies Meta<typeof FirstLaunch>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A machine with Claude Code signed in, Codex installed but not signed in, OpenCode missing; no
 * key for Hemera Auto. The two ways in, adding a folder first.
 */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1, name: 'Welcome to Hemera' })).toBeVisible()
    const agents = canvas.getByRole('region', { name: 'Agents on this machine' })
    expect(within(agents).getByText('2.1.280 · npm')).toBeVisible()
    expect(within(agents).getByRole('img', { name: 'Signed in' })).toBeVisible()
    expect(within(agents).getByRole('button', { name: 'Copy codex login' })).toBeVisible()
    expect(within(agents).getByText('npm install -g opencode-ai')).toBeVisible()
    const auto = canvas.getByRole('region', { name: 'Hemera Auto' })
    expect(within(auto).getByRole('img', { name: 'No key' })).toBeVisible()
    await userEvent.click(within(auto).getByRole('button', { name: 'Add a key' }))
    expect(args.onAddKey).toHaveBeenCalled()
    expect(canvas.queryByRole('article')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a Project folder…' }))
    expect(args.onAddFolder).toHaveBeenCalled()
    expect(canvas.getByRole('button', { name: 'Create a new Project' })).toBeVisible()
  },
}

/** Hemera still looking for the agents: their rows' own shape. */
export const Discovering: Story = {
  args: { discovering: true, agents: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('region', { name: 'Agents on this machine', busy: true }),
    ).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
    expect(canvas.queryByRole('article')).toBeNull()
  },
}

/** No agent installed: an app need above the rest, each agent with its install command. */
export const NoAgent: Story = {
  args: { agents: NONE },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('article', { name: 'Something missing: No agent is installed' }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Check again' }))
    expect(args.onCheck).toHaveBeenCalled()
    expect(canvas.getAllByRole('button', { name: /^Copy npm install -g/ })).toHaveLength(3)
  },
}

/** Git missing: an app need, and the ways in hidden until Git answers. */
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

/** A key already given to Hemera Auto: Jev judges first, then the user; nothing to add. */
export const KeyStored: Story = {
  args: { jevKey: 'saved' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('img', { name: 'Key stored by the system' })).toBeVisible()
    expect(canvas.getByText('Jev, then you')).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Add a key' })).toBeNull()
  },
}

/** A long version, a long installer and a long command: each ends in an ellipsis. */
export const LongText: Story = {
  args: {
    agents: [
      ...AGENTS,
      {
        name: 'An agent with a very long name for a command line tool',
        state: {
          installed: false,
          install:
            'curl -fsSL https://agents.acme.test/install.sh | sh -s -- --channel stable --prefix ~/.local',
        },
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByText(/install\.sh/)
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
  },
}

/**
 * From the keyboard: Check for updates, each command's copy button, Add a key, then the two ways
 * in, the folder first; each with its ring.
 */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const check = canvas.getByRole('button', { name: 'Check for updates' })
    check.focus()
    await userEvent.tab()
    expect(canvas.getByRole('img', { name: 'Signed in' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Copy codex login' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Copy npm install -g opencode-ai' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('img', { name: 'No key' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Add a key' })).toHaveFocus()
    await userEvent.tab()
    const folder = canvas.getByRole('button', { name: 'Add a Project folder…' })
    expect(folder).toHaveFocus()
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
