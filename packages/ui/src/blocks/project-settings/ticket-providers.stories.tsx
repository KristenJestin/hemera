import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconPlug } from '../../icons.ts'
import {
  ProjectSettings,
  type SettingsForm,
} from '../../surfaces/project-settings/project-settings.tsx'
import { SECTIONS } from '../../surfaces/project-settings/settings-fixtures.tsx'
import { FormFoot } from './parts.tsx'
import {
  GithubForm,
  type GithubDraft,
  JiraForm,
  type JiraDraft,
  type ProviderDeployment,
  ProviderDetails,
  type ProviderKind,
  ProviderMark,
  type ProviderView,
  TicketProviders,
  TokenField,
  providerProblem,
  providerTitle,
} from './ticket-providers.tsx'

const READY = { state: 'ready', sentence: 'Ready.', fix: null } as const

const GITHUB: ProviderView = {
  id: 'github',
  kind: 'github',
  host: 'github.com',
  scope: 'acme/api, acme/web',
  status: READY,
  unreachableSince: null,
}

const JIRA: ProviderView = {
  id: 'jira',
  kind: 'jira',
  host: 'acme.atlassian.net',
  scope: 'SHOP',
  status: READY,
  unreachableSince: null,
  token: 'saved',
}

/** What the dialog of a Jira provider also says: not part of its line. */
const JIRA_DETAILS = new Map([
  ['jira', { deployment: 'cloud' as const, email: 'dev@acme.example' }],
  ['datacenter', { deployment: 'datacenter' as const, email: null }],
])

const BOTH = [GITHUB, JIRA]

const GITHUB_MISSING_CLI: ProviderView = {
  ...GITHUB,
  status: {
    state: 'missing_cli',
    sentence: 'Hemera reads GitHub through the gh command, which is not installed on this machine.',
    fix: 'winget install --id GitHub.cli',
  },
}

const GITHUB_LOGGED_OUT: ProviderView = {
  ...GITHUB,
  status: {
    state: 'not_authenticated',
    sentence: 'gh is installed but not signed in to github.com.',
    fix: 'gh auth login --hostname github.com',
  },
}

const JIRA_TOKEN_MISSING: ProviderView = {
  ...JIRA,
  token: 'missing',
  status: { state: 'configured', sentence: 'No API token is saved for this site.', fix: null },
}

const JIRA_TOKEN_REFUSED: ProviderView = {
  ...JIRA,
  token: 'invalid',
  status: {
    state: 'not_authenticated',
    sentence: 'Jira refused the saved token: it was revoked or has expired.',
    fix: null,
  },
}

const JIRA_STORAGE_UNAVAILABLE: ProviderView = {
  ...JIRA,
  token: 'storage-unavailable',
  status: {
    state: 'configured',
    sentence:
      'This system offers no protected storage, so Hemera cannot keep a token. Unlock the system keyring and check again.',
    fix: null,
  },
}

const JIRA_DATA_CENTER: ProviderView = {
  ...JIRA,
  id: 'datacenter',
  host: 'jira.acme.example',
  scope: 'SHOP, OPS',
}

const JIRA_UNREACHABLE: ProviderView = {
  ...JIRA,
  unreachableSince: 'since 08:12',
  status: {
    state: 'unreachable',
    sentence: 'acme.atlassian.net does not answer: the connection timed out after 30 seconds.',
    fix: null,
  },
}

const DENSE: readonly ProviderView[] = [
  {
    ...GITHUB,
    scope:
      'acme/api, acme/web, acme/shared, acme/ui-kit, acme/billing, acme/infrastructure-and-deployment-scripts-for-every-environment',
  },
  {
    ...JIRA,
    host: 'acme-international-retail-operations.atlassian.net',
    scope: 'SHOP, OPS, PAY, SEARCH, MOBILE, DATA',
  },
  { ...GITHUB, id: 'ghe', host: 'github.acme-enterprise.example', scope: 'platform/api' },
]

type Open =
  | { kind: 'provider'; id: string }
  | { kind: 'github' }
  | { kind: 'jira'; deployment: ProviderDeployment }

interface PageProps {
  providers: readonly ProviderView[] | null
  error?: string | undefined
  form?: Open | undefined
  /** The refusal of the last removal, in words. */
  removalRefused?: string | undefined
  /** What each provider's status becomes once Check again has answered. */
  afterCheck?: ProviderView['status']
  onAddGithub: () => void
  onAddJira: () => void
  onCheckAgain: (providerId: string) => void
  onRemoveProvider: (providerId: string) => void
  onSaveToken: (providerId: string, token: string) => void
  onRemoveToken: (providerId: string) => void
  onCopy: (line: string) => void
}

