import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconDatabase } from '../../icons.ts'
import {
  ProjectSettings,
  type SettingsForm,
} from '../../surfaces/project-settings/project-settings.tsx'
import { SECTIONS } from '../../surfaces/project-settings/settings-fixtures.tsx'
import {
  ExclusiveResources,
  type ResourceDraftView,
  ResourceForm,
  type ResourceView,
} from './exclusive-resources.tsx'
import { FormFoot } from './parts.tsx'

const COMMANDS = [
  { id: 'migrate', name: 'Migrate the database' },
  { id: 'seed', name: 'Seed the database' },
  { id: 'reset', name: 'Reset the database' },
  { id: 'e2e', name: 'End-to-end tests' },
  { id: 'stripe', name: 'Replay payment webhooks' },
]

const DB: ResourceView = {
  id: 'db',
  name: 'Shared database',
  description: 'The Postgres of the staging machine, which api and web both use.',
  uses: ['Migrate the database', 'Seed the database', 'End-to-end tests'],
  restore: 'Reset the database',
  holder: { missionKey: 'ACME-12', since: '09:41' },
  queue: ['ACME-14'],
}

const SANDBOX: ResourceView = {
  id: 'stripe',
  name: 'Payment sandbox',
  description: 'The test account of the payment provider.',
  uses: ['Replay payment webhooks'],
  restore: null,
  holder: null,
  queue: [],
}

const BOTH = [DB, SANDBOX]

const LONG: ResourceView = {
  id: 'long',
  name: 'The shared Elasticsearch cluster of the staging environment used by the search team',
  description:
    'Its indices are rebuilt by the search import; two imports at once leave the index half written.',
  uses: [
    'Seed the database',
    'End-to-end tests',
    'Migrate the database',
    'Replay payment webhooks',
  ],
  restore: 'Reset the database',
  holder: null,
  queue: [],
}

const DENSE = [
  ...BOTH,
  LONG,
  {
    ...DB,
    id: 'cache',
    name: 'Cache',
    queue: ['ACME-14', 'ACME-15', 'ACME-16', 'ACME-17', 'ACME-18', 'ACME-19'],
  },
]

const DRAFTS = new Map<string, ResourceDraftView>([
  [
    'db',
    {
      name: 'Shared database',
      description: DB.description,
      uses: ['migrate', 'seed', 'e2e'],
      resetCommandId: 'reset',
    },
  ],
  [
    'stripe',
    {
      name: 'Payment sandbox',
      description: SANDBOX.description,
      uses: ['stripe'],
      resetCommandId: null,
    },
  ],
])

const EMPTY: ResourceDraftView = { name: '', description: '', uses: [], resetCommandId: null }

type Open = { kind: 'edit'; id: string } | { kind: 'new' }

interface PageProps {
  resources: readonly ResourceView[] | null
  error?: string | undefined
  form?: Open | undefined
  /** Why the last save was refused, in words. */
  refused?: string | undefined
  onSave: (draft: ResourceDraftView) => void
  onRemove: (id: string) => void
}

const body = () => within(document.body)

/** A page of Acme's settings around the resources section, holding what the renderer holds. */
function Page(props: PageProps): ReactNode {
  const [form, setForm] = useState<Open | null>(props.form ?? null)
  const [draft, setDraft] = useState<ResourceDraftView>(
    props.form?.kind === 'edit' ? (DRAFTS.get(props.form.id) ?? EMPTY) : EMPTY,
  )
  const close = (): void => setForm(null)
  const open = (next: Open): void => {
    setDraft(next.kind === 'edit' ? (DRAFTS.get(next.id) ?? EMPTY) : EMPTY)
    setForm(next)
  }
  const dialog = ((): SettingsForm | null => {
    if (form === null) return null
    const resource =
      form.kind === 'edit' ? props.resources?.find((one) => one.id === form.id) : undefined
    return {
      title: resource?.name ?? 'Add a resource',
      icon: <IconDatabase size="sm" />,
      body: (
        <ResourceForm
          draft={draft}
          commands={COMMANDS}
          refused={props.refused}
          onDraft={setDraft}
        />
      ),
      footer: (
        <FormFoot
          remove={resource === undefined ? undefined : `Remove ${resource.name}`}
          onRemove={() => resource !== undefined && props.onRemove(resource.id)}
          save={resource === undefined ? 'Add' : 'Save'}
          onSave={() => props.onSave(draft)}
          onCancel={close}
        />
      ),
    }
  })()
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ProjectSettings
        name="Acme"
        mainCheckout="~/work/acme"
        sections={[
          ...SECTIONS,
          { id: 'resources', label: 'Exclusive resources', icon: <IconDatabase size="sm" /> },
        ]}
        current="resources"
        onSection={() => {}}
        onRetry={() => {}}
        form={dialog}
        onCloseForm={close}
      >
        <ExclusiveResources
          resources={props.resources}
          error={props.error}
          onOpen={(id) => open({ kind: 'edit', id })}
          onAdd={() => open({ kind: 'new' })}
        />
      </ProjectSettings>
    </main>
  )
}

