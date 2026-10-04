import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { IconPlus } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { SectionHead } from './section-head.tsx'

/**
 * The head of a section, above its frame: its name, its count, what it offers at its end. The
 * same head on Home, on a Project page and in a Project's settings.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/SectionHead',
  component: SectionHead,
  parameters: { layout: 'padded' },
  args: { title: 'Repositories', count: 3 },
  decorators: [
    (Story) => (
      <div className="flex w-full max-w-page flex-col">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SectionHead>

export default meta
type Story = StoryObj<typeof meta>

/** A name and its count. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Repositories3',
    )
  },
}

/** What the section offers, at the end of its head. */
export const WithAction: Story = {
  args: {
    actions: (
      <Button size="sm" onClick={fn()}>
        <IconPlus size="sm" />
        Add a repository
      </Button>
    ),
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button', { name: 'Add a repository' })).toBeVisible()
  },
}

/** A count that calls for the user: the warning dot before it. */
export const Calling: Story = {
  args: { title: 'Needs you', count: 2, calls: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.bg-warning')).not.toBeNull()
  },
}

/** A section that folds: its head is one button, the chevron turning as it opens. */
export const Folding: Story = {
  render: (args) => {
    const [open, setOpen] = useState(false)
    return (
      <SectionHead
        {...args}
        title="Done"
        count={4}
        fold={{ open, onToggle: () => setOpen(!open) }}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const head = within(canvasElement).getByRole('button', { name: /^Done/ })
    expect(head).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'true')
  },
}
