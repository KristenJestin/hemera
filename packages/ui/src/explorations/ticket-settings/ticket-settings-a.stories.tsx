import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { TicketSettingsA } from './proposal-a.tsx'
import {
  DENSE,
  FILLED,
  GITHUB_LOGGED_OUT,
  GITHUB_MISSING_CLI,
  IN_USE,
  JIRA_DATA_CENTER,
  JIRA_ONLY,
  JIRA_STORAGE_UNAVAILABLE,
  JIRA_TOKEN_MISSING,
  JIRA_TOKEN_REFUSED,
  NOTHING,
  PREFIX_REFUSED,
  UNREACHABLE,
} from './ticket-settings-fixtures.ts'

/**
 * The ticket and Spec settings, rows and dialogs: two sections, Tickets and Specs and
 * Exclusive resources; a provider or a resource is one line that opens its dialog.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Ticket and Spec settings/Rows and dialogs',
  component: TicketSettingsA,
  parameters: { layout: 'fullscreen' },
  args: {
    data: FILLED,
    onAddGithub: fn(),
    onAddJira: fn(),
    onCheckAgain: fn(),
    onRemoveProvider: fn(),
    onSaveToken: fn(),
    onRemoveToken: fn(),
    onCopy: fn(),
    onSpecMode: fn(),
    onSyncInterval: fn(),
    onLanguage: fn(),
    onPrefix: fn(),
    onSaveResource: fn(),
  },
} satisfies Meta<typeof TicketSettingsA>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** No provider yet: missions start from what is written; local Specs. */
export const NoProvider: Story = {
  args: { data: NOTHING },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'No ticket provider' })).toBeVisible()
    await expect(canvas.queryByLabelText('Check linked tickets')).toBeNull()
  },
}

/** GitHub and Jira, both ready; linked Specs checked every hour. */
export const BothProviders: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Ticket providers' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    await expect(canvas.getByText('Last checked at 09:00')).toBeVisible()
    await expect(canvas.getByText(/follows its ticket/)).toBeVisible()
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
    await userEvent.keyboard('{Escape}')
  },
}

/** Adding GitHub: the host, and the repositories proposed from the Project's remotes. */
export const AddGitHub: Story = {
  args: { form: { kind: 'github' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Add GitHub' })
    await expect(within(dialog).getByRole('checkbox', { name: /acme\/api/ })).toBeChecked()
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
  args: { data: GITHUB_MISSING_CLI, form: { kind: 'provider', id: 'github' } },
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
  args: { data: GITHUB_LOGGED_OUT, form: { kind: 'provider', id: 'github' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'GitHub · github.com' })
    await expect(dialog).toHaveTextContent('gh auth login --hostname github.com')
  },
}

/** Jira with its token saved: where it stands, Replace and Remove, never the token. */
export const JiraTokenSaved: Story = {
  args: { data: JIRA_ONLY, form: { kind: 'provider', id: 'jira' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · acme.atlassian.net' })
    await expect(dialog).toHaveTextContent('Token saved in the system keyring')
    await expect(within(dialog).queryByLabelText('API token')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await expect(args.onRemoveToken).toHaveBeenCalledWith('jira')
  },
}

/** Jira with no token: the field takes one. */
export const JiraTokenMissing: Story = {
  args: { data: JIRA_TOKEN_MISSING, form: { kind: 'provider', id: 'jira' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · acme.atlassian.net' })
    await expect(within(dialog).getByLabelText('API token')).toHaveValue('')
  },
}

/** Jira refused the saved token: said, and Replace. */
export const JiraTokenRefused: Story = {
  args: { data: JIRA_TOKEN_REFUSED, form: { kind: 'provider', id: 'jira' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · acme.atlassian.net' })
    await expect(dialog).toHaveTextContent('Jira refused the saved token')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace' }))
    await expect(within(dialog).getByLabelText('API token')).toBeVisible()
  },
}

/** No protected storage on this system: no field, the reason, Check again. */
export const JiraStorageUnavailable: Story = {
  args: { data: JIRA_STORAGE_UNAVAILABLE, form: { kind: 'provider', id: 'jira' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · acme.atlassian.net' })
    await expect(within(dialog).queryByLabelText('API token')).toBeNull()
    await expect(within(dialog).getByRole('button', { name: 'Check again' })).toBeVisible()
  },
}

/** A Jira Data Center provider. */
export const JiraDataCenter: Story = {
  args: { data: JIRA_DATA_CENTER, form: { kind: 'provider', id: 'jira' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Jira · jira.acme.example' })
    await expect(dialog).toHaveTextContent('Data Center')
    await expect(dialog).toHaveTextContent('Personal access token')
  },
}

/** Jira unreachable since 08:12: on its line, and the section's glyph in the list. */
export const ProviderUnreachable: Story = {
  args: { data: UNREACHABLE },
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

/** Removing a provider a live mission reads from: refused, the missions named. */
export const RemovalRefused: Story = {
  args: {
    data: IN_USE,
    form: { kind: 'provider', id: 'github' },
    removalRefused:
      'This provider reads the ticket of ACME-12, ACME-14: it cannot be removed while those missions are live.',
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'GitHub · github.com' })
    await expect(within(dialog).getByRole('alert')).toHaveTextContent('ACME-12, ACME-14')
  },
}

/** The prefix is still carried by another Project's missions: refused under the field. */
export const PrefixRefused: Story = {
  args: { data: PREFIX_REFUSED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/two missions never share a key/)).toBeVisible()
  },
}

/** The exclusive resources: one held by ACME-12 with ACME-14 waiting, one with no restore. */
export const Resources: Story = {
  args: { section: 'resources' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/held by ACME-12 since 09:41/)).toBeVisible()
    await expect(canvas.getByText(/no restore: a need opens at the start/)).toBeVisible()
  },
}

/** A resource's form: its commands picked from the catalogue, its optional restore. */
export const ResourceForm: Story = {
  args: { section: 'resources', form: { kind: 'resource', id: 'db' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Shared database' })
    await expect(
      within(dialog).getByRole('checkbox', { name: /Migrate the database/ }),
    ).toBeChecked()
    await expect(dialog).toHaveTextContent('Only these commands are protected')
  },
}

/** Long values everywhere: six repositories, a long site and email, a long resource. */
export const Dense: Story = {
  args: { data: DENSE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Ticket providers' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  },
}