const PROPOSED = ['acme/api', 'acme/web', 'acme/shared']

/** A page of Acme's settings around the providers section, holding what the renderer holds. */
function Page(props: PageProps): ReactNode {
  const [providers, setProviders] = useState(props.providers)
  const [form, setForm] = useState<Open | null>(props.form ?? null)
  const [checking, setChecking] = useState(false)
  const [github, setGithub] = useState<GithubDraft>({
    host: 'github.com',
    repositories: ['acme/api', 'acme/web'],
  })
  const [jira, setJira] = useState<JiraDraft>({
    site: 'https://acme.atlassian.net',
    deployment: props.form?.kind === 'jira' ? props.form.deployment : 'cloud',
    email: 'dev@acme.example',
    projectKeys: 'SHOP',
  })
  const [saving, setSaving] = useState(false)
  const [filled, setFilled] = useState(false)
  const close = (): void => setForm(null)
  const checkAgain = (id: string): void => {
    props.onCheckAgain(id)
    setChecking(true)
    setTimeout(() => {
      setChecking(false)
      const next = props.afterCheck
      if (next !== undefined) {
        setProviders(
          (before) =>
            before?.map((one) =>
              one.id === id ? { ...one, status: next, unreachableSince: null } : one,
            ) ?? null,
        )
      }
    }, 300)
  }
  const dialog = ((): SettingsForm | null => {
    if (form === null) return null
    if (form.kind === 'github') {
      return {
        title: 'Add GitHub',
        icon: <ProviderMark kind="github" />,
        body: <GithubForm draft={github} onChange={setGithub} proposed={PROPOSED} />,
        footer: <FormFoot save="Add" onSave={props.onAddGithub} onCancel={close} />,
      }
    }
    if (form.kind === 'jira') {
      return {
        title: 'Add Jira',
        icon: <ProviderMark kind="jira" />,
        body: (
          <JiraForm
            draft={jira}
            onChange={setJira}
            token={
              <TokenField
                status="missing"
                deployment={jira.deployment}
                saving={false}
                onSave={(token) => props.onSaveToken('new', token)}
                onFilled={setFilled}
                onRemove={() => {}}
              />
            }
          />
        ),
        footer: (
          <FormFoot save="Add" saveDisabled={filled} onSave={props.onAddJira} onCancel={close} />
        ),
      }
    }
    const provider = providers?.find((one) => one.id === form.id)
    if (provider === undefined) return null
    const details = JIRA_DETAILS.get(provider.id)
    return {
      title: providerTitle(provider),
      icon: <ProviderMark kind={provider.kind} />,
      body: (
        <ProviderDetails
          provider={provider}
          jira={details}
          checking={checking}
          onCheckAgain={() => checkAgain(provider.id)}
          onCopy={props.onCopy}
          token={
            provider.token === undefined ? undefined : (
              <TokenField
                status={provider.token}
                deployment={details?.deployment ?? 'cloud'}
                saving={saving}
                onSave={(token) => {
                  setSaving(true)
                  props.onSaveToken(provider.id, token)
                  setTimeout(() => setSaving(false), 0)
                }}
                onRemove={() => props.onRemoveToken(provider.id)}
              />
            )
          }
        />
      ),
      footer: (
        <FormFoot
          refused={props.removalRefused}
          remove="Remove this provider"
          onRemove={() => props.onRemoveProvider(provider.id)}
          save="Done"
          onSave={close}
          onCancel={close}
        />
      ),
    }
  })()
  const problem = providerProblem(providers ?? [])
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ProjectSettings
        name="Acme"
        mainCheckout="~/work/acme"
        sections={[
          ...SECTIONS,
          { id: 'tickets', label: 'Tickets and Specs', icon: <IconPlug size="sm" />, problem },
        ]}
        current="tickets"
        onSection={() => {}}
        onRetry={() => {}}
        form={dialog}
        onCloseForm={close}
      >
        <TicketProviders
          providers={providers}
          error={props.error}
          onOpen={(id) => setForm({ kind: 'provider', id })}
          onAdd={(kind: ProviderKind) =>
            setForm(kind === 'github' ? { kind: 'github' } : { kind: 'jira', deployment: 'cloud' })
          }
        />
      </ProjectSettings>
    </main>
  )
}

