import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import type { ThemeChoice } from '../window.ts'
import {
  EVALUATION_ENGINES,
  type ClassifierSectionProps,
  type ClassifierMode,
  type CredentialStatus,
} from './classifier-section.tsx'
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

function Controlled({
  theme,
  archived,
  classifier,
  onThemeChange,
  onRestore,
  ...rest
}: SettingsProps) {
  const [chosen, setChosen] = useState<ThemeChoice>(theme)
  const [kept, setKept] = useState(archived)
  const [mode, setMode] = useState<ClassifierMode>(classifier?.mode ?? 'agent-default')
  const [engine, setEngine] = useState(classifier?.engine ?? 'jev')
  const [credential, setCredential] = useState<CredentialStatus>(
    classifier?.credential ?? 'missing',
  )
  const [consent, setConsent] = useState(classifier?.consent ?? false)
  return (
    <Settings
      {...rest}
      classifier={
        classifier === undefined
          ? undefined
          : {
              ...classifier,
              mode,
              engine,
              credential,
              consent,
              credentialMessage:
                credential === 'invalid'
                  ? 'The key was rejected. Replace it to retry.'
                  : classifier.credentialMessage,
              onModeChange: (next) => {
                setMode(next)
                classifier.onModeChange(next)
              },
              onEngineChange: (next) => {
                setEngine(next)
                classifier.onEngineChange(next)
              },
              onConsentChange: (next) => {
                setConsent(next)
                classifier.onConsentChange(next)
              },
              onSaveKey: (key) => {
                setCredential(key === 'invalid' ? 'invalid' : 'saved')
                classifier.onSaveKey(key)
              },
              onRemoveKey: () => {
                setCredential('missing')
                classifier.onRemoveKey()
              },
            }
      }
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

const CLASSIFIER: ClassifierSectionProps = {
  mode: 'agent-default',
  onModeChange: fn(),
  engine: 'jev',
  onEngineChange: fn(),
  credential: 'missing',
  evaluator: 'ready',
  consent: false,
  onConsentChange: fn(),
  onSaveKey: fn(),
  onRemoveKey: fn(),
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
    classifier: CLASSIFIER,
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

/** The assembled App Settings surface, with the application-wide choice visible. */
export const Complete: Story = {}

export const Playground: Story = {}

/** The three theme choices, one of them on, and the Profile as the engine reported it. */
export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('radio')).toHaveLength(5)
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

/** Agent default remains selected when a key is saved, and the mode is global. */
export const ClassifierSelection: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const defaultMode = canvas.getByRole('radio', { name: /Agent default/ })
    const auto = canvas.getByRole('radio', { name: /Hemera Auto/ })
    expect(defaultMode).toBeChecked()
    expect(canvas.queryByText('Data sent to TypeSafe AI')).toBeNull()
    await userEvent.click(auto)
    await waitFor(() => expect(auto).toBeChecked())
    expect(defaultMode).not.toBeChecked()
    expect(args.classifier?.onModeChange).toHaveBeenCalledWith('hemera-auto')
    expect(canvas.getByText('Data sent to TypeSafe AI')).toBeInTheDocument()
    await userEvent.click(defaultMode)
    await waitFor(() => expect(defaultMode).toBeChecked())
  },
}

/** The full key journey uses mock state and never holds a real credential. */
export const CredentialJourney: Story = {
  args: { classifier: { ...CLASSIFIER, mode: 'hemera-auto', consent: true } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const field = canvas.getByLabelText('Jev API key')
    await userEvent.type(field, 'storybook-demo-key')
    await userEvent.click(canvas.getByRole('button', { name: 'Save key' }))
    expect(args.classifier?.onSaveKey).toHaveBeenCalledWith('storybook-demo-key')
    await waitFor(() => expect(canvas.getByText('Saved')).toBeInTheDocument())
    expect(canvas.getByRole('radio', { name: /Hemera Auto/ })).toBeChecked()
    await userEvent.type(field, 'replacement-demo-key')
    await userEvent.click(canvas.getByRole('button', { name: 'Replace key' }))
    expect(args.classifier?.onSaveKey).toHaveBeenCalledWith('replacement-demo-key')
    await userEvent.click(canvas.getByRole('button', { name: 'Remove key' }))
    await waitFor(() => expect(canvas.getByText('Key required')).toBeVisible())
    await expect(field).toHaveFocus()
    expect(args.classifier?.onRemoveKey).toHaveBeenCalled()
  },
}

export const MissingKey: Story = {
  args: { classifier: { ...CLASSIFIER, mode: 'hemera-auto' } },
}

export const InvalidKey: Story = {
  args: {
    classifier: {
      ...CLASSIFIER,
      mode: 'hemera-auto',
      credential: 'invalid',
      credentialMessage: 'The key was rejected. Replace it to retry.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Key rejected')).toBeVisible()
    expect(canvas.getByRole('alert')).toHaveTextContent('The key was rejected')
  },
}

export const StorageUnavailable: Story = {
  args: {
    classifier: {
      ...CLASSIFIER,
      mode: 'hemera-auto',
      credential: 'storage-unavailable',
      credentialMessage: 'Protected credential storage is unavailable on this machine.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Protected storage unavailable')).toBeVisible()
    expect(canvas.getByLabelText('Jev API key')).toBeDisabled()
    expect(canvas.getByRole('button', { name: 'Save key' })).toBeDisabled()
  },
}

export const EvaluatorUnavailable: Story = {
  args: {
    classifier: {
      ...CLASSIFIER,
      mode: 'hemera-auto',
      credential: 'saved',
      evaluator: 'unavailable',
    },
  },
}

export const ConsentRequired: Story = {
  args: {
    classifier: { ...CLASSIFIER, mode: 'hemera-auto', credential: 'saved', consent: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Consent required')).toBeVisible()
    await userEvent.click(canvas.getByRole('checkbox', { name: /Allow this evaluation data/ }))
    await waitFor(() => expect(canvas.getByText('Ready')).toBeVisible())
  },
}

export const TransitionPending: Story = {
  args: {
    classifier: {
      ...CLASSIFIER,
      mode: 'hemera-auto',
      credential: 'saved',
      evaluator: 'transitioning',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Changing across Sessions…')).toBeVisible()
    expect(canvas.getByRole('radio', { name: /Agent default/ })).toBeDisabled()
    expect(canvas.getByRole('radio', { name: /Hemera Auto/ })).toBeDisabled()
  },
}

/** A second injected engine fits the same single-choice list without a second mode toggle. */
export const ExtensibleEngine: Story = {
  name: 'The application classifier selector is accessible and extensible',
  args: {
    classifier: {
      ...CLASSIFIER,
      mode: 'hemera-auto',
      credential: 'saved',
      engines: [
        ...EVALUATION_ENGINES,
        {
          id: 'fixture',
          label: 'Fixture engine',
          provider: 'Test only',
          description: 'A Storybook option.',
          available: true,
        },
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: /Fixture engine/ }))
    expect(args.classifier?.onEngineChange).toHaveBeenCalledWith('fixture')
    expect(canvas.getByRole('radio', { name: /Hemera Auto/ })).toBeChecked()
  },
}

/** The main choice is one keyboard group; engine selection stays below the selected mode. */
export const ClassifierKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const defaultMode = canvas.getByRole('radio', { name: /Agent default/ })
    defaultMode.focus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(canvas.getByRole('radio', { name: /Hemera Auto/ })).toBeChecked())
    expect(canvas.getByRole('radio', { name: /Hemera Auto/ })).toHaveFocus()
    expect(canvas.getByRole('radiogroup', { name: 'Evaluation engine' })).toBeVisible()
  },
}
