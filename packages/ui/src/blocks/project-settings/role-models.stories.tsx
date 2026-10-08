import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AGENTS } from '../../components/model-picker/model-picker-fixtures.ts'
import { LONG_MODEL, LONG_ROLE_AGENTS, ROLE_MODELS } from './agent-settings-fixtures.ts'
import {
  type ProjectRoleModel,
  RoleModelsSection,
  type RoleModelsSectionProps,
} from './role-models.tsx'

/**
 * The model each role runs on in a Project: the Project's override, or the application's model for
 * that role, which the row shows in its quiet tone. A row with an override carries the × that
 * takes it back to the application's. The trigger is the model picker, "Use the default" at the
 * head of its list.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Models by role',
  component: RoleModelsSection,
  parameters: { layout: 'fullscreen' },
  args: {
    roles: ROLE_MODELS,
    agents: AGENTS,
    onChange: fn(),
    onFavourite: fn(),
    onHide: fn(),
  },
  argTypes: { roles: { table: { disable: true } }, agents: { table: { disable: true } } },
  render: (args) => <Held {...args} />,
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RoleModelsSection>

export default meta
type Story = StoryObj<typeof meta>

function Held(args: RoleModelsSectionProps) {
  const [roles, setRoles] = useState<readonly ProjectRoleModel[]>(args.roles)
  return (
    <RoleModelsSection
      {...args}
      roles={roles}
      onChange={(role, choice) => {
        setRoles((before) =>
          before.map((one) => (one.role === role ? { ...one, override: choice } : one)),
        )
        args.onChange(role, choice)
      }}
    />
  )
}

const body = () => within(document.body)

/** Two roles overridden in Acme; the others run on the application's model, said quietly. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Model of Builder: Codex · gpt-5 · effort medium' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Model of Planner: Default (Claude Code · Opus)' }),
    ).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: 'Back to the app default for Planner' }),
    ).toBeNull()
  },
}

/**
 * Picking a model for a role that runs on the application's: the picker opens on "Use the
 * default", a model picked becomes the Project's, and the × appears.
 */
export const Picking: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Model of Reviewer/ }))
    await waitFor(
      () =>
        expect(
          body().getByRole('option', { name: /Use the default/, selected: true }),
        ).toBeVisible(),
      { timeout: 5000 },
    )
    await userEvent.click(body().getByRole('option', { name: /Haiku/ }))
    await expect(args.onChange).toHaveBeenLastCalledWith('Reviewer', {
      agent: 'claude',
      model: 'haiku',
    })
    await expect(
      canvas.getByRole('button', { name: 'Back to the app default for Reviewer' }),
    ).toBeVisible()
  },
}

/** No override at all: every role says the application's model, and no row carries an ×. */
export const AppDefaults: Story = {
  args: { roles: ROLE_MODELS.map((one) => ({ ...one, override: null })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryAllByRole('button', { name: /^Back to the app default/ }),
    ).toHaveLength(0)
    await expect(canvas.getAllByRole('button', { name: /: Default \(/ })).toHaveLength(6)
  },
}

/** The × of an override takes the role back to the application's model. */
export const Reset: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Back to the app default for Builder' }),
    )
    await expect(args.onChange).toHaveBeenLastCalledWith('Builder', null)
    await expect(
      await canvas.findByRole('button', {
        name: 'Model of Builder: Default (Claude Code · Sonnet)',
      }),
    ).toBeVisible()
  },
}

/** The rows on their way: each holds a row's own shape. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(4)
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

/** A long model name ends in an ellipsis inside its trigger; the × stays in sight. */
export const LongText: Story = {
  args: {
    agents: LONG_ROLE_AGENTS,
    roles: [
      ...ROLE_MODELS.slice(0, 1),
      {
        role: 'Builder',
        override: { agent: 'opencode', model: 'qwen-long', effort: 'high' },
        appDefault: { agent: 'claude', model: 'sonnet' },
      },
      ...ROLE_MODELS.slice(2),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByText(LONG_MODEL)
    await expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
    await expect(
      canvas.getByRole('button', { name: 'Back to the app default for Builder' }),
    ).toBeVisible()
  },
}

/** From the keyboard: each trigger in order, and the × right after the trigger it belongs to. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: /^Model of Planner/ }).focus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: /^Model of Builder/ })).toHaveFocus()
    await userEvent.tab()
    await expect(
      canvas.getByRole('button', { name: 'Back to the app default for Builder' }),
    ).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: /^Model of Reviewer/ })).toHaveFocus()
  },
}

/** A model the engine refused for a role: the row is back as the engine keeps it, and why is said. */
export const ChangeRefused: Story = {
  args: { error: 'The model could not be changed: Hemera could not write to its profile.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'The model could not be changed',
    )
  },
}