/**
 * The providers half of "Tickets and Specs", in the settings of Acme: a line per provider (its
 * mark, its host, what it covers, its state as one glyph) that opens its dialog, and Add as a menu.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Ticket providers',
  component: Page,
  parameters: { layout: 'fullscreen' },
  args: {
    providers: BOTH,
    onAddGithub: fn(),
    onAddJira: fn(),
    onCheckAgain: fn(),
    onRemoveProvider: fn(),
    onSaveToken: fn(),
    onRemoveToken: fn(),
    onCopy: fn(),
  },
  argTypes: { providers: { table: { disable: true } } },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** No provider yet: missions start from what is written. */
export const NoProvider: Story = {
  args: { providers: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'No ticket provider' })).toBeVisible()
  },
}

/** The list is on its way: the rows' own shape. */
export const Loading: Story = {
  args: { providers: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('list', { busy: true })).toBeInTheDocument()
  },
}

/** The list could not be read: said in words. */
export const ReadRefused: Story = {
  args: { providers: [], error: 'The ticket providers could not be read: the engine is starting.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'the engine is starting',
    )
  },
}

/** GitHub and Jira, both ready. */
export const BothProviders: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Ticket providers' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    await expect(list).toHaveTextContent('acme/api, acme/web')
    await expect(list).toHaveTextContent('SHOP')
    await userEvent.click(within(list).getByRole('button', { name: /github\.com/ }))
    await expect(await body().findByRole('dialog', { name: 'GitHub · github.com' })).toBeVisible()
    await expect(args.onCheckAgain).not.toHaveBeenCalled()
  },
}

/** Adding a provider: the menu offers GitHub and Jira, by the keyboard. */
export const AddAProvider: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const add = canvas.getByRole('button', { name: 'Add a provider' })
    add.focus()
    await userEvent.keyboard('{Enter}')
    const github = await body().findByRole('menuitem', { name: 'GitHub' })
    await waitFor(() => expect(github).toBeVisible())
    await expect(body().getByRole('menuitem', { name: 'Jira' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
  },
}

/** Adding GitHub: the host, and the repositories proposed from the Project's remotes. */
export const AddGitHub: Story = {
  args: { form: { kind: 'github' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Add GitHub' })
    await expect(within(dialog).getByRole('checkbox', { name: /acme\/api/ })).toBeChecked()
    await expect(within(dialog).getByRole('checkbox', { name: /acme\/shared/ })).not.toBeChecked()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /acme\/shared/ }))
    await expect(within(dialog).getByRole('checkbox', { name: /acme\/shared/ })).toBeChecked()
    const another = within(dialog).getByRole('textbox', { name: 'Another repository' })
    await userEvent.type(another, 'acme/tools{Enter}')
    await expect(within(dialog).getByRole('checkbox', { name: /acme\/tools/ })).toBeChecked()
    await expect(another).toHaveValue('')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await expect(args.onAddGithub).toHaveBeenCalled()
  },
}

