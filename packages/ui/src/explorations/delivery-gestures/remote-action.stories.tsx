import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { RULES } from '../../blocks/project-settings/delivery-fixtures.ts'
import { findOpen } from '../../overlay-play.ts'
import { NewRemoteStep } from './remote-action.tsx'

const body = () => within(document.body)

/**
 * Gesture 5 of #467, an action on the remote that approves a deployment. Its own kind is
 * recommended: one choice in the list every step is chosen from, one field, and a line that says
 * `Approve a deployment` rather than `Action on the remote`. Action first keeps one entry in the
 * catalogue and asks the choice a second time.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Delivery gestures/5 Approve a deployment',
  component: NewRemoteStep,
  parameters: { layout: 'fullscreen' },
  args: { rules: RULES, way: 'own-kind', initial: 'approve-deployment' },
  argTypes: { rules: { table: { disable: true } } },
} satisfies Meta<typeof NewRemoteStep>

export default meta
type Story = StoryObj<typeof meta>

/** Recommended: Approve a deployment chosen as the kind; its one field, the environment. */
export const OwnKind: Story = {
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'New step · api' })
    expect(within(dialog).getByRole('combobox', { name: 'Kind' })).toHaveTextContent(
      'Approve a deployment',
    )
    expect(within(dialog).getByRole('textbox', { name: 'Environment' })).toHaveValue('production')
    expect(within(dialog).queryByRole('combobox', { name: 'Action' })).toBeNull()
  },
}

/** Recommended, the other kind: Action on the remote runs a workflow, with its inputs. */
export const OwnKindWorkflow: Story = {
  args: { initial: 'run-workflow' },
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'New step · api' })
    expect(within(dialog).getByRole('textbox', { name: 'Workflow' })).toBeVisible()
    expect(within(dialog).getByRole('textbox', { name: 'Inputs' })).toBeVisible()
  },
}

/** The alternative: Action on the remote, then which action; Approve a deployment chosen. */
export const ActionFirst: Story = {
  args: { way: 'action-first' },
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'New step · api' })
    expect(within(dialog).getByRole('combobox', { name: 'Kind' })).toHaveTextContent(
      'Action on the remote',
    )
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Action' }))
    const options = await body().findAllByRole('option')
    expect(options.map((one) => one.textContent)).toEqual([
      'Run a workflow',
      'Approve a deployment',
    ])
    await userEvent.keyboard('{Escape}')
  },
}
