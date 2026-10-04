import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { SettingsFixture } from '../surfaces/project-settings/settings-fixtures.tsx'

/**
 * Open question 20, the Workspace on disk: where a Project's Workspaces folder and its branch
 * prefix are written, and how their defaults are shown. In both variants an empty field is the
 * default and shows it in its quiet tone — Hemera's folder for the Project, the Project's name as
 * a slug — and a field written in carries the × that takes it back.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Workspaces on disk',
  component: SettingsFixture,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsFixture>

export default meta
type Story = StoryObj<typeof meta>

/** A: a section of their own, `Workspaces`, beside the repositories. */
export const OwnSection: Story = {
  args: { section: 'workspaces', workspacesIn: 'section' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Workspaces' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(canvas.getByRole('textbox', { name: 'Branch prefix' })).toHaveAttribute(
      'placeholder',
      'acme',
    )
  },
}

/** B: under the repositories, in the open band of their frame: one section fewer in the list. */
export const UnderRepositories: Story = {
  args: { section: 'repositories', workspacesIn: 'repositories' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Settings of the Project' })
    expect(within(nav).queryByRole('button', { name: 'Workspaces' })).toBeNull()
    expect(canvas.getByRole('textbox', { name: 'Workspaces folder' })).toBeVisible()
  },
}
