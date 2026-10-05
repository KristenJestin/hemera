import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { ROLE_MODELS } from './agent-settings-fixtures.ts'
import { RoleModelsSection } from './role-models.tsx'

/**
 * Open question 62: what a role shows in a Project's Models by role when the Project does not
 * override it. Two variants; the one not chosen is removed with this exploration.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Role without override',
  component: RoleModelsSection,
  parameters: { layout: 'fullscreen' },
  args: { roles: ROLE_MODELS, onPick: fn(), onReset: fn() },
  argTypes: { roles: { table: { disable: true } } },
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

/**
 * Recommended. The application's model in the quiet tone, "App default" under the role: what will
 * run is read on the row, as an empty Workspaces field shows its default.
 */
export const QuietModel: Story = {
  args: { showsDefault: 'model' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('Claude Code · Opus · high')).toBeVisible()
  },
}

/** The words "App default" alone in the trigger: quieter, but what runs is one page away. */
export const WordOnly: Story = {
  args: { showsDefault: 'word' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Claude Code · Opus · high')).toBeNull()
    expect(canvas.getAllByText('App default')).toHaveLength(4)
  },
}
