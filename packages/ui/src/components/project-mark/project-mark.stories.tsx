import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ProjectMark } from './project-mark.tsx'
import { ACME_LOGO } from './project-mark-fixtures.ts'

/**
 * Who a Project or a repository is, in one round mark: the letter in the tone of its name, a tone
 * chosen, an icon of the short set, or a small image of the user's own.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/ProjectMark',
  component: ProjectMark,
  args: { name: 'Acme' },
} satisfies Meta<typeof ProjectMark>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing chosen: the letter, in the tone read from the name. */
export const Letter: Story = {
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-avatar]')).toHaveTextContent('A')
  },
}

/** A tone chosen: the same letter, in the tone the user gave it. */
export const Tone: Story = {
  args: { identity: { tone: 'build' } },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-avatar]')).toHaveClass('bg-build-muted')
  },
}

/** An icon of the set, in its tone. */
export const Icon: Story = {
  args: { identity: { tone: 'info', icon: 'rocket' } },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-mark-icon="rocket"]')).not.toBeNull()
  },
}

/** A small image of the user's own: a logo. */
export const Image: Story = {
  args: { identity: { image: ACME_LOGO } },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-mark-image]')).toHaveAttribute('src', ACME_LOGO)
  },
}

/** Drawn alone, it says its name in a tooltip on itself. */
export const Legend: Story = {
  args: { identity: { icon: 'server' }, legend: true },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('img', { name: 'Acme' }))
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Acme')
    })
  },
}
