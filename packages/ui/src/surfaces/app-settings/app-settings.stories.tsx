import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import {
  AgentsSection,
  AppearanceSection,
  DeveloperSection,
  HemeraAutoSection,
  ModelsSection,
  NotificationsSection,
  ProfileSection,
} from '../../blocks/app-settings/app-sections.tsx'
import { AGENTS } from '../../components/model-picker/model-picker-fixtures.ts'
import { AppSettings } from './app-settings.tsx'

/**
 * The application's settings: one page, a section at a time. One story per section, and for each
 * the states it can be in; the deep link opens a section with the focus on its heading.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/App settings',
  component: AppSettings,
  parameters: { layout: 'fullscreen' },
  args: { current: 'appearance', onSection: fn(), children: null },
} satisfies Meta<typeof AppSettings>

export default meta
type Story = StoryObj<typeof meta>

const LANGUAGES = ['English', 'Français', 'Deutsch', 'Español']

export const Appearance: Story = {
  args: {
    children: (
      <AppearanceSection
        theme="system"
        density="comfortable"
        language="English"
        languages={LANGUAGES}
        onTheme={fn()}
        onDensity={fn()}
        onLanguage={fn()}
      />
    ),
  },
}

const agents = (
  <AgentsSection
    agents={[
      {
        name: 'Claude Code',
        state: {
          installed: true,
          version: '2.1.280',
          installer: 'vp',
          signedIn: true,
          signIn: 'claude /login',
        },
      },
      {
        name: 'Codex',
        state: {
          installed: true,
          version: '0.154.0',
          installer: 'npm',
          signedIn: false,
          signIn: 'codex login',
          update: '0.155.1',
        },
      },
      {
        name: 'OpenCode',
        state: {
          installed: true,
          version: '1.17.13',
          signedIn: true,
          signIn: 'opencode auth login',
          update: '1.18.0',
          bareRefused: 'it has not run bare on Linux yet',
        },
      },
    ]}
    onCheck={fn()}
    onUpdate={fn()}
    onCopy={fn()}
  />
)

/**
 * Each agent with the tool that installed it; signed in or not with the command to sign in; bare
 * refused. Hemera found newer versions by itself: the rows say so and the section carries its
 * glyph in the list. An agent whose installer Hemera cannot tell is only told out of date.
 */
export const Agents: Story = {
  args: { current: 'agents', problems: { agents: 'an agent is out of date' }, children: agents },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('2.1.280 · vp')).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Out of date: 0.155.1 is out' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Update to 0.155.1' })).toBeVisible()
    await expect(
      canvas.getByRole('img', {
        name: 'Out of date: 1.18.0 is out. Update it with the tool that installed it.',
      }),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Update to 1.18.0' })).toBeNull()
  },
}

/** An agent not installed: its install command, and the section says so in the list. */
export const AgentMissing: Story = {
  args: {
    current: 'agents',
    problems: { agents: 'an agent is not installed' },
    children: (
      <AgentsSection
        agents={[
          {
            name: 'Claude Code',
            state: {
              installed: true,
              version: '2.1.280',
              installer: 'vp',
              signedIn: true,
              signIn: 'claude /login',
            },
          },
          { name: 'Codex', state: { installed: false, install: 'npm install -g @openai/codex' } },
          { name: 'OpenCode', state: { installed: false, install: 'npm install -g opencode-ai' } },
        ]}
        onCheck={fn()}
        onUpdate={fn()}
        onCopy={fn()}
      />
    ),
  },
}

/** One row per role, the model it uses and the picker. */
export const Models: Story = {
  args: {
    current: 'models',
    children: (
      <ModelsSection
        roles={[
          { role: 'Planner', model: { agent: 'claude', model: 'opus', effort: 'high' } },
          { role: 'Builder', model: { agent: 'claude', model: 'sonnet', effort: 'medium' } },
          { role: 'Reviewer', model: { agent: 'codex', model: 'gpt-large', effort: 'high' } },
          { role: 'Chat', model: { agent: 'claude', model: 'sonnet', effort: 'low' } },
        ]}
        agents={AGENTS}
        onChange={fn()}
        onFavourite={fn()}
        onHide={fn()}
      />
    ),
  },
}

const auto = (props: Partial<Parameters<typeof HemeraAutoSection>[0]>) => (
  <HemeraAutoSection
    jevKey="saved"
    consent="Given on 3 October 2026"
    onKey={fn()}
    onConsent={fn()}
    {...props}
  />
)

/** The key stored, consent given: Jev judges, then you. */
export const HemeraAuto: Story = { args: { current: 'hemera-auto', children: auto({}) } }

export const HemeraAutoNoKey: Story = {
  args: { current: 'hemera-auto', children: auto({ jevKey: 'missing', consent: undefined }) },
}

export const HemeraAutoKeyRefused: Story = {
  args: {
    current: 'hemera-auto',
    problems: { 'hemera-auto': 'the key was refused' },
    children: auto({ jevKey: 'invalid' }),
  },
}

/** Linux without the Secret Service: the key cannot be stored, said once. */
export const HemeraAutoNoStorage: Story = {
  args: {
    current: 'hemera-auto',
    children: auto({ jevKey: 'unavailable', secretService: true, consent: undefined }),
  },
}

export const Notifications: Story = {
  args: {
    current: 'notifications',
    children: (
      <NotificationsSection
        events={[
          { id: 'needs', label: 'A need waits for you', on: true },
          { id: 'questions', label: 'A Planning question waits for you', on: true },
          { id: 'ready', label: 'A mission is ready for review', on: true },
          { id: 'failed', label: 'A run or a check failed', on: false },
          { id: 'outside', label: 'A repository changed outside Hemera', on: false },
        ]}
        sounds={[
          { id: 'needs', label: 'A need waits', on: true },
          { id: 'done', label: 'A mission is done', on: false },
        ]}
        onEvent={fn()}
        onSound={fn()}
      />
    ),
  },
}

export const Profile: Story = {
  args: {
    current: 'profile',
    children: (
      <ProfileSection
        dataFolder="~/.local/share/hemera"
        backups="12, the last at 08:12"
        agentLanguage="English"
        languages={LANGUAGES}
        onShowFolder={fn()}
        onBackUp={fn()}
        onRestore={fn()}
        onAgentLanguage={fn()}
      />
    ),
  },
}

export const Developer: Story = {
  args: {
    current: 'developer',
    children: (
      <DeveloperSection
        threads={false}
        tester
        findings={3}
        trace
        decisions={[
          { id: '1', call: 'pnpm --filter api test', verdict: 'ran', when: '08:56' },
          { id: '2', call: 'cat ~/.ssh/config', verdict: 'asked', when: '08:41' },
          { id: '3', call: 'git push origin acme/ACME-12', verdict: 'asked', when: '08:30' },
        ]}
        diagnosticFolder="~/.local/share/hemera"
        maxAgeDays={30}
        maxTotalMegabytes={500}
        onThreads={fn()}
        onTester={fn()}
        onFindings={fn()}
        onTrace={fn()}
        onShowDiagnostics={fn()}
      />
    ),
  },
}

/** A need about the models opened this section: the focus is on its heading. */
export const OpenedByALink: Story = {
  args: { ...Models.args, focus: true },
  play: async ({ canvasElement }) => {
    const heading = within(canvasElement).getByRole('heading', { name: 'Models by role' })
    await expect(heading).toHaveFocus()
  },
}
