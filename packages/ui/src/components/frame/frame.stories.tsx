import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconFolder, IconGitBranch } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { List, ListItem } from '../list/list.tsx'
import { Frame, FrameFooter, FrameHeader } from './frame.tsx'

/**
 * A border that follows, and a body inside it with a border of its own: the one motif of every
 * surface. What is not in the body stays open in the rim: a header above, a footer below, or both.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/Frame',
  component: Frame,
  parameters: { layout: 'padded' },
  args: {
    children: (
      <List label="Repositories of Acme">
        <ListItem icon={<IconFolder size="sm" />} title="api" description="main" onSelect={fn()} />
        <ListItem icon={<IconFolder size="sm" />} title="web" description="main" onSelect={fn()} />
      </List>
    ),
  },
  argTypes: {
    focusable: { control: 'boolean' },
    animated: { control: 'boolean' },
    header: { control: false },
    footer: { control: false },
    children: { control: false },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

/** Open above: an icon, what the frame is about, and one link at the end. */
export const WithHeader: Story = {
  args: {
    header: (
      <FrameHeader
        icon={<IconFolder size="sm" />}
        title="Repositories"
        description="What Acme is made of"
        action={
          <Button variant="link" size="sm" onClick={fn()}>
            Add
          </Button>
        }
      />
    ),
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('heading', { name: 'Repositories' })).toBeVisible()
  },
}

/** Open below: the actions of what the body holds. */
export const WithFooter: Story = {
  args: {
    footer: (
      <FrameFooter>
        <Button variant="secondary" size="sm">
          <IconGitBranch size="sm" />
          main
        </Button>
        <Button variant="primary" size="sm" className="ml-auto">
          Pull all
        </Button>
      </FrameFooter>
    ),
  },
}

/** A body the caret lives in: it wears the ring the moment something inside it has the focus. */
export const Focused: Story = {
  args: {
    focusable: true,
    children: (
      <input
        aria-label="Name of the branch"
        className="w-full bg-transparent px-4 py-3 text-sm outline-none"
        placeholder="feature/export"
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox')
    await userEvent.tab()
    expect(field).toHaveFocus()
    const body = field.parentElement!
    await waitFor(() => {
      expect(getComputedStyle(body, '::after').opacity).toBe('1')
    })
  },
}
