import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import type { ThemeChoice } from '../window.ts'
import {
  Settings,
  type ArchivedProject,
  type ProfileFacts,
  type SettingsProps,
} from './settings.tsx'

/**
 * The settings of the application, on fixtures (design D4-07).
 *
 * The Profile block is what `engine.status` answered, written out as it came: the page neither
 * measures the database nor counts the backups, it says what it was told.
 */
const FACTS: ProfileFacts = {
  directory: 'C:\\Users\\someone\\AppData\\Local\\hemera\\prod',
  database: 'hemera.sqlite · 1.2 MB',
  lastMigration: '20260916_projects_and_journal',
  writtenByVersion: '0.4.0-beta.3',
  backups: '2 · latest before 20260916_projects_and_journal',
}

const ARCHIVED: ArchivedProject[] = [
  { id: 'ml', name: 'ML playground', archivedAt: 'last week' },
  { id: 'shop', name: 'Legacy shop', archivedAt: 'in August' },
]

function Controlled({ theme, archived, onThemeChange, onRestore, ...rest }: SettingsProps) {
  const [chosen, setChosen] = useState<ThemeChoice>(theme)
  const [kept, setKept] = useState(archived)
  return (
    <Settings
      {...rest}
      theme={chosen}
      onThemeChange={(next) => {
        setChosen(next)
        onThemeChange(next)
      }}
      archived={kept}
      onRestore={(id) => {
        setKept(kept.filter((project) => project.id !== id))
        onRestore(id)
      }}
    />
  )
}

/** What this machine has, as `agents.check` answered when the section was opened (D5-18). */
const AGENTS: SettingsProps['agents'] = {
  agents: [
    {
      id: 'claude',
      name: 'Claude Code',
      found: true,
      version: '2.0.31',
      authenticated: true,
      installHint: 'npm i -g @anthropic-ai/claude-code',
      loginHint: 'claude auth login',
      installer: 'npm',
      latest: '2.0.35',
      bare: {
        qualified: true,
        private:
          'its managed and policy settings and ~/.claude.json still load; Hemera does not read them.',
      },
    },
    {
      id: 'codex',
      name: 'Codex',
      found: true,
      version: '0.9.4',
      authenticated: false,
      installHint: 'npm i -g @openai/codex',
      loginHint: 'codex login',
      installer: 'pnpm',
      latest: '0.9.4',
      bare: {
        qualified: false,
        reason:
          'apply_patch has no configuration key, and the MCP resource tools appear as soon as an MCP server exists. Hemera would not see those calls, so this Session is not opened.',
      },
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      found: false,
      version: null,
      authenticated: false,
      installHint: 'npm i -g opencode-ai',
      loginHint: 'opencode auth login',
      installer: 'unknown',
      latest: null,
      bare: {
        qualified: true,
        private:
          '$HOME/.opencode, its managed configuration and a remote .well-known/opencode still load; Hemera does not read them.',
      },
    },
  ],
  checked: true,
  updating: null,
  output: {},
  onUpdate: fn(),
}

const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Surfaces/Settings',
  component: Settings,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    subtitle: 'Hemera Beta 0.4.0-beta.3 · channel beta',
    theme: 'dark',
    facts: FACTS,
    agents: AGENTS,
    archived: ARCHIVED,
    onThemeChange: fn(),
    onOpenFolder: fn(),
    onOpenDiagnostic: fn(),
    onRestore: fn(),
  },
  argTypes: {
    subtitle: { control: 'text', description: 'The product, its version and its channel.' },
    agents: { control: 'object', description: 'What this machine has, and its one press.' },
    theme: {
      control: 'inline-radio',
      options: ['system', 'light', 'dark'],
      description: 'What the user chose, which is one more than what the window wears.',
    },
    facts: { control: 'object', description: 'What the engine reported, word for word.' },
    archived: { control: 'object', description: 'The Projects taken out of the bar.' },
    onThemeChange: { action: 'theme changed' },
    onOpenFolder: { action: 'folder opened' },
    onOpenDiagnostic: { action: 'diagnostic opened' },
    onRestore: { action: 'restored' },
  },
} satisfies Meta<typeof Settings>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** The three theme choices, one of them on, and the Profile as the engine reported it. */
export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('radio')).toHaveLength(3)
    expect(canvas.getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(canvas.getByText('hemera.sqlite · 1.2 MB')).toBeInTheDocument()
    expect(canvas.getByText('20260916_projects_and_journal')).toBeInTheDocument()
  },
}

/** Scenario « Thème » of `specs/shell-navigation/spec.md`, as far as a page goes. */
export const States: Story = {
  play: async ({ canvasElement, args }) => {
    args.onThemeChange.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('radio', { name: 'Light' }))
    await waitFor(() => {
      expect(canvas.getByRole('radio', { name: 'Light' })).toBeChecked()
    })
    expect(args.onThemeChange).toHaveBeenCalledWith('light')
    expect(canvas.getByRole('radio', { name: 'Dark' })).not.toBeChecked()
  },
}

/** A data folder nothing has been written into yet: every line says so rather than guessing. */
export const NothingWrittenYet: Story = {
  args: {
    facts: {
      directory: '/home/someone/.local/share/hemera/dev',
      database: 'hemera.sqlite · 24 KB',
      lastMigration: null,
      writtenByVersion: null,
      backups: null,
    },
    archived: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('none yet')).toBeInTheDocument()
    expect(canvas.getByText('nobody yet')).toBeInTheDocument()
    expect(canvas.getByText('none taken yet')).toBeInTheDocument()
    expect(canvas.getByText(/No Project has been archived/)).toBeInTheDocument()
  },
}

/** Scenario « Ouvrir le dossier » of `specs/shell-navigation/spec.md`, as far as a page goes. */
export const OpeningTheFolder: Story = {
  play: async ({ canvasElement, args }) => {
    args.onOpenFolder.mockClear()
    args.onOpenDiagnostic.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Open the folder' }))
    expect(args.onOpenFolder).toHaveBeenCalled()

    await userEvent.click(canvas.getByRole('button', { name: 'Open diagnostic.log' }))
    expect(args.onOpenDiagnostic).toHaveBeenCalled()
  },
}

/** Scenario « Restaurer un Projet » of `specs/shell-navigation/spec.md`. */
export const RestoringAProject: Story = {
  play: async ({ canvasElement, args }) => {
    args.onRestore.mockClear()
    const canvas = within(canvasElement)

    // The page lists other things too — the agents of this machine, among them — so what is
    // restored is read off the rows that carry the press.
    const lines = canvas
      .getAllByRole('listitem')
      .filter((row) => within(row).queryByRole('button', { name: 'Restore' }) !== null)
    expect(lines).toHaveLength(2)
    await userEvent.click(within(lines[0]!).getByRole('button', { name: 'Restore' }))
    expect(args.onRestore).toHaveBeenCalledWith('ml')
    // It leaves the list it was restored from.
    await waitFor(() => {
      const left = canvas
        .getAllByRole('listitem')
        .filter((row) => within(row).queryByRole('button', { name: 'Restore' }) !== null)
      expect(left).toHaveLength(1)
    })
  },
}

/** The segment is one stop of the tab order, and the arrows move inside it. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('radio', { name: 'Dark' })).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(canvas.getByRole('radio', { name: 'System' })).toBeChecked()
    })
  },
}
