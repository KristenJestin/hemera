import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { IconActivity, IconGitBranch, IconMessages } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { Kbd } from '../kbd/kbd.tsx'
import { List, ListItem } from '../list/list.tsx'
import { Frame, FrameFooter, FrameHeader } from './frame.tsx'

/**
 * A border that follows, and a body inside it with a border of its own (design D4-07, D4-08).
 *
 * The one motif of every surface. What is not in the body stays open in the rim: a header
 * above, a footer below, or both.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/Frame',
  component: Frame,
  parameters: { layout: 'padded' },
  args: {
    focusable: false,
    animated: false,
    header: (
      <FrameHeader
        icon={<IconActivity size="sm" />}
        title="Activity"
        action={
          <Button variant="link" size="sm" onClick={fn()}>
            Journal
          </Button>
        }
      />
    ),
    children: (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        The body: the card surface, its own line, its corners the rim's minus the room between.
      </p>
    ),
  },
  argTypes: {
    focusable: {
      control: 'boolean',
      description: 'Whether the body is where a caret goes, and wears the ring when it does.',
    },
    animated: {
      control: 'boolean',
      description:
        'Whether the rim carries `layout`, for a header or a footer that comes and goes.',
    },
    header: { control: false, description: 'What stays open above the body.' },
    footer: { control: false, description: 'What stays open below the body.' },
    children: { control: false, description: 'The body.' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Open above, open below, or both: the three shapes every surface takes. */
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <Frame
        header={
          <FrameHeader
            icon={<IconMessages size="sm" />}
            title="Sessions"
            action={
              <Button variant="link" size="sm">
                Archived
              </Button>
            }
          />
        }
      >
        <List label="Sessions">
          <ListItem
            icon={<IconMessages size="sm" />}
            title="CSV invoice export"
            description="“Invoices should export with HT and TTC…” · 4 messages"
            trailing="12 min ago"
            onSelect={fn()}
          />
          <ListItem
            icon={<IconMessages size="sm" />}
            title="Full-text search"
            description="“Postgres FTS or a separate index?” · 2 messages"
            trailing="yesterday"
            onSelect={fn()}
          />
        </List>
      </Frame>

      <Frame
        focusable
        footer={
          <FrameFooter>
            <Button variant="secondary" size="sm">
              <IconGitBranch size="sm" />
              main
            </Button>
            <Button variant="primary" size="sm" className="ml-auto">
              Send
              <Kbd keys="Enter" />
            </Button>
          </FrameFooter>
        }
      >
        <textarea
          aria-label="What is on your mind?"
          className="min-h-12 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          placeholder="What is on your mind?"
        />
      </Frame>
    </div>
  ),
}

/** The body wears the ring the moment something inside it has the focus. */
export const States: Story = {
  args: {
    focusable: true,
    header: undefined,
    children: (
      <input
        aria-label="A field in the body"
        className="w-full bg-transparent px-4 py-3 text-sm outline-none"
        placeholder="Type here"
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const field = canvas.getByRole('textbox')
    await userEvent.tab()
    expect(field).toHaveFocus()
  },
}
