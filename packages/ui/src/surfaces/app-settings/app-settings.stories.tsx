import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useEffect, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  AgentsSection,
  AppearanceSection,
  DeveloperSection,
  HemeraAutoSection,
  JevKeyForm,
  ModelsSection,
  NotificationsSection,
  ProfileSection,
} from '../../blocks/app-settings/app-sections.tsx'
import { FormFoot } from '../../blocks/project-settings/parts.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { IconShieldLock } from '../../icons.ts'
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

/** What has no engine yet is not drawn: the theme alone, without density or language. */
export const AppearanceThemeOnly: Story = {
  args: {
    children: (
      <AppearanceSection
        theme="system"
        density="comfortable"
        language="English"
        languages={LANGUAGES}
        onTheme={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Theme' })).toBeVisible()
    await expect(canvas.queryByRole('combobox', { name: 'Density' })).toBeNull()
    await expect(canvas.queryByRole('combobox', { name: 'Interface language' })).toBeNull()
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

const STYLES = [
  { id: 'hemera', label: 'Hemera' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'soft', label: 'Soft' },
  { id: 'glass', label: 'Glass' },
  { id: 'arcade', label: 'Arcade' },
  { id: 'mechanical', label: 'Mechanical' },
  { id: 'organic', label: 'Organic' },
  { id: 'dreamy', label: 'Dreamy' },
  { id: 'scifi', label: 'Sci-fi' },
  { id: 'rubber', label: 'Rubber' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'studio', label: 'Studio' },
  { id: 'zen', label: 'Zen' },
]

const notifications = (props: Partial<Parameters<typeof NotificationsSection>[0]>) => (
  <NotificationsSection
    events={[
      { id: 'needs', label: 'A need waits for you', on: true },
      { id: 'questions', label: 'A Planning question waits for you', on: true },
      { id: 'ready', label: 'A mission is ready for review', on: true },
      { id: 'failed', label: 'A run or a check failed', on: false },
      { id: 'outside', label: 'A repository changed outside Hemera', on: false },
    ]}
    sounds={[
      { id: 'needs-you', label: 'Something needs you', on: true },
      { id: 'error', label: 'Something failed', on: true },
      { id: 'done', label: 'Something is done', on: false },
    ]}
    style="hemera"
    styles={STYLES}
    onEvent={fn()}
    onSound={fn()}
    onStyle={fn()}
    onPreview={fn()}
    {...props}
  />
)

/** Hemera's own sound style; each sound can be heard in it, once, from its play button. */
export const Notifications: Story = {
  args: { current: 'notifications', children: notifications({}) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Sound style' })).toHaveTextContent('Hemera')
    await expect(canvas.getByRole('button', { name: 'Play Something needs you' })).toBeEnabled()
    await expect(canvas.getByRole('button', { name: 'Play Something failed' })).toBeEnabled()
    await expect(canvas.getByRole('button', { name: 'Play Something is done' })).toBeEnabled()
  },
}

const onStyle = fn()
const onPreview = fn()

/** Another style chosen: the select says which, and a sound previews in it. */
export const SoundStyleChosen: Story = {
  args: {
    current: 'notifications',
    children: notifications({ style: 'glass', onStyle, onPreview }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const select = canvas.getByRole('combobox', { name: 'Sound style' })
    await expect(select).toHaveTextContent('Glass')
    await userEvent.click(canvas.getByRole('button', { name: 'Play Something failed' }))
    await expect(onPreview).toHaveBeenCalledWith('error')
    await userEvent.click(select)
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Zen' }))
    await expect(onStyle).toHaveBeenCalledWith('zen')
    // The choice closes the list: the accessibility check that follows the play would otherwise
    // read it half way through its exit, a scrolling box with nothing left to focus.
    await waitFor(() => expect(within(document.body).queryByRole('listbox')).toBeNull())
  },
}

/** A sound previewing: its button shows it plays and cannot be pressed again until it ends. */
export const SoundPreviewPlaying: Story = {
  args: {
    current: 'notifications',
    children: notifications({ style: 'zen', previewing: 'needs-you' }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Play Something needs you' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(canvas.getByRole('button', { name: 'Play Something is done' })).toBeEnabled()
  },
}

/** Long names: the labels wrap, the play buttons stay at the end of their rows. */
export const SoundLongNames: Story = {
  args: {
    current: 'notifications',
    children: notifications({
      style: 'long',
      styles: [
        ...STYLES,
        { id: 'long', label: 'Cinematic, with deep impacts, polished tails and quiet scale' },
      ],
      sounds: [
        {
          id: 'needs-you',
          label: 'Something needs you: a decision, a permission or a missing tool in a mission',
          on: true,
        },
        {
          id: 'error',
          label: 'Something failed: a run, a check or the preparation of a Workspace',
          on: true,
        },
        {
          id: 'done',
          label: 'Something is done: a mission, a review or the preparation of a Workspace',
          on: true,
        },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const play = canvas.getByRole('button', { name: /^Play Something failed/ })
    await expect(play).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: 'Sound style' })).toHaveTextContent(
      /^Cinematic, with deep impacts/,
    )
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

/** What has no engine yet is not drawn: no threads, no trace, no findings to open. */
export const DeveloperServedOnly: Story = {
  args: {
    current: 'developer',
    children: (
      <DeveloperSection
        threads={false}
        tester
        findings={3}
        trace={false}
        decisions={[]}
        diagnosticFolder="~/.local/share/hemera"
        maxAgeDays={30}
        maxTotalMegabytes={500}
        onTester={fn()}
        onShowDiagnostics={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('checkbox', { name: 'Tester mode' })).toBeVisible()
    await expect(canvas.queryByRole('checkbox', { name: 'Show the sessions’ threads' })).toBeNull()
    await expect(canvas.queryByRole('checkbox', { name: 'ACP trace' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: '3 findings' })).toBeNull()
  },
}

/** No key can be typed yet, and no folder opened: their buttons are not drawn. */
export const ProfileAndKeyServedOnly: Story = {
  args: {
    current: 'profile',
    children: (
      <>
        <HemeraAutoSection jevKey="missing" onConsent={fn()} />
        <ProfileSection
          dataFolder="~/.local/share/hemera"
          backups="12, the last at 08:12"
          agentLanguage="English"
          languages={LANGUAGES}
          onBackUp={fn()}
          onRestore={fn()}
          onAgentLanguage={fn()}
        />
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Jev key')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Add a key' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Show' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Back up now' })).toBeVisible()
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

/** What the engine refused is said in words next to the row it was asked from. */
const alerts = (canvasElement: HTMLElement) =>
  within(canvasElement)
    .getAllByRole('alert')
    .map((alert) => alert.textContent)

/** An update refused, said on its agent's row; a check for updates refused, under the head. */
export const AgentsRefused: Story = {
  args: {
    current: 'agents',
    children: (
      <AgentsSection
        agents={[
          {
            name: 'Codex',
            state: {
              installed: true,
              version: '0.154.0',
              installer: 'npm',
              signedIn: true,
              signIn: 'codex login',
              update: '0.155.1',
            },
          },
        ]}
        error="The registries could not be asked: Hemera could not reach the network."
        errors={{ Codex: 'Codex could not be updated: npm exited with code 1.' }}
        onCheck={fn()}
        onUpdate={fn()}
        onCopy={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(alerts(canvasElement)).toEqual([
      'The registries could not be asked: Hemera could not reach the network.',
      'Codex could not be updated: npm exited with code 1.',
    ])
  },
}

/** A role's model refused, on its row; a model's star refused, under the head. */
export const ModelsRefused: Story = {
  args: {
    current: 'models',
    children: (
      <ModelsSection
        roles={[
          { role: 'Planner', model: { agent: 'claude', model: 'opus', effort: 'high' } },
          { role: 'Builder', model: { agent: 'claude', model: 'sonnet', effort: 'medium' } },
        ]}
        agents={AGENTS}
        error="The model could not be marked: Hemera could not write to its profile."
        errors={{
          Builder: 'The model could not be changed: Hemera could not write to its profile.',
        }}
        onChange={fn()}
        onFavourite={fn()}
        onHide={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(alerts(canvasElement)).toEqual([
      'The model could not be marked: Hemera could not write to its profile.',
      'The model could not be changed: Hemera could not write to its profile.',
    ])
  },
}

/** The consent refused, on its row. */
export const HemeraAutoRefused: Story = {
  args: {
    current: 'hemera-auto',
    children: auto({
      consent: undefined,
      errors: { consent: 'The consent could not be kept: Hemera could not write to its profile.' },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(alerts(canvasElement)).toEqual([
      'The consent could not be kept: Hemera could not write to its profile.',
    ])
  },
}

/** A switch, a sound and the sound style refused, each on its own row. */
export const NotificationsRefused: Story = {
  args: {
    current: 'notifications',
    children: notifications({
      errors: {
        failed: 'This notification could not be turned on: Hemera could not write to its profile.',
        'needs-you': 'This sound could not be played: no sound device answered.',
        style: 'This style could not be chosen: Hemera could not write to its profile.',
      },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(alerts(canvasElement)).toEqual([
      'This notification could not be turned on: Hemera could not write to its profile.',
      'This style could not be chosen: Hemera could not write to its profile.',
      'This sound could not be played: no sound device answered.',
    ])
  },
}

/** A backup and the agents' language refused, each on its row. */
export const ProfileRefused: Story = {
  args: {
    current: 'profile',
    children: (
      <ProfileSection
        dataFolder="~/.local/share/hemera"
        backups="12, the last at 08:12"
        agentLanguage="English"
        languages={LANGUAGES}
        errors={{
          backups: 'No backup was made: the folder chosen cannot be written to.',
          language: 'The language could not be kept: Hemera could not write to its profile.',
        }}
        onBackUp={fn()}
        onRestore={fn()}
        onAgentLanguage={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(alerts(canvasElement)).toEqual([
      'No backup was made: the folder chosen cannot be written to.',
      'The language could not be kept: Hemera could not write to its profile.',
    ])
  },
}

/** The tester mode refused, on its row. */
export const DeveloperRefused: Story = {
  args: {
    current: 'developer',
    children: (
      <DeveloperSection
        threads={false}
        tester={false}
        findings={0}
        trace={false}
        decisions={[]}
        diagnosticFolder="~/.local/share/hemera"
        maxAgeDays={30}
        maxTotalMegabytes={500}
        errors={{
          tester: 'The tester mode could not be turned on: Hemera could not write to its profile.',
        }}
        onTester={fn()}
        onShowDiagnostics={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(alerts(canvasElement)).toEqual([
      'The tester mode could not be turned on: Hemera could not write to its profile.',
    ])
  },
}

/** A section Hemera could not read: said in words, with Try again, where the section would be. */
export const SectionUnread: Story = {
  args: {
    current: 'notifications',
    children: (
      <ErrorState
        title="Notifications & sounds could not be read"
        description="Hemera could not read its profile."
        onRetry={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('could not be read')
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

/** A section that is drawn once its read is answered, after the page: as the window draws it. */
function AnsweredLater(): ReactNode {
  const [answered, setAnswered] = useState(false)
  useEffect(() => {
    void Promise.resolve().then(() => setAnswered(true))
  }, [])
  return answered ? Models.args?.children : null
}

/** A link opened a section still being read: its heading takes the focus once it is drawn. */
export const OpenedByALinkReadLater: Story = {
  args: { current: 'models', focus: true, children: <AnsweredLater /> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByRole('heading', { name: 'Models by role' })).toHaveFocus(),
    )
  },
}

/** Hemera Auto while its state is read: the rows' shape, never "No key" before it is known. */
export const HemeraAutoLoading: Story = {
  args: { current: 'hemera-auto', children: auto({ loading: true, consent: undefined }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Hemera Auto' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    await expect(canvas.queryByRole('img', { name: 'No key' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Replace' })).toBeNull()
  },
}

/** Who judges now, as the engine says it: the key stored and consent given, Hemera Auto (Jev). */
export const HemeraAutoJudgedByJev: Story = {
  args: { current: 'hemera-auto', children: auto({ judge: 'Hemera Auto (Jev)' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Hemera Auto (Jev)')).toBeVisible()
  },
}

/** No key: Hemera asks you. */
export const HemeraAutoAsks: Story = {
  args: {
    current: 'hemera-auto',
    children: auto({ jevKey: 'missing', consent: undefined, judge: 'Hemera asks' }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Hemera asks')).toBeVisible()
  },
}

const saveKey = fn()
const removeKey = fn()

/** The key's dialog as the page opens it: the field, then the foot. */
function KeyDialog({
  stored,
  refused,
  saving,
}: {
  stored: boolean
  refused?: string | undefined
  saving?: boolean | undefined
}): ReactNode {
  const [key, setKey] = useState('')
  return (
    <AppSettings
      current="hemera-auto"
      onSection={fn()}
      form={{
        title: stored ? 'Replace the Jev key' : 'Add a Jev key',
        icon: <IconShieldLock size="sm" />,
        body: <JevKeyForm value={key} onChange={setKey} onSave={() => saveKey(key)} />,
        footer: (
          <FormFoot
            refused={refused}
            remove={stored ? 'Remove the key' : undefined}
            onRemove={removeKey}
            saving={saving}
            onSave={() => saveKey(key)}
            onCancel={fn()}
          />
        ),
      }}
      onCloseForm={fn()}
    >
      {auto({ jevKey: stored ? 'saved' : 'missing', consent: undefined })}
    </AppSettings>
  )
}

/** A key typed in its dialog: masked as it is typed, and sent as typed, never shown back. */
export const JevKeyAdding: Story = {
  render: () => <KeyDialog stored={false} />,
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'))
    const field = dialog.getByLabelText('Jev key')
    await expect(field).toHaveAttribute('type', 'password')
    saveKey.mockClear()
    await userEvent.type(field, 'jev_live_0123456789{Enter}')
    await expect(saveKey).toHaveBeenCalledWith('jev_live_0123456789')
    await expect(document.body).not.toHaveTextContent('jev_live_0123456789')
    await expect(dialog.queryByRole('button', { name: 'Remove the key' })).toBeNull()
  },
}

/** A key stored: the dialog replaces it, or removes it. */
export const JevKeyReplacing: Story = {
  render: () => <KeyDialog stored />,
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'))
    removeKey.mockClear()
    await userEvent.click(dialog.getByRole('button', { name: 'Remove the key' }))
    await expect(removeKey).toHaveBeenCalledOnce()
  },
}

/** A key the system could not store: said above the buttons, the dialog stays open. */
export const JevKeyRefused: Story = {
  render: () => (
    <KeyDialog
      stored={false}
      refused="The key could not be stored: no Secret Service is running."
    />
  ),
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'))
    await expect(dialog.getByRole('alert')).toHaveTextContent('could not be stored')
  },
}

/** A role the application leaves on Hemera's default: no model is shown, the picker offers one. */
export const ModelsOnTheDefault: Story = {
  args: {
    current: 'models',
    children: (
      <ModelsSection
        roles={[
          { role: 'Planner', model: { agent: 'claude', model: 'opus', effort: 'high' } },
          { role: 'Builder', model: null },
        ]}
        agents={AGENTS}
        onChange={fn()}
        onFavourite={fn()}
        onHide={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Model of Builder: Choose a model' }),
    ).toBeVisible()
  },
}
