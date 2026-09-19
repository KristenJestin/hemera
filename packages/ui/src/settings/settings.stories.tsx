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

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Settings',
  component: Settings,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    subtitle: 'Hemera Beta 0.4.0-beta.3 · channel beta',
    theme: 'dark',
    facts: FACTS,
    archived: ARCHIVED,
    onThemeChange: fn(),
    onOpenFolder: fn(),
    onOpenDiagnostic: fn(),
    onRestore: fn(),
  },
  argTypes: {
    subtitle: { control: 'text', description: 'The product, its version and its channel.' },
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

    const lines = canvas.getAllByRole('listitem')
    expect(lines).toHaveLength(2)
    await userEvent.click(within(lines[0]!).getByRole('button', { name: 'Restore' }))
    expect(args.onRestore).toHaveBeenCalledWith('ml')
    // It leaves the list it was restored from.
    await waitFor(() => {
      expect(canvas.getAllByRole('listitem')).toHaveLength(1)
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
