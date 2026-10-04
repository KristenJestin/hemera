import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { VALUES, VARIABLES } from './project-settings-fixtures.ts'
import {
  MASK,
  type SettingsVariable,
  type VariableDraft,
  VariableForm,
  VariablesSection,
  type VariablesSectionProps,
} from './variables.tsx'

/**
 * A Project's variables: each name and its value, masked; the eye shows one value and hides it
 * again. The `…` holds Edit and Remove. A variable's sheet, drawn here as its form, offers the
 * names Hemera fills in its value.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Variables',
  component: VariablesSection,
  parameters: { layout: 'fullscreen' },
  args: {
    variables: VARIABLES.map((variable) => ({ key: variable.key })),
    onReveal: fn(),
    onHide: fn(),
    onEdit: fn(),
    onRemove: fn(),
    onAdd: fn(),
  },
  argTypes: { variables: { table: { disable: true } } },
  render: (args) => <Held {...args} />,
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VariablesSection>

export default meta
type Story = StoryObj<typeof meta>

/** The variables, showing and hiding values as the page does. */
function Held(args: VariablesSectionProps) {
  const [variables, setVariables] = useState<readonly SettingsVariable[]>(args.variables)
  const set = (key: string, value: string | undefined): void =>
    setVariables((before) => before.map((one) => (one.key === key ? { key, value } : one)))
  return (
    <VariablesSection
      {...args}
      variables={variables}
      onReveal={(key) => {
        set(key, VALUES.get(key))
        args.onReveal(key)
      }}
      onHide={(key) => {
        set(key, undefined)
        args.onHide(key)
      }}
    />
  )
}

/** Four variables, every value masked by the same eight dots, whatever its length. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      within(canvas.getByRole('list', { name: 'Variables' })).getAllByRole('listitem'),
    ).toHaveLength(4)
    expect(canvas.getAllByText(MASK)).toHaveLength(4)
  },
}

/** One value shown on request, and hidden again. */
export const Revealed: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show the value of API_TOKEN' }))
    expect(args.onReveal).toHaveBeenCalledWith('API_TOKEN')
    expect(await canvas.findByText('acme-local-6f1c2a')).toBeVisible()
    const hide = canvas.getByRole('button', { name: 'Hide the value of API_TOKEN' })
    expect(hide).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(hide)
    expect(canvas.queryByText('acme-local-6f1c2a')).toBeNull()
  },
}

/** A value being read to be shown: the eye says it is working, in its place. */
export const Revealing: Story = {
  args: { variables: [{ key: 'DATABASE_URL', revealing: true }, { key: 'API_TOKEN' }] },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status', { name: 'Working' })).toBeInTheDocument()
  },
}

/** Remove, in the `…`, in the destructive tone with its bin. */
export const Removing: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'More for PAYMENTS_KEY' }))
    const remove = await within(document.body).findByRole('menuitem', {
      name: 'Remove PAYMENTS_KEY',
    })
    expect(remove).toHaveAttribute('data-tone', 'destructive')
    await userEvent.click(remove)
    expect(args.onRemove).toHaveBeenCalledWith('PAYMENTS_KEY')
  },
}

/** No variable yet: Hemera asleep, and the way to add one. */
export const Empty: Story = {
  args: { variables: [] },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('heading', { name: 'No variable yet' })).toBeVisible()
  },
}

/** On their way: the rows' own shape. */
export const Loading: Story = {
  args: { variables: [], loading: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
  },
}

/** A long name and a long value, shown: each ends in an ellipsis. */
export const LongText: Story = {
  args: {
    variables: [
      ...VARIABLES,
      {
        key: 'PLATFORM_API_AND_BACKGROUND_WORKERS_DATABASE_URL',
        value:
          'postgres://platform-api@localhost:5432/acme_platform_api_and_background_workers_{workspace}?sslmode=disable',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const value = within(canvasElement).getByText(/sslmode=disable/)
    expect(getComputedStyle(value).textOverflow).toBe('ellipsis')
  },
}

/** From the keyboard: the eye, then the `…`, row by row. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Show the value of DATABASE_URL' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Hide the value of DATABASE_URL' })).toHaveFocus()
    })
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'More for DATABASE_URL' })).toHaveFocus()
  },
}

/** The form of a variable's sheet, holding its draft. */
function Sheet({ draft: first }: { draft: VariableDraft }) {
  const [draft, setDraft] = useState(first)
  return (
    <div className="mx-auto flex w-full max-w-view-narrow flex-col gap-5 p-4">
      <VariableForm draft={draft} onChange={setDraft} />
    </div>
  )
}

/** A new variable whose value takes a name Hemera fills, offered at the end of its field. */
export const SheetNew: Story = {
  render: () => <Sheet draft={{ key: 'REDIS_URL', value: 'redis://localhost:6379/' }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Insert a name in Value' }))
    await userEvent.click(
      await within(document.body).findByRole('menuitem', {
        name: /\{workspace\}\s*Workspace name/,
      }),
    )
    expect(canvas.getByRole('textbox', { name: 'Value' })).toHaveValue(
      'redis://localhost:6379/{workspace}',
    )
  },
}
