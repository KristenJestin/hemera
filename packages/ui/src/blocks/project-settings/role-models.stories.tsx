import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { LONG_MODEL, ROLE_MODELS } from './agent-settings-fixtures.ts'
import {
  type ProjectRoleModel,
  RoleModelsSection,
  type RoleModelsSectionProps,
} from './role-models.tsx'

/**
 * The model each role runs on in a Project: the Project's override, or the application's model for
 * that role, which the row shows in its quiet tone. A row with an override carries the × that
 * takes it back to the application's. The trigger is where the model picker opens.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Models by role',
  component: RoleModelsSection,
  parameters: { layout: 'fullscreen' },
  args: { roles: ROLE_MODELS, onPick: fn(), onReset: fn() },
  argTypes: { roles: { table: { disable: true } } },
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
      onReset={(role) => {
        setRoles((before) =>
          before.map((one) => (one.role === role ? { ...one, override: null } : one)),
        )
        args.onReset(role)
      }}
    />
  )
}

/** Two roles overridden in Acme; the others run on the application's model, said quietly. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const builder = canvas.getByRole('button', {
      name: 'Model of Builder: Codex · gpt-5.5 · medium',
    })
    expect(builder).toBeVisible()
    const planner = canvas.getByRole('button', {
      name: 'Model of Planner: app default, Claude Code · Opus · high',
    })
    await userEvent.click(planner)
    expect(args.onPick).toHaveBeenCalledWith('Planner')
    expect(canvas.queryByRole('button', { name: 'Back to the app default for Planner' })).toBeNull()
  },
}

/** No override at all: every role says the application's model, and no row carries an ×. */
export const AppDefaults: Story = {
  args: { roles: ROLE_MODELS.map((one) => ({ ...one, override: null })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryAllByRole('button', { name: /^Back to the app default/ })).toHaveLength(0)
    expect(canvas.getAllByRole('button', { name: /: app default, / })).toHaveLength(6)
  },
}

/** The × of an override takes the role back to the application's model. */
export const Reset: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Back to the app default for Builder' }),
    )
    expect(
      await canvas.findByRole('button', {
        name: 'Model of Builder: app default, Claude Code · Sonnet · medium',
      }),
    ).toBeVisible()
  },
}

/** The rows on their way: each holds a row's own shape. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(4)
    expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

/** A long model name ends in an ellipsis inside its trigger; the × stays in sight. */
export const LongText: Story = {
  args: {
    roles: [
      ...ROLE_MODELS.slice(0, 1),
      { role: 'Builder', override: LONG_MODEL, appDefault: 'Claude Code · Sonnet · medium' },
      ...ROLE_MODELS.slice(2),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByText(LONG_MODEL)
    expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
    expect(
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
    expect(canvas.getByRole('button', { name: /^Model of Builder/ })).toHaveFocus()
    await userEvent.tab()
    expect(
      canvas.getByRole('button', { name: 'Back to the app default for Builder' }),
    ).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: /^Model of Reviewer/ })).toHaveFocus()
  },
}