/** Adding Jira Cloud: site, account email, project keys and the API token. */
export const AddJiraCloud: Story = {
  args: { form: { kind: 'jira', deployment: 'cloud' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add Jira' })
    await expect(within(dialog).getByLabelText('Account email')).toBeVisible()
    await expect(within(dialog).getByLabelText('API token')).toHaveAttribute('type', 'password')
    // A token typed has one way out, the field's own Save: the foot's Add waits for it.
    const add = within(dialog).getByRole('button', { name: 'Add' })
    await expect(add).toBeEnabled()
    await userEvent.type(within(dialog).getByLabelText('API token'), 'pasted-secret')
    await expect(add).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await expect(within(dialog).getByLabelText('API token')).toHaveValue('')
    await expect(add).toBeEnabled()
    await expect(within(dialog).getByRole('tab', { name: 'Cloud' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

/** Adding Jira Data Center: no email, a personal access token. */
export const AddJiraDataCenter: Story = {
  args: { form: { kind: 'jira', deployment: 'datacenter' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add Jira' })
    await expect(within(dialog).queryByLabelText('Account email')).toBeNull()
    await expect(within(dialog).getByLabelText('Personal access token')).toBeVisible()
  },
}

/** gh is not installed: the sentence, the command that fixes it, Copy and Check again. */
export const GitHubMissingCli: Story = {
  args: { providers: [GITHUB_MISSING_CLI], form: { kind: 'provider', id: 'github' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'GitHub · github.com' })
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Copy winget install --id GitHub.cli' }),
    )
    await expect(args.onCopy).toHaveBeenCalledWith('winget install --id GitHub.cli')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check again' }))
    await expect(args.onCheckAgain).toHaveBeenCalledWith('github')
  },
}

/** gh is not signed in. */
export const GitHubLoggedOut: Story = {
  args: { providers: [GITHUB_LOGGED_OUT], form: { kind: 'provider', id: 'github' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'GitHub · github.com' })
    await expect(dialog).toHaveTextContent('gh auth login --hostname github.com')
  },
}

/** Jira with its token saved: where it stands, Replace and Remove, never the token. */
export const JiraTokenSaved: Story = {
  args: { providers: [JIRA], form: { kind: 'provider', id: 'jira' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · acme.atlassian.net' })
    await expect(dialog).toHaveTextContent('Token saved in the system keyring')
    await expect(within(dialog).queryByLabelText('API token')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await expect(args.onRemoveToken).toHaveBeenCalledWith('jira')
  },
}

/** Jira with no token: the field takes one, then holds nothing once it was given. */
export const JiraTokenMissing: Story = {
  args: { providers: [JIRA_TOKEN_MISSING], form: { kind: 'provider', id: 'jira' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · acme.atlassian.net' })
    const field = within(dialog).getByLabelText('API token')
    await expect(field).toHaveValue('')
    await userEvent.type(field, 'pasted-secret')
    await expect(field).toHaveValue('pasted-secret')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await expect(args.onSaveToken).toHaveBeenCalledWith('jira', 'pasted-secret')
    await expect(field).toHaveValue('')
    await expect(dialog).not.toHaveTextContent('pasted-secret')
    await expect(body().queryByDisplayValue('pasted-secret')).toBeNull()
  },
}

/** Jira refused the saved token: said, and Replace. */
export const JiraTokenRefused: Story = {
  args: { providers: [JIRA_TOKEN_REFUSED], form: { kind: 'provider', id: 'jira' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · acme.atlassian.net' })
    await expect(dialog).toHaveTextContent('Jira refused the saved token')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace' }))
    await expect(within(dialog).getByLabelText('API token')).toBeVisible()
  },
}

/** No protected storage on this system: no field, the reason, Check again. */
export const JiraStorageUnavailable: Story = {
  args: { providers: [JIRA_STORAGE_UNAVAILABLE], form: { kind: 'provider', id: 'jira' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · acme.atlassian.net' })
    await expect(within(dialog).queryByLabelText('API token')).toBeNull()
    await expect(within(dialog).getByRole('button', { name: 'Check again' })).toBeVisible()
  },
}

/** A Jira Data Center provider. */
export const JiraDataCenter: Story = {
  args: { providers: [JIRA_DATA_CENTER], form: { kind: 'provider', id: 'datacenter' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · jira.acme.example' })
    await expect(dialog).toHaveTextContent('Data Center')
    await expect(dialog).toHaveTextContent('Personal access token')
  },
}

/** Jira unreachable since 08:12: on its line, and the section's glyph in the list. */
export const ProviderUnreachable: Story = {
  args: { providers: [GITHUB, JIRA_UNREACHABLE] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('unreachable since 08:12')).toBeVisible()
    await expect(
      canvas.getByRole('button', {
        name: 'Tickets and Specs, Jira · acme.atlassian.net needs you',
      }),
    ).toBeInTheDocument()
  },
}

/** Check again, and the provider's state changes on its line: unreachable, then ready. */
export const StatusChangesAfterCheckAgain: Story = {
  args: {
    providers: [GITHUB, JIRA_UNREACHABLE],
    form: { kind: 'provider', id: 'jira' },
    afterCheck: READY,
  },
  play: async ({ canvasElement }) => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · acme.atlassian.net' })
    await expect(dialog).toHaveTextContent('does not answer')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(dialog).toHaveTextContent('Ready.'))
    await expect(within(canvasElement).queryByText(/unreachable since/)).toBeNull()
  },
}

/** Removing a provider a live mission reads from: refused, the missions named. */
export const RemovalRefused: Story = {
  args: {
    providers: BOTH,
    form: { kind: 'provider', id: 'github' },
    removalRefused:
      'This provider reads the ticket of ACME-12, ACME-14: it cannot be removed while those missions are live.',
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'GitHub · github.com' })
    await expect(within(dialog).getByRole('alert')).toHaveTextContent('ACME-12, ACME-14')
  },
}

/** Long values everywhere: six repositories, a long site, three providers. */
export const Dense: Story = {
  args: { providers: DENSE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Ticket providers' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  },
}
