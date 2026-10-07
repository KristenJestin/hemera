import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LIMITS, limitRefusal } from './agent-settings-fixtures.ts'
import { type BudgetLimit, BudgetSection, type BudgetSectionProps } from './budget.tsx'

/**
 * How much a mission of the Project may run: how many sub-agents at once, and, per mission, how
 * many launches, automatic retries and automatic rounds. Each field is empty until written in, and
 * empty is the application's value, which it shows in its quiet tone — as the Workspaces fields do.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Cap and budget',
  component: BudgetSection,
  parameters: { layout: 'fullscreen' },
  args: { limits: LIMITS, onLimit: fn(), refusalOf: limitRefusal },
  argTypes: { limits: { table: { disable: true } } },
  render: (args) => <Held {...args} />,
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BudgetSection>

export default meta
type Story = StoryObj<typeof meta>

function Held(args: BudgetSectionProps) {
  const [limits, setLimits] = useState<readonly BudgetLimit[]>(args.limits)
  return (
    <BudgetSection
      {...args}
      limits={limits}
      onLimit={(id, value) => {
        setLimits((before) => before.map((one) => (one.id === id ? { ...one, value } : one)))
        args.onLimit(id, value)
      }}
    />
  )
}

/** Acme's: the cap at the application's three, a budget of 24 launches, the rest as the app has it. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const cap = canvas.getByRole('textbox', { name: 'Sub-agents at once' })
    expect(cap).toHaveValue('')
    expect(cap).toHaveAttribute('placeholder', '3')
    expect(canvas.getByRole('textbox', { name: 'Launches' })).toHaveValue('24')
    expect(canvas.getByRole('button', { name: 'Back to the default launches' })).toBeVisible()
    expect(
      canvas.queryByRole('button', { name: 'Back to the default sub-agents at once' }),
    ).toBeNull()
  },
}

/** A value that is not a whole number is refused under its field, in words. */
export const Refused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rounds = canvas.getByRole('textbox', { name: 'Automatic rounds' })
    await userEvent.type(rounds, 'many')
    expect(await canvas.findByText('Write a whole number from 1 to 999.')).toBeVisible()
  },
}

/** The cap has its own bounds: from one to six sub-agents at once. */
export const CapRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Sub-agents at once' }), '7')
    // The refusal grows in under its field.
    await waitFor(() => expect(canvas.getByText('Write a whole number from 1 to 6.')).toBeVisible())
  },
}

/** The × empties a field: the application's value applies again, shown in the quiet tone. */
export const Reset: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Back to the default launches' }))
    const launches = canvas.getByRole('textbox', { name: 'Launches' })
    expect(launches).toHaveValue('')
    expect(launches).toHaveAttribute('placeholder', '20')
  },
}

/** The fields on their way: each holds a field's own shape. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('[data-field-skeleton]')).toHaveLength(4)
    expect(within(canvasElement).queryByRole('textbox')).toBeNull()
  },
}

/** From the keyboard: the four fields in order, and a field's × right after it. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('textbox', { name: 'Sub-agents at once' }).focus()
    await userEvent.tab()
    expect(canvas.getByRole('textbox', { name: 'Launches' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Back to the default launches' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('textbox', { name: 'Automatic retries' })).toHaveFocus()
  },
}

/** A value the engine refused: the fields are back as the engine keeps them, and why is said. */
export const WriteRefused: Story = {
  args: { error: 'The limits could not be kept: Hemera could not write to its profile.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'The limits could not be kept',
    )
  },
}
