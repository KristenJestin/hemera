import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { SettingsFixture } from '../surfaces/project-settings/settings-fixtures.tsx'

/**
 * Whether 0.x's repository icons are kept. In both variants the Project wears its letter, in the
 * tone read from its name, as everywhere in 1.0; what differs is whether a repository wears an icon
 * of its own before its path, which the user would choose and the engine would then keep.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Repository identity',
  component: SettingsFixture,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsFixture>

export default meta
type Story = StoryObj<typeof meta>

/** A: a repository is its path in the mono face, as on the Project page; no icon to choose. */
export const Plain: Story = {
  args: { dense: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-repository="api"] .tabler-icon-server')).toBeNull()
  },
}

/** B: each repository wears an icon of its own before its path. */
export const WithIcons: Story = {
  args: { dense: true, repositoryIcons: true },
  play: async ({ canvasElement }) => {
    expect(
      canvasElement.querySelector('[data-repository="api"] .tabler-icon-server'),
    ).not.toBeNull()
  },
}