/**
 * The "Exclusive resources" section, in the settings of Acme: a line per resource (its commands,
 * its restore or the need that opens at the start, who holds it now and who waits) that opens its
 * dialog, and Add. Only the declared commands are protected; a change applies to the missions
 * launched after it.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Exclusive resources',
  component: Page,
  parameters: { layout: 'fullscreen' },
  args: { resources: BOTH, onSave: fn(), onRemove: fn() },
  argTypes: { resources: { table: { disable: true } } },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

/** One held by ACME-12 with ACME-14 waiting, one with no restore. */
export const Resources: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Exclusive resources' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    await expect(canvas.getByText(/held by ACME-12 since 09:41/)).toBeVisible()
    await expect(canvas.getByText(/ACME-14 waits/)).toBeVisible()
    await expect(canvas.getByText(/restored by Reset the database/)).toBeVisible()
    await expect(canvas.getByText(/no restore: a need opens at the start/)).toBeVisible()
    await expect(
      canvas.getByText(/Only the commands declared on a resource are protected/),
    ).toBeVisible()
    await expect(canvas.getByText(/launched after it/)).toBeVisible()
  },
}

/** No resource: what one is, and Add. */
export const NoResource: Story = {
  args: { resources: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('No exclusive resource')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Add a resource/ })).toBeVisible()
  },
}

/** The list on its way: the rows' own shape. */
export const Loading: Story = {
  args: { resources: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('list', { name: 'Exclusive resources' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  },
}

/** The resources could not be read: the refusal in words, under the head. */
export const ReadRefused: Story = {
  args: { resources: [], error: 'The exclusive resources could not be read: the engine is gone.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('the engine is gone')
  },
}

/** A held resource opens its dialog; Add opens an empty one. */
export const AddOpensTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Add a resource/ }))
    const dialog = await body().findByRole('dialog', { name: 'Add a resource' })
    await expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('')
  },
}

/** A resource's dialog: its commands picked from the catalogue, its optional restore. */
export const ResourceFormOpen: Story = {
  name: 'Resource form',
  args: { form: { kind: 'edit', id: 'db' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Shared database' })
    await expect(
      within(dialog).getByRole('checkbox', { name: /Migrate the database/ }),
    ).toBeChecked()
    await expect(
      within(dialog).getByRole('checkbox', { name: /Replay payment webhooks/ }),
    ).not.toBeChecked()
    await expect(dialog).toHaveTextContent('Only these commands are protected')
    await expect(dialog).toHaveTextContent('Reset the database')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await expect(args.onSave).toHaveBeenCalled()
  },
}

/** Picking commands: ticking and unticking change the draft handed back. */
export const PickingCommands: Story = {
  args: { form: { kind: 'new' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Add a resource' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Cache')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Seed the database/ }))
    await expect(within(dialog).getByRole('checkbox', { name: /Seed the database/ })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(args.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Cache', uses: ['seed'], resetCommandId: null }),
      ),
    )
  },
}

/** A resource with no restore: the select says a need opens at the start. */
export const NoRestore: Story = {
  args: { form: { kind: 'edit', id: 'stripe' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Payment sandbox' })
    await expect(
      within(dialog).getByRole('combobox', { name: 'Restore command' }),
    ).toHaveTextContent('None: a need opens at the start')
  },
}

/** A save the engine refused: the reason stands in the dialog, in words. */
export const FormRefused: Story = {
  args: {
    form: { kind: 'edit', id: 'db' },
    refused: 'These resources are refused: Shared database is declared twice.',
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Shared database' })
    await expect(within(dialog).getByRole('alert')).toHaveTextContent('declared twice')
  },
}

/** Removing a resource: the destructive button names it. */
export const RemoveAResource: Story = {
  args: { form: { kind: 'edit', id: 'db' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Shared database' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Shared database' }))
    await expect(args.onRemove).toHaveBeenCalledWith('db')
  },
}

/** Long names, many commands and a long queue: every line stays on one row. */
export const Dense: Story = {
  args: { resources: DENSE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Exclusive resources' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(4)
  },
}
