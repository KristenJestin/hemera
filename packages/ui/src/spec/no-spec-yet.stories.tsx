import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { NoSpecYet } from './no-spec-yet.tsx'
import { DRAFTS } from './spec-fixtures.ts'

/** A `define` Session with no Spec: create one, or join a draft of the Project. */
const meta = {
  title: 'Blocks/Spec/NoSpecYet',
  component: NoSpecYet,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { projectName: 'Atlas', drafts: DRAFTS, onCreate: fn(), onJoin: fn() },
  argTypes: {
    projectName: { control: 'text' },
    drafts: { control: 'object', description: 'The drafts of the Project, with their writer.' },
    onCreate: { description: 'Creates a Spec from this conversation.' },
    onJoin: { description: 'Joins a draft, as its reader.' },
  },
} satisfies Meta<typeof NoSpecYet>

export default meta

type Story = StoryObj<typeof meta>

/** Join a Spec takes the keyboard to the drafts, and a draft joins it. */
export const Drafts: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'This Session defines a Spec.' }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Join a Spec' }))
    const first = canvas.getByRole('button', { name: /ATL-12/ })
    await expect(first).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onJoin).toHaveBeenCalledWith('ATL-12')
    await userEvent.click(canvas.getByRole('button', { name: 'Create a Spec' }))
    await expect(args.onCreate).toHaveBeenCalled()
  },
}

/** No draft in the Project: nothing to join, and said so. */
export const NoDrafts: Story = {
  args: { drafts: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('No draft to join yet.')).toBeVisible()
  },
}
